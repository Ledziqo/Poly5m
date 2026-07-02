import { useEffect, useState } from 'react';
import { motion } from 'motion/react';

export default function ResolutionTimer({ targetTimestamp, key }: { targetTimestamp: number | null, key?: string }) {
  const [timeLeft, setTimeLeft] = useState<{ m: string, s: string }>({ m: '00', s: '00' });

  useEffect(() => {
    if (!targetTimestamp) {
      setTimeLeft({ m: '00', s: '00' });
      return;
    }

    const interval = setInterval(() => {
      const now = Date.now();
      // Target is passed directly (resolution_time)
      const diff = targetTimestamp - now;

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
    }, 100);

    return () => clearInterval(interval);
  }, [targetTimestamp]);

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
