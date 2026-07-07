import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';

export default function ResolutionTimer({ targetTimestamp, serverTime, timeLeftSeconds }: { targetTimestamp: number | null, serverTime?: number | null, timeLeftSeconds?: number | null }) {
  const [timeLeft, setTimeLeft] = useState<{ m: string, s: string }>({ m: '00', s: '00' });
  const clockOffsetRef = useRef(0);
  const initialFallbackMs = useMemo(() => Math.max(0, (timeLeftSeconds ?? 0) * 1000), [targetTimestamp]);

  useEffect(() => {
    if (serverTime) {
      const measuredOffset = serverTime - Date.now();
      clockOffsetRef.current = clockOffsetRef.current
        ? clockOffsetRef.current * 0.85 + measuredOffset * 0.15
        : measuredOffset;
    }
  }, [serverTime]);

  useEffect(() => {
    const updateTimer = () => {
      const syncedNow = Date.now() + clockOffsetRef.current;
      const diff = targetTimestamp
        ? Math.max(0, targetTimestamp - syncedNow)
        : Math.max(0, initialFallbackMs);

      if (diff <= 0) {
        setTimeLeft({ m: '00', s: '00' });
      } else {
        const minutes = Math.floor(diff / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);
        setTimeLeft({
          m: minutes.toString().padStart(2, '0'),
          s: seconds.toString().padStart(2, '0')
        });
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 100);

    return () => clearInterval(interval);
  }, [targetTimestamp, initialFallbackMs]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-[#131722]/60 backdrop-blur-xl p-4 rounded-xl shadow-lg border border-white/10 hover:border-white/20 transition-all flex flex-col justify-center items-center h-full min-h-[120px]"
    >
      <div className="flex items-baseline gap-2">
        <div className="flex flex-col items-center">
          <div className="text-5xl font-mono font-bold text-[#FF5252] tracking-tighter drop-shadow-[0_0_15px_rgba(255,82,82,0.3)]">
            {timeLeft.m}
          </div>
          <div className="text-[10px] font-bold text-[#FF5252]/60 tracking-widest mt-1">MINS</div>
        </div>

        <div className="text-4xl font-mono font-bold text-[#FF5252] -mt-4">:</div>

        <div className="flex flex-col items-center">
          <div className="text-5xl font-mono font-bold text-[#FF5252] tracking-tighter drop-shadow-[0_0_15px_rgba(255,82,82,0.3)]">
            {timeLeft.s}
          </div>
          <div className="text-[10px] font-bold text-[#FF5252]/60 tracking-widest mt-1">SECS</div>
        </div>
      </div>
    </motion.div>
  );
}
