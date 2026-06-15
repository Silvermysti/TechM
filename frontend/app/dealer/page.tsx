"use client";

import { Shell } from "@/components/Shell";
import { useAuth } from "@/lib/auth";

const PLANNED = [
  { code: "D-01", title: "Service schedule", desc: "Today's bookings and bay allocation." },
  { code: "D-02", title: "Parts status", desc: "Stock, ETAs, and open supply orders." },
  { code: "D-03", title: "Open jobs", desc: "Work in progress with warranty flags." },
  { code: "D-04", title: "AI assist", desc: "Diagnosis suggestions for service advisors." },
];

export default function DealerPortal() {
  const { session, ready } = useAuth(["manager"]);

  if (!ready || !session) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-faint">
        Loading…
      </main>
    );
  }

  return (
    <Shell title="Dealer Portal" session={session}>
      <div className="rise">
        <div className="flex items-center gap-3">
          <p className="eyebrow">Phase 3</p>
          <span className="chip">planned</span>
        </div>
        <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink">
          Dealer Portal
        </h2>
        <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">
          Tools for service advisors, built on the same agent pipeline. The modules below
          are scoped and waiting on Phase 3.
        </p>
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {PLANNED.map((m) => (
            <div key={m.code} className="card border-dashed p-5 opacity-70">
              <p className="font-mono text-[10px] tracking-[0.18em] text-faint">{m.code}</p>
              <p className="mt-2.5 font-semibold text-muted">{m.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-faint">{m.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}
