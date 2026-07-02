import { useState } from 'react';
import type React from 'react';
import Dashboard from './components/Dashboard';
import { Toaster, toast } from 'sonner';
import './index.css';

const OWNER_EMAIL = 'Aesliexx@gmail.com';
const OWNER_PASSWORD = 'Mudi2005';

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [authed, setAuthed] = useState(localStorage.getItem('poly5m_auth') === 'true');

  const nav = (next: string) => {
    window.history.pushState({}, '', next);
    setPath(next);
  };

  window.onpopstate = () => setPath(window.location.pathname);

  const login = (email: string, password: string) => {
    if (email.trim().toLowerCase() === OWNER_EMAIL.toLowerCase() && password === OWNER_PASSWORD) {
      localStorage.setItem('poly5m_auth', 'true');
      setAuthed(true);
      nav('/dashboard');
      return;
    }
    toast.error('Access denied', { description: 'Use the approved owner credentials.' });
  };

  return (
    <>
      <Toaster position="top-right" theme="dark" />
      {path === '/login' && <Login onLogin={login} onNav={nav} />}
      {path === '/request-access' && <RequestAccess onNav={nav} />}
      {path === '/dashboard' && (authed ? <Dashboard /> : <Login onLogin={login} onNav={nav} />)}
      {path !== '/login' && path !== '/request-access' && path !== '/dashboard' && <Landing onNav={nav} />}
    </>
  );
}

function Landing({ onNav }: { onNav: (path: string) => void }) {
  return (
    <div className="min-h-screen bg-[#05070C] text-white overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_10%,rgba(34,211,238,0.16),transparent_25%),radial-gradient(circle_at_78%_16%,rgba(236,72,153,0.13),transparent_28%),radial-gradient(circle_at_52%_78%,rgba(139,92,246,0.12),transparent_34%),linear-gradient(90deg,rgba(255,255,255,0.026)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.026)_1px,transparent_1px)] bg-[size:auto,auto,auto,70px_70px,70px_70px]" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/70 to-transparent" />
      <div className="relative max-w-7xl mx-auto px-5 md:px-6 py-7">
        <header className="flex items-center justify-between gap-4">
          <img src="/polyengine-signal-dial.png" alt="PolyEngine" className="h-20 md:h-28 w-auto object-contain drop-shadow-[0_0_28px_rgba(34,211,238,0.20)]" />
          <nav className="hidden md:flex items-center gap-8 text-sm text-slate-400">
            <a href="#brain" className="hover:text-cyan-200 transition">Brain</a>
            <a href="#signals" className="hover:text-cyan-200 transition">Signals</a>
            <a href="#simulator" className="hover:text-cyan-200 transition">Simulator</a>
          </nav>
          <div className="flex items-center gap-3">
            <button onClick={() => onNav('/login')} className="rounded-full border border-white/10 px-5 py-2 text-sm text-slate-200 hover:border-cyan-400/40 transition">Login</button>
            <button onClick={() => onNav('/request-access')} className="rounded-full bg-cyan-300 px-5 py-2 text-sm font-bold text-slate-950 hover:bg-cyan-200 transition">Request access</button>
          </div>
        </header>

        <main className="grid lg:grid-cols-[0.92fr_1.08fr] gap-10 xl:gap-14 items-center pt-12 md:pt-16">
          <section>
            <div className="inline-flex rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-cyan-200 text-sm mb-6 shadow-[0_0_24px_rgba(34,211,238,0.10)]">
              Private BTC 5-minute execution brain for Polymarket
            </div>
            <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight leading-[0.94] max-w-3xl">
              Trade the shortest Bitcoin window with a calmer machine.
            </h1>
            <p className="mt-6 text-lg text-slate-300 leading-8 max-w-2xl">
              PolyEngine watches live BTC ticks, Polymarket Up/Down odds, order-book pressure, fees, volatility, price-to-beat distance, and time decay, then builds a stable decision instead of reacting to every tiny move.
            </p>
            <div className="mt-8 grid grid-cols-3 gap-3 max-w-2xl">
              <LandingMetric value="0.1s" label="live stream" />
              <LandingMetric value="2:00" label="entry cutoff" />
              <LandingMetric value="1.8%" label="fee model" />
            </div>
            <div className="mt-8 flex flex-wrap gap-4">
              <button onClick={() => onNav('/request-access')} className="rounded-xl bg-cyan-300 px-6 py-3 font-bold text-slate-950 hover:bg-cyan-200 transition shadow-[0_0_28px_rgba(34,211,238,0.20)]">Request access</button>
              <button onClick={() => onNav('/login')} className="rounded-xl border border-white/10 px-6 py-3 font-bold text-white hover:border-purple-400/40 transition">Open terminal</button>
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-[#101522]/85 backdrop-blur-xl p-5 md:p-6 shadow-2xl shadow-cyan-500/10 relative overflow-hidden">
            <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-cyan-400/10 blur-3xl" />
            <div className="absolute -bottom-28 left-16 h-72 w-72 rounded-full bg-fuchsia-500/10 blur-3xl" />
            <div className="relative">
              <div className="flex items-center justify-between gap-4 mb-5">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.32em] text-cyan-200/80">Live decision cockpit</div>
                  <h2 className="mt-2 text-2xl font-bold">BTC 5m signal window</h2>
                </div>
                <div className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-bold text-emerald-300">STREAMING</div>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-5">
                <PreviewStat label="Countdown" value="02:37" tone="red" />
                <PreviewStat label="Brain" value="DOWN" tone="pink" />
                <PreviewStat label="Bias" value="+0.42" tone="green" />
              </div>
              <div className="h-72 rounded-2xl border border-white/10 bg-[#080C13] relative overflow-hidden">
                <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:48px_48px]" />
                <div className="absolute left-5 top-4 z-10 rounded-lg border border-white/10 bg-black/45 px-3 py-2 font-mono text-sm text-white">$61,276.06</div>
                <div className="absolute right-5 top-4 z-10 rounded-lg border border-pink-400/20 bg-pink-400/10 px-3 py-2 text-xs text-pink-200">price-to-beat line</div>
                <svg viewBox="0 0 600 240" className="absolute inset-0 h-full w-full">
                  <path className="landing-line" d="M0 168 C70 150 118 170 178 146 C235 122 280 72 334 104 C388 138 430 122 476 92 C530 58 556 82 600 52" fill="none" stroke="#a78bfa" strokeWidth="5" />
                  <path d="M0 170 C70 152 118 172 178 148 C235 124 280 74 334 106 C388 140 430 124 476 94 C530 60 556 84 600 54" fill="none" stroke="#22d3ee" strokeWidth="1.5" opacity="0.9" />
                  <line x1="0" y1="124" x2="600" y2="124" stroke="#f472b6" strokeDasharray="8 8" opacity="0.75" />
                </svg>
              </div>
              <div className="mt-5 grid md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
                  <div className="flex justify-between"><span className="text-blue-300 font-bold">UP</span><span className="font-mono text-white">69.5c</span></div>
                  <div className="text-xs text-slate-500 mt-1">Bid 68.5c / Ask 70.5c</div>
                </div>
                <div className="rounded-xl border border-pink-500/30 bg-pink-500/10 p-4">
                  <div className="flex justify-between"><span className="text-pink-300 font-bold">DOWN</span><span className="font-mono text-white">30.5c</span></div>
                  <div className="text-xs text-slate-500 mt-1">Stable side selected after confirmations</div>
                </div>
              </div>
              <div className="mt-4 rounded-xl border border-purple-500/20 bg-purple-500/5 p-4 text-sm text-slate-300">
                Brain held DOWN after 4 confirmation ticks. EMA slope is fading, VWAP distance is negative, fee-adjusted edge remains positive, and anti-flip guard blocked a weak UP twitch.
              </div>
            </div>
          </section>
        </main>

        <section id="brain" className="py-20">
          <div className="mb-8 max-w-3xl">
            <div className="text-sm uppercase tracking-[0.28em] text-cyan-300">How it thinks</div>
            <h2 className="mt-3 text-3xl md:text-5xl font-extrabold">Not a blinking signal. A decision system.</h2>
            <p className="mt-4 text-slate-400 leading-7">The bot blends raw indicators with memory and confirmation. It can wait, hold a bias through noise, and explain exactly why it refuses to enter or flip sides.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            <FeatureCard title="Signal memory" text="Each window keeps a smoothed Up/Down bias so one tick cannot instantly reverse the decision." />
            <FeatureCard title="Confirmation guard" text="The brain requires repeated confirmation before changing sides, reducing nervous flip-flopping." />
            <FeatureCard title="Trade review loop" text="Recent win/loss behavior influences confidence so the engine becomes more cautious after weak sequences." />
          </div>
        </section>

        <section id="signals" className="grid lg:grid-cols-2 gap-5 pb-20">
          <FeaturePanel title="Inputs the bot watches" items={["BTC tick stream and live chart pressure", "Polymarket Up/Down bid, ask, spread, and depth", "EMA slope, VWAP distance, RSI, acceleration, volatility", "Price-to-beat distance, time left, and 2-minute cutoff", "Fee-adjusted fair value and expected edge"]} />
          <FeaturePanel title="What the terminal shows" items={["Live decision: Up, Down, or Wait", "Plain-English reasoning for every trade/no-trade", "Active trade, resolved history, PnL, win rate, streaks", "Real-time system log of the bot's thought process", "Settings for starting balance, stake, fee, risk, and reset"]} />
        </section>

        <section id="simulator" className="pb-20">
          <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-cyan-400/10 via-[#111621]/90 to-fuchsia-500/10 p-6 md:p-8">
            <div className="grid lg:grid-cols-[0.8fr_1.2fr] gap-8 items-center">
              <div>
                <div className="text-sm uppercase tracking-[0.28em] text-cyan-300">1:1 simulator first</div>
                <h2 className="mt-3 text-3xl md:text-5xl font-extrabold">Test the same decisions before capital goes live.</h2>
              </div>
              <p className="text-slate-300 leading-8">
                PolyEngine is built around discipline: simulated fills include taker fee, entry price, price-to-beat, shares, and window resolution. The goal is not to scream every signal; it is to make fewer, clearer decisions with a full audit trail.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function LandingMetric({ value, label }: { value: string; label: string }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"><div className="text-2xl font-mono font-bold text-white">{value}</div><div className="text-[10px] uppercase tracking-[0.25em] text-slate-500 mt-1">{label}</div></div>;
}

function FeatureCard({ title, text }: { title: string; text: string }) {
  return <div className="rounded-2xl border border-white/10 bg-[#111621]/70 p-6 shadow-xl shadow-black/20"><h3 className="font-bold text-white text-lg mb-3">{title}</h3><p className="text-slate-400 leading-7">{text}</p></div>;
}

function FeaturePanel({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-[#111621]/70 p-6 md:p-8 shadow-xl shadow-black/20">
      <h3 className="text-2xl font-bold text-white mb-5">{title}</h3>
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item} className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.025] px-4 py-3 text-slate-300">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.8)]" />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PreviewStat({ label, value, tone }: { label: string; value: string; tone: 'red' | 'pink' | 'green' }) {
  const color = tone === 'red' ? 'text-red-400' : tone === 'pink' ? 'text-pink-400' : 'text-emerald-400';
  return <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4"><div className="text-xs text-slate-500 mb-2">{label}</div><div className={`text-2xl font-mono font-bold ${color}`}>{value}</div></div>;
}

function Login({ onLogin, onNav }: { onLogin: (email: string, password: string) => void; onNav: (path: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <AuthShell>
      <h1 className="text-3xl font-bold text-white mb-2">Welcome back</h1>
      <p className="text-slate-400 mb-8">Private PolyEngine terminal access.</p>
      <label className="block text-sm text-slate-300 mb-2">Email</label>
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" className="w-full mb-5 rounded-xl border border-white/10 bg-[#0B0E14] px-4 py-3 text-white outline-none focus:border-cyan-400" />
      <label className="block text-sm text-slate-300 mb-2">Password</label>
      <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" className="w-full mb-6 rounded-xl border border-white/10 bg-[#0B0E14] px-4 py-3 text-white outline-none focus:border-cyan-400" />
      <button onClick={() => onLogin(email, password)} className="w-full rounded-xl bg-cyan-300 py-3 font-bold text-slate-950 hover:bg-cyan-200 transition">Enter terminal</button>
      <button onClick={() => onNav('/request-access')} className="mt-5 text-sm text-cyan-300 hover:text-cyan-200">Request access through Telegram</button>
    </AuthShell>
  );
}

function RequestAccess({ onNav }: { onNav: (path: string) => void }) {
  return (
    <AuthShell>
      <h1 className="text-3xl font-bold text-white mb-2">Request access</h1>
      <p className="text-slate-400 mb-8">PolyEngine is private while the BTC 5m engine is being validated.</p>
      <a href="https://t.me/Aesliex" target="_blank" rel="noopener noreferrer" className="block w-full rounded-xl bg-cyan-300 py-3 text-center font-bold text-slate-950 hover:bg-cyan-200 transition">Message @Aesliex</a>
      <button onClick={() => onNav('/login')} className="mt-5 text-sm text-cyan-300 hover:text-cyan-200">Back to login</button>
    </AuthShell>
  );
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0B0E14] bg-[radial-gradient(circle_at_50%_10%,rgba(34,211,238,0.12),transparent_30%)] flex items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#131722]/80 backdrop-blur-xl p-8 shadow-2xl">
        <img src="/polyengine-signal-dial.png" alt="PolyEngine" className="h-32 md:h-36 w-auto max-w-full object-contain mb-10" />
        {children}
      </div>
    </div>
  );
}
