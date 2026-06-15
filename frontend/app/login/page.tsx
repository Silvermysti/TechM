"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/lib/api";
import { setSession } from "@/lib/auth";
import { ThemeToggle } from "@/components/ThemeToggle";

const QUICK = [
  {
    label: "Customer",
    email: "rajesh.demo@example.com",
    role: "Swift VXI · warranty valid",
  },
  {
    label: "Manager",
    email: "manager@techmahindra.com",
    role: "Operations staff",
  },
];

const PANEL_FACTS = [
  ["APQC 6.7", "Process warranty claims"],
  ["HITL", "Human approval on every decision"],
  ["AUDIT", "Every action logged and attributed"],
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (value?: string) => {
    const addr = (value ?? email).trim();
    if (!addr || busy) return;
    setBusy(true);
    setError(null);
    try {
      const session = await login(addr);
      setSession(session);
      router.replace(session.role === "manager" ? "/" : "/customer");
    } catch {
      setError("We couldn't find an account for that email. Try a demo account below.");
      setBusy(false);
    }
  };

  return (
    <main className="relative flex min-h-screen">
      {/* ---- Brand panel ---- */}
      <section className="brand-panel relative hidden w-[42%] flex-col justify-between overflow-hidden p-10 text-white lg:flex xl:p-14">
        <div className="brand-grid absolute inset-0" aria-hidden />
        {/* oversized ghost glyph */}
        <span
          className="pointer-events-none absolute -bottom-24 -right-16 font-display text-[22rem] font-bold leading-none text-white/[0.07]"
          aria-hidden
        >
          M
        </span>

        <div className="relative mark text-[0.72rem]">
          <span className="mark-glyph !bg-white" />
          Tech&nbsp;Mahindra
        </div>

        <div className="relative">
          <p className="font-mono text-[0.68rem] uppercase tracking-[0.24em] text-white/70">
            Automotive After-Sales · Plan B
          </p>
          <h1 className="mt-4 font-display text-[3.4rem] font-bold leading-[0.98] tracking-tight">
            AI Command
            <br />
            Center
          </h1>
          <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-white/80">
            An agent pipeline that reads warranty claims, checks coverage, screens
            fraud, and costs the repair — with a person on every final call.
          </p>
        </div>

        <div className="relative space-y-2.5">
          {PANEL_FACTS.map(([code, text]) => (
            <div key={code} className="flex items-baseline gap-4 text-sm">
              <span className="w-16 flex-none font-mono text-[0.65rem] tracking-[0.18em] text-white/60">
                {code}
              </span>
              <span className="text-white/85">{text}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Sign-in ---- */}
      <section className="relative flex flex-1 items-center justify-center px-6 py-12">
        <div className="absolute right-6 top-6">
          <ThemeToggle />
        </div>

        <div className="w-full max-w-sm rise">
          <div className="mark text-[0.7rem] text-ink lg:hidden">
            <span className="mark-glyph" />
            Tech&nbsp;Mahindra
          </div>

          <p className="eyebrow mt-8 lg:mt-0">Sign in</p>
          <h2 className="mt-2 text-[1.9rem] font-bold leading-tight tracking-tight text-ink">
            Welcome back
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Every action is logged and attributed to your identity.
          </p>

          <div className="card mt-7 p-6">
            <label className="eyebrow">Email address</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="you@example.com"
              autoFocus
              className="field mt-2 w-full px-4 py-2.5 text-sm"
            />
            {error && <p className="mt-3 text-xs text-techm">{error}</p>}
            <button
              onClick={() => submit()}
              disabled={busy}
              className="mt-4 w-full rounded-xl bg-techm px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-techm-deep disabled:opacity-50"
            >
              {busy ? "Signing in…" : "Continue →"}
            </button>
          </div>

          <p className="eyebrow mt-7 text-center">Demo accounts</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {QUICK.map((q) => (
              <button
                key={q.email}
                onClick={() => submit(q.email)}
                disabled={busy}
                className="card group p-3 text-left transition hover:border-techm disabled:opacity-50"
              >
                <p className="text-sm font-semibold text-ink">{q.label}</p>
                <p className="mt-0.5 text-[11px] text-muted">{q.role}</p>
                <p className="mt-1.5 truncate font-mono text-[10px] text-faint">
                  {q.email}
                </p>
              </button>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
