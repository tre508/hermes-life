"""M1 exit check: the real BGE-small model loads and embeds offline."""
from hermes_life.embedding import get_embedder

emb = get_embedder()
print("available:", emb.available())
print("model:", emb.model_name)
vectors = emb.embed(["stop a program that is running", "kill a process"])
print("dim:", emb.dim, "vectors:", len(vectors), "bytes each:", len(vectors[0]))
# sanity: dot product of the two similar queries should be high (normalized)
from hermes_life.embedding import unpack_vector
import math
a, b = unpack_vector(vectors[0]), unpack_vector(vectors[1])
print("cosine:", round(sum(x * y for x, y in zip(a, b)), 4))
