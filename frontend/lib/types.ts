export type Recommendation = {
  decision: "approve" | "reject" | "escalate";
  confidence: number;
  reasoning: string;
  draft_email: string;
  final_decision?: string;
};

export type AgentOutput = {
  agent: string;
  apqc?: string;
  output: Record<string, unknown>;
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
};

export type IntakeReply = {
  session_id: string;
  reply: string;
  enough_info: boolean;
  ticket_id: string | null;
};
