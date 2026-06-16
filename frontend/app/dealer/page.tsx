"use client";

import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { listParts, listTickets, type PartItem } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Ticket } from "@/lib/types";

function StockBadge({ qty }: { qty: number }) {
  if (qty === 0) return <span className="chip border-danger/40 bg-danger-soft text-danger">Out of stock</span>;
  if (qty <= 2) return <span className="chip border-warn/40 bg-warn-soft text-warn">Low — {qty}</span>;
  return <span className="chip border-ok/40 text-ok">{qty} in stock</span>;
}

function PartsPanel({ parts }: { parts: PartItem[] }) {
  const outOfStock = parts.filter((p) => p.stock_qty === 0).length;
  const lowStock = parts.filter((p) => p.stock_qty > 0 && p.stock_qty <= 2).length;

  return (
    <div>
      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="card px-4 py-3.5">
          <p className="eyebrow">Total SKUs</p>
          <p className="mt-1 font-display text-2xl font-bold text-ink">{parts.length}</p>
        </div>
        <div className="card px-4 py-3.5">
          <p className="eyebrow text-warn">Low Stock</p>
          <p className="mt-1 font-display text-2xl font-bold text-warn">{lowStock}</p>
        </div>
        <div className="card px-4 py-3.5">
          <p className="eyebrow text-danger">Out of Stock</p>
          <p className="mt-1 font-display text-2xl font-bold text-danger">{outOfStock}</p>
        </div>
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line bg-raised">
              {["Part", "SKU", "Component", "Status", "ETA", "Unit Price", "Supplier"].map((h) => (
                <th key={h} className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-faint">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {parts.map((p) => (
              <tr key={p.id} className={`border-b border-line last:border-0 ${p.stock_qty === 0 ? "bg-danger-soft/30" : ""}`}>
                <td className="px-4 py-2.5 font-medium text-ink">{p.part_name}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-faint">{p.sku}</td>
                <td className="px-4 py-2.5">
                  <span className="chip text-xs capitalize">{p.component}</span>
                </td>
                <td className="px-4 py-2.5"><StockBadge qty={p.stock_qty} /></td>
                <td className="px-4 py-2.5 text-muted">{p.eta_days}d</td>
                <td className="px-4 py-2.5 font-mono text-xs text-ink">
                  ₹{p.unit_price.toLocaleString()}
                </td>
                <td className="px-4 py-2.5 text-xs text-muted">{p.supplier || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OpenJobsPanel({ tickets }: { tickets: Ticket[] }) {
  const warranty = tickets.filter((t) => t.domain === "warranty");
  const inProgress = warranty.filter((t) =>
    ["under_review", "awaiting_approval"].includes(t.status),
  );
  const resolved = warranty.filter((t) => t.status === "resolved");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="card px-4 py-3.5">
          <p className="eyebrow">Warranty Jobs</p>
          <p className="mt-1 font-display text-2xl font-bold text-ink">{warranty.length}</p>
        </div>
        <div className="card px-4 py-3.5">
          <p className="eyebrow text-techm">In Progress</p>
          <p className="mt-1 font-display text-2xl font-bold text-techm">{inProgress.length}</p>
        </div>
        <div className="card px-4 py-3.5">
          <p className="eyebrow text-ok">Resolved</p>
          <p className="mt-1 font-display text-2xl font-bold text-ok">{resolved.length}</p>
        </div>
      </div>
      <div className="card overflow-hidden">
        {warranty.length === 0 ? (
          <p className="p-4 text-sm text-faint">No warranty jobs on record.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-raised">
                {["Summary", "VIN", "Component", "Status"].map((h) => (
                  <th key={h} className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-faint">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {warranty.slice(0, 20).map((t) => (
                <tr key={t.id} className="border-b border-line last:border-0 hover:bg-raised">
                  <td className="max-w-[240px] truncate px-4 py-2.5 text-ink">{t.summary}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-faint">{t.vehicle_vin ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    {t.classification && <span className="chip text-xs capitalize">{t.classification}</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`chip text-xs ${
                      t.status === "resolved" ? "border-ok/40 text-ok" :
                      t.status === "awaiting_approval" ? "border-techm/40 text-techm" :
                      "border-line text-muted"
                    }`}>
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
  );
}

export default function DealerPortal() {
  const { session, ready } = useAuth(["manager"]);
  const [parts, setParts] = useState<PartItem[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [tab, setTab] = useState<"jobs" | "parts">("jobs");

  useEffect(() => {
    listParts().then(setParts).catch(() => null);
    listTickets().then(setTickets).catch(() => null);
  }, []);

  if (!ready || !session) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-faint">
        Loading…
      </main>
    );
  }

  return (
    <Shell title="Dealer Portal" session={session}>
      <div className="rise">
        <div className="mt-0 flex gap-1 border-b border-line">
          {(["jobs", "parts"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-medium capitalize transition ${
                tab === t ? "border-b-2 border-techm text-techm" : "text-muted hover:text-ink"
              }`}
            >
              {t === "jobs" ? "Open Jobs" : "Parts Inventory"}
            </button>
          ))}
        </div>
        <div className="mt-5">
          {tab === "jobs" ? <OpenJobsPanel tickets={tickets} /> : <PartsPanel parts={parts} />}
        </div>
      </div>
    </Shell>
  );
}
