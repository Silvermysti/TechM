"use client";

import { useEffect, useRef, useState } from "react";
import { Shell } from "@/components/Shell";
import {
  API_BASE,
  claimVIN,
  getTicket,
  sendIntake,
  submitCsat,
  uploadIntakeImage,
  type VINClaimResult,
} from "@/lib/api";
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
  { keys: ["resolved", "rejected", "escalated", "closed", "paid"], label: "Decision Made" },
];

const STATUS_CHIPS: Record<string, string> = {
  resolved: "border-ok/40 text-ok",
  closed: "border-ok/40 text-ok",
  paid: "border-ok/40 text-ok",
  rejected: "border-danger/40 text-danger",
  escalated: "border-warn/40 text-warn",
  awaiting_approval: "border-techm/40 text-techm",
  under_review: "border-line text-muted",
  processing: "border-line text-muted",
  failed: "border-danger/40 text-danger",
};

const CATEGORY_ACCENTS: Record<string, string> = {
  warranty: "bg-techm",
  service: "bg-ok",
  parts: "bg-info",
  recall: "bg-warn",
  register_vin: "bg-process",
};

const CATEGORY_ICON_BG: Record<string, string> = {
  warranty: "bg-techm-soft text-techm",
  service: "bg-ok-soft text-ok",
  parts: "bg-info-soft text-info",
  recall: "bg-warn-soft text-warn",
  register_vin: "bg-process-soft text-process",
};

// ─── Icons ─────────────────────────────────────────────────────────────────────

function WarrantyIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
function ServiceIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14" />
    </svg>
  );
}
function PartsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}
function RecallIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
function VinIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}
function SendIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}
function AttachIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}
function UploadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}
function CheckCircleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
function AlertIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}
function BackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function categoryIcon(key: string) {
  switch (key) {
    case "warranty":     return <WarrantyIcon />;
    case "service":      return <ServiceIcon />;
    case "parts":        return <PartsIcon />;
    case "recall":       return <RecallIcon />;
    case "register_vin": return <VinIcon />;
    default:             return <WarrantyIcon />;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function relTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function dotClass(status: string): string {
  if (status === "resolved" || status === "closed" || status === "paid") return "dot dot-ok";
  if (status === "rejected" || status === "failed") return "dot dot-danger";
  if (status === "escalated" || status === "awaiting_approval") return "dot dot-warn";
  return "dot dot-muted";
}

// ─── CSAT (satisfaction) prompt ──────────────────────────────────────────────
// Shown once a claim is concluded. Records a 1–5 rating (APQC 6.7.5.1).

function CsatPrompt({ ticket }: { ticket: Ticket }) {
  const [score, setScore] = useState<number>(ticket.csat_score ?? 0);
  const [done, setDone] = useState<boolean>(ticket.csat_score != null);
  const [hover, setHover] = useState<number>(0);
  const [comment, setComment] = useState<string>("");
  const [busy, setBusy] = useState(false);

  if (done) {
    return (
      <div className="rounded-xl border border-line bg-raised px-4 py-3">
        <p className="eyebrow mb-1">Thanks for your feedback</p>
        <p className="text-sm text-muted">
          You rated this experience {score} / 5. We use this to improve our service.
        </p>
      </div>
    );
  }

  const send = async () => {
    if (score < 1) return; // need a rating first
    setBusy(true);
    try {
      await submitCsat(ticket.id, score, comment);
      setDone(true);
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-line bg-raised px-4 py-3">
      <p className="eyebrow mb-2">How was your experience?</p>
      <div className="flex items-center gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            disabled={busy}
            onClick={() => setScore(n)}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            className={`text-2xl leading-none transition disabled:opacity-50 ${
              n <= (hover || score) ? "text-warn" : "text-faint hover:text-warn/60"
            }`}
          >
            ★
          </button>
        ))}
      </div>
      <input
        type="text"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Optional: tell us why"
        className="mt-2 w-full rounded-lg border border-line bg-base px-3 py-1.5 text-sm text-ink placeholder:text-faint focus:border-techm focus:outline-none"
      />
      <button
        onClick={send}
        disabled={busy || score < 1}
        className="mt-2 rounded-lg bg-techm px-4 py-1.5 text-sm font-medium text-white transition hover:bg-techm/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Submitting…" : "Submit feedback"}
      </button>
    </div>
  );
}

// ─── Status Tracker ────────────────────────────────────────────────────────────

function StatusTracker({ ticketId, onNew }: { ticketId: string; onNew: () => void }) {
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
  const isTerminal = ["resolved", "rejected", "escalated", "closed", "paid"].includes(status);
  const isFailed = status === "failed";
  const isAwaiting = status === "awaiting_approval";

  return (
    <div className="animate-fade-up space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="eyebrow mb-1">Request tracked</p>
          <h2 className="text-xl font-bold tracking-tight text-ink">
            Ticket{" "}
            <span className="font-mono text-techm">#{ticketId.slice(0, 8).toUpperCase()}</span>
          </h2>
        </div>
        <span className={`chip ${STATUS_CHIPS[status] ?? ""}`}>
          {status.replace(/_/g, " ")}
        </span>
      </div>

      {/* Horizontal stepper */}
      <div className="card p-6">
        <div className="flex items-start">
          {STATUS_STEPS.map((s, i) => {
            const done = i <= activeStep;
            const current = i === activeStep;
            return (
              <div key={s.label} className="flex flex-1 items-start">
                <div className="flex flex-col items-center gap-2">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full border-2 text-xs font-bold transition-all duration-500 ${
                      done
                        ? "border-techm bg-techm text-white shadow-lg shadow-techm/20"
                        : "border-line bg-raised text-faint"
                    } ${current && !isTerminal && !isFailed ? "ring-4 ring-techm/20" : ""}`}
                  >
                    {done && !current ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      i + 1
                    )}
                  </div>
                  <span className={`text-[11px] font-medium text-center leading-tight ${done ? "text-ink" : "text-faint"}`}>
                    {s.label}
                  </span>
                </div>
                {i < STATUS_STEPS.length - 1 && (
                  <div className="mx-3 mt-5 h-0.5 flex-1 overflow-hidden rounded-full bg-line">
                    <div
                      className={`h-full rounded-full bg-techm transition-all duration-700 ${i < activeStep ? "w-full" : "w-0"}`}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Failed state */}
      {isFailed && (
        <div className="card p-5 flex items-start gap-3">
          <span className="text-danger mt-0.5 flex-none"><AlertIcon /></span>
          <div>
            <p className="text-sm font-semibold text-danger mb-1">Processing error</p>
            <p className="text-sm text-muted">
              We encountered an issue processing your request. Please try submitting again or
              contact support.
            </p>
          </div>
        </div>
      )}

      {/* Awaiting approval */}
      {isAwaiting && (
        <div className="card p-5 flex items-start gap-3">
          <span className="text-techm mt-0.5 animate-pulse flex-none"><ClockIcon /></span>
          <div>
            <p className="text-sm font-semibold text-ink mb-1">With our team</p>
            <p className="text-sm text-muted">
              Your request is with our team for final approval. We&apos;ll update this page the
              moment a decision is made.
            </p>
          </div>
        </div>
      )}

      {/* Terminal outcome card */}
      {isTerminal && (
        <div className="card p-5 space-y-4">
          <div className="flex items-center gap-3">
            <span className={`flex-none ${status === "resolved" ? "text-ok" : status === "escalated" ? "text-warn" : "text-danger"}`}>
              <CheckCircleIcon />
            </span>
            <div>
              <p className="eyebrow mb-0.5">Outcome</p>
              <p className="text-sm font-semibold text-ink capitalize">
                {(ticket as Record<string, unknown>)?.decision as string ??
                 (ticket as Record<string, unknown>)?.human_decision as string ?? status}
              </p>
            </div>
          </div>

          {ticket?.claim_number && (
            <div className="flex items-center gap-3 rounded-xl border border-ok/30 bg-ok-soft px-4 py-3">
              <div className="flex-1">
                <p className="eyebrow text-ok mb-0.5">Claim Reference</p>
                <p className="font-mono text-base font-bold text-ink tracking-widest">
                  {ticket.claim_number}
                </p>
              </div>
              <span className="dot dot-ok" />
            </div>
          )}

          {((ticket as Record<string, unknown>)?.decision_message as string | undefined) && (
            <div className="rounded-xl border border-line bg-raised px-4 py-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted">
                {(ticket as Record<string, unknown>).decision_message as string}
              </p>
            </div>
          )}

          {ticket && status !== "escalated" && <CsatPrompt ticket={ticket} />}
        </div>
      )}

      {/* CTA */}
      <button
        onClick={onNew}
        className="flex items-center gap-2 rounded-xl border border-line px-5 py-2.5 text-sm font-medium text-muted transition hover:border-techm hover:text-techm"
      >
        <PlusIcon />
        Start another request
      </button>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function CustomerPortal() {
  const { session, ready } = useAuth(["customer"]);
  const [category, setCategory] = useState<string | null>(null);
  const [vin, setVin] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [pending, setPending] = useState<File[]>([]);
  const [wantsImage, setWantsImage] = useState(false);

  // VIN registration state
  const [vinInput, setVinInput] = useState("");
  const [vinResult, setVinResult] = useState<VINClaimResult | null>(null);
  const [vinBusy, setVinBusy] = useState(false);
  const [vinRcId, setVinRcId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const sessionId = useRef<string>(
    typeof crypto !== "undefined" ? crypto.randomUUID() : String(Math.random()),
  );

  // Default the VIN to the customer's first vehicle once the session is known.
  useEffect(() => {
    if (session && session.vehicles.length > 0 && !vin) {
      setVin(session.vehicles[0].vin);
    }
  }, [session, vin]);

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  if (!ready || !session) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-faint">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-techm" />
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
      // My Requests page polls independently
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

  const activeCat = CATEGORIES.find((c) => c.key === category);

  return (
    <Shell title="Customer Portal" session={session}>
      <div className="rise">

        {/* Garage strip — compact vehicle pills at the top */}
        {session.vehicles.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-6">
            <span className="eyebrow mr-1">My Garage</span>
            {session.vehicles.map((v) => (
              <div key={v.vin} className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5" style={{ boxShadow: "var(--shadow)" }}>
                <span className="h-2 w-2 rounded-full bg-techm flex-none" />
                <span className="text-[13px] font-medium text-ink">{v.model} <span className="text-muted font-normal">{v.year}</span></span>
                <span className="font-mono text-[10px] text-faint">{v.vin}</span>
              </div>
            ))}
            {session.vehicles.length === 0 && (
              <button onClick={() => start("register_vin")} className="text-xs font-medium text-techm hover:underline">
                Register a vehicle →
              </button>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            MAIN AREA — state-based rendering
            ═══════════════════════════════════════════════════════════ */}
        <main className="min-w-0">

          {/* ── STATE 1: No category selected — category grid ── */}
          {!category && (
            <div className="animate-fade-up max-w-2xl">
              <p className="eyebrow mb-2">How can we help?</p>
              <h2 className="text-2xl font-bold tracking-tight text-ink mb-1">
                Start a request
              </h2>
              <p className="text-sm text-muted mb-7">
                Choose a category below. Our AI will guide you through the rest.
              </p>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => start(c.key)}
                    className="card card-hover group relative overflow-hidden p-5 text-left"
                  >
                    {/* Domain colour accent stripe */}
                    <span className={`absolute inset-x-0 top-0 h-0.5 ${CATEGORY_ACCENTS[c.key]}`} />

                    {/* "New" badge for register_vin */}
                    {c.key === "register_vin" && (
                      <span className="absolute right-3 top-3 badge badge-quality">New</span>
                    )}

                    {/* Icon */}
                    <span className={`mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl ${CATEGORY_ICON_BG[c.key]}`}>
                      {categoryIcon(c.key)}
                    </span>

                    {/* Code — mono, small, faint */}
                    <span className="font-mono text-[10px] tracking-[0.18em] text-faint block mb-1 transition group-hover:text-techm">
                      {c.code}
                    </span>

                    {/* Label */}
                    <span className="block font-semibold text-ink text-sm leading-snug">
                      {c.label}
                    </span>

                    {/* Hint */}
                    <p className="mt-1 text-xs text-muted leading-snug">{c.hint}</p>

                    {/* Arrow on hover */}
                    <span className="absolute bottom-4 right-4 text-techm opacity-0 translate-x-1 transition duration-200 group-hover:translate-x-0 group-hover:opacity-100">
                      →
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── STATE 2 & 3: Category selected, no ticket ── */}
          {category && !ticketId && (
            <div className="animate-fade-up max-w-2xl space-y-5">

              {/* Category header with back arrow */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setCategory(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-muted transition hover:border-techm hover:text-techm"
                  aria-label="Change category"
                >
                  <BackIcon />
                </button>
                <div className="flex items-center gap-2.5">
                  <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${CATEGORY_ICON_BG[category]}`}>
                    {categoryIcon(category)}
                  </span>
                  <div>
                    <p className="eyebrow leading-none mb-0.5">{activeCat?.code}</p>
                    <h2 className="text-base font-bold text-ink leading-tight">
                      {activeCat?.label}
                    </h2>
                  </div>
                </div>
              </div>

              {/* ── VIN Registration Flow (STATE 2) ── */}
              {category === "register_vin" && (
                <div className="card p-6 space-y-5">
                  <div>
                    <p className="eyebrow mb-1">Vehicle Identification Number</p>
                    <h3 className="text-lg font-bold text-ink">Register a Vehicle</h3>
                    <p className="text-xs text-muted mt-1">
                      Found on your RC document, dashboard (driver&apos;s side), or door jamb.
                    </p>
                  </div>

                  {/* VIN input — large, monospace, prominent */}
                  <div className="space-y-2">
                    <label className="eyebrow block">VIN</label>
                    <input
                      value={vinInput}
                      onChange={(e) => setVinInput(e.target.value)}
                      placeholder="e.g. MA3DEMO00000SWIFT"
                      className="field w-full px-4 py-3 font-mono text-sm tracking-widest uppercase"
                    />
                  </div>

                  {/* RC upload zone — dashed border */}
                  <div className="space-y-2">
                    <label className="eyebrow block">
                      RC Document{" "}
                      <span className="normal-case font-normal text-faint ml-1">
                        (required if transferring from another owner)
                      </span>
                    </label>
                    <div
                      className={`rounded-xl border-2 border-dashed px-5 py-6 text-center transition ${
                        vinRcId
                          ? "border-ok/50 bg-ok-soft/20"
                          : "border-line hover:border-techm/50 hover:bg-raised/50"
                      }`}
                    >
                      {vinRcId ? (
                        <div className="flex items-center justify-center gap-3 text-sm">
                          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ok-soft text-ok">
                            <CheckCircleIcon />
                          </span>
                          <span className="font-medium text-ok">RC document uploaded</span>
                          <button
                            onClick={() => setVinRcId(null)}
                            className="ml-1 rounded px-2 py-0.5 text-xs text-faint hover:bg-danger-soft hover:text-danger transition"
                          >
                            Remove
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-raised text-faint">
                            <UploadIcon />
                          </div>
                          <p className="text-xs text-muted">
                            Upload a photo or scan of your RC to verify ownership
                          </p>
                          <label className="inline-block cursor-pointer rounded-lg border border-line px-4 py-1.5 text-xs font-medium text-muted transition hover:border-techm hover:text-techm">
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
                                } catch {
                                  /* ignore */
                                }
                                e.target.value = "";
                              }}
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Result state banner */}
                  {vinResult && (
                    <div
                      className={`flex items-start gap-3 rounded-xl border px-4 py-3.5 text-sm ${
                        vinResult.status === "registered"
                          ? "border-ok/40 bg-ok-soft text-ok"
                          : vinResult.status === "already_owned"
                          ? "border-warn/40 bg-warn-soft text-warn"
                          : "border-techm/40 bg-techm-soft text-techm"
                      }`}
                    >
                      <span className="mt-0.5 flex-none">
                        {vinResult.status === "registered" ? <CheckCircleIcon /> : <AlertIcon />}
                      </span>
                      <span>
                        {vinResult.status === "registered" &&
                          "Vehicle registered to your account."}
                        {vinResult.status === "already_owned" &&
                          "This vehicle is already linked to your account."}
                        {vinResult.status === "transfer_requested" &&
                          "Transfer request submitted. A manager will review your RC and approve shortly."}
                      </span>
                    </div>
                  )}

                  {/* Submit button — full-width, techm coloured */}
                  <button
                    onClick={submitVinClaim}
                    disabled={vinBusy || !vinInput.trim()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-techm px-4 py-3 text-sm font-semibold text-white transition hover:bg-techm-deep disabled:opacity-50"
                  >
                    {vinBusy ? (
                      <>
                        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        Submitting…
                      </>
                    ) : (
                      "Register vehicle"
                    )}
                  </button>
                </div>
              )}

              {/* ── Chat Interface (STATE 3) ── */}
              {category !== "register_vin" && (
                <>
                  {/* Vehicle selector */}
                  <div className="flex items-center gap-3">
                    <label className="eyebrow flex-none">Vehicle</label>
                    {session.vehicles.length > 0 ? (
                      <select
                        value={vin}
                        onChange={(e) => setVin(e.target.value)}
                        className="field flex-1 px-3 py-2 font-mono text-xs"
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
                        placeholder="Enter VIN"
                        className="field flex-1 px-3 py-2 font-mono text-xs"
                      />
                    )}
                  </div>

                  {/* Contextual upload hint — subtle banner */}
                  {UPLOAD_HINTS[category] && (
                    <div className="flex items-start gap-2.5 rounded-xl border border-line bg-raised px-4 py-2.5 text-xs text-muted">
                      <span className="mt-0.5 flex-none text-techm"><AttachIcon /></span>
                      <span>{UPLOAD_HINTS[category]}</span>
                    </div>
                  )}

                  {/* Chat thread */}
                  <div className="card flex flex-col overflow-hidden">
                    {/* Scrollable message area */}
                    <div
                      className="flex-1 overflow-y-auto p-4 space-y-4"
                      style={{ minHeight: "20rem", maxHeight: "28rem" }}
                    >
                      {messages.map((m, i) => (
                        <div
                          key={i}
                          className={`flex gap-2.5 animate-fade-up ${m.role === "user" ? "flex-row-reverse" : "flex-row"}`}
                        >
                          {/* AI avatar dot */}
                          {m.role === "assistant" && (
                            <div className="mt-0.5 flex-none h-7 w-7 rounded-full bg-techm-soft border border-techm/30 flex items-center justify-center">
                              <span className="text-[10px] font-bold text-techm">AI</span>
                            </div>
                          )}

                          {/* Bubble */}
                          <div className="max-w-[82%] space-y-2">
                            <div
                              className={`whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                                m.role === "user"
                                  ? "rounded-tr-sm bg-techm text-white"
                                  : "rounded-tl-sm border border-line bg-raised text-ink"
                              }`}
                            >
                              {m.content}
                            </div>

                            {/* Inline attachment thumbnails */}
                            {m.images && m.images.length > 0 && (
                              <div className={`flex flex-wrap gap-1.5 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                                {m.images.map((src, j) => (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    key={j}
                                    src={src}
                                    alt="attached evidence"
                                    className="h-20 w-20 rounded-xl border border-line object-cover"
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}

                      {/* AI is thinking — 3 bouncing dots */}
                      {busy && (
                        <div className="flex gap-2.5 animate-fade-up">
                          <div className="mt-0.5 flex-none h-7 w-7 rounded-full bg-techm-soft border border-techm/30 flex items-center justify-center">
                            <span className="text-[10px] font-bold text-techm">AI</span>
                          </div>
                          <div className="rounded-2xl rounded-tl-sm border border-line bg-raised px-4 py-3.5">
                            <div className="flex items-center gap-1.5">
                              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-techm" style={{ animationDelay: "0ms" }} />
                              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-techm" style={{ animationDelay: "150ms" }} />
                              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-techm" style={{ animationDelay: "300ms" }} />
                            </div>
                          </div>
                        </div>
                      )}

                      <div ref={chatEndRef} />
                    </div>

                    {/* Pending file previews — row above input */}
                    {pending.length > 0 && (
                      <div className="border-t border-line px-4 py-3 flex gap-2 flex-wrap">
                        {pending.map((f, i) => (
                          <span key={i} className="relative inline-block">
                            {f.type.startsWith("image/") ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={URL.createObjectURL(f)}
                                alt={f.name}
                                className="h-14 w-14 rounded-lg border border-line object-cover"
                              />
                            ) : (
                              <div className="h-14 w-14 rounded-lg border border-line bg-raised flex flex-col items-center justify-center gap-1">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted">
                                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                  <polyline points="14 2 14 8 20 8" />
                                </svg>
                                <span className="text-[9px] font-mono text-faint">PDF</span>
                              </div>
                            )}
                            <button
                              onClick={() => setPending((p) => p.filter((_, j) => j !== i))}
                              aria-label="Remove file"
                              className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-techm text-[10px] leading-none text-white shadow"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Input row */}
                    <div className="border-t border-line p-3 flex items-end gap-2">
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
                      {/* Attachment button — pulses when AI requests a photo */}
                      <button
                        onClick={() => fileInput.current?.click()}
                        disabled={busy}
                        title="Attach a photo or PDF"
                        aria-label="Attach a file"
                        className={`flex h-10 w-10 flex-none items-center justify-center rounded-xl border text-muted transition hover:border-techm hover:text-techm disabled:opacity-50 ${
                          wantsImage
                            ? "animate-pulse border-techm text-techm ring-2 ring-techm/20"
                            : "border-line"
                        }`}
                      >
                        <AttachIcon />
                      </button>
                      <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            send();
                          }
                        }}
                        placeholder={
                          wantsImage
                            ? "Attach the requested photo, or describe further…"
                            : "Describe the issue… (Enter to send)"
                        }
                        rows={1}
                        className="field flex-1 resize-none px-4 py-2.5 text-sm leading-relaxed"
                        style={{ minHeight: "2.6rem", maxHeight: "8rem" }}
                      />
                      <button
                        onClick={send}
                        disabled={busy || (!input.trim() && pending.length === 0)}
                        className="flex h-10 items-center gap-1.5 rounded-xl bg-techm px-4 text-sm font-semibold text-white transition hover:bg-techm-deep disabled:opacity-50"
                      >
                        <SendIcon />
                        <span className="hidden sm:inline">Send</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── STATE 4: ticketId set — Status Tracker ── */}
          {ticketId && (
            <div className="max-w-2xl">
              <StatusTracker
                ticketId={ticketId}
                onNew={() => {
                  setCategory(null);
                  setTicketId(null);
                  setMessages([]);
                }}
              />
            </div>
          )}

        </main>
      </div>
    </Shell>
  );
}
