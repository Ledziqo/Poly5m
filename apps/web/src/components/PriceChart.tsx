import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { formatET } from '../utils';
import { useEffect, useState } from 'react';
import { motion } from 'motion/react';

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export default function PriceChart({ data, currentPrice, priceToBeat }: { data: Candle[], currentPrice: number | null, priceToBeat?: number | null }) {
  const [chartData, setChartData] = useState<any[]>([]);

  useEffect(() => {
    if (!data || data.length === 0) return;

    const formatted = data.map(c => ({
      ...c,
      time: formatET(c.timestamp).split(' ')[0] + ' ' + formatET(c.timestamp).split(' ')[1],
      fullTime: formatET(c.timestamp),
      isLive: false
    }));

    // If we have a live price, append it dynamically to the last candle or as a new point
    // For visual smoothness, we'll just rely on the reference line for the absolute latest price
    // and let the candles update via the prop `data` (which comes from the 1m polling).
    // However, to make the line "alive", we can append a temporary point.

    if (currentPrice) {
      const lastCandle = formatted[formatted.length - 1];
      if (lastCandle) {
        // Update last candle close for the chart
        formatted[formatted.length - 1] = {
          ...lastCandle,
          close: currentPrice,
          high: Math.max(lastCandle.high, currentPrice),
          low: Math.min(lastCandle.low, currentPrice)
        };
      }
    }

    setChartData(formatted);
  }, [data, currentPrice]);

  if (!chartData || chartData.length === 0) return <div className="h-64 flex items-center justify-center text-slate-500">Loading Chart...</div>;

  // Calculate min and max for Y-axis
  const minPrice = Math.min(...chartData.map(d => d.low));
  const maxPrice = Math.max(...chartData.map(d => d.high));
  const padding = (maxPrice - minPrice) * 0.1;

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
        {currentPrice && (
          <div className="text-lg font-mono font-bold text-white shadow-[0_0_10px_rgba(255,255,255,0.1)]">
            ${currentPrice.toFixed(2)}
          </div>
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
          {currentPrice && (
            <ReferenceLine y={currentPrice} stroke="#e9d5ff" strokeDasharray="3 3" opacity={0.4} />
          )}
        </LineChart>
      </ResponsiveContainer>
    </motion.div>
  );
}
