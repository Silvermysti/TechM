"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Shell } from "@/components/Shell";
import {
  API_BASE,
  approveTransfer,
  closeClaim,
  decideTicket,
  getClaim,
  getMetrics,
  listAudit,
  listTickets,
  listTransfers,
  payClaim,
  rejectTransfer,
  type TrendMetrics,
  type VINTransfer,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTicketStream, type SSEEvent } from "@/lib/useSSE";
import type { AgentOutput, AuditEntry, Claim, Ticket } from "@/lib/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const DOMAIN_COLORS: Record<string, { stripe: string; badge: string; text: string }> = {
  warranty: { stripe: "bg-techm", badge: "badge badge-warranty", text: "text-techm" },
  recall:   { stripe: "bg-warn",  badge: "badge badge-recall",   text: "text-warn" },
  parts:    { stripe: "bg-info",  badge: "badge badge-parts",    text: "text-info" },
  quality:  { stripe: "bg-process", badge: "badge badge-quality", text: "text-process" },
  customer: { stripe: "bg-ok",   badge: "badge badge-customer", text: "text-ok" },
  service:  { stripe: "bg-faint", badge: "badge badge-service",  text: "text-faint" },
};

function getDomainColors(domain: string | null) {
  return DOMAIN_COLORS[domain ?? ""] ?? { stripe: "bg-faint", badge: "badge", text: "text-faint" };
}

const DECISION_COLORS: Record<string, string> = {
  approve:  "text-ok",
  reject:   "text-danger",
  escalate: "text-warn",
};

const DECISION_CHIPS: Record<string, string> = {
  approve:  "border-ok/40 bg-ok-soft text-ok",
  reject:   "border-danger/40 bg-danger-soft text-danger",
  escalate: "border-warn/40 bg-warn-soft text-warn",
};

const DECISION_ICONS: Record<string, string> = {
  approve:  "✓",
  reject:   "✕",
  escalate: "↑",
};

const STATUS_CHIPS: Record<string, string> = {
  resolved:          "border-ok/40 text-ok",
  rejected:          "border-danger/40 text-danger",
  escalated:         "border-warn/40 text-warn",
  awaiting_approval: "border-techm/40 text-techm",
};

const CLAIM_STATUS_CHIPS: Record<string, string> = {
  approved: "border-ok/40 bg-ok-soft text-ok",
  paid:     "border-techm/40 bg-techm-soft text-techm",
  closed:   "border-line text-faint",
  rejected: "border-danger/40 bg-danger-soft text-danger",
};

function agentLabel(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FieldValue({ name, value }: { name: string; value: unknown }) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-faint">—</span>;
  }
  if (typeof value === "boolean") {
    return (
      <span className={`chip ${value ? "border-ok/40 text-ok" : "border-line text-faint"}`}>
        {value ? "yes" : "no"}
      </span>
    );
  }
  if (typeof value === "number") {
    const scoreLike = /score|confidence|risk/i.test(name);
    if (scoreLike && value >= 0 && value <= 1) {
      const pct = Math.round(value * 100);
      const fill =
        name.toLowerCase().includes("risk")
          ? pct > 60 ? "bg-danger" : pct > 30 ? "bg-warn" : "bg-ok"
          : pct >= 70 ? "bg-ok" : pct >= 40 ? "bg-warn" : "bg-danger";
      return (
        <span className="inline-flex items-center gap-2">
          <span className="conf-bar-track w-20">
            <span className={`conf-bar-fill ${fill}`} style={{ width: `${pct}%` }} />
          </span>
          <span className="font-mono text-[10px] tabular-nums text-muted">{pct}%</span>
        </span>
      );
    }
    return <span className="font-mono tabular-nums">{value}</span>;
  }
  if (typeof value === "string") {
    if (DECISION_CHIPS[value]) {
      return <span className={`chip ${DECISION_CHIPS[value]}`}>{value}</span>;
    }
    return <span className="whitespace-pre-wrap break-words">{value}</span>;
  }
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    return (
      <span className="flex flex-wrap gap-1.5">
        {value.map((v, i) => (
          <span key={i} className="chip">{v}</span>
        ))}
      </span>
    );
  }
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-faint">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function StepOutputTable({ output }: { output: unknown }) {
  if (!output || typeof output !== "object") return null;
  const entries = Object.entries(output as Record<string, unknown>);
  if (entries.length === 0) return null;
  return (
    <dl className="mt-2.5 space-y-1.5">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-baseline gap-3 text-xs">
          <dt className="w-32 flex-none font-mono text-[10px] uppercase tracking-wider text-faint">
            {k.replace(/_/g, " ")}
          </dt>
          <dd className="min-w-0 flex-1 leading-relaxed text-muted">
            <FieldValue name={k} value={v} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function AgentTraceTimeline({ trace }: { trace: AgentOutput[] }) {
  return (
    <div className="timeline">
      {trace.map((step, i) => (
        <div key={i} className="timeline-item">
          <span className="timeline-node" />
          <div className="rounded-xl border border-line bg-raised p-3.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="flex h-5 w-5 flex-none items-center justify-center rounded font-mono text-[9px] font-bold bg-techm-soft text-techm">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-[13px] font-semibold text-ink">
                {agentLabel(step.agent)}
              </span>
              {step.apqc && (
                <span className="chip ml-auto text-[9px]">APQC {step.apqc}</span>
              )}
            </div>
            <StepOutputTable output={step.output} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ClaimPanel({ claimId, onUpdate }: { claimId: string; onUpdate: () => void }) {
  const [claim, setClaim] = useState<Claim | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getClaim(claimId).then(setClaim).catch(() => null);
  }, [claimId]);

  const act = async (fn: () => Promise<Claim>) => {
    setBusy(true);
    try {
      const updated = await fn();
      setClaim(updated);
      onUpdate();
    } finally {
      setBusy(false);
    }
  };

  if (!claim) return null;

  return (
    <div className="rounded-xl border border-ok/25 bg-ok-soft/20 p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow text-ok">Warranty Claim</p>
          <p className="mt-1 font-mono text-base font-bold tracking-wider text-ink">
            {claim.claim_number}
          </p>
        </div>
        <span className={`chip flex-none ${CLAIM_STATUS_CHIPS[claim.status] ?? "border-line text-muted"}`}>
          {claim.status}
        </span>
      </div>

      {/* Cost breakdown */}
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-line bg-surface px-3 py-2">
          <p className="font-mono text-[9px] uppercase tracking-wider text-faint">Labor</p>
          <p className="mt-0.5 font-mono text-sm font-semibold text-ink">
            ₹{claim.labor_cost.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-line bg-surface px-3 py-2">
          <p className="font-mono text-[9px] uppercase tracking-wider text-faint">Parts</p>
          <p className="mt-0.5 font-mono text-sm font-semibold text-ink">
            ₹{claim.parts_cost.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-techm/30 bg-techm-soft px-3 py-2">
          <p className="font-mono text-[9px] uppercase tracking-wider text-techm/70">Total</p>
          <p className="mt-0.5 font-mono text-sm font-bold text-techm">
            ₹{claim.total_cost.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Line items */}
      {claim.lines && claim.lines.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-lg border border-line">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="border-b border-line bg-raised">
                <th className="px-3 py-1.5 font-mono text-[9px] uppercase tracking-wider text-faint">Description</th>
                <th className="px-3 py-1.5 font-mono text-[9px] uppercase tracking-wider text-faint text-right">Qty</th>
                <th className="px-3 py-1.5 font-mono text-[9px] uppercase tracking-wider text-faint text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {claim.lines.map((line) => (
                <tr key={line.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-1.5 text-muted">{line.description}</td>
                  <td className="px-3 py-1.5 font-mono text-right text-muted">{line.quantity}</td>
                  <td className="px-3 py-1.5 font-mono text-right text-ink">₹{line.line_total.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Actions */}
      {(claim.status === "approved" || claim.status === "paid") && (
        <div className="mt-3 flex gap-2">
          {claim.status === "approved" && (
            <button
              onClick={() => act(() => payClaim(claim.id))}
              disabled={busy}
              className="flex-1 rounded-lg bg-techm px-3 py-2 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              Mark Paid
            </button>
          )}
          <button
            onClick={() => act(() => closeClaim(claim.id))}
            disabled={busy}
            className="flex-1 rounded-lg border border-line px-3 py-2 text-xs font-medium text-muted transition hover:border-line-strong disabled:opacity-50"
          >
            Close Claim
          </button>
        </div>
      )}
    </div>
  );
}

function TicketDetailPanel({
  ticket,
  onDecide,
  onClaimUpdate,
  busy,
}: {
  ticket: Ticket;
  onDecide: (d: "approve" | "reject" | "escalate") => void;
  onClaimUpdate: () => void;
  busy: boolean;
}) {
  const [emailOpen, setEmailOpen] = useState(false);
  const rec = ticket.recommendation;
  const dc = getDomainColors(ticket.domain);
  const confPct = rec ? Math.round((rec.confidence ?? 0) * 100) : 0;
  const confFill =
    confPct >= 70 ? "bg-ok" : confPct >= 40 ? "bg-warn" : "bg-danger";
  const isAwaiting = ticket.status === "awaiting_approval";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Scrollable body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {/* ── Header ── */}
        <div className="frame card p-5">
          <div className="flex items-start gap-3 flex-wrap">
            <span className={dc.badge}>{ticket.domain ?? "unknown"}</span>
            {ticket.apqc_process && (
              <span className="chip text-[9px]">APQC {ticket.apqc_process}</span>
            )}
            {ticket.claim_number && (
              <span className="chip text-[9px] border-techm/30 text-techm">
                {ticket.claim_number}
              </span>
            )}
            <span className="ml-auto font-mono text-[10px] text-faint">
              #{ticket.id.slice(0, 8)}
            </span>
          </div>

          <h2 className="mt-3 text-[1.05rem] font-semibold leading-snug text-ink">
            {ticket.summary}
          </h2>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {ticket.vehicle_vin && (
              <span className="chip font-mono text-[10px]">{ticket.vehicle_vin}</span>
            )}
            <span
              className={`chip text-[9px] ${STATUS_CHIPS[ticket.status] ?? "border-line text-muted"}`}
            >
              {ticket.status.replace(/_/g, " ")}
            </span>
            {ticket.priority && (
              <span className="chip text-[9px] border-line text-faint">
                P{ticket.priority}
              </span>
            )}
          </div>
        </div>

        {/* ── AI Verdict ── */}
        {rec && (
          <div
            className={`rounded-xl border p-5 ${
              rec.decision === "approve"
                ? "border-ok/30 bg-ok-soft/20"
                : rec.decision === "reject"
                ? "border-danger/30 bg-danger-soft/20"
                : "border-warn/30 bg-warn-soft/20"
            }`}
          >
            <p className="eyebrow mb-3">AI Verdict</p>
            <div className="flex items-center gap-4">
              <span
                className={`font-display text-3xl font-bold tracking-tight ${
                  DECISION_COLORS[rec.decision] ?? "text-ink"
                }`}
              >
                {DECISION_ICONS[rec.decision] ?? ""} {rec.decision.toUpperCase()}
              </span>
              <div className="flex-1 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
                    Confidence
                  </span>
                  <span className="font-mono text-sm font-bold tabular-nums text-ink">
                    {confPct}%
                  </span>
                </div>
                <div className="conf-bar-track">
                  <div
                    className={`conf-bar-fill ${confFill}`}
                    style={{ width: `${confPct}%` }}
                  />
                </div>
              </div>
            </div>

            <p className="mt-4 text-[13px] leading-relaxed text-muted">{rec.reasoning}</p>

            {rec.draft_email && (
              <div className="mt-4">
                <button
                  onClick={() => setEmailOpen((o) => !o)}
                  className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-faint transition hover:text-muted"
                >
                  <span
                    className={`inline-block transition-transform ${emailOpen ? "rotate-90" : ""}`}
                  >
                    ▶
                  </span>
                  Draft Customer Email
                </button>
                {emailOpen && (
                  <div className="mt-2 rounded-lg border border-line bg-raised p-3">
                    <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-muted">
                      {rec.draft_email}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Claim ── */}
        {ticket.claim_id && (
          <ClaimPanel claimId={ticket.claim_id} onUpdate={onClaimUpdate} />
        )}

        {/* ── Attachments ── */}
        {ticket.attachments && ticket.attachments.length > 0 && (
          <div>
            <p className="eyebrow mb-2.5">
              Customer Evidence ({ticket.attachments.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {ticket.attachments.map((a) => (
                <a
                  key={a.id}
                  href={`${API_BASE}${a.url}`}
                  target="_blank"
                  rel="noreferrer"
                  title={a.filename}
                  className="group relative overflow-hidden rounded-xl border border-line transition hover:border-techm"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`${API_BASE}${a.url}`}
                    alt={a.filename}
                    className="h-24 w-24 object-cover transition group-hover:scale-105"
                  />
                  <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/60 to-transparent opacity-0 transition group-hover:opacity-100">
                    <p className="truncate p-1.5 text-[9px] text-white">{a.filename}</p>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* ── Agent Trace ── */}
        <div>
          <p className="eyebrow mb-3">Agent Reasoning Chain</p>
          {ticket.agent_trace && ticket.agent_trace.length > 0 ? (
            <AgentTraceTimeline trace={ticket.agent_trace} />
          ) : (
            <p className="rounded-xl border border-dashed border-line p-4 text-sm text-faint">
              No trace recorded for this ticket.
            </p>
          )}
        </div>
      </div>

      {/* ── Action Bar (sticky bottom) ── */}
      <div className="flex-none border-t border-line bg-surface/95 backdrop-blur-sm px-6 py-4">
        {isAwaiting ? (
          <div className="flex gap-3">
            <button
              onClick={() => onDecide("approve")}
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-ok px-4 py-3 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-40 active:scale-[0.98]"
            >
              <span className="text-base">✓</span> Approve
            </button>
            <button
              onClick={() => onDecide("reject")}
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-danger/50 bg-danger-soft/40 px-4 py-3 text-sm font-bold text-danger transition hover:bg-danger-soft disabled:opacity-40 active:scale-[0.98]"
            >
              <span className="text-base">✕</span> Reject
            </button>
            <button
              onClick={() => onDecide("escalate")}
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-warn/50 bg-warn-soft/40 px-4 py-3 text-sm font-bold text-warn transition hover:bg-warn-soft disabled:opacity-40 active:scale-[0.98]"
            >
              <span className="text-base">↑</span> Escalate
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span
              className={`chip ${STATUS_CHIPS[ticket.status] ?? "border-line text-muted"}`}
            >
              {ticket.status.replace(/_/g, " ")}
            </span>
            <p className="text-sm text-muted">
              Decision:{" "}
              <span className="font-semibold capitalize text-ink">
                {ticket.human_decision ?? ticket.status}
              </span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Audit Log ────────────────────────────────────────────────────────────────

function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [filter, setFilter] = useState<"all" | "human" | "agent">("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    listAudit({ limit: 100, actor_type: filter === "all" ? undefined : filter })
      .then(setEntries)
      .catch(() => null);
  }, [filter]);

  const fmt = (ts: string) =>
    new Date(ts).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" });

  const visible = entries.filter((e) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.action.toLowerCase().includes(q) ||
      e.actor_id.toLowerCase().includes(q) ||
      (e.resource_id ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-52">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint text-xs">
            ⌕
          </span>
          <input
            type="text"
            placeholder="Search actions, actors, resources…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="field w-full py-2 pl-7 pr-3 text-[13px]"
          />
        </div>
        <div className="flex gap-1.5">
          {(["all", "human", "agent"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition capitalize ${
                filter === f
                  ? "bg-techm text-white"
                  : "border border-line text-muted hover:border-line-strong hover:text-ink"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <span className="text-2xl text-faint">◌</span>
            <p className="text-sm text-faint">No audit entries match your filter.</p>
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line bg-raised">
                {["Time", "Actor", "Type", "Action", "Resource"].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2.5 font-mono text-[9px] uppercase tracking-wider text-faint"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((e) => (
                <tr key={e.id} className="border-b border-line last:border-0 hover:bg-raised transition">
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-faint">
                    {fmt(e.timestamp)}
                  </td>
                  <td className="max-w-[140px] truncate px-4 py-2.5 font-mono text-[10px] text-muted">
                    {e.actor_id.split(":").pop()}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`chip text-[9px] ${
                        e.actor_type === "human"
                          ? "border-techm/30 text-techm"
                          : "border-line text-faint"
                      }`}
                    >
                      {e.actor_type}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-ink">{e.action}</td>
                  <td className="px-4 py-2.5 font-mono text-faint">
                    {e.resource_id ? `#${e.resource_id.slice(0, 8)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Agent Monitor ────────────────────────────────────────────────────────────

function AgentMonitor({ tickets }: { tickets: Ticket[] }) {
  const [watchId, setWatchId] = useState<string | null>(null);
  const { events, connected, reset } = useTicketStream(watchId);
  const feedRef = useRef<HTMLDivElement>(null);

  const recentTickets = tickets.slice(0, 10);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [events]);

  const EVENT_LABELS: Record<string, string> = {
    "ticket.created":           "Ticket created",
    "agent.started":            "Agent pipeline started",
    "agent.step":               "Agent step completed",
    "ticket.awaiting_approval": "Awaiting human approval",
    "ticket.resolved":          "Ticket resolved",
    done:                       "Stream complete",
  };

  const EVENT_DOT: Record<string, string> = {
    "ticket.created":           "dot dot-info",
    "agent.started":            "dot dot-warn",
    "agent.step":               "dot dot-muted",
    "ticket.awaiting_approval": "dot-live dot",
    "ticket.resolved":          "dot dot-ok",
    done:                       "dot dot-ok",
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]">
      {/* Ticket picker */}
      <div>
        <p className="eyebrow mb-3">Select a ticket to monitor</p>
        <div className="space-y-1.5">
          {recentTickets.length === 0 && (
            <p className="card p-4 text-sm text-faint">No tickets yet.</p>
          )}
          {recentTickets.map((t) => {
            const dc = getDomainColors(t.domain);
            return (
              <button
                key={t.id}
                onClick={() => {
                  setWatchId(t.id);
                  reset();
                }}
                className={`card card-hover w-full px-3 py-2.5 text-left ${
                  watchId === t.id ? "active" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`dot flex-none ${dc.stripe}`} />
                  <p className="truncate text-[13px] font-medium text-ink">{t.summary}</p>
                </div>
                <p className="mt-0.5 font-mono text-[10px] text-faint">
                  {t.domain} · #{t.id.slice(0, 8)}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Event feed */}
      <div>
        {!watchId ? (
          <div className="flex h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-line gap-2">
            <span className="text-3xl text-faint">◎</span>
            <p className="text-sm text-faint">Select a ticket to stream its agent activity</p>
          </div>
        ) : (
          <div className="card flex flex-col overflow-hidden" style={{ maxHeight: "520px" }}>
            {/* Feed header */}
            <div className="flex flex-none items-center justify-between border-b border-line bg-raised px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className={connected ? "dot dot-live" : "dot dot-muted"} />
                <p className="font-mono text-xs text-muted">
                  Streaming{" "}
                  <span className="text-ink font-semibold">#{watchId.slice(0, 8)}</span>
                </p>
              </div>
              <span className="font-mono text-[10px] text-faint">
                {events.filter((e) => e.type !== "ping").length} events
              </span>
            </div>

            {/* Scrollable events */}
            <div ref={feedRef} className="flex-1 overflow-y-auto">
              {events.filter((e) => e.type !== "ping").length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12">
                  <span className="text-2xl text-faint">◌</span>
                  <p className="text-sm text-faint">Waiting for events…</p>
                </div>
              ) : (
                <ol className="divide-y divide-line">
                  {events
                    .filter((e: SSEEvent) => e.type !== "ping")
                    .map((e: SSEEvent, i) => (
                      <li key={i} className="animate-fade-up px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`flex-none ${
                              EVENT_DOT[e.type] ?? "dot dot-muted"
                            }`}
                          />
                          <span className="text-[13px] font-medium text-ink">
                            {EVENT_LABELS[e.type] ?? e.type}
                          </span>
                          {e.agent && (
                            <span className="ml-auto font-mono text-[10px] text-faint">
                              {agentLabel(e.agent)}
                            </span>
                          )}
                          {e.apqc && (
                            <span className="chip text-[9px]">APQC {e.apqc}</span>
                          )}
                        </div>
                        {e.type === "agent.step" && e.output && (
                          <dl className="mt-2 space-y-1 pl-5">
                            {Object.entries(e.output as Record<string, unknown>)
                              .slice(0, 4)
                              .map(([k, v]) => (
                                <div key={k} className="flex gap-2 text-[11px]">
                                  <dt className="w-28 flex-none font-mono text-[9px] uppercase text-faint">
                                    {k.replace(/_/g, " ")}
                                  </dt>
                                  <dd className="truncate text-muted">
                                    {typeof v === "object"
                                      ? JSON.stringify(v)
                                      : String(v)}
                                  </dd>
                                </div>
                              ))}
                          </dl>
                        )}
                      </li>
                    ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Trends Panel ─────────────────────────────────────────────────────────────

function TrendsPanel() {
  const [data, setData] = useState<TrendMetrics | null>(null);

  useEffect(() => {
    getMetrics().then(setData).catch(() => null);
  }, []);

  if (!data) {
    return (
      <div className="flex h-48 items-center justify-center">
        <p className="text-sm text-faint">Loading metrics…</p>
      </div>
    );
  }

  const totalDecided = data.auto_approved + data.human_approved + data.rejected;
  const autoRate =
    totalDecided > 0 ? Math.round((data.auto_approved / totalDecided) * 100) : 0;
  const approvalRate =
    totalDecided > 0
      ? Math.round(((data.auto_approved + data.human_approved) / totalDecided) * 100)
      : 0;

  const domainMax = Math.max(...data.domains.map((d) => d.count), 1);

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card relative overflow-hidden px-5 py-4">
          <span className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-techm to-transparent" />
          <p className="eyebrow">Total Tickets</p>
          <p className="kpi-number mt-2">{data.total_tickets}</p>
          <p className="mt-1 text-[11px] text-faint">{data.awaiting} awaiting</p>
        </div>
        <div className="card relative overflow-hidden px-5 py-4">
          <span className="absolute inset-x-0 top-0 h-[3px] bg-ok" />
          <p className="eyebrow text-ok">Approval Rate</p>
          <p className="kpi-number mt-2 text-ok">{approvalRate}%</p>
          <p className="mt-1 text-[11px] text-faint">
            {data.auto_approved} auto · {data.human_approved} human
          </p>
        </div>
        <div className="card relative overflow-hidden px-5 py-4">
          <span className="absolute inset-x-0 top-0 h-[3px] bg-techm" />
          <p className="eyebrow text-techm">Automation Rate</p>
          <p className="kpi-number mt-2 text-techm">{autoRate}%</p>
          <p className="mt-1 text-[11px] text-faint">resolved without human</p>
        </div>
        <div className="card relative overflow-hidden px-5 py-4">
          <span className="absolute inset-x-0 top-0 h-[3px] bg-info" />
          <p className="eyebrow">Total Claim Cost</p>
          <p className="kpi-number mt-2">
            ₹{data.total_claim_cost.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
          </p>
          {data.avg_confidence !== null && (
            <p className="mt-1 text-[11px] text-faint">
              avg AI confidence {Math.round(data.avg_confidence * 100)}%
            </p>
          )}
        </div>
      </div>

      {/* Domain breakdown */}
      <div className="card overflow-hidden">
        <div className="border-b border-line bg-raised px-5 py-3">
          <p className="eyebrow">Domain Breakdown</p>
        </div>
        <div className="divide-y divide-line">
          {data.domains.map((d) => {
            const dc = getDomainColors(d.domain);
            const barPct = Math.round((d.count / domainMax) * 100);
            const approvalPct =
              d.count > 0 ? Math.round((d.approved / d.count) * 100) : 0;
            return (
              <div key={d.domain} className="flex items-center gap-4 px-5 py-3">
                <span className={`${dc.badge} w-20 text-center`}>{d.domain}</span>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-mono tabular-nums text-ink font-semibold">
                      {d.count} tickets
                    </span>
                    <span className="text-faint">
                      <span className="text-ok">{d.approved} approved</span>
                      {d.rejected > 0 && (
                        <span className="ml-2 text-danger">{d.rejected} rejected</span>
                      )}
                    </span>
                  </div>
                  <div className="conf-bar-track">
                    <div
                      className={`conf-bar-fill ${dc.stripe}`}
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                </div>
                <div className="w-24 text-right">
                  <p className="font-mono text-xs font-bold text-ok">{approvalPct}%</p>
                  <p className="font-mono text-[9px] text-faint">approval</p>
                </div>
                <div className="w-28 text-right">
                  <p className="font-mono text-xs text-muted">
                    {d.avg_cost !== null
                      ? `₹${d.avg_cost.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
                      : "—"}
                  </p>
                  <p className="font-mono text-[9px] text-faint">avg claim</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Secondary stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card px-4 py-3.5">
          <p className="eyebrow text-warn">Awaiting</p>
          <p className="kpi-number mt-1.5 text-warn">{data.awaiting}</p>
        </div>
        <div className="card px-4 py-3.5">
          <p className="eyebrow text-danger">Failed Runs</p>
          <p className="kpi-number mt-1.5 text-danger">{data.failed}</p>
        </div>
        <div className="card px-4 py-3.5">
          <p className="eyebrow">Rejected</p>
          <p className="kpi-number mt-1.5">{data.rejected}</p>
        </div>
        <div className="card px-4 py-3.5">
          <p className="eyebrow text-ok">Auto-finalized</p>
          <p className="kpi-number mt-1.5 text-ok">{data.auto_approved}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Transfers Tab ────────────────────────────────────────────────────────────

function TransfersTab({
  transfers,
  transferBusy,
  onApprove,
  onReject,
}: {
  transfers: VINTransfer[];
  transferBusy: string | null;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const pending = transfers.filter((x) => x.status === "pending");
  const resolved = transfers.filter((x) => x.status !== "pending");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="eyebrow">Pending Vehicle Ownership Transfers</p>
        {pending.length > 0 && (
          <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-techm px-1.5 font-mono text-[10px] font-bold text-white">
            {pending.length}
          </span>
        )}
      </div>

      {pending.length === 0 ? (
        <div className="card flex flex-col items-center justify-center gap-2 py-12 text-center">
          <span className="text-3xl text-faint">✓</span>
          <p className="text-sm text-faint">No pending transfers. Queue is clear.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pending.map((tr) => (
            <div key={tr.id} className="card p-5">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                {/* VIN + info */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-base font-bold tracking-wider text-ink">
                      {tr.vin}
                    </span>
                    <span className="chip text-[9px] border-warn/40 text-warn">pending</span>
                  </div>
                  <p className="text-[13px] text-muted">
                    Requested by{" "}
                    <span className="font-medium text-ink">{tr.requester_name}</span>{" "}
                    <span className="text-faint">&lt;{tr.requester_email}&gt;</span>
                  </p>
                  <p className="font-mono text-[10px] text-faint">
                    Submitted {relTime(tr.requested_at)} ·{" "}
                    {new Date(tr.requested_at).toLocaleString("en-IN", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </p>
                  {tr.rc_attachment_id && (
                    <a
                      href={`${API_BASE}/api/v1/intake/attachments/${tr.rc_attachment_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-[10px] text-techm underline underline-offset-2 hover:text-techm-deep"
                    >
                      ↗ View RC Document
                    </a>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2 flex-none">
                  <button
                    disabled={transferBusy === tr.id}
                    onClick={() => onApprove(tr.id)}
                    className="rounded-xl border border-ok/40 bg-ok-soft px-4 py-2 text-xs font-bold text-ok transition hover:bg-ok/10 disabled:opacity-50"
                  >
                    ✓ Approve Transfer
                  </button>
                  <button
                    disabled={transferBusy === tr.id}
                    onClick={() => onReject(tr.id)}
                    className="rounded-xl border border-danger/40 bg-danger-soft px-4 py-2 text-xs font-bold text-danger transition hover:bg-danger/10 disabled:opacity-50"
                  >
                    ✕ Reject
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {resolved.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer select-none text-xs text-faint hover:text-muted">
            Resolved transfers ({resolved.length})
          </summary>
          <div className="mt-2 space-y-1.5">
            {resolved.map((tr) => (
              <div
                key={tr.id}
                className="card flex items-center justify-between gap-3 px-4 py-2.5 opacity-60"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-ink">{tr.vin}</span>
                  <span className="text-[11px] text-faint">
                    {tr.requester_name} ·{" "}
                    {new Date(tr.requested_at).toLocaleDateString("en-IN")}
                  </span>
                </div>
                <span
                  className={`chip text-[9px] ${
                    tr.status === "approved"
                      ? "border-ok/40 text-ok"
                      : "border-danger/40 text-danger"
                  }`}
                >
                  {tr.status}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ManagerPortal() {
  const { session, ready } = useAuth(["manager"]);

  // Core state
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"queue" | "audit" | "monitor" | "trends" | "transfers">(
    "queue",
  );

  // Transfers state
  const [transfers, setTransfers] = useState<VINTransfer[]>([]);
  const [transferBusy, setTransferBusy] = useState<string | null>(null);

  // Queue filter / search
  const [queueFilter, setQueueFilter] = useState<"all" | "awaiting" | "resolved">("all");
  const [queueSearch, setQueueSearch] = useState("");

  // ── Data fetching ──

  const refreshTransfers = useCallback(async () => {
    try {
      setTransfers(await listTransfers());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refreshTransfers();
    const id = setInterval(refreshTransfers, 5000);
    return () => clearInterval(id);
  }, [refreshTransfers]);

  const refresh = useCallback(async () => {
    try {
      setTickets(await listTickets());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  // ── Derived state ──

  const queue = tickets.filter((t) => t.status === "awaiting_approval");
  const done = tickets.filter((t) =>
    ["resolved", "rejected", "escalated"].includes(t.status),
  );
  const autoApproved = tickets.filter(
    (t) => t.status === "resolved" && t.human_decision === null,
  ).length;
  const humanApproved = done.filter((t) => t.human_decision === "approve").length;
  const rejected = done.filter(
    (t) => t.status === "rejected" || t.human_decision === "reject",
  ).length;
  const avgConf =
    tickets.length > 0
      ? Math.round(
          (tickets.reduce((a, t) => a + (t.recommendation?.confidence ?? 0), 0) /
            tickets.length) *
            100,
        )
      : 0;

  const selected = tickets.find((t) => t.id === selectedId) ?? null;

  // ── Filtered ticket list ──

  const filteredTickets = tickets.filter((t) => {
    const matchesFilter =
      queueFilter === "all"
        ? true
        : queueFilter === "awaiting"
        ? t.status === "awaiting_approval"
        : ["resolved", "rejected", "escalated"].includes(t.status);

    const matchesSearch =
      !queueSearch ||
      t.summary.toLowerCase().includes(queueSearch.toLowerCase()) ||
      (t.vehicle_vin ?? "").toLowerCase().includes(queueSearch.toLowerCase()) ||
      (t.domain ?? "").toLowerCase().includes(queueSearch.toLowerCase());

    return matchesFilter && matchesSearch;
  });

  // ── Actions ──

  const decide = async (d: "approve" | "reject" | "escalate") => {
    if (!selected) return;
    setBusy(true);
    try {
      await decideTicket(selected.id, d, session?.name ?? "manager");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const handleApproveTransfer = async (id: string) => {
    setTransferBusy(id);
    try {
      await approveTransfer(id);
      await refreshTransfers();
    } finally {
      setTransferBusy(null);
    }
  };

  const handleRejectTransfer = async (id: string) => {
    setTransferBusy(id);
    try {
      await rejectTransfer(id);
      await refreshTransfers();
    } finally {
      setTransferBusy(null);
    }
  };

  const pendingTransferCount = transfers.filter((x) => x.status === "pending").length;

  // ── Loading guard ──

  if (!ready || !session) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <span className="dot dot-live h-3 w-3" />
          <p className="font-mono text-xs text-faint">Authenticating…</p>
        </div>
      </main>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <Shell title="Manager Command Center" session={session}>
      <div className="rise flex flex-col gap-5">
        {/* ── KPI Strip ── */}
        <div className="grid grid-cols-3 gap-2.5 lg:grid-cols-6">
          {/* Total */}
          <div className="card relative overflow-hidden px-4 py-3">
            <span className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-techm to-transparent" />
            <p className="eyebrow">Total</p>
            <p className="mt-1.5 font-display text-2xl font-bold tabular-nums text-ink leading-none">
              {tickets.length}
            </p>
            <p className="mt-1 text-[10px] text-faint">all time</p>
          </div>

          {/* Awaiting */}
          <div
            className={`card relative overflow-hidden px-4 py-3 transition ${
              queue.length > 0
                ? "border-techm/50 shadow-[0_0_0_1px_var(--techm-soft),var(--shadow)]"
                : ""
            }`}
          >
            <span
              className={`absolute inset-x-0 top-0 h-[3px] ${
                queue.length > 0 ? "bg-techm" : "bg-line"
              }`}
            />
            <p className={`eyebrow ${queue.length > 0 ? "text-techm" : ""}`}>Awaiting</p>
            <p
              className={`mt-1.5 font-display text-2xl font-bold tabular-nums leading-none ${
                queue.length > 0 ? "text-techm" : "text-ink"
              }`}
            >
              {queue.length}
            </p>
            <p className="mt-1 text-[10px] text-faint">needs decision</p>
          </div>

          {/* Auto-approved */}
          <div className="card relative overflow-hidden px-4 py-3">
            <span className="absolute inset-x-0 top-0 h-[3px] bg-ok/60" />
            <p className="eyebrow">Auto-approved</p>
            <p className="mt-1.5 font-display text-2xl font-bold tabular-nums leading-none text-ink">
              {autoApproved}
            </p>
            <p className="mt-1 text-[10px] text-faint">no human needed</p>
          </div>

          {/* Human-approved */}
          <div className="card relative overflow-hidden px-4 py-3">
            <span className="absolute inset-x-0 top-0 h-[3px] bg-ok" />
            <p className="eyebrow text-ok">Human-approved</p>
            <p className="mt-1.5 font-display text-2xl font-bold tabular-nums leading-none text-ok">
              {humanApproved}
            </p>
            <p className="mt-1 text-[10px] text-faint">by manager</p>
          </div>

          {/* Rejected */}
          <div className="card relative overflow-hidden px-4 py-3">
            <span className="absolute inset-x-0 top-0 h-[3px] bg-danger/60" />
            <p className="eyebrow">Rejected</p>
            <p className="mt-1.5 font-display text-2xl font-bold tabular-nums leading-none text-ink">
              {rejected}
            </p>
            <p className="mt-1 text-[10px] text-faint">declined</p>
          </div>

          {/* Avg confidence */}
          <div className="card relative overflow-hidden px-4 py-3">
            <span className="absolute inset-x-0 top-0 h-[3px] bg-info/60" />
            <p className="eyebrow">Avg Confidence</p>
            <p className="mt-1.5 font-display text-2xl font-bold tabular-nums leading-none text-ink">
              {avgConf}%
            </p>
            <p className="mt-1 text-[10px] text-faint">AI certainty</p>
          </div>
        </div>

        {/* ── Tab Bar ── */}
        <div className="flex items-end gap-0 border-b border-line">
          {(["queue", "monitor", "trends", "transfers", "audit"] as const).map((t) => {
            const LABELS: Record<string, string> = {
              queue:     "Approval Queue",
              monitor:   "Agent Monitor",
              trends:    "Performance",
              transfers: "Transfers",
              audit:     "Audit Log",
            };
            const isActive = tab === t;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`relative flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium transition-all duration-150 ${
                  isActive
                    ? "text-ink"
                    : "text-muted hover:text-ink"
                }`}
              >
                {isActive && (
                  <span className="absolute inset-x-0 bottom-0 h-[2px] bg-techm rounded-t" />
                )}
                {LABELS[t]}
                {t === "transfers" && pendingTransferCount > 0 && (
                  <span className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-techm px-1 font-mono text-[9px] font-bold text-white">
                    {pendingTransferCount}
                  </span>
                )}
                {t === "queue" && queue.length > 0 && (
                  <span className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-warn/80 px-1 font-mono text-[9px] font-bold text-white">
                    {queue.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Tab Content ── */}

        {tab === "queue" && (
          <div
            className="flex overflow-hidden rounded-2xl border border-line bg-surface"
            style={{ height: "calc(100vh - 18rem)" }}
          >
            {/* ── Left: Ticket List ── */}
            <div className="flex w-80 flex-none flex-col border-r border-line">
              {/* Search + filter */}
              <div className="flex-none space-y-2.5 border-b border-line p-3">
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint text-xs">
                    ⌕
                  </span>
                  <input
                    type="text"
                    placeholder="Search tickets…"
                    value={queueSearch}
                    onChange={(e) => setQueueSearch(e.target.value)}
                    className="field w-full py-2 pl-7 pr-3 text-[12px]"
                  />
                </div>
                <div className="flex gap-1">
                  {(["all", "awaiting", "resolved"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setQueueFilter(f)}
                      className={`flex-1 rounded-lg py-1.5 text-[11px] font-medium transition capitalize ${
                        queueFilter === f
                          ? "bg-techm text-white"
                          : "border border-line text-faint hover:border-line-strong hover:text-muted"
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {/* Ticket list */}
              <div className="flex-1 overflow-y-auto">
                {filteredTickets.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                    <span className="text-2xl text-faint">◌</span>
                    <p className="text-xs text-faint">
                      {queueSearch ? "No matching tickets." : "No tickets yet."}
                    </p>
                  </div>
                ) : (
                  filteredTickets.map((t) => {
                    const dc = getDomainColors(t.domain);
                    const isActive = selectedId === t.id;
                    const rec = t.recommendation;
                    const confPct = rec ? Math.round((rec.confidence ?? 0) * 100) : null;

                    return (
                      <button
                        key={t.id}
                        onClick={() => setSelectedId(t.id)}
                        className={`group relative w-full border-b border-line px-0 py-0 text-left transition last:border-0 ${
                          isActive
                            ? "bg-techm-soft/30"
                            : "hover:bg-raised"
                        }`}
                      >
                        {/* Domain stripe */}
                        <span
                          className={`absolute inset-y-0 left-0 w-[3px] rounded-r ${dc.stripe}`}
                        />
                        {/* Active indicator */}
                        {isActive && (
                          <span className="absolute inset-y-0 right-0 w-[2px] bg-techm" />
                        )}

                        <div className="px-4 py-3 pl-5">
                          {/* Top row */}
                          <div className="flex items-center gap-1.5">
                            <span className={dc.badge}>{t.domain ?? "—"}</span>
                            <span
                              className={`ml-auto chip text-[9px] ${
                                STATUS_CHIPS[t.status] ?? "border-line text-faint"
                              }`}
                            >
                              {t.status === "awaiting_approval" ? "pending" : t.status}
                            </span>
                          </div>

                          {/* Summary */}
                          <p className="mt-1.5 line-clamp-2 text-[12px] font-medium leading-snug text-ink">
                            {t.summary}
                          </p>

                          {/* Bottom row */}
                          <div className="mt-2 flex items-center gap-2">
                            {t.vehicle_vin && (
                              <span className="font-mono text-[9px] text-faint">
                                {t.vehicle_vin}
                              </span>
                            )}
                            {confPct !== null && rec && (
                              <span
                                className={`ml-auto text-[9px] font-bold font-mono ${
                                  DECISION_COLORS[rec.decision] ?? "text-muted"
                                }`}
                              >
                                {DECISION_ICONS[rec.decision]}{" "}
                                {confPct}%
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              {/* List footer */}
              <div className="flex-none border-t border-line px-3 py-2">
                <p className="font-mono text-[9px] text-faint">
                  {filteredTickets.length} of {tickets.length} tickets
                </p>
              </div>
            </div>

            {/* ── Right: Detail Panel ── */}
            <div className="flex min-w-0 flex-1 flex-col bg-bg/40">
              {selected ? (
                <TicketDetailPanel
                  ticket={selected}
                  onDecide={decide}
                  onClaimUpdate={refresh}
                  busy={busy}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
                  <div className="rounded-2xl border border-dashed border-line p-8">
                    <p className="font-display text-4xl text-line">⊡</p>
                    <p className="mt-3 text-sm font-medium text-muted">
                      Select a ticket to review
                    </p>
                    <p className="mt-1 text-[12px] text-faint">
                      AI reasoning, claim details, and decision controls will appear here.
                    </p>
                    {queue.length > 0 && (
                      <button
                        onClick={() => setSelectedId(queue[0].id)}
                        className="mt-4 rounded-xl bg-techm px-4 py-2 text-xs font-semibold text-white transition hover:opacity-90"
                      >
                        Review oldest pending ({queue.length})
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "monitor" && (
          <div className="mt-1">
            <AgentMonitor tickets={tickets} />
          </div>
        )}

        {tab === "trends" && (
          <div className="mt-1">
            <TrendsPanel />
          </div>
        )}

        {tab === "transfers" && (
          <div className="mt-1">
            <TransfersTab
              transfers={transfers}
              transferBusy={transferBusy}
              onApprove={handleApproveTransfer}
              onReject={handleRejectTransfer}
            />
          </div>
        )}

        {tab === "audit" && (
          <div className="mt-1">
            <AuditLog />
          </div>
        )}
      </div>
    </Shell>
  );
}
