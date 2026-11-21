"""HL-LIB-001 M1 — Embedder unit tests with a recorded fixture vector."""
import math
import os
import struct

import pytest

from hermes_life import embedding
from hermes_life.embedding import (
    Embedder,
    get_embedder,
    model_name,
    normalize,
    pack_vector,
    unpack_vector,
)


class FixtureBackend:
    """Per-call fixture: each __call__ returns the next pre-recorded batch."""

    def __init__(self, batches):
        self.batches = list(batches)
        self.calls = []

    def __call__(self, texts):
        self.calls.append(list(texts))
        return self.batches.pop(0)


def test_model_name_env_override(monkeypatch):
    monkeypatch.setenv("HERMES_LIFE_EMBED_MODEL", "X/y-z")
    assert model_name() == "X/y-z"
    monkeypatch.undo()
    assert model_name() == embedding.DEFAULT_MODEL == "BAAI/bge-small-en-v1.5"


def test_embed_fixture_vectors_and_normalization():
    # Recorded-style fixture: two raw (unnormalized) 3-dim vectors.
    raw = [[2.0, 0.0, 0.0], [0.0, 3.0, 4.0]]
    emb = Embedder(backend=FixtureBackend([raw]))
    out = emb.embed(["a", "b"])
    assert out is not None and len(out) == 2
    assert emb.dim == 3
    first = unpack_vector(out[0])
    second = unpack_vector(out[1])
    # Unit length (cosine = dot product on stored vectors).
    assert math.isclose(sum(v * v for v in first), 1.0, rel_tol=1e-6)
    assert math.isclose(sum(v * v for v in second), 1.0, rel_tol=1e-6)
    assert struct.pack("<3f", 1.0, 0.0, 0.0) == out[0]
    # Second fixture vector [0, 3, 4] normalizes to (0, 0.6, 0.8).
    assert second == pytest.approx([0.0, 0.6, 0.8], abs=1e-6)


def test_embed_batches_to_at_most_64():
    emb = Embedder(backend=FixtureBackend([[[1.0, 0.0]] * 64, [[1.0, 0.0]] * 64, [[1.0, 0.0]] * 2]))
    out = emb.embed([f"t{i}" for i in range(130)])
    assert len(out) == 130
    assert [len(c) for c in emb._backend.calls] == [64, 64, 2]


def test_empty_input_short_circuits_backend():
    emb = Embedder(backend=FixtureBackend([]))
    assert emb.embed([]) == []
    assert emb._backend.calls == []


def test_backend_failure_returns_none_not_raise():
    def broken(texts):
        raise RuntimeError("model missing")

    emb = Embedder(backend=broken)
    assert emb.embed(["x"]) is None


def test_inconsistent_dimension_raises():
    emb = Embedder(backend=FixtureBackend([[[1.0, 0.0], [0.0, 1.0], [1.0, 1.0]]]))
    with pytest.raises(ValueError):
        emb.embed(["a", "b"])  # backend returns 3 vectors for 1 text


def test_real_model_unavailable_reports_false_not_raise():
    # No backend, force the lazy loader to fail by pointing at a bogus model.
    old = os.environ.get("HERMES_LIFE_EMBED_MODEL")
    os.environ["HERMES_LIFE_EMBED_MODEL"] = "no/such-model-xyz"
    try:
        emb = Embedder()
        assert emb.available() is False
        assert emb.embed(["x"]) is None
        # And no exception escaped available() or embed().
    finally:
        if old is None:
            os.environ.pop("HERMES_LIFE_EMBED_MODEL", None)
        else:
            os.environ["HERMES_LIFE_EMBED_MODEL"] = old


def test_singleton_returns_same_instance():
    assert get_embedder() is get_embedder()


def test_pack_unpack_roundtrip():
    blob = pack_vector([0.25, -0.5, 1.0])
    assert unpack_vector(blob) == pytest.approx([0.25, -0.5, 1.0])
    assert struct.calcsize("<3f") == len(blob) == 12


def test_normalize_zero_vector():
    assert normalize([0.0, 0.0]) == [0.0, 0.0]
