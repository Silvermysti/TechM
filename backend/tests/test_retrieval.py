"""Policy RAG retrieval — does the right clause surface for a given claim?

We assert the *decisive* clause appears in the top results rather than pinning the exact
order, so the test holds for both the embeddings backend and the keyword fallback.
"""

import pytest

from app.data.warranty_terms import clauses_for_model
from app.services import retrieval
from app.services.retrieval import _KeywordBackend


@pytest.mark.parametrize(
    "query,model,expected_id",
    [
        ("brakes: my brake pads squeal and feel spongy", "Swift VXI", "GEN-WEAR-01"),
        ("ac: compressor rattles and only blows hot air", "Swift VXI", "SWIFT-AC-01"),
        ("electrical: alternator warning light, battery drains", "Swift VXI", "SWIFT-ELE-01"),
        ("battery: main battery pack lost capacity", "Tata Nexon", "NEXON-BAT-01"),
    ],
)
def test_decisive_clause_is_retrieved(query, model, expected_id):
    results = retrieval.retrieve(query, model=model, k=3)
    ids = [r["id"] for r in results]
    assert expected_id in ids


def test_model_scoping_excludes_other_models():
    # A Swift claim must never cite another model's clauses.
    results = retrieval.retrieve("ac: compressor failure", model="Swift VXI", k=5)
    for r in results:
        assert r["model"] in ("Swift VXI", "ALL")


def test_empty_query_returns_nothing():
    assert retrieval.retrieve("", model="Swift VXI") == []
    assert retrieval.retrieve("   ", model="Swift VXI") == []


def test_result_shape():
    [first] = retrieval.retrieve("ac: compressor failure", model="Swift VXI", k=1)
    assert set(first) == {"id", "model", "component", "text", "score", "method"}


def test_keyword_fallback_finds_brake_exclusion():
    # Exercise the offline fallback directly (no embedding model needed).
    backend = _KeywordBackend()
    candidates = clauses_for_model("Swift VXI")
    ranked = backend.rank("my brake pads squeal", candidates, k=1)
    assert ranked
    top_clause, score = ranked[0]
    assert top_clause.id == "GEN-WEAR-01"
    assert score > 0
