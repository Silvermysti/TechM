"""Pydantic schemas: LLM decision objects + API request/response contracts.

The LLM decision schemas are what we pass to `with_structured_output`, so the model
is constrained to return exactly these shapes.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# --------------------------------------------------------------------------- #
# LLM decision objects (structured output)
# --------------------------------------------------------------------------- #
class ExtractedFields(BaseModel):
    vin: str | None = None
    component: str | None = Field(
        None, description="affected part, e.g. ac, brakes, engine"
    )
    symptom: str | None = None
    onset: str | None = Field(None, description="when the problem started")


class IntakeDecision(BaseModel):
    """Result of the intake agent reading the conversation so far."""

    enough_info: bool = Field(
        description="true if we have enough to create and route a ticket"
    )
    follow_up_question: str | None = Field(
        None, description="one clarifying question to ask if not enough info"
    )
    domain: Literal[
        "warranty", "recall", "parts", "customer", "quality", "service"
    ] | None = None
    apqc_process: str | None = Field(None, description="APQC ref, e.g. 6.7.3")
    summary: str | None = Field(None, description="one-line summary of the issue")
    extracted: ExtractedFields = Field(default_factory=ExtractedFields)
    request_image: bool = Field(
        False,
        description=(
            "true when the issue would be visible in a photograph and the customer "
            "has not attached one yet"
        ),
    )


class FraudAssessment(BaseModel):
    fraud_risk: float = Field(ge=0.0, le=1.0)
    reasoning: str


class WarrantyRecommendation(BaseModel):
    decision: Literal["approve", "reject", "escalate"]
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning: str
    draft_email: str


# --------------------------------------------------------------------------- #
# API contracts
# --------------------------------------------------------------------------- #
class LoginRequest(BaseModel):
    email: str
    password: str


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
    claim_number: str | None = None
    claim_id: str | None = None
    attachments: list[AttachmentOut] = []

    model_config = ConfigDict(from_attributes=True)


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
