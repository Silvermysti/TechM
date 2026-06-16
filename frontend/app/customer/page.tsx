"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Shell } from "@/components/Shell";
import { API_BASE, claimVIN, getTicket, listTickets, sendIntake, uploadIntakeImage, type VINClaimResult } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Ticket } from "@/lib/types";

type Msg = { role: "user" | "assistant"; content: string; images?: string[] };

const GREETING =
  "Hi! To process your request in one go, please include in your first message:\n" +
  "• which part is affected and what it's doing\n" +
  "• when the problem started\n" +
  "• your current odometer reading (km)\n\n" +
  "If the issue is visible — damage, a leak, a broken part, a warning light — " +
  "attach a photo with the 📎 button.";

const CATEGORIES = [
  { key: "warranty", code: "W-01", label: "Warranty Issue", hint: "Coverage, repairs, claims" },
  { key: "service", code: "S-02", label: "Service Booking", hint: "Schedule maintenance" },
  { key: "parts", code: "P-03", label: "Parts Query", hint: "Availability & orders" },
  { key: "recall", code: "R-04", label: "Recall Check", hint: "Safety notices" },
  { key: "register_vin", code: "V-05", label: "Register Vehicle", hint: "Add a new or second-hand car" },
];

const UPLOAD_HINTS: Record<string, string | null> = {
  warranty: "Photo of the broken/damaged part (optional — speeds up approval)",
  service: "Repair bill or diagnostic report (optional)",
  parts: "Invoice or part number label (optional)",
  recall: null,
  register_vin: "RC (Registration Certificate) — required if VIN is registered to someone else",
};

const STATUS_STEPS = [
  { keys: ["submitted", "under_review", "processing"], label: "Submitted" },
  { keys: ["awaiting_approval"], label: "Under Review" },
  { keys: ["resolved", "rejected", "escalated"], label: "Decision Made" },
];

const STATUS_CHIPS: Record<string, string> = {
  resolved: "border-ok/40 text-ok",
  rejected: "border-danger/40 text-danger",
  escalated: "border-warn/40 text-warn",
  awaiting_approval: "border-techm/40 text-techm",
  under_review: "border-line text-muted",
  processing: "border-line text-muted",
  failed: "border-danger/40 text-danger",
};

function StatusTracker({ ticketId }: { ticketId: string }) {
  const [ticket, setTicket] = useState<Ticket | null>(null);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const t = await getTicket(ticketId);
        if (active) setTicket(t);
      } catch {
        /* ignore transient errors */
      }
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [ticketId]);

  const status = ticket?.status ?? "submitted";
  const activeStep = STATUS_STEPS.findIndex((s) => s.keys.includes(status));

  return (
    <div className="card p-6 rise">
      <div className="flex items-center justify-between">
        <p className="eyebrow">Ticket {ticketId.slice(0, 8)}</p>
        <span className={`chip ${STATUS_CHIPS[status] ?? ""}`}>
          {status.replace(/_/g, " ")}
        </span>
      </div>
      <div className="mt-5 flex items-center">
        {STATUS_STEPS.map((s, i) => {
          const done = i <= activeStep;
          return (
            <div key={s.label} className="flex flex-1 items-center">
              <div className="flex flex-col items-center">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full border text-xs font-semibold transition ${
                    done
                      ? "border-techm bg-techm-soft text-techm"
                      : "border-line text-faint"
                  }`}
                >
                  {i + 1}
                </div>
                <span className={`mt-2 text-[11px] ${done ? "text-ink" : "text-faint"}`}>
                  {s.label}
                </span>
              </div>
              {i < STATUS_STEPS.length - 1 && (
                <div
                  className={`mx-2 h-0.5 flex-1 rounded-full ${
                    i < activeStep ? "bg-techm" : "bg-line"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {status === "failed" && (
        <p className="mt-5 text-sm text-danger">
          We encountered an issue processing your request. Please try submitting again or
          contact support.
        </p>
      )}
      {["resolved", "rejected", "escalated"].includes(status) && (
        <div className="mt-6 rounded-xl border border-line bg-raised p-4 space-y-3">
          <p className="text-sm font-medium text-ink">
            Outcome:{" "}
            <span className="font-semibold capitalize text-techm">
              {(ticket as Record<string, unknown>)?.decision as string ??
               (ticket as Record<string, unknown>)?.human_decision as string ?? status}
            </span>
          </p>
          {ticket?.claim_number && (
            <div className="flex items-center gap-3 rounded-lg border border-ok/30 bg-ok-soft px-4 py-2.5">
              <span className="text-xs font-mono text-ok font-semibold">CLAIM REF</span>
              <span className="font-mono text-sm font-bold text-ink tracking-wider">
                {ticket.claim_number}
              </span>
            </div>
          )}
          {((ticket as Record<string, unknown>)?.decision_message as string | undefined) && (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted">
              {(ticket as Record<string, unknown>).decision_message as string}
            </p>
          )}
        </div>
      )}
      {status === "awaiting_approval" && (
        <p className="mt-5 text-sm text-muted">
          Your request is with our team for final approval. We&apos;ll update this page the
          moment a decision is made.
        </p>
      )}
    </div>
  );
}

export default function CustomerPortal() {
  const { session, ready } = useAuth(["customer"]);
  const [category, setCategory] = useState<string | null>(null);
  const [vin, setVin] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [myTickets, setMyTickets] = useState<Ticket[]>([]);
  const [pending, setPending] = useState<File[]>([]);
  const [wantsImage, setWantsImage] = useState(false);

  // VIN registration state
  const [vinInput, setVinInput] = useState("");
  const [vinResult, setVinResult] = useState<VINClaimResult | null>(null);
  const [vinBusy, setVinBusy] = useState(false);
  const [vinRcId, setVinRcId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const sessionId = useRef<string>(
    typeof crypto !== "undefined" ? crypto.randomUUID() : String(Math.random()),
  );

  // Default the VIN to the customer's first vehicle once the session is known.
  useEffect(() => {
    if (session && session.vehicles.length > 0 && !vin) {
      setVin(session.vehicles[0].vin);
    }
  }, [session, vin]);

  const refreshMine = useCallback(async () => {
    if (!session?.customer_id) return;
    try {
      const all = await listTickets();
      setMyTickets(all.filter((t) => t.customer_id === session.customer_id));
    } catch {
      /* ignore */
    }
  }, [session?.customer_id]);

  useEffect(() => {
    refreshMine();
    const id = setInterval(refreshMine, 5000);
    return () => clearInterval(id);
  }, [refreshMine]);

  function relTime(ts: string | undefined): string {
    if (!ts) return "";
    const diff = Date.now() - new Date(ts).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

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

  const start = (cat: string) => {
    setCategory(cat);
    setTicketId(null);
    setPending([]);
    setWantsImage(false);
    setVinResult(null);
    setVinInput("");
    setVinRcId(null);
    if (cat !== "register_vin") {
      setMessages([{ role: "assistant", content: GREETING }]);
    }
  };

  const submitVinClaim = async () => {
    if (!vinInput.trim() || vinBusy) return;
    setVinBusy(true);
    setVinResult(null);
    try {
      const result = await claimVIN(vinInput.trim().toUpperCase(), vinRcId ?? undefined);
      setVinResult(result);
      if (result.status === "registered") refreshMine();
    } catch {
      setVinResult({ status: "transfer_requested", vin: vinInput.trim(), transfer_id: null });
    } finally {
      setVinBusy(false);
    }
  };

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const accepted = Array.from(list).filter(
      (f) => f.type.startsWith("image/") || f.type === "application/pdf",
    );
    setPending((p) => [...p, ...accepted].slice(0, 4));
  };

  const send = async () => {
    if ((!input.trim() && pending.length === 0) || busy) return;
    const text = input.trim() || "(photo attached)";
    const files = pending;
    setInput("");
    setPending([]);
    setWantsImage(false);
    setMessages((m) => [
      ...m,
      {
        role: "user",
        content: text,
        images: files.map((f) => URL.createObjectURL(f)),
      },
    ]);
    setBusy(true);
    try {
      const uploaded = await Promise.all(
        files.map((f) => uploadIntakeImage(sessionId.current, f)),
      );
      const reply = await sendIntake({
        session_id: sessionId.current,
        message: text,
        vin: vin || undefined,
        category: category || undefined,
        attachment_ids: uploaded.map((a) => a.id),
      });
      setMessages((m) => [...m, { role: "assistant", content: reply.reply }]);
      setWantsImage(Boolean(reply.request_image));
      if (reply.enough_info && reply.ticket_id) {
        setTicketId(reply.ticket_id);
        refreshMine();
      }
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `Sorry, something went wrong: ${e}` },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const DOMAIN_ACCENTS: Record<string, string> = {
    warranty: "from-techm",
    service:  "from-info",
    parts:    "from-process",
    recall:   "from-warn",
    register_vin: "from-ok",
  };

  const STATUS_DOT: Record<string, string> = {
    resolved:          "dot-ok",
    rejected:          "dot-danger",
    escalated:         "dot-warn",
    awaiting_approval: "dot-info",
    under_review:      "dot-muted",
    processing:        "dot-muted",
    failed:            "dot-danger",
  };

  return (
    <Shell title="Customer Portal" session={session}>
      <div className="rise grid grid-cols-1 gap-5 xl:grid-cols-[1fr_300px]">
        {/* ──────────── Main column ──────────── */}
        <div>

          {/* Category picker */}
          {!category && (
            <div>
              <p className="eyebrow">How can we help?</p>
              <h2 className="mt-1.5 font-display text-2xl font-bold tracking-tight text-ink">
                Start a request
              </h2>
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => start(c.key)}
                    className="group relative overflow-hidden rounded-2xl border border-line bg-surface p-5 text-left transition hover:-translate-y-0.5 hover:border-line-strong"
                    style={{ boxShadow: "var(--shadow)" }}
                  >
                    <span className={`absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r ${DOMAIN_ACCENTS[c.key] ?? "from-faint/30"} to-transparent opacity-70 transition group-hover:opacity-100`} />
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] tracking-[0.2em] text-faint transition group-hover:text-techm">
                        {c.code}
                      </span>
                      <span className="text-techm opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100">→</span>
                    </div>
                    <span className="mt-3 block font-semibold text-ink">{c.label}</span>
                    <p className="mt-0.5 text-xs text-muted">{c.hint}</p>
                    {c.key === "register_vin" && (
                      <span className="mt-2 inline-block rounded-md bg-ok-soft px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-ok">
                        New
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Category-active flow */}
          {category && !ticketId && (
            <div className="animate-fade-up space-y-4">
              {/* Header row */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setCategory(null)}
                  className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-line text-muted transition hover:border-techm hover:text-techm"
                  aria-label="Back"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M19 12H5M12 5l-7 7 7 7" />
                  </svg>
                </button>
                <div>
                  <p className="text-sm font-semibold text-ink">
                    {CATEGORIES.find((c) => c.key === category)?.label}
                  </p>
                  <p className="font-mono text-[10px] text-faint">
                    {CATEGORIES.find((c) => c.key === category)?.code}
                  </p>
                </div>
              </div>

              {/* ── VIN Registration ── */}
              {category === "register_vin" && (
                <div
                  className="overflow-hidden rounded-2xl border border-line bg-surface"
                  style={{ boxShadow: "var(--shadow)" }}
                >
                  <div className="border-b border-line bg-raised px-5 py-3">
                    <p className="text-sm font-semibold text-ink">Register a vehicle</p>
                    <p className="text-xs text-muted">Add a new or second-hand car to your account</p>
                  </div>
                  <div className="space-y-5 p-5">
                    <div>
                      <label className="eyebrow">Vehicle Identification Number (VIN)</label>
                      <input
                        value={vinInput}
                        onChange={(e) => setVinInput(e.target.value)}
                        placeholder="e.g. MA3DEMO00000SWIFT"
                        className="field mt-2 w-full px-4 py-3 font-mono text-sm tracking-widest"
                      />
                      <p className="mt-1.5 text-[11px] text-faint">
                        Found on your RC document, the dashboard (driver side), or the door jamb.
                      </p>
                    </div>

                    <div>
                      <label className="eyebrow">
                        RC Document{" "}
                        <span className="font-normal normal-case tracking-normal text-faint">
                          — required for ownership transfers
                        </span>
                      </label>
                      <div
                        className={`mt-2 rounded-xl border-2 border-dashed px-5 py-6 text-center transition ${
                          vinRcId
                            ? "border-ok/50 bg-ok-soft/20"
                            : "border-line hover:border-techm/40 hover:bg-techm-soft/10"
                        }`}
                      >
                        {vinRcId ? (
                          <div className="flex items-center justify-center gap-2.5 text-sm">
                            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ok-soft text-ok">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            </span>
                            <span className="font-medium text-ok">RC document uploaded</span>
                            <button
                              onClick={() => setVinRcId(null)}
                              className="ml-1 text-xs text-faint transition hover:text-danger"
                            >
                              Remove
                            </button>
                          </div>
                        ) : (
                          <div>
                            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-raised text-faint">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <polyline points="14 2 14 8 20 8" /><line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" />
                              </svg>
                            </div>
                            <p className="text-sm text-muted">Upload a photo or scan of your RC</p>
                            <label className="mt-2.5 inline-block cursor-pointer rounded-lg border border-line bg-surface px-4 py-1.5 text-xs font-medium text-muted shadow-sm transition hover:border-techm/50 hover:text-techm">
                              Choose file
                              <input
                                type="file"
                                accept="image/*,application/pdf"
                                className="hidden"
                                onChange={async (e) => {
                                  const f = e.target.files?.[0];
                                  if (!f || !session) return;
                                  try {
                                    const att = await uploadIntakeImage(sessionId.current, f);
                                    setVinRcId(att.id);
                                  } catch { /* ignore */ }
                                  e.target.value = "";
                                }}
                              />
                            </label>
                          </div>
                        )}
                      </div>
                    </div>

                    {vinResult && (
                      <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${
                        vinResult.status === "registered"
                          ? "border-ok/40 bg-ok-soft/50 text-ok"
                          : vinResult.status === "already_owned"
                          ? "border-warn/40 bg-warn-soft text-warn"
                          : "border-info/40 bg-info-soft text-info"
                      }`}>
                        <span className="mt-0.5 font-bold">
                          {vinResult.status === "registered" ? "✓" : vinResult.status === "already_owned" ? "!" : "→"}
                        </span>
                        <div>
                          {vinResult.status === "registered" && (
                            <>
                              <p className="font-semibold">Vehicle registered successfully.</p>
                              <p className="mt-0.5 text-xs opacity-80">You can now file warranty claims for {vinResult.vin}.</p>
                            </>
                          )}
                          {vinResult.status === "already_owned" && (
                            <p>This vehicle is already registered to your account.</p>
                          )}
                          {vinResult.status === "transfer_requested" && (
                            <>
                              <p className="font-semibold">Transfer request submitted.</p>
                              <p className="mt-0.5 text-xs opacity-80">A manager will review your RC document and approve the transfer shortly.</p>
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    <button
                      onClick={submitVinClaim}
                      disabled={vinBusy || !vinInput.trim()}
                      className="w-full rounded-xl bg-techm px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-techm-deep disabled:opacity-50"
                    >
                      {vinBusy ? "Submitting…" : "Register vehicle"}
                    </button>
                  </div>
                </div>
              )}

              {/* ── Chat interface ── */}
              {category !== "register_vin" && (
                <div
                  className="overflow-hidden rounded-2xl border border-line bg-surface"
                  style={{ boxShadow: "var(--shadow)" }}
                >
                  {/* Vehicle selector */}
                  <div className="flex items-center gap-3 border-b border-line bg-raised px-4 py-2.5">
                    <span className="eyebrow">Vehicle</span>
                    {session.vehicles.length > 0 ? (
                      <select
                        value={vin}
                        onChange={(e) => setVin(e.target.value)}
                        className="field flex-1 px-3 py-1.5 font-mono text-xs"
                      >
                        {session.vehicles.map((v) => (
                          <option key={v.vin} value={v.vin}>
                            {v.model} ({v.year}) · {v.vin}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={vin}
                        onChange={(e) => setVin(e.target.value)}
                        placeholder="Enter VIN"
                        className="field flex-1 px-3 py-1.5 font-mono text-xs"
                      />
                    )}
                  </div>

                  {/* Message thread */}
                  <div className="h-[420px] space-y-4 overflow-y-auto p-4">
                    {messages.map((m, i) => (
                      <div
                        key={i}
                        className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} animate-fade-up`}
                      >
                        {m.role === "assistant" && (
                          <div className="mr-2 mt-1 flex h-7 w-7 flex-none items-center justify-center rounded-full bg-techm-soft">
                            <span className="font-mono text-[9px] font-bold text-techm">AI</span>
                          </div>
                        )}
                        <div className={`max-w-[80%] ${m.role === "user" ? "" : ""}`}>
                          <div
                            className={`whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                              m.role === "user"
                                ? "rounded-tr-sm bg-techm text-white"
                                : "rounded-tl-sm border border-line bg-raised text-ink"
                            }`}
                          >
                            {m.content}
                          </div>
                          {m.images && m.images.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {m.images.map((src, j) => (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  key={j}
                                  src={src}
                                  alt="attachment"
                                  className="h-20 w-20 rounded-lg border border-line object-cover"
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {busy && (
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-techm-soft">
                          <span className="font-mono text-[9px] font-bold text-techm">AI</span>
                        </div>
                        <div className="rounded-2xl rounded-tl-sm border border-line bg-raised px-4 py-3">
                          <div className="flex items-center gap-1">
                            {[0, 1, 2].map((n) => (
                              <span
                                key={n}
                                className="h-1.5 w-1.5 rounded-full bg-techm"
                                style={{ animation: `pulse 1.2s ease-in-out ${n * 0.2}s infinite` }}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Pending file previews */}
                  {pending.length > 0 && (
                    <div className="flex flex-wrap gap-2 border-t border-line px-4 py-2.5">
                      {pending.map((f, i) => (
                        <span key={i} className="relative inline-block">
                          {f.type === "application/pdf" ? (
                            <div className="flex h-14 w-14 flex-col items-center justify-center rounded-lg border border-line bg-raised text-center">
                              <span className="font-mono text-[8px] font-bold text-techm">PDF</span>
                              <span className="mt-0.5 text-[8px] text-faint line-clamp-1 w-12 px-1">{f.name}</span>
                            </div>
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={URL.createObjectURL(f)}
                              alt={f.name}
                              className="h-14 w-14 rounded-lg border border-line object-cover"
                            />
                          )}
                          <button
                            onClick={() => setPending((p) => p.filter((_, j) => j !== i))}
                            aria-label="Remove"
                            className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-surface border border-line text-[10px] text-muted shadow-sm transition hover:border-danger/50 hover:text-danger"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Upload hint */}
                  {UPLOAD_HINTS[category] && (
                    <div className="flex items-start gap-2 border-t border-line bg-raised/50 px-4 py-2.5">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 flex-none text-techm">
                        <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                      </svg>
                      <p className="text-[11px] text-muted">{UPLOAD_HINTS[category]}</p>
                    </div>
                  )}

                  {/* Input row */}
                  <div className="flex items-center gap-2 border-t border-line px-3 py-3">
                    <input
                      ref={fileInput}
                      type="file"
                      accept="image/*,application/pdf"
                      multiple
                      className="hidden"
                      onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
                    />
                    <button
                      onClick={() => fileInput.current?.click()}
                      disabled={busy}
                      title="Attach photo or PDF"
                      aria-label="Attach file"
                      className={`flex h-9 w-9 flex-none items-center justify-center rounded-lg border text-muted transition hover:border-techm hover:text-techm disabled:opacity-50 ${
                        wantsImage
                          ? "border-techm text-techm ring-2 ring-techm-soft animate-pulse"
                          : "border-line"
                      }`}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                      </svg>
                    </button>
                    <input
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
                      placeholder={wantsImage ? "Attach the photo, or type a reply…" : "Describe the issue…"}
                      className="field flex-1 px-4 py-2 text-sm"
                    />
                    <button
                      onClick={send}
                      disabled={busy || (!input.trim() && pending.length === 0)}
                      className="flex h-9 items-center gap-1.5 rounded-lg bg-techm px-4 text-sm font-semibold text-white transition hover:bg-techm-deep disabled:opacity-50"
                    >
                      Send
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Status tracker (post-submission) */}
          {ticketId && (
            <div className="animate-fade-up space-y-4">
              <StatusTracker ticketId={ticketId} />
              <button
                onClick={() => {
                  setCategory(null);
                  setTicketId(null);
                  setMessages([]);
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-line px-4 py-2 text-sm font-medium text-muted transition hover:border-techm hover:text-techm"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12l7-7 7 7" />
                </svg>
                Start another request
              </button>
            </div>
          )}
        </div>

        {/* ──────────── Side rail ──────────── */}
        <div className="space-y-5">

          {/* My Garage */}
          <div>
            <div className="mb-2.5 flex items-center justify-between">
              <p className="eyebrow">My garage</p>
              <button
                onClick={() => start("register_vin")}
                className="text-[10px] font-medium text-techm transition hover:underline"
              >
                + Add vehicle
              </button>
            </div>
            <div className="space-y-2">
              {session.vehicles.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-line px-4 py-5 text-center">
                  <p className="text-sm text-faint">No vehicles on file</p>
                  <button
                    onClick={() => start("register_vin")}
                    className="mt-2 text-xs font-medium text-techm transition hover:underline"
                  >
                    Register one →
                  </button>
                </div>
              ) : (
                session.vehicles.map((v) => (
                  <div
                    key={v.vin}
                    className="relative overflow-hidden rounded-xl border border-line bg-surface px-4 py-3"
                    style={{ boxShadow: "var(--shadow)" }}
                  >
                    <span className="absolute inset-y-0 left-0 w-[3px] rounded-l-xl bg-techm/70" />
                    <p className="text-sm font-semibold text-ink">
                      {v.model}
                      <span className="ml-1 font-normal text-muted">· {v.year}</span>
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-faint">{v.vin}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* My Requests */}
          <div>
            <div className="mb-2.5 flex items-center gap-2">
              <p className="eyebrow">My requests</p>
              {myTickets.length > 0 && (
                <span className="rounded-full bg-techm-soft px-1.5 py-0.5 font-mono text-[9px] font-semibold text-techm">
                  {myTickets.length}
                </span>
              )}
            </div>
            <div className="overflow-hidden rounded-2xl border border-line bg-surface" style={{ boxShadow: "var(--shadow)" }}>
              {myTickets.length === 0 ? (
                <div className="px-4 py-6 text-center">
                  <p className="text-xs text-faint">Nothing yet.</p>
                  <p className="mt-0.5 text-xs text-faint">Start a request above.</p>
                </div>
              ) : (
                <div>
                  {myTickets.slice(0, 8).map((t, i) => {
                    const dotClass = STATUS_DOT[t.status] ?? "dot-muted";
                    return (
                      <button
                        key={t.id}
                        onClick={() => { setTicketId(t.id); setCategory(t.domain ?? "warranty"); }}
                        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-raised ${
                          i < Math.min(myTickets.length, 8) - 1 ? "border-b border-line" : ""
                        }`}
                      >
                        <span className={`dot mt-1.5 flex-none ${dotClass}`} />
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-1 text-xs font-medium text-ink">{t.summary}</p>
                          <div className="mt-0.5 flex items-center gap-1.5">
                            <span className="font-mono text-[9px] text-faint">#{t.id.slice(0, 8)}</span>
                            {t.domain && (
                              <span className="font-mono text-[9px] text-faint">· {t.domain}</span>
                            )}
                          </div>
                        </div>
                        <span className={`mt-0.5 flex-none text-[10px] font-medium ${STATUS_CHIPS[t.status] ? "text-techm" : "text-faint"}`}>
                          {t.status === "awaiting_approval" ? "review" : t.status === "resolved" ? "done" : t.status.replace(/_/g, " ")}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
