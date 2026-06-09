"""TDD: warranty eligibility pure logic.

`is_covered` decides coverage from plain values (no DB), so it is trivially testable.
"""

from datetime import date

from app.tools.warranty_check import is_covered


PURCHASE = date(2026, 3, 1)
COVERED = ["ac", "engine", "transmission"]


def test_covered_component_within_window():
    result = is_covered(
        purchase_date=PURCHASE,
        duration_months=36,
        covered_components=COVERED,
        claim_date=date(2026, 6, 1),
        component="ac",
    )
    assert result["covered"] is True
    assert result["expires_on"] == date(2029, 3, 1)


def test_component_not_in_policy():
    result = is_covered(
        purchase_date=PURCHASE,
        duration_months=36,
        covered_components=COVERED,
        claim_date=date(2026, 6, 1),
        component="brakes",
    )
    assert result["covered"] is False
    assert "not covered" in result["reason"].lower()


def test_warranty_expired():
    result = is_covered(
        purchase_date=date(2020, 1, 1),
        duration_months=36,
        covered_components=COVERED,
        claim_date=date(2026, 6, 1),
        component="ac",
    )
    assert result["covered"] is False
    assert "expired" in result["reason"].lower()


def test_component_match_is_case_insensitive():
    result = is_covered(
        purchase_date=PURCHASE,
        duration_months=36,
        covered_components=COVERED,
        claim_date=date(2026, 6, 1),
        component="AC",
    )
    assert result["covered"] is True


def test_claim_on_last_valid_day_is_covered():
    # expiry = purchase + 36 months = 2029-03-01; a claim that day is still covered
    result = is_covered(
        purchase_date=PURCHASE,
        duration_months=36,
        covered_components=COVERED,
        claim_date=date(2029, 3, 1),
        component="engine",
    )
    assert result["covered"] is True


def test_claim_after_expiry_is_not_covered():
    result = is_covered(
        purchase_date=PURCHASE,
        duration_months=36,
        covered_components=COVERED,
        claim_date=date(2029, 3, 2),
        component="engine",
    )
    assert result["covered"] is False
    assert "expired" in result["reason"].lower()
