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
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-20 md:h-24 flex items-center justify-between gap-3 md:gap-4">
          <button onClick={() => onNav('/')} className="flex items-center" aria-label="PolyEngine home">
            <img src="/polyengine-icon-logo.png" alt="PolyEngine" className="h-[4.5rem] w-[4.5rem] md:h-24 md:w-24 object-cover" loading="eager" fetchPriority="high" />
          </button>
          <nav className="hidden md:flex items-center gap-7 text-sm text-slate-400">
            <a href="#data" className="hover:text-white transition">Data</a>
            <a href="#process" className="hover:text-white transition">Process</a>
            <a href="#audit" className="hover:text-white transition">Audit</a>
          </nav>
          <div className="flex items-center gap-2">
            <button onClick={() => onNav('/login')} className="h-10 px-3 md:px-4 border border-[#403653] bg-[#15111F] text-xs md:text-sm font-medium text-slate-200 hover:bg-[#211A31] transition">Login</button>
            <button onClick={() => onNav('/request-access')} className="h-10 px-3 md:px-4 bg-[#E7E0F8] text-xs md:text-sm font-semibold text-[#100A1A] hover:bg-white transition">Request access</button>
          </div>
        </div>
      </div>

      <main>
        <section className="relative overflow-hidden border-b border-[#403653]">
          <div className="absolute inset-0 opacity-[0.16] bg-[linear-gradient(90deg,#6D5A91_1px,transparent_1px),linear-gradient(#6D5A91_1px,transparent_1px)] bg-[size:54px_54px]" />
          <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[#3A2A5C]/25 to-transparent" />
          <div className="relative max-w-7xl mx-auto px-4 md:px-6 py-5 md:py-6 grid lg:grid-cols-[0.96fr_1.04fr] gap-5 lg:gap-7 items-center">
            <div>
              <div className="flex items-center gap-0">
                <img src="/polyengine-icon-logo.png" alt="PolyEngine" className="h-[7.5rem] w-[7.5rem] sm:h-36 sm:w-36 md:h-48 md:w-48 object-cover shrink-0 -ml-4 sm:-ml-7 md:-ml-10" loading="eager" fetchPriority="high" />
                <div className="min-w-0 -ml-7 sm:-ml-7 md:-ml-9">
                  <div className="text-[1.7rem] sm:text-4xl md:text-5xl font-semibold uppercase tracking-[0.1em] sm:tracking-[0.16em] md:tracking-[0.18em] text-white leading-none">PolyEngine</div>
                  <div className="mt-2 text-[11px] sm:text-sm md:text-base font-semibold uppercase tracking-[0.18em] md:tracking-[0.28em] text-[#CBB9FF]">BTC 5m terminal</div>
                </div>
              </div>
              <p className="hidden sm:block mt-2 md:mt-3 max-w-xl text-sm leading-6 text-[#B7AFC7]">
                Live Polymarket BTC Up/Down rounds, Chainlink reference price, CLOB odds, and simulated execution in a private cockpit.
              </p>
              <ProductPreview />
            </div>

            <div className="lg:pl-4">
              <div className="inline-flex w-fit border border-[#6F5A99] bg-[#1B1428] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#CBB9FF]">
                Private Polymarket execution lab
              </div>
              <h1 className="mt-4 text-[2rem] sm:text-4xl md:text-[2.85rem] font-semibold leading-[1.04] tracking-tight text-white">
                A sharper command center for Bitcoin's 5-minute knife edge.
              </h1>
              <p className="mt-4 max-w-2xl text-sm md:text-base leading-7 text-[#B7AFC7]">
                PolyEngine tracks the live Polymarket BTC Up/Down round with market-synced timing, price-to-beat, CLOB odds, entry discipline, and a decision audit designed for one market only.
              </p>
              <div className="mt-5 flex flex-wrap gap-3 text-[11px] md:text-xs uppercase tracking-[0.16em] md:tracking-[0.18em] text-[#8F7DB5]">
                <span className="border-l border-[#6F5A99] pl-3">1:1 market source</span>
                <span className="border-l border-[#6F5A99] pl-3">live CLOB odds</span>
                <span className="border-l border-[#6F5A99] pl-3">RTDS BTC feed</span>
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <button onClick={() => onNav('/login')} className="h-11 md:h-12 px-5 bg-[#CBB9FF] text-sm font-bold text-[#100A1A] hover:bg-[#E7E0F8] transition shadow-[0_0_28px_rgba(143,125,181,0.18)]">Open terminal</button>
                <button onClick={() => onNav('/request-access')} className="h-11 md:h-12 px-5 border border-[#4C3C68] bg-[#15111F] text-sm font-semibold text-white hover:bg-[#211A31] transition">Request access</button>
              </div>
              <p className="mt-5 max-w-xl text-sm leading-6 text-slate-500">
                Private product for approved users only. New access is handled manually through Telegram while the engine stays in controlled validation.
              </p>
            </div>
          </div>
        </section>

        <section className="border-b border-[#403653] bg-[#09080D]">
          <div className="max-w-7xl mx-auto px-5 md:px-6 py-8 flex flex-col md:flex-row md:items-center md:justify-between gap-5">
            <div>
              <div className="text-xs uppercase tracking-[0.22em] text-[#BBA6F1]">Private access only</div>
              <p className="mt-2 max-w-3xl text-lg leading-8 text-slate-300">
                PolyEngine is not public yet. Request access in Telegram and we will approve accounts manually while the BTC 5m terminal is being refined.
              </p>
            </div>
            <a href="https://t.me/Aesliex" target="_blank" rel="noopener noreferrer" className="h-12 shrink-0 px-5 inline-flex items-center justify-center bg-[#CBB9FF] text-sm font-bold text-[#100A1A] hover:bg-white transition">
              Request on Telegram
            </a>
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
  return <div className="border border-[#403653] bg-[#0D0B12] p-2.5 md:p-3"><div className="text-[9px] md:text-[10px] uppercase tracking-[0.16em] text-[#8F7DB5] mb-1.5 md:mb-2">{label}</div><div className={`text-lg md:text-xl font-mono font-semibold ${color}`}>{value}</div></div>;
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

function ProductPreview() {
  return (
    <div className="mt-4 border border-[#403653] bg-[#08070C]/95 shadow-2xl shadow-black/35 overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-[#403653] px-3 md:px-4 py-2.5 md:py-3">
        <span className="text-[9px] md:text-[10px] uppercase tracking-[0.18em] md:tracking-[0.22em] text-[#8F7DB5]">BTC 5m execution terminal</span>
        <span className="font-mono text-xs text-emerald-300">LIVE MARKET</span>
      </div>
      <div className="grid md:grid-cols-[1.2fr_0.8fr] gap-0">
          <div className="border-b border-[#403653] md:border-b-0 md:border-r overflow-hidden">
            <div className="relative h-36 md:h-40 border-b border-[#403653] overflow-hidden">
              <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(203,185,255,0.07)_1px,transparent_1px),linear-gradient(rgba(203,185,255,0.07)_1px,transparent_1px)] bg-[size:36px_36px]" />
            <div className="absolute left-3 md:left-4 top-3 md:top-4 border border-[#403653] bg-[#0D0B12]/90 px-2 md:px-3 py-1.5 md:py-2">
              <div className="text-[8px] md:text-[9px] uppercase tracking-[0.16em] md:tracking-[0.18em] text-[#8F7DB5]">Reference</div>
              <div className="font-mono text-xs md:text-sm text-white">$62,104.26</div>
            </div>
            <div className="absolute right-3 md:right-4 top-3 md:top-4 border border-[#403653] bg-[#0D0B12]/90 px-2 md:px-3 py-1.5 md:py-2 text-right">
              <div className="text-[8px] md:text-[9px] uppercase tracking-[0.16em] md:tracking-[0.18em] text-[#8F7DB5]">To beat</div>
              <div className="font-mono text-xs md:text-sm text-[#CBB9FF]">$62,083.10</div>
            </div>
            <svg viewBox="0 0 520 180" className="absolute inset-x-0 bottom-0 h-[78%] w-full">
              <line x1="0" y1="106" x2="520" y2="106" stroke="#CBB9FF" strokeDasharray="7 7" opacity="0.72" />
              <line x1="386" y1="0" x2="386" y2="180" stroke="#E879F9" strokeDasharray="5 8" opacity="0.44" />
              <path className="landing-line" d="M0 132 C40 116 74 126 112 102 C160 74 198 110 238 88 C286 58 328 80 370 58 C420 32 470 60 520 36" fill="none" stroke="#A48BE8" strokeWidth="2.5" />
              <path d="M0 166 C70 154 128 160 190 132 C260 102 330 112 404 76 C458 52 492 66 520 48 L520 180 L0 180 Z" fill="rgba(111,90,153,0.18)" />
            </svg>
          </div>
          <div className="bg-[#08070C]/95 p-2.5 md:p-3">
            <div className="grid grid-cols-3 gap-2">
              <PreviewPill label="Round" value="07:45 AM" />
              <PreviewPill label="Cutoff" value="02:00" />
              <PreviewPill label="Bias" value="UP 63%" />
            </div>
            <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
              <div className="border border-[#403653] bg-[#0D0B12] px-2 py-1.5 font-mono text-[10px] md:text-[11px]">
                <div className="flex justify-between gap-3"><span className="text-slate-500">07:42:14</span><span className="text-emerald-300">edge passed</span></div>
                <div className="hidden sm:flex mt-1 justify-between gap-3"><span className="text-slate-500">07:42:18</span><span className="text-[#CBB9FF]">book checked</span></div>
              </div>
              <div className="border border-[#403653] bg-[#1B1428] px-3 py-1.5 text-right">
                <div className="text-[8px] uppercase tracking-[0.16em] text-[#8F7DB5]">stake</div>
                <div className="mt-1 font-mono text-xs text-white">$50</div>
              </div>
            </div>
            <div className="mt-2 border border-[#403653] bg-[#08070C] p-2.5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-[8px] uppercase tracking-[0.18em] text-[#8F7DB5]">brain stack</span>
                <span className="font-mono text-[10px] text-emerald-300">confidence 71%</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <PreviewMicro label="regime" value="trend" tone="green" />
                <PreviewMicro label="memory" value="2-0" tone="pink" />
                <PreviewMicro label="window" value="armed" tone="white" />
              </div>
              <div className="mt-2 h-1.5 border border-[#403653] bg-[#0D0B12]">
                <div className="h-full w-[71%] bg-[#CBB9FF]" />
              </div>
            </div>
          </div>
        </div>
        <div className="p-3 md:p-4">
          <div className="grid grid-cols-2 gap-3">
            <PreviewStat label="Timer" value="01:48" tone="red" />
            <PreviewStat label="Edge" value="+3.8c" tone="green" />
          </div>
          <div className="mt-3 border border-[#403653] bg-[#1B1428] p-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[#CBB9FF]">UP</span>
              <span className="font-mono text-white">56.5c</span>
            </div>
            <div className="mt-2 text-xs text-slate-500">Bid 56.0c / Ask 57.0c</div>
          </div>
          <div className="mt-3 hidden sm:block border border-[#403653] bg-[#0D0B12] p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">DOWN</span>
              <span className="font-mono text-slate-200">43.5c</span>
            </div>
            <div className="mt-2 text-xs text-slate-500">Bid 43.0c / Ask 44.0c</div>
          </div>
          <div className="mt-3 hidden sm:block space-y-2 font-mono text-[11px] leading-5">
            <div className="flex justify-between border-t border-[#403653] pt-2"><span className="text-slate-500">signal</span><span className="text-emerald-300">entry allowed</span></div>
            <div className="flex justify-between border-t border-[#403653] pt-2"><span className="text-slate-500">fee drag</span><span className="text-slate-300">0.36</span></div>
            <div className="flex justify-between border-t border-[#403653] pt-2"><span className="text-slate-500">source</span><span className="text-[#CBB9FF]">Polymarket</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-[#403653] bg-[#08070C]/85 px-2 py-1.5 md:py-2">
      <div className="text-[7px] md:text-[8px] uppercase tracking-[0.16em] md:tracking-[0.18em] text-[#8F7DB5]">{label}</div>
      <div className="mt-1 truncate font-mono text-[11px] md:text-xs text-white">{value}</div>
    </div>
  );
}

function PreviewMicro({ label, value, tone }: { label: string; value: string; tone: 'green' | 'pink' | 'white' }) {
  const color = tone === 'green' ? 'text-emerald-300' : tone === 'pink' ? 'text-[#CBB9FF]' : 'text-white';
  return (
    <div className="border border-[#403653] bg-[#0D0B12] px-2 py-1.5">
      <div className="text-[7px] uppercase tracking-[0.14em] text-[#8F7DB5]">{label}</div>
      <div className={`mt-1 font-mono text-[10px] ${color}`}>{value}</div>
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
