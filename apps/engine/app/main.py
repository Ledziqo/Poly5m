import asyncio
import json
import math
import os
import sqlite3
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal

import httpx
import websockets
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel


Direction = Literal["UP", "DOWN", "WAIT"]
DB_PATH = os.getenv("POLY5M_DB", "/data/poly5m.db")
REFERENCE_MODE = os.getenv("REFERENCE_MODE", "binance").lower()


def now_ms() -> int:
    return int(time.time() * 1000)


def current_window_bounds(ts: int | None = None) -> tuple[int, int]:
    ts = ts or now_ms()
    five = 5 * 60 * 1000
    start = (ts // five) * five
    return start, start + five


def active_window_bounds() -> tuple[int, int]:
    fallback_start, fallback_end = current_window_bounds()
    if state.pm_window_end and state.pm_window_end > now_ms() - 5_000:
        return state.pm_window_start or state.pm_window_end - 5 * 60 * 1000, state.pm_window_end
    return fallback_start, fallback_end


def clear_stale_polymarket_window() -> None:
    if state.pm_window_end and now_ms() > state.pm_window_end + 5_000:
        old_slug = state.pm_event_slug
        state.pm_window_start = 0
        state.pm_window_end = 0
        state.pm_event_slug = ""
        state.up_token_id = ""
        state.down_token_id = ""
        state.condition_id = ""
        state.best_depth_up = 0
        state.best_depth_down = 0
        state.price_to_beat_source = "fallback"
        state.price_to_beat_window_id = ""
        if old_slug:
            log("INFO", f"Rolled past expired Polymarket window {old_slug}; waiting for the next BTC 5m market.")


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def normal_cdf(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


@dataclass
class Settings:
    starting_balance: float = 1000.0
    balance: float = 1000.0
    stake_amount: float = 25.0
    max_trade_amount: float = 50.0
    risk_mode: str = "balanced"
    bot_state: str = "stopped"
    taker_fee_rate: float = 0.018
    forced_cadence_every: int = 3
    skipped_windows: int = 0


@dataclass
class Trade:
    id: str
    timestamp: int
    window_id: str
    direction: str
    status: str
    entry_price: float
    price_to_beat: float
    btc_entry_price: float
    shares_count: float
    stake: float
    fee_paid: float
    pnl: float = 0.0
    actual_outcome: str | None = None
    exit_price: float | None = None
    forced_trade: bool = False
    reason: str = ""


@dataclass
class EngineState:
    settings: Settings = field(default_factory=Settings)
    candles: list[dict] = field(default_factory=list)
    logs: list[dict] = field(default_factory=list)
    history: list[Trade] = field(default_factory=list)
    active_trade: Trade | None = None
    current_price: float = 0.0
    indicator_price: float = 0.0
    chainlink_price: float = 0.0
    chainlink_status: str = "not_configured"
    price_to_beat: float = 0.0
    price_to_beat_source: str = "fallback"
    price_to_beat_window_id: str = ""
    pm_window_start: int = 0
    pm_window_end: int = 0
    pm_event_slug: str = ""
    last_window_id: str = ""
    processed_window_id: str = ""
    up_price: float = 0.5
    down_price: float = 0.5
    up_bid: float = 0.49
    up_ask: float = 0.51
    down_bid: float = 0.49
    down_ask: float = 0.51
    liquidity: float = 0.0
    reference_source: str = "Binance BTCUSDT WebSocket"
    up_token_id: str = ""
    down_token_id: str = ""
    condition_id: str = ""
    best_depth_up: float = 0.0
    best_depth_down: float = 0.0
    last_binance_rest_sync: float = 0.0
    last_polymarket_sync: float = 0.0
    last_chainlink_sync: float = 0.0
    brain_bias: float = 0.0
    brain_direction: str = "WAIT"
    brain_signal_age: int = 0
    brain_last_window_id: str = ""


state = EngineState()
app = FastAPI(title="Poly5m Engine", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ControlBody(BaseModel):
    action: Literal["start", "stop", "reset", "emergency_stop"]


class SettingsBody(BaseModel):
    starting_balance: float | None = None
    stake_amount: float | None = None
    max_trade_amount: float | None = None
    risk_mode: Literal["safe", "balanced", "aggressive"] | None = None
    taker_fee_rate: float | None = None


def log(level: str, message: str) -> None:
    entry = {
        "id": len(state.logs) + 1,
        "timestamp": now_ms(),
        "level": level,
        "message": message,
    }
    state.logs.append(entry)
    state.logs = state.logs[-250:]
    try:
        with db() as con:
            con.execute("INSERT INTO logs(timestamp, level, message) VALUES (?, ?, ?)", (entry["timestamp"], level, message))
    except Exception:
        pass


def db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def init_db() -> None:
    with db() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS trades (
          id TEXT PRIMARY KEY,
          timestamp INTEGER NOT NULL,
          window_id TEXT NOT NULL,
          direction TEXT NOT NULL,
          status TEXT NOT NULL,
          entry_price REAL NOT NULL,
          exit_price REAL,
          price_to_beat REAL NOT NULL,
          btc_entry_price REAL NOT NULL,
          shares_count REAL NOT NULL,
          stake REAL NOT NULL,
          fee_paid REAL NOT NULL,
          pnl REAL NOT NULL,
          actual_outcome TEXT,
          forced_trade INTEGER NOT NULL,
          reason TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp INTEGER NOT NULL,
          level TEXT NOT NULL,
          message TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS windows (
          id TEXT PRIMARY KEY,
          window_start INTEGER NOT NULL,
          window_end INTEGER NOT NULL,
          price_to_beat REAL,
          up_token_id TEXT,
          down_token_id TEXT,
          condition_id TEXT,
          source TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS backtest_runs (
          id TEXT PRIMARY KEY,
          timestamp INTEGER NOT NULL,
          windows INTEGER NOT NULL,
          trades INTEGER NOT NULL,
          win_rate REAL NOT NULL,
          pnl REAL NOT NULL,
          notes TEXT NOT NULL
        );
        """)


def save_setting(key: str, value) -> None:
    with db() as con:
        con.execute("INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)", (key, json.dumps(value)))


def load_persistent_state() -> None:
    init_db()
    with db() as con:
        for row in con.execute("SELECT key, value FROM settings"):
            if hasattr(state.settings, row["key"]):
                setattr(state.settings, row["key"], json.loads(row["value"]))
        rows = con.execute("SELECT * FROM trades ORDER BY timestamp ASC LIMIT 1000").fetchall()
        state.history = [
            Trade(
                id=r["id"],
                timestamp=r["timestamp"],
                window_id=r["window_id"],
                direction=r["direction"],
                status=r["status"],
                entry_price=r["entry_price"],
                exit_price=r["exit_price"],
                price_to_beat=r["price_to_beat"],
                btc_entry_price=r["btc_entry_price"],
                shares_count=r["shares_count"],
                stake=r["stake"],
                fee_paid=r["fee_paid"],
                pnl=r["pnl"],
                actual_outcome=r["actual_outcome"],
                forced_trade=bool(r["forced_trade"]),
                reason=r["reason"],
            )
            for r in rows
        ]
        state.active_trade = next((t for t in state.history if t.status == "OPEN"), None)
        state.logs = [dict(r) for r in con.execute("SELECT id, timestamp, level, message FROM logs ORDER BY id DESC LIMIT 100").fetchall()][::-1]


def persist_trade(trade: Trade) -> None:
    with db() as con:
        con.execute(
            """
            INSERT OR REPLACE INTO trades(
              id,timestamp,window_id,direction,status,entry_price,exit_price,price_to_beat,
              btc_entry_price,shares_count,stake,fee_paid,pnl,actual_outcome,forced_trade,reason
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                trade.id, trade.timestamp, trade.window_id, trade.direction, trade.status,
                trade.entry_price, trade.exit_price, trade.price_to_beat, trade.btc_entry_price,
                trade.shares_count, trade.stake, trade.fee_paid, trade.pnl, trade.actual_outcome,
                1 if trade.forced_trade else 0, trade.reason,
            ),
        )


def persist_window() -> None:
    start, end = active_window_bounds()
    with db() as con:
        con.execute(
            """
            INSERT OR REPLACE INTO windows(id, window_start, window_end, price_to_beat, up_token_id, down_token_id, condition_id, source, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (str(start), start, end, state.price_to_beat, state.up_token_id, state.down_token_id, state.condition_id, state.reference_source, now_ms()),
        )


async def fetch_json(url: str, timeout: float = 8.0):
    async with httpx.AsyncClient(timeout=timeout) as client:
        res = await client.get(url)
        res.raise_for_status()
        return res.json()


async def sync_binance() -> None:
    try:
      ticker, klines = await asyncio.gather(
          fetch_json("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT"),
          fetch_json("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=90"),
      )
      fallback_price = float(ticker["price"])
      if state.chainlink_status != "live":
          state.indicator_price = fallback_price
      if state.chainlink_status != "live" and (REFERENCE_MODE == "binance" or not state.current_price):
          state.current_price = state.indicator_price
          state.reference_source = "Binance BTCUSDT WebSocket"
      if state.chainlink_status != "live":
          state.candles = [
              {
                  "timestamp": int(k[0]),
                  "open": float(k[1]),
                  "high": float(k[2]),
                  "low": float(k[3]),
                  "close": float(k[4]),
                  "volume": float(k[5]),
              }
              for k in klines
          ]
      start, end = current_window_bounds()
      state.last_window_id = str(start)
      has_live_polymarket_strike = (
          state.price_to_beat_source == "polymarket"
          and state.pm_window_start <= now_ms() <= state.pm_window_end + 5_000
      )
      has_live_chainlink_reference = state.chainlink_status == "live" and state.current_price > 0
      if not has_live_polymarket_strike and not has_live_chainlink_reference:
          start_candle = next((c for c in state.candles if abs(c["timestamp"] - start) < 60_000), None)
          if start_candle:
              state.price_to_beat = start_candle["open"]
              state.price_to_beat_source = "binance_open"
          elif not state.price_to_beat:
              state.price_to_beat = state.current_price
              state.price_to_beat_source = "fallback"
    except Exception as exc:
      log("WARN", f"BTC feed degraded: {exc}")


def find_price_value(payload) -> float | None:
    if isinstance(payload, dict):
        for key in ("price", "answer", "value", "benchmarkPrice", "mid", "last", "rate"):
            if key in payload:
                try:
                    val = float(payload[key])
                    if val > 1_000_000:
                        val = val / 100_000_000
                    if 1_000 < val < 1_000_000:
                        return val
                except Exception:
                    pass
        for value in payload.values():
            found = find_price_value(value)
            if found:
                return found
    elif isinstance(payload, list):
        for item in payload:
            found = find_price_value(item)
            if found:
                return found
    return None


async def sync_chainlink_reference() -> None:
    """Use Chainlink/reference price as the decision source when configured.

    Chainlink Data Streams access normally needs a provider URL or proxy owned by
    the deployer. We support a generic JSON endpoint so the VPS can plug in the
    exact Chainlink/reference feed without changing bot logic.
    """
    url = os.getenv("CHAINLINK_BTC_USD_URL", "").strip()
    if REFERENCE_MODE == "binance":
        if state.chainlink_status != "live":
            state.chainlink_status = "waiting_for_polymarket"
            state.reference_source = "Waiting for Polymarket Chainlink BTC/USD"
        return
    if not url:
        state.chainlink_status = "not_configured"
        state.reference_source = "Chainlink/reference not configured; exchange price is display-only"
        return

    headers = {}
    api_key = os.getenv("CHAINLINK_API_KEY", "").strip()
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            res = await client.get(url, headers=headers)
            res.raise_for_status()
            payload = res.json()
        price = find_price_value(payload)
        if not price:
            raise ValueError("no BTC/USD price field found in Chainlink payload")
        state.chainlink_price = price
        state.current_price = price
        state.chainlink_status = "live"
        state.reference_source = "Chainlink/reference BTC/USD"
    except Exception as exc:
        state.chainlink_status = "degraded"
        state.reference_source = "Chainlink/reference degraded; exchange price is display-only"
        log("WARN", f"Chainlink/reference sync degraded: {exc}")


def apply_polymarket_chainlink_price(price: float, timestamp_ms: int | None = None) -> None:
    timestamp_ms = timestamp_ms or now_ms()
    state.chainlink_price = price
    state.current_price = price
    state.indicator_price = price
    state.chainlink_status = "live"
    state.reference_source = "Polymarket Chainlink BTC/USD"
    update_reference_candle(price, timestamp_ms)
    maybe_capture_price_to_beat(price, timestamp_ms)


def update_reference_candle(price: float, timestamp_ms: int) -> None:
    minute = (timestamp_ms // 60_000) * 60_000
    if state.candles and state.candles[-1]["timestamp"] == minute:
        candle = state.candles[-1]
        candle["high"] = max(candle["high"], price)
        candle["low"] = min(candle["low"], price)
        candle["close"] = price
    else:
        state.candles.append({
            "timestamp": minute,
            "open": price,
            "high": price,
            "low": price,
            "close": price,
            "volume": 0.0,
        })
        state.candles = state.candles[-180:]


def maybe_capture_price_to_beat(price: float, timestamp_ms: int) -> None:
    if not state.pm_window_start or not state.pm_window_end:
        return
    window_id = str(state.pm_window_start)
    if state.price_to_beat_source == "polymarket" and state.price_to_beat_window_id == window_id:
        return
    if state.pm_window_start - 1_000 <= timestamp_ms <= state.pm_window_start + 12_000:
        state.price_to_beat = price
        state.price_to_beat_source = "polymarket"
        state.price_to_beat_window_id = window_id
        log("INFO", f"Captured Polymarket Chainlink price-to-beat ${price:.2f} for {state.pm_event_slug or window_id}.")


async def polymarket_rtds_loop() -> None:
    subscribe = {
        "action": "subscribe",
        "subscriptions": [
            {
                "topic": "crypto_prices_chainlink",
                "type": "*",
                "filters": "{\"symbol\":\"btc/usd\"}",
            }
        ],
    }
    while True:
        try:
            async with websockets.connect("wss://ws-live-data.polymarket.com", ping_interval=None, ping_timeout=None) as ws:
                await ws.send(json.dumps(subscribe))
                log("INFO", "Polymarket Chainlink BTC/USD stream connected.")
                last_ping = time.time()
                async for raw in ws:
                    if time.time() - last_ping >= 5:
                        await ws.send("PING")
                        last_ping = time.time()
                    try:
                        msg = json.loads(raw)
                    except Exception:
                        continue
                    payload = msg.get("payload") if isinstance(msg, dict) else None
                    if not isinstance(payload, dict):
                        continue
                    symbol = str(payload.get("symbol") or "").lower()
                    if symbol != "btc/usd":
                        continue
                    value = payload.get("value") or payload.get("full_accuracy_value")
                    if value is None:
                        continue
                    price = float(value)
                    ts = int(payload.get("timestamp") or msg.get("timestamp") or now_ms())
                    apply_polymarket_chainlink_price(price, ts)
        except Exception as exc:
            state.chainlink_status = "degraded" if state.chainlink_price else state.chainlink_status
            log("WARN", f"Polymarket Chainlink stream reconnecting: {exc}")
            await asyncio.sleep(3)


async def sync_polymarket_hint() -> None:
    try:
        start, _ = current_window_bounds()
        slug = f"btc-updown-5m-{start // 1000}"
        event = None
        try:
            event = await fetch_json(f"https://gamma-api.polymarket.com/events/slug/{slug}", 8.0)
        except Exception:
            events = await fetch_json("https://gamma-api.polymarket.com/events?active=true&closed=false&limit=500&order=end_date&ascending=true", 10.0)
            candidates = [e for e in events if "btc-updown-5m" in str(e.get("slug", "")).lower()]
            now = now_ms()

            def event_distance(candidate: dict) -> int:
                candidate_market = (candidate.get("markets") or [None])[0] or {}
                candidate_end = parse_time_ms(candidate.get("endDate") or candidate.get("end_date") or candidate_market.get("endDate") or candidate_market.get("end_date")) or now + 10**12
                candidate_start = parse_time_ms(
                    candidate_market.get("eventStartTime")
                    or candidate.get("eventStartTime")
                    or candidate_market.get("marketStartTime")
                    or candidate.get("marketStartTime")
                    or candidate_market.get("startTime")
                    or candidate.get("startTime")
                ) or candidate_end - 5 * 60 * 1000
                if candidate_start <= now <= candidate_end + 5_000:
                    return 0
                return abs(candidate_start - now) + max(0, candidate_end - now)

            event = min(candidates, key=event_distance, default=None)
        market = (event.get("markets") or [None])[0] if event else None
        if not market:
            return
        previous_slug = state.pm_event_slug
        state.pm_event_slug = str(event.get("slug") or slug)
        event_end = parse_time_ms(event.get("endDate") or event.get("end_date") or market.get("endDate") or market.get("end_date"))
        event_start = parse_time_ms(
            market.get("eventStartTime")
            or event.get("eventStartTime")
            or market.get("marketStartTime")
            or event.get("marketStartTime")
            or market.get("startTime")
            or event.get("startTime")
        )
        if event_end:
            state.pm_window_end = event_end
            state.pm_window_start = event_start or event_end - 5 * 60 * 1000
        if previous_slug and previous_slug != state.pm_event_slug:
            state.price_to_beat = 0
            state.price_to_beat_source = "fallback"
            state.price_to_beat_window_id = ""
        parse_market_tokens(market)
        parsed_strike = parse_price_to_beat(event, market)
        if parsed_strike:
            state.price_to_beat = parsed_strike
            state.price_to_beat_source = "polymarket"
            state.price_to_beat_window_id = str(state.pm_window_start or "")
        prices = market.get("outcomePrices") or []
        if isinstance(prices, str):
            prices = json.loads(prices)
        liquidity = float(market.get("liquidityNum") or market.get("liquidity") or 0)
        if len(prices) >= 2:
            state.up_price = clamp(float(prices[0]), 0.01, 0.99)
            state.down_price = clamp(float(prices[1]), 0.01, 0.99)
            spread = 0.025
            state.up_bid = clamp(state.up_price - spread / 2, 0.01, 0.99)
            state.up_ask = clamp(state.up_price + spread / 2, 0.01, 0.99)
            state.down_bid = clamp(state.down_price - spread / 2, 0.01, 0.99)
            state.down_ask = clamp(state.down_price + spread / 2, 0.01, 0.99)
            state.liquidity = liquidity
            if REFERENCE_MODE == "binance":
                state.reference_source = "Binance BTCUSDT WebSocket + Polymarket"
            else:
                state.reference_source = "Chainlink/reference BTC/USD + Polymarket" if state.chainlink_status == "live" else state.reference_source
        await sync_clob_books()
        persist_window()
    except Exception as exc:
        log("WARN", f"Polymarket odds sync degraded; using model odds fallback: {exc}")


def parse_jsonish(value):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return value
    return value


def parse_time_ms(value) -> int | None:
    if not value:
        return None
    try:
        if isinstance(value, (int, float)):
            return int(value if value > 10_000_000_000 else value * 1000)
        text = str(value).replace("Z", "+00:00")
        return int(datetime.fromisoformat(text).timestamp() * 1000)
    except Exception:
        return None


def parse_price_to_beat(event: dict, market: dict) -> float | None:
    import re

    direct_keys = (
        "priceToBeat", "price_to_beat", "strikePrice", "strike_price",
        "targetPrice", "target_price", "startPrice", "start_price",
        "openPrice", "open_price", "referencePrice", "reference_price",
    )

    def walk(value):
        if isinstance(value, dict):
            for key in direct_keys:
                if key in value:
                    yield str(value.get(key) or "")
            for nested in value.values():
                yield from walk(nested)
        elif isinstance(value, list):
            for nested in value:
                yield from walk(nested)
        elif isinstance(value, str):
            yield value

    haystack = " ".join(str(x or "") for x in walk({"event": event, "market": market}))
    preferred = re.findall(
        r"(?:price\s*to\s*beat|strike|target|reference|open(?:ing)?\s*price)[^\d$]{0,80}\$?\s*([5-9][0-9],[0-9]{3}(?:\.[0-9]+)?|[5-9][0-9]{4,5}(?:\.[0-9]+)?)",
        haystack,
        flags=re.IGNORECASE,
    )
    generic = re.findall(r"\$?\b([5-9][0-9],[0-9]{3}(?:\.[0-9]+)?|[5-9][0-9]{4,5}(?:\.[0-9]+)?)\b", haystack)
    candidates = []
    for match in preferred + generic:
        try:
            price = float(match.replace(",", ""))
            if 10_000 < price < 500_000:
                candidates.append(price)
        except Exception:
            pass
    return candidates[0] if candidates else None


def parse_market_tokens(market: dict) -> None:
    state.condition_id = str(market.get("conditionId") or market.get("condition_id") or state.condition_id or "")
    token_ids = parse_jsonish(market.get("clobTokenIds") or market.get("clob_token_ids") or market.get("tokenIds") or [])
    outcomes = parse_jsonish(market.get("outcomes") or ["Up", "Down"])
    if isinstance(token_ids, list) and len(token_ids) >= 2:
        pairs = list(zip([str(o).lower() for o in outcomes], [str(t) for t in token_ids]))
        up = next((t for o, t in pairs if "up" in o or "yes" in o), token_ids[0])
        down = next((t for o, t in pairs if "down" in o or "no" in o), token_ids[1])
        state.up_token_id = str(up)
        state.down_token_id = str(down)


def book_best(book: dict) -> tuple[float, float, float]:
    bids = book.get("bids") or []
    asks = book.get("asks") or []
    bid = max([float(x.get("price", 0)) for x in bids], default=0)
    ask = min([float(x.get("price", 1)) for x in asks], default=1)
    depth = sum(float(x.get("size", 0)) for x in asks[:8]) if asks else 0
    return bid, ask, depth


async def sync_clob_books() -> None:
    if not state.up_token_id or not state.down_token_id:
        return
    try:
        up_book, down_book = await asyncio.gather(
            fetch_json(f"https://clob.polymarket.com/book?token_id={state.up_token_id}", 6.0),
            fetch_json(f"https://clob.polymarket.com/book?token_id={state.down_token_id}", 6.0),
        )
        state.up_bid, state.up_ask, state.best_depth_up = book_best(up_book)
        state.down_bid, state.down_ask, state.best_depth_down = book_best(down_book)
        state.up_price = clamp((state.up_bid + state.up_ask) / 2, 0.01, 0.99)
        state.down_price = clamp((state.down_bid + state.down_ask) / 2, 0.01, 0.99)
        state.liquidity = max(state.liquidity, state.best_depth_up * state.up_ask + state.best_depth_down * state.down_ask)
    except Exception as exc:
        log("WARN", f"CLOB orderbook degraded: {exc}")


def returns(seconds: int) -> float:
    if len(state.candles) < seconds // 60 + 2:
        return 0.0
    close = state.current_price or state.candles[-1]["close"]
    ago_idx = max(0, len(state.candles) - max(2, seconds // 60 + 1))
    old = state.candles[ago_idx]["close"]
    return (close - old) / old if old else 0.0


def ema(values: list[float], period: int) -> float:
    if not values:
        return 0.0
    k = 2 / (period + 1)
    out = values[0]
    for value in values[1:]:
        out = value * k + out * (1 - k)
    return out


def rsi(values: list[float], period: int = 14) -> float:
    if len(values) <= period:
        return 50.0
    gains = []
    losses = []
    for i in range(-period, 0):
        delta = values[i] - values[i - 1]
        gains.append(max(delta, 0))
        losses.append(abs(min(delta, 0)))
    avg_loss = sum(losses) / period
    if avg_loss == 0:
        return 100.0
    rs = (sum(gains) / period) / avg_loss
    return 100 - (100 / (1 + rs))


def vwap(candles: list[dict]) -> float:
    pv = sum(((c["high"] + c["low"] + c["close"]) / 3) * c["volume"] for c in candles)
    vol = sum(c["volume"] for c in candles)
    return pv / vol if vol else candles[-1]["close"]


def indicator_pack() -> dict:
    candles = state.candles[-60:]
    closes = [c["close"] for c in candles]
    if len(closes) < 20:
        return {
            "ema_fast": state.current_price,
            "ema_slow": state.current_price,
            "ema_slope": 0,
            "rsi": 50,
            "vwap_distance": 0,
            "volatility": 0.0008,
            "acceleration": 0,
            "orderbook_imbalance": 0,
        }
    fast = ema(closes[-12:], 9)
    slow = ema(closes[-26:], 21)
    prev_fast = ema(closes[-18:-6], 9)
    ema_slope = (fast - prev_fast) / prev_fast if prev_fast else 0
    vw = vwap(candles[-30:])
    diffs = [(closes[i] - closes[i - 1]) / closes[i - 1] for i in range(1, len(closes))]
    volatility = max(0.00015, min(0.006, math.sqrt(sum(d * d for d in diffs[-20:]) / min(20, len(diffs)))))
    m15 = returns(60)
    m60 = returns(180)
    acceleration = m15 - (m60 / 3)
    depth_total = state.best_depth_up + state.best_depth_down
    orderbook_imbalance = (state.best_depth_up - state.best_depth_down) / depth_total if depth_total else 0
    return {
        "ema_fast": fast,
        "ema_slow": slow,
        "ema_slope": ema_slope,
        "rsi": rsi(closes),
        "vwap_distance": (state.current_price - vw) / vw if vw else 0,
        "volatility": volatility,
        "acceleration": acceleration,
        "orderbook_imbalance": orderbook_imbalance,
    }


def pattern_memory() -> dict:
    resolved = [t for t in state.history if t.status == "RESOLVED"]
    last = resolved[-12:]
    direction_stats = {"UP": {"wins": 0, "total": 0}, "DOWN": {"wins": 0, "total": 0}}
    for trade in last:
        if trade.direction in direction_stats:
            direction_stats[trade.direction]["total"] += 1
            if trade.actual_outcome == "WIN":
                direction_stats[trade.direction]["wins"] += 1
    up_rate = direction_stats["UP"]["wins"] / direction_stats["UP"]["total"] if direction_stats["UP"]["total"] else 0.5
    down_rate = direction_stats["DOWN"]["wins"] / direction_stats["DOWN"]["total"] if direction_stats["DOWN"]["total"] else 0.5
    recent_bias = clamp((up_rate - down_rate) * 0.18, -0.12, 0.12)
    loss_streak = 0
    for trade in reversed(resolved):
        if trade.actual_outcome == "LOSS":
            loss_streak += 1
        else:
            break
    return {
        "sample": len(last),
        "up_rate": up_rate,
        "down_rate": down_rate,
        "recent_bias": recent_bias,
        "loss_streak": loss_streak,
    }


def market_read(indicators: dict, r1: float, r3: float, distance: float, time_left: float) -> dict:
    trend_strength = abs(indicators["ema_slope"] * 950) + abs(indicators["vwap_distance"] * 420) + abs(r1 * 700)
    chop_penalty = max(0.0, indicators["volatility"] * 1200 - trend_strength)
    direction_agreement = 0
    direction_agreement += 1 if indicators["ema_slope"] > 0 else -1
    direction_agreement += 1 if indicators["vwap_distance"] > 0 else -1
    direction_agreement += 1 if r1 > 0 else -1
    direction_agreement += 1 if r3 > 0 else -1
    direction_agreement += 1 if distance > 0 else -1

    if chop_penalty > 1.4:
        regime = "choppy"
    elif indicators["rsi"] > 78 or indicators["rsi"] < 22:
        regime = "exhaustion-risk"
    elif abs(direction_agreement) >= 4 and trend_strength > 0.55:
        regime = "aligned-trend"
    elif time_left < 150:
        regime = "late-window"
    else:
        regime = "mixed"

    patience = 0.0
    if regime == "choppy":
        patience += 0.012
    if regime == "exhaustion-risk":
        patience += 0.008
    if time_left < 180:
        patience += 0.006
    if abs(direction_agreement) >= 4:
        patience -= 0.004

    return {
        "regime": regime,
        "agreement": direction_agreement,
        "trend_strength": trend_strength,
        "chop_penalty": chop_penalty,
        "extra_edge_required": clamp(patience, 0.0, 0.025),
    }


def brain_filter(raw_side: str, raw_bias: float, edge_up: float, edge_down: float, micro_momentum: float, window_id: str) -> dict:
    if state.brain_last_window_id != window_id:
        state.brain_bias = 0.0
        state.brain_direction = "WAIT"
        state.brain_signal_age = 0
        state.brain_last_window_id = window_id

    previous_direction = state.brain_direction
    previous_bias = state.brain_bias
    smoothed = previous_bias * 0.72 + raw_bias * 0.28
    candidate = "UP" if smoothed > 0 else "DOWN"
    margin = abs(smoothed)
    edge_gap = abs(edge_up - edge_down)

    if candidate == previous_direction:
        state.brain_signal_age = min(8, state.brain_signal_age + 1)
    else:
        state.brain_signal_age = 1

    required_margin = 0.065
    if previous_direction in ("UP", "DOWN") and candidate != previous_direction:
        required_margin = 0.11

    stable_side = previous_direction
    flip_blocked = False
    if margin >= required_margin and state.brain_signal_age >= 2:
        stable_side = candidate
    elif previous_direction in ("UP", "DOWN"):
        stable_side = previous_direction
        flip_blocked = candidate != previous_direction
    elif margin >= 0.045:
        stable_side = candidate
    else:
        stable_side = "WAIT"

    state.brain_bias = smoothed
    state.brain_direction = stable_side

    confidence = int(clamp(42 + margin * 210 + edge_gap * 850 + min(abs(micro_momentum), 2.2) * 9 + state.brain_signal_age * 2, 8, 88))
    return {
        "side": stable_side,
        "smoothed_bias": smoothed,
        "raw_bias": raw_bias,
        "candidate": candidate,
        "previous": previous_direction,
        "signal_age": state.brain_signal_age,
        "flip_blocked": flip_blocked,
        "confidence": confidence,
    }


def compute_decision() -> dict:
    clear_stale_polymarket_window()
    start, end = active_window_bounds()
    time_left = max(0, (end - now_ms()) / 1000)
    elapsed = 300 - time_left
    price = state.current_price
    strike = state.price_to_beat or price
    window_id = str(start)
    if not price or not strike:
        return wait_decision("Waiting for confirmed BTC price and price-to-beat.")

    has_chainlink = state.chainlink_status == "live" or REFERENCE_MODE == "binance"
    has_real_odds = state.liquidity > 0
    if not has_chainlink:
        decision = wait_decision("Waiting for Chainlink/reference BTC/USD before trading.")
        decision["reasons"].append("Exchange price can update the chart, but entries require the configured reference source.")
        return decision
    if not has_real_odds:
        decision = wait_decision("Waiting for real Polymarket BTC 5m odds/liquidity before considering a trade.")
        decision["reasons"].append("Chainlink/reference is live, but the bot still needs active Polymarket odds and liquidity.")
        return decision

    indicators = indicator_pack()
    vol = indicators["volatility"]

    r1 = returns(60)
    r3 = returns(180)
    trend_score = 0.0
    trend_score += clamp(indicators["ema_slope"] * 1200, -0.8, 0.8)
    trend_score += clamp(indicators["vwap_distance"] * 650, -0.7, 0.7)
    trend_score += clamp(indicators["acceleration"] * 1800, -0.6, 0.6)
    trend_score += clamp(indicators["orderbook_imbalance"] * 0.45, -0.45, 0.45)
    if indicators["rsi"] > 78:
        trend_score -= 0.35
    elif indicators["rsi"] < 22:
        trend_score += 0.35
    micro_momentum = clamp((r1 * 900) + (r3 * 260) + trend_score, -2.2, 2.2)
    memory = pattern_memory()
    if memory["loss_streak"] >= 2:
        micro_momentum *= 0.72
    distance = (price - strike) / max(1, strike)
    read = market_read(indicators, r1, r3, distance, time_left)
    seconds_to_expiry = max(20, time_left)
    projected_finish = distance + micro_momentum * vol * math.sqrt(seconds_to_expiry / 300)
    sigma = max(0.00035, vol * math.sqrt(seconds_to_expiry / 60))
    fair_up = clamp(normal_cdf(projected_finish / sigma), 0.03, 0.97)
    fair_down = 1 - fair_up

    fee = state.settings.taker_fee_rate
    edge_up = fair_up - state.up_ask - fee
    edge_down = fair_down - state.down_ask - fee
    raw_side = "UP" if edge_up >= edge_down else "DOWN"
    agreement_bias = clamp(read["agreement"] * 0.035, -0.18, 0.18)
    raw_bias = clamp((edge_up - edge_down) * 1.6 + clamp(micro_momentum / 5.0, -0.45, 0.45) + memory["recent_bias"] + agreement_bias, -1.0, 1.0)
    brain = brain_filter(raw_side, raw_bias, edge_up, edge_down, micro_momentum, window_id)
    best_side = brain["side"] if brain["side"] in ("UP", "DOWN") else raw_side
    best_edge = edge_up if best_side == "UP" else edge_down
    raw_best_edge = max(edge_up, edge_down)
    forced = state.settings.skipped_windows >= state.settings.forced_cadence_every - 1

    entry_window_open = time_left > 120
    data_reasons = [
        f"Autonomous brain bias is {brain['smoothed_bias']:+.3f} after smoothing raw signal {brain['raw_bias']:+.3f}; current stable read is {brain['side']} with {brain['signal_age']} signal-memory ticks.",
        f"Market read is {read['regime']}: agreement score {read['agreement']:+d}/5, trend strength {read['trend_strength']:.2f}, chop pressure {read['chop_penalty']:.2f}.",
        f"Indicator stack: EMA slope {indicators['ema_slope'] * 100:+.3f}%, VWAP distance {indicators['vwap_distance'] * 100:+.3f}%, RSI {indicators['rsi']:.1f}, acceleration {indicators['acceleration'] * 100:+.3f}%, orderbook imbalance {indicators['orderbook_imbalance']:+.2f}.",
        f"Memory check: last {memory['sample']} resolved trades show UP {memory['up_rate'] * 100:.0f}% and DOWN {memory['down_rate'] * 100:.0f}% win rate; active loss streak is {memory['loss_streak']}.",
        f"Fee-adjusted UP edge is {edge_up * 100:+.2f}c and DOWN edge is {edge_down * 100:+.2f}c after {(fee * 100):.2f}% taker fee; stable side edge is {best_edge * 100:+.2f}c.",
        f"Entry window has {time_left:.0f}s left; new entries close at 2:00 remaining.",
    ]
    if brain["flip_blocked"]:
        data_reasons.append(f"Autonomous anti-noise guard held {brain['previous']} instead of chasing a weak {brain['candidate']} twitch.")

    min_edge = {"safe": 0.025, "balanced": 0.012, "aggressive": 0.002}.get(state.settings.risk_mode, 0.012) + read["extra_edge_required"]
    confidence = brain["confidence"]
    if read["regime"] == "aligned-trend":
        confidence = min(92, confidence + 4)
    elif read["regime"] in ("choppy", "exhaustion-risk"):
        confidence = max(5, confidence - 7)

    if not entry_window_open and not state.active_trade:
        return {
            **base_decision("WAIT", fair_up, fair_down, edge_up, edge_down, best_edge, fee, forced, 0, "WAIT"),
            "confidence": confidence,
            "reasons": data_reasons + ["No new entry allowed because less than 2:00 remains."],
            "no_trade_reason": "Entry window closed.",
        }

    if forced:
        return {
            **base_decision(best_side, fair_up, fair_down, edge_up, edge_down, best_edge, fee, True, confidence, "ENTER"),
            "reasons": data_reasons + [f"Forced cadence is active: two windows were skipped, so the bot must take the lesser-bad side. Selected {best_side}."],
        }

    if best_edge >= min_edge and entry_window_open:
        return {
            **base_decision(best_side, fair_up, fair_down, edge_up, edge_down, best_edge, fee, False, confidence, "ENTER"),
            "reasons": data_reasons + [f"Selected {best_side} because its net edge beats the regime-adjusted {min_edge * 100:.1f}c threshold."],
        }

    return {
        **base_decision("WAIT", fair_up, fair_down, edge_up, edge_down, best_edge, fee, False, confidence, "WAIT"),
        "reasons": data_reasons + [f"Waiting because stable-side edge is {best_edge * 100:+.2f}c and raw best edge is {raw_best_edge * 100:+.2f}c, below the risk-mode threshold or not strong enough yet."],
        "no_trade_reason": "No fee-adjusted edge yet.",
    }


def base_decision(direction: Direction, fair_up: float, fair_down: float, edge_up: float, edge_down: float, best_edge: float, fee: float, forced: bool, confidence: int, action: str) -> dict:
    return {
        "direction": direction,
        "confidence": confidence,
        "fair_up": fair_up,
        "fair_down": fair_down,
        "edge_up": edge_up,
        "edge_down": edge_down,
        "best_edge": best_edge,
        "expected_fee_cost": fee,
        "forced_trade": forced,
        "action": action,
        "reasons": [],
        "indicator_scores": {
            "momentum_60s": returns(60),
            "momentum_180s": returns(180),
            "price_to_beat_distance": (state.current_price - state.price_to_beat) / state.price_to_beat if state.price_to_beat else 0,
            **indicator_pack(),
        },
    }


def wait_decision(reason: str) -> dict:
    return {**base_decision("WAIT", 0.5, 0.5, 0, 0, 0, state.settings.taker_fee_rate, False, 0, "WAIT"), "reasons": [reason], "no_trade_reason": reason}


def analytics() -> dict:
    resolved = [t for t in state.history if t.status == "RESOLVED"]
    wins = len([t for t in resolved if t.actual_outcome == "WIN"])
    losses = len([t for t in resolved if t.actual_outcome == "LOSS"])
    pnl = sum(t.pnl for t in resolved)
    total = len(resolved)
    streak = 0
    for t in reversed(resolved):
        if t.actual_outcome == "WIN":
            if streak < 0: break
            streak += 1
        elif t.actual_outcome == "LOSS":
            if streak > 0: break
            streak -= 1
    return {
        "total_pnl": pnl,
        "win_rate": (wins / total * 100) if total else 0,
        "wins": wins,
        "losses": losses,
        "total_trades": total,
        "roi": (pnl / state.settings.starting_balance * 100) if state.settings.starting_balance else 0,
        "current_streak": streak,
        "last_20": [t.actual_outcome for t in resolved[-20:] if t.actual_outcome],
        "best_trade": max([t.pnl for t in resolved], default=0),
        "worst_trade": min([t.pnl for t in resolved], default=0),
    }


def window_payload() -> dict:
    clear_stale_polymarket_window()
    start, end = active_window_bounds()
    return {
        "id": str(start),
        "title": "BTC Up or Down - 5m",
        "market_slug": state.pm_event_slug or f"btc-updown-5m-{start // 1000}",
        "round": time.strftime("%H:%M UTC", time.gmtime(start / 1000)),
        "status": "active",
        "window_start": start,
        "window_end": end,
        "price_to_beat": state.price_to_beat or state.current_price,
        "current_price": state.current_price,
        "indicator_price": state.indicator_price,
        "chainlink_status": state.chainlink_status,
        "reference_source": state.reference_source,
        "up_price": state.up_price,
        "down_price": state.down_price,
        "up_bid": state.up_bid,
        "up_ask": state.up_ask,
        "down_bid": state.down_bid,
        "down_ask": state.down_ask,
        "spread": max(state.up_ask - state.up_bid, state.down_ask - state.down_bid),
        "liquidity": state.liquidity,
        "time_left_seconds": max(0, (end - now_ms()) / 1000),
    }


def dashboard_payload() -> dict:
    return {
        "settings": state.settings.__dict__,
        "window": window_payload(),
        "decision": compute_decision(),
        "active_trade": trade_payload(state.active_trade) if state.active_trade else None,
        "analytics": analytics(),
    }


def trade_payload(trade: Trade) -> dict:
    payload = trade.__dict__.copy()
    if trade.status == "OPEN":
        mark_price = state.up_bid if trade.direction == "UP" else state.down_bid
        current_value = trade.shares_count * max(0.0, mark_price)
        payload["mark_price"] = mark_price
        payload["current_value"] = current_value
        payload["unrealized_pnl"] = current_value - trade.stake
    else:
        payload["mark_price"] = trade.exit_price
        payload["current_value"] = trade.shares_count * trade.exit_price if trade.exit_price is not None else 0
        payload["unrealized_pnl"] = trade.pnl
    return payload


def settle_active_trade(reason: str = "window rollover") -> None:
    if not state.active_trade:
        return
    if state.active_trade.status != "OPEN":
        state.active_trade = None
        return
    if state.active_trade.window_id != str(active_window_bounds()[0]) or now_ms() >= int(state.active_trade.window_id) + 5 * 60 * 1000:
        won = (state.active_trade.direction == "UP" and state.current_price > state.active_trade.price_to_beat) or (state.active_trade.direction == "DOWN" and state.current_price < state.active_trade.price_to_beat)
        state.active_trade.status = "RESOLVED"
        state.active_trade.actual_outcome = "WIN" if won else "LOSS"
        state.active_trade.exit_price = 1.0 if won else 0.0
        payout = state.active_trade.shares_count if won else 0
        state.active_trade.pnl = payout - state.active_trade.stake
        state.settings.balance += payout
        persist_trade(state.active_trade)
        save_setting("balance", state.settings.balance)
        log("TRADE", f"Resolved {state.active_trade.direction}: {'WIN' if won else 'LOSS'} for {state.active_trade.pnl:+.2f} ({reason}).")
        state.active_trade = None


async def maybe_trade() -> None:
    clear_stale_polymarket_window()
    settle_active_trade()
    if state.settings.bot_state != "running":
        return
    decision = compute_decision()
    start, end = active_window_bounds()
    window_id = str(start)

    if state.processed_window_id == window_id or state.active_trade:
        return

    if decision["action"] == "ENTER" and decision["direction"] in ("UP", "DOWN"):
        direction = decision["direction"]
        ask = state.up_ask if direction == "UP" else state.down_ask
        stake = min(state.settings.stake_amount, state.settings.max_trade_amount, state.settings.balance)
        fee = stake * state.settings.taker_fee_rate
        net = max(0, stake - fee)
        shares = net / ask if ask > 0 else 0
        trade = Trade(
            id=str(uuid.uuid4()),
            timestamp=now_ms(),
            window_id=window_id,
            direction=direction,
            status="OPEN",
            entry_price=ask,
            price_to_beat=state.price_to_beat,
            btc_entry_price=state.current_price,
            shares_count=shares,
            stake=stake,
            fee_paid=fee,
            forced_trade=decision["forced_trade"],
            reason=decision["reasons"][-1] if decision["reasons"] else "Entered by engine.",
        )
        state.history.append(trade)
        state.active_trade = trade
        state.processed_window_id = window_id
        state.settings.skipped_windows = 0
        state.settings.balance -= stake
        persist_trade(trade)
        save_setting("balance", state.settings.balance)
        save_setting("skipped_windows", state.settings.skipped_windows)
        log("TRADE", f"Entered {direction} at {ask * 100:.1f}c with ${stake:.2f}. {trade.reason}")
    else:
        if (end - now_ms()) <= 120_000:
            state.processed_window_id = window_id
            state.settings.skipped_windows += 1
            save_setting("skipped_windows", state.settings.skipped_windows)
            log("INFO", f"Skipped window {window_id}. {decision.get('no_trade_reason') or decision['reasons'][-1]}")


async def worker_loop() -> None:
    log("INFO", "Poly5m engine online. Waiting for bot start.")
    while True:
        current = time.time()
        if current - state.last_binance_rest_sync >= 2.0:
            state.last_binance_rest_sync = current
            await sync_binance()
        if current - state.last_chainlink_sync >= 1.0:
            state.last_chainlink_sync = current
            await sync_chainlink_reference()
        if current - state.last_polymarket_sync >= 1.0:
            state.last_polymarket_sync = current
            await sync_polymarket_hint()
        await maybe_trade()
        await asyncio.sleep(0.2)


async def binance_ws_loop() -> None:
    while True:
        try:
            async with websockets.connect("wss://stream.binance.com:9443/ws/btcusdt@trade", ping_interval=20, ping_timeout=20) as ws:
                log("INFO", "Binance BTCUSDT WebSocket connected.")
                async for raw in ws:
                    msg = json.loads(raw)
                    price = float(msg.get("p", 0) or 0)
                    if price:
                        if state.chainlink_status != "live":
                            state.indicator_price = price
                        if REFERENCE_MODE == "binance" and state.chainlink_status != "live":
                            state.current_price = price
                            state.reference_source = "Binance BTCUSDT WebSocket"
        except Exception as exc:
            log("WARN", f"Binance WebSocket reconnecting: {exc}")
            await asyncio.sleep(5)


@app.on_event("startup")
async def startup() -> None:
    load_persistent_state()
    asyncio.create_task(worker_loop())
    asyncio.create_task(binance_ws_loop())
    asyncio.create_task(polymarket_rtds_loop())


@app.get("/api/health")
async def health():
    return {"ok": True, "service": "poly5m-engine", "time": now_ms()}


@app.get("/api/status")
async def status():
    return dashboard_payload()


@app.get("/api/stream")
async def stream():
    async def events():
        while True:
            payload = {
                "status": dashboard_payload(),
                "candles": state.candles[-180:],
                "history": [trade_payload(t) for t in reversed(state.history[-100:])],
                "logs": list(reversed(state.logs[-100:])),
                "server_time": now_ms(),
            }
            yield f"data: {json.dumps(payload, separators=(',', ':'))}\n\n"
            await asyncio.sleep(0.1)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/candles")
async def candles():
    return state.candles


@app.get("/api/history")
async def history():
    return [trade_payload(t) for t in reversed(state.history[-100:])]


@app.get("/api/logs")
async def logs():
    return list(reversed(state.logs[-100:]))


@app.get("/api/streak")
async def streak():
    resolved = [t for t in state.history if t.status == "RESOLVED"]
    a = analytics()
    last20 = [{"outcome": t.actual_outcome, "timestamp": t.timestamp} for t in resolved[-20:] if t.actual_outcome]
    best = worst = cur = 0
    for t in resolved:
        if t.actual_outcome == "WIN":
            cur = cur + 1 if cur >= 0 else 1
        elif t.actual_outcome == "LOSS":
            cur = cur - 1 if cur <= 0 else -1
        best = max(best, cur)
        worst = min(worst, cur)
    return {"currentStreak": a["current_streak"], "bestWinStreak": best, "worstLossStreak": worst, "last20": last20, "totalResolved": len(resolved)}


@app.post("/api/backtests/run")
async def run_backtest():
    resolved = [t for t in state.history if t.status == "RESOLVED"]
    normal = [t for t in resolved if not t.forced_trade]
    forced = [t for t in resolved if t.forced_trade]
    wins = len([t for t in resolved if t.actual_outcome == "WIN"])
    pnl = sum(t.pnl for t in resolved)
    run_id = str(uuid.uuid4())
    notes = {
        "normal_trades": len(normal),
        "forced_trades": len(forced),
        "normal_pnl": sum(t.pnl for t in normal),
        "forced_pnl": sum(t.pnl for t in forced),
        "message": "Backtest foundation currently replays stored paper outcomes; tick replay can be added once historical Chainlink/orderbook snapshots accumulate.",
    }
    with db() as con:
        con.execute(
            "INSERT INTO backtest_runs(id, timestamp, windows, trades, win_rate, pnl, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (run_id, now_ms(), len({t.window_id for t in resolved}), len(resolved), (wins / len(resolved) * 100) if resolved else 0, pnl, json.dumps(notes)),
        )
    return {"id": run_id, "timestamp": now_ms(), "windows": len({t.window_id for t in resolved}), "trades": len(resolved), "win_rate": (wins / len(resolved) * 100) if resolved else 0, "pnl": pnl, "notes": notes}


@app.get("/api/backtests")
async def backtests():
    with db() as con:
        rows = con.execute("SELECT * FROM backtest_runs ORDER BY timestamp DESC LIMIT 50").fetchall()
    return [{**dict(r), "notes": json.loads(r["notes"])} for r in rows]


@app.post("/api/control")
async def control(body: ControlBody):
    if body.action == "start":
        state.settings.bot_state = "running"
        save_setting("bot_state", state.settings.bot_state)
        log("INFO", "Bot started. It may enter from 5:00 to 2:00 remaining and cannot skip three windows in a row.")
    elif body.action == "stop":
        state.settings.bot_state = "stopped"
        save_setting("bot_state", state.settings.bot_state)
        log("INFO", "Bot stopped by owner.")
    elif body.action == "emergency_stop":
        state.settings.bot_state = "emergency_stopped"
        save_setting("bot_state", state.settings.bot_state)
        log("WARN", "Emergency stop activated.")
    elif body.action == "reset":
        with db() as con:
            con.execute("DELETE FROM trades")
            con.execute("DELETE FROM windows")
        state.history.clear()
        state.active_trade = None
        state.settings.balance = state.settings.starting_balance
        state.settings.skipped_windows = 0
        state.processed_window_id = ""
        save_setting("balance", state.settings.balance)
        save_setting("skipped_windows", state.settings.skipped_windows)
        log("INFO", "Stats, balance, active trade, and cadence counter reset.")
    return {"ok": True, "settings": state.settings.__dict__}


@app.post("/api/settings")
async def settings(body: SettingsBody):
    for key, value in body.model_dump(exclude_none=True).items():
        setattr(state.settings, key, value)
        save_setting(key, value)
    state.settings.stake_amount = max(1, state.settings.stake_amount)
    state.settings.max_trade_amount = max(state.settings.stake_amount, state.settings.max_trade_amount)
    save_setting("stake_amount", state.settings.stake_amount)
    save_setting("max_trade_amount", state.settings.max_trade_amount)
    log("INFO", "Settings updated.")
    return {"ok": True, "settings": state.settings.__dict__}
