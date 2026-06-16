"""TDD: warranty_evidence node — vision AI photo assessment.

Tests cover:
1. Skip gracefully when no attachments → returns empty dict, pipeline unaffected.
2. Skip gracefully when image file is missing from disk → returns empty dict.
3. Correct output shape and agent_outputs entry when vision call succeeds (mocked).
"""

from unittest.mock import MagicMock, patch

import pytest

from app.core.langgraph.domains.warranty import warranty_evidence
from app.schemas import EvidenceAssessment


# ── helpers ───────────────────────────────────────────────────────────────────

def _state(**kwargs):
    return {
        "summary": "AC stopped working",
        "component": "ac",
        "agent_outputs": [],
        **kwargs,
    }


_SAMPLE_ASSESSMENT = EvidenceAssessment(
    photo_matches_claim=True,
    damage_visible=True,
    confidence=0.85,
    notes="The photo shows a visibly damaged AC compressor with cracked housing.",
)


# ── tests ─────────────────────────────────────────────────────────────────────

def test_skips_when_no_attachments():
    """No attachment_ids → returns empty dict (node is a no-op)."""
    result = warranty_evidence(_state(attachment_ids=[]))
    assert result == {}


def test_skips_when_attachment_ids_missing_from_state():
    """attachment_ids key absent → treated as no photos, returns empty dict."""
    result = warranty_evidence(_state())
    assert result == {}


def test_skips_when_db_attachment_not_found():
    """DB lookup returns None → returns empty dict, no exception raised."""
    with patch(
        "app.core.langgraph.domains.warranty._load_first_image",
        return_value=None,
    ):
        result = warranty_evidence(_state(attachment_ids=["nonexistent-id"]))
    assert result == {}


def test_evidence_output_shape_when_vision_succeeds():
    """When _load_first_image and llm.decide_vision succeed, the node returns
    the assessment in context['evidence'] and appends to agent_outputs."""
    fake_b64 = "aGVsbG8="  # base64("hello") — not a real image, but shape-correct

    with (
        patch(
            "app.core.langgraph.domains.warranty._load_first_image",
            return_value=(fake_b64, "image/jpeg"),
        ),
        patch(
            "app.services.llm.decide_vision",
            return_value=_SAMPLE_ASSESSMENT,
        ),
    ):
        result = warranty_evidence(_state(attachment_ids=["att-001"]))

    assert "context" in result
    evidence = result["context"]["evidence"]
    assert evidence["photo_matches_claim"] is True
    assert evidence["damage_visible"] is True
    assert 0.0 <= evidence["confidence"] <= 1.0
    assert isinstance(evidence["notes"], str)

    assert "agent_outputs" in result
    assert len(result["agent_outputs"]) == 1
    step = result["agent_outputs"][0]
    assert step["agent"] == "Evidence Assessment Specialist"
    assert step["apqc"] == "6.7.3.3"
    assert step["output"] == evidence


def test_evidence_preserves_existing_agent_outputs():
    """The node appends to existing agent_outputs without losing prior steps."""
    prior = [{"agent": "Intake Specialist", "apqc": "6.7.3", "output": {}}]
    fake_b64 = "aGVsbG8="

    with (
        patch(
            "app.core.langgraph.domains.warranty._load_first_image",
            return_value=(fake_b64, "image/jpeg"),
        ),
        patch(
            "app.services.llm.decide_vision",
            return_value=_SAMPLE_ASSESSMENT,
        ),
    ):
        result = warranty_evidence(_state(attachment_ids=["att-001"], agent_outputs=prior))

    assert len(result["agent_outputs"]) == 2
    assert result["agent_outputs"][0]["agent"] == "Intake Specialist"
    assert result["agent_outputs"][1]["agent"] == "Evidence Assessment Specialist"
