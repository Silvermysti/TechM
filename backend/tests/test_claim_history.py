"""TDD: claim-history fraud signal tool.

Tests use the session-scoped seeded DB from conftest. Each test inserts its own
tickets under isolated VINs so there is no cross-test bleed, and cleans up after.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.tools.claim_history import get_claim_history

_FUTURE_VIN = "MA3HIST000000FRESH"
_REPEAT_VIN = "MA3HIST000000REPET"
_CUST_ID = "cust-hist-test-001"


@pytest.fixture
def db():
    from app.db.session import SessionLocal
    session = SessionLocal()
    yield session
    session.close()


@pytest.fixture
def insert_ticket(db):
    """Insert tickets and clean them up after the test."""
    from app.models import Ticket

    inserted: list[str] = []

    def _make(vin=None, customer_id=None, component=None, days_ago=10):
        created = datetime.now(timezone.utc) - timedelta(days=days_ago)
        t = Ticket(
            vehicle_vin=vin,
            customer_id=customer_id,
            component=component,
            summary="test claim",
            domain="warranty",
            status="resolved",
            created_at=created,
        )
        db.add(t)
        db.commit()
        db.refresh(t)
        inserted.append(t.id)
        return t

    yield _make

    for tid in inserted:
        t = db.get(Ticket, tid)  # type: ignore[type-abstract]
        if t:
            db.delete(t)
    db.commit()


# ------------------------------------------------------------------ #
# No prior claims
# ------------------------------------------------------------------ #
def test_no_prior_claims_fresh_vin(db):
    result = get_claim_history(db, vin="MA3NOCLAIMXXX0001", customer_id=None, component="ac")
    assert result["total_prior"] == 0
    assert result["repeat_flag"] is False
    assert "No prior" in result["summary"]


def test_no_prior_claims_when_no_identifiers(db):
    result = get_claim_history(db, vin=None, customer_id=None, component="engine")
    assert result["total_prior"] == 0


# ------------------------------------------------------------------ #
# Count by VIN
# ------------------------------------------------------------------ #
def test_counts_prior_claims_by_vin(db, insert_ticket):
    insert_ticket(vin=_FUTURE_VIN, component="ac")
    insert_ticket(vin=_FUTURE_VIN, component="engine")

    result = get_claim_history(db, vin=_FUTURE_VIN, customer_id=None, component="brakes")
    assert result["total_prior"] == 2
    assert result["same_component"] == 0


# ------------------------------------------------------------------ #
# Same-component counting
# ------------------------------------------------------------------ #
def test_same_component_count(db, insert_ticket):
    insert_ticket(vin=_REPEAT_VIN, component="ac")
    insert_ticket(vin=_REPEAT_VIN, component="ac")
    insert_ticket(vin=_REPEAT_VIN, component="engine")

    result = get_claim_history(db, vin=_REPEAT_VIN, customer_id=None, component="ac")
    assert result["same_component"] == 2
    assert result["total_prior"] == 3


# ------------------------------------------------------------------ #
# Repeat flag fires at threshold
# ------------------------------------------------------------------ #
def test_repeat_flag_fires_at_threshold(db, insert_ticket):
    for _ in range(3):
        insert_ticket(vin="MA3HIST000000FLAG1", component="transmission")

    result = get_claim_history(db, vin="MA3HIST000000FLAG1", customer_id=None, component="transmission")
    assert result["repeat_flag"] is True
    assert "REPEAT" in result["summary"]


def test_repeat_flag_does_not_fire_below_threshold(db, insert_ticket):
    for _ in range(2):
        insert_ticket(vin="MA3HIST000000FLAG2", component="transmission")

    result = get_claim_history(db, vin="MA3HIST000000FLAG2", customer_id=None, component="transmission")
    assert result["repeat_flag"] is False


# ------------------------------------------------------------------ #
# Recent-90d count
# ------------------------------------------------------------------ #
def test_recent_90d_excludes_old_claims(db, insert_ticket):
    insert_ticket(vin="MA3HIST000000RECD1", component="ac", days_ago=10)   # recent
    insert_ticket(vin="MA3HIST000000RECD1", component="ac", days_ago=200)  # old

    result = get_claim_history(db, vin="MA3HIST000000RECD1", customer_id=None, component="ac")
    assert result["total_prior"] == 2
    assert result["recent_90d"] == 1


# ------------------------------------------------------------------ #
# exclude_ticket_id keeps the current ticket out of history
# ------------------------------------------------------------------ #
def test_exclude_current_ticket(db, insert_ticket):
    t = insert_ticket(vin="MA3HIST000000EXC01", component="ac")
    insert_ticket(vin="MA3HIST000000EXC01", component="ac")

    result = get_claim_history(
        db, vin="MA3HIST000000EXC01", customer_id=None, component="ac",
        exclude_ticket_id=t.id,
    )
    assert result["total_prior"] == 1
