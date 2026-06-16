"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import { getTicket, listTickets } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Ticket } from "@/lib/types";

function relTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const STATUS_DOT: Record<string, string> = {
  resolved: "dot-ok",
  rejected: "dot-danger",
  escalated: "dot-warn",
  awaiting_approval: "dot-info",
  under_review: "dot-muted",
  processing: "dot-muted",
  failed: "dot-danger",
};

const STATUS_COLOR: Record<string, string> = {
  resolved: "text-ok bg-ok-soft border-ok/30",
  rejected: "text-danger bg-danger-soft border-danger/30",
  escalated: "text-warn bg-warn-soft border-warn/30",
  awaiting_approval: "text-techm bg-techm-soft border-techm/30",
  under_review: "text-muted bg-raised border-line",
  processing: "text-muted bg-raised border-line",
  failed: "text-danger bg-danger-soft border-danger/30",
};

const DOMAIN_ACCENT: Record<string, string> = {
  warranty: "from-techm",
  recall: "from-warn",
  parts: "from-info",
  quality: "from-ok",
  customer: "from-process",
  service: "from-ok",
};

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
function AlertIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

const STATUS_STEPS = [
  { keys: ["submitted", "under_review", "processing"], label: "Submitted" },
  { keys: ["awaiting_approval"], label: "Under Review" },
  { keys: ["resolved", "rejected", "escalated"], label: "Decision Made" },
];

function DetailPanel({ ticketId }: { ticketId: string }) {
  const [ticket, setTicket] = useState<Ticket | null>(null);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const t = await getTicket(ticketId);
        if (active) setTicket(t);
      } catch { /* ignore */ }
    };
    poll();
    const id = setInterval(poll, 4000);
    return () => { active = false; clearInterval(id); };
  }, [ticketId]);

  if (!ticket) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-techm" />
      </div>
    );
  }

  const status = ticket.status ?? "processing";
  const activeStep = STATUS_STEPS.findIndex((s) => s.keys.includes(status));
  const isTerminal = ["resolved", "rejected", "escalated"].includes(status);
  const isAwaiting = status === "awaiting_approval";
  const isFailed = status === "failed";
  const t = ticket as Record<string, unknown>;

  return (
    <div className="animate-fade-up space-y-5 p-6">
      {/* Ticket header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">Request detail</p>
          <h2 className="text-xl font-bold tracking-tight text-ink">
            <span className="font-mono text-techm">#{ticketId.slice(0, 8).toUpperCase()}</span>
          </h2>
          {ticket.claim_number && (
            <p className="mt-0.5 font-mono text-xs text-faint">{ticket.claim_number}</p>
          )}
        </div>
        <span className={`flex-none rounded-lg border px-2.5 py-1 text-[11px] font-semibold capitalize ${STATUS_COLOR[status] ?? "text-muted border-line bg-raised"}`}>
          {status.replace(/_/g, " ")}
        </span>
      </div>

      {/* Summary */}
      <div className="rounded-xl border border-line bg-raised px-4 py-3">
        <p className="text-sm text-ink leading-relaxed">{ticket.summary}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {ticket.domain && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-faint border border-line rounded px-2 py-0.5">
              {ticket.domain}
            </span>
          )}
          {ticket.vehicle_vin && (
            <span className="font-mono text-[10px] text-faint">{ticket.vehicle_vin}</span>
          )}
        </div>
      </div>

      {/* Progress stepper */}
      <div className="rounded-2xl border border-line bg-surface px-5 py-5" style={{ boxShadow: "var(--shadow)" }}>
        <div className="flex items-start">
          {STATUS_STEPS.map((s, i) => {
            const done = i <= activeStep;
            const current = i === activeStep;
            return (
              <div key={s.label} className="flex flex-1 items-start">
                <div className="flex flex-col items-center gap-2">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-full border-2 text-xs font-bold transition-all ${
                    done ? "border-techm bg-techm text-white shadow-md shadow-techm/20"
                         : "border-line bg-raised text-faint"
                  } ${current && !isTerminal && !isFailed ? "ring-4 ring-techm/20" : ""}`}>
                    {done && !current ? <CheckIcon /> : i + 1}
                  </div>
                  <span className={`text-[10px] font-medium text-center leading-tight ${done ? "text-ink" : "text-faint"}`}>
                    {s.label}
                  </span>
                </div>
                {i < STATUS_STEPS.length - 1 && (
                  <div className="mx-3 mt-4 h-0.5 flex-1 overflow-hidden rounded-full bg-line">
                    <div className={`h-full rounded-full bg-techm transition-all duration-700 ${i < activeStep ? "w-full" : "w-0"}`} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* State-specific info */}
      {isFailed && (
        <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3.5">
          <span className="text-danger flex-none mt-0.5"><AlertIcon /></span>
          <div>
            <p className="text-sm font-semibold text-danger">Processing error</p>
            <p className="mt-0.5 text-xs text-muted">Please try submitting a new request or contact support.</p>
          </div>
        </div>
      )}

      {isAwaiting && (
        <div className="flex items-start gap-3 rounded-xl border border-techm/30 bg-techm-soft px-4 py-3.5">
          <span className="text-techm animate-pulse flex-none mt-0.5"><ClockIcon /></span>
          <div>
            <p className="text-sm font-semibold text-ink">With our team</p>
            <p className="mt-0.5 text-xs text-muted">Awaiting manager approval. This page updates automatically.</p>
          </div>
        </div>
      )}

      {isTerminal && (
        <div className="space-y-3">
          {ticket.claim_number && (
            <div className="flex items-center gap-3 rounded-xl border border-ok/30 bg-ok-soft px-4 py-3.5">
              <div className="flex-1">
                <p className="font-mono text-[10px] uppercase tracking-widest text-ok mb-0.5">Claim Reference</p>
                <p className="font-mono text-base font-bold text-ink tracking-widest">{ticket.claim_number}</p>
              </div>
              <span className="dot dot-ok" />
            </div>
          )}
          {(t.decision_message as string | undefined) && (
            <div className="rounded-xl border border-line bg-raised px-4 py-3.5">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted">
                {t.decision_message as string}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MyRequestsPage() {
  const { session, ready } = useAuth(["customer"]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session?.customer_id) return;
    try {
      const all = await listTickets();
      const mine = all.filter((t) => t.customer_id === session.customer_id);
      setTickets(mine);
      if (!selected && mine.length > 0) setSelected(mine[0].id);
    } catch { /* ignore */ }
  }, [session?.customer_id, selected]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  if (!ready || !session) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-faint">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-techm" />
          Loading…
        </div>
      </main>
    );
  }

  return (
    <Shell title="My Requests" session={session}>
      <div className="rise">
        {tickets.length === 0 ? (
          /* ── Empty state ── */
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-raised">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-faint">
                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                <rect x="9" y="3" width="6" height="4" rx="1" />
              </svg>
            </div>
            <p className="text-base font-semibold text-ink">No requests yet</p>
            <p className="mt-1 text-sm text-muted">Submit your first request from the Home page.</p>
            <Link
              href="/customer"
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-techm px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-techm-deep"
            >
              Start a request →
            </Link>
          </div>
        ) : (
          /* ── Split pane ── */
          <div
            className="flex overflow-hidden rounded-2xl border border-line bg-surface"
            style={{ height: "calc(100vh - 11rem)", boxShadow: "var(--shadow)" }}
          >
            {/* Left — ticket list */}
            <div className="w-72 flex-none overflow-y-auto border-r border-line">
              <div className="sticky top-0 z-10 border-b border-line bg-raised px-4 py-3">
                <p className="eyebrow">All requests</p>
                <p className="mt-0.5 font-mono text-[10px] text-faint">{tickets.length} total</p>
              </div>
              <ul className="divide-y divide-line">
                {tickets.map((t) => {
                  const accent = DOMAIN_ACCENT[t.domain ?? "warranty"] ?? "from-faint/30";
                  const active = selected === t.id;
                  return (
                    <li key={t.id}>
                      <button
                        onClick={() => setSelected(t.id)}
                        className={`relative w-full px-4 py-3.5 text-left transition ${
                          active ? "bg-techm-soft/40" : "hover:bg-raised"
                        }`}
                      >
                        {active && (
                          <span className="absolute inset-y-0 left-0 w-[3px] rounded-r bg-techm" />
                        )}
                        <span className={`absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r ${accent} to-transparent opacity-60`} />
                        <div className="flex items-start gap-2.5">
                          <span className={`dot mt-1.5 flex-none ${STATUS_DOT[t.status] ?? "dot-muted"}`} />
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 text-[13px] font-medium leading-snug text-ink">
                              {t.summary}
                            </p>
                            <div className="mt-1.5 flex items-center gap-2">
                              <span className="font-mono text-[10px] text-faint">
                                #{t.id.slice(0, 8).toUpperCase()}
                              </span>
                              {Boolean((t as Record<string, unknown>).created_at) && (
                                <span className="text-[10px] text-faint">
                                  {relTime(String((t as Record<string, unknown>).created_at))}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Right — detail */}
            <div className="flex-1 overflow-y-auto">
              {selected ? (
                <DetailPanel ticketId={selected} />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-faint">
                  Select a request to view details
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}
