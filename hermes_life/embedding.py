"""Local embedding support for the knowledge library (HL-LIB-001 §4.2).

Self-hosted posture: a small ONNX model (fastembed), CPU only, no API calls in
the answer path. Failure to load the model is never an error for callers — the
library degrades to keyword-only ranking (HL-LIB-001 decision 6).
"""
from __future__ import annotations

import os
import struct
import threading

DEFAULT_MODEL = "BAAI/bge-small-en-v1.5"
EMBED_BATCH = 64


def model_name() -> str:
    """The configured embedding model (env override per HL-LIB-001 decision 8)."""
    return os.environ.get("HERMES_LIFE_EMBED_MODEL") or DEFAULT_MODEL


def pack_vector(vec) -> bytes:
    """float32 little-endian bytes — the storage format of the `embedding` BLOB."""
    return struct.pack(f"<{len(vec)}f", *vec)


def unpack_vector(blob: bytes) -> list[float]:
    return list(struct.unpack(f"<{len(blob) // 4}f", blob))


def normalize(vec) -> list[float]:
    """Unit-length copy; dot product of two unit vectors is the cosine."""
    norm = sum(float(v) * float(v) for v in vec) ** 0.5
    if norm == 0.0:
        return [0.0] * len(vec)
    return [float(v) / norm for v in vec]


class Embedder:
    """Lazily-loaded local embedding model.

    Parameters
    ----------
    backend:
        None (default) — the real fastembed backend, built on first use.
        A callable mapping list[str] -> iterable of vector-likes — for tests
        and fixture-based verification; never touches the network or disk.
    """

    def __init__(self, backend=None):
        self._backend = backend
        self._model = None
        self._failed = False
        self._lock = threading.Lock()
        self._name = None
        self._dim = None

    # -- introspection ----------------------------------------------------
    @property
    def model_name(self):
        if self._backend is not None:
            return self._name or "fixture"
        return self._name or model_name()

    @property
    def dim(self):
        return self._dim

    def available(self) -> bool:
        """False only after a real load attempt failed; callers then degrade."""
        if self._backend is not None:
            return True
        if self._failed:
            return False
        if self._model is not None:
            return True
        with self._lock:
            if self._failed:
                return False
            if self._model is not None:
                return True
            try:
                self._load()
                return True
            except Exception:
                self._failed = True
                return False

    def _load(self):
        # Imported lazily so a missing fastembed never breaks module import.
        from fastembed import TextEmbedding

        self._name = model_name()
        self._model = TextEmbedding(model_name=self._name)  # CPU by default

    def _vectors(self, texts):
        if self._backend is not None:
            try:
                return [list(v) for v in self._backend(texts)]
            except Exception:
                return None
        self._name = self._name or model_name()
        if self._model is None:
            if self._failed:
                return None
            try:
                self._load()
            except Exception:
                self._failed = True
                return None
        out = [list(v) for v in self._model.embed(texts)]
        return out if out else None

    def embed(self, texts: list[str]):
        """Return list[bytes] of normalized float32 vectors, or None if unavailable.

        Batched to <= EMBED_BATCH texts per model call.
        """
        if not texts:
            return []
        results: list = [None] * len(texts)
        for start in range(0, len(texts), EMBED_BATCH):
            batch = [str(t) for t in texts[start:start + EMBED_BATCH]]
            vectors = self._vectors(batch)
            if vectors is None:
                return None
            if len(vectors) != len(batch):
                raise ValueError("model returned a vector/text count mismatch")
            if self._dim is None:
                self._dim = len(vectors[0])
            if any(len(v) != self._dim for v in vectors):
                raise ValueError("inconsistent embedding dimension from model")
            for offset, vec in enumerate(vectors):
                results[start + offset] = pack_vector(normalize(vec))
        return results


_shared: Embedder | None = None
_shared_lock = threading.Lock()


def get_embedder() -> Embedder:
    """Process-wide lazy singleton (HL-LIB-001 §4.2)."""
    global _shared
    with _shared_lock:
        if _shared is None:
            _shared = Embedder()
        return _shared
