"""Pydantic schemas: LLM decision objects + API request/response contracts.

The LLM decision schemas are what we pass to `with_structured_output`, so the model
is constrained to return exactly these shapes.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# --------------------------------------------------------------------------- #
# LLM decision objects (structured output)
# --------------------------------------------------------------------------- #
class ExtractedFields(BaseModel):
    vin: str = Field("", description="VIN if mentioned, else empty string")
    component: str = Field(
        "", description="affected part, e.g. ac, brakes, engine; empty if unknown"
    )
    symptom: str = Field("", description="symptom description; empty if unknown")
    onset: str = Field("", description="when the problem started; empty if unknown")


class IntakeDecision(BaseModel):
    """Result of the intake agent reading the conversation so far."""

    enough_info: bool = Field(
        description="true if we have enough to create and route a ticket"
    )
    follow_up_question: str = Field(
        "",
        description=(
            "Single clarifying question — use only when exactly one thing is missing. "
            "Use follow_up_bullets instead when two or more things are needed. "
            "Empty string if not applicable."
        ),
    )
    follow_up_bullets: list[str] = Field(
        default_factory=list,
        description=(
            "All missing items as short bullet strings. Use when two or more things "
            "are needed so the customer can answer everything in one reply. "
            "E.g. ['Which part is affected?', 'When did this start?', 'Odometer (km)?']. "
            "If a photo would help, add it as the last bullet."
        ),
    )
    domain: Literal[
        "warranty", "recall", "parts", "customer", "quality", "service"
    ] = Field("warranty", description="most likely domain for this issue")
    apqc_process: str = Field("", description="APQC ref e.g. 6.7.3; empty if unknown")
    summary: str = Field("", description="one-line summary of the issue; empty if unknown")
    extracted: ExtractedFields = Field(default_factory=ExtractedFields)
    request_image: bool = Field(
        False,
        description=(
            "true when the issue would be visible in a photograph and the customer "
            "has not attached one yet"
        ),
    )

    @field_validator("domain", mode="before")
    @classmethod
    def normalise_domain(cls, v: object) -> object:
        return v.lower() if isinstance(v, str) else v


class EvidenceAssessment(BaseModel):
    """Vision AI output: assessment of a customer-submitted evidence photo."""

    photo_matches_claim: bool = Field(
        description="true if the photo content is consistent with the reported component and symptom"
    )
    damage_visible: bool = Field(
        description="true if visible damage, wear, or malfunction evidence is present in the image"
    )
    confidence: float = Field(
        ge=0.0, le=1.0,
        description="how confident you are in this assessment (0.0 = cannot tell, 1.0 = certain)"
    )
    notes: str = Field(
        description="one or two sentences describing what is visible in the photo"
    )


class FraudAssessment(BaseModel):
    fraud_risk: float = Field(ge=0.0, le=1.0)
    reasoning: str


class WarrantyRecommendation(BaseModel):
    decision: Literal["approve", "reject", "escalate"]
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning: str
    draft_email: str

    @field_validator("decision", mode="before")
    @classmethod
    def normalise_decision(cls, v: object) -> object:
        return v.lower() if isinstance(v, str) else v


class SupplierRecoveryDraft(BaseModel):
    """LLM output: a drafted supplier cost-recovery claim email (APQC 6.7.4)."""

    subject: str = Field(description="concise email subject line referencing the claim")
    body: str = Field(
        description="professional cost-recovery email body addressed to the supplier"
    )


# --------------------------------------------------------------------------- #
# API contracts
# --------------------------------------------------------------------------- #
class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str
    phone: str = ""


class VehicleOut(BaseModel):
    vin: str
    model: str
    year: int

    model_config = ConfigDict(from_attributes=True)


class LoginResponse(BaseModel):
    """Identity + signed token. The token authorizes every subsequent request."""

    token: str
    role: Literal["customer", "manager"]
    name: str
    email: str
    customer_id: str | None = None
    vehicles: list[VehicleOut] = Field(default_factory=list)


class MeResponse(BaseModel):
    """Current identity resolved from a token (no secret echoed back)."""

    role: Literal["customer", "manager"]
    name: str
    email: str
    customer_id: str | None = None
    vehicles: list[VehicleOut] = Field(default_factory=list)


class IntakeMessage(BaseModel):
    session_id: str
    message: str
    vin: str | None = None
    # Optional category the customer picked in the portal (warranty/recall/parts/
    # service/...). Used as a strong domain hint so routing is deterministic.
    category: str | None = None
    # Evidence photos already uploaded for this chat session (attachment ids).
    attachment_ids: list[str] = []


class IntakeReply(BaseModel):
    session_id: str
    reply: str
    enough_info: bool
    ticket_id: str | None = None
    # true when the agent is asking the customer to attach a photo of the issue
    request_image: bool = False


class AttachmentOut(BaseModel):
    id: str
    url: str
    filename: str

    model_config = ConfigDict(from_attributes=True)


class VINClaimRequest(BaseModel):
    vin: str
    rc_attachment_id: str | None = None


class VINClaimResult(BaseModel):
    status: Literal["registered", "already_owned", "transfer_requested"]
    vin: str
    transfer_id: str | None = None


class VINTransferOut(BaseModel):
    id: str
    vin: str
    requester_name: str
    requester_email: str
    current_owner_id: str | None = None
    rc_attachment_id: str | None = None
    status: str
    requested_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DecisionRequest(BaseModel):
    # The actor is taken from the authenticated token, never from the request body.
    decision: Literal["approve", "reject", "escalate"]


class TicketOut(BaseModel):
    id: str
    customer_id: str | None = None
    vehicle_vin: str | None = None
    classification: str | None = None
    priority: str
    status: str
    apqc_process: str | None = None
    domain: str | None = None
    summary: str
    recommendation: dict | None = None
    agent_trace: list | None = None
    human_decision: str | None = None
    # Who finalized it: a manager's actor id, or "system:auto" when the pipeline
    # auto-finalized (high-confidence/low-fraud approve, or a clean reject).
    human_actor: str | None = None
    claim_number: str | None = None
    claim_id: str | None = None
    attachments: list[AttachmentOut] = []

    model_config = ConfigDict(from_attributes=True)


class CustomerTicketOut(BaseModel):
    """Redacted ticket view for customer-role callers.
    Strips fraud scores and internal agent reasoning that customers must not see."""

    id: str
    vehicle_vin: str | None = None
    domain: str | None = None
    status: str
    summary: str
    claim_number: str | None = None
    decision: str | None = None
    decision_message: str | None = None
    attachments: list[AttachmentOut] = []

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def from_ticket(cls, t: object) -> "CustomerTicketOut":
        rec = getattr(t, "recommendation", None) or {}
        return cls(
            id=getattr(t, "id", ""),
            vehicle_vin=getattr(t, "vehicle_vin", None),
            domain=getattr(t, "domain", None),
            status=getattr(t, "status", ""),
            summary=getattr(t, "summary", ""),
            claim_number=getattr(t, "claim_number", None),
            decision=rec.get("final_decision") if isinstance(rec, dict) else None,
            decision_message=rec.get("draft_email") if isinstance(rec, dict) else None,
            attachments=getattr(t, "attachments", []),
        )


# --------------------------------------------------------------------------- #
# Recall + Parts LLM decision objects
# --------------------------------------------------------------------------- #
class RecallAssessment(BaseModel):
    severity: Literal["low", "medium", "high", "critical"]
    recommended_action: Literal["monitor", "notify", "stop_use", "immediate_recall"]
    reasoning: str
    timeline_days: int = Field(
        description="days to complete customer outreach"
    )


class RecallComms(BaseModel):
    subject: str
    body: str
    urgency: Literal["routine", "urgent", "emergency"]


class PartsRecommendation(BaseModel):
    action: Literal["ready_for_service", "order_required", "out_of_stock"]
    reasoning: str
    order_quantity: int = Field(default=0)
    customer_message: str


# --------------------------------------------------------------------------- #
# Recall API read schema
# --------------------------------------------------------------------------- #
class RecallOut(BaseModel):
    id: str
    code: str
    model: str
    year: int
    component: str
    description: str
    status: str
    affected_count: int = 0

    model_config = ConfigDict(from_attributes=True)


# --------------------------------------------------------------------------- #
# Warranty claim read schemas
# --------------------------------------------------------------------------- #
class ClaimLineOut(BaseModel):
    id: str
    line_type: str
    reference: str
    description: str
    quantity: float
    unit_cost: float
    line_total: float

    model_config = ConfigDict(from_attributes=True)


class WarrantyClaimOut(BaseModel):
    id: str
    claim_number: str
    ticket_id: str | None = None
    vehicle_vin: str | None = None
    customer_id: str | None = None
    component: str | None = None
    fault_code: str | None = None
    labor_hours: float
    labor_rate: float
    labor_cost: float
    parts_cost: float
    total_cost: float
    approved_amount: float | None = None
    currency: str
    status: str
    supplier_recoverable: bool
    recovered_amount: float
    decided_by: str | None = None
    submitted_at: datetime
    decided_at: datetime | None = None
    paid_at: datetime | None = None
    lines: list[ClaimLineOut] = []

    model_config = ConfigDict(from_attributes=True)


class SupplierRecoveryOut(BaseModel):
    """API view of a supplier cost-recovery claim (APQC 6.7.4)."""

    id: str
    claim_id: str
    claim_number: str | None = None
    supplier_id: str | None = None
    supplier_name: str | None = None
    amount: float
    currency: str
    status: str
    draft_subject: str
    draft_body: str
    created_by: str | None = None
    decided_by: str | None = None
    created_at: datetime
    sent_at: datetime | None = None
    recovered_at: datetime | None = None


# --------------------------------------------------------------------------- #
# Audit log read schema
# --------------------------------------------------------------------------- #
class AuditLogOut(BaseModel):
    id: str
    timestamp: datetime
    actor_type: str
    actor_id: str
    action: str
    resource_type: str
    resource_id: str | None = None
    after_state: dict | None = None

    model_config = ConfigDict(from_attributes=True)
