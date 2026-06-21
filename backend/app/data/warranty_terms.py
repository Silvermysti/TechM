"""The warranty-terms knowledge base that Policy RAG retrieves from.

These are the *actual contract clauses* — the words the AI quotes when it explains a
decision. Today the coverage check only sees a list of component categories; this gives
the AI real sentences to cite (e.g. "Denied per Clause SWIFT-BRK-01"), so it stops
paraphrasing warranty terms from memory (which is where models hallucinate).

Each clause is scoped to a model ("Swift VXI") or to "ALL" (applies to every vehicle —
the general exclusions). The retrieval service embeds every clause once and, for a given
claim, returns the handful most similar in meaning to the customer's description.

Plain text on purpose: a human can read and audit exactly what the AI was shown.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Clause:
    id: str          # human-readable citation handle, e.g. "SWIFT-AC-01"
    model: str       # the vehicle model this applies to, or "ALL" for general terms
    component: str   # canonical category this clause is about, or "general"
    text: str        # the clause wording the AI will quote


# ---------------------------------------------------------------------------
# General terms — apply to EVERY vehicle ("ALL"). These are the exclusions and
# conditions that decide most denials, so they matter a lot for the demo.
# ---------------------------------------------------------------------------
_GENERAL: list[Clause] = [
    Clause("GEN-WEAR-01", "ALL", "general",
           "Normal wear-and-tear items — including brake pads, brake discs, clutch "
           "friction plates, wiper blades, tyres, and light bulbs — are consumables "
           "and are excluded from warranty coverage regardless of vehicle age."),
    Clause("GEN-VOID-01", "ALL", "general",
           "Warranty coverage is void if the vehicle has been used in racing, rallying, "
           "or any motorsport or competitive event, or has been overloaded beyond its "
           "rated capacity."),
    Clause("GEN-MOD-01", "ALL", "general",
           "Coverage is void for any component affected by unauthorised modification, "
           "non-genuine parts, or repairs carried out by an unauthorised workshop."),
    Clause("GEN-MAINT-01", "ALL", "general",
           "Claims may be declined where the customer has failed to follow the scheduled "
           "maintenance set out in the owner's manual, or cannot produce service records."),
    Clause("GEN-CLAIM-01", "ALL", "general",
           "A valid claim requires the failure to be reported during the coverage period "
           "and the vehicle made available for inspection at an authorised service centre."),
    Clause("GEN-DAMAGE-01", "ALL", "general",
           "Damage caused by accident, misuse, flood, fire, or external impact is not a "
           "manufacturing defect and is excluded from warranty."),
]


# ---------------------------------------------------------------------------
# Per-model coverage clauses. The covered components and durations here mirror
# the seeded WarrantyPolicy rows so the RAG citation agrees with the DB check.
# ---------------------------------------------------------------------------
_SWIFT: list[Clause] = [
    Clause("SWIFT-DUR-01", "Swift VXI", "general",
           "The Swift VXI standard warranty runs for 36 months from the date of purchase "
           "or 100,000 km, whichever occurs first."),
    Clause("SWIFT-AC-01", "Swift VXI", "ac",
           "The air-conditioning system, including the compressor, condenser, and cooling "
           "circuit, is covered against manufacturing defects for the full 36-month "
           "warranty period on the Swift VXI."),
    Clause("SWIFT-ENG-01", "Swift VXI", "engine",
           "The engine and its internal components are covered against manufacturing "
           "defects for 36 months on the Swift VXI."),
    Clause("SWIFT-TRN-01", "Swift VXI", "transmission",
           "The transmission and gearbox assembly is covered against manufacturing "
           "defects for 36 months on the Swift VXI."),
    Clause("SWIFT-ELE-01", "Swift VXI", "electrical",
           "Electrical components — including the alternator, starter motor, wiring "
           "harness, and charging system — are covered for 36 months on the Swift VXI. "
           "The battery is treated as a consumable and is excluded."),
]

_CITY: list[Clause] = [
    Clause("CITY-DUR-01", "Honda City", "general",
           "The Honda City warranty runs for 36 months from purchase or 100,000 km, "
           "whichever occurs first."),
    Clause("CITY-ENG-01", "Honda City", "engine",
           "The engine and powertrain are covered against manufacturing defects for "
           "36 months on the Honda City."),
    Clause("CITY-TRN-01", "Honda City", "transmission",
           "The transmission assembly is covered against manufacturing defects for "
           "36 months on the Honda City."),
    Clause("CITY-BRK-01", "Honda City", "brakes",
           "Brake hydraulic and caliper assemblies are covered for 36 months on the "
           "Honda City; brake pads and discs remain wear items and are excluded."),
    Clause("CITY-ELE-01", "Honda City", "electrical",
           "Electrical components including the alternator and wiring are covered for "
           "36 months on the Honda City."),
]

_CRETA: list[Clause] = [
    Clause("CRETA-DUR-01", "Hyundai Creta", "general",
           "The Hyundai Creta extended warranty runs for 60 months from purchase or "
           "120,000 km, whichever occurs first."),
    Clause("CRETA-AC-01", "Hyundai Creta", "ac",
           "The air-conditioning system, including the compressor, is covered against "
           "manufacturing defects for 60 months on the Hyundai Creta."),
    Clause("CRETA-ENG-01", "Hyundai Creta", "engine",
           "The engine and its internal components are covered for 60 months on the "
           "Hyundai Creta."),
    Clause("CRETA-INF-01", "Hyundai Creta", "infotainment",
           "The infotainment head unit, touchscreen, and audio system are covered "
           "against manufacturing defects for 60 months on the Hyundai Creta."),
    Clause("CRETA-ELE-01", "Hyundai Creta", "electrical",
           "Electrical components including the alternator and wiring harness are "
           "covered for 60 months on the Hyundai Creta."),
]

_NEXON: list[Clause] = [
    Clause("NEXON-DUR-01", "Tata Nexon", "general",
           "The Tata Nexon warranty runs for 36 months from purchase or 100,000 km, "
           "whichever occurs first."),
    Clause("NEXON-AC-01", "Tata Nexon", "ac",
           "The air-conditioning system, including the compressor, is covered against "
           "manufacturing defects for 36 months on the Tata Nexon."),
    Clause("NEXON-BAT-01", "Tata Nexon", "battery",
           "The high-voltage / main battery pack on the Tata Nexon is covered against "
           "manufacturing defects and capacity failure for 36 months — note this is an "
           "exception to the usual battery exclusion."),
    Clause("NEXON-ENG-01", "Tata Nexon", "engine",
           "The engine and its internal components are covered for 36 months on the "
           "Tata Nexon."),
    Clause("NEXON-ELE-01", "Tata Nexon", "electrical",
           "Electrical components including the alternator and wiring are covered for "
           "36 months on the Tata Nexon."),
]


CLAUSES: list[Clause] = _GENERAL + _SWIFT + _CITY + _CRETA + _NEXON


def clauses_for_model(model: str | None) -> list[Clause]:
    """Return the clauses that apply to a vehicle: its model-specific ones plus the
    general 'ALL' terms. Falls back to every clause when the model is unknown."""
    if not model:
        return list(CLAUSES)
    model_l = model.strip().lower()
    scoped = [c for c in CLAUSES if c.model == "ALL" or c.model.lower() == model_l]
    return scoped or list(CLAUSES)
