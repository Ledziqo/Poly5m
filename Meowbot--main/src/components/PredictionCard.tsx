import { ArrowUp, ArrowDown, Activity, Zap, ShieldAlert, BrainCircuit } from 'lucide-react';
import { clsx } from 'clsx';
import { formatET } from '../utils';
import { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';

interface Prediction {
  direction: 'UP' | 'DOWN';
  confidence: number;
  price_at_prediction: number;
  timestamp: number;
  features: any;
  share_price: number;
  shares_count: number;
  bet_stake: number;
  status: string;
  resolution_time?: number;
}

// Standard Normal CDF approximation
function normalCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014337 * Math.exp(-x * x / 2);
  const prob = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - prob : prob;
}

export default function PredictionCard({ prediction, currentPrice }: { prediction: Prediction | null, currentPrice: number | null }) {
  const [marketState, setMarketState] = useState({
    upPrice: 0.50,
    downPrice: 0.50,
    spread: 0.02,
    upBid: 0.49,
    upAsk: 0.51
  });

  // Ref to track previous price for "tick" animation or momentum
  const prevPriceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!prediction || !currentPrice) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const resolutionTime = prediction.resolution_time || (prediction.timestamp + 5 * 60 * 1000);
      const timeLeftMs = Math.max(0, resolutionTime - now);

      // Try to use real Polymarket Odds if available
      if (prediction.features?.polymarketOdds) {
        const { upPrice, downPrice } = prediction.features.polymarketOdds;

        // Simple spread logic for visual appeal based on real prices
        const spread = 0.02; // Fixed tight spread for display

        setMarketState({
          upPrice,
          downPrice,
          spread,
          upBid: Math.max(0, upPrice - spread / 2),
          upAsk: Math.min(1, upPrice + spread / 2)
        });
      } else {
        // Fallback simulated odds (if API failed or old trade)
        // 1. Calculate Theoretical Probability (Black-Scholes Binary Call)
        const T = Math.max(0.001, timeLeftMs / (5 * 60 * 1000));

        const volatility = 0.002 * prediction.price_at_prediction;
        const stdDev = volatility * Math.sqrt(T);

        const priceDiff = currentPrice - prediction.price_at_prediction;
        const zScore = priceDiff / stdDev;

        let theoreticalProb = normalCDF(zScore);

        const noise = (Math.random() - 0.5) * 0.02;
        let noisyProb = theoreticalProb + noise;

        noisyProb = Math.max(0.01, Math.min(0.99, noisyProb));

        let spread = 0.01 + (Math.abs(0.5 - noisyProb) * 0.05);
        spread = Math.max(0.01, Math.min(0.10, spread));

        const upBid = noisyProb - (spread / 2);
        const upAsk = noisyProb + (spread / 2);
        const upDisplay = (upBid + upAsk) / 2;

        setMarketState({
          upPrice: upDisplay,
          downPrice: 1 - upDisplay,
          spread,
          upBid,
          upAsk
        });
      }

      prevPriceRef.current = currentPrice;

    }, 500); // Live feel remains

    return () => clearInterval(interval);
  }, [prediction, currentPrice]);


  if (!prediction) {
    return (
      <div className="bg-[#131722]/60 backdrop-blur-xl p-6 rounded-xl shadow-lg border border-white/10 h-full min-h-[200px] flex items-center justify-center">
        <div className="text-slate-500 text-sm animate-pulse">Waiting for next prediction cycle...</div>
      </div>
    );
  }

  const isUp = prediction.direction === 'UP';
  const isBought = prediction.status === 'OPEN';

  // Use simulated market prices
  const upPrice = marketState.upPrice;
  const downPrice = marketState.downPrice;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4 }}
      className="bg-[#131722]/60 backdrop-blur-xl p-6 rounded-xl shadow-lg border border-white/10 hover:border-white/20 transition-all relative overflow-hidden h-full flex flex-col"
    >
      {/* Background Glow */}
      <div className={clsx("absolute top-0 right-0 w-64 h-64 bg-gradient-to-br opacity-10 blur-3xl rounded-full -mr-16 -mt-16 pointer-events-none", isUp ? 'from-blue-500 to-cyan-500' : 'from-pink-500 to-rose-500')}></div>

      <div className="flex justify-between items-start mb-6 relative z-10">
        <div>
          <h2 className="text-lg font-bold text-white mb-1">Bitcoin 5m Prediction</h2>
          <div className="text-xs text-slate-400 flex items-center gap-2">
            <span title="Start of the 5-minute round">Round: {formatET((prediction.resolution_time || 0) - 5 * 60 * 1000)}</span>
            <span className="w-1 h-1 rounded-full bg-slate-600"></span>
            <span title={prediction.status === 'OPEN' ? "Time the bet was placed" : "Time of analysis"}>
              {prediction.status === 'OPEN' ? 'Placed' : 'Signal'}: {formatET(prediction.timestamp)}
            </span>
            <span className="w-1 h-1 rounded-full bg-slate-600"></span>
            <span title="Time the round ends">Resolves: {formatET(prediction.resolution_time || (prediction.timestamp + 5 * 60 * 1000))}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-mono text-slate-300">
            #{prediction.timestamp.toString().slice(-6)}
          </div>
          <div className="flex gap-2">
            <div className="flex items-center gap-1 text-[10px] bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded border border-purple-500/20" title="AI Confidence">
              <BrainCircuit className="w-3 h-3" />
              {prediction.confidence}%
            </div>
            <div className="flex items-center gap-1 text-[10px] bg-orange-500/10 text-orange-400 px-2 py-0.5 rounded border border-orange-500/20" title="Risk Level">
              <ShieldAlert className="w-3 h-3" />
              {prediction.features?.risk || 50}%
            </div>
          </div>
        </div>
      </div>

      {/* Strike Price vs Current */}
      <div className="grid grid-cols-2 gap-4 mb-6 relative z-10">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Price to Beat</div>
          <div className="text-xl font-mono font-bold text-white">${prediction.price_at_prediction.toFixed(2)}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Current Price</div>
          <div className={clsx("text-xl font-mono font-bold",
            currentPrice && currentPrice > prediction.price_at_prediction ? 'text-blue-400' :
              currentPrice && currentPrice < prediction.price_at_prediction ? 'text-pink-500' : 'text-white'
          )}>
            ${currentPrice?.toFixed(2) || '...'}
          </div>
        </div>
      </div>

      {/* Binary Market Buttons */}
      <div className="grid grid-cols-2 gap-3 mb-6 relative z-10">
        {/* UP BUTTON */}
        <div className={clsx(
          "relative p-3 rounded-lg border transition-all flex flex-col items-center justify-center gap-1",
          // If Bought UP: Strong Blue
          isBought && isUp ? "bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.3)]" :
            // If Waiting and Leaning UP: Subtle Blue
            !isBought && isUp ? "bg-blue-500/10 border-blue-500/30" :
              // Otherwise: Neutral
              "bg-white/5 border-white/5"
        )}>
          <div className="flex justify-between w-full px-2 mb-1">
            <span className="text-sm font-bold text-blue-400">Up</span>
            {isBought && isUp && <span className="text-[10px] bg-blue-500 text-white px-1.5 rounded font-bold">BOUGHT</span>}
            {!isBought && isUp && <span className="text-[10px] bg-blue-500/20 text-blue-300 px-1.5 rounded font-bold border border-blue-500/30">TARGET</span>}
          </div>
          <div className="text-2xl font-mono text-white tracking-tight">{(upPrice * 100).toFixed(1)}¢</div>
          <div className="text-[10px] text-blue-300/50 mt-1 font-mono">
            Bid {(marketState.upBid * 100).toFixed(1)}¢ / Ask {(marketState.upAsk * 100).toFixed(1)}¢
          </div>
        </div>

        {/* DOWN BUTTON */}
        <div className={clsx(
          "relative p-3 rounded-lg border transition-all flex flex-col items-center justify-center gap-1",
          // If Bought DOWN: Strong Pink
          isBought && !isUp ? "bg-pink-500/20 border-pink-500/50 shadow-[0_0_15px_rgba(236,72,153,0.3)]" :
            // If Waiting and Leaning DOWN: Subtle Pink
            !isBought && !isUp ? "bg-pink-500/10 border-pink-500/30" :
              // Otherwise: Neutral
              "bg-white/5 border-white/5"
        )}>
          <div className="flex justify-between w-full px-2 mb-1">
            <span className="text-sm font-bold text-pink-500">Down</span>
            {isBought && !isUp && <span className="text-[10px] bg-pink-500 text-white px-1.5 rounded font-bold">BOUGHT</span>}
            {!isBought && !isUp && <span className="text-[10px] bg-pink-500/20 text-pink-300 px-1.5 rounded font-bold border border-pink-500/30">TARGET</span>}
          </div>
          <div className="text-2xl font-mono text-white tracking-tight">{(downPrice * 100).toFixed(1)}¢</div>
          <div className="text-[10px] text-pink-300/50 mt-1 font-mono">
            Bid {((1 - marketState.upAsk) * 100).toFixed(1)}¢ / Ask {((1 - marketState.upBid) * 100).toFixed(1)}¢
          </div>
        </div>
      </div>

      {/* Position Details (Only if Bought) */}
      {isBought ? (
        <div className="bg-black/20 rounded-lg p-3 relative z-10 border border-white/5 mt-auto">
          <div className="flex justify-between items-center text-xs mb-2">
            <span className="text-slate-400">Current Value</span>
            <span className={clsx("font-mono font-bold",
              (isUp ? upPrice : downPrice) > prediction.share_price ? "text-emerald-400" : "text-rose-400"
            )}>
              ${(prediction.shares_count * (isUp ? upPrice : downPrice)).toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-400">Shares Owned</span>
            <span className="text-white font-mono">{prediction.shares_count.toFixed(2)}</span>
          </div>
          <div className="mt-3 pt-2 border-t border-white/5 flex justify-between items-center text-xs">
            <span className="text-slate-400">Entry Cost</span>
            <span className="text-slate-300 font-mono">${prediction.bet_stake.toFixed(2)}</span>
          </div>
        </div>
      ) : (
        <div className="bg-black/20 rounded-lg p-3 relative z-10 border border-white/5 text-center mt-auto">
          <div className="text-xs text-slate-500 italic">Bot is monitoring market...</div>
          <div className="text-xs text-slate-600 mt-1">
            {prediction.features?.blockTradeReason ? (
              <span className="text-orange-400/80">Waiting: {prediction.features.blockTradeReason}</span>
            ) : (
              "Waiting for higher confidence setup..."
            )}
          </div>
        </div>
      )}

    </motion.div>
  );
}
