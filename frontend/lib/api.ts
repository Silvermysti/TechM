import type { IntakeReply, Ticket } from "./types";

const BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export function sendIntake(body: {
  session_id: string;
  message: string;
  vin?: string;
  category?: string;
}): Promise<IntakeReply> {
  return jsonFetch<IntakeReply>("/api/v1/intake", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function listTickets(): Promise<Ticket[]> {
  return jsonFetch<Ticket[]>("/api/v1/tickets");
}

export function getTicket(id: string): Promise<Ticket> {
  return jsonFetch<Ticket>(`/api/v1/tickets/${id}`);
}

export function decideTicket(
  id: string,
  decision: "approve" | "reject" | "escalate",
  actor = "manager",
): Promise<Ticket> {
  return jsonFetch<Ticket>(`/api/v1/tickets/${id}/decision`, {
    method: "POST",
    body: JSON.stringify({ decision, actor }),
  });
}
