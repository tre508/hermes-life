# HL-LIB-001 — Embedding-Based Ranking for the Knowledge Library

**Type:** Development specification (design + implementation plan)
**Priority:** Medium
**Status:** Planned — not started
**Scope:** `hermes_life/knowledge_library.py`, `hermes_life/schema.py`, `tests/`, `docs/`. No changes to `personality.py`, no API shape changes, no worker/study subsystem changes.
**Depends on:** FIX-013 (library tables + migration ownership), HL-PERS-001 §9 / `docs/context-assembly.md` (library is source #1 of `compose_prompt`), the schema-migration recipe in `hermes-life-operations` skill `references/backend-development.md`
**Supersedes:** none — extends HL-STUDY-adjacent retrieval; every clause of the context-assembly order remains in force

## 1. Problem

`KnowledgeLibrary.search()` ranks chunks by token overlap. Two query classes it cannot serve:

1. **Paraphrase.** "Stop a program that is running" shares no rare token with the processes chapter
   (`kill`, `signals`, `top`); IDF cannot rescue a zero-overlap candidate.
2. **Concept queries without command names.** "Join one command's output to another's input" loses to
   chunks that merely repeat the word `command`.

Ranking was already rebuilt once (raw overlap → IDF + verbatim bigram, `knowledge_library.py:128`)
because ubiquitous words buried the answering chapter. That fix addressed frequency noise; this spec
addresses the remaining lexical-gap class. Both signals are kept — see §3.

## 2. Current state (verified)

| Fact | Anchor |
|---|---|
| Chunking: paragraph-boundary split, `MAX_CHUNK_CHARS = 1400` | `knowledge_library.py:12,32` |
| Ingest: `add_pages` takes 1–100 pages, ≤ `MAX_PAGE_CHARS` (30000) each, page replaced as one transaction | `knowledge_library.py:96` |
| Registration requires an http(s) URL (`file://` rejected) | `knowledge_library.py:78` |
| Ranking: IDF-weighted overlap `log(1 + N/df)` + 2.0 per verbatim query bigram | `knowledge_library.py:128-160` |
| `search()` consumers: only `context()` (limit=4) and the API route | `knowledge_library.py:164`, `app.py:304` |
| Injection: top-4 chunks, `max_chars=4500`, labelled untrusted block; consumer is `compose_prompt` | `knowledge_library.py:163`, `personality.py:219` |
| Library tables created by `KnowledgeLibrary.migrate()`, called from app lifespan | `app.py:236` |
| Store: SQLite WAL, single shared connection guarded by `store.lock` (RLock) | `store.py:20` |
| Schema versioning: `SCHEMA_VERSION = 38`, sequential `if version < N:` gates in `migrate()` | `schema.py:4,78` |
| Suite: 225 passing; 2 pre-existing failures are host-environment issues (`test_flow004_evaluator.py::test_guest_uses_candidate_virtualenv`, `test_flow006_revision_guest.py::test_revision_guest_test_step_runs_against_the_platform_environment` — guest env cannot import pytest) | `tests/` |
| Corpus at time of writing (point-in-time, re-measure with `GET /api/library/sources`): 1 source, 594 indexed pages, 1055 chunks (TLCL 25.12A) | live API |
| No embedding dependency installed (numpy / torch / onnx / fastembed absent) | `pip list` |

## 3. Locked decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | **Hybrid ranking — embeddings blend with the existing IDF score; embeddings never replace it** | Exact tokens (`chmod 755`, `&>`, `xargs`) are where keyword matching is strictly better; paraphrase is where cosine wins. Embedding-only regresses the strongest existing behavior. |
| 2 | **Local light model via ONNX (`fastembed`, BGE-small or MiniLM-L6, 384 dims). Not torch, not an API** | Self-hosted posture: no third-party data flow in the answer path, no ~2 GB torch pull, negligible quality delta for this task. |
| 3 | **No vector database.** Cosine over an in-memory numpy matrix; `sqlite-vec` only if the corpus passes ~100k chunks | 1055 chunks → sub-millisecond brute force. A vector store is ceremony at this scale. |
| 4 | **Model identity stamped per chunk (`embed_model` column); chunks are re-embedded on mismatch** | Mixing vectors from two models produces garbage similarity silently. |
| 5 | **`search()` signature and return shape unchanged; `context()` unchanged** | Ranking-only change; both consumers keep working untouched. |
| 6 | **Degraded mode is keyword-only, never an error** | Retrieval must not break because a model file is missing; emit an event instead. |
| 7 | *(proposed in the plan, defaulted)* Blend weights `W_EMBED = 0.6`, `W_KEYWORD = 0.4`, phrase bonus added after component normalization | Scale-free: each component min-max normalized within the candidate set per query. Tunable constants, one place. |
| 8 | *(proposed in the plan, defaulted)* Default model constant + `HERMES_LIFE_EMBED_MODEL` env override | One knob, no config surface beyond what exists. |

## 4. Design

### 4.1 Storage

One schema migration, v38 → 39:

- `SCHEMA_VERSION = 39` in `schema.py`; new `if version < 39:` gate performing
  `ALTER TABLE library_chunks ADD COLUMN embedding BLOB` and
  `ADD COLUMN embed_model TEXT`. Must be safe to re-run (lifespan re-invokes `migrate`).
- BLOB = raw `float32` little-endian bytes (384 dims ≈ 1.5 KB/chunk; whole current corpus ≈ 1.6 MB).
- `sha256`, `ordinal`, page identity unchanged — embeddings are retrieval metadata, not content identity.

### 4.2 Embedding module

New module `hermes_life/embedding.py`:

- `class Embedder` — lazy singleton; loads the ONNX model on first use; `embed(texts: list[str]) -> list[bytes]`.
- Exposes `model_name` and `dim`.
- Batched (≤ 64 texts per call); CPU only; no thread of its own.
- Failure to load/download → `available() == False`; every caller degrades per decision 6.

### 4.3 Ingest path

`add_pages()` embeds each chunk before insert. A page whose embedding fails still lands (keyword-searchable),
with `embedding = NULL`; the ingest response reports `embedded` vs `unembedded` counts.

### 4.4 Backfill

`KnowledgeLibrary.backfill()` embeds chunks where `embedding IS NULL AND embed_model IS NULL OR embed_model != current`,
batched, under `store.lock`, in a daemon thread started after `autonomy.start()` in the lifespan.
`search()` treats a NULL-embedding chunk as keyword-only — it competes on the IDF component and is never
excluded, so backfill progress creates no retrieval hole.

### 4.5 Hybrid scoring

```
candidates   = chunks with >= 1 query term
idf_score    = sum(log(1 + N/df)) over overlapping terms          (existing, knowledge_library.py:154)
cosine_score = cos(query_vec, chunk_vec)                          (0..1, Dot-product on normalized vectors)
idf_norm     = min-max(idf_score) within candidates
cos_norm     = (cos_score + 1) / 2                                (already bounded; no min-max needed)
score        = W_KEYWORD * idf_norm + W_EMBED * cos_norm + 2.0 * phrase_hits
order        = score DESC, source_id, page, id                    (deterministic, unchanged)
```

- Candidates remain overlap-gated: a chunk sharing no query term is never returned. This bounds the
  blast radius — cosine can only *reorder* keyword candidates, never invent results from elsewhere.
- Chunks without a usable embedding get `cos_norm = 0` and still rank on the keyword component.

### 4.6 Observability

- `sources()` gains an `embedded_chunks` count (additive column in the existing aggregate query).
- `store.emit('library.embed_degraded', {...})` when scoring falls back to keyword-only.

## 5. Preserved / non-negotiable

- The labelled-untrusted block and `max_chars=4500` in `context()` are untouched — embeddings change
  *which* excerpts are chosen, never how they are framed or trusted.
- API routes `/api/library/sources`, `/api/library/sources/{id}/pages`, `/api/library/search` keep their
  request/response shapes. `/api/library/search` may only gain fields, never lose them.
- `compose_prompt` and the assembly order are untouched (HL-PERS-001 §9 governs).
- No new long-lived thread besides the backfill daemon; no new background scheduler.
- `technical_lessons` / study subsystem are out of scope.

## 6. Milestones

| # | Step | Exit condition |
|---|---|---|
| M1 | Add `fastembed` dep (no transitive torch — verify with `pip install --dry-run`), create `embedding.py` | `Embedder` loads, embeds offline after the one-time model fetch; unit test with a recorded fixture vector |
| M2 | Schema v39 migration + `backfill()` | Fresh DB and legacy-v38 DB both migrate (`user_version` asserted); backfill fills all chunks, `embedded_chunks == chunks` |
| M3 | Hybrid `search()` | Paraphrase battery (§7) passes; exact-token battery shows no regression vs the IDF baseline |
| M4 | Observability + docs refresh | `embedded_chunks` visible; `library.embed_degraded` emitted when the model is unavailable; this doc's Status → Implemented |

## 7. Acceptance criteria (reviewer-runnable)

1. `pytest -q`: green except exactly the two named pre-existing environment failures (§2).
2. Migration test passes on both a fresh DB and a legacy DB created at `user_version=38` (repo rule).
3. Paraphrase battery — each query's top-4 must include the named chapter (PDF page numbers as stored):
   - "stop a program that is running" → ch. 10 Processes (p137)
   - "make a script runnable" → ch. 24 Executable Permissions (p406)
   - "join one command's output to another command's input" → ch. 6 Pipelines (p88)
4. Exact-token battery — no regression vs the IDF baseline: "chmod 755 permissions" → p134; "find files
   by name with the find command" → ch. 17 (p256); "how do I write a for loop in a bash script" → ch. 33 (p517);
   "redirect standard output and standard error to a file" → p81–85.
5. Query latency p95 < 200 ms at ≥ 1000 chunks (time 20 queries).
6. With the model made unavailable, `search()` returns keyword-only results and emits
   `library.embed_degraded`; no exception escapes.
7. `context()` output for a fixed query is structurally unchanged: same opening/closing label lines,
   same cap, page citations present.
8. End-to-end: a chat task asking a manual question still answers with page citations
   (the §7.3 battery queries doubled as chat prompts).

## 8. Risks

| Risk | Mitigation |
|---|---|
| First model download needs network | Pre-fetch on first `add_pages`/startup with an explicit emitted event on failure; document the one-time fetch; degraded mode keeps the app functional |
| Resident memory of the model | ~100–300 MB ONNX; loaded once; host has ≥ 13 GB free — re-measure before shipping |
| Model/version drift silently corrupting similarity | `embed_model` stamped per chunk; mismatched rows re-embedded by backfill (decision 4) |
| Regression in exact-command retrieval | Hybrid weighting (decision 1) + the §7.4 battery gating the milestone |
| Dependency weight creep (torch via transitive deps) | M1 explicitly verifies the install tree contains no torch |
| Backfill stalling startup | Runs in a daemon thread; search stays functional on NULL-embedding chunks (§4.4) |

## 9. Out of scope

- Embedding the vault (`VaultMemory.retrieve_notes`) — separate mechanism, separate spec if ever needed.
- Reranking with a cross-encoder; query expansion; multi-vector (ColBERT) retrieval.
- Any change to how the persona cites or verifies sources — that contract lives in the context-assembly doc.

## Appendix A — Decision log

- Retrieval was first corrected from raw overlap to IDF + bigram because frequency noise buried answer
  chapters on a whole-book corpus; the paraphrase class documented in §1 motivated this spec. The IDF
  work and its verification queries are the regression baseline for M3.
- The corpus ingested during that work (one PDF source) is the concrete scale the "no vector DB"
  decision was made against; the ~100k-chunk threshold in decision 3 is the revisit trigger.
- Decisions 7 and 8 are agent-proposed defaults chosen to keep the change reviewable; amend them by
  editing this table, not by diverging in code.
