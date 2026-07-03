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
    <div className="min-h-screen bg-[#070A0F] text-slate-100">
      <div className="border-b border-white/10 bg-[#070A0F]/95">
        <div className="max-w-7xl mx-auto px-5 md:px-6 h-20 flex items-center justify-between gap-4">
          <button onClick={() => onNav('/')} className="flex items-center gap-3">
            <img src="/polyengine-icon.png" alt="PolyEngine" className="h-9 w-9 rounded-md object-contain" />
            <div className="text-left">
              <div className="text-sm font-semibold tracking-wide text-white">PolyEngine</div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">BTC 5m terminal</div>
            </div>
          </button>
          <nav className="hidden md:flex items-center gap-7 text-sm text-slate-400">
            <a href="#data" className="hover:text-white transition">Data</a>
            <a href="#process" className="hover:text-white transition">Process</a>
            <a href="#audit" className="hover:text-white transition">Audit</a>
          </nav>
          <div className="flex items-center gap-2">
            <button onClick={() => onNav('/login')} className="h-10 px-4 border border-white/12 bg-white/[0.03] text-sm font-medium text-slate-200 hover:bg-white/[0.06] transition">Login</button>
            <button onClick={() => onNav('/request-access')} className="h-10 px-4 bg-white text-sm font-semibold text-[#070A0F] hover:bg-slate-200 transition">Request access</button>
          </div>
        </div>
      </div>

      <main>
        <section className="border-b border-white/10">
          <div className="max-w-7xl mx-auto px-5 md:px-6 py-12 md:py-16 grid lg:grid-cols-[0.82fr_1.18fr] gap-10 items-start">
            <div className="pt-2">
              <div className="inline-flex border border-emerald-400/20 bg-emerald-400/8 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
                Private live paper engine
              </div>
              <h1 className="mt-6 text-4xl md:text-6xl font-semibold leading-[1.02] tracking-tight text-white">
                Bitcoin 5-minute Polymarket execution, measured tick by tick.
              </h1>
              <p className="mt-6 max-w-xl text-base md:text-lg leading-8 text-slate-400">
                A focused cockpit for the BTC Up/Down 5m market: Polymarket Chainlink price, live CLOB odds, round timer, simulated fills, and a full decision log in one place.
              </p>
              <div className="mt-8 grid grid-cols-3 border border-white/10 divide-x divide-white/10 max-w-xl">
                <LandingMetric value="RTDS" label="price feed" />
                <LandingMetric value="CLOB" label="odds source" />
                <LandingMetric value="2:00" label="entry close" />
              </div>
              <div className="mt-8 flex flex-wrap gap-3">
                <button onClick={() => onNav('/login')} className="h-12 px-5 bg-cyan-300 text-sm font-bold text-slate-950 hover:bg-cyan-200 transition">Open terminal</button>
                <button onClick={() => onNav('/request-access')} className="h-12 px-5 border border-white/12 bg-white/[0.03] text-sm font-semibold text-white hover:bg-white/[0.06] transition">Request access</button>
              </div>
            </div>

            <TerminalPreview />
          </div>
        </section>

        <section id="data" className="border-b border-white/10 bg-[#0B0F15]">
          <div className="max-w-7xl mx-auto px-5 md:px-6 py-12 grid lg:grid-cols-[0.72fr_1.28fr] gap-8">
            <div>
              <div className="text-xs uppercase tracking-[0.22em] text-cyan-300">Data contract</div>
              <h2 className="mt-3 text-3xl font-semibold text-white">Built around the same market inputs you verify on Polymarket.</h2>
            </div>
            <div className="grid md:grid-cols-3 gap-3">
              <SourceBlock label="Current price" value="Polymarket Chainlink BTC/USD" detail="RTDS crypto_prices_chainlink stream" />
              <SourceBlock label="Timer" value="Event start/end" detail="Gamma market eventStartTime and endDate" />
              <SourceBlock label="Odds" value="Gamma + CLOB" detail="Outcome prices plus live bid/ask book" />
            </div>
          </div>
        </section>

        <section id="process" className="max-w-7xl mx-auto px-5 md:px-6 py-14">
          <div className="grid lg:grid-cols-[0.88fr_1.12fr] gap-8 items-start">
            <div>
              <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Operating model</div>
              <h2 className="mt-3 text-3xl md:text-4xl font-semibold text-white">No generic signals. Just the current round, the price to beat, and whether edge survives fees.</h2>
              <p className="mt-5 text-slate-400 leading-7">
                The terminal keeps the workflow narrow because this market is narrow. Every decision is tied to one five-minute window and the same displayed market data.
              </p>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <FeatureCard title="Window-aware" text="The engine stops new entries at the 2-minute mark and resolves positions on the Polymarket round boundary." />
              <FeatureCard title="Order-book aware" text="Up and Down sides use real Polymarket bid/ask levels so simulated entries are not based on invented spreads." />
              <FeatureCard title="Fee-aware" text="Expected edge is measured after taker-fee drag, not just raw probability." />
              <FeatureCard title="Human-readable" text="Every trade and wait decision includes the reason, confidence, and active market context." />
            </div>
          </div>
        </section>

        <section id="audit" className="border-t border-white/10 bg-[#0B0F15]">
          <div className="max-w-7xl mx-auto px-5 md:px-6 py-14 grid lg:grid-cols-3 gap-4">
            <FeaturePanel title="Live cockpit" items={["Current Polymarket BTC 5m event link", "Price to beat and current reference", "Up/Down midpoint odds and CLOB bid/ask", "Resolution timer synced from market data"]} />
            <FeaturePanel title="Paper execution" items={["Active position mark value", "Stake, shares, entry price, and fee paid", "Resolved win/loss history", "PnL, win rate, and streak tracking"]} />
            <FeaturePanel title="Decision audit" items={["Signal bias and confidence", "Momentum and distance checks", "Fee-adjusted edge comparison", "System log stream for every action"]} />
          </div>
        </section>
      </main>
    </div>
  );
}

function LandingMetric({ value, label }: { value: string; label: string }) {
  return <div className="p-4"><div className="text-xl md:text-2xl font-mono font-semibold text-white">{value}</div><div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 mt-1">{label}</div></div>;
}

function FeatureCard({ title, text }: { title: string; text: string }) {
  return <div className="border border-white/10 bg-white/[0.025] p-5"><h3 className="font-semibold text-white text-lg mb-3">{title}</h3><p className="text-sm text-slate-400 leading-6">{text}</p></div>;
}

function FeaturePanel({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="border border-white/10 bg-[#080C12] p-5">
      <h3 className="text-xl font-semibold text-white mb-5">{title}</h3>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item} className="flex gap-3 border-t border-white/10 pt-3 text-sm text-slate-300 first:border-t-0 first:pt-0">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 bg-cyan-300" />
            <span className="leading-6">{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PreviewStat({ label, value, tone }: { label: string; value: string; tone: 'red' | 'pink' | 'green' }) {
  const color = tone === 'red' ? 'text-red-400' : tone === 'pink' ? 'text-pink-400' : 'text-emerald-400';
  return <div className="border border-white/10 bg-white/[0.025] p-3"><div className="text-[10px] uppercase tracking-[0.16em] text-slate-500 mb-2">{label}</div><div className={`text-xl font-mono font-semibold ${color}`}>{value}</div></div>;
}

function SourceBlock({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="border border-white/10 bg-[#070A0F] p-5">
      <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-3 text-base font-semibold text-white">{value}</div>
      <div className="mt-2 text-sm leading-6 text-slate-500">{detail}</div>
    </div>
  );
}

function TerminalPreview() {
  return (
    <div className="border border-white/10 bg-[#090D13] shadow-2xl shadow-black/30">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 bg-emerald-400" />
          <span className="text-xs uppercase tracking-[0.2em] text-slate-400">Live market view</span>
        </div>
        <span className="text-xs font-mono text-slate-500">btc-updown-5m</span>
      </div>
      <div className="p-4 md:p-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <PreviewStat label="Timer" value="01:48" tone="red" />
          <PreviewStat label="To beat" value="$62,081" tone="green" />
          <PreviewStat label="Current" value="$62,104" tone="green" />
          <PreviewStat label="Decision" value="UP" tone="green" />
        </div>

        <div className="mt-4 border border-white/10 bg-[#05080D]">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <span className="text-xs uppercase tracking-[0.18em] text-slate-500">Reference chart</span>
            <span className="text-xs text-pink-300">price-to-beat</span>
          </div>
          <div className="relative h-72 overflow-hidden">
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:42px_42px]" />
            <svg viewBox="0 0 680 280" className="absolute inset-0 h-full w-full">
              <line x1="0" y1="142" x2="680" y2="142" stroke="#f472b6" strokeDasharray="7 7" opacity="0.75" />
              <path className="landing-line" d="M0 178 C60 166 96 150 150 160 C218 172 244 108 300 120 C368 134 390 88 448 104 C502 118 536 80 588 72 C632 66 650 78 680 62" fill="none" stroke="#22d3ee" strokeWidth="2" />
              <path d="M0 218 C92 206 142 218 212 194 C292 166 360 178 436 142 C520 104 594 126 680 94 L680 280 L0 280 Z" fill="rgba(34,211,238,0.08)" />
            </svg>
          </div>
        </div>

        <div className="mt-4 grid md:grid-cols-2 gap-3">
          <div className="border border-blue-400/20 bg-blue-400/5 p-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-blue-300">UP</span>
              <span className="font-mono text-white">56.5c</span>
            </div>
            <div className="mt-2 text-xs text-slate-500">Bid 56.0c / Ask 57.0c</div>
          </div>
          <div className="border border-pink-400/20 bg-pink-400/5 p-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-pink-300">DOWN</span>
              <span className="font-mono text-white">43.5c</span>
            </div>
            <div className="mt-2 text-xs text-slate-500">Bid 43.0c / Ask 44.0c</div>
          </div>
        </div>
      </div>
    </div>
  );
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
