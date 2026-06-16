"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import { listTickets } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Ticket } from "@/lib/types";

function relTime(ts: string | undefined): string {
  if (!ts) return "";
  const diff = Date.now() - new Date(ts).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const DOMAIN_CLASS: Record<string, string> = {
  warranty: "badge-warranty",
  recall:   "badge-recall",
  parts:    "badge-parts",
  quality:  "badge-quality",
  customer: "badge-customer",
  service:  "badge-service",
};

const STATUS_DOT: Record<string, string> = {
  resolved:          "dot-ok",
  rejected:          "dot-danger",
  escalated:         "dot-warn",
  awaiting_approval: "dot-info",
  under_review:      "dot-muted",
  processing:        "dot-muted",
  failed:            "dot-danger",
};

const STATUS_TEXT: Record<string, string> = {
  resolved:          "text-ok",
  rejected:          "text-danger",
  escalated:         "text-warn",
  awaiting_approval: "text-info",
  under_review:      "text-muted",
  processing:        "text-muted",
  failed:            "text-danger",
};

const PORTALS = [
  {
    href: "/manager",
    code: "01",
    title: "Command Center",
    desc: "Review AI recommendations and approve warranty decisions.",
    tag: "Operations",
    accent: "from-techm",
    ready: true,
  },
  {
    href: "/dealer",
    code: "02",
    title: "Dealer Portal",
    desc: "Service schedule, parts inventory, open jobs by VIN.",
    tag: "Service advisors",
    accent: "from-info",
    ready: true,
  },
  {
    href: "/admin",
    code: "03",
    title: "Admin Console",
    desc: "Recall management, agent rules, searchable audit log.",
    tag: "IT / config",
    accent: "from-process",
    ready: true,
  },
];

const PIPELINE = [
  { label: "Intake",        code: "6.7.3",   color: "text-faint" },
  { label: "Coverage",      code: "6.7.3.3",  color: "text-info" },
  { label: "Fraud Screen",  code: "6.7.5.5",  color: "text-warn" },
  { label: "Cost Estimate", code: "6.7.3.5",  color: "text-ok" },
  { label: "Human Approval", code: "HITL",    color: "text-techm" },
];

export default function Home() {
  const { session, ready } = useAuth(["manager"]);
  const [tickets, setTickets] = useState<Ticket[]>([]);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const t = await listTickets();
        if (active) setTickets(t);
      } catch { /* ignore */ }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => { active = false; clearInterval(id); };
  }, []);

  if (!ready || !session) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-faint">
          <span className="dot dot-live" />
          Connecting…
        </div>
      </main>
    );
  }

  const queue   = tickets.filter((t) => t.status === "awaiting_approval");
  const resolved = tickets.filter((t) => ["resolved", "rejected"].includes(t.status));
  const live     = tickets.filter((t) => ["processing", "under_review"].includes(t.status));

  return (
    <Shell title="Overview" session={session}>
      <div className="rise space-y-6">

        {/* ── Welcome bar ── */}
        <div className="relative overflow-hidden rounded-2xl border border-line bg-surface px-6 py-5" style={{ boxShadow: "var(--shadow)" }}>
          <span className="absolute inset-y-0 left-0 w-1 rounded-l-2xl bg-techm" />
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="eyebrow">Automotive After-Sales · Plan B</p>
              <h1 className="mt-1.5 font-display text-2xl font-bold tracking-tight text-ink">
                Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"},{" "}
                {session.name.split(" ")[0]}.
              </h1>
              <p className="mt-1 text-sm text-muted">
                {queue.length > 0
                  ? `${queue.length} ticket${queue.length > 1 ? "s" : ""} awaiting your approval.`
                  : live.length > 0
                  ? `${live.length} ticket${live.length > 1 ? "s" : ""} processing through the pipeline.`
                  : "All clear — the queue is empty."}
              </p>
            </div>
            {queue.length > 0 && (
              <Link
                href="/manager"
                className="inline-flex items-center gap-2 rounded-xl bg-techm px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-techm-deep"
              >
                <span className="dot dot-live" style={{ background: "rgba(255,255,255,0.8)" }} />
                {queue.length} awaiting approval
                <span>→</span>
              </Link>
            )}
          </div>
        </div>

        {/* ── Stats row ── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Total Tickets",    value: tickets.length,   sub: "all time",         accent: "from-faint/30" },
            { label: "Needs Attention",  value: queue.length,     sub: "awaiting approval", accent: queue.length > 0 ? "from-techm" : "from-faint/30", highlight: queue.length > 0 },
            { label: "Resolved",         value: resolved.length,  sub: "approved or rejected", accent: "from-ok" },
            { label: "In Pipeline",      value: live.length,      sub: "processing now",   accent: live.length > 0 ? "from-info" : "from-faint/30" },
          ].map((stat) => (
            <div
              key={stat.label}
              className={`relative overflow-hidden rounded-2xl border bg-surface px-5 py-4 ${
                stat.highlight ? "border-techm/40 bg-techm-soft/20" : "border-line"
              }`}
              style={{ boxShadow: "var(--shadow)" }}
            >
              <span className={`absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r ${stat.accent} to-transparent`} />
              <p className="eyebrow">{stat.label}</p>
              <p className="kpi-number mt-2">{stat.value}</p>
              <p className="mt-1 text-[11px] text-faint">{stat.sub}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_380px]">

          {/* ── Left column ── */}
          <div className="space-y-5">

            {/* Portals grid */}
            <div>
              <p className="eyebrow mb-2.5">Portals</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {PORTALS.map((p) => (
                  <Link
                    key={p.href}
                    href={p.href}
                    className="group relative overflow-hidden rounded-2xl border border-line bg-surface px-5 py-4 transition hover:-translate-y-0.5 hover:border-line-strong"
                    style={{ boxShadow: "var(--shadow)" }}
                  >
                    <span className={`absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r ${p.accent} to-transparent opacity-70 transition group-hover:opacity-100`} />
                    <span
                      className="pointer-events-none absolute -right-3 -top-4 font-display text-[4.5rem] font-bold leading-none text-line/40 transition group-hover:text-line"
                      aria-hidden
                    >
                      {p.code}
                    </span>
                    <div className="relative">
                      <p className="eyebrow">{p.tag}</p>
                      <h3 className="mt-2 font-semibold text-ink">{p.title}</h3>
                      <p className="mt-1 text-xs leading-relaxed text-muted">{p.desc}</p>
                      <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-techm transition group-hover:gap-2">
                        Open <span>→</span>
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {/* Decision pipeline */}
            <div>
              <p className="eyebrow mb-2.5">Decision pipeline</p>
              <div className="rounded-2xl border border-line bg-surface px-5 py-4" style={{ boxShadow: "var(--shadow)" }}>
                <div className="flex items-stretch gap-0 overflow-x-auto no-scrollbar">
                  {PIPELINE.map((step, i) => (
                    <div key={step.label} className="flex items-stretch">
                      <div className="flex min-w-[110px] flex-col items-center justify-center rounded-xl border border-line bg-raised px-4 py-3 text-center">
                        <p className="text-xs font-medium text-ink">{step.label}</p>
                        <p className={`mt-0.5 font-mono text-[9px] tracking-wider ${step.color}`}>{step.code}</p>
                      </div>
                      {i < PIPELINE.length - 1 && (
                        <div className="flex items-center px-1">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-faint">
                            <path d="M5 12h14M12 5l7 7-7 7" />
                          </svg>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[11px] text-faint">
                  APQC PCF 6.7 · Every claim traverses this pipeline with a human checkpoint before finalization.
                </p>
              </div>
            </div>
          </div>

          {/* ── Right column — live activity ── */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <p className="eyebrow">Live activity</p>
              {live.length > 0 && (
                <span className="flex items-center gap-1.5 text-[11px] text-info">
                  <span className="dot dot-live" style={{ width: "5px", height: "5px", background: "var(--info)", boxShadow: "0 0 0 2px var(--info-soft)" }} />
                  {live.length} processing
                </span>
              )}
            </div>
            <div
              className="overflow-hidden rounded-2xl border border-line bg-surface"
              style={{ boxShadow: "var(--shadow)" }}
            >
              {tickets.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-raised">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-faint">
                      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                      <rect x="9" y="3" width="6" height="4" rx="1" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-muted">No tickets yet</p>
                  <p className="mt-1 text-xs text-faint">Submit a request from the Customer Portal</p>
                </div>
              ) : (
                <div>
                  {tickets.slice(0, 10).map((t, i) => (
                    <Link
                      key={t.id}
                      href="/manager"
                      className={`flex items-start gap-3 px-4 py-3 transition hover:bg-raised ${
                        i < tickets.length - 1 && i < 9 ? "border-b border-line" : ""
                      }`}
                    >
                      <span className={`dot mt-1.5 ${STATUS_DOT[t.status] ?? "dot-muted"}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="line-clamp-1 text-sm text-ink">{t.summary}</span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2">
                          {t.domain && (
                            <span className={`badge ${DOMAIN_CLASS[t.domain] ?? ""}`}>{t.domain}</span>
                          )}
                          {t.vehicle_vin && (
                            <span className="font-mono text-[10px] text-faint">{t.vehicle_vin}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-none flex-col items-end gap-1">
                        <span className={`text-[10px] font-medium ${STATUS_TEXT[t.status] ?? "text-faint"}`}>
                          {t.status.replace(/_/g, " ")}
                        </span>
                      </div>
                    </Link>
                  ))}
                  {tickets.length > 10 && (
                    <Link
                      href="/manager"
                      className="flex items-center justify-center gap-1 border-t border-line py-2.5 text-xs font-medium text-techm transition hover:text-techm-deep"
                    >
                      View all {tickets.length} tickets →
                    </Link>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
