import axios from 'axios';

export type Direction = 'UP' | 'DOWN' | 'WAIT';
export type BotState = 'running' | 'paused' | 'stopped' | 'emergency_stopped';

export interface Settings {
  starting_balance: number;
  balance: number;
  stake_amount: number;
  max_trade_amount: number;
  risk_mode: 'safe' | 'balanced' | 'aggressive';
  bot_state: BotState;
  taker_fee_rate: number;
  forced_cadence_every: number;
  skipped_windows: number;
}

export interface BtcWindow {
  id: string;
  title: string;
  market_slug: string;
  round: string;
  status: string;
  window_start: number;
  window_end: number;
  price_to_beat: number;
  current_price: number;
  indicator_price: number;
  chainlink_status: string;
  reference_source: string;
  up_price: number;
  down_price: number;
  up_bid: number;
  up_ask: number;
  down_bid: number;
  down_ask: number;
  spread: number;
  liquidity: number;
  time_left_seconds: number;
}

export interface Decision {
  direction: Direction;
  confidence: number;
  fair_up: number;
  fair_down: number;
  edge_up: number;
  edge_down: number;
  best_edge: number;
  expected_fee_cost: number;
  forced_trade: boolean;
  action: 'WAIT' | 'ENTER' | 'HOLD' | 'EXIT';
  reasons: string[];
  no_trade_reason?: string;
  indicator_scores: Record<string, number>;
}

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Trade {
  id: string;
  timestamp: number;
  window_id: string;
  direction: 'UP' | 'DOWN';
  status: 'OPEN' | 'RESOLVED' | 'CLOSED' | 'SKIPPED';
  entry_price: number;
  exit_price?: number;
  price_to_beat: number;
  btc_entry_price: number;
  shares_count: number;
  stake: number;
  fee_paid: number;
  pnl: number;
  mark_price?: number;
  current_value?: number;
  unrealized_pnl?: number;
  actual_outcome?: 'WIN' | 'LOSS' | 'PUSH';
  forced_trade: boolean;
  reason: string;
}

export interface Analytics {
  total_pnl: number;
  win_rate: number;
  wins: number;
  losses: number;
  total_trades: number;
  roi: number;
  current_streak: number;
  last_20: Array<'WIN' | 'LOSS' | 'PUSH'>;
  best_trade: number;
  worst_trade: number;
}

export interface LogEntry {
  id: number;
  timestamp: number;
  level: string;
  message: string;
}

export interface LiveStreamPayload {
  status: DashboardPayload;
  candles: Candle[];
  history: Trade[];
  logs: LogEntry[];
  server_time: number;
}

export interface DashboardPayload {
  settings: Settings;
  window: BtcWindow | null;
  decision: Decision | null;
  active_trade: Trade | null;
  analytics: Analytics;
}

export async function getDashboard() {
  const res = await axios.get<DashboardPayload>('/api/status');
  return res.data;
}

export async function getCandles() {
  const res = await axios.get<Candle[]>('/api/candles');
  return res.data;
}

export async function getHistory() {
  const res = await axios.get<Trade[]>('/api/history');
  return res.data;
}

export async function getLogs() {
  const res = await axios.get<LogEntry[]>('/api/logs');
  return res.data;
}

export async function postControl(action: 'start' | 'stop' | 'reset' | 'emergency_stop') {
  const res = await axios.post('/api/control', { action });
  return res.data;
}

export async function postSettings(settings: Partial<Settings>) {
  const res = await axios.post('/api/settings', settings);
  return res.data;
}
