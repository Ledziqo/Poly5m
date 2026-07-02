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
    <div className="min-h-screen bg-[#0B0E14] text-white overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(34,211,238,0.16),transparent_28%),radial-gradient(circle_at_70%_30%,rgba(168,85,247,0.18),transparent_34%)]" />
      <div className="relative max-w-7xl mx-auto px-6 py-8">
        <header className="flex items-center justify-between">
          <img src="/polyengine-logo.png" alt="PolyEngine" className="h-14 w-auto object-contain" />
          <div className="flex items-center gap-3">
            <button onClick={() => onNav('/login')} className="rounded-full border border-white/10 px-5 py-2 text-sm text-slate-200 hover:border-cyan-400/40 transition">Login</button>
            <button onClick={() => onNav('/request-access')} className="rounded-full bg-cyan-300 px-5 py-2 text-sm font-bold text-slate-950 hover:bg-cyan-200 transition">Request access</button>
          </div>
        </header>

        <main className="grid lg:grid-cols-2 gap-12 items-center pt-20">
          <section>
            <div className="inline-flex rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-cyan-300 text-sm mb-6">
              BTC 5-minute Polymarket engine
            </div>
            <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight leading-[0.95]">
              Beat the next five minutes with machine discipline.
            </h1>
            <p className="mt-6 text-lg text-slate-300 leading-8 max-w-xl">
              PolyEngine watches BTC microstructure, odds, fees, spreads, volatility, and time pressure to choose Up, Down, or Wait before the 2-minute cutoff.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <button onClick={() => onNav('/request-access')} className="rounded-xl bg-cyan-300 px-6 py-3 font-bold text-slate-950 hover:bg-cyan-200 transition">Request access</button>
              <button onClick={() => onNav('/login')} className="rounded-xl border border-white/10 px-6 py-3 font-bold text-white hover:border-purple-400/40 transition">Login</button>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#131722]/80 backdrop-blur-xl p-6 shadow-2xl shadow-cyan-500/10">
            <div className="h-1 w-full rounded-full bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500 mb-6" />
            <div className="grid grid-cols-3 gap-4 mb-6">
              <PreviewStat label="Countdown" value="03:00" tone="red" />
              <PreviewStat label="Signal" value="DOWN" tone="pink" />
              <PreviewStat label="Edge" value="+4.1c" tone="green" />
            </div>
            <div className="h-52 rounded-xl border border-white/10 bg-[#0B0E14] relative overflow-hidden">
              <svg viewBox="0 0 600 220" className="absolute inset-0 h-full w-full">
                <path d="M0 150 C80 120 120 160 190 132 S310 70 380 100 S500 132 600 72" fill="none" stroke="#c084fc" strokeWidth="5" filter="url(#glow)" />
                <line x1="0" y1="118" x2="600" y2="118" stroke="#f472b6" strokeDasharray="8 8" opacity="0.7" />
                <defs><filter id="glow"><feGaussianBlur stdDeviation="5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
              </svg>
            </div>
            <div className="mt-6 rounded-xl border border-purple-500/20 bg-purple-500/5 p-4 text-sm text-slate-300">
              Entered DOWN at 30.5c with 2:41 left. Fee-adjusted fair value is 35.0c; momentum is fading and order flow confirms selling pressure.
            </div>
          </section>
        </main>
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
        <img src="/polyengine-logo.png" alt="PolyEngine" className="h-20 w-auto object-contain mb-10" />
        {children}
      </div>
    </div>
  );
}
