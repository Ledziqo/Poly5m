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
ENTRY_MIN_ELAPSED_SECONDS = 40
ENTRY_FORCE_SECONDS = 125
FORCED_EDGE_FLOOR = -0.006
FORCED_MIN_CONFIDENCE = 68


def now_ms() -> int:
    return int(time.time() * 1000)


def current_window_bounds(ts: int | None = None) -> tuple[int, int]:
    ts = ts or now_ms()
    five = 5 * 60 * 1000
    start = (ts // five) * five
    return start, start + five


def active_window_bounds() -> tuple[int, int]:
    current_time = polymarket_now_ms() if "state" in globals() and state.chainlink_status == "live" else now_ms()
    fallback_start, fallback_end = current_window_bounds(current_time)
    if state.pm_window_end and state.pm_window_end > current_time - 5_000:
        return state.pm_window_start or state.pm_window_end - 5 * 60 * 1000, state.pm_window_end
    return fallback_start, fallback_end


def clear_stale_polymarket_window() -> None:
    current_time = polymarket_now_ms() if "state" in globals() and state.chainlink_status == "live" else now_ms()
    if state.pm_window_end and current_time > state.pm_window_end + 5_000:
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
        state.price_to_beat_distance_ms = 10**12
        if old_slug:
            log("INFO", f"Rolled past expired Polymarket window {old_slug}; waiting for the next BTC 5m market.")


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def normal_cdf(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def logit(p: float) -> float:
    p = clamp(p, 0.01, 0.99)
    return math.log(p / (1 - p))


def sigmoid(x: float) -> float:
    return 1 / (1 + math.exp(-clamp(x, -12, 12)))


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
    entry_features: dict = field(default_factory=dict)


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
    price_to_beat_distance_ms: int = 10**12
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
    gamma_up_price: float = 0.5
    gamma_down_price: float = 0.5
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
    last_chainlink_price_timestamp: int = 0
    polymarket_clock_offset_ms: int = 0
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


def polymarket_now_ms() -> int:
    return now_ms() + state.polymarket_clock_offset_ms


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
          reason TEXT NOT NULL,
          entry_features TEXT NOT NULL DEFAULT '{}'
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
        CREATE TABLE IF NOT EXISTS learning_samples (
          trade_id TEXT PRIMARY KEY,
          timestamp INTEGER NOT NULL,
          direction TEXT NOT NULL,
          outcome TEXT NOT NULL,
          forced_trade INTEGER NOT NULL,
          pnl REAL NOT NULL,
          tags TEXT NOT NULL,
          features TEXT NOT NULL
        );
        """)
        columns = {row["name"] for row in con.execute("PRAGMA table_info(trades)").fetchall()}
        if "entry_features" not in columns:
            con.execute("ALTER TABLE trades ADD COLUMN entry_features TEXT NOT NULL DEFAULT '{}'")


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
                entry_features=json.loads(r["entry_features"] or "{}"),
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
              btc_entry_price,shares_count,stake,fee_paid,pnl,actual_outcome,forced_trade,reason,entry_features
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                trade.id, trade.timestamp, trade.window_id, trade.direction, trade.status,
                trade.entry_price, trade.exit_price, trade.price_to_beat, trade.btc_entry_price,
                trade.shares_count, trade.stake, trade.fee_paid, trade.pnl, trade.actual_outcome,
                1 if trade.forced_trade else 0, trade.reason, json.dumps(trade.entry_features, separators=(",", ":")),
            ),
        )


def persist_learning_sample(trade: Trade) -> None:
    if trade.status != "RESOLVED" or trade.actual_outcome not in ("WIN", "LOSS"):
        return
    features = trade.entry_features or {}
    tags = features.get("tags") or []
    with db() as con:
        con.execute(
            """
            INSERT OR REPLACE INTO learning_samples(
              trade_id,timestamp,direction,outcome,forced_trade,pnl,tags,features
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                trade.id,
                trade.timestamp,
                trade.direction,
                trade.actual_outcome,
                1 if trade.forced_trade else 0,
                trade.pnl,
                json.dumps(tags, separators=(",", ":")),
                json.dumps(features, separators=(",", ":")),
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
    if timestamp_ms < state.last_chainlink_price_timestamp:
        maybe_capture_price_to_beat(price, timestamp_ms)
        return
    state.last_chainlink_price_timestamp = timestamp_ms
    state.chainlink_price = price
    state.current_price = price
    state.indicator_price = price
    state.chainlink_status = "live"
    state.reference_source = "Polymarket Chainlink BTC/USD"
    update_reference_candle(price, timestamp_ms)
    maybe_capture_price_to_beat(price, timestamp_ms)


def apply_polymarket_chainlink_snapshot(points: list[dict]) -> None:
    clean = []
    for point in points:
        try:
            clean.append((int(point["timestamp"]), float(point["value"])))
        except Exception:
            continue
    if not clean:
        return
    clean.sort(key=lambda item: item[0])
    for ts, price in clean:
        update_reference_candle(price, ts)
        maybe_capture_price_to_beat(price, ts)
    latest_ts, latest_price = clean[-1]
    apply_polymarket_chainlink_price(latest_price, latest_ts)


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
    distance = abs(timestamp_ms - state.pm_window_start)
    if state.pm_window_start - 5_000 <= timestamp_ms <= state.pm_window_start + 10_000:
        state.price_to_beat = price
        state.price_to_beat_source = "polymarket"
        state.price_to_beat_window_id = window_id
        state.price_to_beat_distance_ms = distance
        log("INFO", f"Captured Polymarket Chainlink price-to-beat ${price:.2f} at {timestamp_ms} for {state.pm_event_slug or window_id}.")


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
                    if msg.get("timestamp"):
                        state.polymarket_clock_offset_ms = int(msg["timestamp"]) - now_ms()
                    if isinstance(payload.get("data"), list):
                        apply_polymarket_chainlink_snapshot(payload["data"])
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
        start, _ = current_window_bounds(polymarket_now_ms() if state.chainlink_status == "live" else now_ms())
        slug = f"btc-updown-5m-{start // 1000}"
        event = None
        try:
            event = await fetch_json(f"https://gamma-api.polymarket.com/events/slug/{slug}", 8.0)
        except Exception:
            events = await fetch_json("https://gamma-api.polymarket.com/events?active=true&closed=false&limit=500&order=end_date&ascending=true", 10.0)
            candidates = [e for e in events if "btc-updown-5m" in str(e.get("slug", "")).lower()]
            now = polymarket_now_ms() if state.chainlink_status == "live" else now_ms()

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
            state.price_to_beat_distance_ms = 10**12
        parse_market_tokens(market)
        parsed_strike = parse_price_to_beat(event, market)
        if parsed_strike:
            state.price_to_beat = parsed_strike
            state.price_to_beat_source = "polymarket"
            state.price_to_beat_window_id = str(state.pm_window_start or "")
            state.price_to_beat_distance_ms = 0
        prices = market.get("outcomePrices") or []
        if isinstance(prices, str):
            prices = json.loads(prices)
        liquidity = float(market.get("liquidityNum") or market.get("liquidity") or 0)
        if len(prices) >= 2:
            state.gamma_up_price = clamp(float(prices[0]), 0.01, 0.99)
            state.gamma_down_price = clamp(float(prices[1]), 0.01, 0.99)
            state.liquidity = liquidity
            if REFERENCE_MODE == "binance":
                state.reference_source = "Polymarket Chainlink BTC/USD + Polymarket CLOB"
            else:
                state.reference_source = "Polymarket Chainlink BTC/USD + Polymarket CLOB" if state.chainlink_status == "live" else state.reference_source
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
    outcomes = parse_jsonish(market.get("outcomes") or market.get("shortOutcomes") or ["Up", "Down"])
    token_rows = parse_jsonish(market.get("tokens") or market.get("outcomeTokens") or [])
    if (not isinstance(token_ids, list) or len(token_ids) < 2) and isinstance(token_rows, list):
        token_ids = []
        outcomes = []
        for row in token_rows:
            if not isinstance(row, dict):
                continue
            token = row.get("token_id") or row.get("tokenId") or row.get("clobTokenId") or row.get("id")
            outcome = row.get("outcome") or row.get("name") or row.get("title")
            if token:
                token_ids.append(str(token))
                outcomes.append(str(outcome or ""))
    if isinstance(token_ids, list) and len(token_ids) >= 2:
        pairs = list(zip([str(o).lower() for o in outcomes], [str(t) for t in token_ids]))
        up = next((t for o, t in pairs if "up" in o or "yes" in o), token_ids[0])
        down = next((t for o, t in pairs if "down" in o or "no" in o), token_ids[1])
        state.up_token_id = str(up)
        state.down_token_id = str(down)


def book_best(book: dict) -> tuple[float, float, float]:
    bids = book.get("bids") or []
    asks = book.get("asks") or []

    def level(row, default_price: float) -> tuple[float, float]:
        if isinstance(row, dict):
            return float(row.get("price", default_price) or default_price), float(row.get("size", 0) or 0)
        if isinstance(row, (list, tuple)) and len(row) >= 2:
            return float(row[0] or default_price), float(row[1] or 0)
        return default_price, 0.0

    bid_levels = sorted([level(x, 0) for x in bids if x], reverse=True)
    ask_levels = sorted([level(x, 1) for x in asks if x])
    bid = bid_levels[0][0] if bid_levels else 0
    ask = ask_levels[0][0] if ask_levels else 1
    depth = sum(size for _, size in ask_levels[:8])
    return bid, ask, depth


async def sync_clob_books() -> None:
    if not state.up_token_id or not state.down_token_id:
        if state.pm_event_slug:
            log("WARN", f"Polymarket market found ({state.pm_event_slug}) but CLOB token ids are missing; using Gamma odds only.")
        return
    try:
        up_book, down_book = await asyncio.gather(
            fetch_json(f"https://clob.polymarket.com/book?token_id={state.up_token_id}", 6.0),
            fetch_json(f"https://clob.polymarket.com/book?token_id={state.down_token_id}", 6.0),
        )
        state.up_bid, state.up_ask, state.best_depth_up = book_best(up_book)
        state.down_bid, state.down_ask, state.best_depth_down = book_best(down_book)
        up_mid = clob_midpoint(state.up_bid, state.up_ask)
        down_mid = clob_midpoint(state.down_bid, state.down_ask)
        if up_mid is not None:
            state.up_price = up_mid
        else:
            state.up_price = state.gamma_up_price
        if down_mid is not None:
            state.down_price = down_mid
        else:
            state.down_price = state.gamma_down_price
        state.liquidity = max(state.liquidity, state.best_depth_up * state.up_ask + state.best_depth_down * state.down_ask)
        state.reference_source = "Polymarket Chainlink BTC/USD + Polymarket CLOB"
    except Exception as exc:
        log("WARN", f"CLOB orderbook degraded: {exc}")


def clob_midpoint(bid: float, ask: float) -> float | None:
    if 0.01 <= bid <= 0.99 and 0.01 <= ask <= 0.99 and ask >= bid:
        return clamp((bid + ask) / 2, 0.01, 0.99)
    if 0.01 <= ask <= 0.99:
        return clamp(ask, 0.01, 0.99)
    if 0.01 <= bid <= 0.99:
        return clamp(bid, 0.01, 0.99)
    return None


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
    learned = learning_rows(80)
    last = learned[-18:]
    direction_stats = {"UP": {"wins": 0, "total": 0}, "DOWN": {"wins": 0, "total": 0}}
    for row in last:
        if row["direction"] in direction_stats:
            direction_stats[row["direction"]]["total"] += 1
            if row["outcome"] == "WIN":
                direction_stats[row["direction"]]["wins"] += 1
    up_rate = direction_stats["UP"]["wins"] / direction_stats["UP"]["total"] if direction_stats["UP"]["total"] else 0.5
    down_rate = direction_stats["DOWN"]["wins"] / direction_stats["DOWN"]["total"] if direction_stats["DOWN"]["total"] else 0.5
    recent_bias = clamp((up_rate - down_rate) * 0.18, -0.12, 0.12)
    loss_streak = 0
    for row in reversed(learned):
        if row["outcome"] == "LOSS":
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
    smoothed = previous_bias * 0.82 + raw_bias * 0.18
    candidate = "UP" if smoothed > 0 else "DOWN"
    margin = abs(smoothed)
    edge_gap = abs(edge_up - edge_down)

    if candidate == previous_direction:
        state.brain_signal_age = min(8, state.brain_signal_age + 1)
    else:
        state.brain_signal_age = 1

    required_margin = 0.078
    if previous_direction in ("UP", "DOWN") and candidate != previous_direction:
        required_margin = 0.145

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

    confidence = int(clamp(38 + margin * 205 + edge_gap * 760 + min(abs(micro_momentum), 2.2) * 7 + state.brain_signal_age * 2, 8, 86))
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


def bucket(value: float, cuts: list[float], labels: list[str]) -> str:
    for cut, label in zip(cuts, labels):
        if value < cut:
            return label
    return labels[-1]


def setup_tags(direction: str, confidence: int, forced: bool, read: dict, indicators: dict, distance: float, time_left: float, spread: float, liquidity: float, entry_price: float) -> list[str]:
    dist_abs = abs(distance) * 100
    tags = [
        f"side:{direction}",
        f"forced:{1 if forced else 0}",
        f"regime:{read['regime']}",
        f"conf:{bucket(confidence, [45, 60, 72, 84], ['very_low', 'low', 'mid', 'high', 'elite'])}",
        f"time:{bucket(time_left, [195, 225, 255, 285], ['force_zone', 'late_analysis', 'mid_analysis', 'early_analysis', 'open'])}",
        f"distance:{bucket(dist_abs, [0.015, 0.04, 0.09, 0.18], ['touching', 'near', 'medium', 'far', 'stretched'])}",
        f"spread:{bucket(spread * 100, [1.5, 3.0, 5.0], ['tight', 'normal', 'wide', 'bad'])}",
        f"liquidity:{bucket(liquidity, [2500, 10000, 35000], ['thin', 'normal', 'deep', 'very_deep'])}",
        f"odds:{bucket(entry_price, [0.35, 0.55, 0.72], ['cheap', 'fair', 'favorite', 'expensive'])}",
    ]
    if indicators["rsi"] > 72:
        tags.append("rsi:hot")
    elif indicators["rsi"] < 28:
        tags.append("rsi:cold")
    else:
        tags.append("rsi:neutral")
    tags.append("agreement:strong" if abs(read["agreement"]) >= 4 else "agreement:mixed")
    return tags


def learning_rows(limit: int = 700) -> list[dict]:
    rows: list[dict] = []
    try:
        with db() as con:
            fetched = con.execute(
                "SELECT * FROM learning_samples ORDER BY timestamp DESC LIMIT ?",
                (limit,),
            ).fetchall()
        for row in fetched:
            rows.append({
                "id": row["trade_id"],
                "timestamp": row["timestamp"],
                "direction": row["direction"],
                "outcome": row["outcome"],
                "forced": bool(row["forced_trade"]),
                "pnl": row["pnl"],
                "tags": json.loads(row["tags"] or "[]"),
                "features": json.loads(row["features"] or "{}"),
            })
    except Exception:
        pass

    known = {row["id"] for row in rows}
    for trade in reversed(state.history[-limit:]):
        if trade.id in known or trade.status != "RESOLVED" or trade.actual_outcome not in ("WIN", "LOSS"):
            continue
        rows.append({
            "id": trade.id,
            "timestamp": trade.timestamp,
            "direction": trade.direction,
            "outcome": trade.actual_outcome,
            "forced": bool(trade.forced_trade),
            "pnl": trade.pnl,
            "tags": (trade.entry_features or {}).get("tags", []),
            "features": trade.entry_features or {},
        })
    rows.sort(key=lambda item: item["timestamp"])
    return rows[-limit:]


def learned_rate(tag: str, direction: str | None = None, forced: bool | None = None, limit: int = 700) -> dict:
    sample = []
    for row in learning_rows(limit):
        if tag not in row.get("tags", []):
            continue
        if direction and row["direction"] != direction:
            continue
        if forced is not None and bool(row["forced"]) != forced:
            continue
        sample.append(row)
    wins = len([row for row in sample if row["outcome"] == "WIN"])
    total = len(sample)
    rate = wins / total if total else 0.5
    confidence = min(1.0, total / 24)
    return {"wins": wins, "total": total, "rate": rate, "confidence": confidence}


def learning_adjustment(direction: str, confidence: int, forced: bool, read: dict, indicators: dict, distance: float, time_left: float, spread: float, liquidity: float, entry_price: float) -> dict:
    tags = setup_tags(direction, confidence, forced, read, indicators, distance, time_left, spread, liquidity, entry_price)
    weighted = 0.0
    weight_total = 0.0
    tag_reads = []
    for tag in tags:
        stat = learned_rate(tag, direction=direction, forced=forced)
        if stat["total"] < 3:
            continue
        miss_penalty = 1.35 if stat["rate"] < 0.5 else 1.0
        edge = (stat["rate"] - 0.5) * stat["confidence"] * miss_penalty
        weighted += edge
        weight_total += stat["confidence"]
        tag_reads.append({"tag": tag, **stat})
    learned_bias = clamp(weighted / weight_total if weight_total else 0.0, -0.22, 0.18)
    calibration = learned_rate(f"conf:{bucket(confidence, [45, 60, 72, 84], ['very_low', 'low', 'mid', 'high', 'elite'])}", direction=direction)
    return {
        "bias": learned_bias,
        "tags": tags,
        "tag_reads": tag_reads[:8],
        "calibrated_rate": calibration["rate"],
        "calibration_sample": calibration["total"],
    }


def similarity_memory(direction: str, read: dict, indicators: dict, distance: float, time_left: float, spread: float, entry_price: float, limit: int = 700) -> dict:
    rows = learning_rows(limit)
    scored = []
    current = {
        "regime": read["regime"],
        "distance": distance,
        "time_left": time_left,
        "spread": spread,
        "entry_price": entry_price,
        "rsi": indicators["rsi"],
        "ema_slope": indicators["ema_slope"],
        "vwap_distance": indicators["vwap_distance"],
        "volatility": indicators["volatility"],
    }
    for row in rows:
        if row["direction"] != direction:
            continue
        features = row.get("features") or {}
        row_indicators = features.get("indicators") or {}
        score = 0.0
        if features.get("regime") == current["regime"]:
            score += 2.2
        score += max(0.0, 1.4 - abs(float(features.get("distance", 0)) - current["distance"]) * 8000)
        score += max(0.0, 1.2 - abs(float(features.get("time_left", 0)) - current["time_left"]) / 80)
        score += max(0.0, 1.0 - abs(float(features.get("spread", 0)) - current["spread"]) * 24)
        score += max(0.0, 0.9 - abs(float(features.get("entry_price", 0.5)) - current["entry_price"]) * 3.2)
        score += max(0.0, 0.8 - abs(float(row_indicators.get("rsi", 50)) - current["rsi"]) / 48)
        score += max(0.0, 0.8 - abs(float(row_indicators.get("ema_slope", 0)) - current["ema_slope"]) * 900)
        score += max(0.0, 0.8 - abs(float(row_indicators.get("vwap_distance", 0)) - current["vwap_distance"]) * 620)
        score += max(0.0, 0.6 - abs(float(row_indicators.get("volatility", 0.001)) - current["volatility"]) * 260)
        if score >= 2.2:
            scored.append((score, row))
    scored.sort(key=lambda item: item[0], reverse=True)
    matches = scored[:36]
    if not matches:
        return {"rate": 0.5, "sample": 0, "bias": 0.0, "description": "no close historical matches yet"}
    weight_total = sum(score for score, _ in matches)
    win_weight = sum(score for score, row in matches if row["outcome"] == "WIN")
    rate = win_weight / weight_total if weight_total else 0.5
    avg_pnl = sum(row["pnl"] * score for score, row in matches) / weight_total if weight_total else 0.0
    bias = clamp((rate - 0.5) * min(1.0, len(matches) / 18) + clamp(avg_pnl / max(1, state.settings.stake_amount), -0.12, 0.12), -0.22, 0.20)
    return {
        "rate": rate,
        "sample": len(matches),
        "bias": bias,
        "description": f"{rate * 100:.0f}% over {len(matches)} similar {direction} setups",
    }


def multi_vote_brain(best_side: str, fair_up: float, fair_down: float, learned_edge_up: float, learned_edge_down: float, selected_learning: dict, read: dict, indicators: dict, memory: dict, bayes: dict, distance: float, time_left: float, spread: float, liquidity: float, selected_entry_price: float) -> dict:
    side_sign = 1 if best_side == "UP" else -1
    trend_vote = clamp(
        (
            clamp(indicators["ema_slope"] * 480, -0.32, 0.32)
            + clamp(indicators["vwap_distance"] * 310, -0.28, 0.28)
            + clamp(returns(60) * 850, -0.30, 0.30)
            + clamp(returns(180) * 280, -0.24, 0.24)
            + clamp(indicators["acceleration"] * 760, -0.22, 0.22)
        ) * side_sign,
        -1.0,
        1.0,
    )
    exhaustion_against_up = 0.0
    if indicators["rsi"] > 74:
        exhaustion_against_up -= 0.34
    elif indicators["rsi"] < 26:
        exhaustion_against_up += 0.34
    if time_left < 140 and abs(distance) > 0.00055:
        exhaustion_against_up += -0.18 if distance > 0 else 0.18
    reversal_vote = clamp(exhaustion_against_up * side_sign, -1.0, 1.0)
    market_prior = bayes["market_up"] if best_side == "UP" else 1 - bayes["market_up"]
    edge = learned_edge_up if best_side == "UP" else learned_edge_down
    market_vote = clamp((market_prior - selected_entry_price) * 3.0 + edge * 4.2 - spread * 1.6 + clamp((liquidity - 2500) / 18000, -0.15, 0.18), -1.0, 1.0)
    memory_vote = clamp(selected_learning["bias"] * 3.2 + (selected_learning["calibrated_rate"] - 0.5) * min(1, selected_learning["calibration_sample"] / 18) + memory["recent_bias"] * side_sign, -1.0, 1.0)
    risk_vote = 0.0
    risk_vote -= clamp((indicators["volatility"] - 0.0016) * 155, 0.0, 0.35)
    risk_vote -= clamp((read["chop_penalty"] - 0.8) * 0.16, 0.0, 0.32)
    risk_vote -= clamp((spread - 0.026) * 5.5, 0.0, 0.35)
    risk_vote -= 0.06 * min(5, memory["loss_streak"])
    risk_vote -= clamp((selected_entry_price - 0.70) * 0.9, 0.0, 0.22)
    vote_score = trend_vote * 0.24 + reversal_vote * 0.13 + market_vote * 0.27 + memory_vote * 0.20 + risk_vote * 0.16
    conviction = int(clamp(50 + vote_score * 48 + max(0, edge) * 360 - max(0, -edge) * 460, 0, 100))

    support = []
    risks = []
    if trend_vote > 0.12:
        support.append(f"trend vote supports {best_side} ({trend_vote:+.2f})")
    elif trend_vote < -0.12:
        risks.append(f"trend vote fights {best_side} ({trend_vote:+.2f})")
    if reversal_vote > 0.10:
        support.append(f"reversal/extension read supports {best_side}")
    elif reversal_vote < -0.10:
        risks.append("reversal risk is elevated")
    if market_vote > 0.10:
        support.append(f"market/fee vote is positive ({market_vote:+.2f})")
    elif market_vote < -0.10:
        risks.append("market odds already price in too much of the move")
    if memory_vote > 0.08:
        support.append(f"memory supports this bucket ({selected_learning['calibrated_rate'] * 100:.0f}% calibrated)")
    elif memory_vote < -0.08:
        risks.append(f"memory is weak for this bucket ({selected_learning['calibrated_rate'] * 100:.0f}% calibrated)")
    if risk_vote < -0.12:
        risks.append("risk vote penalizes volatility/spread/chop")
    if not support:
        support.append("no single vote dominates; waiting for cleaner agreement")
    if not risks:
        risks.append("no major risk warning beyond normal 5m variance")

    regime_label = {
        "aligned-trend": "trend",
        "choppy": "chop",
        "exhaustion-risk": "reversal",
        "late-window": "late pressure",
    }.get(read["regime"], "mixed")
    return {
        "votes": {
            "trend": trend_vote,
            "reversal": reversal_vote,
            "market": market_vote,
            "memory": memory_vote,
            "risk": risk_vote,
        },
        "conviction": conviction,
        "supporting_signals": support[:3],
        "risk_warnings": risks[:3],
        "regime": regime_label,
        "loss_guard": "active" if memory["loss_streak"] else "clear",
    }


def recommended_stake(conviction: int, memory: dict, read: dict, indicators: dict, spread: float, similar: dict, selected_entry_price: float) -> tuple[float, list[str]]:
    multiplier = 1.0
    reasons = []
    if conviction >= 84:
        multiplier += 0.16
        reasons.append("high conviction allows normal-plus stake")
    elif conviction < 72:
        multiplier -= 0.25
        reasons.append("conviction below strong threshold reduces stake")
    if memory["loss_streak"]:
        reduction = min(0.45, memory["loss_streak"] * 0.12)
        multiplier -= reduction
        reasons.append(f"loss guard reduces stake by {reduction * 100:.0f}%")
    if read["regime"] in ("choppy", "exhaustion-risk"):
        multiplier -= 0.16
        reasons.append(f"{read['regime']} regime reduces stake")
    if indicators["volatility"] > 0.0024:
        multiplier -= 0.12
        reasons.append("high volatility reduces stake")
    if spread > 0.04:
        multiplier -= 0.18
        reasons.append("wide spread reduces stake")
    if selected_entry_price > 0.72:
        multiplier -= 0.10
        reasons.append("expensive odds reduce stake")
    if similar["sample"] >= 8 and similar["rate"] < 0.48:
        multiplier -= 0.22
        reasons.append("similar setups have underperformed")
    multiplier = clamp(multiplier, 0.35, 1.15)
    stake = min(state.settings.max_trade_amount, state.settings.stake_amount * multiplier, state.settings.balance)
    return max(1.0, stake), reasons[:3] or ["standard stake"]


def bayesian_market_probability(model_up: float, indicators: dict, read: dict, distance: float, time_left: float) -> dict:
    up_mid = clob_midpoint(state.up_bid, state.up_ask) or state.up_price or 0.5
    down_mid = clob_midpoint(state.down_bid, state.down_ask) or state.down_price or 0.5
    market_sum = max(0.01, up_mid + down_mid)
    market_up = clamp(up_mid / market_sum, 0.03, 0.97)
    market_conflict = abs(model_up - market_up)

    distance_vote = normal_cdf(distance / max(0.00018, indicators["volatility"] * math.sqrt(max(30, time_left) / 60)))
    agreement_vote = clamp(0.5 + read["agreement"] * 0.055, 0.18, 0.82)
    trend_vote = clamp(
        0.5
        + clamp(indicators["ema_slope"] * 360, -0.18, 0.18)
        + clamp(indicators["vwap_distance"] * 220, -0.16, 0.16)
        + clamp(indicators["acceleration"] * 620, -0.12, 0.12),
        0.08,
        0.92,
    )
    orderbook_vote = clamp(0.5 + indicators["orderbook_imbalance"] * 0.18, 0.22, 0.78)
    rsi = indicators["rsi"]
    reversal_vote = 0.5
    if rsi > 74:
        reversal_vote = 0.44
    elif rsi < 26:
        reversal_vote = 0.56

    model_weight = 0.42
    market_weight = 0.26
    distance_weight = 0.15
    agreement_weight = 0.08
    trend_weight = 0.06
    orderbook_weight = 0.03
    if read["regime"] == "choppy":
        market_weight += 0.10
        model_weight -= 0.08
        trend_weight -= 0.02
    elif read["regime"] == "aligned-trend":
        model_weight += 0.06
        trend_weight += 0.04
        market_weight -= 0.05
    if market_conflict > 0.24:
        market_weight += 0.08
        model_weight -= 0.06

    combined_logit = (
        logit(model_up) * model_weight
        + logit(market_up) * market_weight
        + logit(distance_vote) * distance_weight
        + logit(agreement_vote) * agreement_weight
        + logit(trend_vote) * trend_weight
        + logit(orderbook_vote) * orderbook_weight
        + logit(reversal_vote) * 0.03
    )
    combined_up = clamp(sigmoid(combined_logit), 0.03, 0.97)
    return {
        "up": combined_up,
        "down": 1 - combined_up,
        "market_up": market_up,
        "distance_vote": distance_vote,
        "agreement_vote": agreement_vote,
        "trend_vote": trend_vote,
        "orderbook_vote": orderbook_vote,
        "conflict": market_conflict,
    }


def entry_snapshot(direction: str, confidence: int, forced: bool, read: dict, indicators: dict, distance: float, time_left: float, spread: float, liquidity: float, entry_price: float, fair_up: float, fair_down: float, edge_up: float, edge_down: float, brain: dict, learning: dict, conviction: int = 0, recommended_stake_amount: float | None = None, similar: dict | None = None, votes: dict | None = None) -> dict:
    return {
        "direction": direction,
        "confidence": confidence,
        "forced": forced,
        "regime": read["regime"],
        "agreement": read["agreement"],
        "trend_strength": read["trend_strength"],
        "chop_penalty": read["chop_penalty"],
        "distance": distance,
        "time_left": time_left,
        "spread": spread,
        "liquidity": liquidity,
        "entry_price": entry_price,
        "fair_up": fair_up,
        "fair_down": fair_down,
        "edge_up": edge_up,
        "edge_down": edge_down,
        "brain_bias": brain["smoothed_bias"],
        "signal_age": brain["signal_age"],
        "indicators": indicators,
        "tags": learning["tags"],
        "learning_bias": learning["bias"],
        "calibrated_rate": learning["calibrated_rate"],
        "calibration_sample": learning["calibration_sample"],
        "conviction": conviction,
        "recommended_stake": recommended_stake_amount,
        "similar_rate": (similar or {}).get("rate"),
        "similar_sample": (similar or {}).get("sample"),
        "votes": votes or {},
    }


def loss_autopsy(trade: Trade) -> str:
    features = trade.entry_features or {}
    if trade.actual_outcome == "WIN":
        return "setup confirmed"
    if trade.forced_trade:
        return "forced entry carried weaker selectivity"
    if features.get("spread", 0) > 0.04:
        return "wide spread taxed the entry"
    if features.get("chop_penalty", 0) > 1.2:
        return "choppy regime reversed the read"
    if features.get("entry_price", 0) > 0.72:
        return "paid expensive favorite odds"
    if abs(features.get("distance", 0)) < 0.00015:
        return "price stayed too close to the beat line"
    if features.get("calibration_sample", 0) >= 8 and features.get("calibrated_rate", 0.5) < 0.48:
        return "historically weak setup bucket"
    return "direction lost after entry"


def compute_decision() -> dict:
    clear_stale_polymarket_window()
    start, end = active_window_bounds()
    current_time = polymarket_now_ms() if state.chainlink_status == "live" else now_ms()
    time_left = max(0, (end - current_time) / 1000)
    elapsed = 300 - time_left
    price = state.current_price
    strike = state.price_to_beat or price
    window_id = str(start)
    if not price or not strike:
        return wait_decision("Waiting for confirmed BTC price and price-to-beat.")

    has_chainlink = state.chainlink_status == "live" or REFERENCE_MODE == "binance"
    has_book_odds = bool(state.up_token_id and state.down_token_id and (state.best_depth_up > 0 or state.best_depth_down > 0))
    has_gamma_odds = state.liquidity > 0 and (abs(state.gamma_up_price - 0.5) > 0.015 or abs(state.gamma_down_price - 0.5) > 0.015)
    has_real_odds = bool(state.pm_event_slug and (has_book_odds or has_gamma_odds))
    if not has_chainlink:
        decision = wait_decision("Waiting for Chainlink/reference BTC/USD before trading.")
        decision["reasons"].append("Exchange price can update the chart, but entries require the configured reference source.")
        return decision
    if not has_real_odds:
        decision = wait_decision("Waiting for real Polymarket BTC 5m odds/liquidity before considering a trade.")
        decision["reasons"].append("Chainlink/reference is live, but the bot still needs the active BTC 5m event plus CLOB book depth or non-placeholder Gamma odds.")
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
    model_fair_up = clamp(normal_cdf(projected_finish / sigma), 0.03, 0.97)
    bayes = bayesian_market_probability(model_fair_up, indicators, read, distance, time_left)
    fair_up = bayes["up"]
    fair_down = bayes["down"]

    fee = state.settings.taker_fee_rate
    edge_up = fair_up - state.up_ask - fee
    edge_down = fair_down - state.down_ask - fee
    raw_side = "UP" if edge_up >= edge_down else "DOWN"
    agreement_bias = clamp(read["agreement"] * 0.035, -0.18, 0.18)
    raw_bias = clamp((edge_up - edge_down) * 1.6 + clamp(micro_momentum / 5.0, -0.45, 0.45) + memory["recent_bias"] + agreement_bias, -1.0, 1.0)
    force_now = time_left <= ENTRY_FORCE_SECONDS
    forced = force_now
    brain = brain_filter(raw_side, raw_bias, edge_up, edge_down, micro_momentum, window_id)
    spread = max(state.up_ask - state.up_bid, state.down_ask - state.down_bid)
    up_learning = learning_adjustment("UP", brain["confidence"], forced, read, indicators, distance, time_left, spread, state.liquidity, state.up_ask)
    down_learning = learning_adjustment("DOWN", brain["confidence"], forced, read, indicators, distance, time_left, spread, state.liquidity, state.down_ask)
    spread_penalty = clamp((spread - 0.02) * 1.15, 0.0, 0.08)
    thin_book_penalty = 0.025 if state.liquidity < 2500 else 0.0
    up_overpay_penalty = clamp((state.up_ask - 0.72) * 0.22, 0.0, 0.055)
    down_overpay_penalty = clamp((state.down_ask - 0.72) * 0.22, 0.0, 0.055)
    learned_edge_up = edge_up + up_learning["bias"] - spread_penalty - thin_book_penalty - up_overpay_penalty
    learned_edge_down = edge_down + down_learning["bias"] - spread_penalty - thin_book_penalty - down_overpay_penalty
    learned_side = "UP" if learned_edge_up >= learned_edge_down else "DOWN"
    best_side = brain["side"] if brain["side"] in ("UP", "DOWN") and not forced else learned_side
    if best_side == "UP" and learned_edge_down > learned_edge_up + 0.035:
        best_side = "DOWN"
    elif best_side == "DOWN" and learned_edge_up > learned_edge_down + 0.035:
        best_side = "UP"
    best_edge = learned_edge_up if best_side == "UP" else learned_edge_down
    raw_best_edge = max(edge_up, edge_down)
    selected_learning = up_learning if best_side == "UP" else down_learning
    selected_entry_price = state.up_ask if best_side == "UP" else state.down_ask
    similar = similarity_memory(best_side, read, indicators, distance, time_left, spread, selected_entry_price)
    selected_learning = {**selected_learning, "bias": clamp(selected_learning["bias"] + similar["bias"], -0.28, 0.22)}
    if best_side == "UP":
        learned_edge_up += similar["bias"]
        best_edge = learned_edge_up
    else:
        learned_edge_down += similar["bias"]
        best_edge = learned_edge_down
    vote_brain = multi_vote_brain(best_side, fair_up, fair_down, learned_edge_up, learned_edge_down, selected_learning, read, indicators, memory, bayes, distance, time_left, spread, state.liquidity, selected_entry_price)
    conviction = vote_brain["conviction"]
    stake_amount, stake_reasons = recommended_stake(conviction, memory, read, indicators, spread, similar, selected_entry_price)

    entry_window_open = elapsed >= ENTRY_MIN_ELAPSED_SECONDS and time_left > ENTRY_FORCE_SECONDS
    before_entry_window = elapsed < ENTRY_MIN_ELAPSED_SECONDS
    force_window_reached = time_left <= ENTRY_FORCE_SECONDS
    data_reasons = [
        f"Autonomous brain bias is {brain['smoothed_bias']:+.3f} after smoothing raw signal {brain['raw_bias']:+.3f}; current stable read is {brain['side']} with {brain['signal_age']} signal-memory ticks.",
        f"Market read is {read['regime']}: agreement score {read['agreement']:+d}/5, trend strength {read['trend_strength']:.2f}, chop pressure {read['chop_penalty']:.2f}.",
        f"Indicator stack: EMA slope {indicators['ema_slope'] * 100:+.3f}%, VWAP distance {indicators['vwap_distance'] * 100:+.3f}%, RSI {indicators['rsi']:.1f}, acceleration {indicators['acceleration'] * 100:+.3f}%, orderbook imbalance {indicators['orderbook_imbalance']:+.2f}.",
        f"Memory check: last {memory['sample']} resolved trades show UP {memory['up_rate'] * 100:.0f}% and DOWN {memory['down_rate'] * 100:.0f}% win rate; active loss streak is {memory['loss_streak']}.",
        f"Bayesian probability blends model {model_fair_up * 100:.0f}% UP with market prior {bayes['market_up'] * 100:.0f}% UP; conflict {bayes['conflict'] * 100:.0f}%, distance vote {bayes['distance_vote'] * 100:.0f}%, trend vote {bayes['trend_vote'] * 100:.0f}%.",
        f"Fee-adjusted raw edge is UP {edge_up * 100:+.2f}c and DOWN {edge_down * 100:+.2f}c; learned edge is UP {learned_edge_up * 100:+.2f}c and DOWN {learned_edge_down * 100:+.2f}c after spread/liquidity/overpay penalties.",
        f"Calibration read for {best_side}: historical bucket rate {selected_learning['calibrated_rate'] * 100:.0f}% over {selected_learning['calibration_sample']} matching confidence samples; similar-pattern memory says {similar['description']}.",
        f"Conviction score is {conviction}/100 from trend {vote_brain['votes']['trend']:+.2f}, reversal {vote_brain['votes']['reversal']:+.2f}, market {vote_brain['votes']['market']:+.2f}, memory {vote_brain['votes']['memory']:+.2f}, risk {vote_brain['votes']['risk']:+.2f}.",
        f"Recommended stake is ${stake_amount:.2f}: {', '.join(stake_reasons)}.",
        f"Entry discipline: preferred entry window is 4:20 to 2:05 remaining; late entries require stronger conviction and clean execution quality.",
    ]
    if brain["flip_blocked"]:
        data_reasons.append(f"Autonomous anti-noise guard held {brain['previous']} instead of chasing a weak {brain['candidate']} twitch.")
    if memory["loss_streak"] > 0:
        data_reasons.append(f"Learning adaptation is active: recent losses add stricter edge/confidence floors before another entry is allowed.")

    loss_caution = clamp(memory["loss_streak"] * 0.008, 0.0, 0.035)
    min_edge = {"safe": 0.025, "balanced": 0.012, "aggressive": 0.002}.get(state.settings.risk_mode, 0.012) + read["extra_edge_required"] + loss_caution
    confidence = brain["confidence"]
    if read["regime"] == "aligned-trend":
        confidence = min(92, confidence + 4)
    elif read["regime"] in ("choppy", "exhaustion-risk"):
        confidence = max(5, confidence - 7)
    if selected_learning["calibration_sample"] >= 8:
        confidence = int(clamp(confidence + (selected_learning["calibrated_rate"] - 0.5) * 36, 8, 94))
    if spread_penalty or thin_book_penalty or max(up_overpay_penalty, down_overpay_penalty):
        confidence = int(clamp(confidence - (spread_penalty + thin_book_penalty + (up_overpay_penalty if best_side == "UP" else down_overpay_penalty)) * 90, 8, 94))
    if bayes["conflict"] > 0.28 and read["regime"] != "aligned-trend":
        confidence = max(8, confidence - 8)
    min_confidence = {"safe": 82, "balanced": 76, "aggressive": 70}.get(state.settings.risk_mode, 76) + min(10, memory["loss_streak"] * 3)
    stable_enough = brain["side"] in ("UP", "DOWN") and brain["signal_age"] >= 3
    learned_penalty = memory["loss_streak"] >= 2 and not forced
    early_edge_floor = min_edge + {"safe": 0.020, "balanced": 0.014, "aggressive": 0.008}.get(state.settings.risk_mode, 0.014)
    conviction_floor = {"safe": 82, "balanced": 75, "aggressive": 68}.get(state.settings.risk_mode, 75) + min(10, memory["loss_streak"] * 3)

    def enrich(payload: dict) -> dict:
        payload.update({
            "conviction": conviction,
            "recommended_stake": stake_amount,
            "supporting_signals": vote_brain["supporting_signals"],
            "risk_warnings": vote_brain["risk_warnings"],
            "brain_state": {
                "regime": vote_brain["regime"],
                "learning_samples": len(learning_rows()),
                "similar_win_rate": similar["rate"],
                "similar_sample": similar["sample"],
                "loss_guard": vote_brain["loss_guard"],
                "votes": vote_brain["votes"],
                "stake_reasons": stake_reasons,
            },
        })
        return payload

    if before_entry_window and not state.active_trade:
        reason = "Collecting the opening ticks before placing this round's required trade."
        no_trade_reason = "Opening observation."
        return enrich({
            **base_decision("WAIT", fair_up, fair_down, edge_up, edge_down, best_edge, fee, False, 0, "WAIT"),
            "confidence": confidence,
            "reasons": data_reasons + [reason],
            "no_trade_reason": no_trade_reason,
            "entry_features": entry_snapshot(best_side, confidence, False, read, indicators, distance, time_left, spread, state.liquidity, selected_entry_price, fair_up, fair_down, edge_up, edge_down, brain, selected_learning, conviction, stake_amount, similar, vote_brain["votes"]),
        })

    force_blockers = []
    forced_edge_floor = FORCED_EDGE_FLOOR + loss_caution
    forced_confidence_floor = FORCED_MIN_CONFIDENCE + min(12, memory["loss_streak"] * 4)
    if best_edge < forced_edge_floor:
        force_blockers.append(f"best learned edge {best_edge * 100:+.2f}c is worse than the adaptive forced-entry floor {forced_edge_floor * 100:+.1f}c")
    if confidence < forced_confidence_floor:
        force_blockers.append(f"confidence {confidence}% is below the adaptive forced-entry floor {forced_confidence_floor}%")
    if conviction < conviction_floor:
        force_blockers.append(f"conviction {conviction}/100 is below the adaptive conviction floor {conviction_floor}/100")
    if read["regime"] == "choppy" and memory["loss_streak"] >= 1:
        force_blockers.append("market is choppy after a recent loss, so forcing would repeat the same failure pattern")
    if selected_entry_price > 0.74 and best_edge < 0.02:
        force_blockers.append(f"{best_side} ask is expensive at {selected_entry_price * 100:.1f}c without enough edge after fees")
    if spread > 0.055:
        force_blockers.append(f"spread is too wide at {spread * 100:.1f}c for a forced entry")
    if memory["loss_streak"] >= 2 and selected_learning["calibration_sample"] >= 5 and selected_learning["calibrated_rate"] < 0.48:
        force_blockers.append(f"learning memory says this setup bucket is weak: {selected_learning['calibrated_rate'] * 100:.0f}% over {selected_learning['calibration_sample']} samples")

    if force_window_reached and not state.active_trade and force_blockers:
        return enrich({
            **base_decision("WAIT", fair_up, fair_down, edge_up, edge_down, best_edge, fee, True, confidence, "WAIT"),
            "reasons": data_reasons + [f"Capital-protection skip at the 2:05 cutoff: {'; '.join(force_blockers)}."],
            "no_trade_reason": "Forced entry rejected by capital protection.",
            "lock_window": True,
            "entry_features": entry_snapshot(best_side, confidence, True, read, indicators, distance, time_left, spread, state.liquidity, selected_entry_price, fair_up, fair_down, edge_up, edge_down, brain, selected_learning, conviction, stake_amount, similar, vote_brain["votes"]),
        })

    if force_window_reached and not state.active_trade:
        return enrich({
            **base_decision(best_side, fair_up, fair_down, edge_up, edge_down, best_edge, fee, True, confidence, "ENTER"),
            "reasons": data_reasons + [f"Late cutoff entry allowed near 2:05 remaining. Selected {best_side} because it passed conviction, edge, confidence, spread, and price-quality floors."],
            "entry_features": entry_snapshot(best_side, confidence, True, read, indicators, distance, time_left, spread, state.liquidity, selected_entry_price, fair_up, fair_down, edge_up, edge_down, brain, selected_learning, conviction, stake_amount, similar, vote_brain["votes"]),
        })

    if not entry_window_open and not state.active_trade:
        if before_entry_window:
            reason = "Opening observation is still collecting pattern, momentum, and order-book confirmation."
            no_trade_reason = "Opening observation."
        else:
            reason = "No new entry allowed outside the configured decision window."
            no_trade_reason = "Outside entry window."
        return enrich({
            **base_decision("WAIT", fair_up, fair_down, edge_up, edge_down, best_edge, fee, forced, 0, "WAIT"),
            "confidence": confidence,
            "reasons": data_reasons + [reason],
            "no_trade_reason": no_trade_reason,
            "entry_features": entry_snapshot(best_side, confidence, forced, read, indicators, distance, time_left, spread, state.liquidity, selected_entry_price, fair_up, fair_down, edge_up, edge_down, brain, selected_learning, conviction, stake_amount, similar, vote_brain["votes"]),
        })

    if forced:
        if force_blockers:
            return enrich({
                **base_decision("WAIT", fair_up, fair_down, edge_up, edge_down, best_edge, fee, True, confidence, "WAIT"),
                "reasons": data_reasons + [f"Capital-protection skip: {'; '.join(force_blockers)}."],
                "no_trade_reason": "Forced entry rejected by capital protection.",
                "lock_window": True,
                "entry_features": entry_snapshot(best_side, confidence, True, read, indicators, distance, time_left, spread, state.liquidity, selected_entry_price, fair_up, fair_down, edge_up, edge_down, brain, selected_learning, conviction, stake_amount, similar, vote_brain["votes"]),
            })
        return enrich({
            **base_decision(best_side, fair_up, fair_down, edge_up, edge_down, best_edge, fee, True, confidence, "ENTER"),
            "reasons": data_reasons + [f"Cutoff entry selected {best_side}, the strongest available side that still passed capital-protection floors."],
            "entry_features": entry_snapshot(best_side, confidence, True, read, indicators, distance, time_left, spread, state.liquidity, selected_entry_price, fair_up, fair_down, edge_up, edge_down, brain, selected_learning, conviction, stake_amount, similar, vote_brain["votes"]),
        })

    if best_edge >= early_edge_floor and confidence >= min_confidence and conviction >= conviction_floor and stable_enough and not learned_penalty and entry_window_open:
        return enrich({
            **base_decision(best_side, fair_up, fair_down, edge_up, edge_down, best_edge, fee, False, confidence, "ENTER"),
            "reasons": data_reasons + [f"Selected {best_side} because learned edge beats {early_edge_floor * 100:.1f}c, confidence {confidence}% passes {min_confidence}%, conviction {conviction}/100 passes {conviction_floor}/100, and the signal persisted for 3 brain ticks."],
            "entry_features": entry_snapshot(best_side, confidence, False, read, indicators, distance, time_left, spread, state.liquidity, selected_entry_price, fair_up, fair_down, edge_up, edge_down, brain, selected_learning, conviction, stake_amount, similar, vote_brain["votes"]),
        })

    guard_reasons = []
    if best_edge < early_edge_floor:
        guard_reasons.append(f"learned edge {best_edge * 100:+.2f}c is below the stricter {early_edge_floor * 100:.1f}c early-entry threshold")
    if confidence < min_confidence:
        guard_reasons.append(f"confidence {confidence}% is below the {min_confidence}% risk-mode gate")
    if conviction < conviction_floor:
        guard_reasons.append(f"conviction {conviction}/100 is below the {conviction_floor}/100 trade-quality gate")
    if not stable_enough:
        guard_reasons.append("signal has not persisted for enough brain ticks")
    if learned_penalty:
        guard_reasons.append("recent loss streak raised the learning guard")
    guard_text = "; ".join(guard_reasons) if guard_reasons else "signal is not strong enough yet"
    return enrich({
        **base_decision("WAIT", fair_up, fair_down, edge_up, edge_down, best_edge, fee, False, confidence, "WAIT"),
        "reasons": data_reasons + [f"Waiting because {guard_text}; raw best edge is {raw_best_edge * 100:+.2f}c."],
        "no_trade_reason": "No fee-adjusted edge yet.",
        "entry_features": entry_snapshot(best_side, confidence, False, read, indicators, distance, time_left, spread, state.liquidity, selected_entry_price, fair_up, fair_down, edge_up, edge_down, brain, selected_learning, conviction, stake_amount, similar, vote_brain["votes"]),
    })


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
        "conviction": 0,
        "recommended_stake": state.settings.stake_amount,
        "supporting_signals": [],
        "risk_warnings": [],
        "brain_state": {
            "regime": "waiting",
            "learning_samples": len(learning_rows()),
            "similar_win_rate": 0.5,
            "similar_sample": 0,
            "loss_guard": "clear",
            "votes": {},
            "stake_reasons": [],
        },
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
        "learning_samples": len(learning_rows()),
    }


def window_payload() -> dict:
    clear_stale_polymarket_window()
    start, end = active_window_bounds()
    current_time = polymarket_now_ms() if state.chainlink_status == "live" else now_ms()
    return {
        "id": str(start),
        "title": "BTC Up or Down - 5m",
        "market_slug": state.pm_event_slug or f"btc-updown-5m-{start // 1000}",
        "round": time.strftime("%H:%M UTC", time.gmtime(start / 1000)),
        "status": "active",
        "window_start": start,
        "window_end": end,
        "price_to_beat": state.price_to_beat,
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
        "time_left_seconds": max(0, (end - current_time) / 1000),
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
    current_time = polymarket_now_ms() if state.chainlink_status == "live" else now_ms()
    if state.active_trade.window_id != str(active_window_bounds()[0]) or current_time >= int(state.active_trade.window_id) + 5 * 60 * 1000:
        won = (state.active_trade.direction == "UP" and state.current_price > state.active_trade.price_to_beat) or (state.active_trade.direction == "DOWN" and state.current_price < state.active_trade.price_to_beat)
        state.active_trade.status = "RESOLVED"
        state.active_trade.actual_outcome = "WIN" if won else "LOSS"
        state.active_trade.exit_price = 1.0 if won else 0.0
        payout = state.active_trade.shares_count if won else 0
        state.active_trade.pnl = payout - state.active_trade.stake
        state.settings.balance += payout
        persist_trade(state.active_trade)
        persist_learning_sample(state.active_trade)
        save_setting("balance", state.settings.balance)
        log("TRADE", f"Resolved {state.active_trade.direction}: {'WIN' if won else 'LOSS'} for {state.active_trade.pnl:+.2f} ({reason}). Autopsy: {loss_autopsy(state.active_trade)}.")
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
        stake = min(float(decision.get("recommended_stake") or state.settings.stake_amount), state.settings.max_trade_amount)
        if state.settings.balance < stake:
            log("WARN", f"Cannot enter {direction}: balance ${state.settings.balance:.2f} is below fixed stake ${stake:.2f}.")
            return
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
            entry_features=decision.get("entry_features") or {},
        )
        state.history.append(trade)
        state.active_trade = trade
        state.processed_window_id = window_id
        state.settings.skipped_windows = 0
        state.settings.balance -= stake
        persist_trade(trade)
        save_setting("balance", state.settings.balance)
        save_setting("skipped_windows", state.settings.skipped_windows)
        brain_state = decision.get("brain_state") or {}
        log("TRADE", f"Entered {direction} at {ask * 100:.1f}c with ${stake:.2f}. Conviction {decision.get('conviction', 0)}/100, regime {brain_state.get('regime', 'unknown')}. {trade.reason}")
    else:
        if decision.get("lock_window"):
            state.processed_window_id = window_id
            state.settings.skipped_windows += 1
            save_setting("skipped_windows", state.settings.skipped_windows)
            reason = decision.get("no_trade_reason") or (decision.get("reasons") or ["Capital-protection skip."])[-1]
            log("INFO", f"Skipped this BTC 5m round: {reason}")
        return


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
    all_trades = [{"outcome": t.actual_outcome, "timestamp": t.timestamp} for t in resolved if t.actual_outcome]
    last20 = all_trades[-20:]
    best = worst = cur = 0
    for t in resolved:
        if t.actual_outcome == "WIN":
            cur = cur + 1 if cur >= 0 else 1
        elif t.actual_outcome == "LOSS":
            cur = cur - 1 if cur <= 0 else -1
        best = max(best, cur)
        worst = min(worst, cur)
    return {
        "currentStreak": a["current_streak"],
        "bestWinStreak": best,
        "worstLossStreak": worst,
        "last20": last20,
        "trades": all_trades,
        "totalResolved": len(resolved),
    }


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
        log("INFO", "Bot started. Current round is eligible immediately if it passes live odds, confidence, edge, spread, and cutoff checks.")
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
        log("INFO", "Stats, balance, active trade, and cadence counter reset. Learning memory was preserved.")
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
