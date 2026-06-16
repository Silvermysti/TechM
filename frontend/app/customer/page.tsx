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

  if (!ready || !session) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-faint">
        Loading…
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

  return (
    <Shell title="Customer Portal" session={session}>
      <div className="grid grid-cols-1 gap-5 rise xl:grid-cols-[1fr_320px]">
        {/* ---- main column ---- */}
        <div>
          {!category && (
            <div>
              <p className="eyebrow">How can we help?</p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink">
                Start a request
              </h2>
              <div className="mt-5 grid grid-cols-2 gap-3">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => start(c.key)}
                    className="card group p-5 text-left transition hover:-translate-y-0.5 hover:border-techm"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] tracking-[0.18em] text-faint transition group-hover:text-techm">
                        {c.code}
                      </span>
                      <span className="text-sm text-techm opacity-0 transition group-hover:opacity-100">
                        →
                      </span>
                    </div>
                    <span className="mt-2.5 block font-semibold text-ink">{c.label}</span>
                    <p className="mt-1 text-xs text-muted">{c.hint}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {category && !ticketId && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <p className="eyebrow">
                  New request · {CATEGORIES.find((c) => c.key === category)?.label}
                </p>
                <button
                  onClick={() => setCategory(null)}
                  className="text-xs text-faint transition hover:text-techm"
                >
                  ← Change category
                </button>
              </div>

              {/* VIN registration flow */}
              {category === "register_vin" && (
                <div className="card space-y-4 p-5">
                  <div>
                    <label className="eyebrow">Vehicle Identification Number (VIN)</label>
                    <input
                      value={vinInput}
                      onChange={(e) => setVinInput(e.target.value)}
                      placeholder="e.g. MA3DEMO00000SWIFT"
                      className="field mt-2 w-full px-4 py-2.5 font-mono text-sm tracking-wider"
                    />
                    <p className="mt-1.5 text-xs text-faint">
                      Found on your RC document, dashboard (driver side), or door jamb.
                    </p>
                  </div>

                  <div>
                    <label className="eyebrow">
                      RC Document{" "}
                      <span className="font-normal normal-case text-faint">
                        (required if transferring from another owner)
                      </span>
                    </label>
                    <div className={`mt-2 rounded-xl border-2 border-dashed px-4 py-4 text-center transition ${
                      vinRcId ? "border-ok/50 bg-ok-soft/30" : "border-line hover:border-techm/50"
                    }`}>
                      {vinRcId ? (
                        <div className="flex items-center justify-center gap-2 text-sm text-ok">
                          <span>✓</span>
                          <span>RC document uploaded</span>
                          <button
                            onClick={() => setVinRcId(null)}
                            className="ml-2 text-xs text-faint hover:text-danger"
                          >
                            Remove
                          </button>
                        </div>
                      ) : (
                        <>
                          <p className="text-sm text-muted">
                            Upload a photo or scan of your RC — helps the manager verify ownership
                          </p>
                          <label className="mt-2 inline-block cursor-pointer rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted transition hover:border-techm hover:text-techm">
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
                        </>
                      )}
                    </div>
                  </div>

                  {vinResult && (
                    <div className={`rounded-xl border px-4 py-3 text-sm ${
                      vinResult.status === "registered"
                        ? "border-ok/40 bg-ok-soft text-ok"
                        : vinResult.status === "already_owned"
                        ? "border-warn/40 bg-warn-soft text-warn"
                        : "border-techm/40 bg-techm-soft text-techm"
                    }`}>
                      {vinResult.status === "registered" && "✓ Vehicle registered to your account."}
                      {vinResult.status === "already_owned" && "This vehicle is already on your account."}
                      {vinResult.status === "transfer_requested" && (
                        <>Transfer request submitted. A manager will review your RC and approve shortly.</>
                      )}
                    </div>
                  )}

                  <button
                    onClick={submitVinClaim}
                    disabled={vinBusy || !vinInput.trim()}
                    className="w-full rounded-xl bg-techm px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-techm-deep disabled:opacity-50"
                  >
                    {vinBusy ? "Submitting…" : "Register vehicle"}
                  </button>
                </div>
              )}

              {category !== "register_vin" && (
              <>
              <div className="flex items-center gap-3 text-sm">
                <label className="eyebrow">Vehicle</label>
                {session.vehicles.length > 0 ? (
                  <select
                    value={vin}
                    onChange={(e) => setVin(e.target.value)}
                    className="field flex-1 px-3 py-1.5 font-mono text-xs"
                  >
                    {session.vehicles.map((v) => (
                      <option key={v.vin} value={v.vin}>
                        {v.model} ({v.year}) — {v.vin}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={vin}
                    onChange={(e) => setVin(e.target.value)}
                    placeholder="VIN"
                    className="field flex-1 px-3 py-1.5 font-mono text-xs"
                  />
                )}
              </div>
              <div className="card h-96 space-y-3 overflow-y-auto p-4">
                {messages.map((m, i) => (
                  <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
                    <span
                      className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-left text-sm ${
                        m.role === "user"
                          ? "bg-techm text-white"
                          : "border border-line bg-raised text-ink"
                      }`}
                    >
                      {m.content}
                      {m.images && m.images.length > 0 && (
                        <span className="mt-2 flex flex-wrap gap-1.5">
                          {m.images.map((src, j) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              key={j}
                              src={src}
                              alt="attached evidence"
                              className="h-20 w-20 rounded-lg border border-white/20 object-cover"
                            />
                          ))}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
                {busy && (
                  <p className="flex items-center gap-2 text-left text-xs text-faint">
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-techm" />
                    Agent is thinking…
                  </p>
                )}
              </div>

              {pending.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {pending.map((f, i) => (
                    <span
                      key={i}
                      className="relative inline-block"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={URL.createObjectURL(f)}
                        alt={f.name}
                        className="h-14 w-14 rounded-lg border border-line object-cover"
                      />
                      <button
                        onClick={() => setPending((p) => p.filter((_, j) => j !== i))}
                        aria-label="Remove photo"
                        className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-techm text-[10px] leading-none text-white"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {UPLOAD_HINTS[category] && (
                <div className="flex items-start gap-2 rounded-xl border border-line bg-raised px-3.5 py-2.5 text-xs text-muted">
                  <span className="mt-0.5 text-techm">📎</span>
                  <span>{UPLOAD_HINTS[category]}</span>
                </div>
              )}

              <div className="flex gap-2">
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <button
                  onClick={() => fileInput.current?.click()}
                  disabled={busy}
                  title="Attach a photo of the issue"
                  aria-label="Attach a photo"
                  className={`flex w-11 flex-none items-center justify-center rounded-xl border text-muted transition hover:border-techm hover:text-techm disabled:opacity-50 ${
                    wantsImage
                      ? "animate-pulse border-techm text-techm ring-2 ring-techm-soft"
                      : "border-line"
                  }`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                </button>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && send()}
                  placeholder={
                    wantsImage
                      ? "Attach the requested photo, or reply…"
                      : "Describe the issue…"
                  }
                  className="field flex-1 px-4 py-2.5 text-sm"
                />
                <button
                  onClick={send}
                  disabled={busy}
                  className="rounded-xl bg-techm px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-techm-deep disabled:opacity-50"
                >
                  Send
                </button>
              </div>
              </>
              )}
            </div>
          )}

          {ticketId && (
            <div className="space-y-4">
              <StatusTracker ticketId={ticketId} />
              <button
                onClick={() => {
                  setCategory(null);
                  setTicketId(null);
                  setMessages([]);
                }}
                className="rounded-xl border border-line px-4 py-2 text-sm font-medium text-muted transition hover:border-techm hover:text-techm"
              >
                + Start another request
              </button>
            </div>
          )}
        </div>

        {/* ---- side rail ---- */}
        <div className="space-y-5">
          <div>
            <h2 className="eyebrow mb-2.5">My garage</h2>
            <div className="space-y-2">
              {session.vehicles.length === 0 && (
                <p className="card p-4 text-sm text-faint">No vehicles on file.</p>
              )}
              {session.vehicles.map((v) => (
                <div key={v.vin} className="card relative overflow-hidden px-4 py-3.5">
                  <span className="absolute inset-y-0 left-0 w-[3px] bg-techm/70" />
                  <p className="text-sm font-semibold text-ink">
                    {v.model}{" "}
                    <span className="font-normal text-muted">· {v.year}</span>
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-faint">{v.vin}</p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h2 className="eyebrow mb-2.5">My requests ({myTickets.length})</h2>
            <div className="card overflow-hidden">
              {myTickets.length === 0 ? (
                <p className="p-4 text-sm text-faint">
                  Nothing yet. Start a request to see it tracked here.
                </p>
              ) : (
                <ul>
                  {myTickets.slice(0, 8).map((t) => (
                    <li key={t.id} className="border-b border-line last:border-0">
                      <button
                        onClick={() => {
                          setTicketId(t.id);
                          setCategory(t.domain ?? "warranty");
                        }}
                        className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition hover:bg-raised"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-ink">
                            {t.summary}
                          </span>
                          <span className="font-mono text-[10px] text-faint">
                            #{t.id.slice(0, 8)}
                          </span>
                        </span>
                        <span className={`chip flex-none ${STATUS_CHIPS[t.status] ?? ""}`}>
                          {t.status.replace(/_/g, " ")}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
