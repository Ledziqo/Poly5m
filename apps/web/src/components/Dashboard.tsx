import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import PriceChart from './PriceChart';
import PredictionCard from './PredictionCard';
import NewsFeed from './NewsFeed';
import ControlPanel from './ControlPanel';
import ResolutionTimer from './ResolutionTimer';
import SystemLogs from './SystemLogs';
import WinStreakBox from './WinStreakBox';
import BrainPerformancePanel from './BrainPerformancePanel';
import { Activity, RefreshCw, TrendingUp, Wallet, AlertCircle, CircleDollarSign } from 'lucide-react';
import { formatET, formatLocalTime } from '../utils';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { Candle, DashboardPayload, getCandles, getDashboard, getHistory, LiveStreamPayload, LogEntry, Trade } from '../api';

const emptyDashboard: DashboardPayload = {
  settings: {
    starting_balance: 1000,
    balance: 1000,
    stake_amount: 25,
    max_trade_amount: 50,
    risk_mode: 'balanced',
    bot_state: 'stopped',
    taker_fee_rate: 0.018,
    forced_cadence_every: 2,
    skipped_windows: 0,
  },
  window: null,
  decision: null,
  active_trade: null,
  analytics: {
    total_pnl: 0,
    win_rate: 0,
    wins: 0,
    losses: 0,
    total_trades: 0,
    roi: 0,
    current_streak: 0,
    last_20: [],
    best_trade: 0,
    worst_trade: 0,
  },
};

export default function Dashboard() {
  const [data, setData] = useState<DashboardPayload>(emptyDashboard);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [history, setHistory] = useState<Trade[]>([]);
  const [streamLogs, setStreamLogs] = useState<LogEntry[]>([]);
  const [streamConnected, setStreamConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [serverTime, setServerTime] = useState<number | null>(null);
  const prevOpenTradeRef = useRef<string | null>(null);
  const lastStreamPaintRef = useRef(0);
  const queuedStreamRef = useRef<LiveStreamPayload | null>(null);
  const streamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = async () => {
    try {
      const [status, candleData, tradeData] = await Promise.all([
        getDashboard(),
        getCandles(),
        getHistory(),
      ]);

      setData(status);
      setCandles(Array.isArray(candleData) ? candleData : []);
      setHistory(Array.isArray(tradeData) ? tradeData : []);
      setServerTime(status.server_time || null);

      if (status.active_trade && status.active_trade.id !== prevOpenTradeRef.current) {
        toast.success(`Bot entered ${status.active_trade.direction}`, {
          description: `${(status.active_trade.entry_price * 100).toFixed(1)}c | ${status.active_trade.reason}`,
        });
      }
      prevOpenTradeRef.current = status.active_trade?.id || null;
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let fallbackInterval: ReturnType<typeof setInterval> | null = null;
    const applyStreamPayload = (payload: LiveStreamPayload) => {
      const status = payload.status;
      setData(status);
      setCandles(Array.isArray(payload.candles) ? payload.candles : []);
      setHistory(Array.isArray(payload.history) ? payload.history : []);
      setStreamLogs(Array.isArray(payload.logs) ? payload.logs : []);
      setServerTime(payload.server_time || null);

      if (status.active_trade && status.active_trade.id !== prevOpenTradeRef.current) {
        toast.success(`Bot entered ${status.active_trade.direction}`, {
          description: `${(status.active_trade.entry_price * 100).toFixed(1)}c | ${status.active_trade.reason}`,
        });
      }
      prevOpenTradeRef.current = status.active_trade?.id || null;
      setLastUpdated(new Date());
      setLoading(false);
    };

    const scheduleStreamPayload = (payload: LiveStreamPayload) => {
      queuedStreamRef.current = payload;
      const elapsed = Date.now() - lastStreamPaintRef.current;
      if (elapsed >= 250) {
        lastStreamPaintRef.current = Date.now();
        applyStreamPayload(payload);
        queuedStreamRef.current = null;
        return;
      }
      if (!streamTimerRef.current) {
        streamTimerRef.current = setTimeout(() => {
          streamTimerRef.current = null;
          const queued = queuedStreamRef.current;
          if (!queued) return;
          lastStreamPaintRef.current = Date.now();
          applyStreamPayload(queued);
          queuedStreamRef.current = null;
        }, 250 - elapsed);
      }
    };

    const stream = new EventSource('/api/stream');

    stream.onopen = () => {
      setStreamConnected(true);
      if (fallbackInterval) {
        clearInterval(fallbackInterval);
        fallbackInterval = null;
      }
    };

    stream.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as LiveStreamPayload;
        scheduleStreamPayload(payload);
      } catch (error) {
        console.error('Error parsing live stream:', error);
      }
    };

    stream.onerror = () => {
      setStreamConnected(false);
      if (!fallbackInterval) {
        fetchData();
        fallbackInterval = setInterval(fetchData, 500);
      }
    };

    fetchData();
    return () => {
      stream.close();
      if (fallbackInterval) clearInterval(fallbackInterval);
      if (streamTimerRef.current) clearTimeout(streamTimerRef.current);
    };
  }, []);

  const activeTrades = useMemo(() => {
    if (data.active_trade?.status === 'OPEN') return [data.active_trade];
    return history.filter((h) => h.status === 'OPEN');
  }, [data.active_trade, history]);
  const closedTrades = useMemo(() => history.filter((h) => h.status !== 'OPEN' && h.status !== 'SKIPPED' && h.id !== data.active_trade?.id), [history, data.active_trade?.id]);
  const headlines = data.decision?.reasons || [];

  if (loading) {
    return (
      <div className="min-h-screen bg-[#07070A] flex items-center justify-center">
        <div className="h-12 w-12 border border-[#403653] border-b-[#CBB9FF] animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#07070A] bg-[linear-gradient(90deg,rgba(203,185,255,0.035)_1px,transparent_1px),linear-gradient(rgba(203,185,255,0.035)_1px,transparent_1px)] bg-[size:56px_56px] px-3 py-4 text-slate-100 font-sans sm:p-6">
      <header className="max-w-7xl mx-auto mb-5 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <div className="flex items-center gap-4">
            <img src="/polyengine-icon-logo.png" alt="PolyEngine" className="h-14 w-14 object-cover border border-[#4A3A6A] sm:h-16 sm:w-16" loading="eager" fetchPriority="high" />
            <div>
              <div className="text-lg font-semibold uppercase tracking-[0.16em] text-white sm:text-xl sm:tracking-[0.2em]">PolyEngine</div>
              <div className="mt-1 inline-flex border border-[#403653] bg-[#15111F] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-[#CBB9FF]">
                BTC 5M POLYMARKET ENGINE
              </div>
            </div>
          </div>
          <p className="text-xs text-[#B7AFC7] mt-2 sm:text-sm">Fee-aware BTC 5-minute Up/Down paper trading cockpit</p>
        </motion.div>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="flex items-center justify-between gap-3 sm:justify-end sm:gap-4">
          <div className="min-w-0 text-[11px] text-[#B7AFC7] flex items-center gap-1 border border-[#403653] bg-[#0D0B12]/90 px-3 py-2 sm:text-xs">
            <RefreshCw className="w-3 h-3 text-[#CBB9FF]" /> {streamConnected ? 'Live stream' : 'Polling backup'}: {formatET(lastUpdated.getTime())}
          </div>
          <div className={`h-2 w-2 animate-pulse ${data.settings.bot_state === 'running' ? 'bg-[#CBB9FF] shadow-[0_0_10px_rgba(203,185,255,0.7)]' : 'bg-slate-600'}`} />
        </motion.div>
      </header>

      <main className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="flex flex-col gap-6">
          <ControlPanel settings={data.settings} onUpdate={fetchData} />

          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.4 }}
            className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:gap-4"
          >
            <MetricCard
              label="Current Balance"
              icon={<CircleDollarSign className="w-3 h-3 text-emerald-400" />}
              value={`$${data.settings.balance.toFixed(2)}`}
              sub={`Start $${data.settings.starting_balance.toFixed(0)}`}
              tone="green"
            />
            <MetricCard
              label="Total PnL"
              icon={<TrendingUp className="w-3 h-3 text-blue-400" />}
              value={`${data.analytics.total_pnl >= 0 ? '+' : ''}$${data.analytics.total_pnl.toFixed(2)}`}
              tone={data.analytics.total_pnl >= 0 ? 'blue' : 'pink'}
            />
            <MetricCard
              label="Win Rate"
              icon={<AlertCircle className="w-3 h-3 text-purple-400" />}
              value={`${data.analytics.win_rate.toFixed(1)}%`}
              sub={<><span className="text-emerald-400 font-medium">{data.analytics.wins}W</span> / <span className="text-rose-400 font-medium">{data.analytics.losses}L</span></>}
            />
          </motion.div>

          <WinStreakBox />
          <BrainPerformancePanel />
          <PredictionCard window={data.window} decision={data.decision} activeTrade={data.active_trade} />
        </div>

        <div className="lg:col-span-2 flex flex-col gap-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2">
              <PriceChart data={candles} currentPrice={data.window?.current_price || null} priceToBeat={data.window?.price_to_beat || null} />
            </div>
            <div className="md:col-span-1">
              <ResolutionTimer targetTimestamp={data.window?.window_end || null} serverTime={serverTime} timeLeftSeconds={data.window?.time_left_seconds ?? null} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <NewsFeed headlines={headlines} sentiment={data.decision?.confidence ?? 0} />

            <div className="bg-[#131722]/60 backdrop-blur-xl p-6 rounded-xl shadow-lg border border-white/10 hover:border-white/20 transition-all h-full overflow-hidden flex flex-col">
              <div className="mb-6 pb-4 border-b border-white/10">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-blue-400" /> Active Trades
                  </h3>
                  <span className="text-xs text-slate-400">{activeTrades.length} active</span>
                </div>
                <div className="space-y-2">
                  <AnimatePresence>
                    {activeTrades.length === 0 ? (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center py-4 text-slate-500 text-xs italic">No active trades</motion.div>
                    ) : activeTrades.map((h) => (
                      <Fragment key={h.id}>
                        <TradeRow trade={h} active />
                      </Fragment>
                    ))}
                  </AnimatePresence>
                </div>
              </div>

              <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-purple-400" /> Trade History
                </h3>
              </div>

              <div className="overflow-y-auto flex-1 pr-2 space-y-2 max-h-[300px] custom-scrollbar">
                <AnimatePresence>
                  {closedTrades.length === 0 ? (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-8 text-slate-600 text-sm">No resolved trades yet...</motion.div>
                  ) : closedTrades.map((h) => (
                    <Fragment key={h.id}>
                      <TradeRow trade={h} />
                    </Fragment>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          </div>

          <SystemLogs streamLogs={streamLogs} />
        </div>
      </main>
    </div>
  );
}

function MetricCard({ label, icon, value, sub, tone = 'white' }: { label: string; icon: React.ReactNode; value: string; sub?: React.ReactNode; tone?: 'blue' | 'pink' | 'green' | 'white' }) {
  return (
    <div className="bg-[#131722]/60 backdrop-blur-xl p-4 rounded-xl shadow-lg border border-white/10 hover:border-white/20 transition-all relative overflow-hidden group min-w-0">
      <div className="flex items-center gap-2 text-xs text-slate-400 mb-1 relative z-10">{icon} {label}</div>
      <div className={`text-lg font-mono font-bold relative z-10 break-words sm:text-xl ${tone === 'blue' ? 'text-blue-400' : tone === 'pink' ? 'text-pink-500' : tone === 'green' ? 'text-emerald-400' : 'text-white'}`}>{value}</div>
      {sub && <div className="text-xs text-slate-400 relative z-10 mt-1">{sub}</div>}
    </div>
  );
}

function TradeRow({ trade, active = false }: { trade: Trade; active?: boolean }) {
  const numberOrNull = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  const livePnl = numberOrNull(active ? (trade.unrealized_pnl ?? trade.pnl) : trade.pnl) ?? 0;
  const markPrice = numberOrNull(active ? trade.mark_price : trade.exit_price);
  const entryBtc = numberOrNull(trade.btc_entry_price);
  const beatBtc = numberOrNull(trade.price_to_beat);
  const endingBtc = active ? null : numberOrNull(trade.btc_exit_price);
  const entryPrice = numberOrNull(trade.entry_price);
  const feePaid = numberOrNull(trade.fee_paid) ?? 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={`flex flex-col gap-3 text-xs p-3 rounded-lg border transition-all sm:flex-row sm:items-center sm:justify-between ${active ? 'bg-blue-900/20 border-blue-500/40 shadow-[0_0_15px_rgba(59,130,246,0.15)]' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className="text-slate-400">{formatET(trade.timestamp)}</span>
          <span className="text-slate-600">/</span>
          <span className="text-slate-500">{formatLocalTime(trade.timestamp)}</span>
          <span className={`font-bold ${trade.direction === 'UP' ? 'text-blue-400' : 'text-pink-500'}`}>{trade.direction}</span>
        </div>
        <div className="text-slate-400 text-[10px] flex flex-wrap items-center gap-2">
          {entryBtc !== null && <span>Entry ${entryBtc.toFixed(2)}</span>}
          {entryBtc !== null && beatBtc !== null && <span className="text-slate-600">-</span>}
          {beatBtc !== null && <span>Beat ${beatBtc.toFixed(2)}</span>}
          {(entryBtc !== null || beatBtc !== null) && (endingBtc !== null || entryPrice !== null) && <span className="text-slate-600">-</span>}
          {endingBtc !== null && (
            <>
              <span>End ${endingBtc.toFixed(2)}</span>
              <span className="text-slate-600">-</span>
            </>
          )}
          {entryPrice !== null && <span>{(entryPrice * 100).toFixed(1)}c</span>}
          <span className="text-slate-600">-</span>
          <span>fee ${feePaid.toFixed(2)}</span>
          {active && markPrice !== null && (
            <>
              <span className="text-slate-600">-</span>
              <span>mark {(markPrice * 100).toFixed(1)}c</span>
            </>
          )}
        </div>
      </div>
      <div className="text-left sm:text-right">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold mb-1 inline-block ${trade.actual_outcome === 'WIN' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : active ? 'bg-blue-500/10 text-blue-300 border border-blue-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
          {active ? 'OPEN' : trade.actual_outcome || trade.status}
        </span>
        <div className={`font-mono font-medium ${livePnl > 0 ? 'text-emerald-400' : livePnl < 0 ? 'text-rose-400' : 'text-slate-500'}`}>
          {livePnl > 0 ? '+' : ''}{livePnl.toFixed(2)}
        </div>
        {active && trade.current_value !== undefined && (
          <div className="text-[10px] text-slate-500">value ${trade.current_value.toFixed(2)}</div>
        )}
      </div>
    </motion.div>
  );
}
