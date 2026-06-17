"""TDD: responsible-party determination (APQC 6.7.3.4).

Determines who bears the warranty cost — supplier (recoverable), manufacturer, or
indeterminate. Deterministic (no LLM): money routing must be auditable.

Covers:
1. Non-OEM supplier part → party=supplier, recoverable, supplier named.
2. OEM part → party=manufacturer, not recoverable.
3. Component with no part mapping → manufacturer.
4. Missing component → indeterminate.
5. The warranty_responsible_party node writes context + an APQC-6.7.3.4 agent output.
"""

from app.db.session import SessionLocal
from app.tools.responsible_party import determine_responsible_party
from app.core.langgraph.domains.warranty import warranty_responsible_party


# ── tool ────────────────────────────────────────────────────────────────────

def test_non_oem_part_is_recoverable_from_supplier():
    """Brakes map to Bosch India (non-OEM) → supplier bears the cost."""
    db = SessionLocal()
    try:
        result = determine_responsible_party(db, component="brakes")
    finally:
        db.close()
    assert result["party"] == "supplier"
    assert result["recoverable_from_supplier"] is True
    assert result["supplier_name"] == "Bosch India"
    assert result["is_oem"] is False
    assert result["reasoning"]


def test_oem_part_is_manufacturer_responsibility():
    """Transmission maps to OEM Parts Co. (is_oem) → manufacturer bears the cost."""
    db = SessionLocal()
    try:
        result = determine_responsible_party(db, component="transmission")
    finally:
        db.close()
    assert result["party"] == "manufacturer"
    assert result["recoverable_from_supplier"] is False
    assert result["is_oem"] is True


def test_component_without_part_is_manufacturer():
    """Engine has a claim code but no inventory part → no external supplier → manufacturer."""
    db = SessionLocal()
    try:
        result = determine_responsible_party(db, component="engine")
    finally:
        db.close()
    assert result["party"] == "manufacturer"
    assert result["recoverable_from_supplier"] is False
    assert result["supplier_id"] is None


def test_missing_component_is_indeterminate():
    db = SessionLocal()
    try:
        result = determine_responsible_party(db, component=None)
    finally:
        db.close()
    assert result["party"] == "indeterminate"
    assert result["recoverable_from_supplier"] is False


# ── node ────────────────────────────────────────────────────────────────────

def test_node_writes_context_and_apqc_output():
    state = {"component": "brakes", "agent_outputs": []}
    update = warranty_responsible_party(state)

    determination = update["context"]["responsible_party"]
    assert determination["party"] == "supplier"
    assert determination["recoverable_from_supplier"] is True

    outputs = update["agent_outputs"]
    assert len(outputs) == 1
    assert outputs[0]["apqc"] == "6.7.3.4"
    assert outputs[0]["agent"] == "Responsible Party Specialist"


def test_node_preserves_existing_outputs():
    state = {"component": "transmission", "agent_outputs": [{"agent": "prior", "output": {}}]}
    update = warranty_responsible_party(state)
    assert len(update["agent_outputs"]) == 2
    assert update["agent_outputs"][0]["agent"] == "prior"
