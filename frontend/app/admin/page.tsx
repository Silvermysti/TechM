"use client";

import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { listAudit, listRecalls, triggerRecall } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { AuditEntry, Recall } from "@/lib/types";

function RecallRow({ recall, onTrigger }: { recall: Recall; onTrigger: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const handle = async () => {
    setBusy(true);
    try {
      await onTrigger(recall.id);
      setDone(true);
    } finally {
      setBusy(false);
    }
  };

  const severityColor =
    recall.affected_count >= 10 ? "text-danger" :
    recall.affected_count >= 5  ? "text-warn" : "text-ok";

  return (
    <tr className="border-b border-line last:border-0">
      <td className="px-4 py-3">
        <p className="font-mono text-xs font-semibold text-ink">{recall.code}</p>
        <p className="mt-0.5 text-xs text-muted">{recall.description.slice(0, 80)}</p>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-sm text-muted">
        {recall.model} {recall.year}
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <span className={`font-mono text-sm font-bold ${severityColor}`}>
          {recall.affected_count}
        </span>
        <span className="ml-1 text-xs text-faint">VINs</span>
      </td>
      <td className="px-4 py-3">
        <span className={`chip ${recall.status === "open" ? "border-warn/40 text-warn" : "border-line text-faint"}`}>
          {recall.status}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        {done ? (
          <span className="chip border-ok/40 text-ok">triggered</span>
        ) : (
          <button
            onClick={handle}
            disabled={busy || recall.status !== "open"}
            className="rounded-lg bg-techm px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "Running…" : "Trigger"}
          </button>
        )}
      </td>
    </tr>
  );
}

function AuditPanel() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "human" | "agent">("all");

  useEffect(() => {
    listAudit({ limit: 200, actor_type: filter === "all" ? undefined : filter })
      .then(setEntries)
      .catch(() => null);
  }, [filter]);

  const fmt = (ts: string) =>
    new Date(ts).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" });

  const filtered = entries.filter((e) =>
    !search ||
    e.action.includes(search) ||
    e.actor_id.includes(search) ||
    (e.resource_id ?? "").includes(search),
  );

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search action, actor, resource ID…"
          className="field flex-1 px-3 py-2 text-sm"
        />
        <div className="flex gap-1">
          {(["all", "human", "agent"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                filter === f ? "bg-techm text-white" : "border border-line text-muted hover:border-line-strong"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      <div className="card overflow-hidden">
        {filtered.length === 0 ? (
          <p className="p-4 text-sm text-faint">No entries found.</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line bg-raised">
                {["Time", "Actor", "Role", "Action", "Resource"].map((h) => (
                  <th key={h} className="px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-faint">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-b border-line last:border-0 hover:bg-raised">
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-faint">{fmt(e.timestamp)}</td>
                  <td className="max-w-[160px] truncate px-4 py-2.5 text-muted">
                    {e.actor_id.split(":").pop()}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`chip text-[10px] ${
                      e.actor_type === "human" ? "border-techm/30 text-techm" : "border-line text-faint"
                    }`}>{e.actor_type}</span>
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

export default function AdminConsole() {
  const { session, ready } = useAuth(["manager"]);
  const [recalls, setRecalls] = useState<Recall[]>([]);
  const [tab, setTab] = useState<"recalls" | "audit">("recalls");

  useEffect(() => {
    listRecalls().then(setRecalls).catch(() => null);
  }, []);

  const handleTrigger = async (id: string) => {
    await triggerRecall(id);
  };

  if (!ready || !session) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-faint">
        Loading…
      </main>
    );
  }

  return (
    <Shell title="Admin Console" session={session}>
      <div className="rise">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-3">
          <div className="card relative overflow-hidden px-4 py-3.5">
            <span className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-techm to-transparent" />
            <p className="eyebrow">Open Recalls</p>
            <p className="mt-1.5 font-display text-[1.7rem] font-bold leading-none text-ink">
              {recalls.filter((r) => r.status === "open").length}
            </p>
          </div>
          <div className="card relative overflow-hidden px-4 py-3.5">
            <span className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-warn to-transparent" />
            <p className="eyebrow">Affected VINs</p>
            <p className="mt-1.5 font-display text-[1.7rem] font-bold leading-none text-ink">
              {recalls.reduce((a, r) => a + r.affected_count, 0)}
            </p>
          </div>
          <div className="card relative overflow-hidden px-4 py-3.5">
            <span className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-ok to-transparent" />
            <p className="eyebrow">Domains Active</p>
            <p className="mt-1.5 font-display text-[1.7rem] font-bold leading-none text-ink">3</p>
            <p className="mt-1 text-[11px] text-faint">warranty · recall · parts</p>
          </div>
        </div>

        <div className="mt-5 flex gap-1 border-b border-line">
          {(["recalls", "audit"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-medium capitalize transition ${
                tab === t ? "border-b-2 border-techm text-techm" : "text-muted hover:text-ink"
              }`}
            >
              {t === "recalls" ? "Recall Management" : "Audit Log"}
            </button>
          ))}
        </div>

        <div className="mt-5">
          {tab === "recalls" ? (
            <div className="card overflow-hidden">
              {recalls.length === 0 ? (
                <p className="p-4 text-sm text-faint">No recalls on record.</p>
              ) : (
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-line bg-raised">
                      {["Recall", "Vehicle", "Affected", "Status", "Action"].map((h) => (
                        <th key={h} className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-faint">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {recalls.map((r) => (
                      <RecallRow key={r.id} recall={r} onTrigger={handleTrigger} />
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : (
            <AuditPanel />
          )}
        </div>
      </div>
    </Shell>
  );
}
