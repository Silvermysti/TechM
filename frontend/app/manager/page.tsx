"use client";

import { useCallback, useEffect, useState } from "react";
import { Header } from "@/components/Header";
import { decideTicket, listTickets } from "@/lib/api";
import type { AgentOutput, Ticket } from "@/lib/types";

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
      <p className="text-3xl font-bold tracking-tight">{value}</p>
      <p className="mt-1 text-sm text-slate-400">{label}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

const DECISION_COLORS: Record<string, string> = {
  approve: "text-emerald-300",
  reject: "text-red-300",
  escalate: "text-amber-300",
};

function ReasoningChain({ trace }: { trace: AgentOutput[] }) {
  return (
    <ol className="space-y-3">
      {trace.map((step, i) => (
        <li key={i} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-[10px]">
              {i + 1}
            </span>
            <span className="text-sm font-medium">{step.agent}</span>
            {step.apqc && (
              <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                APQC {step.apqc}
              </span>
            )}
          </div>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs text-slate-400">
            {JSON.stringify(step.output, null, 2)}
          </pre>
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
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold">{ticket.summary}</h3>
          <p className="mt-1 text-xs text-slate-400">
            {ticket.domain} · VIN {ticket.vehicle_vin} · #{ticket.id.slice(0, 8)}
          </p>
        </div>
        {rec && (
          <span
            className={`rounded-full bg-slate-800 px-3 py-1 text-sm font-medium capitalize ${
              DECISION_COLORS[rec.decision] ?? "text-slate-300"
            }`}
          >
            AI: {rec.decision} ({Math.round((rec.confidence ?? 0) * 100)}%)
          </span>
        )}
      </div>

      {rec && (
        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
          <p className="text-sm text-slate-300">{rec.reasoning}</p>
          {rec.draft_email && (
            <>
              <p className="mt-3 text-xs uppercase tracking-wider text-slate-500">
                Draft customer email
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-400">
                {rec.draft_email}
              </p>
            </>
          )}
        </div>
      )}

      <p className="mt-5 text-xs uppercase tracking-wider text-slate-500">
        AI reasoning chain
      </p>
      <div className="mt-2">
        {ticket.agent_trace && ticket.agent_trace.length > 0 ? (
          <ReasoningChain trace={ticket.agent_trace} />
        ) : (
          <p className="text-sm text-slate-500">No trace recorded.</p>
        )}
      </div>

      {ticket.status === "awaiting_approval" ? (
        <div className="mt-6 flex gap-3">
          <button
            onClick={() => onDecide("approve")}
            disabled={busy}
            className="flex-1 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-medium text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
          >
            ✓ Approve
          </button>
          <button
            onClick={() => onDecide("reject")}
            disabled={busy}
            className="flex-1 rounded-xl border border-red-500/50 px-4 py-2.5 text-sm font-medium text-red-300 transition hover:bg-red-500/10 disabled:opacity-50"
          >
            Reject
          </button>
          <button
            onClick={() => onDecide("escalate")}
            disabled={busy}
            className="flex-1 rounded-xl border border-amber-500/50 px-4 py-2.5 text-sm font-medium text-amber-300 transition hover:bg-amber-500/10 disabled:opacity-50"
          >
            Escalate
          </button>
        </div>
      ) : (
        <p className="mt-6 text-sm text-slate-400">
          Resolved with decision:{" "}
          <span className="capitalize text-slate-200">
            {ticket.human_decision ?? ticket.status}
          </span>
        </p>
      )}
    </div>
  );
}

export default function ManagerPortal() {
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
  const resolved = tickets.filter((t) =>
    ["resolved", "rejected", "escalated"].includes(t.status),
  );
  const avgConf =
    tickets.length > 0
      ? Math.round(
          (tickets.reduce(
            (a, t) => a + (t.recommendation?.confidence ?? 0),
            0,
          ) /
            tickets.length) *
            100,
        )
      : 0;

  const selected = tickets.find((t) => t.id === selectedId) ?? null;

  const decide = async (d: "approve" | "reject" | "escalate") => {
    if (!selected) return;
    setBusy(true);
    try {
      await decideTicket(selected.id, d);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Header title="Manager Command Center" accent="bg-red-500" />
      <main className="mx-auto w-full max-w-6xl px-6 py-8">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Kpi label="Tickets" value={String(tickets.length)} sub="all time" />
          <Kpi
            label="Needs attention"
            value={String(queue.length)}
            sub="awaiting approval"
          />
          <Kpi label="Resolved" value={String(resolved.length)} />
          <Kpi label="Avg AI confidence" value={`${avgConf}%`} />
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[380px_1fr]">
          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
              Needs your attention ({queue.length})
            </h2>
            <div className="space-y-2">
              {queue.length === 0 && (
                <p className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-500">
                  Nothing awaiting approval. Submit a request from the Customer
                  Portal.
                </p>
              )}
              {queue.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className={`w-full rounded-xl border p-4 text-left transition ${
                    selectedId === t.id
                      ? "border-cyan-500/60 bg-slate-900"
                      : "border-slate-800 bg-slate-900/40 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{t.summary}</span>
                    {t.recommendation && (
                      <span
                        className={`text-xs capitalize ${
                          DECISION_COLORS[t.recommendation.decision] ??
                          "text-slate-400"
                        }`}
                      >
                        {t.recommendation.decision}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {t.domain} · #{t.id.slice(0, 8)}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div>
            {selected ? (
              <DetailPanel ticket={selected} onDecide={decide} busy={busy} />
            ) : (
              <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-800 p-10 text-slate-500">
                Select a ticket to review the AI reasoning and decide.
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
