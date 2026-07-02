import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import PriceChart from './PriceChart';
import PredictionCard from './PredictionCard';
import NewsFeed from './NewsFeed';
import ControlPanel from './ControlPanel';
import ResolutionTimer from './ResolutionTimer';
import SystemLogs from './SystemLogs';
import WinStreakBox from './WinStreakBox';
import { Activity, RefreshCw, TrendingUp, Wallet, AlertCircle } from 'lucide-react';
import { formatET } from '../utils';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { Candle, DashboardPayload, getCandles, getDashboard, getHistory, Trade } from '../api';
import { useBinancePrice } from '../hooks/useBinancePrice';

const emptyDashboard: DashboardPayload = {
  settings: {
    starting_balance: 1000,
    balance: 1000,
    stake_amount: 25,
    max_trade_amount: 50,
    risk_mode: 'balanced',
    bot_state: 'stopped',
    taker_fee_rate: 0.018,
    forced_cadence_every: 3,
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
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const prevOpenTradeRef = useRef<string | null>(null);
  const { price: livePrice } = useBinancePrice();

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
    fetchData();
    const interval = setInterval(fetchData, 1000);
    return () => clearInterval(interval);
  }, []);

  const activeTrades = useMemo(() => history.filter((h) => h.status === 'OPEN'), [history]);
  const closedTrades = useMemo(() => history.filter((h) => h.status !== 'OPEN' && h.status !== 'SKIPPED'), [history]);
  const headlines = data.decision?.reasons || [];

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0E14] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-violet-900/20 via-[#0B0E14] to-[#0B0E14] p-6 text-slate-100 font-sans">
      <header className="max-w-7xl mx-auto mb-8 flex justify-between items-center">
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <div className="flex items-center gap-4">
            <img src="/polyengine-logo-wide.png" alt="PolyEngine" className="h-16 md:h-20 w-auto object-contain drop-shadow-[0_0_18px_rgba(34,211,238,0.25)]" />
            <span className="px-2 py-0.5 bg-cyan-500/10 text-cyan-300 text-xs font-bold rounded border border-cyan-500/20 shadow-[0_0_10px_rgba(34,211,238,0.2)]">
              BTC 5M POLYMARKET ENGINE
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-2">Fee-aware BTC 5-minute Up/Down paper trading cockpit</p>
        </motion.div>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="flex items-center gap-4">
          <div className="text-xs text-slate-400 flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Updated: {formatET(lastUpdated.getTime())}
          </div>
          <div className={`h-2 w-2 rounded-full animate-pulse ${data.settings.bot_state === 'running' ? 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)]' : 'bg-slate-600'}`} />
        </motion.div>
      </header>

      <main className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="flex flex-col gap-6">
          <ControlPanel settings={data.settings} onUpdate={fetchData} />

          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.4 }}
            className="grid grid-cols-2 gap-4"
          >
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
          <PredictionCard window={data.window ? { ...data.window, current_price: livePrice || data.window.current_price } : null} decision={data.decision} activeTrade={data.active_trade} />
        </div>

        <div className="lg:col-span-2 flex flex-col gap-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2">
              <PriceChart data={candles} currentPrice={livePrice || data.window?.current_price || null} priceToBeat={data.window?.price_to_beat || null} />
            </div>
            <div className="md:col-span-1">
              <ResolutionTimer targetTimestamp={data.window?.window_end || null} />
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
                    ) : activeTrades.map((h) => <TradeRow key={h.id} trade={h} active />)}
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
                  ) : closedTrades.map((h) => <TradeRow key={h.id} trade={h} />)}
                </AnimatePresence>
              </div>
            </div>
          </div>

          <SystemLogs />
        </div>
      </main>
    </div>
  );
}

function MetricCard({ label, icon, value, sub, tone = 'white' }: { label: string; icon: React.ReactNode; value: string; sub?: React.ReactNode; tone?: 'blue' | 'pink' | 'white' }) {
  return (
    <div className="bg-[#131722]/60 backdrop-blur-xl p-4 rounded-xl shadow-lg border border-white/10 hover:border-white/20 transition-all relative overflow-hidden group">
      <div className="flex items-center gap-2 text-xs text-slate-400 mb-1 relative z-10">{icon} {label}</div>
      <div className={`text-xl font-mono font-bold relative z-10 ${tone === 'blue' ? 'text-blue-400' : tone === 'pink' ? 'text-pink-500' : 'text-white'}`}>{value}</div>
      {sub && <div className="text-xs text-slate-400 relative z-10 mt-1">{sub}</div>}
    </div>
  );
}

function TradeRow({ trade, active = false }: { trade: Trade; active?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={`flex justify-between items-center text-xs p-3 rounded-lg border transition-all ${active ? 'bg-blue-900/20 border-blue-500/40 shadow-[0_0_15px_rgba(59,130,246,0.15)]' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
    >
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-slate-400">{formatET(trade.timestamp)}</span>
          <span className={`font-bold ${trade.direction === 'UP' ? 'text-blue-400' : 'text-pink-500'}`}>{trade.direction}</span>
          {trade.forced_trade && <span className="text-[10px] bg-orange-500/10 text-orange-300 px-1.5 py-0.5 rounded border border-orange-500/20">FORCED</span>}
        </div>
        <div className="text-slate-400 text-[10px] flex items-center gap-2">
          <span>Entry ${trade.btc_entry_price.toFixed(2)}</span>
          <span className="text-slate-600">-</span>
          <span>{(trade.entry_price * 100).toFixed(1)}c</span>
          <span className="text-slate-600">-</span>
          <span>fee ${trade.fee_paid.toFixed(2)}</span>
        </div>
      </div>
      <div className="text-right">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold mb-1 inline-block ${trade.actual_outcome === 'WIN' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : active ? 'bg-blue-500/10 text-blue-300 border border-blue-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
          {active ? 'OPEN' : trade.actual_outcome || trade.status}
        </span>
        <div className={`font-mono font-medium ${trade.pnl > 0 ? 'text-emerald-400' : trade.pnl < 0 ? 'text-rose-400' : 'text-slate-500'}`}>
          {trade.pnl > 0 ? '+' : ''}{trade.pnl.toFixed(2)}
        </div>
      </div>
    </motion.div>
  );
}
