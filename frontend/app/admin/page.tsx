"use client";

import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { listAudit, listRecalls, triggerRecall } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { AuditEntry, Recall } from "@/lib/types";

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

function RecallCard({ recall, onTrigger }: { recall: Recall; onTrigger: (id: string) => Promise<void> }) {
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

  const severity =
    recall.affected_count >= 10
      ? { text: "text-danger", bg: "bg-danger-soft", label: "High" }
      : recall.affected_count >= 5
      ? { text: "text-warn",   bg: "bg-warn-soft",   label: "Medium" }
      : { text: "text-ok",     bg: "bg-ok-soft",     label: "Low" };

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border bg-surface transition ${
        recall.status === "open" ? "border-warn/30" : "border-line opacity-70"
      }`}
      style={{ boxShadow: "var(--shadow)" }}
    >
      {recall.status === "open" && (
        <span className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-warn to-transparent" />
      )}

      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold text-ink">{recall.code}</span>
              <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-mono font-medium uppercase tracking-wide ${severity.text} ${severity.bg}`}>
                {severity.label} severity
              </span>
            </div>
            <p className="mt-1.5 text-sm text-muted leading-relaxed">{recall.description}</p>
          </div>
          <div className="flex-none">
            {done ? (
              <div className="flex items-center gap-1.5 rounded-lg border border-ok/40 bg-ok-soft px-3 py-1.5 text-xs font-semibold text-ok">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Triggered
              </div>
            ) : (
              <button
                onClick={handle}
                disabled={busy || recall.status !== "open"}
                className="rounded-lg bg-techm px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-techm-deep disabled:opacity-40"
              >
                {busy ? "Running…" : "Trigger recall"}
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-faint font-mono uppercase text-[10px] tracking-wider">Vehicle</span>
            <span className="font-medium text-ink">{recall.model} {recall.year}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-faint font-mono uppercase text-[10px] tracking-wider">Component</span>
            <span className="font-medium text-ink">{recall.component}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-faint font-mono uppercase text-[10px] tracking-wider">Affected</span>
            <span className={`font-bold tabular-nums ${severity.text}`}>{recall.affected_count} VINs</span>
          </div>
          <div className="ml-auto">
            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
              recall.status === "open"
                ? "border-warn/40 text-warn"
                : "border-line text-faint"
            }`}>
              {recall.status}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function AuditPanel() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "human" | "agent">("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    listAudit({ limit: 200, actor_type: filter === "all" ? undefined : filter })
      .then(setEntries)
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [filter]);

  const fmt = (ts: string) =>
    new Date(ts).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" });

  const filtered = entries.filter(
    (e) =>
      !search ||
      e.action.includes(search) ||
      e.actor_id.includes(search) ||
      (e.resource_id ?? "").includes(search),
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5">
        <div className="relative flex-1">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-faint"
          >
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search action, actor ID, resource…"
            className="field w-full py-2 pl-9 pr-4 text-sm"
          />
        </div>
        <div className="flex gap-1">
          {(["all", "human", "agent"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-2 text-xs font-medium capitalize transition ${
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

      <div className="overflow-hidden rounded-2xl border border-line bg-surface" style={{ boxShadow: "var(--shadow)" }}>
        {loading ? (
          <div className="space-y-0">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex items-center gap-4 border-b border-line px-4 py-3">
                <div className="skeleton h-3 w-24" />
                <div className="skeleton h-3 w-32" />
                <div className="skeleton h-3 w-16" />
                <div className="skeleton h-3 w-28" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <p className="text-sm font-medium text-muted">No audit entries found</p>
            <p className="mt-1 text-xs text-faint">Try adjusting your search or filter</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line bg-raised">
                  {["Timestamp", "Actor", "Role", "Action", "Resource"].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-faint"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id} className="border-b border-line last:border-0 hover:bg-raised">
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <span className="font-mono text-[10px] text-faint">{fmt(e.timestamp)}</span>
                      <span className="ml-2 text-[10px] text-faint/60">{relTime(e.timestamp)}</span>
                    </td>
                    <td className="max-w-[140px] truncate px-4 py-2.5 text-muted">
                      {e.actor_id.split(":").pop()}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
                          e.actor_type === "human"
                            ? "bg-techm-soft text-techm"
                            : "bg-raised text-faint"
                        }`}
                      >
                        {e.actor_type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-ink">{e.action}</td>
                    <td className="px-4 py-2.5 font-mono text-[10px] text-faint">
                      {e.resource_id ? `#${e.resource_id.slice(0, 8)}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
      <main className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-faint">
          <span className="dot dot-live" />
          Loading…
        </div>
      </main>
    );
  }

  const openRecalls = recalls.filter((r) => r.status === "open");
  const totalAffected = recalls.reduce((a, r) => a + r.affected_count, 0);

  return (
    <Shell title="Admin Console" session={session}>
      <div className="rise space-y-5">

        {/* KPI row */}
        <div className="grid grid-cols-3 gap-3">
          {[
            {
              label: "Open Recalls",
              value: openRecalls.length,
              accent: openRecalls.length > 0 ? "from-warn" : "from-faint/30",
              sub: "requiring action",
            },
            {
              label: "Affected VINs",
              value: totalAffected,
              accent: totalAffected > 0 ? "from-danger" : "from-faint/30",
              sub: "across all recalls",
            },
            {
              label: "Domains Active",
              value: 3,
              accent: "from-ok",
              sub: "warranty · recall · parts",
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="relative overflow-hidden rounded-2xl border border-line bg-surface px-5 py-4"
              style={{ boxShadow: "var(--shadow)" }}
            >
              <span className={`absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r ${stat.accent} to-transparent`} />
              <p className="eyebrow">{stat.label}</p>
              <p className="kpi-number mt-2">{stat.value}</p>
              <p className="mt-1 text-[11px] text-faint">{stat.sub}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-line">
          {(["recalls", "audit"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2.5 text-sm font-medium transition ${
                tab === t
                  ? "border-b-2 border-techm text-techm"
                  : "text-muted hover:text-ink"
              }`}
            >
              {t === "recalls" ? "Recall Management" : "Audit Log"}
            </button>
          ))}
        </div>

        {/* Content */}
        <div>
          {tab === "recalls" ? (
            <div className="space-y-3">
              {recalls.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-line bg-surface px-6 py-12 text-center">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-raised">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-faint">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-muted">No recalls on record</p>
                  <p className="mt-1 text-xs text-faint">Seed the database to see recalls here</p>
                </div>
              ) : (
                recalls.map((r) => (
                  <RecallCard key={r.id} recall={r} onTrigger={handleTrigger} />
                ))
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
