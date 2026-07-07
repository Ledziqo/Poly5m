import { useEffect, useState } from 'react';
import type React from 'react';
import { BrainCircuit, Gauge, Target, TrendingDown, TrendingUp } from 'lucide-react';
import { BrainPerformance, getBrainPerformance } from '../api';

const emptyGroup = { trades: 0, wins: 0, losses: 0, win_rate: 0, pnl: 0, expectancy: 0 };

export default function BrainPerformancePanel() {
  const [performance, setPerformance] = useState<BrainPerformance | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const data = await getBrainPerformance();
        if (active) setPerformance(data);
      } catch (error) {
        console.error('Failed to load brain performance:', error);
      }
    };
    load();
    const interval = setInterval(load, 4000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const last50 = performance?.last50 || emptyGroup;
  const forced = performance?.forced || emptyGroup;
  const normal = performance?.normal || emptyGroup;
  const best = performance?.best_time_bucket || { bucket: 'none', ...emptyGroup };
  const worst = performance?.worst_time_bucket || { bucket: 'none', ...emptyGroup };

  return (
    <div className="bg-[#131722]/60 backdrop-blur-xl p-4 rounded-xl shadow-lg border border-white/10 hover:border-white/20 transition-all">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <BrainCircuit className="h-4 w-4 text-[#CBB9FF]" />
          Brain Performance
        </div>
        <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{performance?.total.trades || 0} learned</div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <BrainStat icon={<Gauge className="h-3.5 w-3.5" />} label="Last 50 EV" value={`${money(last50.expectancy)}/trade`} tone={last50.expectancy >= 0 ? 'green' : 'pink'} />
        <BrainStat icon={<Target className="h-3.5 w-3.5" />} label="Last 50 WR" value={`${(last50.win_rate * 100).toFixed(1)}%`} />
        <BrainStat icon={<TrendingUp className="h-3.5 w-3.5" />} label="Best bucket" value={`${best.bucket} ${money(best.expectancy)}`} tone="green" />
        <BrainStat icon={<TrendingDown className="h-3.5 w-3.5" />} label="Worst bucket" value={`${worst.bucket} ${money(worst.expectancy)}`} tone="pink" />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/10 pt-3 text-xs">
        <MiniSplit label="Normal" value={`${normal.trades} trades`} pnl={normal.pnl} />
        <MiniSplit label="Required" value={`${forced.trades} trades`} pnl={forced.pnl} />
      </div>
    </div>
  );
}

function money(value: number) {
  return `${value >= 0 ? '+' : ''}$${value.toFixed(2)}`;
}

function BrainStat({ icon, label, value, tone = 'white' }: { icon: React.ReactNode; label: string; value: string; tone?: 'green' | 'pink' | 'white' }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5 min-w-0">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-slate-500">
        {icon}
        {label}
      </div>
      <div className={`truncate font-mono text-sm font-semibold ${tone === 'green' ? 'text-emerald-300' : tone === 'pink' ? 'text-rose-300' : 'text-white'}`} title={value}>
        {value}
      </div>
    </div>
  );
}

function MiniSplit({ label, value, pnl }: { label: string; value: string; pnl: number }) {
  return (
    <div className="min-w-0 rounded-lg bg-black/15 px-2.5 py-2">
      <div className="text-slate-500">{label}</div>
      <div className="truncate text-slate-300">{value}</div>
      <div className={`font-mono ${pnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{money(pnl)}</div>
    </div>
  );
}
