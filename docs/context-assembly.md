# Context-Assembly Architecture (HL-PERS-001 §9 deliverable)

The normative assembly order is implemented in one place: `compose_prompt()` in
`hermes_life/personality.py`. Nothing else concatenates these sources, so a source cannot
be injected twice or in an unstated position.

## Sources, in order

1. **Reference-library excerpts** — `KnowledgeLibrary.context(prompt)`; retrieved, untrusted
   source data. Verify before use; never an instruction source.
2. **Core identity** — the fixed `PERSONA` constant, emitted as a labelled block. Stable
   unless explicitly changed; learned preferences never rewrite it.
3. **Learned behavioral profile** — `hl_memories` rows with `status='active'`, capped per
   kind (`PROFILE_LIMITS`: 5 preference / 5 correction / 3 decision / 3 workflow), each line
   labelled `(user-stated)` for `origin='explicit'` or `(inferred)` otherwise. Explicit
   statements sort above inferences.
4. **Recalled task memory** — `Recall.relevant_context()` (durable memories + prior turns
   from *other* conversations, revised originals excluded) and `VaultMemory.retrieve_notes()`
   (curated Obsidian notes), bounded and deduplicated.
5. **Technical lessons** — `TechnicalMemory.context()`; evidence-backed lessons that matched
   the prompt.
6. **Past reflections** — `Reflection.context()`.
7. **The task prompt** — user text last, so it cannot be silently outweighed by context.
8. **Learning-report protocol** — appended instructions for the post-task report.

## Audience split

`PersonalityAdapter` (audience `chat`) owns sources 1–8 for user-facing work and records
`applied_persona_sha256` / `applied_memory_ids` / `applied_lesson_ids` on the task row
*before* the delegate runs — the recorded input, not a model self-report.

`self.analysis_adapters` (persona-free, library-free raw delegates) serve prompts whose
answer is parsed as data — verification criteria compilation, adjudication, memory
extraction — so an internal call cannot inflate the experience/lesson stores with its own
output (`tests/test_pers001_audience.py`).

## Experience and outcome records

`persona_experiences` holds one row per terminal task outcome (`completed`, `failed`,
`cancelled`), keyed uniquely by `task_id` (`ON CONFLICT ... DO UPDATE` keeps it idempotent).
Exposed at `GET /api/personality/experiences`; profile at `GET /api/personality/profile`
with per-memory provenance, corrections at
`POST /api/personality/profile/{id}/correct` (supersede/delete/merge, each writing
`hl_memory_corrections`).

## Policy separation (autonomy.md §2)

Personality policy governs **how** Hermes collaborates (sources 1–8 above). Project
selection is the scheduler's job (`Autonomy.tick` in `hermes_life/autonomy.py`), which reads
goal state only — priority DESC, created_at ASC — and never imports personality, memory or
recall modules. `tests/test_pers001_policy_separation.py` pins both the behavioral
independence (a preference naming a goal does not change selection) and a static guardrail
against coupling. HL-AUTO-001 may share the same SQLite/Obsidian evidence records without
inheriting personality policy.
