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
    <div className="min-h-screen bg-[#07070A] text-slate-100">
      <div className="border-b border-[#403653] bg-[#08070C]/95">
        <div className="max-w-7xl mx-auto px-5 md:px-6 h-20 flex items-center justify-between gap-4">
          <button onClick={() => onNav('/')} className="flex items-center" aria-label="PolyEngine home">
            <img src="/polyengine-icon-logo.png" alt="PolyEngine" className="h-14 w-14 object-cover" loading="eager" fetchPriority="high" />
          </button>
          <nav className="hidden md:flex items-center gap-7 text-sm text-slate-400">
            <a href="#data" className="hover:text-white transition">Data</a>
            <a href="#process" className="hover:text-white transition">Process</a>
            <a href="#audit" className="hover:text-white transition">Audit</a>
          </nav>
          <div className="flex items-center gap-2">
            <button onClick={() => onNav('/login')} className="h-10 px-4 border border-[#403653] bg-[#15111F] text-sm font-medium text-slate-200 hover:bg-[#211A31] transition">Login</button>
            <button onClick={() => onNav('/request-access')} className="h-10 px-4 bg-[#E7E0F8] text-sm font-semibold text-[#100A1A] hover:bg-white transition">Request access</button>
          </div>
        </div>
      </div>

      <main>
        <section className="relative overflow-hidden border-b border-[#403653]">
          <div className="absolute inset-0 opacity-[0.16] bg-[linear-gradient(90deg,#6D5A91_1px,transparent_1px),linear-gradient(#6D5A91_1px,transparent_1px)] bg-[size:54px_54px]" />
          <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[#3A2A5C]/25 to-transparent" />
          <div className="relative max-w-7xl mx-auto px-5 md:px-6 py-12 md:py-16 grid lg:grid-cols-[0.9fr_1.1fr] gap-10 items-stretch">
            <div className="border border-[#4C3C68] bg-[#0B0910]/90 p-6 md:p-8 flex flex-col justify-between min-h-[520px] shadow-2xl shadow-black/40">
              <div>
                <img src="/polyengine-icon-logo.png" alt="PolyEngine" className="h-40 w-40 md:h-56 md:w-56 object-cover" loading="eager" fetchPriority="high" />
                <div className="mt-8">
                  <div className="text-4xl md:text-6xl font-semibold uppercase tracking-[0.18em] text-white">PolyEngine</div>
                  <div className="mt-4 inline-flex border border-[#6F5A99] bg-[#1B1428] px-4 py-2 text-xs md:text-sm font-semibold uppercase tracking-[0.24em] text-[#CBB9FF]">
                    BTC 5m terminal
                  </div>
                </div>
              </div>
              <div className="mt-10 border-t border-[#403653] pt-5">
                <div className="text-[10px] uppercase tracking-[0.24em] text-[#8F7DB5]">Built for one market</div>
                <div className="mt-2 max-w-md text-sm md:text-base leading-7 text-slate-300">
                  Live Polymarket BTC Up/Down rounds, Chainlink reference price, CLOB odds, and simulated execution in a private cockpit.
                </div>
              </div>
            </div>

            <div>
              <div className="h-full border border-[#403653] bg-[#0D0B12]/90 p-6 md:p-8 flex flex-col justify-center">
                <div className="inline-flex w-fit border border-[#6F5A99] bg-[#1B1428] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#CBB9FF]">
                  Private Polymarket execution lab
                </div>
                <h1 className="mt-6 text-4xl md:text-6xl font-semibold leading-[1.01] tracking-tight text-white">
                  A sharper command center for Bitcoin's 5-minute knife edge.
                </h1>
                <p className="mt-6 max-w-2xl text-base md:text-lg leading-8 text-[#B7AFC7]">
                  PolyEngine tracks the live Polymarket BTC Up/Down round with Chainlink reference price, CLOB odds, entry discipline, and a decision audit designed for one market only.
                </p>
                <div className="mt-8 grid grid-cols-3 border border-[#443757] divide-x divide-[#443757] max-w-2xl bg-[#08070C]">
                  <LandingMetric value="1:1" label="market source" />
                  <LandingMetric value="CLOB" label="live odds" />
                  <LandingMetric value="RTDS" label="btc feed" />
                </div>
                <div className="mt-8 grid md:grid-cols-2 gap-3 max-w-2xl">
                  <SourceBlock label="Round clock" value="Market synced" detail="Timer follows the active BTC 5m event window." />
                  <SourceBlock label="Execution model" value="Fee-aware" detail="Entries use bid/ask, fee drag, and edge checks." />
                </div>
                <div className="mt-8 flex flex-wrap gap-3">
                  <button onClick={() => onNav('/login')} className="h-12 px-5 bg-[#CBB9FF] text-sm font-bold text-[#100A1A] hover:bg-[#E7E0F8] transition shadow-[0_0_28px_rgba(143,125,181,0.18)]">Open terminal</button>
                  <button onClick={() => onNav('/request-access')} className="h-12 px-5 border border-[#4C3C68] bg-[#15111F] text-sm font-semibold text-white hover:bg-[#211A31] transition">Request access</button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="data" className="border-b border-[#403653] bg-[#0D0B12]">
          <div className="max-w-7xl mx-auto px-5 md:px-6 py-12 grid lg:grid-cols-[0.72fr_1.28fr] gap-8">
            <div>
              <div className="text-xs uppercase tracking-[0.22em] text-[#BBA6F1]">Data contract</div>
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
              <div className="text-xs uppercase tracking-[0.22em] text-[#8F7DB5]">Operating model</div>
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

        <section id="audit" className="border-t border-[#403653] bg-[#0D0B12]">
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
  return <div className="p-4"><div className="text-xl md:text-2xl font-mono font-semibold text-white">{value}</div><div className="text-[10px] uppercase tracking-[0.18em] text-[#8F7DB5] mt-1">{label}</div></div>;
}

function FeatureCard({ title, text }: { title: string; text: string }) {
  return <div className="border border-[#403653] bg-[#100D18] p-5 relative overflow-hidden"><div className="absolute right-0 top-0 h-full w-1 bg-[#6F5A99]" /><h3 className="font-semibold text-white text-lg mb-3">{title}</h3><p className="text-sm text-slate-400 leading-6">{text}</p></div>;
}

function FeaturePanel({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="border border-[#403653] bg-[#08070C] p-5">
      <h3 className="text-xl font-semibold text-white mb-5">{title}</h3>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item} className="flex gap-3 border-t border-[#403653] pt-3 text-sm text-slate-300 first:border-t-0 first:pt-0">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 bg-[#CBB9FF]" />
            <span className="leading-6">{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PreviewStat({ label, value, tone }: { label: string; value: string; tone: 'red' | 'pink' | 'green' }) {
  const color = tone === 'red' ? 'text-red-300' : tone === 'pink' ? 'text-[#CBB9FF]' : 'text-emerald-300';
  return <div className="border border-[#403653] bg-[#0D0B12] p-3"><div className="text-[10px] uppercase tracking-[0.16em] text-[#8F7DB5] mb-2">{label}</div><div className={`text-xl font-mono font-semibold ${color}`}>{value}</div></div>;
}

function SourceBlock({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="border border-[#403653] bg-[#08070C] p-5">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[#8F7DB5]">{label}</div>
      <div className="mt-3 text-base font-semibold text-white">{value}</div>
      <div className="mt-2 text-sm leading-6 text-slate-500">{detail}</div>
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
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" className="w-full mb-5 border border-[#403653] bg-[#08070C] px-4 py-3 text-white outline-none focus:border-[#CBB9FF]" />
      <label className="block text-sm text-slate-300 mb-2">Password</label>
      <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" className="w-full mb-6 border border-[#403653] bg-[#08070C] px-4 py-3 text-white outline-none focus:border-[#CBB9FF]" />
      <button onClick={() => onLogin(email, password)} className="w-full bg-[#CBB9FF] py-3 font-bold text-[#100A1A] hover:bg-[#E7E0F8] transition">Enter terminal</button>
      <button onClick={() => onNav('/request-access')} className="mt-5 text-sm text-[#CBB9FF] hover:text-white">Request access through Telegram</button>
    </AuthShell>
  );
}

function RequestAccess({ onNav }: { onNav: (path: string) => void }) {
  return (
    <AuthShell>
      <h1 className="text-3xl font-bold text-white mb-2">Request access</h1>
      <p className="text-slate-400 mb-8">PolyEngine is private while the BTC 5m engine is being validated.</p>
      <a href="https://t.me/Aesliex" target="_blank" rel="noopener noreferrer" className="block w-full bg-[#CBB9FF] py-3 text-center font-bold text-[#100A1A] hover:bg-[#E7E0F8] transition">Message @Aesliex</a>
      <button onClick={() => onNav('/login')} className="mt-5 text-sm text-[#CBB9FF] hover:text-white">Back to login</button>
    </AuthShell>
  );
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#07070A] bg-[linear-gradient(90deg,rgba(203,185,255,0.06)_1px,transparent_1px),linear-gradient(rgba(203,185,255,0.06)_1px,transparent_1px)] bg-[size:54px_54px] flex items-center justify-center p-6">
      <div className="w-full max-w-xl border border-[#403653] bg-[#0D0B12]/95 p-8 shadow-2xl shadow-black/40">
        <div className="mb-10 flex items-center gap-4">
          <img src="/polyengine-icon-logo.png" alt="PolyEngine" className="h-24 w-24 object-cover border border-[#4A3A6A]" loading="eager" fetchPriority="high" />
          <div>
            <div className="text-xl font-semibold uppercase tracking-[0.22em] text-white">PolyEngine</div>
            <div className="mt-1 text-xs uppercase tracking-[0.24em] text-[#8F7DB5]">Private BTC 5m terminal</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
