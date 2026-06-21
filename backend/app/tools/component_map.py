"""Map a customer's free-text component to the policy's coverage vocabulary.

Customers (and the intake LLM) name the *specific part* — "alternator", "AC
compressor", "brake pads". Warranty policies, the parts catalogue, and claim codes
all key off broad *categories* — "electrical", "ac", "brakes". Coverage matching is
an exact string compare, so without this bridge "alternator" never matches the
"electrical" coverage line and every such claim wrongly rejects.

Deterministic on purpose: coverage and cost routing must be auditable, so this is a
plain keyword map, never an LLM call. Unknown input is returned cleaned-but-unchanged
so it still flows through (and fails coverage) exactly as before.
"""

from __future__ import annotations

import re

# The canonical categories used by policies / parts_inventory / claim_codes (see seed).
CANONICAL: set[str] = {
    "ac", "engine", "transmission", "electrical", "brakes", "infotainment", "battery",
}

# Category -> substrings that should resolve to it. Order matters: the first category
# with a matching keyword wins, so list more specific terms under the right category.
_SYNONYMS: dict[str, list[str]] = {
    "ac": ["ac", "a/c", "air conditioner", "air conditioning", "aircon",
            "compressor", "cooling", "climate", "hvac"],
    "brakes": ["brake", "brakes", "brake pad", "brake pads", "rotor", "caliper",
               "disc pad"],
    "transmission": ["transmission", "gearbox", "gear box", "gear", "gears", "clutch"],
    "electrical": ["electrical", "electric", "alternator", "wiring", "charging",
                   "spark plug", "fuse", "ecu", "sensor", "starter motor", "ignition"],
    "infotainment": ["infotainment", "head unit", "touchscreen", "screen", "display",
                     "stereo", "audio", "navigation", "speaker"],
    "engine": ["engine", "motor", "piston", "timing belt", "head gasket", "cylinder",
               "turbo", "radiator", "coolant", "overheating", "overheat"],
    "battery": ["battery"],
}


def canonical_component(raw: str | None) -> str:
    """Resolve free-text component → a canonical coverage category.

    Returns "" for empty input; returns the cleaned original when nothing matches
    (so genuinely-unknown components still flow through and fail coverage as before).
    """
    if not raw:
        return ""
    s = raw.strip().lower()
    if s in CANONICAL:
        return s
    # Whole-word match so short tokens like "ac" don't match inside "capacitor".
    for category, keywords in _SYNONYMS.items():
        if any(re.search(rf"(?<!\w){re.escape(kw)}(?!\w)", s) for kw in keywords):
            return category
    return s
