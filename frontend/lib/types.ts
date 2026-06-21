export type Recommendation = {
  decision: "approve" | "reject" | "escalate";
  confidence: number;
  reasoning: string;
  draft_email: string;
  cited_clause?: string | null;
  final_decision?: string;
};

export type AgentOutput = {
  agent: string;
  apqc?: string;
  output: Record<string, unknown>;
};

export type Attachment = {
  id: string;
  url: string;
  filename: string;
};

export type Ticket = {
  id: string;
  customer_id: string | null;
  vehicle_vin: string | null;
  classification: string | null;
  priority: string;
  status: string;
  apqc_process: string | null;
  domain: string | null;
  summary: string;
  recommendation: Recommendation | null;
  agent_trace: AgentOutput[] | null;
  human_decision: string | null;
  human_actor: string | null;
  claim_number: string | null;
  claim_id: string | null;
  csat_score?: number | null;
  // Present only on the customer-redacted view (CustomerTicketOut).
  decision_message?: string | null;
  attachments: Attachment[];
};

export type ClaimLine = {
  id: string;
  line_type: string;
  reference: string;
  description: string;
  quantity: number;
  unit_cost: number;
  line_total: number;
};

export type Claim = {
  id: string;
  claim_number: string;
  ticket_id: string | null;
  vehicle_vin: string | null;
  component: string | null;
  fault_code: string | null;
  labor_hours: number;
  labor_cost: number;
  parts_cost: number;
  total_cost: number;
  approved_amount: number | null;
  currency: string;
  status: string;
  supplier_recoverable: boolean;
  decided_by: string | null;
  submitted_at: string;
  paid_at: string | null;
  lines: ClaimLine[];
};

export type Recall = {
  id: string;
  code: string;
  model: string;
  year: number;
  component: string;
  description: string;
  status: string;
  affected_count: number;
};

export type AuditEntry = {
  id: string;
  timestamp: string;
  actor_type: string;
  actor_id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  after_state: Record<string, unknown> | null;
};

export type IntakeReply = {
  session_id: string;
  reply: string;
  enough_info: boolean;
  ticket_id: string | null;
  request_image: boolean;
};

export type Vehicle = {
  vin: string;
  model: string;
  year: number;
};

export type Session = {
  role: "customer" | "manager";
  name: string;
  email: string;
  customer_id: string | null;
  vehicles: Vehicle[];
  token?: string;
};
