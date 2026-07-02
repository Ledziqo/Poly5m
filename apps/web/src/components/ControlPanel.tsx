import { useEffect, useState } from 'react';
import { Play, Square, RotateCcw, ShieldAlert, Ban, SlidersHorizontal } from 'lucide-react';
import { motion } from 'motion/react';
import { postControl, postSettings, Settings } from '../api';

export default function ControlPanel({ settings, onUpdate }: { settings: Settings; onUpdate: () => void }) {
  const [local, setLocal] = useState(settings);
  const [saving, setSaving] = useState(false);
  const isRunning = settings.bot_state === 'running';

  useEffect(() => {
    setLocal(settings);
  }, [settings]);

  const runAction = async (action: 'start' | 'stop' | 'reset' | 'emergency_stop') => {
    setSaving(true);
    try {
      await postControl(action);
      onUpdate();
    } finally {
      setSaving(false);
    }
  };

  const save = async (patch: Partial<Settings>) => {
    const next = { ...local, ...patch };
    setLocal(next);
    setSaving(true);
    try {
      await postSettings(patch);
      onUpdate();
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5 }}
      className="bg-[#131722]/60 backdrop-blur-xl p-6 rounded-xl shadow-lg border border-white/10 hover:border-white/20 transition-all"
    >
      <div className="flex justify-between items-start mb-6">
        <h3 className="text-lg font-bold text-white flex items-center gap-2 mt-2">
          <span className="w-1 h-4 bg-purple-500 rounded-full"></span>
          Bot Controls
        </h3>
        <div className="flex flex-col items-end gap-1.5">
          {!isRunning ? (
            <button
              onClick={() => runAction('start')}
              disabled={saving}
              className="flex items-center justify-center gap-2 w-32 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-all shadow-[0_0_15px_rgba(37,99,235,0.4)] border border-blue-500/50 disabled:opacity-50"
            >
              <Play className="w-4 h-4" /> Start Bot
            </button>
          ) : (
            <button
              onClick={() => runAction('stop')}
              disabled={saving}
              className="flex items-center justify-center gap-2 w-32 py-2 bg-pink-600 text-white rounded-lg hover:bg-pink-500 transition-all shadow-[0_0_15px_rgba(219,39,119,0.4)] border border-pink-500/50 disabled:opacity-50"
            >
              <Square className="w-4 h-4" /> Stop Bot
            </button>
          )}
          <div className="text-[11px] text-purple-300 font-mono tracking-wider flex items-center justify-center gap-1.5 opacity-90 w-32 bg-purple-500/10 py-1 rounded-md border border-purple-500/20">
            <span className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-cyan-400 animate-pulse' : 'bg-slate-500'}`}></span>
            {settings.bot_state.toUpperCase()}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <label className="block">
          <span className="block text-xs font-medium text-slate-400 mb-1">Stake Amount ($)</span>
          <input
            type="number"
            min="1"
            step="1"
            value={local.stake_amount}
            onChange={(e) => save({ stake_amount: Number(e.target.value) })}
            className="w-full p-2 bg-[#0B0E14] border border-white/10 text-white rounded-lg text-sm focus:outline-none focus:border-purple-500 transition-colors"
          />
        </label>

        <label className="block">
          <span className="block text-xs font-medium text-slate-400 mb-1">Starting Balance ($)</span>
          <input
            type="number"
            min="10"
            step="10"
            value={local.starting_balance}
            onChange={(e) => save({ starting_balance: Number(e.target.value) })}
            className="w-full p-2 bg-[#0B0E14] border border-white/10 text-white rounded-lg text-sm focus:outline-none focus:border-purple-500 transition-colors"
          />
        </label>

        <label className="block">
          <span className="block text-xs font-medium text-slate-400 mb-1">Risk Mode</span>
          <select
            value={local.risk_mode}
            onChange={(e) => save({ risk_mode: e.target.value as Settings['risk_mode'] })}
            className="w-full p-2 bg-[#0B0E14] border border-white/10 text-white rounded-lg text-sm focus:outline-none focus:border-purple-500 transition-colors"
          >
            <option value="safe">Safe</option>
            <option value="balanced">Balanced</option>
            <option value="aggressive">Aggressive</option>
          </select>
        </label>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
          <div className="flex items-center gap-2 text-xs text-cyan-300 mb-1">
            <SlidersHorizontal className="w-3 h-3" /> Cadence
          </div>
          <div className="text-lg font-mono font-bold text-white">
            {settings.skipped_windows}/{settings.forced_cadence_every - 1}
          </div>
          <div className="text-[10px] text-slate-500">3rd skip forces a trade</div>
        </div>
        <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-3">
          <div className="flex items-center gap-2 text-xs text-orange-300 mb-1">
            <ShieldAlert className="w-3 h-3" /> Taker Fee
          </div>
          <div className="text-lg font-mono font-bold text-white">
            {(settings.taker_fee_rate * 100).toFixed(2)}%
          </div>
          <div className="text-[10px] text-slate-500">included in simulator</div>
        </div>
      </div>

      <div className="pt-4 mt-4 border-t border-white/5 flex justify-between items-center">
        <button
          onClick={() => runAction('emergency_stop')}
          className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1 transition-colors"
        >
          <Ban className="w-3 h-3" /> Emergency Stop
        </button>
        <button
          onClick={() => runAction('reset')}
          className="text-xs text-slate-500 hover:text-purple-400 flex items-center gap-1 transition-colors"
          title="Resets balance, stats, trades, and bot state"
        >
          <RotateCcw className="w-3 h-3" /> Full Reset
        </button>
      </div>
    </motion.div>
  );
}
