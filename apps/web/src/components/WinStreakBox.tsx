import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Flame, Snowflake, Trophy, TrendingDown } from 'lucide-react';
import axios from 'axios';
import { motion } from 'motion/react';

interface StreakData {
  currentStreak: number;
  bestWinStreak: number;
  worstLossStreak: number;
  last20: { outcome: string; timestamp: number }[];
  trades?: { outcome: string; timestamp: number }[];
  totalResolved: number;
}

export default function WinStreakBox() {
  const [expanded, setExpanded] = useState(false);
  const [streak, setStreak] = useState<StreakData>({
    currentStreak: 0,
    bestWinStreak: 0,
    worstLossStreak: 0,
    last20: [],
    trades: [],
    totalResolved: 0,
  });

  useEffect(() => {
    const fetchStreak = async () => {
      try {
        const res = await axios.get('/api/streak');
        setStreak(res.data);
      } catch (e) {
        console.error('Failed to fetch streak:', e);
      }
    };

    fetchStreak();
    const interval = setInterval(fetchStreak, 1500);
    return () => clearInterval(interval);
  }, []);

  const current = streak.currentStreak;
  const isWinning = current > 0;
  const isLosing = current < 0;
  const absStreak = Math.abs(current);
  const intensity = Math.min(absStreak / 5, 1);
  const tradeDots = streak.trades?.length ? streak.trades : streak.last20;
  const visibleTrades = expanded ? tradeDots : tradeDots.slice(-10);
  const hiddenTradeCount = Math.max(0, tradeDots.length - visibleTrades.length);
  const expandedTrades = [...tradeDots].reverse();

  const formatTradeTime = (timestamp: number) =>
    new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5 }}
      className={`bg-[#131722]/75 backdrop-blur-xl p-4 rounded-xl shadow-xl border transition-all relative overflow-hidden group col-span-2 min-h-[108px] ${
        isWinning
          ? 'border-amber-400/35 shadow-amber-500/10'
          : isLosing
            ? 'border-cyan-400/35 shadow-cyan-500/10'
            : 'border-white/15 hover:border-white/25'
      }`}
    >
      <div
        className={`absolute inset-0 bg-gradient-to-br opacity-30 transition-opacity ${
          isWinning
            ? 'from-amber-500/15 to-transparent'
            : isLosing
              ? 'from-cyan-500/15 to-transparent'
              : 'from-slate-500/10 to-transparent'
        }`}
      />

      <div className="relative z-10 flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(142px,0.9fr)_minmax(180px,1.45fr)_minmax(138px,0.8fr)] sm:items-center">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${
                isWinning
                  ? 'bg-amber-500/15 border border-amber-500/35'
                  : isLosing
                    ? 'bg-cyan-500/15 border border-cyan-500/35'
                    : 'bg-slate-700/35 border border-slate-500/35'
              }`}
            >
              {isWinning ? (
                <Flame
                  className={`w-6 h-6 text-amber-400 ${absStreak >= 3 ? 'animate-pulse' : ''}`}
                  style={{ filter: `drop-shadow(0 0 ${5 + intensity * 12}px rgba(251, 191, 36, ${0.45 + intensity * 0.4}))` }}
                />
              ) : isLosing ? (
                <Snowflake
                  className={`w-6 h-6 text-cyan-400 ${absStreak >= 3 ? 'animate-pulse' : ''}`}
                  style={{ filter: `drop-shadow(0 0 ${5 + intensity * 12}px rgba(34, 211, 238, ${0.45 + intensity * 0.4}))` }}
                />
              ) : (
                <span className="text-slate-400 text-xl">-</span>
              )}
            </div>

            <div className="min-w-0">
              <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-slate-400 sm:text-[11px]">Current Streak</div>
              <div
                className={`text-3xl font-mono font-bold leading-none ${
                  isWinning ? 'text-amber-300' : isLosing ? 'text-cyan-300' : 'text-slate-400'
                }`}
                style={
                  isWinning
                    ? { textShadow: `0 0 ${8 + intensity * 14}px rgba(251, 191, 36, ${0.35 + intensity * 0.4})` }
                    : isLosing
                      ? { textShadow: `0 0 ${8 + intensity * 14}px rgba(34, 211, 238, ${0.35 + intensity * 0.4})` }
                      : {}
                }
              >
                {isWinning ? `${absStreak}W` : isLosing ? `${absStreak}L` : '0'}
              </div>
            </div>
          </div>

          <div className="min-w-0 rounded-lg border border-white/5 bg-black/10 px-3 py-2.5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-medium sm:text-[11px]">
                {expanded ? `Showing all ${tradeDots.length}` : `Last ${Math.min(10, tradeDots.length)} trades`}
              </div>
              {tradeDots.length > 10 && (
                <button
                  type="button"
                  onClick={() => setExpanded((value) => !value)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-purple-400/25 bg-purple-400/10 px-3 py-1 text-[10px] font-semibold text-purple-100 shadow-[0_0_16px_rgba(168,85,247,0.12)] transition hover:border-purple-300/50 hover:bg-purple-400/15"
                >
                  {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {expanded ? 'Collapse' : 'Show all'}
                </button>
              )}
            </div>
            <div className="flex min-h-[18px] flex-wrap items-center justify-start gap-1.5">
              {tradeDots.length === 0 ? (
                <span className="text-xs text-slate-500 italic">No trades yet</span>
              ) : (
                <>
                {!expanded && hiddenTradeCount > 0 && (
                  <span className="mr-0.5 rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] leading-none text-slate-400 font-mono">+{hiddenTradeCount}</span>
                )}
                {visibleTrades.map((t, i) => (
                  <div
                    key={`${t.timestamp}-${i}`}
                    className={`h-2.5 w-2.5 shrink-0 rounded-full transition-all ${
                      t.outcome === 'WIN'
                        ? 'bg-emerald-400 shadow-[0_0_7px_rgba(52,211,153,0.75)]'
                        : 'bg-rose-400 shadow-[0_0_7px_rgba(251,113,133,0.75)]'
                    }`}
                    title={`${t.outcome} at ${formatTradeTime(t.timestamp)}`}
                  />
                ))}
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-1 sm:gap-1.5">
            <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-400/15 bg-amber-400/5 px-3 py-2 sm:justify-end sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
              <div className="flex items-center gap-1.5">
                <Trophy className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-[11px] text-slate-400">Best</span>
              </div>
              <span className="text-sm font-mono font-bold text-amber-300">{streak.bestWinStreak}W</span>
            </div>
            <div className="flex items-center justify-between gap-2 rounded-lg border border-cyan-400/15 bg-cyan-400/5 px-3 py-2 sm:justify-end sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
              <div className="flex items-center gap-1.5">
                <TrendingDown className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-[11px] text-slate-400">Worst</span>
              </div>
              <span className="text-sm font-mono font-bold text-cyan-300">{Math.abs(streak.worstLossStreak)}L</span>
            </div>
            <div className="col-span-2 text-left text-[11px] text-slate-500 sm:col-span-1 sm:text-right">{streak.totalResolved} total resolved</div>
          </div>
        </div>

        {expanded && tradeDots.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-white/10 bg-[#080A12]/80 p-3 shadow-inner shadow-black/30"
          >
            <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-slate-500">
              <span>Trade tape</span>
              <span>{tradeDots.length} resolved</span>
            </div>
            <div className="grid max-h-48 grid-cols-1 gap-1.5 overflow-y-auto pr-1 custom-scrollbar min-[420px]:grid-cols-2 lg:grid-cols-3">
              {expandedTrades.map((trade, index) => (
                <div
                  key={`expanded-${trade.timestamp}-${index}`}
                  className={`flex items-center justify-between rounded-lg border px-2.5 py-2 text-xs ${
                    trade.outcome === 'WIN'
                      ? 'border-emerald-400/15 bg-emerald-400/5 text-emerald-200'
                      : 'border-rose-400/15 bg-rose-400/5 text-rose-200'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${
                        trade.outcome === 'WIN' ? 'bg-emerald-400 shadow-[0_0_7px_rgba(52,211,153,0.75)]' : 'bg-rose-400 shadow-[0_0_7px_rgba(251,113,133,0.75)]'
                      }`}
                    />
                    <span className="font-semibold">{trade.outcome}</span>
                  </span>
                  <span className="font-mono text-slate-400">{formatTradeTime(trade.timestamp)}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
