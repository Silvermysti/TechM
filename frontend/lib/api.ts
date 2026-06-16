import type { AuditEntry, Attachment, Claim, IntakeReply, Recall, Session, Ticket } from "./types";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

const BASE = API_BASE;

function getToken(): string | null {
  try {
    const raw = window.localStorage.getItem("techm.session");
    if (!raw) return null;
    return (JSON.parse(raw) as Session).token ?? null;
  } catch {
    return null;
  }
}

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = typeof window !== "undefined" ? getToken() : null;
  const { headers: extraHeaders, ...restInit } = init ?? {};
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(extraHeaders as Record<string, string> | undefined),
  };
  const res = await fetch(`${BASE}${path}`, {
    headers,
    cache: "no-store",
    ...restInit,
  });
  if (res.status === 401) {
    if (typeof window !== "undefined") {
      localStorage.removeItem("techm.session");
      window.location.href = "/login";
    }
    throw new Error("401: Session expired");
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export function login(email: string, password: string): Promise<Session> {
  return jsonFetch<Session>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function register(name: string, email: string, password: string, phone?: string): Promise<Session> {
  return jsonFetch<Session>("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, email, password, phone: phone ?? "" }),
  });
}

export type VINClaimResult = {
  status: "registered" | "already_owned" | "transfer_requested";
  vin: string;
  transfer_id: string | null;
};

export function claimVIN(vin: string, rc_attachment_id?: string): Promise<VINClaimResult> {
  return jsonFetch<VINClaimResult>("/api/v1/vehicles/claim", {
    method: "POST",
    body: JSON.stringify({ vin, rc_attachment_id: rc_attachment_id ?? null }),
  });
}

export type VINTransfer = {
  id: string; vin: string; requester_name: string; requester_email: string;
  current_owner_id: string | null; rc_attachment_id: string | null;
  status: string; requested_at: string;
};

export function listTransfers(): Promise<VINTransfer[]> {
  return jsonFetch<VINTransfer[]>("/api/v1/vehicles/transfers");
}

export function approveTransfer(id: string): Promise<VINTransfer> {
  return jsonFetch<VINTransfer>(`/api/v1/vehicles/transfers/${id}/approve`, { method: "POST" });
}

export function rejectTransfer(id: string): Promise<VINTransfer> {
  return jsonFetch<VINTransfer>(`/api/v1/vehicles/transfers/${id}/reject`, { method: "POST" });
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
  const token = typeof window !== "undefined" ? getToken() : null;
  const res = await fetch(`${BASE}/api/v1/intake/upload`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
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

export type PartItem = {
  id: string; part_name: string; sku: string; component: string;
  stock_qty: number; eta_days: number; unit_price: number; supplier: string;
};

export function listParts(): Promise<PartItem[]> {
  return jsonFetch<PartItem[]>("/api/v1/parts");
}

export function listRecalls(): Promise<Recall[]> {
  return jsonFetch<Recall[]>("/api/v1/recalls");
}

export function triggerRecall(id: string): Promise<Ticket> {
  return jsonFetch<Ticket>(`/api/v1/recalls/${id}/trigger`, { method: "POST" });
}

export type DomainStat = {
  domain: string; count: number; approved: number; rejected: number; avg_cost: number | null;
};

export type TrendMetrics = {
  total_tickets: number;
  auto_approved: number;
  human_approved: number;
  rejected: number;
  awaiting: number;
  failed: number;
  avg_confidence: number | null;
  total_claim_cost: number;
  domains: DomainStat[];
};

export function getMetrics(): Promise<TrendMetrics> {
  return jsonFetch<TrendMetrics>("/api/v1/metrics");
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
