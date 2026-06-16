"use client";

import { useEffect, useRef, useState } from "react";
import { API_BASE } from "./api";
import { getSession } from "./auth";

export type SSEEvent = {
  type: string;
  agent?: string;
  apqc?: string;
  output?: Record<string, unknown>;
  decision?: string;
  status?: string;
  domain?: string;
  ticket_id?: string;
  [key: string]: unknown;
};

export function useTicketStream(ticketId: string | null) {
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!ticketId) return;
    const session = getSession();
    if (!session) return;

    // EventSource doesn't support custom headers — pass token as query param.
    // The backend reads it from Authorization header OR ?token= query param.
    const token = (session as { token?: string }).token ?? "";
    const url = `${API_BASE}/api/v1/tickets/${ticketId}/stream?token=${encodeURIComponent(token)}`;

    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    const handler = (raw: MessageEvent) => {
      try {
        const evt: SSEEvent = JSON.parse(raw.data);
        setEvents((prev) => [...prev, evt]);
      } catch {
        /* ignore malformed */
      }
    };

    for (const t of [
      "ticket.created", "ticket.awaiting_approval", "ticket.resolved",
      "agent.started", "agent.step", "done",
    ]) {
      es.addEventListener(t, handler);
    }

    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [ticketId]);

  const reset = () => setEvents([]);
  return { events, connected, reset };
}
