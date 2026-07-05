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

      <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 h-full">
        <div className="flex items-center gap-3 min-w-0 sm:min-w-[154px]">
          <div
            className={`relative flex items-center justify-center w-12 h-12 rounded-lg ${
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

          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400 mb-1">Current Streak</div>
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

        <div className="flex-1 flex flex-col items-start sm:items-center gap-2 min-w-0">
          <div className="flex w-full items-center justify-between gap-3 sm:justify-center">
            <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400 font-medium">
              {expanded ? `All ${tradeDots.length} Trades` : `Last ${Math.min(10, tradeDots.length)} Trades`}
            </div>
            {tradeDots.length > 10 && (
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-medium text-slate-300 transition hover:border-purple-400/40 hover:text-white sm:absolute sm:right-4 sm:bottom-3"
              >
                {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {expanded ? 'Collapse' : 'Show all'}
              </button>
            )}
          </div>
          <div className={`flex items-center gap-1 flex-wrap justify-start sm:justify-center min-h-[18px] px-1 ${expanded ? 'max-h-36 overflow-y-auto custom-scrollbar pr-1' : 'max-h-[38px] overflow-hidden'}`}>
            {tradeDots.length === 0 ? (
              <span className="text-xs text-slate-500 italic">No trades yet</span>
            ) : (
              <>
              {!expanded && hiddenTradeCount > 0 && (
                <span className="text-[10px] leading-none text-slate-500 font-mono mr-0.5">+{hiddenTradeCount}</span>
              )}
              {visibleTrades.map((t, i) => (
                <div
                  key={`${t.timestamp}-${i}`}
                  className={`w-2 h-2 rounded-full transition-all shrink-0 ${
                    t.outcome === 'WIN'
                      ? 'bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.65)]'
                      : 'bg-rose-400 shadow-[0_0_5px_rgba(251,113,133,0.65)]'
                  }`}
                  title={`${t.outcome} at ${new Date(t.timestamp).toLocaleTimeString()}`}
                />
              ))}
              </>
            )}
          </div>
        </div>

        <div className="flex flex-row justify-between gap-3 text-right sm:flex-col sm:gap-1 sm:min-w-[86px]">
          <div className="flex items-center justify-end gap-1.5">
            <Trophy className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-[11px] text-slate-400">Best</span>
            <span className="text-sm font-mono font-bold text-amber-300">{streak.bestWinStreak}W</span>
          </div>
          <div className="flex items-center justify-end gap-1.5">
            <TrendingDown className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-[11px] text-slate-400">Worst</span>
            <span className="text-sm font-mono font-bold text-cyan-300">{Math.abs(streak.worstLossStreak)}L</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">{streak.totalResolved} total</div>
        </div>
      </div>
    </motion.div>
  );
}
