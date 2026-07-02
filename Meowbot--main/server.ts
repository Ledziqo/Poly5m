// ... imports
import express from 'express';
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import axios from 'axios';
import Parser from 'rss-parser';
import { GoogleGenAI } from '@google/genai';
import { RSI, MACD, BollingerBands, ATR, EMA, SMA, WilliamsR, WMA, ADX, StochasticRSI, ROC, OBV, MFI, CCI, Stochastic, IchimokuCloud, PSAR, KeltnerChannels, TRIX, ForceIndex, WEMA } from 'technicalindicators';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json()); // Enable JSON body parsing

const PORT = parseInt(process.env.PORT || '3000', 10);
const db = new Database('bot.db');
const rssParser = new Parser();

const botStartTime = Date.now();

// Database Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS candles (
    timestamp INTEGER PRIMARY KEY,
    open REAL,
    high REAL,
    low REAL,
    close REAL,
    volume REAL
  );
  CREATE TABLE IF NOT EXISTS predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER,
    resolution_time INTEGER,
    direction TEXT,
    confidence INTEGER,
    price_at_prediction REAL,
    actual_outcome TEXT,
    features_json TEXT,
    bet_stake REAL DEFAULT 0,
    payout_multiplier REAL DEFAULT 2.0,
    share_price REAL DEFAULT 0.5,
    shares_count REAL DEFAULT 0,
    status TEXT DEFAULT 'SKIPPED', -- OPEN, RESOLVED, SKIPPED, ERROR
    pnl REAL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE IF NOT EXISTS meta_weights (
    feature_index INTEGER PRIMARY KEY,
    weight REAL
  );
  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER,
    level TEXT,
    message TEXT
  );
  CREATE TABLE IF NOT EXISTS copy_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER,
    address TEXT,
    direction TEXT,
    market_slug TEXT,
    resolution_time INTEGER
  );
`);

// --- Migration: Ensure columns exist for existing tables ---
try {
  const tableInfo = db.prepare("PRAGMA table_info(predictions)").all() as any[];
  const columns = tableInfo.map(c => c.name);

  if (!columns.includes('bet_stake')) db.prepare("ALTER TABLE predictions ADD COLUMN bet_stake REAL DEFAULT 0").run();
  if (!columns.includes('payout_multiplier')) db.prepare("ALTER TABLE predictions ADD COLUMN payout_multiplier REAL DEFAULT 2.0").run();
  if (!columns.includes('share_price')) db.prepare("ALTER TABLE predictions ADD COLUMN share_price REAL DEFAULT 0.5").run();
  if (!columns.includes('shares_count')) db.prepare("ALTER TABLE predictions ADD COLUMN shares_count REAL DEFAULT 0").run();
  if (!columns.includes('status')) db.prepare("ALTER TABLE predictions ADD COLUMN status TEXT DEFAULT 'SKIPPED'").run();
  if (!columns.includes('pnl')) db.prepare("ALTER TABLE predictions ADD COLUMN pnl REAL DEFAULT 0").run();
  if (!columns.includes('resolution_time')) {
    db.prepare("ALTER TABLE predictions ADD COLUMN resolution_time INTEGER").run();
    // Backfill resolution_time for existing records (approx timestamp + 5m rounded)
    db.exec(`UPDATE predictions SET resolution_time = ((timestamp / 300000) + 1) * 300000 WHERE resolution_time IS NULL`);
  }
} catch (error) {
  console.error('Migration error:', error);
}

// Ensure 54 weights exist for the Meta Model (50 Technicals + 4 PolySight/Context)
const initWeights = db.transaction(() => {
  const count = db.prepare('SELECT COUNT(*) as c FROM meta_weights').get() as { c: number };
  if (count.c < 54) {
    db.prepare('DELETE FROM meta_weights').run();
    const stmt = db.prepare('INSERT INTO meta_weights (feature_index, weight) VALUES (?, ?)');
    for (let i = 0; i < 54; i++) {
      stmt.run(i, 0.0); // Start with 0.0 weights (neutral), model will learn fast
    }
  }
});
initWeights();

// Initialize Default Settings
const defaultSettings = {
  balance: '1000',
  stake_amount: '10',
  payout_mode: '2x_return', // '2x_return' (Profit=Stake) or '3x_return' (Profit=2*Stake)
  confidence_threshold: '60',
  is_running: 'false',
  no_trade_enabled: 'true',
  uptime_start_time: '0',
  copy_mode_enabled: 'false',
  copy_target_address: ''
};

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
Object.entries(defaultSettings).forEach(([key, value]) => insertSetting.run(key, value));

// --- Helpers ---

function logSystem(level: 'INFO' | 'WARN' | 'ERROR' | 'TRADE', message: string) {
  console.log(`[BOT] [${level}] ${message}`);
  db.prepare('INSERT INTO logs (timestamp, level, message) VALUES (?, ?, ?)').run(Date.now(), level, message);
}

function cleanJson(text: string) {
  return text.replace(/```json/g, '').replace(/```/g, '').trim();
}

function getSetting(key: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string };
  return row ? row.value : '';
}

function updateSetting(key: string, value: string) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

// --- Data Fetching ---

async function fetchCandles(limit = 100) {
  try {
    // Using KuCoin API to avoid Binance US restrictions on Render servers
    const response = await axios.get('https://api.kucoin.com/api/v1/market/candles', {
      params: {
        type: '1min',
        symbol: 'BTC-USDT'
      },
      timeout: 5000
    });

    // KuCoin returns: [time, open, close, high, low, volume, turnover]
    // Note: time is in SECONDS, needs to be multiplied by 1000 for JS
    let candles = response.data.data.map((c: any[]) => ({
      timestamp: parseInt(c[0]) * 1000,
      open: parseFloat(c[1]),
      close: parseFloat(c[2]),
      high: parseFloat(c[3]),
      low: parseFloat(c[4]),
      volume: parseFloat(c[5]),
    }));

    // KuCoin returns newest first, so we reverse to match previous behavior
    candles = candles.reverse();

    // Limit to requested amount
    return candles.slice(candles.length - limit);
  } catch (error) {
    console.error('Error fetching KuCoin candles:', error);
    return [];
  }
}

async function fetchNews() {
  try {
    const feed = await rssParser.parseURL('https://cointelegraph.com/rss');
    return feed.items.slice(0, 5).map(item => ({
      guid: item.guid || item.link,
      title: item.title,
      link: item.link,
      pubDate: item.pubDate,
    }));
  } catch (error) {
    console.error('Error fetching news:', error);
    return [];
  }
}

async function fetchFearAndGreed() {
  try {
    const response = await axios.get('https://api.alternative.me/fng/');
    const data = response.data.data[0];
    return {
      value: parseInt(data.value),
      classification: data.value_classification
    };
  } catch (error) {
    console.error('Error fetching Fear & Greed:', error);
    return { value: 50, classification: 'Neutral' };
  }
}

async function fetchPolymarketOdds(nextResolutionTime: number) {
  try {
    // nextResolutionTime is the end time in ms. The slug uses this (in seconds).
    const slugTimestamp = Math.floor(nextResolutionTime / 1000);
    const slug = `btc-updown-5m-${slugTimestamp}`;
    const res = await axios.get(`https://gamma-api.polymarket.com/events?slug=${slug}`);

    if (res.data && res.data.length > 0 && res.data[0].markets && res.data[0].markets.length > 0) {
      const market = res.data[0].markets[0];
      const outcomes = JSON.parse(market.outcomes || '[]');
      const prices = JSON.parse(market.outcomePrices || '[]');

      let upPrice = 0.50;
      let downPrice = 0.50;

      const upIndex = outcomes.findIndex((o: string) => o.toLowerCase() === 'up' || o.toLowerCase() === 'yes');
      const downIndex = outcomes.findIndex((o: string) => o.toLowerCase() === 'down' || o.toLowerCase() === 'no');

      if (upIndex !== -1 && prices[upIndex]) upPrice = parseFloat(prices[upIndex]);
      if (downIndex !== -1 && prices[downIndex]) downPrice = parseFloat(prices[downIndex]);

      console.log(`[POLYMARKET] Slug: ${slug} | UP: ${(upPrice * 100).toFixed(1)}¢ | DOWN: ${(downPrice * 100).toFixed(1)}¢ | Outcomes: ${JSON.stringify(outcomes)}`);

      return {
        upPrice,
        downPrice,
        slug,
        endDate: market.endDate
      };
    }
    console.log(`[POLYMARKET] No market data found for slug: ${slug} (API returned empty)`);
    return null;
  } catch (error: any) {
    console.error(`[POLYMARKET] API error for resolution ${nextResolutionTime}: ${error.message}`);
    return null;
  }
}
// --- Copy Trading: Fetch target user's recent trades ---
// Track last seen trade ID to detect new trades instantly
const copyTradeLastSeenId: Record<string, string> = {};

async function fetchCopyTargetTrades(address: string): Promise<{ direction: 'UP' | 'DOWN'; slug: string } | null> {
  if (!address) return null;
  try {
    const res = await axios.get('https://data-api.polymarket.com/trades', {
      params: { user: address, limit: 5 },
      timeout: 4000,
    });

    const trades: any[] = Array.isArray(res.data) ? res.data : [];

    // Calculate today's date boundaries (UTC midnight to now)
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();

    // Filter to ONLY Bitcoin 5-minute markets from TODAY.
    // The market slug for BTC 5m is 'btc-updown-5m-...' or title includes 'bitcoin up or down'.
    // We also check title/question fields for robustness.
    const btcTrades = trades.filter((t: any) => {
      const slug = (t.market || t.conditionId || '').toLowerCase();
      const title = (t.title || t.question || t.marketQuestion || '').toLowerCase();
      const isBtc = slug.includes('btc-updown-5m') || slug.includes('btc-up-down-5m') ||
                    (title.includes('bitcoin') && (title.includes('up or down') || title.includes('up/down')));
      // Only include trades from today
      const tradeTime = t.timestamp ? (String(t.timestamp).length > 10 ? t.timestamp : t.timestamp * 1000) : 0;
      const isToday = tradeTime >= todayStartMs;
      return isBtc && isToday;
    });
    if (btcTrades.length === 0) return null;

    const latest = btcTrades[0]; // most recent first
    const tradeId = String(latest.id || latest.transactionHash || `${latest.timestamp}-${latest.price}`);

    // Only process if this is a NEW trade
    if (copyTradeLastSeenId[address] === tradeId) return null;

    // Parse direction from outcome/side field
    const outcome = (latest.outcome || latest.side || '').toLowerCase();
    const asset = (latest.asset || latest.tokenId || '').toLowerCase();
    let direction: 'UP' | 'DOWN' | null = null;

    if (outcome.includes('up') || outcome.includes('yes') || asset.includes('up')) direction = 'UP';
    else if (outcome.includes('down') || outcome.includes('no') || asset.includes('down')) direction = 'DOWN';

    if (!direction) return null;

    // Mark as seen so we never double-copy
    copyTradeLastSeenId[address] = tradeId;
    return { direction, slug: latest.market || '' };
  } catch (error: any) {
    console.error(`[COPY TRADE] Error fetching trades for ${address}: ${error.message}`);
    return null;
  }
}

function calculateBuyingPressure(candles: any[]) {

  // Exponentially weighted volume flow analysis (last 15 candles)
  const recent = candles.slice(-15);
  let weightedBuyVol = 0;
  let weightedSellVol = 0;

  recent.forEach((c, i) => {
    const weight = Math.pow(1.15, i); // Recent candles weighted more heavily
    const bodyRatio = Math.abs(c.close - c.open) / Math.max(c.high - c.low, 0.01); // 0-1: how "real" the move is
    const effectiveVol = c.volume * bodyRatio * weight;

    if (c.close > c.open) weightedBuyVol += effectiveVol;
    else weightedSellVol += effectiveVol;
  });

  const total = weightedBuyVol + weightedSellVol;
  const ratio = total > 0 ? weightedBuyVol / total : 0.5;

  // Volume spike detection: compare last candle to 20-candle avg
  const last20 = candles.slice(-20);
  const avgVol = last20.reduce((s, c) => s + c.volume, 0) / last20.length;
  const lastVol = candles[candles.length - 1].volume;
  const volumeSpike = lastVol > avgVol * 2.0;
  const spikeDirection = candles[candles.length - 1].close > candles[candles.length - 1].open ? 'UP' : 'DOWN';

  return {
    ratio,
    buyVol: weightedBuyVol,
    sellVol: weightedSellVol,
    volumeSpike,
    spikeDirection,
    spikeMultiplier: lastVol / Math.max(avgVol, 1)
  };
}

function checkMomentumConfirmation(candles: any[], direction: string): { confirmed: boolean, reason: string, strength: number } {
  if (candles.length < 7) return { confirmed: true, reason: 'Not enough candles for momentum check', strength: 0.5 };

  const last5 = candles.slice(-5);
  const avgVolume = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;

  if (direction === 'UP') {
    // Check for higher lows across 5 candles (at least 3 of 4 transitions)
    let higherLowCount = 0;
    for (let i = 1; i < last5.length; i++) {
      if (last5[i].low > last5[i - 1].low) higherLowCount++;
    }
    const upwardMove = last5[4].close > last5[0].open;
    const volumeRising = last5[4].volume > avgVolume * 0.8;
    const bodySize = Math.abs(last5[4].close - last5[4].open) / Math.max(last5[4].high - last5[4].low, 0.01);

    const signals = [higherLowCount >= 2, upwardMove, volumeRising, bodySize > 0.3];
    const strength = signals.filter(Boolean).length / signals.length;

    if (strength >= 0.75) {
      return { confirmed: true, reason: `Momentum confirms UP: ${signals.filter(Boolean).length}/4 signals (HL=${higherLowCount}, move=${upwardMove}, vol=${volumeRising})`, strength };
    }
    return { confirmed: false, reason: `Momentum rejects UP: only ${signals.filter(Boolean).length}/4 signals confirmed (need 3/4)`, strength };

  } else if (direction === 'DOWN') {
    let lowerHighCount = 0;
    for (let i = 1; i < last5.length; i++) {
      if (last5[i].high < last5[i - 1].high) lowerHighCount++;
    }
    const downwardMove = last5[4].close < last5[0].open;
    const volumeRising = last5[4].volume > avgVolume * 0.8;
    const bodySize = Math.abs(last5[4].close - last5[4].open) / Math.max(last5[4].high - last5[4].low, 0.01);

    const signals = [lowerHighCount >= 2, downwardMove, volumeRising, bodySize > 0.3];
    const strength = signals.filter(Boolean).length / signals.length;

    if (strength >= 0.75) {
      return { confirmed: true, reason: `Momentum confirms DOWN: ${signals.filter(Boolean).length}/4 signals (LH=${lowerHighCount}, move=${downwardMove}, vol=${volumeRising})`, strength };
    }
    return { confirmed: false, reason: `Momentum rejects DOWN: only ${signals.filter(Boolean).length}/4 signals confirmed (need 3/4)`, strength };
  }

  return { confirmed: true, reason: 'Neutral direction, no momentum check needed', strength: 0.5 };
}

// --- Price vs Strike Analysis ---
function calculatePriceVsStrike(currentPrice: number, strikePrice: number) {
  const diff = currentPrice - strikePrice;
  const diffPercent = (diff / strikePrice) * 100;

  let bias: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
  let biasStrength = 0; // 0-20 score contribution

  if (diffPercent > 0.05) { // Sensitivity increased
    bias = 'UP';
    biasStrength = Math.min(25, diffPercent * 100); // Up to 25 points
  } else if (diffPercent < -0.05) {
    bias = 'DOWN';
    biasStrength = Math.min(25, Math.abs(diffPercent) * 100);
  }

  return { bias, biasStrength, diffPercent };
}

// --- Advanced Indicators ---

function calculateHMA(values: number[], period: number) {
  if (values.length < period) return 0;
  const halfPeriod = Math.floor(period / 2);
  const sqrtPeriod = Math.floor(Math.sqrt(period));

  const wmaHalf = WMA.calculate({ values, period: halfPeriod });
  const wmaFull = WMA.calculate({ values, period });

  const diff = wmaHalf.slice(-wmaFull.length).map((val, i) => 2 * val - wmaFull[i]);
  const hma = WMA.calculate({ values: diff, period: sqrtPeriod });

  return hma[hma.length - 1];
}

function calculateSuperTrend(highs: number[], lows: number[], closes: number[], atr: number[], period: number, multiplier: number) {
  if (closes.length < period) return { trend: 'NEUTRAL', value: 0 };

  const lastATR = atr[atr.length - 1];
  const lastClose = closes[closes.length - 1];
  const msg = (highs[highs.length - 1] + lows[lows.length - 1]) / 2;

  const upperBand = msg + multiplier * lastATR;
  const lowerBand = msg - multiplier * lastATR;

  let trend = 'NEUTRAL';
  if (lastClose > upperBand) trend = 'UP';
  else if (lastClose < lowerBand) trend = 'DOWN';

  return { trend, upperBand, lowerBand };
}

function calculateLaguerre(closes: number[], gamma: number) {
  // Simplified Laguerre Filter
  let L0 = 0, L1 = 0, L2 = 0, L3 = 0;
  const results = [];

  for (let i = 0; i < closes.length; i++) {
    const prevL0 = L0, prevL1 = L1, prevL2 = L2;
    L0 = (1 - gamma) * closes[i] + gamma * L0;
    L1 = -gamma * L0 + prevL0 + gamma * L1;
    L2 = -gamma * L1 + prevL1 + gamma * L2;
    L3 = -gamma * L2 + prevL2 + gamma * L3;
    results.push((L0 + 2 * L1 + 2 * L2 + L3) / 6);
  }
  return results;
}

// --- RSI/MACD Divergence Detection ---
function detectDivergence(prices: number[], indicator: number[]) {
  if (prices.length < 20 || indicator.length < 20) return 'NONE';

  const p = prices.slice(-20);
  const ind = indicator.slice(-20);

  const lastPrice = p[p.length - 1];
  const prevPrice = p[p.length - 10]; // Look back 10 bars
  const lastInd = ind[ind.length - 1];
  const prevInd = ind[ind.length - 10];

  // Bullish Divergence: Price lower low, Indicator higher low
  if (lastPrice < prevPrice && lastInd > prevInd) return 'BULLISH';
  // Bearish Divergence: Price higher high, Indicator lower high
  if (lastPrice > prevPrice && lastInd < prevInd) return 'BEARISH';

  return 'NONE';
}

// --- Candlestick Pattern Detection ---
function detectCandlestickPatterns(candles: any[]) {
  if (candles.length < 5) return 'NONE';
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  const bodySize = Math.abs(last.close - last.open);
  const prevBodySize = Math.abs(prev.close - prev.open);
  const upperShadow = last.high - Math.max(last.open, last.close);
  const lowerShadow = Math.min(last.open, last.close) - last.low;

  // Bullish Engulfing
  if (last.close > last.open && prev.close < prev.open && last.close > prev.open && last.open < prev.close) return 'BULLISH_ENGULFING';
  // Bearish Engulfing
  if (last.close < last.open && prev.close > prev.open && last.close < prev.open && last.open > prev.close) return 'BEARISH_ENGULFING';

  // Hammer / Pin Bar
  if (lowerShadow > bodySize * 2 && upperShadow < bodySize * 0.5) return 'BULLISH_PINBAR';
  // Shooting Star
  if (upperShadow > bodySize * 2 && lowerShadow < bodySize * 0.5) return 'BEARISH_PINBAR';

  return 'NONE';
}

function detectSMC(candles: any[]) {
  const recent = candles.slice(-60);
  const highs = recent.map(c => c.high);
  const lows = recent.map(c => c.low);
  const closes = recent.map(c => c.close);

  // Order Blocks (High volume reversal zones with liquidity sweep)
  const lastCandle = recent[recent.length - 1];
  const avgVol = recent.reduce((a, b) => a + b.volume, 0) / recent.length;

  let orderBlock = 'NONE';
  if (lastCandle.volume > avgVol * 1.8) {
    // Bullish OB: Liquidity sweep of recent lows followed by strong close
    const localMin = Math.min(...lows.slice(-15, -1));
    if (lastCandle.low < localMin && lastCandle.close > lastCandle.open) orderBlock = 'BULLISH';

    // Bearish OB: Liquidity sweep of recent highs followed by strong close
    const localMax = Math.max(...highs.slice(-15, -1));
    if (lastCandle.high > localMax && lastCandle.close < lastCandle.open) orderBlock = 'BEARISH';
  }

  // Fair Value Gaps (FVG)
  let fvg = 'NONE';
  const c1 = recent[recent.length - 3];
  const c3 = recent[recent.length - 1];
  if (c1.high < c3.low) fvg = 'BULLISH';
  if (c1.low > c3.high) fvg = 'BEARISH';

  // Change of Character (ChoCh) - Trend Reversal Signal
  let choch = 'NONE';
  const prevHigh = Math.max(...highs.slice(-20, -10));
  const prevLow = Math.min(...lows.slice(-20, -10));

  if (lastCandle.close > prevHigh && closes[recent.length - 5] < prevHigh) choch = 'BULLISH';
  if (lastCandle.close < prevLow && closes[recent.length - 5] > prevLow) choch = 'BEARISH';

  return { orderBlock, fvg, choch };
}

// --- Synthetic Polymarket Odds (Black-Scholes Approximation) ---
function normalCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014337 * Math.exp(-x * x / 2);
  const prob = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - prob : prob;
}

function calculateSyntheticOdds(currentPrice: number, strikePrice: number, timeLeftMs: number) {
  const T = Math.max(0.001, timeLeftMs / (5 * 60 * 1000));
  const volatility = 0.002 * strikePrice;
  const stdDev = volatility * Math.sqrt(T);
  const priceDiff = currentPrice - strikePrice;
  const zScore = priceDiff / stdDev;

  let theoreticalProb = normalCDF(zScore);
  let noisyProb = Math.max(0.01, Math.min(0.99, theoreticalProb));

  let spread = 0.01 + (Math.abs(0.5 - noisyProb) * 0.05);
  spread = Math.max(0.01, Math.min(0.10, spread));

  const upBid = noisyProb - (spread / 2);
  const upAsk = noisyProb + (spread / 2);
  return (upBid + upAsk) / 2;
}

// --- PolySight Insider Finder Module ---
let oddsHistory: { timestamp: number, resolutionTime: number, upPrice: number, downPrice: number }[] = [];

function calculatePolySightInsiderSignal(currentPrice: number, strikePrice: number, polymarketOdds: any, timeToResolution: number) {
  if (!polymarketOdds) return { strength: 0, direction: 'NEUTRAL', reason: 'No odds data' };

  const now = Date.now();
  // Keep last 5 minutes of odds
  oddsHistory = oddsHistory.filter(h => now - h.timestamp < 5 * 60 * 1000);

  const resTime = polymarketOdds.endDate ? new Date(polymarketOdds.endDate).getTime() : 0;
  oddsHistory.push({
    timestamp: now,
    resolutionTime: resTime,
    upPrice: polymarketOdds.upPrice,
    downPrice: polymarketOdds.downPrice
  });

  // analyze momentum over the last 1-3 minutes
  const oneMinAgo = oddsHistory.find(h => now - h.timestamp >= 60000);
  const threeMinAgo = oddsHistory.find(h => now - h.timestamp >= 180000);
  const reference = oneMinAgo || threeMinAgo || oddsHistory[0];

  let oddsMomentumUp = 0;
  if (reference && reference.resolutionTime === resTime) {
    oddsMomentumUp = polymarketOdds.upPrice - reference.upPrice;
  }

  const syntheticUp = calculateSyntheticOdds(currentPrice, strikePrice, timeToResolution);
  const premiumUp = polymarketOdds.upPrice - syntheticUp;
  const premiumDown = polymarketOdds.downPrice - (1 - syntheticUp);

  let signalDirection = 'NEUTRAL';
  let signalStrength = 0;
  let reasons: string[] = [];

  // Massive discrepancies (Insider Premium)
  if (premiumUp > 0.05) {
    signalDirection = 'UP';
    signalStrength += (premiumUp * 100) * 1.5;
    reasons.push(`UP Premium: +${(premiumUp * 100).toFixed(1)}%`);
  } else if (premiumDown > 0.05) {
    signalDirection = 'DOWN';
    signalStrength += (premiumDown * 100) * 1.5;
    reasons.push(`DOWN Premium: +${(premiumDown * 100).toFixed(1)}%`);
  }

  // Rapid Momentum
  if (oddsMomentumUp > 0.03) {
    if (signalDirection === 'DOWN') { signalStrength -= 20; }
    else { signalDirection = 'UP'; signalStrength += (oddsMomentumUp * 100) * 2; reasons.push(`UP Momentum: +${(oddsMomentumUp * 100).toFixed(1)}%`); }
  } else if (oddsMomentumUp < -0.03) {
    const absMom = Math.abs(oddsMomentumUp);
    if (signalDirection === 'UP') { signalStrength -= 20; }
    else { signalDirection = 'DOWN'; signalStrength += (absMom * 100) * 2; reasons.push(`DOWN Momentum: +${(absMom * 100).toFixed(1)}%`); }
  }

  return {
    direction: signalStrength > 10 ? signalDirection : 'NEUTRAL',
    strength: Math.max(0, Math.min(100, signalStrength)),
    reason: reasons.join(' | ') || 'No anomalous insider flow'
  };
}

// --- 54-Feature Meta-Model Normalizer ---
function extractMetaFeatures(candles: any[], technicals: any, currentPrice: number, strikePrice: number, polymarketOdds: any, timeToResolution: number): number[] {
  const F = new Array(54).fill(0.0);

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const vols = candles.map(c => c.volume);
  const len = closes.length;

  const normOsc = (val: number, min: number, max: number) => Math.max(-1.0, Math.min(1.0, ((val - min) / (max - min)) * 2 - 1));
  const normDist = (price: number, ma: number) => Math.max(-1.0, Math.min(1.0, (price - ma) / ma * 100));

  F[0] = normDist(currentPrice, technicals.v7.sma20);
  F[1] = normDist(currentPrice, technicals.ema20);
  F[2] = normDist(currentPrice, technicals.v7.wema20);
  F[3] = normDist(currentPrice, technicals.hma20);
  F[4] = normDist(currentPrice, technicals.vwap);

  F[5] = technicals.macd ? Math.max(-1.0, Math.min(1.0, technicals.macd.MACD * 20)) : 0;
  F[6] = technicals.macd ? Math.max(-1.0, Math.min(1.0, technicals.macd.histogram * 40)) : 0;

  F[7] = normOsc(technicals.rsi, 0, 100);
  F[8] = normOsc(technicals.stoch.k, 0, 100);
  F[9] = normOsc(technicals.stochRSI.k || 50, 0, 100);
  F[10] = normOsc(technicals.williamsR, -100, 0);
  F[11] = Math.max(-1.0, Math.min(1.0, technicals.cci / 200));
  F[12] = Math.max(-1.0, Math.min(1.0, technicals.roc / 10));

  const mom = len > 10 ? (currentPrice - closes[len - 11]) / closes[len - 11] * 100 : 0;
  F[13] = Math.max(-1.0, Math.min(1.0, mom));
  F[14] = technicals.adx / 100.0;

  let pDM = 0, mDM = 0;
  for (let i = len - 14; i < len; i++) {
    if (i < 1) continue;
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    if (upMove > downMove && upMove > 0) pDM += upMove;
    if (downMove > upMove && downMove > 0) mDM += downMove;
  }
  const dmSum = pDM + mDM || 1;
  F[15] = (pDM / dmSum) * 2 - 1;
  F[16] = (mDM / dmSum) * 2 - 1;

  F[17] = technicals.bb ? (currentPrice > technicals.bb.upper ? 1 : currentPrice < technicals.bb.lower ? -1 : 0) : 0;
  F[18] = technicals.bb ? Math.min(1.0, (technicals.bb.upper - technicals.bb.lower) / currentPrice * 100) : 0;
  F[19] = normOsc(technicals.bollingerPctB * 100, 0, 100);
  F[20] = Math.min(1.0, (technicals.atr / currentPrice) * 1000);
  F[21] = technicals.v7.keltner ? (currentPrice - technicals.v7.keltner.middle) / (technicals.v7.keltner.upper - technicals.v7.keltner.lower) : 0;
  F[22] = normOsc(currentPrice, technicals.v7.donchianLow, technicals.v7.donchianHigh);
  F[23] = normDist(currentPrice, technicals.v7.psar);
  F[24] = technicals.ichimokuSignal === 'BULLISH' ? 1.0 : technicals.ichimokuSignal === 'BEARISH' ? -1.0 : 0.0;
  F[25] = technicals.obvTrend === 'RISING' ? 1.0 : technicals.obvTrend === 'FALLING' ? -1.0 : 0.0;

  let cmfSum = 0, volSum = 0;
  for (let i = len - 20; i < len; i++) {
    const p = closes[i], h = highs[i], l = lows[i], v = vols[i];
    if (h !== l) { cmfSum += ((p - l) - (h - p)) / (h - l) * v; }
    volSum += v;
  }
  F[26] = volSum > 0 ? Math.max(-1.0, Math.min(1.0, cmfSum / volSum)) : 0;
  F[27] = F[26];
  F[28] = normOsc(technicals.mfi, 0, 100);

  const shortVol = vols.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const longVol = vols.slice(-20).reduce((a, b) => a + b, 0) / 20;
  F[29] = Math.max(-1.0, Math.min(1.0, (shortVol - longVol) / (longVol || 1)));
  F[30] = Math.max(-1.0, Math.min(1.0, F[29] * mom));

  const eom = len > 2 ? ((highs[len - 1] + lows[len - 1]) / 2 - (highs[len - 2] + lows[len - 2]) / 2) / (vols[len - 1] / 1000000 / (highs[len - 1] - lows[len - 1] || 1)) : 0;
  F[31] = Math.max(-1.0, Math.min(1.0, eom * 100));

  const aroonHighIdx = highs.slice(-25).indexOf(Math.max(...highs.slice(-25)));
  const aroonUp = (25 - (24 - aroonHighIdx)) / 25 * 100;
  F[32] = aroonUp / 100.0;

  const aroonLowIdx = lows.slice(-25).indexOf(Math.min(...lows.slice(-25)));
  const aroonDown = (25 - (24 - aroonLowIdx)) / 25 * 100;
  F[33] = aroonDown / 100.0;
  F[34] = (aroonUp - aroonDown) / 100.0;
  F[35] = Math.max(-1.0, Math.min(1.0, technicals.v7.trix * 10));
  F[36] = F[12];
  F[37] = (F[8] + F[10]) / 2.0;

  const dpo = currentPrice - technicals.v7.sma20;
  F[38] = Math.max(-1.0, Math.min(1.0, dpo / currentPrice * 100));

  const mean20 = technicals.v7.sma20;
  const variance = closes.slice(-20).reduce((acc, val) => acc + Math.pow(val - mean20, 2), 0) / 20;
  const stdDev = Math.sqrt(variance);
  F[39] = Math.min(1.0, stdDev / currentPrice * 100);
  F[40] = stdDev > 0 ? Math.max(-1.0, Math.min(1.0, (currentPrice - mean20) / stdDev / 3)) : 0;

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < 20; i++) {
    const y = closes[len - 20 + i];
    sumX += i; sumY += y; sumXY += i * y; sumXX += i * i;
  }
  const slope = (20 * sumXY - sumX * sumY) / (20 * sumXX - sumX * sumX);
  F[41] = Math.max(-1.0, Math.min(1.0, slope * 100));
  F[42] = Math.abs(F[41]);
  F[43] = normDist(currentPrice, technicals.v7.pivot);

  const range = technicals.localHigh - (technicals.localLow || 1);
  const fib38 = technicals.localHigh - range * 0.382;
  const fib61 = technicals.localHigh - range * 0.618;
  const distToFib = Math.min(Math.abs(currentPrice - fib38), Math.abs(currentPrice - fib61));
  F[44] = Math.max(0, 1.0 - (distToFib / (range || 1)));
  F[45] = F[44];

  if (polymarketOdds) {
    const syntheticUp = calculateSyntheticOdds(currentPrice, strikePrice, timeToResolution);
    const premiumUp = polymarketOdds.upPrice - syntheticUp;
    const premiumDown = polymarketOdds.downPrice - (1 - syntheticUp);
    if (premiumUp > premiumDown) F[46] = Math.min(1.0, premiumUp * 10);
    else F[46] = Math.max(-1.0, -premiumDown * 10);
  }

  F[47] = polymarketOdds ? Math.min(1.0, Math.abs(polymarketOdds.upPrice + polymarketOdds.downPrice - 1.0) * 10) : 0;
  F[48] = ((technicals.buyingPressure?.ratio || 0.5) * 2) - 1.0;

  const timeRatio = Math.max(0, Math.min(1.0, timeToResolution / (5 * 60 * 1000)));
  const strikeDist = (currentPrice - strikePrice) / strikePrice * 1000;
  F[49] = (1.0 - timeRatio) * Math.max(-1.0, Math.min(1.0, strikeDist));

  F[50] = F[20];
  F[51] = Math.max(-1.0, Math.min(1.0, strikeDist / 10));
  F[52] = normOsc(technicals.v7.chop, 0, 100);
  F[53] = F[14];

  return F.map(val => isNaN(val) ? 0 : val);
}

// --- Volatility Regime Detection ---
function getVolatilityRegime(atr: number, price: number): { regime: 'LOW' | 'MEDIUM' | 'HIGH', confidenceAdjust: number } {
  const atrPercent = (atr / price) * 100;

  if (atrPercent < 0.03) return { regime: 'LOW', confidenceAdjust: -15 }; // Dead market, penalize
  if (atrPercent > 0.12) return { regime: 'HIGH', confidenceAdjust: -10 }; // Chaotic, penalize
  return { regime: 'MEDIUM', confidenceAdjust: 0 }; // Ideal conditions
}

// --- Analysis ---

function calculateTechnicals(candles: any[]) {
  if (candles.length < 50) return null;

  const highsData = candles.map(c => c.high);
  const lowsData = candles.map(c => c.low);
  const closesData = candles.map(c => c.close);
  const volumeData = candles.map(c => c.volume);

  // === CORE INDICATORS ===
  const rsi = RSI.calculate({ values: closesData, period: 14 });
  const macd = MACD.calculate({
    values: closesData,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  const bb = BollingerBands.calculate({ period: 20, values: closesData, stdDev: 2 });
  const atr = ATR.calculate({ high: highsData, low: lowsData, close: closesData, period: 14 });
  const ema20 = EMA.calculate({ values: closesData, period: 20 });
  const ema50 = EMA.calculate({ values: closesData, period: 50 });
  const adx = ADX.calculate({ high: highsData, low: lowsData, close: closesData, period: 14 });

  const ema9 = EMA.calculate({ values: closesData, period: 9 });
  const ema21 = EMA.calculate({ values: closesData, period: 21 });
  const ema200 = EMA.calculate({ values: closesData, period: Math.min(200, closesData.length) });

  // === V4 NEW INDICATORS ===
  // Stochastic RSI — faster overbought/oversold detection
  const stochRSI = StochasticRSI.calculate({
    values: closesData,
    rsiPeriod: 14,
    stochasticPeriod: 14,
    kPeriod: 3,
    dPeriod: 3,
  });

  // ROC — Rate of Change (price velocity)
  const roc = ROC.calculate({ values: closesData, period: 10 });

  // OBV — On-Balance Volume (volume-confirmed direction)
  const obv = OBV.calculate({ close: closesData, volume: volumeData });

  // MFI — Money Flow Index (volume-weighted RSI)
  const mfi = MFI.calculate({ high: highsData, low: lowsData, close: closesData, volume: volumeData, period: 14 });

  // CCI — Commodity Channel Index (trend strength + extremes)
  const cci = CCI.calculate({ high: highsData, low: lowsData, close: closesData, period: 20 });

  // Stochastic Oscillator — classic momentum
  const stoch = Stochastic.calculate({ high: highsData, low: lowsData, close: closesData, period: 14, signalPeriod: 3 });

  // Ichimoku Cloud — multi-timeframe trend/support/resistance
  const ichimoku = IchimokuCloud.calculate({
    high: highsData,
    low: lowsData,
    conversionPeriod: 9,
    basePeriod: 26,
    spanPeriod: 52,
    displacement: 26,
  });

  // === EXISTING CUSTOM INDICATORS ===
  const williamsR = WilliamsR.calculate({ high: highsData, low: lowsData, close: closesData, period: 14 });
  const hma20 = calculateHMA(closesData, 20);
  const supertrend = calculateSuperTrend(highsData, lowsData, closesData, atr, 10, 3);
  const laguerre = calculateLaguerre(closesData, 0.5);
  const smc = detectSMC(candles);
  const rsiDivergence = detectDivergence(closesData, rsi);
  const candlePattern = detectCandlestickPatterns(candles);

  // === EXTRACT LATEST VALUES ===
  const lastWilly = williamsR[williamsR.length - 1];
  const lastLaguerre = laguerre[laguerre.length - 1];
  const lastRSI = rsi[rsi.length - 1];
  const lastMACD = macd[macd.length - 1];
  const lastBB = bb[bb.length - 1];
  const lastATR = atr[atr.length - 1];
  const lastADX = adx[adx.length - 1];
  const lastClose = closesData[closesData.length - 1];
  const lastEMA9 = ema9.length > 0 ? ema9[ema9.length - 1] : lastClose;
  const lastEMA20 = ema20[ema20.length - 1];
  const lastEMA21 = ema21.length > 0 ? ema21[ema21.length - 1] : lastClose;
  const lastEMA50 = ema50[ema50.length - 1];
  const lastEMA200 = ema200.length > 0 ? ema200[ema200.length - 1] : lastClose;

  // V4 new latest values
  const lastStochRSI = stochRSI.length > 0 ? stochRSI[stochRSI.length - 1] : { stpinaticRSI: 50, k: 50, d: 50 };
  const lastROC = roc.length > 0 ? roc[roc.length - 1] : 0;
  const lastMFI = mfi.length > 0 ? mfi[mfi.length - 1] : 50;
  const lastCCI = cci.length > 0 ? cci[cci.length - 1] : 0;
  const lastStoch = stoch.length > 0 ? stoch[stoch.length - 1] : { k: 50, d: 50 };
  const lastIchimoku = ichimoku.length > 0 ? ichimoku[ichimoku.length - 1] : null;

  // === V7 NEW 30+ INDICATORS & METRICS ===
  const sma20 = SMA.calculate({ values: closesData, period: 20 });
  const sma50 = SMA.calculate({ values: closesData, period: 50 });
  const ema10 = EMA.calculate({ values: closesData, period: 10 });
  const ema30 = EMA.calculate({ values: closesData, period: 30 });
  const ema100 = EMA.calculate({ values: closesData, period: 100 });
  const wema20 = WEMA.calculate({ values: closesData, period: 20 });
  const trix = TRIX.calculate({ values: closesData, period: 18 });
  let forceIndex: number[] | null = null;
  try { forceIndex = ForceIndex.calculate({ close: closesData, volume: volumeData, period: 13 }); } catch (e) { }
  const psar = PSAR.calculate({ high: highsData, low: lowsData, step: 0.02, max: 0.2 });
  const keltner = KeltnerChannels.calculate({ high: highsData, low: lowsData, close: closesData, maPeriod: 20, multiplier: 2, atrPeriod: 20, useSMA: false });

  // Custom AO (Awesome Oscillator)
  const midPrices = highsData.map((h: number, i: number) => (h + lowsData[i]) / 2);
  const calcCustomSMA = (arr: number[], len: number) => arr.length >= len ? arr.slice(-len).reduce((a: number, b: number) => a + b) / len : arr[arr.length - 1];
  const aoValue = calcCustomSMA(midPrices, 5) - calcCustomSMA(midPrices, 34);
  const aoPrev = midPrices.length > 1 ? calcCustomSMA(midPrices.slice(0, -1), 5) - calcCustomSMA(midPrices.slice(0, -1), 34) : 0;

  // Custom CMO (Chande Momentum Oscillator)
  let sumGains = 0, sumLosses = 0;
  for (let i = Math.max(1, closesData.length - 14); i < closesData.length; i++) {
    const diff = closesData[i] - closesData[i - 1];
    if (diff > 0) sumGains += diff;
    else sumLosses -= diff;
  }
  const cmoValue = sumGains + sumLosses === 0 ? 0 : ((sumGains - sumLosses) / (sumGains + sumLosses)) * 100;

  // Chop Index (Trending vs Ranging)
  const maxHigh14 = Math.max(...highsData.slice(-14));
  const minLow14 = Math.min(...lowsData.slice(-14));
  const atrSum14 = atr.slice(-14).reduce((a: number, b: number) => a + b, 0);
  const chopIndex = maxHigh14 - minLow14 === 0 ? 50 : 100 * Math.log10(atrSum14 / (maxHigh14 - minLow14)) / Math.log10(14);

  // VWMA (Volume Weighted Moving Average) 20
  let vwmaSum = 0, volSum = 0;
  for (let i = Math.max(0, closesData.length - 20); i < closesData.length; i++) {
    vwmaSum += closesData[i] * volumeData[i];
    volSum += volumeData[i];
  }
  const vwma20 = volSum > 0 ? vwmaSum / volSum : lastClose;

  // Disparity Index (Price distance from EMA20)
  const disparityIndex = ((lastClose - lastEMA20) / lastEMA20) * 100;

  // Donchian Channels 20
  const donchianHigh = Math.max(...highsData.slice(-20));
  const donchianLow = Math.min(...lowsData.slice(-20));

  // Pivot Points (Local approximate)
  const pivotP = (Math.max(...candles.slice(-20).map(c => c.high)) + Math.min(...candles.slice(-20).map(c => c.low)) + lastClose) / 3;

  // Extract latest arrays where needed
  const lastSMA20 = sma20.length > 0 ? sma20[sma20.length - 1] : lastClose;
  const lastSMA50 = sma50.length > 0 ? sma50[sma50.length - 1] : lastClose;
  const lastEMA10 = ema10.length > 0 ? ema10[ema10.length - 1] : lastClose;
  const lastEMA30 = ema30.length > 0 ? ema30[ema30.length - 1] : lastClose;
  const lastEMA100 = ema100.length > 0 ? ema100[ema100.length - 1] : lastClose;
  const lastWEMA20 = wema20.length > 0 ? wema20[wema20.length - 1] : lastClose;
  const lastTRIX = trix.length > 0 ? trix[trix.length - 1] : 0;
  const lastForceIndex = (forceIndex && forceIndex.length > 0) ? forceIndex[forceIndex.length - 1] : 0;
  const lastPSAR = psar.length > 0 ? psar[psar.length - 1] : lastClose;
  const lastKeltner = keltner.length > 0 ? keltner[keltner.length - 1] : null;

  const v7 = {
    sma20: lastSMA20,
    sma50: lastSMA50,
    ema10: lastEMA10,
    ema30: lastEMA30,
    ema100: lastEMA100,
    wema20: lastWEMA20,
    trix: lastTRIX,
    forceIndex: lastForceIndex,
    psar: lastPSAR,
    keltner: lastKeltner,
    ao: aoValue,
    aoPrev: aoPrev,
    cmo: cmoValue,
    chop: chopIndex,
    vwma20,
    disparity: disparityIndex,
    donchianHigh,
    donchianLow,
    pivot: pivotP
  };

  // Bollinger %B — position within bands (0=lower, 0.5=middle, 1=upper)
  const bollingerPctB = lastBB ? (lastClose - lastBB.lower) / (lastBB.upper - lastBB.lower) : 0.5;

  // MACD Histogram slope (last 3 bars) — momentum acceleration
  let macdHistSlope = 0;
  if (macd.length >= 3) {
    const h1 = macd[macd.length - 3]?.histogram || 0;
    const h2 = macd[macd.length - 2]?.histogram || 0;
    const h3 = macd[macd.length - 1]?.histogram || 0;
    macdHistSlope = ((h3 - h2) + (h2 - h1)) / 2; // Average slope over 3 bars
  }

  // OBV trend (rising or falling over last 10 bars)
  let obvTrend = 'NEUTRAL';
  if (obv.length >= 10) {
    const obvRecent = obv.slice(-10);
    const obvSlope = (obvRecent[9] - obvRecent[0]) / Math.abs(obvRecent[0] || 1);
    if (obvSlope > 0.02) obvTrend = 'RISING';
    else if (obvSlope < -0.02) obvTrend = 'FALLING';
  }

  // Ichimoku signals
  let ichimokuSignal = 'NEUTRAL';
  if (lastIchimoku) {
    const conversion = (lastIchimoku as any).conversion;
    const base = (lastIchimoku as any).base;
    const spanA = (lastIchimoku as any).spanA;
    const spanB = (lastIchimoku as any).spanB;
    if (conversion && base && spanA && spanB) {
      if (lastClose > Math.max(spanA, spanB) && conversion > base) ichimokuSignal = 'BULLISH';
      else if (lastClose < Math.min(spanA, spanB) && conversion < base) ichimokuSignal = 'BEARISH';
      else if (lastClose > ((spanA + spanB) / 2)) ichimokuSignal = 'WEAK_BULLISH';
      else if (lastClose < ((spanA + spanB) / 2)) ichimokuSignal = 'WEAK_BEARISH';
    }
  }

  // VWAP Calculation
  let cumVol = 0;
  let cumTypPriceVol = 0;
  candles.forEach(c => {
    const typPrice = (c.high + c.low + c.close) / 3;
    cumVol += c.volume;
    cumTypPriceVol += typPrice * c.volume;
  });
  const vwap = cumVol > 0 ? cumTypPriceVol / cumVol : lastClose;

  // Local Support/Resistance (last 20 candles)
  const recentCandles = candles.slice(-20);
  const localHigh = Math.max(...recentCandles.map(c => c.high));
  const localLow = Math.min(...recentCandles.map(c => c.low));

  // Determine Trend Strength
  let trend = 'NEUTRAL';
  let trendStrength = lastADX ? lastADX.adx : 0;
  const slope20 = (lastEMA20 - ema20[ema20.length - 5]) / 5;

  if (lastClose > lastEMA20 && lastEMA20 > lastEMA50 && slope20 > 0) trend = 'STRONG_UP';
  else if (lastClose < lastEMA20 && lastEMA20 < lastEMA50 && slope20 < 0) trend = 'STRONG_DOWN';
  else if (lastClose > lastEMA50) trend = 'WEAK_UP';
  else trend = 'WEAK_DOWN';

  return {
    rsi: lastRSI,
    macd: lastMACD,
    bb: lastBB,
    atr: lastATR,
    adx: trendStrength,
    ema9: lastEMA9,
    ema20: lastEMA20,
    ema21: lastEMA21,
    ema50: lastEMA50,
    ema200: lastEMA200,
    vwap,
    localHigh,
    localLow,
    close: lastClose,
    trend,
    williamsR: lastWilly,
    hma20,
    supertrend,
    laguerre: lastLaguerre,
    smc,
    rsiDivergence,
    candlePattern,
    // V4 new fields
    stochRSI: lastStochRSI,
    roc: lastROC,
    mfi: lastMFI,
    cci: lastCCI,
    stoch: lastStoch,
    ichimokuSignal,
    bollingerPctB,
    v7,
    macdHistSlope,
    obvTrend,
  };
}

// AI Prediction is now handled by the frontend to comply with API key restrictions.
let latestMarketData: any = null;

async function analyzeSentiment(headlines: string[]) {
  // Disabled AI sentiment analysis to prevent API errors and speed up execution
  return { score: 0, reasoning: 'Sentiment analysis disabled' };
}

// --- Bot Logic ---

let latestPrediction: any = null;
let cachedAIPrediction: any = null;
let cachedAIResolutionTime: number = 0;
const metaVelocities: number[] = new Array(54).fill(0);

function resolvePredictions(currentPrice: number, currentTimestamp: number) {
  // Find OPEN predictions where resolution_time has passed
  const unresolved = db.prepare("SELECT * FROM predictions WHERE status = 'OPEN' AND resolution_time <= ?").all(currentTimestamp);

  for (const pred of unresolved as any[]) {
    // Find the candle at or just after pred.resolution_time
    const targetTime = pred.resolution_time;
    // Look for a candle within 1 minute of target time to act as the closing price
    const targetCandle = db.prepare("SELECT close FROM candles WHERE timestamp >= ? AND timestamp < ? LIMIT 1").get(targetTime, targetTime + 60000) as any;

    if (targetCandle) {
      const outcomePrice = targetCandle.close;
      let actualOutcome = 'PUSH';

      // Polymarket Rule: UP if >= Strike, DOWN if < Strike
      if (outcomePrice >= pred.price_at_prediction) actualOutcome = 'UP';
      else actualOutcome = 'DOWN';

      const isWin = pred.direction === actualOutcome;

      let pnl = 0;
      let currentBalance = parseFloat(getSetting('balance'));

      if (isWin) {
        // Polymarket Style Payout
        // Payout = Shares * $1.00
        const stakeToUse = pred.bet_stake && pred.bet_stake > 0 ? pred.bet_stake : (parseFloat(getSetting('stake_amount')) || 10);
        const shares = pred.shares_count > 0 ? pred.shares_count : (stakeToUse / pred.share_price);
        const payout = shares * 1.0;

        // Net PnL is the payout minus the initial stake
        pnl = payout - stakeToUse;

        // Add passing payout back to balance (stake was already deducted on entry)
        currentBalance += payout;
      } else {
        // Loss
        const fallbackStake = parseFloat(getSetting('stake_amount')) || 10;
        const actualStake = pred.bet_stake && pred.bet_stake > 0 ? pred.bet_stake : fallbackStake;
        pnl = -actualStake;
        // Balance was already deducted, no refund.
      }

      // AUTO-REFILL: If balance drops below $10, add $1000
      if (currentBalance < 10) {
        console.log('[BOT] Balance low. Auto-refilling $1000 to continue trading.');
        currentBalance += 1000;
      }

      updateSetting('balance', currentBalance.toString());

      db.prepare("UPDATE predictions SET actual_outcome = ?, status = 'RESOLVED', pnl = ? WHERE id = ?").run(
        isWin ? 'WIN' : 'LOSS',
        pnl,
        pred.id
      );

      // --- Meta-Model Offline Training (Adaptive SGD with Momentum) ---
      try {
        const features = JSON.parse(pred.features_json);
        if (features.metaFeatures && Array.isArray(features.metaFeatures) && features.metaFeatures.length === 54) {
          const target = actualOutcome === 'UP' ? 1.0 : 0.0;

          const weightRows = db.prepare('SELECT feature_index, weight FROM meta_weights ORDER BY feature_index ASC').all() as any[];
          const weights = weightRows.map(w => w.weight);

          let dotProduct = 0;
          for (let i = 0; i < 54; i++) dotProduct += features.metaFeatures[i] * weights[i];
          const predictedProb = 1 / (1 + Math.exp(-dotProduct));

          const error = target - predictedProb;
          const LR = 0.05; // Learning Rate
          const BETA = 0.9; // Momentum factor

          const updateStmt = db.prepare('UPDATE meta_weights SET weight = ? WHERE feature_index = ?');
          db.transaction(() => {
            for (let i = 0; i < 54; i++) {
              const gradient = error * features.metaFeatures[i];

              // Apply momentum
              metaVelocities[i] = BETA * metaVelocities[i] + (1 - BETA) * gradient;

              // L2 Regularization + Momentum update
              const newWeight = weights[i] + LR * metaVelocities[i] - (0.001 * weights[i]);
              updateStmt.run(newWeight, i);
            }
          })();
          console.log(`[META-MODEL] Weights updated (SGDM). Error: ${error.toFixed(4)}`);
        }
      } catch (e) { console.error('Error training meta model:', e); }

      console.log(`[BOT] Resolved Bet ${pred.id}: ${isWin ? 'WIN' : 'LOSS'} (${pnl.toFixed(2)}) - Strike: ${pred.price_at_prediction}, Actual: ${outcomePrice}`);
    }
  }
}

async function runBotCycle() {
  try {
    // 1. Fetch Data
    const candles = await fetchCandles(250); // Increased to 250 for EMA200
    if (candles.length === 0) throw new Error("No candle data");

    // Store latest candles
    const insertCandle = db.prepare('INSERT OR IGNORE INTO candles (timestamp, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?)');
    const insertMany = db.transaction((candles) => {
      for (const candle of candles) insertCandle.run(candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume);
    });
    insertMany(candles);

    const latestCandle = candles[candles.length - 1];

    // Resolve old predictions
    resolvePredictions(latestCandle.close, latestCandle.timestamp);

    // Check if bot is running
    const isRunning = getSetting('is_running') === 'true';
    // if (!isRunning) { ... } // REMOVED early return

    // --- 5-Minute Slot Logic (Dynamic Entry) ---
    const now = Date.now();
    const fiveMin = 5 * 60 * 1000;

    // Calculate the NEXT resolution time (e.g. if 9:56, next is 10:00)
    let nextResolution = Math.ceil(now / fiveMin) * fiveMin;

    // Calculate the START of the current 5-minute slot (e.g. if 9:56, start is 9:55)
    // This is the "Price to Beat" reference time.
    let slotStart = nextResolution - fiveMin;

    // Check if we already have a prediction for this resolution
    const existingPred = db.prepare('SELECT * FROM predictions WHERE resolution_time = ?').get(nextResolution);

    if (existingPred) {
      // We already have a bet for this resolution.
      // Ensure latestPrediction reflects this (in case of server restart)
      if (!latestPrediction || latestPrediction.resolution_time !== nextResolution) {
        latestPrediction = {
          ...existingPred,
          features: JSON.parse(existingPred.features_json)
        };
      }
      return;
    }

    // Find the candle at slotStart to get the "Price to Beat"
    // We look for a candle with timestamp close to slotStart (within 1m)
    // Since we fetch 100 1m candles, it should be there.
    let strikePrice = 0;
    const startCandle = candles.find((c: any) => Math.abs(c.timestamp - slotStart) < 60000);

    if (startCandle) {
      strikePrice = startCandle.open; // Use OPEN of the 5m period (which is OPEN of the first 1m candle)
    } else {
      // Fallback: If we can't find the exact start candle (e.g. bot started late), 
      // use the oldest available candle in this window, or current price if desperate.
      // Ideally, we should fetch it specifically if missing, but for now fallback to current.
      console.log('[BOT] Warning: Could not find exact slot start candle. Using current price as strike.');
      strikePrice = candles[candles.length - 1].close;
    }

    // 2. Technical Analysis
    const technicals = calculateTechnicals(candles);
    if (!technicals) return; // Not enough data

    // 3. News & Sentiment & Advanced Metrics
    const newsItems = await fetchNews();
    const headlines = newsItems.map((n: any) => n.title);

    // Parallel fetch for efficiency
    const [sentiment, fng, buyingPressure, polymarketOdds] = await Promise.all([
      analyzeSentiment(headlines),
      fetchFearAndGreed(),
      Promise.resolve(calculateBuyingPressure(candles)), // Sync function wrapped for consistency
      fetchPolymarketOdds(nextResolution)
    ]);

    // --- AI Learning & Pattern Recognition V3 ---
    // Fetch recent resolved trades to learn from mistakes
    const recentTrades = db.prepare("SELECT * FROM predictions WHERE status != 'OPEN' AND status != 'SKIPPED' ORDER BY timestamp DESC LIMIT 20").all() as any[];

    let streak = 0;
    let recentWinRate = 0.5;
    let adaptiveUpPenalty = 0;
    let adaptiveDownPenalty = 0;

    if (recentTrades.length > 0) {
      const wins = recentTrades.filter(t => t.actual_outcome === 'WIN').length;
      recentWinRate = wins / recentTrades.length;

      // Calculate streak
      for (const t of recentTrades) {
        if (t.actual_outcome === 'WIN') {
          if (streak < 0) break;
          streak++;
        } else if (t.actual_outcome === 'LOSS') {
          if (streak > 0) break;
          streak--;
        } else {
          break;
        }
      }

      // SMART ADAPTIVE LEARNING: Track which direction loses more
      const last10 = recentTrades.slice(0, 10);
      const upLosses = last10.filter(t => t.actual_outcome === 'LOSS' && t.direction === 'UP').length;
      const downLosses = last10.filter(t => t.actual_outcome === 'LOSS' && t.direction === 'DOWN').length;
      const upWins = last10.filter(t => t.actual_outcome === 'WIN' && t.direction === 'UP').length;
      const downWins = last10.filter(t => t.actual_outcome === 'WIN' && t.direction === 'DOWN').length;

      // If >60% of recent UP trades lost, penalize UP direction
      const upTotal = upLosses + upWins;
      const downTotal = downLosses + downWins;
      if (upTotal >= 3 && upLosses / upTotal > 0.6) {
        adaptiveUpPenalty = -Math.round((upLosses / upTotal) * 20);
        logSystem('INFO', `[ADAPTIVE] UP trades losing ${(upLosses / upTotal * 100).toFixed(0)}% — penalizing UP by ${adaptiveUpPenalty}`);
      }
      if (downTotal >= 3 && downLosses / downTotal > 0.6) {
        adaptiveDownPenalty = -Math.round((downLosses / downTotal) * 20);
        logSystem('INFO', `[ADAPTIVE] DOWN trades losing ${(downLosses / downTotal * 100).toFixed(0)}% — penalizing DOWN by ${adaptiveDownPenalty}`);
      }

      // REGIME LEARNING: Track win rate by market regime
      const recentLosses = last10.filter(t => t.actual_outcome === 'LOSS');
      let regimeMismatchPenalty = 0;
      for (const loss of recentLosses.slice(0, 5)) {
        try {
          const features = JSON.parse(loss.features_json);
          if (features?.technicals) {
            // If we lost trading against the trend with high ADX, penalize counter-trend
            if (features.technicals.adx > 25) {
              if (loss.direction === 'UP' && features.technicals.trend?.includes('DOWN')) regimeMismatchPenalty += 5;
              if (loss.direction === 'DOWN' && features.technicals.trend?.includes('UP')) regimeMismatchPenalty += 5;
            }
          }
        } catch (e) { /* ignore */ }
      }
      // Apply regime mismatch: penalize counter-trend trades
      if (regimeMismatchPenalty > 0 && technicals.adx > 25) {
        if (technicals.trend.includes('UP')) adaptiveDownPenalty -= regimeMismatchPenalty;
        if (technicals.trend.includes('DOWN')) adaptiveUpPenalty -= regimeMismatchPenalty;
      }
    }

    latestMarketData = {
      technicals,
      headlines,
      fng,
      buyingPressure,
      nextResolution,
      strikePrice,
      polymarketOdds
    };

    // ========================================================================
    // --- V11 APEX ENGINE (Strict EV, Confluence, Regime Filtering) ---
    // ========================================================================
    // Focuses on ONLY highly probable, confluent trades and refuses anything 
    // with negative Expected Value (EV) or low signal-to-noise ratio.

    // Calculate Inactivity for Force-Trade Logic
    const lastTrade = db.prepare("SELECT timestamp FROM predictions WHERE status IN ('OPEN', 'RESOLVED') ORDER BY timestamp DESC LIMIT 1").get() as { timestamp: number };
    const minutesSinceLastTrade = lastTrade ? (Date.now() - lastTrade.timestamp) / 60000 : (Date.now() - botStartTime) / 60000;
    const forceTradeNeeded = minutesSinceLastTrade >= 20;

    let direction = 'NEUTRAL';
    let confidence = 50;
    let expectedEdge = 0;
    let sharePrice = 0.5;
    let blockTradeReason: string | null = null;
    let shouldBet = false;
    let riskScore = 50;

    const timeToResolution = nextResolution - now;
    const timeLeftSeconds = timeToResolution / 1000;
    const secondsSinceOpen = 300 - Math.max(0, Math.min(300, timeLeftSeconds));

    const currentPrice = candles[candles.length - 1].close;
    const currentCandle = candles[candles.length - 1];

    // --- Signals & Regimes ---
    const polySightSignal = calculatePolySightInsiderSignal(currentPrice, strikePrice, polymarketOdds, timeToResolution);
    const metaFeatures = extractMetaFeatures(candles, technicals, currentPrice, strikePrice, polymarketOdds, timeToResolution);

    // 0. CORE METRICS
    const closes = candles.map(c => c.close);
    const len = closes.length;

    const v11 = {
      vwapDist: ((currentPrice - technicals.vwap) / technicals.vwap) * 100,
      atrPct: (technicals.atr / currentPrice) * 100,
      bbWidth: technicals.bb ? ((technicals.bb.upper - technicals.bb.lower) / currentPrice) * 100 : 0,
      emaSlope: 0,
      zScore: 0
    };

    const mean20 = closes.slice(-20).reduce((a: number, b: number) => a + b, 0) / 20;
    const stdDev20 = Math.sqrt(closes.slice(-20).reduce((acc: number, val: number) => acc + Math.pow(val - mean20, 2), 0) / 20);
    v11.zScore = stdDev20 > 0 ? (currentPrice - mean20) / stdDev20 : 0;

    if (len >= 5) {
      const k = 2 / (5 + 1);
      let tempEma = closes[len - 5];
      for (let i = len - 4; i < len; i++) { tempEma = (closes[i] - tempEma) * k + tempEma; }
      v11.emaSlope = ((currentPrice - tempEma) / tempEma) * 100;
    }

    // High Precision Regime Detection
    let regime = 'noisy/chop';
    if (v11.atrPct < 0.025 && currentCandle.volume < 20) {
      regime = 'thin liquidity';
    } else if (v11.atrPct > 0.15 && Math.abs(v11.zScore) > 3.0 && currentCandle.volume > 100) {
      regime = 'liquidation-driven burst'; 
    } else if (technicals.adx > 25 && Math.abs(v11.emaSlope) > 0.05) {
      regime = 'clean trend';
    } else {
      regime = 'noisy/chop';
    }

    // 1. APEX SCORING ENGINE
    let upScore = 0;
    let downScore = 0;

    // Trend Confluence (Primary Director)
    if (v11.emaSlope > 0) upScore += v11.emaSlope * 15;
    if (v11.emaSlope < 0) downScore += Math.abs(v11.emaSlope) * 15;

    // Momentum / Divergence 
    if (technicals.rsiDivergence === 'BULLISH') upScore += 25;
    if (technicals.rsiDivergence === 'BEARISH') downScore += 25;

    if (technicals.macd && technicals.macd.histogram > 0) upScore += 10;
    if (technicals.macd && technicals.macd.histogram < 0) downScore += 10;

    // Smart Money Concepts (SMC) & Liquidity Sweeps
    if (technicals.smc.orderBlock === 'BULLISH') upScore += 30;
    if (technicals.smc.orderBlock === 'BEARISH') downScore += 30;
    
    if (technicals.smc.choch === 'BULLISH') upScore += 20;
    if (technicals.smc.choch === 'BEARISH') downScore += 20;

    // Mean Reversion Extremes (Secondary filter)
    if (regime !== 'clean trend') {
        if (technicals.rsi > 70) downScore += 20;
        if (technicals.rsi < 30) upScore += 20;
        if (v11.zScore > 2.0) downScore += 25;
        if (v11.zScore < -2.0) upScore += 25;
    } else {
        // In strong trends, breaks above/below mean momentum are continuations
        if (technicals.rsi > 55) upScore += 10;
        if (technicals.rsi < 45) downScore += 10;
    }

    // PolySight Flow (Insider Premium)
    if (polySightSignal.direction === 'UP') upScore += polySightSignal.strength * 2.0;
    if (polySightSignal.direction === 'DOWN') downScore += polySightSignal.strength * 2.0;

    // Apply Meta-Model Penalties 
    if (adaptiveUpPenalty < 0) upScore += adaptiveUpPenalty;
    if (adaptiveDownPenalty < 0) downScore += adaptiveDownPenalty;

    const totalScore = upScore + downScore || 1;
    direction = upScore > downScore ? 'UP' : 'DOWN';
    const dominance = Math.max(upScore, downScore) / totalScore;

    // Baseline confidence 40 -> 95 based on dominance, capped mathematically.
    confidence = Math.min(95, 40 + (dominance * 55));

    // Severe penalties for weak conviction
    if (dominance < 0.6) confidence -= 20;

    // 2. EXPECTED VALUE (EV) CALCULATION & VALIDATION
    // Determine accurate synthetic share price via BS Approximation + Spread
    const syntheticUp = calculateSyntheticOdds(currentPrice, strikePrice, timeToResolution);
    
    // Choose actual cost basis (Polymarket exact or Synthetic fallback)
    let costPerShareUP = polymarketOdds ? polymarketOdds.upPrice : syntheticUp;
    let costPerShareDOWN = polymarketOdds ? polymarketOdds.downPrice : (1 - syntheticUp);

    // Normalize costs (avoid 0 or 1 edge cases)
    costPerShareUP = Math.max(0.01, Math.min(0.99, costPerShareUP));
    costPerShareDOWN = Math.max(0.01, Math.min(0.99, costPerShareDOWN));

    sharePrice = direction === 'UP' ? costPerShareUP : costPerShareDOWN;
    
    // EV Math
    // EV = (Probability of Win * Payout) - Initial Stake
    // Since Polymarket pays out $1.00 per share won, Payout for 1 share = $1.00
    // Profit = $1.00 - Share Price
    // EV per $1.00 invested = (WinProb / SharePrice) - 1
    const winProb = confidence / 100;
    expectedEdge = (winProb / sharePrice) - 1; // Expected % return on capital

    riskScore = Math.round(v11.atrPct * 1000); // DB compat

    // --- Adaptive Confidence Threshold ---
    const baseThreshold = parseFloat(getSetting('confidence_threshold')) || 60;
    let adaptiveThreshold = baseThreshold;
    
    // Raise threshold by 5% for each consecutive loss
    if (streak < 0) {
      adaptiveThreshold += Math.abs(streak) * 5;
      // Cap at 95% to allow for some trades even in bad streaks
      adaptiveThreshold = Math.min(95, adaptiveThreshold);
      logSystem('INFO', `[ADAPTIVE] Loss streak detected (${streak}). Raising threshold to ${adaptiveThreshold}%`);
    }

    // 3. STRICT REGIME PASS/FAIL RULES
    if (secondsSinceOpen < 5) {
      blockTradeReason = `Gathering open data (${secondsSinceOpen.toFixed(1)}s)`;
    } else if (secondsSinceOpen > 35) {
      blockTradeReason = `SKIPPING: Trading window closed (${secondsSinceOpen.toFixed(1)}s > 35s)`;
    } else if (regime === 'thin liquidity') {
      blockTradeReason = 'SKIPPING: Thin liquidity regime (dead market)';
    } else if (forceTradeNeeded && secondsSinceOpen >= 5 && secondsSinceOpen <= 35) {
      // FORCED TRADE: Timer triggered
      shouldBet = true;
      confidence = 100; // Force full confidence for the log/UI
      blockTradeReason = `FORCE TRADE: 20-minute inactivity timeout (${minutesSinceLastTrade.toFixed(1)}m ago)`;
    } else if (confidence < adaptiveThreshold) {
      blockTradeReason = `LOW CONFIDENCE: ${confidence.toFixed(1)}% < ${adaptiveThreshold}%`;
    } else if (expectedEdge < 0.05) {
      // REQUIRE at least a 5% positive expected value to justify risk
      blockTradeReason = `NEGATIVE EV: Expected edge ${(expectedEdge * 100).toFixed(1)}% < 5.0%`;
    } else {
      // EV > 5% and Confidence > adaptiveThreshold
      shouldBet = true;
      blockTradeReason = `V11 APEX ENTRY: ${direction} (Conf:${confidence.toFixed(0)}%, EV:+${(expectedEdge * 100).toFixed(1)}%, Threshold:${adaptiveThreshold}%)`;
    }

    logSystem('INFO', `[V11 APEX] ${regime.toUpperCase()} | ${direction} Conf: ${confidence.toFixed(0)}% | EV: ${(expectedEdge*100).toFixed(1)}% | Last Trade: ${minutesSinceLastTrade.toFixed(1)}m ago`);

    if (Date.now() - botStartTime < 20000) {
      shouldBet = false;
      blockTradeReason = 'Bot just started, syncing data...';
    }

    // ========================================================================`n    // --- COPY TRADE OVERRIDE ---`n    // If copy mode is enabled, check if the target user just placed a trade.`n    // If so, instantly mirror their direction, bypassing V11 APEX entirely.`n    // ========================================================================`n    const copyModeEnabled = getSetting('copy_mode_enabled') === 'true';`n    const copyTargetAddress = getSetting('copy_target_address');`n`n    if (copyModeEnabled && copyTargetAddress && isRunning) {`n      const copyTrade = await fetchCopyTargetTrades(copyTargetAddress);`n      if (copyTrade) {`n        direction = copyTrade.direction;`n        shouldBet = true;`n        confidence = 100;`n        blockTradeReason = `[COPY TRADE] Mirroring ${copyTargetAddress.slice(0, 10)}... � ${direction}`;`n        logSystem('TRADE', `[COPY TRADE] Detected trade by ${copyTargetAddress.slice(0, 6)}...${copyTargetAddress.slice(-4)} � Copying ${direction} INSTANTLY!`);`n        db.prepare('INSERT INTO copy_trades (timestamp, address, direction, market_slug, resolution_time) VALUES (?, ?, ?, ?, ?)').run(Date.now(), copyTargetAddress, direction, copyTrade.slug, nextResolution);`n      }`n    }`n`n    // ========================================================================
    // --- COPY TRADE OVERRIDE ---
    // If copy mode is enabled, check if target user just placed a trade.
    // If so, mirror their direction instantly — bypasses V11 APEX.
    // ========================================================================
    const copyModeEnabled = getSetting('copy_mode_enabled') === 'true';
    const copyTargetAddress = getSetting('copy_target_address');

    if (copyModeEnabled && copyTargetAddress && isRunning) {
      const copyTrade = await fetchCopyTargetTrades(copyTargetAddress);
      if (copyTrade) {
        direction = copyTrade.direction;
        shouldBet = true;
        confidence = 100;
        blockTradeReason = `[COPY TRADE] Mirroring ${copyTargetAddress.slice(0, 10)}... — ${direction}`;
        logSystem('TRADE', `[COPY TRADE] Detected trade by ${copyTargetAddress.slice(0, 6)}...${copyTargetAddress.slice(-4)} — Copying ${direction} INSTANTLY!`);
        db.prepare('INSERT INTO copy_trades (timestamp, address, direction, market_slug, resolution_time) VALUES (?, ?, ?, ?, ?)')
          .run(Date.now(), copyTargetAddress, direction, copyTrade.slug, nextResolution);
      }
    }

    // 6. Betting Logic
    // Robustly parse stake amount, preventing NaN or 0 if user is typing
    const rawStake = parseFloat(getSetting('stake_amount'));
    const stake = (isNaN(rawStake) || rawStake <= 0) ? 10 : rawStake;

    let balance = parseFloat(getSetting('balance'));

    const multiplier = 2.0;
    let status = 'WAITING'; // Default to WAITING
    let betStake = 0;
    let sharesCount = 0;

    if (!isRunning) {
      status = 'STOPPED';
    } else if (shouldBet) {
      // CONDITIONS MET - PLACE BET
      if (balance < stake) {
        status = 'WAITING'; // Don't skip permanently, just wait for funds
        logSystem('WARN', 'Insufficient funds to place bet, waiting for auto-refill or manual addition.');
      } else {
        // Use clean synthetic pricing (no random noise — noise hurts accuracy)
        const upSynthetic = calculateSyntheticOdds(currentPrice, strikePrice, timeToResolution);
        sharePrice = direction === 'UP' ? upSynthetic : (1 - upSynthetic);
        sharePrice = Math.max(0.01, Math.min(0.99, sharePrice));

        logSystem('INFO', `Synthetic share price: ${(sharePrice * 100).toFixed(1)}¢`);

        status = 'OPEN';
        betStake = stake;
        sharesCount = betStake / sharePrice;

        balance -= stake;
        updateSetting('balance', balance.toString());
        logSystem('TRADE', `Placed ${direction} bet for $${stake} at strike = ${strikePrice} | Share: ${(sharePrice * 100).toFixed(1)}¢ | Shares: ${sharesCount.toFixed(2)} `);
      }
    } else {
      // Conditions not met yet
      status = 'WAITING';
      logSystem('INFO', `Waiting... (Conf: ${confidence}%, Risk: ${riskScore}%, Time: ${timeLeftSeconds.toFixed(0)}s) - ${blockTradeReason || 'Score too low'} `);
    }

    const prediction = {
      timestamp: now, // Actual entry time
      resolution_time: nextResolution, // When it resolves
      direction,
      confidence,
      price_at_prediction: strikePrice, // STRIKE PRICE (Price to Beat)
      features: {
        technicals,
        sentiment,
        headlines: headlines.slice(0, 3),
        risk: riskScore,
        fng,
        buyingPressure,
        blockTradeReason,
        entryPrice: currentPrice, // Store actual BTC price at entry
        metaFeatures: metaFeatures
      },
      bet_stake: betStake,
      payout_multiplier: multiplier,
      share_price: sharePrice,
      shares_count: sharesCount,
      status,
      pnl: 0
    };

    // ALWAYS update latestPrediction so UI shows live analysis
    latestPrediction = prediction;

    // Only save to DB if we actually placed a bet (OPEN)
    if (status === 'OPEN') {
      db.prepare(`
        INSERT INTO predictions
        (timestamp, resolution_time, direction, confidence, price_at_prediction, features_json, bet_stake, payout_multiplier, share_price, shares_count, status, pnl)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
        prediction.timestamp,
        prediction.resolution_time,
        prediction.direction,
        prediction.confidence,
        prediction.price_at_prediction,
        JSON.stringify(prediction.features),
        prediction.bet_stake,
        prediction.payout_multiplier,
        prediction.share_price,
        prediction.shares_count,
        prediction.status,
        prediction.pnl
      );
      console.log(`[BOT] Bet Placed: ${direction} (${confidence}%) - Resolves: ${new Date(nextResolution).toISOString()} `);
    }

  } catch (error) {
    console.error('Bot cycle error:', error);
  }
}

// Run bot every 5 seconds to ensure we catch the short 20s window closely
setInterval(runBotCycle, 5000);
// Run once immediately on start
runBotCycle();


// --- Server Setup ---

async function startServer() {
  // API Routes
  app.get('/api/status', (req, res) => {
    const settings = db.prepare('SELECT * FROM settings').all() as { key: string, value: string }[];
    const settingsMap = settings.reduce((acc: any, curr) => {
      acc[curr.key] = curr.value;
      return acc;
    }, {});

    res.json({
      latestPrediction,
      serverTime: Date.now(),
      settings: settingsMap
    });
  });

  app.get('/api/candles', (req, res) => {
    const candles = db.prepare('SELECT * FROM candles ORDER BY timestamp DESC LIMIT 100').all();
    res.json(candles.reverse());
  });

  app.get('/api/history', (req, res) => {
    const history = db.prepare('SELECT * FROM predictions ORDER BY timestamp DESC LIMIT 50').all() as any[];
    const parsedHistory = history.map(h => ({
      ...h,
      features: h.features_json ? JSON.parse(h.features_json) : null
    }));
    res.json(parsedHistory);
  });

  app.get('/api/logs', (req, res) => {
    const logs = db.prepare('SELECT * FROM logs ORDER BY timestamp DESC LIMIT 100').all();
    res.json(logs);
  });

  app.get('/api/streak', (req, res) => {
    try {
      const resolved = db.prepare("SELECT actual_outcome, timestamp FROM predictions WHERE status = 'RESOLVED' ORDER BY timestamp DESC LIMIT 50").all() as any[];

      // Current streak
      let currentStreak = 0;
      for (const t of resolved) {
        if (t.actual_outcome === 'WIN') {
          if (currentStreak < 0) break;
          currentStreak++;
        } else if (t.actual_outcome === 'LOSS') {
          if (currentStreak > 0) break;
          currentStreak--;
        } else {
          break;
        }
      }

      // Best/worst streaks (scan all resolved)
      let bestWinStreak = 0;
      let worstLossStreak = 0;
      let tempStreak = 0;
      for (const t of resolved.slice().reverse()) { // oldest first
        if (t.actual_outcome === 'WIN') {
          tempStreak = tempStreak > 0 ? tempStreak + 1 : 1;
          bestWinStreak = Math.max(bestWinStreak, tempStreak);
        } else if (t.actual_outcome === 'LOSS') {
          tempStreak = tempStreak < 0 ? tempStreak - 1 : -1;
          worstLossStreak = Math.min(worstLossStreak, tempStreak);
        } else {
          tempStreak = 0;
        }
      }

      // Last 20 results for dot trail
      const last20 = resolved.slice(0, 20).map(t => ({
        outcome: t.actual_outcome,
        timestamp: t.timestamp
      })).reverse(); // chronological order for display

      res.json({
        currentStreak,
        bestWinStreak,
        worstLossStreak,
        last20,
        totalResolved: resolved.length
      });
    } catch (error) {
      console.error('Streak API error:', error);
      res.json({ currentStreak: 0, bestWinStreak: 0, worstLossStreak: 0, last20: [], totalResolved: 0 });
    }
  });

  app.post('/api/settings', (req, res) => {
    const { key, value } = req.body;
    updateSetting(key, value);
    res.json({ success: true });
  });




  // Resolve a Polymarket @username to a wallet address
  app.get('/api/resolve-polymarket-handle', async (req, res) => {
    const handle = String(req.query.handle || '').replace(/^@/, '');
    if (!handle) return res.status(400).json({ error: 'No handle provided' });
    try {
      // Scrape the wallet address directly from the Next.js HTML page data
      const fetchHandle = handle.startsWith('@') ? handle : `@${handle}`;
      const r = await axios.get(`https://polymarket.com/profile/${encodeURIComponent(fetchHandle)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
          'Accept': 'text/html'
        },
        timeout: 8000
      });
      
      const scriptPos = r.data.indexOf('__NEXT_DATA__');
      if (scriptPos > -1) {
          const start = r.data.indexOf('>', scriptPos) + 1;
          const end = r.data.indexOf('</script>', start);
          const jsonStr = r.data.substring(start, end);
          if (jsonStr) {
            const match = jsonStr.match(/(0x[a-fA-F0-9]{40})/i);
            if (match && match[1]) {
              return res.json({ address: match[1], handle });
            }
          }
      }
      return res.status(404).json({ error: 'Profile not found or address hidden for handle: ' + handle });
    } catch (err: any) {
      console.error('[RESOLVE HANDLE] Error:', err.message);
      return res.status(500).json({ error: 'Failed to resolve handle' });
    }
  });

  // Proxy: Fetch target user's live Bitcoin trades for the UI panel
  app.get('/api/copy-target-trades', async (req, res) => {
    const address = getSetting('copy_target_address');
    if (!address) return res.json([]);
    try {
      const response = await axios.get('https://data-api.polymarket.com/trades', {
        params: { user: address, limit: 30 },
        timeout: 5000,
      });
      const trades: any[] = Array.isArray(response.data) ? response.data : [];
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const todayStartMs = todayStart.getTime();

      // Filter Bitcoin Up/Down trades today only
      const filtered = trades.filter((t: any) => {
        const slug = (t.market || t.conditionId || '').toLowerCase();
        const title = (t.title || t.question || t.marketQuestion || '').toLowerCase();
        const isBtc = slug.includes('btc-updown-5m') || slug.includes('btc-up-down-5m') ||
                      (title.includes('bitcoin') && (title.includes('up or down') || title.includes('up/down')));
        const tradeTime = t.timestamp ? (String(t.timestamp).length > 10 ? t.timestamp : t.timestamp * 1000) : 0;
        return isBtc && tradeTime >= todayStartMs;
      });
      res.json(filtered);
    } catch (err: any) {
      console.error('[COPY TARGET] Fetch error:', err.message);
      res.json([]);
    }
  });

  app.get('/api/copy-trades', (req, res) => {
    const trades = db.prepare('SELECT * FROM copy_trades ORDER BY timestamp DESC LIMIT 10').all();
    res.json(trades);
  });

  app.get('/api/market-data', (req, res) => {
    res.json(latestMarketData || {});
  });

  app.post('/api/ai-prediction', (req, res) => {
    const { direction, confidence, reasoning, resolution_time } = req.body;
    if (direction && confidence && resolution_time) {
      cachedAIPrediction = { direction, confidence, reasoning };
      cachedAIResolutionTime = resolution_time;
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Invalid prediction data' });
    }
  });

  app.post('/api/control', (req, res) => {
    const { action } = req.body;
    if (action === 'start') {
      updateSetting('is_running', 'true');
      updateSetting('uptime_start_time', Date.now().toString());
    }
    if (action === 'stop') {
      updateSetting('is_running', 'false');
      updateSetting('uptime_start_time', '0');
    }
    if (action === 'reset') {
      updateSetting('balance', '1000');
      updateSetting('uptime_start_time', '0');
      db.prepare('DELETE FROM predictions').run();
      latestPrediction = null;
      console.log('[BOT] Full Reset Performed');
    }
    res.json({ success: true });
  });

  app.get('/api/price/kucoin', async (req, res) => {
    try {
      const response = await axios.get('https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=BTC-USDT', {
        timeout: 2000
      });
      res.json(response.data);
    } catch (error: any) {
      console.error('[API] KuCoin Price Proxy Error:', error.message);
      res.status(500).json({ error: 'Failed to fetch KuCoin price' });
    }
  });

  // Serve Frontend
  if (process.env.NODE_ENV !== 'production') {
    // Development Mode (Vite Middleware)
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production Mode (Serve built files from dist/)
    app.use(express.static(path.join(__dirname, 'dist')));

    // Catch-all route for React Router (if you ever add it)
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
