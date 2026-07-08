import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { formatET } from '../utils';
import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const IDLE_THRESHOLD_MS = 1500; // when to start micro-jitter
const EASE_FACTOR = 0.12; // how fast displayPrice approaches real price each frame
const JITTER_SCALE = 0.6; // tiny random walk scale in USD

export default function PriceChart({ data, currentPrice, priceToBeat }: { data: Candle[], currentPrice: number | null, priceToBeat?: number | null }) {
  const [chartData, setChartData] = useState<any[]>([]);
  const [displayPrice, setDisplayPrice] = useState<number | null>(null);
  const [pulseKey, setPulseKey] = useState(0);

  const realPriceRef = useRef<number | null>(null);
  const displayPriceRef = useRef<number | null>(null);
  const lastRealUpdateRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const jitterOffsetRef = useRef<number>(0);
  const prevCurrentPriceRef = useRef<number | null>(null);
  const baseDataRef = useRef<any[]>([]);

  // Track real price changes for pulse effect
  useEffect(() => {
    if (currentPrice !== null && currentPrice !== undefined) {
      const prev = prevCurrentPriceRef.current;
      if (prev !== currentPrice) {
        if (prev !== null) {
          setPulseKey((k: number) => k + 1); // trigger glow pulse
        }
        prevCurrentPriceRef.current = currentPrice;
        lastRealUpdateRef.current = Date.now();
      }
      realPriceRef.current = currentPrice;
    }
  }, [currentPrice]);

  // Animation loop: ease displayPrice toward real price, add idle jitter
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const real = realPriceRef.current;
      const disp = displayPriceRef.current;
      const timeSinceUpdate = now - lastRealUpdateRef.current;

      if (real !== null && real !== undefined && real > 0) {
        if (disp === null) {
          // First frame — snap
          displayPriceRef.current = real;
          setDisplayPrice(real);
        } else {
          // Ease toward real price
          let target = real;

          // If idle (no real update for a while), add micro-jitter
          if (timeSinceUpdate > IDLE_THRESHOLD_MS) {
            // Random walk jitter that drifts around the real price
            const maxJitter = JITTER_SCALE * (1 + Math.min(2, timeSinceUpdate / 3000));
            jitterOffsetRef.current += (Math.random() - 0.5) * maxJitter * 0.3;
            // Decay jitter back toward 0
            jitterOffsetRef.current *= 0.92;
            jitterOffsetRef.current = Math.max(-maxJitter, Math.min(maxJitter, jitterOffsetRef.current));
            target = real + jitterOffsetRef.current;
          } else {
            // Reset jitter when real updates arrive
            jitterOffsetRef.current *= 0.5;
          }

          const eased = disp + (target - disp) * EASE_FACTOR;
          displayPriceRef.current = eased;
          setDisplayPrice(eased);
        }

        // Update chart data last point with display price
        setChartData((prev: any[]) => {
          if (prev.length === 0) return prev;
          const updated = [...prev];
          const last = { ...updated[updated.length - 1] };
          last.close = displayPriceRef.current!;
          last.high = Math.max(last.high, displayPriceRef.current!);
          last.low = Math.min(last.low, displayPriceRef.current!);
          updated[updated.length - 1] = last;
          return updated;
        });
      }

      lastFrameRef.current = now;
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Rebuild chart data when candle data changes (real updates from stream)
  useEffect(() => {
    if (!data || data.length === 0) return;

    const formatted = data.map(c => ({
      ...c,
      time: formatET(c.timestamp).split(' ')[0] + ' ' + formatET(c.timestamp).split(' ')[1],
      fullTime: formatET(c.timestamp),
      isLive: false
    }));

    // If we have a display price, update the last candle close to match
    if (displayPriceRef.current) {
      const lastCandle = formatted[formatted.length - 1];
      if (lastCandle) {
        formatted[formatted.length - 1] = {
          ...lastCandle,
          close: displayPriceRef.current,
          high: Math.max(lastCandle.high, displayPriceRef.current),
          low: Math.min(lastCandle.low, displayPriceRef.current)
        };
      }
    }

    baseDataRef.current = formatted;
    setChartData(formatted);
  }, [data]);

  if (!chartData || chartData.length === 0) return <div className="h-64 flex items-center justify-center text-slate-500">Loading Chart...</div>;

  // Calculate min and max for Y-axis
  const minPrice = Math.min(...chartData.map(d => d.low));
  const maxPrice = Math.max(...chartData.map(d => d.high));
  const padding = (maxPrice - minPrice) * 0.1;
  const shownPrice = displayPrice ?? currentPrice;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="h-64 w-full bg-[#131722]/60 backdrop-blur-xl p-4 rounded-xl shadow-lg border border-white/10 hover:border-white/20 transition-all relative overflow-hidden"
    >
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 opacity-50"></div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
          BTC/USDT (1m)
        </h3>
        {shownPrice && (
          <motion.div
            key={pulseKey}
            initial={pulseKey > 0 ? { scale: 1.15, textShadow: '0 0 20px rgba(192,132,252,0.8)' } : false}
            animate={{ scale: 1, textShadow: '0 0 0px rgba(192,132,252,0)' }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="text-lg font-mono font-bold text-white shadow-[0_0_10px_rgba(255,255,255,0.1)]"
          >
            ${shownPrice.toFixed(2)}
          </motion.div>
        )}
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <defs>
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.3} />
          <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} />
          <YAxis
            domain={[minPrice - padding, maxPrice + padding]}
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            width={60}
            tickFormatter={(val) => val.toFixed(2)}
          />
          <Tooltip
            contentStyle={{ borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 4px 20px rgba(0,0,0,0.5)', backgroundColor: 'rgba(11,14,20,0.8)', backdropFilter: 'blur(8px)', color: '#f1f5f9' }}
            labelStyle={{ color: '#94a3b8' }}
            labelFormatter={(label, payload) => {
              if (payload && payload.length > 0) {
                return payload[0].payload.fullTime;
              }
              return label;
            }}
          />
          <Line
            type="monotone"
            dataKey="close"
            stroke="#c084fc"
            strokeWidth={3}
            dot={false}
            activeDot={{ r: 5, fill: '#f3e8ff', stroke: '#c084fc', strokeWidth: 2 }}
            isAnimationActive={false}
            filter="url(#glow)"
          />
          {priceToBeat && (
            <ReferenceLine y={priceToBeat} stroke="#f472b6" strokeDasharray="5 5" opacity={0.75} label={{ value: 'Price to beat', fill: '#f472b6', fontSize: 10 }} />
          )}
          {shownPrice && (
            <ReferenceLine y={shownPrice} stroke="#e9d5ff" strokeDasharray="3 3" opacity={0.4} />
          )}
        </LineChart>
      </ResponsiveContainer>
    </motion.div>
  );
}