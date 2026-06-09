"use client";

import { useEffect, useRef, useState } from "react";
import { Header } from "@/components/Header";
import { getTicket, sendIntake } from "@/lib/api";
import type { Ticket } from "@/lib/types";

type Msg = { role: "user" | "assistant"; content: string };

const CATEGORIES = [
  { key: "warranty", label: "Warranty Issue" },
  { key: "service", label: "Service Booking" },
  { key: "parts", label: "Parts Query" },
  { key: "recall", label: "Recall Check" },
];

const STATUS_STEPS = [
  { keys: ["submitted", "under_review"], label: "Submitted" },
  { keys: ["awaiting_approval"], label: "Under Review" },
  { keys: ["resolved", "rejected", "escalated"], label: "Decision Made" },
];

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
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
      <p className="text-xs uppercase tracking-wider text-slate-400">
        Ticket {ticketId.slice(0, 8)}
      </p>
      <div className="mt-5 flex items-center">
        {STATUS_STEPS.map((s, i) => {
          const done = i <= activeStep;
          return (
            <div key={s.label} className="flex flex-1 items-center">
              <div className="flex flex-col items-center">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs ${
                    done
                      ? "border-cyan-400 bg-cyan-400/20 text-cyan-300"
                      : "border-slate-700 text-slate-500"
                  }`}
                >
                  {i + 1}
                </div>
                <span className="mt-2 text-[11px] text-slate-400">{s.label}</span>
              </div>
              {i < STATUS_STEPS.length - 1 && (
                <div
                  className={`mx-2 h-0.5 flex-1 ${
                    i < activeStep ? "bg-cyan-400/60" : "bg-slate-800"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {["resolved", "rejected", "escalated"].includes(status) &&
        ticket?.recommendation && (
          <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
            <p className="text-sm font-medium text-slate-200">
              Outcome:{" "}
              <span className="capitalize text-cyan-300">
                {ticket.human_decision ?? status}
              </span>
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-400">
              {ticket.recommendation.draft_email || ticket.recommendation.reasoning}
            </p>
          </div>
        )}
      {status === "awaiting_approval" && (
        <p className="mt-5 text-sm text-slate-400">
          Your request is with our team for final approval. We&apos;ll update this
          page the moment a decision is made.
        </p>
      )}
    </div>
  );
}

export default function CustomerPortal() {
  const [category, setCategory] = useState<string | null>(null);
  const [vin, setVin] = useState("MA3DEMO00000SWIFT");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const sessionId = useRef<string>(
    typeof crypto !== "undefined" ? crypto.randomUUID() : String(Math.random()),
  );

  const start = (cat: string) => {
    setCategory(cat);
    setMessages([
      {
        role: "assistant",
        content:
          "Hi! Describe what's happening with your vehicle and I'll help right away.",
      },
    ]);
  };

  const send = async () => {
    if (!input.trim() || busy) return;
    const text = input.trim();
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setBusy(true);
    try {
      const reply = await sendIntake({
        session_id: sessionId.current,
        message: text,
        vin: vin || undefined,
        category: category || undefined,
      });
      setMessages((m) => [...m, { role: "assistant", content: reply.reply }]);
      if (reply.enough_info && reply.ticket_id) setTicketId(reply.ticket_id);
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
    <>
      <Header title="Customer Portal" accent="bg-cyan-400" />
      <main className="mx-auto w-full max-w-2xl px-6 py-10">
        {!category && (
          <div>
            <h2 className="text-xl font-semibold">How can we help?</h2>
            <div className="mt-5 grid grid-cols-2 gap-3">
              {CATEGORIES.map((c) => (
                <button
                  key={c.key}
                  onClick={() => start(c.key)}
                  className="rounded-xl border border-slate-700 bg-slate-900/50 px-4 py-5 text-left transition hover:border-cyan-500/60 hover:bg-slate-900"
                >
                  <span className="font-medium">{c.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {category && !ticketId && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <label className="text-slate-400">VIN</label>
              <input
                value={vin}
                onChange={(e) => setVin(e.target.value)}
                className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-xs"
              />
            </div>
            <div className="h-80 space-y-3 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={m.role === "user" ? "text-right" : "text-left"}
                >
                  <span
                    className={`inline-block max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                      m.role === "user"
                        ? "bg-cyan-500/20 text-cyan-50"
                        : "bg-slate-800 text-slate-200"
                    }`}
                  >
                    {m.content}
                  </span>
                </div>
              ))}
              {busy && (
                <p className="text-left text-xs text-slate-500">Agent is thinking…</p>
              )}
            </div>
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="Describe the issue…"
                className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm"
              />
              <button
                onClick={send}
                disabled={busy}
                className="rounded-xl bg-cyan-500 px-5 py-2.5 text-sm font-medium text-slate-950 transition hover:bg-cyan-400 disabled:opacity-50"
              >
                Send
              </button>
            </div>
          </div>
        )}

        {ticketId && <StatusTracker ticketId={ticketId} />}
      </main>
    </>
  );
}
