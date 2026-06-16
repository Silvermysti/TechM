"use client";

import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import {
  API_BASE,
  closeClaim,
  decideTicket,
  getClaim,
  getMetrics,
  listAudit,
  listTickets,
  payClaim,
  type TrendMetrics,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTicketStream, type SSEEvent } from "@/lib/useSSE";
import type { AgentOutput, AuditEntry, Claim, Ticket } from "@/lib/types";

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card relative overflow-hidden px-4 py-3.5">
      <span className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-techm to-transparent" />
      <p className="eyebrow">{label}</p>
      <p className="mt-1.5 font-display text-[1.7rem] font-bold leading-none tracking-tight text-ink tabular-nums">
        {value}
      </p>
      {sub && <p className="mt-1 text-[11px] text-faint">{sub}</p>}
    </div>
  );
}

const DECISION_COLORS: Record<string, string> = {
  approve: "text-ok",
  reject: "text-danger",
  escalate: "text-warn",
};

const DECISION_CHIPS: Record<string, string> = {
  approve: "border-ok/40 bg-ok-soft text-ok",
  reject: "border-danger/40 bg-danger-soft text-danger",
  escalate: "border-warn/40 bg-warn-soft text-warn",
};

const STATUS_CHIPS: Record<string, string> = {
  resolved: "border-ok/40 text-ok",
  rejected: "border-danger/40 text-danger",
  escalated: "border-warn/40 text-warn",
  awaiting_approval: "border-techm/40 text-techm",
};

const CLAIM_STATUS_CHIPS: Record<string, string> = {
  approved: "border-ok/40 bg-ok-soft text-ok",
  paid: "border-techm/40 bg-techm-soft text-techm",
  closed: "border-line text-faint",
  rejected: "border-danger/40 bg-danger-soft text-danger",
};

function ScoreBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone = value >= 0.6 ? "bg-danger" : value >= 0.3 ? "bg-warn" : "bg-ok";
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-line">
        <span className={`block h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="font-mono text-xs tabular-nums text-muted">{pct}%</span>
    </span>
  );
}

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
    if (scoreLike && value >= 0 && value <= 1) return <ScoreBar value={value} />;
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
    <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function StepOutput({ output }: { output: unknown }) {
  if (!output || typeof output !== "object") return null;
  return (
    <dl className="mt-3 space-y-2">
      {Object.entries(output as Record<string, unknown>).map(([k, v]) => (
        <div key={k} className="flex items-baseline gap-3 text-xs">
          <dt className="w-28 flex-none font-mono text-[10px] uppercase tracking-wider text-faint">
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

function ReasoningChain({ trace }: { trace: AgentOutput[] }) {
  return (
    <ol className="relative space-y-3 before:absolute before:bottom-3 before:left-[22px] before:top-3 before:w-px before:bg-line">
      {trace.map((step, i) => (
        <li key={i} className="relative rounded-xl border border-line bg-raised p-3.5 pl-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-6 w-6 flex-none items-center justify-center rounded-md bg-techm-soft font-mono text-[10px] font-semibold text-techm">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="text-sm font-semibold capitalize text-ink">
              {step.agent.replace(/_/g, " ")}
            </span>
            {step.apqc && <span className="chip ml-auto">APQC {step.apqc}</span>}
          </div>
          <StepOutput output={step.output} />
        </li>
      ))}
    </ol>
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
    <div className="mt-5 rounded-xl border border-ok/30 bg-ok-soft/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow text-ok">Warranty Claim</p>
          <p className="mt-0.5 font-mono text-[1.05rem] font-bold tracking-wider text-ink">
            {claim.claim_number}
          </p>
        </div>
        <span className={`chip ${CLAIM_STATUS_CHIPS[claim.status] ?? "border-line text-muted"}`}>
          {claim.status}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-line bg-surface px-3 py-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-faint">Labor</p>
          <p className="mt-0.5 font-mono text-sm font-semibold text-ink">
            ₹{claim.labor_cost.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-line bg-surface px-3 py-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-faint">Parts</p>
          <p className="mt-0.5 font-mono text-sm font-semibold text-ink">
            ₹{claim.parts_cost.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-techm/30 bg-techm-soft px-3 py-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-techm/70">Total</p>
          <p className="mt-0.5 font-mono text-sm font-bold text-techm">
            ₹{claim.total_cost.toLocaleString()}
          </p>
        </div>
      </div>

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

function DetailPanel({
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
  const rec = ticket.recommendation;
  return (
    <div className="frame card p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold tracking-tight text-ink">
            {ticket.summary}
          </h3>
          <p className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="chip">{ticket.domain}</span>
            <span className="chip">{ticket.vehicle_vin}</span>
            <span className="chip">#{ticket.id.slice(0, 8)}</span>
          </p>
        </div>
        {rec && (
          <span
            className={`chip flex-none !text-[0.72rem] font-semibold ${
              DECISION_CHIPS[rec.decision] ?? ""
            }`}
          >
            AI · {rec.decision} · {Math.round((rec.confidence ?? 0) * 100)}%
          </span>
        )}
      </div>

      {rec && (
        <div className="mt-4 rounded-xl border border-line bg-raised p-4">
          <p className="eyebrow">Recommendation</p>
          <p className="mt-1.5 text-sm leading-relaxed text-ink">{rec.reasoning}</p>
          {rec.draft_email && (
            <>
              <p className="eyebrow mt-4">Draft customer email</p>
              <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-muted">
                {rec.draft_email}
              </p>
            </>
          )}
        </div>
      )}

      {ticket.claim_id && (
        <ClaimPanel claimId={ticket.claim_id} onUpdate={onClaimUpdate} />
      )}

      {ticket.attachments && ticket.attachments.length > 0 && (
        <>
          <p className="eyebrow mt-5">
            Customer evidence ({ticket.attachments.length})
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {ticket.attachments.map((a) => (
              <a
                key={a.id}
                href={`${API_BASE}${a.url}`}
                target="_blank"
                rel="noreferrer"
                title={a.filename}
                className="group relative overflow-hidden rounded-lg border border-line transition hover:border-techm"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`${API_BASE}${a.url}`}
                  alt={a.filename}
                  className="h-24 w-24 object-cover transition group-hover:scale-105"
                />
              </a>
            ))}
          </div>
        </>
      )}

      <p className="eyebrow mt-5">AI reasoning chain</p>
      <div className="mt-2.5">
        {ticket.agent_trace && ticket.agent_trace.length > 0 ? (
          <ReasoningChain trace={ticket.agent_trace} />
        ) : (
          <p className="text-sm text-faint">No trace recorded.</p>
        )}
      </div>

      {ticket.status === "awaiting_approval" ? (
        <div className="mt-6 flex gap-3">
          <button
            onClick={() => onDecide("approve")}
            disabled={busy}
            className="flex-1 rounded-xl bg-ok px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            ✓ Approve
          </button>
          <button
            onClick={() => onDecide("reject")}
            disabled={busy}
            className="flex-1 rounded-xl border border-danger/50 px-4 py-2.5 text-sm font-medium text-danger transition hover:bg-danger-soft disabled:opacity-50"
          >
            Reject
          </button>
          <button
            onClick={() => onDecide("escalate")}
            disabled={busy}
            className="flex-1 rounded-xl border border-warn/50 px-4 py-2.5 text-sm font-medium text-warn transition hover:bg-warn-soft disabled:opacity-50"
          >
            Escalate
          </button>
        </div>
      ) : (
        <p className="mt-6 text-sm text-muted">
          Resolved with decision:{" "}
          <span className="font-semibold capitalize text-ink">
            {ticket.human_decision ?? ticket.status}
          </span>
        </p>
      )}
    </div>
  );
}

function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [filter, setFilter] = useState<"all" | "human" | "agent">("all");

  useEffect(() => {
    listAudit({ limit: 100, actor_type: filter === "all" ? undefined : filter })
      .then(setEntries)
      .catch(() => null);
  }, [filter]);

  const fmt = (ts: string) =>
    new Date(ts).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" });

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        {(["all", "human", "agent"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              filter === f
                ? "bg-techm text-white"
                : "border border-line text-muted hover:border-line-strong"
            }`}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="card overflow-hidden">
        {entries.length === 0 ? (
          <p className="p-4 text-sm text-faint">No audit entries yet.</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line bg-raised">
                <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-faint">Time</th>
                <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-faint">Actor</th>
                <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-faint">Action</th>
                <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-faint">Resource</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-line last:border-0 hover:bg-raised">
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-faint">
                    {fmt(e.timestamp)}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`chip text-[10px] ${
                      e.actor_type === "human"
                        ? "border-techm/30 text-techm"
                        : "border-line text-faint"
                    }`}>
                      {e.actor_type}
                    </span>
                    <span className="ml-2 truncate text-muted">{e.actor_id.split(":").pop()}</span>
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

function AgentMonitor({ tickets }: { tickets: Ticket[] }) {
  const [watchId, setWatchId] = useState<string | null>(null);
  const { events, reset } = useTicketStream(watchId);

  const recentTickets = tickets.slice(0, 8);

  const EVENT_LABELS: Record<string, string> = {
    "ticket.created": "Ticket created",
    "agent.started": "Agent pipeline started",
    "agent.step": "Agent step completed",
    "ticket.awaiting_approval": "Awaiting human approval",
    "ticket.resolved": "Ticket resolved",
    "done": "Stream complete",
  };

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[280px_1fr]">
      <div>
        <p className="eyebrow mb-2.5">Select a ticket to monitor</p>
        <div className="space-y-1.5">
          {recentTickets.length === 0 && (
            <p className="card p-4 text-sm text-faint">No tickets yet.</p>
          )}
          {recentTickets.map((t) => (
            <button
              key={t.id}
              onClick={() => { setWatchId(t.id); reset(); }}
              className={`card w-full px-3 py-2.5 text-left transition ${
                watchId === t.id ? "border-techm ring-1 ring-techm" : "hover:border-line-strong"
              }`}
            >
              <p className="truncate text-sm font-medium text-ink">{t.summary}</p>
              <p className="mt-0.5 font-mono text-[10px] text-faint">
                {t.domain} · #{t.id.slice(0, 8)}
              </p>
            </button>
          ))}
        </div>
      </div>

      <div>
        {!watchId ? (
          <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-line text-sm text-faint">
            Select a ticket to stream its agent activity
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="border-b border-line bg-raised px-4 py-2.5 flex items-center justify-between">
              <p className="font-mono text-xs text-muted">
                Streaming <span className="text-ink">#{watchId.slice(0, 8)}</span>
              </p>
              <span className="flex h-2 w-2 rounded-full bg-ok ring-2 ring-ok/30" />
            </div>
            {events.length === 0 ? (
              <p className="p-4 text-sm text-faint">Waiting for events…</p>
            ) : (
              <ol className="divide-y divide-line">
                {events.filter((e) => e.type !== "ping").map((e: SSEEvent, i) => (
                  <li key={i} className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className={`flex h-2 w-2 flex-none rounded-full ${
                        e.type === "done" ? "bg-ok" :
                        e.type.startsWith("ticket.") ? "bg-techm" : "bg-warn"
                      }`} />
                      <span className="text-sm font-medium text-ink">
                        {EVENT_LABELS[e.type] ?? e.type}
                      </span>
                      {e.agent && (
                        <span className="ml-auto font-mono text-[10px] text-faint">
                          {e.agent}
                        </span>
                      )}
                      {e.apqc && (
                        <span className="chip text-[10px]">APQC {e.apqc}</span>
                      )}
                    </div>
                    {e.type === "agent.step" && e.output && (
                      <dl className="mt-2 space-y-1 pl-4.5">
                        {Object.entries(e.output as Record<string, unknown>)
                          .slice(0, 4)
                          .map(([k, v]) => (
                            <div key={k} className="flex gap-2 text-xs">
                              <dt className="w-28 flex-none font-mono text-[10px] uppercase text-faint">
                                {k.replace(/_/g, " ")}
                              </dt>
                              <dd className="truncate text-muted">
                                {typeof v === "object" ? JSON.stringify(v) : String(v)}
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
        )}
      </div>
    </div>
  );
}

function TrendsPanel() {
  const [data, setData] = useState<TrendMetrics | null>(null);

  useEffect(() => {
    getMetrics().then(setData).catch(() => null);
  }, []);

  if (!data) {
    return <p className="mt-8 text-center text-sm text-faint">Loading metrics…</p>;
  }

  const totalDecided = data.auto_approved + data.human_approved + data.rejected;
  const autoRate = totalDecided > 0 ? Math.round((data.auto_approved / totalDecided) * 100) : 0;
  const approvalRate = totalDecided > 0
    ? Math.round(((data.auto_approved + data.human_approved) / totalDecided) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card px-4 py-3.5">
          <p className="eyebrow">Total tickets</p>
          <p className="mt-1 font-display text-2xl font-bold text-ink">{data.total_tickets}</p>
        </div>
        <div className="card px-4 py-3.5">
          <p className="eyebrow text-ok">Approval rate</p>
          <p className="mt-1 font-display text-2xl font-bold text-ok">{approvalRate}%</p>
          <p className="mt-1 text-[11px] text-faint">
            {data.auto_approved} auto · {data.human_approved} human
          </p>
        </div>
        <div className="card px-4 py-3.5">
          <p className="eyebrow text-techm">Automation rate</p>
          <p className="mt-1 font-display text-2xl font-bold text-techm">{autoRate}%</p>
          <p className="mt-1 text-[11px] text-faint">claims finalized without human</p>
        </div>
        <div className="card px-4 py-3.5">
          <p className="eyebrow">Total claim cost</p>
          <p className="mt-1 font-display text-2xl font-bold text-ink">
            ₹{data.total_claim_cost.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
          </p>
          {data.avg_confidence !== null && (
            <p className="mt-1 text-[11px] text-faint">
              avg confidence {Math.round(data.avg_confidence * 100)}%
            </p>
          )}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-line bg-raised px-4 py-2.5">
          <p className="eyebrow">Domain breakdown</p>
        </div>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line bg-raised">
              {["Domain", "Tickets", "Approved", "Rejected", "Avg Claim"].map((h) => (
                <th key={h} className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-faint">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.domains.map((d) => (
              <tr key={d.domain} className="border-b border-line last:border-0 hover:bg-raised">
                <td className="px-4 py-2.5">
                  <span className="chip capitalize">{d.domain}</span>
                </td>
                <td className="px-4 py-2.5 font-mono tabular-nums text-ink">{d.count}</td>
                <td className="px-4 py-2.5">
                  <span className="text-ok font-semibold">{d.approved}</span>
                  {d.count > 0 && (
                    <span className="ml-1.5 text-[11px] text-faint">
                      ({Math.round((d.approved / d.count) * 100)}%)
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <span className={d.rejected > 0 ? "text-danger font-semibold" : "text-faint"}>
                    {d.rejected}
                  </span>
                </td>
                <td className="px-4 py-2.5 font-mono tabular-nums text-muted">
                  {d.avg_cost !== null
                    ? `₹${d.avg_cost.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card px-4 py-3.5">
          <p className="eyebrow text-warn">Awaiting approval</p>
          <p className="mt-1 font-display text-2xl font-bold text-warn">{data.awaiting}</p>
        </div>
        <div className="card px-4 py-3.5">
          <p className="eyebrow text-danger">Failed runs</p>
          <p className="mt-1 font-display text-2xl font-bold text-danger">{data.failed}</p>
        </div>
        <div className="card px-4 py-3.5">
          <p className="eyebrow">Rejected</p>
          <p className="mt-1 font-display text-2xl font-bold text-ink">{data.rejected}</p>
        </div>
        <div className="card px-4 py-3.5">
          <p className="eyebrow text-ok">Auto-finalized</p>
          <p className="mt-1 font-display text-2xl font-bold text-ok">{data.auto_approved}</p>
        </div>
      </div>
    </div>
  );
}

export default function ManagerPortal() {
  const { session, ready } = useAuth(["manager"]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"queue" | "audit" | "monitor" | "trends">("queue");

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

  const queue = tickets.filter((t) => t.status === "awaiting_approval");
  const done = tickets.filter((t) =>
    ["resolved", "rejected", "escalated"].includes(t.status),
  );
  const approved = done.filter((t) => t.human_decision === "approve").length;
  const avgConf =
    tickets.length > 0
      ? Math.round(
          (tickets.reduce((a, t) => a + (t.recommendation?.confidence ?? 0), 0) /
            tickets.length) *
            100,
        )
      : 0;

  const selected = tickets.find((t) => t.id === selectedId) ?? null;

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

  if (!ready || !session) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-faint">
        Loading…
      </main>
    );
  }

  return (
    <Shell title="Manager Command Center" session={session}>
      <div className="rise">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Kpi label="Tickets" value={String(tickets.length)} sub="all time" />
          <Kpi label="Needs attention" value={String(queue.length)} sub="awaiting approval" />
          <Kpi label="Resolved" value={String(done.length)} />
          <Kpi label="Approved" value={String(approved)} />
          <Kpi label="Avg AI confidence" value={`${avgConf}%`} />
        </div>

        <div className="mt-5 flex gap-1 border-b border-line">
          {(["queue", "monitor", "trends", "audit"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-medium transition ${
                tab === t
                  ? "border-b-2 border-techm text-techm"
                  : "text-muted hover:text-ink"
              }`}
            >
              {t === "queue" ? "Approval Queue"
                : t === "monitor" ? "Agent Monitor"
                : t === "trends" ? "Performance Trends"
                : "Audit Log"}
            </button>
          ))}
        </div>

        {tab === "audit" ? (
          <div className="mt-5">
            <AuditLog />
          </div>
        ) : tab === "monitor" ? (
          <div className="mt-5">
            <AgentMonitor tickets={tickets} />
          </div>
        ) : tab === "trends" ? (
          <div className="mt-5">
            <TrendsPanel />
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[360px_1fr]">
            <div>
              <h2 className="eyebrow mb-2.5">Approval queue ({queue.length})</h2>
              <div className="space-y-2">
                {queue.length === 0 && (
                  <p className="card p-4 text-sm text-faint">
                    Nothing awaiting approval. Submit a request from the Customer Portal.
                  </p>
                )}
                {queue.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedId(t.id)}
                    className={`card w-full px-4 py-3 text-left transition ${
                      selectedId === t.id
                        ? "border-techm ring-1 ring-techm"
                        : "hover:border-line-strong"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-ink">
                        {t.summary}
                      </span>
                      {t.recommendation && (
                        <span
                          className={`whitespace-nowrap font-mono text-[10px] font-semibold uppercase tracking-wider ${
                            DECISION_COLORS[t.recommendation.decision] ?? "text-muted"
                          }`}
                        >
                          {t.recommendation.decision}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-faint">
                      {t.domain} · #{t.id.slice(0, 8)}
                    </p>
                  </button>
                ))}
              </div>

              <h2 className="eyebrow mb-2.5 mt-6">Decision history ({done.length})</h2>
              <div className="card overflow-hidden">
                {done.length === 0 ? (
                  <p className="p-4 text-sm text-faint">No decisions yet.</p>
                ) : (
                  <table className="w-full text-left text-sm">
                    <tbody>
                      {done.slice(0, 10).map((t) => (
                        <tr
                          key={t.id}
                          onClick={() => setSelectedId(t.id)}
                          className="cursor-pointer border-b border-line transition last:border-0 hover:bg-raised"
                        >
                          <td className="max-w-0 truncate px-4 py-2.5 text-ink">
                            {t.summary}
                          </td>
                          <td className="w-px whitespace-nowrap px-4 py-2.5">
                            <span className={`chip ${STATUS_CHIPS[t.status] ?? ""}`}>
                              {t.human_decision ?? t.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div>
              {selected ? (
                <DetailPanel
                  ticket={selected}
                  onDecide={decide}
                  onClaimUpdate={refresh}
                  busy={busy}
                />
              ) : (
                <div className="flex h-full min-h-72 items-center justify-center rounded-2xl border border-dashed border-line p-10 text-center text-sm text-faint">
                  Select a ticket to review the AI reasoning and decide.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}
