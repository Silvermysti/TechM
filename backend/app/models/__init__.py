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
    email: Mapped[str] = mapped_column(String(180))
    phone: Mapped[str] = mapped_column(String(40), default="")

    vehicles: Mapped[list["Vehicle"]] = relationship(back_populates="customer")


class Vehicle(Base):
    __tablename__ = "vehicles"

    vin: Mapped[str] = mapped_column(String(17), primary_key=True)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.id"))
    model: Mapped[str] = mapped_column(String(80))
    year: Mapped[int] = mapped_column(Integer)
    purchase_date: Mapped[date] = mapped_column(Date)

    customer: Mapped["Customer"] = relationship(back_populates="vehicles")


class WarrantyPolicy(Base):
    __tablename__ = "warranty_policies"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    model: Mapped[str] = mapped_column(String(80))
    duration_months: Mapped[int] = mapped_column(Integer)
    # list of covered component names, e.g. ["ac", "engine", "transmission"]
    covered_components: Mapped[list] = mapped_column(JSON, default=list)


class PartInventory(Base):
    __tablename__ = "parts_inventory"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    part_name: Mapped[str] = mapped_column(String(120))
    sku: Mapped[str] = mapped_column(String(60))
    component: Mapped[str] = mapped_column(String(60), default="")
    stock_qty: Mapped[int] = mapped_column(Integer, default=0)
    eta_days: Mapped[int] = mapped_column(Integer, default=0)
    supplier: Mapped[str] = mapped_column(String(120), default="")


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
    summary: Mapped[str] = mapped_column(Text, default="")
    recommendation: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    agent_trace: Mapped[list | None] = mapped_column(JSON, default=list)
    human_decision: Mapped[str | None] = mapped_column(String(20), nullable=True)
    human_actor: Mapped[str | None] = mapped_column(String(120), nullable=True)
    thread_id: Mapped[str | None] = mapped_column(String(60), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


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


__all__ = [
    "Customer",
    "Vehicle",
    "WarrantyPolicy",
    "PartInventory",
    "Recall",
    "Ticket",
    "AgentExecution",
    "AuditLog",
]
