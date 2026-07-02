import { useState, useEffect } from 'react';
import { Play, Square, RotateCcw, Copy, ChevronDown } from 'lucide-react';
import axios from 'axios';
import { motion, AnimatePresence } from 'motion/react';

interface Settings {
  balance: string;
  stake_amount: string;
  payout_mode: string;
  confidence_threshold: string;
  is_running: string;
  no_trade_enabled: string;
  uptime_start_time?: string;
  copy_mode_enabled?: string;
  copy_target_address?: string;
}

function parsePolymarketInput(url: string): { type: 'address'; value: string } | { type: 'username'; value: string } | null {
  try {
    // 0x wallet address directly
    const directAddr = url.trim().match(/^(0x[a-fA-F0-9]{40,})$/i);
    if (directAddr) return { type: 'address', value: directAddr[1] };

    // URL with 0x address: https://polymarket.com/profile/0xABC...
    const urlAddr = url.match(/polymarket\.com\/profile\/(0x[a-fA-F0-9]{40,})/i);
    if (urlAddr) return { type: 'address', value: urlAddr[1] };

    // URL with @username or just username: /profile/@BoneReader or /profile/BoneReader
    const urlUser = url.match(/polymarket\.com\/profile\/@?([A-Za-z0-9_.-]+)/i);
    if (urlUser) return { type: 'username', value: urlUser[1] };

    // Plain @username
    const atUser = url.trim().match(/^@?([A-Za-z0-9_.-]{3,})$/);
    if (atUser) return { type: 'username', value: atUser[1] };

    return null;
  } catch {
    return null;
  }
}

export default function ControlPanel({ settings, onUpdate }: { settings: Settings, onUpdate: () => void }) {
  const [localSettings, setLocalSettings] = useState<Settings>(settings);
  const [uptime, setUptime] = useState<string>('00:00:00');
  const [copyUrl, setCopyUrl] = useState(settings.copy_target_address || '');
  const [copyUrlValid, setCopyUrlValid] = useState(!!settings.copy_target_address);
  const [resolving, setResolving] = useState(false);
  const [resolvedUsername, setResolvedUsername] = useState<string | null>(null);

  const isRunning = settings.is_running === 'true';
  const copyModeEnabled = localSettings.copy_mode_enabled === 'true';

  useEffect(() => {
    setLocalSettings(settings);
    
    // Only update the copyUrl if it's completely empty (initial load)
    // or if the settings have a genuinely new saved address that we aren't already watching.
    // This prevents the input from being cleared while the user is typing when the 5s poll fires.
    if (settings.copy_target_address && settings.copy_target_address !== localSettings.copy_target_address) {
      setCopyUrl(settings.copy_target_address);
      setCopyUrlValid(true);
    }
  }, [settings.copy_target_address, settings.is_running, settings.uptime_start_time, settings.stake_amount]);

  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (isRunning && settings.uptime_start_time && settings.uptime_start_time !== '0') {
      const startTime = parseInt(settings.uptime_start_time, 10);

      const updateUptime = () => {
        const now = Date.now();
        const diff = Math.max(0, now - startTime);

        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        const formatted = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        setUptime(formatted);
      };

      updateUptime();
      interval = setInterval(updateUptime, 1000);
    } else {
      setUptime('00:00:00');
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRunning, settings.uptime_start_time]);

  const handleAction = async (action: 'start' | 'stop' | 'reset') => {
    try {
      await axios.post('/api/control', { action });
      onUpdate();
    } catch (error) {
      console.error('Control action failed:', error);
    }
  };

  const handleChange = async (key: keyof Settings, value: string) => {
    setLocalSettings(prev => ({ ...prev, [key]: value }));
    try {
      await axios.post('/api/settings', { key, value });
      onUpdate();
    } catch (error) {
      console.error('Save failed:', error);
    }
  };

  const handleCopyToggle = async () => {
    const newVal = copyModeEnabled ? 'false' : 'true';
    await handleChange('copy_mode_enabled', newVal);
  };

  const handleCopyUrlChange = async (url: string) => {
    setCopyUrl(url);
    setCopyUrlValid(false);
    setResolvedUsername(null);

    const parsed = parsePolymarketInput(url);
    if (!parsed) return;

    if (parsed.type === 'address') {
      setCopyUrlValid(true);
      await axios.post('/api/settings', { key: 'copy_target_address', value: parsed.value });
      onUpdate();
    } else if (parsed.type === 'username') {
      // Need to resolve username → wallet address via backend
      setResolving(true);
      try {
        const res = await axios.get('/api/resolve-polymarket-handle', { params: { handle: parsed.value } });
        if (res.data?.address) {
          setCopyUrlValid(true);
          setResolvedUsername(parsed.value);
          await axios.post('/api/settings', { key: 'copy_target_address', value: res.data.address });
          onUpdate();
        } else {
          setCopyUrlValid(false);
        }
      } catch {
        setCopyUrlValid(false);
      } finally {
        setResolving(false);
      }
    }
  };

  const walletDisplay = settings.copy_target_address
    ? `${settings.copy_target_address.slice(0, 6)}...${settings.copy_target_address.slice(-4)}`
    : null;

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
              onClick={() => handleAction('start')}
              className="flex items-center justify-center gap-2 w-32 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-all shadow-[0_0_15px_rgba(37,99,235,0.4)] border border-blue-500/50"
            >
              <Play className="w-4 h-4" /> Start Bot
            </button>
          ) : (
            <button
              onClick={() => handleAction('stop')}
              className="flex items-center justify-center gap-2 w-32 py-2 bg-pink-600 text-white rounded-lg hover:bg-pink-500 transition-all shadow-[0_0_15px_rgba(219,39,119,0.4)] border border-pink-500/50"
            >
              <Square className="w-4 h-4" /> Stop Bot
            </button>
          )}
          {isRunning && (
            <div className="text-[11px] text-purple-300 font-mono tracking-wider flex items-center justify-center gap-1.5 opacity-90 w-32 bg-purple-500/10 py-1 rounded-md border border-purple-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse"></span>
              {uptime}
            </div>
          )}
        </div>
      </div>

      <div className="mb-6">
        <label className="block text-xs font-medium text-slate-400 mb-1">Stake Amount ($)</label>
        <input
          type="number"
          value={localSettings.stake_amount}
          onChange={(e) => handleChange('stake_amount', e.target.value)}
          className="w-full p-2 bg-[#0B0E14] border border-white/10 text-white rounded-lg text-sm focus:outline-none focus:border-purple-500 transition-colors"
          disabled={isRunning}
        />
      </div>

      {/* ── COPY TRADING SECTION ── */}
      <div className="mb-4">
        <button
          onClick={handleCopyToggle}
          className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all group ${
            copyModeEnabled
              ? 'bg-fuchsia-500/15 border-fuchsia-500/50 shadow-[0_0_15px_rgba(217,70,239,0.2)]'
              : 'bg-purple-500/5 border-purple-500/30 hover:border-purple-500/50 hover:bg-purple-500/10'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div className={`p-1.5 rounded-lg transition-all ${copyModeEnabled ? 'bg-fuchsia-500/20' : 'bg-white/5'}`}>
              <Copy className={`w-4 h-4 ${copyModeEnabled ? 'text-fuchsia-400' : 'text-slate-400'}`} />
            </div>
            <div className="text-left">
              <div className={`text-sm font-semibold transition-colors ${copyModeEnabled ? 'text-fuchsia-300' : 'text-slate-300'}`}>
                Copy Trading
              </div>
              <div className="text-[10px] text-slate-500">Mirror a Polymarket trader's moves</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Toggle pill */}
            <div className={`relative w-10 h-5.5 rounded-full transition-all duration-300 ${copyModeEnabled ? 'bg-fuchsia-500' : 'bg-slate-700'}`}
              style={{ height: '22px', width: '40px' }}>
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-300 ${copyModeEnabled ? 'left-5' : 'left-0.5'}`} />
            </div>
            <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform duration-300 ${copyModeEnabled ? 'rotate-180' : ''}`} />
          </div>
        </button>

        <AnimatePresence>
          {copyModeEnabled && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div className="mt-2 p-4 rounded-xl bg-fuchsia-950/30 border border-fuchsia-500/20 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-fuchsia-300 mb-1.5">
                    Polymarket Profile URL
                  </label>
                  <input
                    type="text"
                    value={copyUrl}
                    onChange={(e) => handleCopyUrlChange(e.target.value)}
                    placeholder="polymarket.com/profile/@Username or 0x..."
                    className={`w-full p-2.5 bg-[#0B0E14] border rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none transition-colors ${
                      copyUrl
                        ? copyUrlValid
                          ? 'border-fuchsia-500/50 focus:border-fuchsia-400'
                          : 'border-rose-500/50 focus:border-rose-400'
                        : 'border-white/10 focus:border-fuchsia-500'
                    }`}
                  />
                </div>

                {/* Status badge */}
                {(copyUrl || resolving) && (
                  <div className={`flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg ${
                    resolving
                      ? 'bg-slate-800 border border-slate-600 text-slate-400'
                      : copyUrlValid
                      ? 'bg-fuchsia-500/10 border border-fuchsia-500/20 text-fuchsia-300'
                      : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
                  }`}>
                    {resolving ? (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse" />
                        Resolving username...
                      </>
                    ) : copyUrlValid && walletDisplay ? (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-fuchsia-400 animate-pulse" />
                        {resolvedUsername
                          ? `Watching @${resolvedUsername} (${walletDisplay})`
                          : `Watching ${walletDisplay}`
                        }
                      </>
                    ) : (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                        Invalid — paste a Polymarket profile URL or @username
                      </>
                    )}
                  </div>
                )}

                <p className="text-[10px] text-slate-500 leading-relaxed">
                  When this trader places any UP or DOWN trade in a 5-minute BTC market, your bot will copy it <span className="text-fuchsia-400 font-semibold">instantly</span>.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="pt-4 border-t border-white/5 flex justify-between items-center">
        <div className="flex-1"></div>
        <button
          onClick={() => handleAction('reset')}
          className="text-xs text-slate-500 hover:text-purple-400 flex items-center gap-1 transition-colors"
          title="Resets balance and clears trade history"
        >
          <RotateCcw className="w-3 h-3" /> Full Reset
        </button>
      </div>
    </motion.div>
  );
}
