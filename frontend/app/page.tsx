"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import { listTickets } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Ticket } from "@/lib/types";

const PORTALS = [
  {
    href: "/manager",
    code: "01",
    title: "Command Center",
    desc: "Review AI recommendations and approve high-stakes decisions.",
    tag: "Operations",
    ready: true,
  },
  {
    href: "/dealer",
    code: "02",
    title: "Dealer Portal",
    desc: "Service schedule, parts status, open jobs.",
    tag: "Service advisors",
    ready: false,
  },
  {
    href: "/admin",
    code: "03",
    title: "Admin Console",
    desc: "Agents, rules, users, searchable audit log.",
    tag: "IT / config",
    ready: false,
  },
];

const PIPELINE = [
  ["Intake", "6.7.3"],
  ["Coverage", "6.7.3"],
  ["Fraud", "6.7.5.5"],
  ["Cost + decide", "6.7.3.5"],
  ["Human approval", "HITL"],
];

const STATUS_CHIPS: Record<string, string> = {
  resolved: "border-ok/40 text-ok",
  rejected: "border-danger/40 text-danger",
  escalated: "border-warn/40 text-warn",
  awaiting_approval: "border-techm/40 text-techm",
};

export default function Home() {
  const { session, ready } = useAuth(["manager"]);
  const [tickets, setTickets] = useState<Ticket[]>([]);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const t = await listTickets();
        if (active) setTickets(t);
      } catch {
        /* ignore */
      }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  if (!ready || !session) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-faint">
        Loading…
      </main>
    );
  }

  const queue = tickets.filter((t) => t.status === "awaiting_approval");

  return (
    <Shell title="Overview" session={session}>
      <div className="rise">
        {/* greeting strip */}
        <div className="card relative overflow-hidden p-6">
          <span className="absolute inset-y-0 left-0 w-1 bg-techm" />
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="eyebrow">Automotive After-Sales · Plan B</p>
              <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink">
                Welcome, {session.name.split(" ")[0]}.
              </h1>
              <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted">
                Agent pipeline with a human approval checkpoint — every claim is
                extracted, validated, fraud-screened, costed, and held for your decision.
              </p>
            </div>
            {queue.length > 0 && (
              <Link
                href="/manager"
                className="rounded-xl bg-techm px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-techm-deep"
              >
                {queue.length} awaiting approval →
              </Link>
            )}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[1fr_360px]">
          {/* portals */}
          <div>
            <h2 className="eyebrow mb-2.5">Portals</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {PORTALS.map((p) =>
                p.ready ? (
                  <Link
                    key={p.href}
                    href={p.href}
                    className="card group relative overflow-hidden p-5 transition hover:-translate-y-0.5 hover:border-techm"
                  >
                    <span
                      className="pointer-events-none absolute -right-4 -top-6 font-display text-[5rem] font-bold leading-none text-line-strong/30 transition group-hover:text-techm-soft"
                      aria-hidden
                    >
                      {p.code}
                    </span>
                    <div className="relative">
                      <span className="eyebrow">{p.tag}</span>
                      <h3 className="mt-2 font-semibold text-ink">{p.title}</h3>
                      <p className="mt-1 text-xs leading-relaxed text-muted">{p.desc}</p>
                      <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-techm">
                        Open
                        <span className="transition group-hover:translate-x-0.5">→</span>
                      </span>
                    </div>
                  </Link>
                ) : (
                  <div
                    key={p.href}
                    title="Not implemented yet"
                    className="card relative cursor-not-allowed overflow-hidden p-5 opacity-60"
                  >
                    <span
                      className="pointer-events-none absolute -right-4 -top-6 font-display text-[5rem] font-bold leading-none text-line-strong/20"
                      aria-hidden
                    >
                      {p.code}
                    </span>
                    <div className="relative">
                      <div className="flex items-center justify-between">
                        <span className="eyebrow">{p.tag}</span>
                        <span className="chip !text-[8px]">soon</span>
                      </div>
                      <h3 className="mt-2 font-semibold text-muted">{p.title}</h3>
                      <p className="mt-1 text-xs leading-relaxed text-faint">{p.desc}</p>
                    </div>
                  </div>
                ),
              )}
            </div>

            {/* pipeline strip */}
            <h2 className="eyebrow mb-2.5 mt-6">Decision pipeline</h2>
            <div className="card flex flex-wrap items-center gap-x-1 gap-y-2 px-4 py-3.5">
              {PIPELINE.map(([label, code], i) => (
                <div key={label} className="flex items-center">
                  <div className="rounded-lg border border-line bg-raised px-3 py-1.5">
                    <p className="text-xs font-medium text-ink">{label}</p>
                    <p className="font-mono text-[9px] tracking-wider text-faint">{code}</p>
                  </div>
                  {i < PIPELINE.length - 1 && (
                    <span className="px-1.5 text-faint" aria-hidden>
                      →
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* live activity */}
          <div>
            <h2 className="eyebrow mb-2.5">Live activity</h2>
            <div className="card overflow-hidden">
              {tickets.length === 0 ? (
                <p className="p-4 text-sm text-faint">
                  No tickets yet. Submit one from the Customer Portal.
                </p>
              ) : (
                <table className="w-full text-left text-sm">
                  <tbody>
                    {tickets.slice(0, 9).map((t) => (
                      <tr key={t.id} className="border-b border-line last:border-0">
                        <td className="max-w-0 truncate px-4 py-2.5">
                          <span className="text-ink">{t.summary}</span>
                          <span className="ml-2 font-mono text-[10px] text-faint">
                            {t.domain}
                          </span>
                        </td>
                        <td className="w-px whitespace-nowrap px-4 py-2.5">
                          <span className={`chip ${STATUS_CHIPS[t.status] ?? ""}`}>
                            {t.status.replace(/_/g, " ")}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
