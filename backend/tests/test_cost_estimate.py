"""Tests for warranty cost estimation and claim construction."""

from __future__ import annotations

import pytest

from app.db.session import Base, SessionLocal, engine
from app.models import (
    ClaimCode,
    PartInventory,
    Supplier,
    Ticket,
    WarrantyClaim,
    WarrantyClaimLine,
)
from app.tools.cost_estimate import build_warranty_claim, estimate_cost


@pytest.fixture()
def db():
    Base.metadata.create_all(bind=engine)
    session = SessionLocal()
    # Clean any prior rows so counts/claim numbers are deterministic.
    session.query(WarrantyClaimLine).delete()
    session.query(WarrantyClaim).delete()
    session.query(ClaimCode).delete()
    session.query(PartInventory).delete()
    session.query(Supplier).delete()
    session.commit()

    bosch = Supplier(code="BSH", name="Bosch India", is_oem=False)
    oem = Supplier(code="OEM", name="OEM Parts Co.", is_oem=True)
    session.add_all([bosch, oem])
    session.flush()

    session.add(ClaimCode(code="LAB-BRK-001", component="brakes",
                          description="Brake job", standard_labor_hours=2.0,
                          labor_rate=850, coverage_category="safety"))
    session.add(PartInventory(part_name="Brake Pad Set", sku="SKU-BRAKES",
                              component="brakes", unit_price=4500,
                              supplier="Bosch India", supplier_id=bosch.id))
    # transmission part comes from an OEM supplier (not recoverable)
    session.add(ClaimCode(code="LAB-TRN-001", component="transmission",
                          description="Transmission", standard_labor_hours=5.0,
                          labor_rate=900, coverage_category="powertrain"))
    session.add(PartInventory(part_name="Transmission Kit", sku="SKU-TRN",
                              component="transmission", unit_price=60000,
                              supplier="OEM Parts Co.", supplier_id=oem.id))
    session.commit()
    yield session
    session.close()
    # This fixture destructively rewrites the shared seeded data (claim codes/parts),
    # so restore the canonical fleet for the other test modules that rely on it
    # (e.g. tiered-autonomy routing now depends on real AC/electrical costs).
    from app.seed.seed import seed
    seed()


def test_estimate_cost_combines_labor_and_parts(db):
    est = estimate_cost(db, component="brakes")
    assert est["fault_code"] == "LAB-BRK-001"
    assert est["labor_hours"] == 2.0
    assert est["labor_cost"] == 1700.0  # 2.0 * 850
    assert est["parts_cost"] == 4500.0
    assert est["total_cost"] == 6200.0
    assert est["currency"] == "INR"


def test_estimate_cost_is_case_insensitive(db):
    assert estimate_cost(db, component="BRAKES")["total_cost"] == 6200.0


def test_estimate_cost_unknown_component_is_zero(db):
    est = estimate_cost(db, component="sunroof")
    assert est["total_cost"] == 0.0
    assert est["fault_code"] is None


def test_estimate_cost_handles_missing_component(db):
    assert estimate_cost(db, component=None)["total_cost"] == 0.0


def test_build_claim_creates_costed_record_with_lines(db):
    ticket = Ticket(vehicle_vin="VIN123", component="brakes", domain="warranty",
                    summary="brake noise", status="awaiting_approval")
    db.add(ticket)
    db.commit()

    claim = build_warranty_claim(db, ticket, decided_by="Ops Manager", odometer_km=12000)
    db.commit()

    assert claim.claim_number.startswith("WC-")
    assert claim.total_cost == 6200.0
    assert claim.approved_amount == 6200.0
    assert claim.status == "approved"
    assert claim.odometer_km == 12000
    assert claim.decided_by == "Ops Manager"
    # non-OEM (Bosch) supplier part -> recoverable
    assert claim.supplier_recoverable is True

    lines = db.query(WarrantyClaimLine).filter_by(claim_id=claim.id).all()
    kinds = {ln.line_type for ln in lines}
    assert kinds == {"labor", "part"}
    assert round(sum(ln.line_total for ln in lines), 2) == claim.total_cost


def test_build_claim_canonicalizes_freetext_component(db):
    # A customer's raw wording ("brake pads") must still cost and recover correctly:
    # the builder has to canonicalize it to the catalog component ("brakes") like the
    # pipeline does. Regression for a bug that persisted zero-cost, non-recoverable claims.
    ticket = Ticket(vehicle_vin="VIN777", component="brake pads", domain="warranty",
                    summary="brake pads worn", status="awaiting_approval")
    db.add(ticket)
    db.commit()

    claim = build_warranty_claim(db, ticket, decided_by="Ops Manager")
    db.commit()

    assert claim.total_cost > 0          # cost lookup matched the canonical component
    assert claim.parts_cost > 0
    assert claim.supplier_recoverable is True   # brakes -> Bosch India (non-OEM)
    assert claim.supplier_id is not None


def test_claim_numbers_are_unique(db):
    t1 = Ticket(vehicle_vin="VINA", component="brakes", domain="warranty",
                summary="a", status="awaiting_approval")
    t2 = Ticket(vehicle_vin="VINB", component="brakes", domain="warranty",
                summary="b", status="awaiting_approval")
    db.add_all([t1, t2])
    db.commit()

    c1 = build_warranty_claim(db, t1, decided_by="m")
    c2 = build_warranty_claim(db, t2, decided_by="m")
    db.commit()
    assert c1.claim_number != c2.claim_number


def test_build_claim_oem_part_not_recoverable(db):
    ticket = Ticket(vehicle_vin="VIN999", component="transmission", domain="warranty",
                    summary="gearbox", status="awaiting_approval")
    db.add(ticket)
    db.commit()

    claim = build_warranty_claim(db, ticket, decided_by="Ops Manager")
    db.commit()
    # OEM supplier -> the OEM eats the cost, nothing to recover from a vendor
    assert claim.supplier_recoverable is False
    assert claim.total_cost == 64500.0  # 5*900 + 60000
