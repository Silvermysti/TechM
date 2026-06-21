"""Free-text component -> canonical coverage category."""

import pytest

from app.tools.component_map import canonical_component


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("alternator", "electrical"),
        ("Alternator", "electrical"),
        ("battery keeps draining", "battery"),
        ("AC compressor", "ac"),
        ("air conditioning", "ac"),
        ("brake pads", "brakes"),
        ("gearbox", "transmission"),
        ("clutch", "transmission"),
        ("infotainment screen", "infotainment"),
        ("engine", "engine"),
        ("electrical", "electrical"),   # already canonical
        ("", ""),                         # empty stays empty
        (None, ""),                       # None stays empty
        ("flux capacitor", "flux capacitor"),  # unknown -> cleaned original
    ],
)
def test_canonical_component(raw, expected):
    assert canonical_component(raw) == expected
