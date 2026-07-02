import { useEffect, useState } from 'react';
import { Flame, Snowflake, Trophy, TrendingDown } from 'lucide-react';
import axios from 'axios';
import { motion } from 'motion/react';

interface StreakData {
  currentStreak: number;
  bestWinStreak: number;
  worstLossStreak: number;
  last20: { outcome: string; timestamp: number }[];
  totalResolved: number;
}

export default function WinStreakBox() {
  const [streak, setStreak] = useState<StreakData>({
    currentStreak: 0,
    bestWinStreak: 0,
    worstLossStreak: 0,
    last20: [],
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

      <div className="relative z-10 flex items-center justify-between gap-4 h-full">
        <div className="flex items-center gap-3 min-w-[154px]">
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

        <div className="flex-1 flex flex-col items-center gap-2 min-w-0">
          <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400 font-medium">
            Last {streak.last20.length} Trades
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-center min-h-[16px]">
            {streak.last20.length === 0 ? (
              <span className="text-xs text-slate-500 italic">No trades yet</span>
            ) : (
              streak.last20.map((t, i) => (
                <div
                  key={i}
                  className={`w-3 h-3 rounded-full transition-all ${
                    t.outcome === 'WIN'
                      ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.75)]'
                      : 'bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.75)]'
                  }`}
                  title={`${t.outcome} at ${new Date(t.timestamp).toLocaleTimeString()}`}
                />
              ))
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1 text-right min-w-[86px]">
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
