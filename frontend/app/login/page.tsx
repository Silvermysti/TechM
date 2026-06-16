"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login, register } from "@/lib/api";
import { setSession } from "@/lib/auth";
import { ThemeToggle } from "@/components/ThemeToggle";

const QUICK = [
  {
    label: "Customer",
    email: "rajesh.demo@example.com",
    password: "demo1234",
    tag: "Swift VXI · warranty valid",
    role: "customer" as const,
    initial: "R",
  },
  {
    label: "Manager",
    email: "manager@techmahindra.com",
    password: "manager123",
    tag: "Operations — full access",
    role: "manager" as const,
    initial: "M",
  },
];

const FACTS = [
  { code: "APQC 6.7", text: "Full warranty claim lifecycle" },
  { code: "HITL",     text: "Human approval on every decision" },
  { code: "AUDIT",    text: "Every action attributed and logged" },
  { code: "SSE",      text: "Live agent trace and updates" },
];

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");

  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");

  const [regName,     setRegName]     = useState("");
  const [regEmail,    setRegEmail]    = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regPhone,    setRegPhone]    = useState("");

  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitLogin = async (quick?: { email: string; password: string; role: "customer" | "manager" }) => {
    const addr = (quick?.email ?? email).trim();
    const pass = quick?.password ?? password;
    if (!addr || !pass || busy) return;
    setBusy(true);
    setError(null);
    try {
      const session = await login(addr, pass);
      setSession(session);
      router.replace(session.role === "manager" ? "/" : "/customer");
    } catch {
      setError("Invalid email or password.");
      setBusy(false);
    }
  };

  const submitRegister = async () => {
    if (!regName.trim() || !regEmail.trim() || !regPassword || busy) return;
    setBusy(true);
    setError(null);
    try {
      const session = await register(regName.trim(), regEmail.trim(), regPassword, regPhone.trim());
      setSession(session);
      router.replace("/customer");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      setError(
        msg.includes("409")
          ? "An account with that email already exists."
          : "Registration failed. Please try again.",
      );
      setBusy(false);
    }
  };

  return (
    <main className="relative flex min-h-screen">

      {/* ── Brand panel ── */}
      <section className="brand-panel relative hidden w-[44%] flex-col justify-between overflow-hidden p-10 text-white lg:flex xl:p-14">
        <div className="brand-grid absolute inset-0" aria-hidden />

        {/* large faint M watermark */}
        <span
          className="pointer-events-none absolute -bottom-16 -right-12 font-display text-[18rem] font-bold leading-none text-white/[0.06]"
          aria-hidden
        >
          M
        </span>

        {/* logo */}
        <div className="relative mark text-[0.72rem]">
          <span className="mark-glyph !bg-white" />
          Tech&nbsp;Mahindra
        </div>

        {/* hero text */}
        <div className="relative">
          <p className="font-mono text-[0.67rem] uppercase tracking-[0.26em] text-white/65">
            Automotive After-Sales · Plan B
          </p>
          <h1 className="mt-4 font-display text-[3.2rem] font-bold leading-[0.97] tracking-tight">
            AI Command
            <br />
            Center
          </h1>
          <p className="mt-5 max-w-sm text-[14px] leading-relaxed text-white/80">
            A 3-tier agent pipeline that reads warranty claims, validates coverage,
            screens fraud, estimates cost — and holds for your decision.
          </p>

          {/* pipeline chips */}
          <div className="mt-7 flex flex-wrap gap-2">
            {["Intake", "Validate", "Fraud", "Cost", "HITL"].map((s) => (
              <span key={s} className="rounded-lg border border-white/20 bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/85">
                {s}
              </span>
            ))}
          </div>
        </div>

        {/* facts */}
        <div className="relative space-y-3">
          {FACTS.map(({ code, text }) => (
            <div key={code} className="flex items-center gap-4 text-sm">
              <span className="w-16 flex-none font-mono text-[0.63rem] tracking-[0.2em] text-white/55">
                {code}
              </span>
              <span className="text-white/80">{text}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Auth panel ── */}
      <section className="relative flex flex-1 items-center justify-center px-6 py-14">
        <div className="absolute right-5 top-5">
          <ThemeToggle />
        </div>

        <div className="w-full max-w-[360px] animate-fade-up">
          {/* mobile mark */}
          <div className="mark mb-7 text-[0.7rem] text-ink lg:hidden">
            <span className="mark-glyph" />
            Tech&nbsp;Mahindra
          </div>

          {/* mode toggle */}
          <div className="flex rounded-xl border border-line bg-raised p-1">
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(null); }}
                className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
                  mode === m
                    ? "bg-surface shadow-sm text-ink"
                    : "text-faint hover:text-muted"
                }`}
                style={mode === m ? { boxShadow: "0 1px 3px rgba(0,0,0,0.15)" } : {}}
              >
                {m === "login" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          {mode === "login" ? (
            <>
              <h2 className="mt-6 font-display text-[1.85rem] font-bold leading-tight tracking-tight text-ink">
                Welcome back
              </h2>
              <p className="mt-1 text-sm text-muted">Sign in to your account to continue.</p>

              <div
                className="mt-5 rounded-2xl border border-line bg-surface p-5 space-y-3"
                style={{ boxShadow: "var(--shadow)" }}
              >
                <div>
                  <label className="eyebrow">Email address</label>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoFocus
                    type="email"
                    className="field mt-2 w-full px-4 py-2.5 text-sm"
                  />
                </div>
                <div>
                  <label className="eyebrow">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submitLogin()}
                    placeholder="••••••••"
                    className="field mt-2 w-full px-4 py-2.5 text-sm"
                  />
                </div>
                {error && (
                  <p className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    {error}
                  </p>
                )}
                <button
                  onClick={() => submitLogin()}
                  disabled={busy}
                  className="mt-1 w-full rounded-xl bg-techm px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-techm-deep disabled:opacity-50"
                >
                  {busy ? "Signing in…" : "Continue →"}
                </button>
              </div>

              {/* demo accounts */}
              <div>
                <div className="divider-label my-5">Demo accounts</div>
                <div className="grid grid-cols-2 gap-2.5">
                  {QUICK.map((q) => (
                    <button
                      key={q.email}
                      onClick={() => submitLogin(q)}
                      disabled={busy}
                      className="group rounded-xl border border-line bg-surface px-4 py-3 text-left transition hover:border-techm/50 disabled:opacity-50"
                      style={{ boxShadow: "var(--shadow)" }}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-techm font-display text-[11px] font-bold text-white">
                          {q.initial}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-ink">{q.label}</p>
                        </div>
                      </div>
                      <p className="mt-2 text-[11px] text-muted">{q.tag}</p>
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <h2 className="mt-6 font-display text-[1.85rem] font-bold leading-tight tracking-tight text-ink">
                Create account
              </h2>
              <p className="mt-1 text-sm text-muted">Register to file warranty claims and manage your vehicles.</p>

              <div
                className="mt-5 rounded-2xl border border-line bg-surface p-5 space-y-3"
                style={{ boxShadow: "var(--shadow)" }}
              >
                <div>
                  <label className="eyebrow">Full name</label>
                  <input
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    placeholder="Rajesh Sharma"
                    autoFocus
                    className="field mt-2 w-full px-4 py-2.5 text-sm"
                  />
                </div>
                <div>
                  <label className="eyebrow">Email address</label>
                  <input
                    type="email"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="field mt-2 w-full px-4 py-2.5 text-sm"
                  />
                </div>
                <div>
                  <label className="eyebrow">Password</label>
                  <input
                    type="password"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="Min. 8 characters"
                    className="field mt-2 w-full px-4 py-2.5 text-sm"
                  />
                </div>
                <div>
                  <label className="eyebrow">
                    Phone{" "}
                    <span className="font-normal normal-case tracking-normal text-faint">— optional</span>
                  </label>
                  <input
                    value={regPhone}
                    onChange={(e) => setRegPhone(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submitRegister()}
                    placeholder="+91 98…"
                    className="field mt-2 w-full px-4 py-2.5 text-sm"
                  />
                </div>
                {error && (
                  <p className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    {error}
                  </p>
                )}
                <button
                  onClick={submitRegister}
                  disabled={busy}
                  className="mt-1 w-full rounded-xl bg-techm px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-techm-deep disabled:opacity-50"
                >
                  {busy ? "Creating account…" : "Create account →"}
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
