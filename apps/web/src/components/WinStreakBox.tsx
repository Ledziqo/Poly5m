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
        totalResolved: 0
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
        const interval = setInterval(fetchStreak, 5000);
        return () => clearInterval(interval);
    }, []);

    const current = streak.currentStreak;
    const isWinning = current > 0;
    const isLosing = current < 0;
    const absStreak = Math.abs(current);

    // Intensity scales with streak length
    const intensity = Math.min(absStreak / 5, 1);

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="bg-[#131722]/60 backdrop-blur-xl p-4 rounded-xl shadow-lg border border-white/10 hover:border-white/20 transition-all relative overflow-hidden group col-span-2"
        >
            <div className={`absolute inset-0 bg-gradient-to-br opacity-0 group-hover:opacity-100 transition-opacity ${isWinning ? 'from-amber-500/5 to-transparent' :
                isLosing ? 'from-cyan-500/5 to-transparent' :
                    'from-slate-500/5 to-transparent'
                }`}></div>

            <div className="relative z-10 flex items-center justify-between gap-4">
                {/* Left: Icon + Streak Count */}
                <div className="flex items-center gap-3">
                    <div className={`relative flex items-center justify-center w-10 h-10 rounded-lg ${isWinning ? 'bg-amber-500/15 border border-amber-500/30' :
                        isLosing ? 'bg-cyan-500/15 border border-cyan-500/30' :
                            'bg-slate-700/30 border border-slate-600/30'
                        }`}>
                        {isWinning ? (
                            <Flame className={`w-5 h-5 text-amber-400 ${absStreak >= 3 ? 'animate-pulse' : ''}`}
                                style={{ filter: `drop-shadow(0 0 ${4 + intensity * 12}px rgba(251, 191, 36, ${0.4 + intensity * 0.4}))` }}
                            />
                        ) : isLosing ? (
                            <Snowflake className={`w-5 h-5 text-cyan-400 ${absStreak >= 3 ? 'animate-pulse' : ''}`}
                                style={{ filter: `drop-shadow(0 0 ${4 + intensity * 12}px rgba(34, 211, 238, ${0.4 + intensity * 0.4}))` }}
                            />
                        ) : (
                            <span className="text-slate-500 text-lg">—</span>
                        )}
                    </div>

                    <div>
                        <div className="text-xs text-slate-400 mb-0.5">Current Streak</div>
                        <div className={`text-2xl font-mono font-bold tracking-tight ${isWinning ? 'text-amber-400' :
                            isLosing ? 'text-cyan-400' :
                                'text-slate-500'
                            }`}
                            style={isWinning ? { textShadow: `0 0 ${8 + intensity * 16}px rgba(251, 191, 36, ${0.3 + intensity * 0.4})` } :
                                isLosing ? { textShadow: `0 0 ${8 + intensity * 16}px rgba(34, 211, 238, ${0.3 + intensity * 0.4})` } : {}}
                        >
                            {isWinning ? `${absStreak}W` : isLosing ? `${absStreak}L` : '0'}
                            {absStreak >= 5 && isWinning && ' 🔥'}
                            {absStreak >= 5 && isLosing && ' ❄️'}
                        </div>
                    </div>
                </div>

                {/* Center: Dot Trail */}
                <div className="flex-1 flex flex-col items-center gap-1.5">
                    <div className="text-[10px] text-slate-500 font-medium">Last {streak.last20.length} Trades</div>
                    <div className="flex items-center gap-1 flex-wrap justify-center">
                        {streak.last20.length === 0 ? (
                            <span className="text-[10px] text-slate-600 italic">No trades yet</span>
                        ) : (
                            streak.last20.map((t, i) => (
                                <div
                                    key={i}
                                    className={`w-2.5 h-2.5 rounded-full transition-all ${t.outcome === 'WIN'
                                        ? 'bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.5)]'
                                        : 'bg-rose-400 shadow-[0_0_4px_rgba(251,113,133,0.5)]'
                                        }`}
                                    title={`${t.outcome} at ${new Date(t.timestamp).toLocaleTimeString()}`}
                                />
                            ))
                        )}
                    </div>
                </div>

                {/* Right: Records */}
                <div className="flex flex-col gap-1 text-right min-w-[80px]">
                    <div className="flex items-center justify-end gap-1.5">
                        <Trophy className="w-3 h-3 text-amber-500/70" />
                        <span className="text-[10px] text-slate-500">Best</span>
                        <span className="text-xs font-mono font-bold text-amber-400/80">{streak.bestWinStreak}W</span>
                    </div>
                    <div className="flex items-center justify-end gap-1.5">
                        <TrendingDown className="w-3 h-3 text-cyan-500/70" />
                        <span className="text-[10px] text-slate-500">Worst</span>
                        <span className="text-xs font-mono font-bold text-cyan-400/80">{Math.abs(streak.worstLossStreak)}L</span>
                    </div>
                    <div className="text-[10px] text-slate-600 mt-0.5">{streak.totalResolved} total</div>
                </div>
            </div>
        </motion.div>
    );
}
