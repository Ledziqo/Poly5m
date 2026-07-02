import { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import { GoogleGenAI } from '@google/genai';
import PriceChart from './PriceChart';
import PredictionCard from './PredictionCard';
import NewsFeed from './NewsFeed';
import ControlPanel from './ControlPanel';
import ResolutionTimer from './ResolutionTimer';
import SystemLogs from './SystemLogs';
import WinStreakBox from './WinStreakBox';
import CopyTradePanel from './CopyTradePanel';
import { RefreshCw, Wallet, TrendingUp, AlertCircle, ArrowRight, Activity } from 'lucide-react';
import { formatET } from '../utils';
import { useBinancePrice } from '../hooks/useBinancePrice';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [candles, setCandles] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const { price: currentPrice } = useBinancePrice();
  const prevOpenBetsRef = useRef<number>(0);

  const fetchData = async () => {
    try {
      const [statusRes, candlesRes, historyRes] = await Promise.all([
        axios.get('/api/status'),
        axios.get('/api/candles'),
        axios.get('/api/history')
      ]);

      setData(statusRes.data);
      setCandles(Array.isArray(candlesRes.data) ? candlesRes.data : []);

      const newHistory = Array.isArray(historyRes.data) ? historyRes.data : [];
      setHistory(newHistory);

      // Check for new trades
      const currentOpenBets = newHistory.filter(h => h.status === 'OPEN').length;
      if (currentOpenBets > prevOpenBetsRef.current) {
        // New trade taken!
        const latestTrade = newHistory.find(h => h.status === 'OPEN');
        if (latestTrade) {
          toast.success(`New Trade: ${latestTrade.direction} at $${latestTrade.price_at_prediction.toFixed(2)}`, {
            description: `Stake: $${latestTrade.bet_stake.toFixed(2)} | Confidence: ${latestTrade.confidence}%`,
          });

          // Play sound
          try {
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(880, audioContext.currentTime); // A5
            oscillator.frequency.exponentialRampToValueAtTime(1760, audioContext.currentTime + 0.1); // A6

            gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.5);

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.5);
          } catch (e) {
            console.error('Failed to play sound', e);
          }
        }
      }
      prevOpenBetsRef.current = currentOpenBets;

      setLastUpdated(new Date());
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const aiPredictionInProgress = useRef(false);

  useEffect(() => {
    const checkMarketData = async () => {
      if (aiPredictionInProgress.current) return;
      try {
        const res = await axios.get('/api/market-data');
        const marketData = res.data;
        if (!marketData || !marketData.nextResolution) return;

        const now = Date.now();
        const timeLeftSeconds = (marketData.nextResolution - now) / 1000;

        // Only generate prediction if we are in the optimal window and haven't already
        if (timeLeftSeconds <= 240 && timeLeftSeconds >= 60) {
          // Check if we already have a prediction for this resolution
          const statusRes = await axios.get('/api/status');
          const latestPred = statusRes.data.latestPrediction;

          // If the backend is waiting for a prediction, its blockTradeReason will indicate it
          if (latestPred && latestPred.features && latestPred.features.blockTradeReason === "Waiting for AI Prediction from frontend...") {
            aiPredictionInProgress.current = true;
            try {
              const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY });
              const prompt = `
You are an expert crypto trading AI. Analyze the following 1-minute Bitcoin data and predict the price direction for the next 5 minutes.

Technical Indicators:
- RSI: ${marketData.technicals.rsi.toFixed(2)}
- MACD Histogram: ${marketData.technicals.macd?.histogram?.toFixed(2) || 'N/A'}
- EMA20: ${marketData.technicals.ema20.toFixed(2)}
- EMA50: ${marketData.technicals.ema50.toFixed(2)}
- VWAP: ${marketData.technicals.vwap.toFixed(2)}
- Current Price: ${marketData.technicals.close.toFixed(2)}
- Trend: ${marketData.technicals.trend}

Market Sentiment:
- Fear & Greed Index: ${marketData.fng.value} (${marketData.fng.classification})
- Buying Pressure Ratio: ${marketData.buyingPressure.ratio.toFixed(2)} (0.5 is neutral, >0.5 is buying)

Recent News Headlines:
${marketData.headlines.map((h: string) => `- ${h}`).join('\n')}

Based on this data, predict the direction of Bitcoin's price over the next 5 minutes.
Return ONLY a valid JSON object with the following structure:
{
  "direction": "UP" | "DOWN" | "NEUTRAL",
  "confidence": number,
  "reasoning": "A short sentence explaining the prediction based on the indicators"
}
`;
              const response = await ai.models.generateContent({
                model: "gemini-3-flash-preview",
                contents: prompt,
                config: { responseMimeType: "application/json" }
              });

              const text = response.text || "{}";
              const result = JSON.parse(text);

              await axios.post('/api/ai-prediction', {
                direction: result.direction,
                confidence: result.confidence,
                reasoning: result.reasoning,
                resolution_time: marketData.nextResolution
              });

              toast.success("AI Prediction Generated!");
            } catch (err) {
              console.error("AI Prediction Error:", err);
            } finally {
              aiPredictionInProgress.current = false;
            }
          }
        }
      } catch (error) {
        console.error('Error checking market data:', error);
      }
    };

    const interval = setInterval(checkMarketData, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000); // Poll every 5s
    return () => clearInterval(interval);
  }, []);

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  const prediction = data?.latestPrediction;
  const settings = data?.settings || {};

  // Calculate stats
  const resolvedTrades = history.filter(h => h.status === 'RESOLVED');
  const winCount = resolvedTrades.filter(h => h.actual_outcome === 'WIN').length;
  const lossCount = resolvedTrades.filter(h => h.actual_outcome === 'LOSS').length;
  const winRate = resolvedTrades.length > 0 ? (winCount / resolvedTrades.length) * 100 : 0;
  const totalPnL = resolvedTrades.reduce((acc, curr) => acc + (curr.pnl || 0), 0);
  const openBets = history.filter(h => h.status === 'OPEN').length;

  // Find the earliest OPEN bet to show timer for (next resolution)
  // Or if no open bet, use the latest prediction's resolution time
  // Fallback to local calculation if needed
  const openBet = history.filter(h => h.status === 'OPEN').sort((a, b) => a.resolution_time - b.resolution_time)[0];

  const now = Date.now();
  const fiveMin = 5 * 60 * 1000;
  // Calculate next 5m slot boundary
  let nextSlot = Math.ceil(now / fiveMin) * fiveMin;

  // If we are exactly on the minute (rare), add 5 mins
  if (nextSlot <= now) nextSlot += fiveMin;

  let targetTimestamp = openBet ? openBet.resolution_time : (prediction?.resolution_time || nextSlot);

  // USE POLYMARKET ACTUAL END DATE FOR EXACT TIMER SYNC IF AVAILABLE
  const activePred = openBet || prediction;
  if (activePred?.features?.polymarketOdds?.endDate) {
    const pmEndDate = new Date(activePred.features.polymarketOdds.endDate).getTime();
    if (pmEndDate > now) {
      targetTimestamp = pmEndDate;
    }
  }

  // If the target from prediction is in the past, force next slot
  if (targetTimestamp <= now) {
    targetTimestamp = nextSlot;
  }

  // Calculate Live PnL for Open Bets
  const calculateLiveValue = (bet: any) => {
    if (!currentPrice || bet.status !== 'OPEN') return null;

    // Simple linear model for live probability
    // If price moves in favor, prob goes up.
    // Max prob = 0.99, Min = 0.01

    const entry = bet.price_at_prediction;
    const isUp = bet.direction === 'UP';
    const diff = currentPrice - entry;

    // Sensitivity: How much price move changes probability?
    // Let's say 0.1% move = 20% prob change (high volatility assumption for 5m)
    const percentMove = diff / entry;
    const probChange = percentMove * 200; // 0.001 (0.1%) * 200 = 0.2 (20%)

    let currentProb = bet.share_price + (isUp ? probChange : -probChange);
    currentProb = Math.max(0.01, Math.min(0.99, currentProb));

    const stake = bet.bet_stake || 0;
    const shares = bet.shares_count || 0;
    const currentValue = shares * currentProb; // Value if sold now (theoretical)
    const returnPct = stake > 0 ? ((currentValue - stake) / stake) * 100 : 0;

    return {
      currentProb,
      currentValue,
      returnPct
    };
  };

  return (
    <div className="min-h-screen bg-[#0B0E14] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-violet-900/20 via-[#0B0E14] to-[#0B0E14] p-6 text-slate-100 font-sans">
      <header className="max-w-7xl mx-auto mb-8 flex justify-between items-center">
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight flex items-center">
              <svg width="36" height="32" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="-mr-1" aria-hidden="true">
                <defs>
                  <linearGradient id="catEarGradient" x1="0%" y1="20%" x2="100%" y2="80%">
                    <stop offset="0%" stopColor="#f472b6" />
                    <stop offset="50%" stopColor="#d946ef" />
                    <stop offset="100%" stopColor="#a855f7" />
                  </linearGradient>
                </defs>
                <path d="M 10 90 L 10 40 L 18 10 C 25 25, 30 35, 40 40 L 50 50 L 60 40 C 70 35, 75 25, 82 10 L 90 40 L 90 90 H 72 L 72 55 L 50 75 L 28 55 L 28 90 Z" fill="url(#catEarGradient)" />
              </svg>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-pink-400 via-fuchsia-500 to-purple-500">eowBot</span>
            </h1>
            <span className="px-2 py-0.5 bg-purple-500/10 text-purple-300 text-xs font-bold rounded border border-purple-500/20 shadow-[0_0_10px_rgba(168,85,247,0.2)]">
              POLYMARKET SIGNAL BOT
            </span>
          </div>
          <p className="text-sm text-slate-400 mb-2">AI-Powered 5m Price Prediction & Auto-Trading</p>
          <div className="flex items-center gap-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-black/50 border border-slate-700/50 backdrop-blur-sm group cursor-default hover:border-pink-500/30 transition-colors">
              <svg viewBox="0 0 100 100" className="w-8 h-8 text-pink-500 translate-y-1" fill="currentColor">
                <path d="M 32 42 L 36 22 C 38 16, 45 18, 50 22 C 55 18, 62 16, 64 22 L 68 42 Z" />
                <path d="M 12 44 C 12 36, 88 36, 88 44 C 94 50, 6 50, 12 44 Z" />
              </svg>
              <span className="text-xs font-bold text-pink-500 drop-shadow-[0_0_8px_rgba(236,72,153,0.8)] group-hover:text-pink-400 transition-all">
                Designed by Aesliex
              </span>
            </div>
            <a
              href="https://t.me/Aesliex"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#229ED9]/10 text-[#229ED9] border border-[#229ED9]/30 hover:bg-[#229ED9]/20 transition-colors text-sm font-medium"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.14.18-.357.223-.548.223l.188-2.85 5.18-4.68c.223-.198-.054-.31-.346-.11l-6.4 4.02-2.76-.86c-.6-.188-.612-.6.126-.89l10.81-4.17c.5-.188.94.112.85.845z" />
              </svg>
              Contact Developer
            </a>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="flex items-center gap-4">
          <div className="text-xs text-slate-400 flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Updated: {formatET(lastUpdated)}
          </div>
          <div className={`h-2 w-2 rounded-full animate-pulse ${settings.is_running === 'true' ? 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)]' : 'bg-slate-600'}`}></div>
        </motion.div>
      </header >

      <main className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Controls & Metrics */}
        <div className="flex flex-col gap-6">
          <ControlPanel settings={settings} onUpdate={fetchData} />

          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.4 }}
            className="grid grid-cols-2 gap-4"
          >
            <div className="bg-[#131722]/60 backdrop-blur-xl p-4 rounded-xl shadow-lg border border-white/10 hover:border-white/20 transition-all relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <div className="flex items-center gap-2 text-xs text-slate-400 mb-1 relative z-10">
                <TrendingUp className="w-3 h-3 text-blue-400" /> Total PnL
              </div>
              <motion.div
                key={totalPnL}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className={`text-xl font-mono font-bold relative z-10 ${totalPnL >= 0 ? 'text-blue-400 drop-shadow-[0_0_8px_rgba(96,165,250,0.3)]' : 'text-pink-500 drop-shadow-[0_0_8px_rgba(236,72,153,0.3)]'}`}
              >
                {totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)}
              </motion.div>
            </div>
            <div className="bg-[#131722]/60 backdrop-blur-xl p-4 rounded-xl shadow-lg border border-white/10 hover:border-white/20 transition-all relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <div className="flex items-center gap-2 text-xs text-slate-400 mb-1 relative z-10">
                <AlertCircle className="w-3 h-3 text-purple-400" /> Win Rate
              </div>
              <motion.div
                key={winRate}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="text-xl font-mono font-bold text-white relative z-10"
              >
                {winRate.toFixed(1)}%
              </motion.div>
              <div className="text-xs text-slate-400 relative z-10 mt-1">
                <span className="text-emerald-400 font-medium">{winCount}W</span> / <span className="text-rose-400 font-medium">{lossCount}L</span>
                <span className="text-slate-500 ml-1">({resolvedTrades.length} total)</span>
              </div>
            </div>
          </motion.div>

          <WinStreakBox />

          <div className="flex-1">
            <PredictionCard prediction={prediction} currentPrice={currentPrice} />
          </div>
        </div>

        {/* Middle Column: Chart & History */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2">
              <PriceChart data={candles} currentPrice={currentPrice} />
            </div>
            <div className="md:col-span-1">
              <ResolutionTimer key={targetTimestamp ? targetTimestamp.toString() : 'timer'} targetTimestamp={targetTimestamp} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <NewsFeed
              headlines={prediction?.features?.headlines || []}
              sentiment={prediction?.features?.sentiment}
            />

            <div className="bg-[#131722]/60 backdrop-blur-xl p-6 rounded-xl shadow-lg border border-white/10 hover:border-white/20 transition-all h-full overflow-hidden flex flex-col">
              {/* ACTIVE TRADES SECTION */}
              <div className="mb-6 pb-4 border-b border-white/10">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-blue-400" /> Active Trades
                  </h3>
                  <span className="text-xs text-slate-400">{openBets} active</span>
                </div>
                <div className="space-y-2">
                  <AnimatePresence>
                    {history.filter(h => h.status === 'OPEN').length === 0 ? (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center py-4 text-slate-500 text-xs italic">No active trades</motion.div>
                    ) : (
                      history.filter(h => h.status === 'OPEN').map((h: any) => {
                        const liveStats = calculateLiveValue(h);
                        return (
                          <motion.div
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            key={h.id}
                            className="flex justify-between items-center text-xs p-3 rounded-lg border transition-all bg-blue-900/20 border-blue-500/40 shadow-[0_0_15px_rgba(59,130,246,0.15)] hover:bg-blue-900/30"
                          >
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-slate-400">{formatET(h.timestamp)}</span>
                                <span className={`font-bold ${h.direction === 'UP' ? 'text-blue-400' : 'text-pink-500'}`}>{h.direction}</span>
                                <span className="flex h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse"></span>
                              </div>
                              <div className="text-slate-500 text-[10px] flex items-center gap-2">
                                <span>Entry: ${h.features?.entryPrice ? h.features.entryPrice.toFixed(2) : h.price_at_prediction.toFixed(2)}</span>
                                <span className="text-slate-700">•</span>
                                <span className="text-slate-400">{(h.share_price * 100).toFixed(0)}¢</span>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="flex flex-col items-end">
                                {liveStats ? (
                                  <>
                                    <div className={`font-bold ${liveStats.returnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                      {liveStats.returnPct >= 0 ? '+' : ''}{liveStats.returnPct.toFixed(1)}%
                                    </div>
                                    <div className="text-[10px] text-slate-500">
                                      Val: ${(liveStats.currentValue).toFixed(2)}
                                    </div>
                                  </>
                                ) : (
                                  <span className="text-slate-500 italic">Calculating...</span>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        );
                      })
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* PAST TRADES SECTION */}
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-purple-400" /> Trade History
                </h3>
              </div>

              <div className="overflow-y-auto flex-1 pr-2 space-y-2 max-h-[300px] custom-scrollbar">
                <AnimatePresence>
                  {history.filter(h => h.status !== 'OPEN' && h.status !== 'SKIPPED' && h.bet_stake > 0).length === 0 ? (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-8 text-slate-600 text-sm">No past trades yet...</motion.div>
                  ) : (
                    history.filter(h => h.status !== 'OPEN' && h.status !== 'SKIPPED' && h.bet_stake > 0).map((h: any) => {
                      const isSkipped = h.bet_stake === 0;

                      return (
                        <motion.div
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          key={h.id}
                          className={`flex justify-between items-center text-xs p-3 rounded-lg border transition-all ${isSkipped ? 'bg-slate-800/30 border-slate-700/30 opacity-75' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
                        >
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-slate-400">{formatET(h.timestamp)}</span>
                              <span className={`font-bold ${h.direction === 'UP' ? 'text-blue-400' : 'text-pink-500'}`}>{h.direction}</span>
                              {isSkipped && <span className="text-[10px] bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">SKIPPED</span>}
                            </div>
                            <div className="text-slate-400 text-[10px] flex items-center gap-2">
                              <span>Entry: ${h.features?.entryPrice ? h.features.entryPrice.toFixed(2) : h.price_at_prediction.toFixed(2)}</span>
                              <span className="text-slate-600">•</span>
                              <span className="text-slate-300">{(h.share_price * 100).toFixed(0)}¢</span>
                            </div>
                          </div>

                          <div className="text-right">
                            <div className="flex flex-col items-end">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold mb-1 ${h.actual_outcome === 'WIN' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                h.actual_outcome === 'PUSH' ? 'bg-slate-700 text-slate-300' :
                                  'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                }`}>
                                {h.actual_outcome}
                              </span>
                              {!isSkipped ? (
                                <span className={`font-mono font-medium ${(h.pnl || 0) > 0 ? 'text-emerald-400' : (h.pnl || 0) < 0 ? 'text-rose-400' : 'text-slate-500'}`}>
                                  {(h.pnl || 0) > 0 ? '+' : ''}{(h.pnl || 0).toFixed(2)}
                                </span>
                              ) : (
                                <span className="text-[10px] text-slate-600 italic">No Bet</span>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      )
                    })
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0">
            <SystemLogs />
          </div>
        </div>
      </main>

      {/* Copy Trade Live Panel — floating drawer, shown only when copy mode active */}
      {settings.copy_mode_enabled === 'true' && settings.copy_target_address && (
        <CopyTradePanel targetAddress={settings.copy_target_address} />
      )}

    </div >
  );
}
