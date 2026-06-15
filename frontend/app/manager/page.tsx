"use client";

import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { API_BASE, decideTicket, listTickets } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { AgentOutput, Ticket } from "@/lib/types";

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

/** A 0..1 score rendered as a mini meter + percentage. */
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

/** Render one field of an agent's structured output, by type. */
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

function DetailPanel({
  ticket,
  onDecide,
  busy,
}: {
  ticket: Ticket;
  onDecide: (d: "approve" | "reject" | "escalate") => void;
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

export default function ManagerPortal() {
  const { session, ready } = useAuth(["manager"]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

        <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-[360px_1fr]">
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
              <DetailPanel ticket={selected} onDecide={decide} busy={busy} />
            ) : (
              <div className="flex h-full min-h-72 items-center justify-center rounded-2xl border border-dashed border-line p-10 text-center text-sm text-faint">
                Select a ticket to review the AI reasoning and decide.
              </div>
            )}
          </div>
        </div>
      </div>
    </Shell>
  );
}
