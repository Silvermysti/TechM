import type { AuditEntry, Attachment, Claim, IntakeReply, Session, Ticket } from "./types";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

const BASE = API_BASE;

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

export function login(email: string): Promise<Session> {
  return jsonFetch<Session>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function sendIntake(body: {
  session_id: string;
  message: string;
  vin?: string;
  category?: string;
  attachment_ids?: string[];
}): Promise<IntakeReply> {
  return jsonFetch<IntakeReply>("/api/v1/intake", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Upload one evidence photo for an intake chat session (multipart). */
export async function uploadIntakeImage(
  sessionId: string,
  file: File,
): Promise<Attachment> {
  const fd = new FormData();
  fd.append("session_id", sessionId);
  fd.append("file", file);
  const res = await fetch(`${BASE}/api/v1/intake/upload`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    throw new Error(`${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<Attachment>;
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

export function listClaims(): Promise<Claim[]> {
  return jsonFetch<Claim[]>("/api/v1/claims");
}

export function getClaim(id: string): Promise<Claim> {
  return jsonFetch<Claim>(`/api/v1/claims/${id}`);
}

export function payClaim(id: string): Promise<Claim> {
  return jsonFetch<Claim>(`/api/v1/claims/${id}/pay`, { method: "POST" });
}

export function closeClaim(id: string): Promise<Claim> {
  return jsonFetch<Claim>(`/api/v1/claims/${id}/close`, { method: "POST" });
}

export function listAudit(params?: {
  ticket_id?: string;
  actor_type?: string;
  action?: string;
  limit?: number;
}): Promise<AuditEntry[]> {
  const q = new URLSearchParams();
  if (params?.ticket_id) q.set("ticket_id", params.ticket_id);
  if (params?.actor_type) q.set("actor_type", params.actor_type);
  if (params?.action) q.set("action", params.action);
  if (params?.limit) q.set("limit", String(params.limit));
  return jsonFetch<AuditEntry[]>(`/api/v1/audit${q.size ? `?${q}` : ""}`);
}
