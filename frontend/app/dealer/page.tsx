"use client";

import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { listParts, listTickets, type PartItem } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Ticket } from "@/lib/types";

const STATUS_STYLES: Record<string, { dot: string; text: string; bg: string }> = {
  resolved:          { dot: "dot-ok",     text: "text-ok",      bg: "bg-ok-soft" },
  rejected:          { dot: "dot-danger", text: "text-danger",  bg: "bg-danger-soft" },
  awaiting_approval: { dot: "dot-info",   text: "text-info",    bg: "bg-info-soft" },
  under_review:      { dot: "dot-muted",  text: "text-muted",   bg: "bg-raised" },
  processing:        { dot: "dot-muted",  text: "text-muted",   bg: "bg-raised" },
  escalated:         { dot: "dot-warn",   text: "text-warn",    bg: "bg-warn-soft" },
};

function StockBar({ qty, max = 20 }: { qty: number; max?: number }) {
  const pct = Math.min((qty / max) * 100, 100);
  const color = qty === 0 ? "bg-danger" : qty <= 2 ? "bg-warn" : "bg-ok";
  return (
    <div className="flex items-center gap-2">
      <div className="conf-bar-track w-16">
        <div className={`conf-bar-fill ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-[11px] tabular-nums text-muted">{qty}</span>
    </div>
  );
}

function PartsPanel({ parts }: { parts: PartItem[] }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "low" | "out">("all");

  const outOfStock = parts.filter((p) => p.stock_qty === 0);
  const lowStock   = parts.filter((p) => p.stock_qty > 0 && p.stock_qty <= 2);

  const filtered = parts.filter((p) => {
    const matchSearch = !search || p.part_name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase());
    const matchFilter =
      filter === "all" ? true :
      filter === "out" ? p.stock_qty === 0 :
      p.stock_qty > 0 && p.stock_qty <= 2;
    return matchSearch && matchFilter;
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total SKUs",    value: parts.length,     accent: "from-faint/30", sub: "in catalogue" },
          { label: "Low Stock",     value: lowStock.length,  accent: "from-warn",     sub: "need reorder" },
          { label: "Out of Stock",  value: outOfStock.length, accent: outOfStock.length > 0 ? "from-danger" : "from-faint/30", sub: "unavailable" },
        ].map((s) => (
          <div
            key={s.label}
            className="relative overflow-hidden rounded-2xl border border-line bg-surface px-5 py-4"
            style={{ boxShadow: "var(--shadow)" }}
          >
            <span className={`absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r ${s.accent} to-transparent`} />
            <p className="eyebrow">{s.label}</p>
            <p className="kpi-number mt-2">{s.value}</p>
            <p className="mt-1 text-[11px] text-faint">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2.5">
        <div className="relative flex-1">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-3 top-1/2 -translate-y-1/2 text-faint">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search part name or SKU…"
            className="field w-full py-2 pl-9 pr-4 text-sm"
          />
        </div>
        <div className="flex gap-1">
          {(["all", "low", "out"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-2 text-xs font-medium capitalize transition ${
                filter === f ? "bg-techm text-white" : "border border-line text-muted hover:border-line-strong"
              }`}
            >
              {f === "all" ? "All" : f === "low" ? "Low stock" : "Out of stock"}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-surface" style={{ boxShadow: "var(--shadow)" }}>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <p className="text-sm text-muted">No parts match your filter</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-raised">
                  {["Part", "SKU", "Component", "Stock", "ETA (days)", "Unit Price", "Supplier"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-faint">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr
                    key={p.id}
                    className={`border-b border-line last:border-0 hover:bg-raised ${
                      p.stock_qty === 0 ? "bg-danger-soft/20" : ""
                    }`}
                  >
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-ink">{p.part_name}</span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-faint">{p.sku}</td>
                    <td className="px-4 py-2.5">
                      <span className="rounded-md border border-line px-2 py-0.5 font-mono text-[10px] capitalize text-muted">
                        {p.component}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {p.stock_qty === 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-danger-soft px-2 py-0.5 text-[10px] font-semibold text-danger">
                          Out of stock
                        </span>
                      ) : p.stock_qty <= 2 ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-warn-soft px-2 py-0.5 text-[10px] font-semibold text-warn">
                          Low — {p.stock_qty}
                        </span>
                      ) : (
                        <StockBar qty={p.stock_qty} />
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted">{p.eta_days}d</td>
                    <td className="px-4 py-2.5 font-mono text-xs font-medium text-ink">
                      ₹{p.unit_price.toLocaleString("en-IN")}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted">{p.supplier || "—"}</td>
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

function OpenJobsPanel({ tickets }: { tickets: Ticket[] }) {
  const [search, setSearch] = useState("");

  const warranty  = tickets.filter((t) => t.domain === "warranty");
  const inProgress = warranty.filter((t) => ["under_review", "awaiting_approval", "processing"].includes(t.status));
  const resolved  = warranty.filter((t) => t.status === "resolved");

  const filtered = warranty.filter(
    (t) =>
      !search ||
      t.summary.toLowerCase().includes(search.toLowerCase()) ||
      (t.vehicle_vin ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Warranty Jobs", value: warranty.length,    accent: "from-faint/30", sub: "total" },
          { label: "In Progress",   value: inProgress.length,  accent: inProgress.length > 0 ? "from-techm" : "from-faint/30", sub: "active" },
          { label: "Resolved",      value: resolved.length,    accent: resolved.length > 0 ? "from-ok" : "from-faint/30", sub: "completed" },
        ].map((s) => (
          <div
            key={s.label}
            className="relative overflow-hidden rounded-2xl border border-line bg-surface px-5 py-4"
            style={{ boxShadow: "var(--shadow)" }}
          >
            <span className={`absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r ${s.accent} to-transparent`} />
            <p className="eyebrow">{s.label}</p>
            <p className="kpi-number mt-2">{s.value}</p>
            <p className="mt-1 text-[11px] text-faint">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="relative">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-3 top-1/2 -translate-y-1/2 text-faint">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by summary or VIN…"
          className="field w-full py-2 pl-9 pr-4 text-sm"
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-surface" style={{ boxShadow: "var(--shadow)" }}>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <p className="text-sm text-muted">No warranty jobs found</p>
            <p className="mt-1 text-xs text-faint">
              {warranty.length === 0 ? "Submit a warranty claim to see it here" : "Try adjusting your search"}
            </p>
          </div>
        ) : (
          <div>
            {filtered.slice(0, 25).map((t, i) => {
              const style = STATUS_STYLES[t.status] ?? { dot: "dot-muted", text: "text-faint", bg: "bg-raised" };
              return (
                <div
                  key={t.id}
                  className={`flex items-start gap-4 px-4 py-3 transition hover:bg-raised ${
                    i < filtered.length - 1 ? "border-b border-line" : ""
                  }`}
                >
                  <span className={`dot mt-1.5 ${style.dot}`} />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-sm font-medium text-ink">{t.summary}</p>
                    <div className="mt-1 flex items-center gap-2">
                      {t.vehicle_vin && (
                        <span className="font-mono text-[10px] text-faint">{t.vehicle_vin}</span>
                      )}
                      {t.classification && (
                        <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[9px] capitalize text-faint">
                          {t.classification}
                        </span>
                      )}
                      {t.claim_number && (
                        <span className="font-mono text-[10px] text-techm">{t.claim_number}</span>
                      )}
                    </div>
                  </div>
                  <span
                    className={`flex-none rounded-md px-2 py-0.5 text-[10px] font-medium capitalize ${style.text} ${style.bg}`}
                  >
                    {t.status.replace(/_/g, " ")}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DealerPortal() {
  const { session, ready } = useAuth(["manager"]);
  const [parts,   setParts]   = useState<PartItem[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [tab, setTab] = useState<"jobs" | "parts">("jobs");

  useEffect(() => {
    listParts().then(setParts).catch(() => null);
    listTickets().then(setTickets).catch(() => null);
  }, []);

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

  return (
    <Shell title="Dealer Portal" session={session}>
      <div className="rise space-y-5">
        <div className="flex gap-0 border-b border-line">
          {(["jobs", "parts"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2.5 text-sm font-medium transition ${
                tab === t ? "border-b-2 border-techm text-techm" : "text-muted hover:text-ink"
              }`}
            >
              {t === "jobs" ? "Open Jobs" : "Parts Inventory"}
            </button>
          ))}
        </div>
        <div>
          {tab === "jobs" ? <OpenJobsPanel tickets={tickets} /> : <PartsPanel parts={parts} />}
        </div>
      </div>
    </Shell>
  );
}
