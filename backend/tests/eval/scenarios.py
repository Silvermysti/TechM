"""Labeled warranty-claim scenarios for the evaluation harness.

Unlike unit tests (which check that *code* runs), an eval checks the *quality of the
AI's decisions* on a fixed set of cases with known-correct answers. We run each scenario
through the real warranty pipeline and compare the decision to the label.

VINs here are the deterministic ones created by seed.py:
  * MA3DEMO00000SWIFT / MA3DEMO00001SWIFT — Swift VXI 2024 (covers: ac, engine,
    transmission, electrical), purchased 3 months ago → in warranty.
  * MA3CITY2023BRK000 — Honda City 2023 (covers: engine, transmission, brakes,
    electrical).

Each scenario's expected decision follows from coverage + a clean fraud history:
covered → approve, not-covered → reject.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Scenario:
    id: str
    vin: str
    component_raw: str          # free text, as a customer would say it
    summary: str
    expected_covered: bool
    expected_decision: str      # "approve" | "reject"


SCENARIOS: list[Scenario] = [
    Scenario(
        id="swift-ac-covered",
        vin="MA3DEMO00000SWIFT",
        component_raw="AC compressor",
        summary="The AC stopped cooling and the compressor rattles. Car is 3 months old.",
        expected_covered=True,
        expected_decision="approve",
    ),
    Scenario(
        id="swift-brakes-excluded",
        vin="MA3DEMO00000SWIFT",
        component_raw="brake pads",
        summary="My brake pads squeal and feel spongy. I'd like them replaced.",
        expected_covered=False,
        expected_decision="reject",
    ),
    Scenario(
        id="swift-electrical-covered",
        vin="MA3DEMO00001SWIFT",
        component_raw="alternator",
        summary="Alternator warning light is on and the battery drains overnight.",
        expected_covered=True,
        expected_decision="approve",
    ),
    Scenario(
        id="city-ac-not-in-policy",
        vin="MA3CITY2023BRK000",
        component_raw="air conditioning",
        summary="The air conditioning blows warm air and won't get cold.",
        expected_covered=False,
        expected_decision="reject",
    ),
    Scenario(
        id="city-transmission-covered",
        vin="MA3CITY2023BRK000",
        component_raw="gearbox",
        summary="The gearbox jerks hard when shifting and sometimes slips.",
        expected_covered=True,
        expected_decision="approve",
    ),
]
