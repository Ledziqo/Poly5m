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

  const border = isWinning
    ? 'border-amber-400/35 shadow-amber-500/10'
    : isLosing
      ? 'border-cyan-400/35 shadow-cyan-500/10'
      : 'border-white/15 shadow-black/30';

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5 }}
      className={`bg-[#131722]/85 backdrop-blur-xl p-5 rounded-2xl shadow-2xl border ${border} transition-all relative overflow-hidden group col-span-2`}
    >
      <div
        className={`absolute inset-0 bg-gradient-to-br opacity-35 ${
          isWinning
            ? 'from-amber-500/15 via-transparent to-transparent'
            : isLosing
              ? 'from-cyan-500/15 via-transparent to-transparent'
              : 'from-slate-500/8 via-transparent to-transparent'
        }`}
      />

      <div className="relative z-10 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div
            className={`relative flex items-center justify-center w-14 h-14 rounded-xl ${
              isWinning
                ? 'bg-amber-500/15 border border-amber-500/30'
                : isLosing
                  ? 'bg-cyan-500/15 border border-cyan-500/30'
                  : 'bg-slate-700/30 border border-slate-600/30'
            }`}
          >
            {isWinning ? (
              <Flame
                className={`w-7 h-7 text-amber-400 ${absStreak >= 3 ? 'animate-pulse' : ''}`}
                style={{ filter: `drop-shadow(0 0 ${6 + intensity * 16}px rgba(251, 191, 36, ${0.45 + intensity * 0.4}))` }}
              />
            ) : isLosing ? (
              <Snowflake
                className={`w-7 h-7 text-cyan-400 ${absStreak >= 3 ? 'animate-pulse' : ''}`}
                style={{ filter: `drop-shadow(0 0 ${6 + intensity * 16}px rgba(34, 211, 238, ${0.45 + intensity * 0.4}))` }}
              />
            ) : (
              <span className="text-slate-500 text-2xl">-</span>
            )}
          </div>

          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-slate-400 mb-1">Current Streak</div>
            <div
              className={`text-4xl font-mono font-bold tracking-tight ${
                isWinning ? 'text-amber-400' : isLosing ? 'text-cyan-400' : 'text-slate-500'
              }`}
              style={
                isWinning
                  ? { textShadow: `0 0 ${10 + intensity * 18}px rgba(251, 191, 36, ${0.35 + intensity * 0.4})` }
                  : isLosing
                    ? { textShadow: `0 0 ${10 + intensity * 18}px rgba(34, 211, 238, ${0.35 + intensity * 0.4})` }
                    : {}
              }
            >
              {isWinning ? `${absStreak}W` : isLosing ? `${absStreak}L` : '0'}
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center gap-2">
          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-medium">
            Last {streak.last20.length} Trades
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-center">
            {streak.last20.length === 0 ? (
              <span className="text-[11px] text-slate-600 italic">No trades yet</span>
            ) : (
              streak.last20.map((t, i) => (
                <div
                  key={i}
                  className={`w-3.5 h-3.5 rounded-full transition-all ${
                    t.outcome === 'WIN'
                      ? 'bg-emerald-400 shadow-[0_0_9px_rgba(52,211,153,0.75)]'
                      : 'bg-rose-400 shadow-[0_0_9px_rgba(251,113,133,0.75)]'
                  }`}
                  title={`${t.outcome} at ${new Date(t.timestamp).toLocaleTimeString()}`}
                />
              ))
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 text-right min-w-[92px]">
          <div className="flex items-center justify-end gap-1.5">
            <Trophy className="w-4 h-4 text-amber-500/80" />
            <span className="text-[11px] text-slate-500">Best</span>
            <span className="text-sm font-mono font-bold text-amber-300">{streak.bestWinStreak}W</span>
          </div>
          <div className="flex items-center justify-end gap-1.5">
            <TrendingDown className="w-4 h-4 text-cyan-500/80" />
            <span className="text-[11px] text-slate-500">Worst</span>
            <span className="text-sm font-mono font-bold text-cyan-300">{Math.abs(streak.worstLossStreak)}L</span>
          </div>
          <div className="text-[11px] text-slate-600 mt-0.5">{streak.totalResolved} total</div>
        </div>
      </div>
    </motion.div>
  );
}
