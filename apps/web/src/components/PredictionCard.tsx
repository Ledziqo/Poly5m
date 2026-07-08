import { ArrowDown, ArrowUp, BrainCircuit, ExternalLink, Timer, Zap } from 'lucide-react';
import { clsx } from 'clsx';
import { motion } from 'motion/react';
import { BtcWindow, Decision, Trade } from '../api';

export default function PredictionCard({
  window,
  decision,
  activeTrade,
}: {
  window: BtcWindow | null;
  decision: Decision | null;
  activeTrade: Trade | null;
}) {
  if (!window || !decision) {
    return (
      <div className="bg-[#131722]/60 backdrop-blur-xl p-6 rounded-xl shadow-lg border border-white/10 h-full min-h-[260px] flex items-center justify-center">
        <div className="text-slate-500 text-sm animate-pulse">Searching for active BTC 5m Polymarket window...</div>
      </div>
    );
  }

  const isUp = decision.direction === 'UP';
  const isWait = decision.direction === 'WAIT';
  const actionColor = isWait ? 'text-slate-300' : isUp ? 'text-blue-400' : 'text-pink-500';
  const actionBg = isWait ? 'from-slate-500 to-slate-800' : isUp ? 'from-blue-500 to-cyan-500' : 'from-pink-500 to-rose-500';
  const polymarketUrl = `https://polymarket.com/event/${window.market_slug}`;
  const hasLockedBeat = window.price_to_beat > 0;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4 }}
      className="bg-[#131722]/60 backdrop-blur-xl p-6 rounded-xl shadow-lg border border-white/10 hover:border-white/20 transition-all relative overflow-hidden h-full flex flex-col"
    >
      <div className={clsx('absolute top-0 right-0 w-64 h-64 bg-gradient-to-br opacity-10 blur-3xl rounded-full -mr-16 -mt-16 pointer-events-none', actionBg)} />

      <div className="flex justify-between items-start mb-6 relative z-10">
        <div>
          <h2 className="text-lg font-bold text-white mb-1">Bitcoin 5m Decision</h2>
          <div className="text-xs text-slate-400 flex flex-wrap items-center gap-2">
            <span>Round: {window.round}</span>
            <span className="w-1 h-1 rounded-full bg-slate-600"></span>
            <span>Source: {window.reference_source}</span>
            <span className="w-1 h-1 rounded-full bg-slate-600"></span>
            <span>{window.status}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
            <a
              href={polymarketUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-cyan-500/25 bg-cyan-500/10 text-[10px] font-bold uppercase tracking-wide text-cyan-300 hover:bg-cyan-500/15 hover:border-cyan-400/40 transition-colors"
              title="Open current Polymarket BTC 5m event"
            >
              <ExternalLink className="w-3 h-3" />
              Market
            </a>
            <div className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-mono text-slate-300">
              {decision.action}
            </div>
          </div>
          <div className="flex gap-2">
            <div className="flex items-center gap-1 text-[10px] bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded border border-purple-500/20" title="Model confidence">
              <BrainCircuit className="w-3 h-3" />
              Conf {decision.confidence}%
            </div>
            <div className="flex items-center gap-1 text-[10px] bg-cyan-500/10 text-cyan-300 px-2 py-0.5 rounded border border-cyan-500/20" title="Trade conviction">
              <Zap className="w-3 h-3" />
              Conv {decision.conviction ?? 0}%
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6 relative z-10">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Price to Beat</div>
          <div className="text-xl font-mono font-bold text-white">{hasLockedBeat ? `$${window.price_to_beat.toFixed(2)}` : 'Locking...'}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Current Reference</div>
          <div className={clsx('text-xl font-mono font-bold', !hasLockedBeat ? 'text-white' : window.current_price >= window.price_to_beat ? 'text-blue-400' : 'text-pink-500')}>
            ${window.current_price.toFixed(2)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-5 relative z-10">
        <MarketSide
          label="Up"
          selected={decision.direction === 'UP'}
          bought={activeTrade?.direction === 'UP'}
          color="blue"
          price={window.up_price}
          bid={window.up_bid}
          ask={window.up_ask}
          fair={decision.fair_up}
          edge={decision.edge_up}
        />
        <MarketSide
          label="Down"
          selected={decision.direction === 'DOWN'}
          bought={activeTrade?.direction === 'DOWN'}
          color="pink"
          price={window.down_price}
          bid={window.down_bid}
          ask={window.down_ask}
          fair={decision.fair_down}
          edge={decision.edge_down}
        />
      </div>

      <div className="bg-black/20 rounded-lg p-3 relative z-10 border border-white/5 mb-4">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className={clsx('flex items-center gap-2 font-bold', actionColor)}>
            {decision.direction === 'UP' && <ArrowUp className="w-4 h-4" />}
            {decision.direction === 'DOWN' && <ArrowDown className="w-4 h-4" />}
            {decision.direction === 'WAIT' && <Timer className="w-4 h-4" />}
            {decision.direction === 'WAIT' ? 'WAIT' : `TAKE ${decision.direction}`}
          </div>
          <div className="text-xs text-slate-400 text-right">
            <div>Tradeability: <span className={decision.eligible ? 'text-emerald-400' : 'text-orange-300'}>{decision.eligible ? 'eligible' : decision.tradeability || 'waiting'}</span></div>
            <div>Net edge: <span className={decision.best_edge > 0 ? 'text-emerald-400' : 'text-rose-400'}>{(decision.best_edge * 100).toFixed(2)}c</span></div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded border border-white/5 bg-white/[0.03] p-2">
            <div className="text-slate-500">Recommended stake</div>
            <div className="mt-1 font-mono text-white">${(decision.recommended_stake ?? 0).toFixed(2)}</div>
          </div>
          <div className="rounded border border-white/5 bg-white/[0.03] p-2">
            <div className="text-slate-500">Brain state</div>
            <div className="mt-1 font-mono text-white">{decision.brain_state?.regime || 'waiting'}</div>
          </div>
        </div>
        <div className="text-xs text-slate-500 mt-2">
          Fee drag: {(decision.expected_fee_cost * 100).toFixed(2)}c per share. Preferred entries run from 4:40 to 2:20 remaining, with no buys above 70c.
        </div>
        <div className="text-xs text-slate-600 mt-1">
          Chainlink/reference status: <span className={window.chainlink_status === 'live' ? 'text-emerald-400' : 'text-orange-400'}>{window.chainlink_status}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 relative z-10 mb-4">
        <SignalList title="Supporting Signals" items={decision.supporting_signals || []} tone="support" />
        <SignalList title="Risk Warnings" items={decision.risk_warnings || []} tone="risk" />
      </div>

      <div className="relative z-10 mb-4 rounded-lg border border-white/5 bg-white/[0.03] p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-slate-500 font-bold">Brain State</div>
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <BrainMetric label="Learning samples" value={`${decision.brain_state?.learning_samples ?? 0}`} />
          <BrainMetric label="Similar setup" value={`${(((decision.brain_state?.similar_win_rate ?? 0.5) * 100)).toFixed(0)}% / ${decision.brain_state?.similar_sample ?? 0}`} />
          <BrainMetric label="Time bucket" value={decision.brain_state?.time_bucket || 'waiting'} />
          <BrainMetric label="Odds bucket" value={decision.brain_state?.odds_bucket || 'waiting'} />
          <BrainMetric label="Loss guard" value={decision.brain_state?.loss_guard || 'clear'} />
          <BrainMetric label="Stake logic" value={(decision.brain_state?.stake_reasons || ['standard stake'])[0]} />
        </div>
      </div>

      <div className="relative z-10 mt-auto">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2 flex items-center gap-1">
          <Zap className="w-3 h-3 text-cyan-400" /> Bot Reasoning
        </div>
        <div className="space-y-2">
          {!decision.eligible && decision.eligibility_reason && (
            <div className="text-xs text-orange-200 bg-orange-500/[0.07] border border-orange-500/15 rounded-lg px-3 py-2">
              Eligibility: {decision.eligibility_reason}
            </div>
          )}
          {(decision.reasons.length ? decision.reasons : [decision.no_trade_reason || 'Waiting for stronger fee-adjusted edge.']).map((reason, i) => (
            <div key={i} className="text-xs text-slate-300 bg-white/[0.03] border border-white/5 rounded-lg px-3 py-2">
              {reason}
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function SignalList({ title, items, tone }: { title: string; items: string[]; tone: 'support' | 'risk' }) {
  const color = tone === 'support' ? 'text-emerald-300 border-emerald-500/15 bg-emerald-500/5' : 'text-orange-300 border-orange-500/15 bg-orange-500/5';
  return (
    <div className={`rounded-lg border p-3 ${color}`}>
      <div className="mb-2 text-[10px] uppercase tracking-wider font-bold opacity-80">{title}</div>
      <div className="space-y-1.5">
        {(items.length ? items : ['waiting for live signal stack']).slice(0, 3).map((item, index) => (
          <div key={index} className="text-[11px] leading-4 text-slate-300">{item}</div>
        ))}
      </div>
    </div>
  );
}

function BrainMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/5 bg-black/15 p-2">
      <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 truncate text-xs font-mono text-slate-200" title={value}>{value}</div>
    </div>
  );
}

function MarketSide({
  label,
  selected,
  bought,
  color,
  price,
  bid,
  ask,
  fair,
  edge,
}: {
  label: 'Up' | 'Down';
  selected: boolean;
  bought: boolean;
  color: 'blue' | 'pink';
  price: number;
  bid: number;
  ask: number;
  fair: number;
  edge: number;
}) {
  const palette = color === 'blue'
    ? {
        text: 'text-blue-400',
        bg: selected || bought ? 'bg-blue-500/15 border-blue-500/40 shadow-[0_0_15px_rgba(59,130,246,0.22)]' : 'bg-white/5 border-white/5',
        badge: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
      }
    : {
        text: 'text-pink-500',
        bg: selected || bought ? 'bg-pink-500/15 border-pink-500/40 shadow-[0_0_15px_rgba(236,72,153,0.22)]' : 'bg-white/5 border-white/5',
        badge: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
      };

  return (
    <div className={clsx('relative p-3 rounded-lg border transition-all flex flex-col gap-1', palette.bg)}>
      <div className="flex justify-between w-full mb-1">
        <span className={clsx('text-sm font-bold', palette.text)}>{label}</span>
        {(selected || bought) && (
          <span className={clsx('text-[10px] px-1.5 rounded font-bold border', palette.badge)}>
            {bought ? 'BOUGHT' : 'TARGET'}
          </span>
        )}
      </div>
      <div className="text-2xl font-mono text-white tracking-tight">{(price * 100).toFixed(1)}c</div>
      <div className="text-[10px] text-slate-500 font-mono">
        Bid {(bid * 100).toFixed(1)}c / Ask {(ask * 100).toFixed(1)}c
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
        <div className="text-slate-500">Fair <span className="text-slate-300">{(fair * 100).toFixed(1)}c</span></div>
        <div className={edge >= 0 ? 'text-emerald-400' : 'text-rose-400'}>Edge {(edge * 100).toFixed(1)}c</div>
      </div>
    </div>
  );
}
