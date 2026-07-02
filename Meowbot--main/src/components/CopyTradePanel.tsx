import { useState, useEffect } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'motion/react';
import { Users, ChevronUp, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';

interface CopyTrade {
  id?: string;
  market?: string;
  outcome?: string;
  side?: string;
  size?: number;
  price?: number;
  timestamp?: number;
  transactionHash?: string;
}

interface Props {
  targetAddress: string;
}

function parsePanelDirection(trade: CopyTrade): 'UP' | 'DOWN' | null {
  const outcome = (trade.outcome || trade.side || '').toLowerCase();
  const market = (trade.market || '').toLowerCase();
  if (outcome.includes('up') || outcome.includes('yes')) return 'UP';
  if (outcome.includes('down') || outcome.includes('no')) return 'DOWN';
  if (market.includes('-up-')) return 'UP';
  if (market.includes('-down-')) return 'DOWN';
  return null;
}

function tradeTime(trade: CopyTrade): string {
  if (!trade.timestamp) return '—';
  const ms = String(trade.timestamp).length > 10 ? trade.timestamp : trade.timestamp * 1000;
  return new Date(ms).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function parseSlotLabel(market: string): string {
  // slug like btc-updown-5m-1741694400 → extract time from timestamp
  const parts = market.split('-');
  const ts = parseInt(parts[parts.length - 1]);
  if (ts && ts > 1000000000) {
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) + ' ET';
  }
  return market;
}

export default function CopyTradePanel({ targetAddress }: Props) {
  const [open, setOpen] = useState(false);
  const [trades, setTrades] = useState<CopyTrade[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const fetchTrades = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/copy-target-trades');
      setTrades(Array.isArray(res.data) ? res.data : []);
      setLastFetched(new Date());
    } catch (e) {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTrades();
    const interval = setInterval(fetchTrades, 10000); // refresh every 10s
    return () => clearInterval(interval);
  }, [targetAddress]);

  const shortAddr = targetAddress
    ? `${targetAddress.slice(0, 6)}...${targetAddress.slice(-4)}`
    : '';

  const upCount = trades.filter(t => parsePanelDirection(t) === 'UP').length;
  const downCount = trades.filter(t => parsePanelDirection(t) === 'DOWN').length;

  return (
    <div className="fixed bottom-0 right-6 z-50 w-80">
      {/* Tab / Pull Handle */}
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between px-4 py-2.5 rounded-t-xl border-x border-t transition-all ${
          open
            ? 'bg-fuchsia-950/80 border-fuchsia-500/40 backdrop-blur-xl'
            : 'bg-[#131722]/90 border-fuchsia-500/30 hover:border-fuchsia-500/60 backdrop-blur-xl'
        }`}
      >
        <div className="flex items-center gap-2">
          <div className="relative">
            <Users className="w-4 h-4 text-fuchsia-400" />
            {trades.length > 0 && (
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-fuchsia-500 rounded-full animate-pulse" />
            )}
          </div>
          <span className="text-sm font-semibold text-fuchsia-300">Copying {shortAddr}</span>
          <span className="text-[10px] text-slate-500">{trades.length} BTC trades today</span>
        </div>
        <div className="flex items-center gap-2">
          {loading && <RefreshCw className="w-3 h-3 text-slate-500 animate-spin" />}
          <ChevronUp className={`w-4 h-4 text-slate-400 transition-transform duration-300 ${open ? '' : 'rotate-180'}`} />
        </div>
      </button>

      {/* Expandable Panel Body */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="bg-[#0d0f17]/95 backdrop-blur-xl border-x border-b border-fuchsia-500/30 rounded-b-xl">
              {/* Stats row */}
              <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/5">
                <div className="flex items-center gap-1.5 text-xs">
                  <TrendingUp className="w-3 h-3 text-emerald-400" />
                  <span className="text-emerald-400 font-bold">{upCount} UP</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  <TrendingDown className="w-3 h-3 text-rose-400" />
                  <span className="text-rose-400 font-bold">{downCount} DOWN</span>
                </div>
                {lastFetched && (
                  <span className="ml-auto text-[10px] text-slate-600">
                    Updated {lastFetched.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                  </span>
                )}
              </div>

              {/* Trade list */}
              <div className="max-h-64 overflow-y-auto custom-scrollbar divide-y divide-white/5">
                {trades.length === 0 ? (
                  <div className="py-8 text-center text-slate-600 text-xs italic">
                    No Bitcoin Up/Down trades found today
                  </div>
                ) : (
                  trades.map((trade, i) => {
                    const dir = parsePanelDirection(trade);
                    const timeStr = tradeTime(trade);
                    const slotLabel = trade.market ? parseSlotLabel(trade.market) : '—';
                    const amount = trade.size ? `$${Number(trade.size).toFixed(2)}` : '—';
                    const price = trade.price ? `${(Number(trade.price) * 100).toFixed(0)}¢` : '—';

                    return (
                      <div key={trade.transactionHash || i} className="flex items-center justify-between px-4 py-2.5 hover:bg-white/3 transition-colors group">
                        <div className="flex items-center gap-2.5">
                          {/* Direction badge */}
                          <span className={`px-2 py-0.5 rounded text-[11px] font-bold border ${
                            dir === 'UP'
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : dir === 'DOWN'
                              ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                              : 'bg-slate-700 text-slate-400 border-slate-600'
                          }`}>
                            {dir ?? '?'}
                          </span>
                          <div>
                            <div className="text-xs text-slate-300 font-medium">Bitcoin 5m</div>
                            <div className="text-[10px] text-slate-600">{slotLabel}</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-white font-mono">{amount}</div>
                          <div className="text-[10px] text-slate-500">{price} · {timeStr}</div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
