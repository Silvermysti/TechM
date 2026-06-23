"""SQLAlchemy ORM models.

Two groups:
  * Operational  — tickets, agent_executions, audit_log
  * Mock domain  — customers, vehicles, warranty_policies, parts_inventory, recalls

Schema mirrors plans/plan-b-unified-command-center/04-tech-stack.md, simplified for
a local demo (string UUIDs + JSON columns so it runs on Postgres and SQLite alike).
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------- #
# Mock domain data
# --------------------------------------------------------------------------- #
class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(180), unique=True, index=True)
    phone: Mapped[str] = mapped_column(String(40), default="")
    password_hash: Mapped[str] = mapped_column(String(255), default="")

    vehicles: Mapped[list["Vehicle"]] = relationship(back_populates="customer")


class Staff(Base):
    """Internal users (managers/ops). Separate from customers; carries a role."""

    __tablename__ = "staff"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(180), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(20), default="manager")
    password_hash: Mapped[str] = mapped_column(String(255), default="")


class Vehicle(Base):
    __tablename__ = "vehicles"

    vin: Mapped[str] = mapped_column(String(17), primary_key=True)
    customer_id: Mapped[str | None] = mapped_column(
        ForeignKey("customers.id"), nullable=True
    )
    model: Mapped[str] = mapped_column(String(80), default="Unknown")
    year: Mapped[int] = mapped_column(Integer, default=0)
    purchase_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    customer: Mapped["Customer | None"] = relationship(back_populates="vehicles")


class VINTransferRequest(Base):
    """Pending ownership transfer when a VIN is claimed by someone other than the
    current registered owner.

    Two-step approval: the current owner must consent FIRST (they're giving up the
    car), then a manager does final verification of the RC document. Status walks:
        pending_owner   -> waiting for the current owner to approve/reject
        pending_manager -> owner consented; waiting for manager final approval
        approved        -> manager approved; ownership has flipped
        rejected        -> denied (by either the owner or the manager)
    """

    __tablename__ = "vin_transfer_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    vin: Mapped[str] = mapped_column(String(17), index=True)
    requester_id: Mapped[str] = mapped_column(ForeignKey("customers.id"))
    current_owner_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    rc_attachment_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending_owner")
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    # When the current owner gave (or refused) consent — the first approval step.
    owner_decided_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # The final (manager) decision.
    decided_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    decided_by: Mapped[str | None] = mapped_column(String(120), nullable=True)

    requester: Mapped["Customer"] = relationship(foreign_keys=[requester_id])


class WarrantyPolicy(Base):
    __tablename__ = "warranty_policies"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    model: Mapped[str] = mapped_column(String(80))
    duration_months: Mapped[int] = mapped_column(Integer)
    # list of covered component names, e.g. ["ac", "engine", "transmission"]
    covered_components: Mapped[list] = mapped_column(JSON, default=list)


class Supplier(Base):
    """Part vendor — the counterparty for warranty cost recovery (APQC 6.7.4)."""

    __tablename__ = "suppliers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    code: Mapped[str] = mapped_column(String(40))
    name: Mapped[str] = mapped_column(String(120))
    is_oem: Mapped[bool] = mapped_column(Boolean, default=False)
    recovery_email: Mapped[str] = mapped_column(String(180), default="")


class PartInventory(Base):
    __tablename__ = "parts_inventory"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    part_name: Mapped[str] = mapped_column(String(120))
    sku: Mapped[str] = mapped_column(String(60))
    component: Mapped[str] = mapped_column(String(60), default="")
    stock_qty: Mapped[int] = mapped_column(Integer, default=0)
    eta_days: Mapped[int] = mapped_column(Integer, default=0)
    unit_price: Mapped[float] = mapped_column(Float, default=0.0)  # warranty part price
    supplier: Mapped[str] = mapped_column(String(120), default="")
    supplier_id: Mapped[str | None] = mapped_column(
        ForeignKey("suppliers.id"), nullable=True
    )


class ClaimCode(Base):
    """Fault / labor-operation catalog: standard repair time + rate per component.

    The backbone of warranty costing — every OEM keeps a coded list of repair
    operations with a 'standard repair time' so labor cost is consistent and auditable.
    """

    __tablename__ = "claim_codes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    code: Mapped[str] = mapped_column(String(40))  # e.g. "LAB-AC-001"
    component: Mapped[str] = mapped_column(String(60))
    description: Mapped[str] = mapped_column(String(160), default="")
    standard_labor_hours: Mapped[float] = mapped_column(Float, default=0.0)
    labor_rate: Mapped[float] = mapped_column(Float, default=0.0)  # currency / hour
    coverage_category: Mapped[str] = mapped_column(String(40), default="general")


class Recall(Base):
    __tablename__ = "recalls"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    code: Mapped[str] = mapped_column(String(40))
    model: Mapped[str] = mapped_column(String(80))
    year: Mapped[int] = mapped_column(Integer)
    component: Mapped[str] = mapped_column(String(60))
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(30), default="open")


# --------------------------------------------------------------------------- #
# Operational data
# --------------------------------------------------------------------------- #
class Ticket(Base):
    __tablename__ = "tickets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    customer_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    vehicle_vin: Mapped[str | None] = mapped_column(String(17), nullable=True)
    classification: Mapped[str | None] = mapped_column(String(60), nullable=True)
    priority: Mapped[str] = mapped_column(String(10), default="normal")
    status: Mapped[str] = mapped_column(String(30), default="submitted")
    apqc_process: Mapped[str | None] = mapped_column(String(10), nullable=True)
    domain: Mapped[str | None] = mapped_column(String(20), nullable=True)
    component: Mapped[str | None] = mapped_column(String(60), nullable=True)
    summary: Mapped[str] = mapped_column(Text, default="")
    recommendation: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    agent_trace: Mapped[list | None] = mapped_column(JSON, default=list)
    human_decision: Mapped[str | None] = mapped_column(String(20), nullable=True)
    human_actor: Mapped[str | None] = mapped_column(String(120), nullable=True)
    thread_id: Mapped[str | None] = mapped_column(String(60), nullable=True)
    claim_number: Mapped[str | None] = mapped_column(String(30), nullable=True)
    claim_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # Post-resolution customer satisfaction (APQC 6.7.5.1): 1-5 rating + optional note.
    csat_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    csat_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    attachments: Mapped[list["Attachment"]] = relationship(
        "Attachment", back_populates="ticket", lazy="selectin"
    )


class Attachment(Base):
    """Customer-uploaded evidence (photos). Uploaded during intake against a chat
    session_id, then linked to the ticket once one is created."""

    __tablename__ = "attachments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str | None] = mapped_column(String(60), nullable=True, index=True)
    ticket_id: Mapped[str | None] = mapped_column(
        ForeignKey("tickets.id"), nullable=True, index=True
    )
    filename: Mapped[str] = mapped_column(String(255), default="")
    content_type: Mapped[str] = mapped_column(String(100), default="")
    stored_name: Mapped[str] = mapped_column(String(255), default="")
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    ticket: Mapped["Ticket | None"] = relationship("Ticket", back_populates="attachments")

    @property
    def url(self) -> str:
        # Served behind auth (GET /api/v1/attachments/{id}); not a public static path.
        return f"/api/v1/attachments/{self.id}"


class AgentExecution(Base):
    __tablename__ = "agent_executions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    ticket_id: Mapped[str | None] = mapped_column(
        ForeignKey("tickets.id"), nullable=True
    )
    agent_name: Mapped[str] = mapped_column(String(60))
    apqc_ref: Mapped[str | None] = mapped_column(String(10), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    output: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    model_used: Mapped[str | None] = mapped_column(String(60), nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    actor_type: Mapped[str] = mapped_column(String(10))  # 'agent' | 'human'
    actor_id: Mapped[str] = mapped_column(String(120))
    action: Mapped[str] = mapped_column(String(120))
    resource_type: Mapped[str] = mapped_column(String(50), default="")
    resource_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    before_state: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    after_state: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class WarrantyClaim(Base):
    """The financial warranty record — what a warranty system actually keeps.

    One claim per approved warranty ticket. Holds the costed breakdown (labor + parts),
    the approved amount, the status lifecycle, and supplier-recovery linkage.
    """

    __tablename__ = "warranty_claims"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    claim_number: Mapped[str] = mapped_column(String(30), unique=True)  # WC-2026-000123
    ticket_id: Mapped[str | None] = mapped_column(ForeignKey("tickets.id"), nullable=True)
    vehicle_vin: Mapped[str | None] = mapped_column(String(17), nullable=True)
    customer_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    component: Mapped[str | None] = mapped_column(String(60), nullable=True)
    fault_code: Mapped[str | None] = mapped_column(String(40), nullable=True)
    odometer_km: Mapped[int | None] = mapped_column(Integer, nullable=True)

    labor_hours: Mapped[float] = mapped_column(Float, default=0.0)
    labor_rate: Mapped[float] = mapped_column(Float, default=0.0)
    labor_cost: Mapped[float] = mapped_column(Float, default=0.0)
    parts_cost: Mapped[float] = mapped_column(Float, default=0.0)
    total_cost: Mapped[float] = mapped_column(Float, default=0.0)
    approved_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    currency: Mapped[str] = mapped_column(String(3), default="INR")

    # draft | submitted | approved | rejected | paid | closed
    status: Mapped[str] = mapped_column(String(20), default="submitted")

    supplier_id: Mapped[str | None] = mapped_column(
        ForeignKey("suppliers.id"), nullable=True
    )
    supplier_recoverable: Mapped[bool] = mapped_column(Boolean, default=False)
    recovered_amount: Mapped[float] = mapped_column(Float, default=0.0)

    decided_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now
    )
    decided_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    paid_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    lines: Mapped[list["WarrantyClaimLine"]] = relationship(
        back_populates="claim", cascade="all, delete-orphan"
    )


class WarrantyClaimLine(Base):
    """Itemized parts/labor line on a claim — how the total is actually built up."""

    __tablename__ = "warranty_claim_lines"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    claim_id: Mapped[str] = mapped_column(ForeignKey("warranty_claims.id"))
    line_type: Mapped[str] = mapped_column(String(10))  # 'part' | 'labor'
    reference: Mapped[str] = mapped_column(String(60), default="")  # SKU or op code
    description: Mapped[str] = mapped_column(String(160), default="")
    quantity: Mapped[float] = mapped_column(Float, default=1.0)  # qty or hours
    unit_cost: Mapped[float] = mapped_column(Float, default=0.0)
    line_total: Mapped[float] = mapped_column(Float, default=0.0)

    claim: Mapped["WarrantyClaim"] = relationship(back_populates="lines")


class SupplierRecovery(Base):
    """A cost-recovery claim against a supplier (APQC 6.7.4).

    Created when a manager acts on an approved, supplier-recoverable warranty claim.
    Lifecycle: draft (AI-drafted, not sent) -> sent -> recovered.
    """

    __tablename__ = "supplier_recoveries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    claim_id: Mapped[str] = mapped_column(ForeignKey("warranty_claims.id"), unique=True)
    supplier_id: Mapped[str | None] = mapped_column(
        ForeignKey("suppliers.id"), nullable=True
    )
    amount: Mapped[float] = mapped_column(Float, default=0.0)
    currency: Mapped[str] = mapped_column(String(3), default="INR")

    status: Mapped[str] = mapped_column(String(20), default="draft")  # draft|sent|recovered
    draft_subject: Mapped[str] = mapped_column(String(200), default="")
    draft_body: Mapped[str] = mapped_column(Text, default="")

    created_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    decided_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    recovered_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class IntakeSession(Base):
    """Durable guided-intake conversation state (replaces the in-memory dict so the
    chat survives restarts and works across multiple workers). Expired by TTL."""

    __tablename__ = "intake_sessions"

    session_id: Mapped[str] = mapped_column(String(60), primary_key=True)
    customer_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    history: Mapped[list] = mapped_column(JSON, default=list)
    asked: Mapped[int] = mapped_column(Integer, default=0)
    vin: Mapped[str | None] = mapped_column(String(17), nullable=True)
    category: Mapped[str | None] = mapped_column(String(20), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now
    )


class Counter(Base):
    """Atomic named counters (e.g. warranty claim sequence) — increment under the
    DB's write serialization so generated reference numbers never collide."""

    __tablename__ = "counters"

    name: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[int] = mapped_column(Integer, default=0)


__all__ = [
    "Customer",
    "Staff",
    "IntakeSession",
    "Counter",
    "Vehicle",
    "WarrantyPolicy",
    "Supplier",
    "PartInventory",
    "ClaimCode",
    "Recall",
    "Ticket",
    "AgentExecution",
    "AuditLog",
    "WarrantyClaim",
    "WarrantyClaimLine",
]
