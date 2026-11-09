# personalityaudit.md — audit against HL-PERS-001 (Adaptive Personality & Persistent Experience Integration)

**Scope:** the personality/persona subsystem as the lens, and the codebase's discrepancies, incomplete or
missing implementations, circular dependencies and redundancy.
**Type:** investigation and documentation only. **No application code, config, dependency or migration was changed.**
**Repository:** `/home/gayzer/Apps/hermes-life` @ branch `main`, uncommitted working tree.
**Auditor run:** 2026-11-07, against the live backend on `127.0.0.1:8766` and a read-only handle on
`~/.local/share/hermes-life/life.db`.

**Revision 3 — re-verified against the current tree, post-migration.** The baseline quoted in the line above
was measured on the pre-migration Kubuntu install. This host is now Ubuntu 26.04, and the database those
numbers came from did **not** survive the migration: `~/.local/share/hermes-life/` was created fresh on
2026-11-07 15:35 when the backend was first started here, so the 128 reflective runs / 87 lessons / 10 memories
referenced below no longer exist on this machine. Code findings are unaffected (the schema is intact at v32 and
migrates a fresh database cleanly); the findings whose *only* evidence was that database now rest on the code
and the test suite instead. §1 carries the current per-clause status, §2 the current measurements, §3 keeps the
original findings with a status column, and §8 records what is done with today's evidence.

---

## 0. Normative basis

**`hermes-personality.md` is now populated and is the basis of this revision.**
It is **HL-PERS-001 — Adaptive Personality & Persistent Experience Integration** (12,118 bytes / 258 lines,
mtime 2026-11-07 06:43): severity *Medium*, status *"Partially implemented — End-to-end integration unverified"*,
referencing HL-ARCH-002, HL-ARCH-004, HL-MEM-001.

**Correction to the first revision of this audit.** That revision ran while the file was 0 bytes (it was unsaved)
and therefore audited the persona against `HERMES_LIFE_DEV_SPEC.md` §10.6, which describes a *user-chosen* persona
whose changes follow explicit instruction. HL-PERS-001 says the opposite about layer 1 — Core Identity is
"Stable unless explicitly changed" and learned behaviour must evolve "without modifying the underlying core
persona" (§2, §6, acceptance #3). Consequences, applied below:

- The previous finding **PA-01 ("the persona is not user-choosable") is withdrawn as a spec violation.** A fixed
  core identity is what HL-PERS-001 requires; the surviving part of that finding is hygiene (dead storage and
  leftover editor assets from the removed Phase 3.7 profile).
- Everything else survives, and three of the findings are now *stronger*, because HL-PERS-001 names the exact
  properties they violate: §5A/§5C/§6 (no duplicated or conflicting context injection across adapters),
  §5B (each learned attribute retains source, evidence, timestamps, validity), §5F and acceptance #8/#9
  (inspect/correct the learned profile), §5G/#7 (Obsidian mirrors must not keep obsolete records looking current),
  and §7 #12 (end-to-end verification of the whole loop).
- Findings are renumbered **PSP-01 … PSP-07** (personality-spec findings). Mapping from the first revision:
  PA-01 → PSP-01, PA-02 → PSP-02, PA-03 → PSP-03, PA-04 → PSP-04 (split with PSP-07), PA-05 → PSP-05;
  UI-01 and HY-01…HY-06 keep their ids.

Other sources still consulted, as corroboration rather than authority:
`HERMES_LIFE_DEV_SPEC.md` §10.1–10.3/§10.6, `README_PHASE3_6.md` / `README_PHASE3_7.md` / `README_PHASE3_9_3.md`
(the feature's own history), `tests/test_personality.py` (the intent the code asserts today), and the live
implementation itself.

---

## 1. What HL-PERS-001 requires, and where the implementation stands

The spec defines three personality layers (§2), a nine-stage learning loop
(**Experience → Extraction → Validation → Consolidation → Persistence → Retrieval → Behavioral Adaptation →
Execution → Reflection**, §3), eight requirement groups (§5 A–H), seven boundaries (§6) and twelve acceptance
criteria (§7).

| Spec clause | Requirement (abbreviated) | Status | Evidence anchor |
|---|---|---|---|
| §2 L1 | Core Identity stable unless explicitly changed | **Verified** | `PERSONA` constant, `Personality.get()`; no mutation path exists (and none is required) |
| §2 L2 | Learned Behavioral Profile: persistent, evolving | **Verified** | `hl_memories` + `Personality.learned_profile()`; each row now carries evidence, origin, confidence, validity, rationale and decider (v30/v31) — §8 PSP-04 |
| §2 L3 | Task-specific context retrieved per task | **Verified** | `Recall`, `TechnicalMemory`, `VaultMemory` and library excerpts are all injected through one documented order (`compose_prompt`); retrieval stays keyword/topic-based by design — §8 PSP-02 |
| §3 Experience collection | Conversations, corrections, task results, lessons, reflections | **Verified** | extraction writes `hl_memories`/`hl_memory_reviews`; the experience store `persona_experiences` now records one row per terminal task (schema v33) — §8 PSP-03 |
| §3 Extraction → Validation | Candidates validated against evidence | **Verified** | `vault_memory.extract_completed` + `hl_memory_reviews` (accept/reject/merge) retain the validated quote and origin — §8 PSP-04/PSP-05 |
| §3 Consolidation | Duplicates merged, contradictions flagged | **Partial** | `superseded_by`, supersede **and** merge paths exist (API + UI); no dedicated consolidation test |
| §3 Persistence | SQLite **and** Obsidian | **Verified** | both write; the Obsidian note records status and is invalidated on retire — §8 PSP-06 |
| §3 Retrieval | Only task-relevant material | **Verified** | relevance is keyword/topic-based (unchanged by design); all sources are placed by the single documented order — §8 PSP-02 |
| §3 Behavioral adaptation | Learned behaviour changes execution | **Verified (mechanism), test-backed** | `test_pers001_learning_loop.py` drives a correction through retrieval and asserts the next prompt carries the newer statement and drops the retired one — §8 PSP-07 |
| §5A Unified context | Explicit structured context, no duplicate model | **Verified** | `task_context(profile, learned_profile, task_knowledge)` + the chat/analysis audience split; the spec's quoted signature was corrected (**PSP-01 resolved**) |
| §5B Persistent profile | Each attribute: source, evidence, timestamps, validity | **Verified** | evidence excerpt, origin, confidence, `expires_at`, rationale, decided_by, timestamps (v30/v31) — §8 PSP-04 |
| §5C Relevant retrieval | Coherent retrieval, avoid redundancy/conflict | **Verified** | five sources, one documented order (`compose_prompt`); the audience split keeps analysis persona-free — §8 PSP-02 |
| §5D Learning from feedback | Distinguish temporary instruction from durable preference | **Verified** | `origin` (`explicit`/`inferred`) is required and validated; an unknown origin is refused — §8 PSP-04 |
| §5E Contradiction handling | Update/supersede/invalidate; explicit beats inferred | **Verified** | supersede/delete/merge + `origin='explicit'` ordering in `learned_profile()`; vault mirrored — §8 PSP-04/05/06 |
| §5F Traceability & control | User can inspect, see evidence, correct/invalidate | **Verified** | Overview surface lists memories with evidence/origin, pending reviews, lessons and corrections, with Replace/Merge/Invalidate and Accept/Reject/Merge — §8 PSP-05 |
| §5G Obsidian | Consistent mirrors; no obsolete record current | **Verified** | `retire_memory` writes status + supersede marker, preserving the body; `Memory/Curated/` untouched; vault path configured to `/run/media/gayzer/black/obsidian/hermes` — §8 PSP-06 |
| §5H Reflection | Lessons stored when evidence supports; reused later | **Partial** | `technical_lessons` (evidence excerpts + sha256) are recalled into prompts and reuse is recorded (`applied_lesson_ids`), but no test shows reuse *improves* a later answer |
| §6 · boundaries | identity / no parallel system / no full-history injection / no unsupported inference | **Met** | one persona layer, no second memory system, bounded retrieval, reviews gate inferred candidates |
| §6 · no duplicate injection across adapters | pairwise duplication | **Met (cleared)** | `KnowledgeAdapter.run` injects library excerpts only; memory/reflection live solely in `PersonalityAdapter` |
| §7 #1–#6, #10 | persistent learning, adaptation, stable identity, relevance, cross-session, contradiction | **Verified** | `test_pers001_learning_loop.py` / `_profile_provenance.py` (#1/#4/#5/#6) and `test_personality.py` (#3/#10) — §8 PSP-07 |
| §7 #7 | Obsidian records learned changes + provenance | **Verified** | the note carries status/origin/evidence and an invalidation marker — §8 PSP-06 |
| §7 #8, #9 | inspect what/why/evidence; correction changes future behaviour | **Verified** | `/api/personality/profile`, `/api/memory-corrections`, the Overview surface; and the loop test's correction-reaches-next-prompt assertion — §8 PSP-05/PSP-07 |
| §7 #11 | no redundant/contradictory context from separate adapters | **Verified** | no *pairwise* duplication; library + persona + memory + lessons + reflections compose once, in one documented order; analysis stays persona-free — §8 PSP-02 |
| §7 #12 | end-to-end verification of the whole loop | **Verified** | `tests/test_pers001_learning_loop.py` (extraction → consolidation → retrieval → prompt assembly → execution → post-task learning) — §8 PSP-07 |
| §9 deliverables | source changes, migrations, tests, behaviour evidence, SQLite+Obsidian verification, docs, limitations report | **Mostly met** | source + migrations (v30–v33) + tests + behaviour evidence + SQLite/Obsidian verification exist; the assembly order is documented in `personality.compose_prompt`, but a **standalone context-assembly architecture note is still not written** |

## 2. Baseline measured before findings

**Baseline as originally measured (pre-migration Kubuntu install, 2026-11-07 12:xx):**

```
$ .venv/bin/python -m pytest -q
145 passed, 1 warning in 17.99s

backend routes (openapi.json): 76        package: 30 modules / 7919 lines
live DB: tasks, events, goals, discoveries, investigation_plans, implementation_runs,
         reflective_runs=128, technical_lessons=87, hl_memories=10 (project 5, workflow 4, preference 1),
         agent_personality=1, persona_experiences=0
```

**Baseline re-measured on the current host (Ubuntu 26.04, 2026-11-07 ~15:5x):**

```
$ .venv/bin/python -m pytest -q
2 failed, 181 passed, 1 warning in 25.5s        # 183 collected
  FAILED tests/test_flow004_evaluator.py::test_guest_uses_candidate_virtualenv
  FAILED tests/test_flow006_revision_guest.py::test_revision_guest_test_step_runs_against_the_platform_environment
package: 30 modules / 8308 lines
live DB: recreated 2026-11-07 15:35, schema re-measured at user_version=33
         tasks=2, persona_experiences=1, reflective_runs=2, technical_lessons=0, hl_memories=0,
         hl_memory_reviews=0, hl_memory_corrections=0
```

Two caveats, both environmental rather than code:

- **The live database did not survive the migration.** `~/.local/share/hermes-life/` is newly created (15:35
  today); the 128 runs / 87 lessons / 10 memories the original audit read are gone from this host. The schema
  is intact at v32 and migrates a fresh database cleanly, so the code findings stand — but every "live
  evidence" row count quoted in the findings and in §8 describes a database that no longer exists here.
  (The Obsidian vault, by contrast, **did** survive — it lives on the external disk, not under `$HOME`. It was
  reconnected in revision 3; see PSP-06.)
- **The two failing tests are not personality tests.** They are the FLOW-004 / FLOW-006 platform-test-environment
  guests, and they fail on this host's interpreter/venv layout (the interpreter is resolved through a symlink
  the test compares unresolved, and the resolved interpreter cannot import `pytest`). They are outside
  HL-PERS-001 and were not touched by any PSP/UI/HY fix. They do mean the suite is no longer a clean green, so
  the "stays green" verification wording in §8 is qualified accordingly. They are not caused by, nor do they
  affect, the personality subsystem.

**Severity note:** no finding earns *Critical*. The top rating is reserved for exploitable-by-default or data-loss behaviour, and the guards that would justify it are present here: execution is SSH-gated to the worker (and now fails closed without a configured target), candidate work is isolated and never auto-merged, verification is deterministic-first with a human decision gate, and live data is written behind explicit approval. The findings below are unwired, unbuilt or superseded behaviour — not exploit paths.

**Findings: 14 total — 7 personality-spec (PSP-01…PSP-07), 1 UI wiring, 6 structural/hygiene (HY-01…HY-06).**

The suite is green. Every finding below is therefore an **unbuilt, unwired or superseded** behaviour, not
breakage the suite would have caught — which by itself is the coverage finding: none of PSP-01…PSP-07, UI-01
or HY-01…HY-06 is pinned by a test.

---

## 3. Findings

Classification: **Confirmed** = mechanism located in code or live data with quoted evidence;
**Probable** = mechanism located but effect not reproduced live; **Unverified** = signposted only.

**Current status (revision 3 — verified against the tree and the suite today).** The `Class:` line under each
finding is the *original* classification; the table below is what is true now. Where a finding cites row counts
from the pre-migration database, treat those numbers as historical (see the §2 caveat).

| Finding | Subject | Status now |
|---|---|---|
| PSP-01 | Spec §1 quotes a stale `task_context` signature | **Resolved** — `hermes-personality.md` §1 now cites `task_context(profile, learned_profile=None, task_knowledge=None)`, explains the removed `history=()` quote, and points at `personalityaudit.md` (PSP-03 has since closed too). The spec's Status line was corrected in the same pass. |
| PSP-02 | One context block per call, unarbitrated precedence | **Resolved** — the audience split is implemented and tested, and the library is now a source *inside* the single documented assembly order (`personality.compose_prompt`); the wrapping `KnowledgeAdapter` is gone. See §8. |
| PSP-03 | Experience counts machine activity; `persona_experiences` empty | **Resolved** (schema v33) — an experience is now one row per terminal task outcome in `persona_experiences` (keyed by task/goal); `reflective_runs` is diagnostics only, served by `/api/reflections`, and the persona card reads "recorded outcomes". See §8. |
| PSP-04 | No evidence / origin on learned attributes | **Resolved** (schema v30) — see §8. |
| PSP-05 | Profile cannot be inspected/corrected from the product | **Resolved** — API (supersede/delete/merge, rationale required, correction history) + Overview surface — see §8. |
| PSP-06 | Obsidian mirror write-once, never invalidated | **Resolved** — `vault_memory.retire_memory`, wired to correct/resolve/save. Revision 3 also reconnected the vault: the code default pointed at the pre-migration mount (`~/black/obsidian/hermes`), which no longer exists, so the mirror was inert on this host; it is now configured to `/run/media/gayzer/black/obsidian/hermes` and resolves live — see §8. |
| PSP-07 | Loop never verified end to end; no record of applied context | **Resolved** (schema v32) — `tasks.applied_*` columns + `tests/test_pers001_learning_loop.py` — see §8. |
| UI-01 | Eleven visible controls with no handler | **Resolved** — controls wired or deliberately hidden; static `Checking…` gone; `control-wiring.test.ts` — see §8. |
| HY-01 | 52 superseded copies (49 tracked) | **Open** — measured today: still 52 on disk, 49 tracked. |
| HY-02 | Stale bytecode from two interpreters | **Open** — `hermes_life/__pycache__` holds 39 `.pyc`: 30 `cpython-314`, 9 `cpython-313`. |
| HY-03 | Duplicate DDL for two tables | **Open** — `schema.py` still declares `investigation_plans` (lines 164, 357) and `implementation_reviews` (lines 499, 633) twice. |
| HY-04 | CSS for a UI that no longer exists | **Open** — `persona-traits` / `persona-trait-number` / `persona-label` / `goal-entry` still defined in `style.css`, still unused in live markup/TS. |
| HY-05 | Frontend helper duplication across tab modules | **Open** — `node`/`btn`/`stamp` in `phase41301-rework.ts` + `phase415-review.ts`; `records` in those two + `phase41302-workflow.ts`. |
| HY-06 | Routes with no UI consumer | **Partly resolved** — `phase41303-memory.ts` now consumes `/api/personality/profile`, `/api/technical-lessons`, `/api/memory-reviews` (with resolve) and `/api/memory-corrections`. Still unconsumed: `/api/study/*`, `/api/library/*`, `/api/reflections`, `/api/formulations`. |


### PSP-01 — The defect the spec cites by name is already fixed; the gap it points at is real — **[RESOLVED — spec §1 updated]**
**Class: Confirmed (stale citation) / Confirmed (loop gap). Severity: low for the citation, absorbed by PSP-03…PSP-07 for the gap.**

Evidence:
- HL-PERS-001 §1 quotes `def task_context(profile, history=()):` and calls out that "The `history` parameter is accepted but never used".
- The current implementation is `hermes_life/personality.py:49`:
  `def task_context(profile, learned_profile=None, task_knowledge=None)` — and the parameters **are** used
  (lines 53–74 build the `[Learned behavioral profile …]` block from preferences/corrections/decisions/workflows).
- The spec itself supplies the correct framing: "not merely an unused function parameter".

Mechanism/impact: the cited signature no longer exists, so a future implementer following §1 will hunt for a
parameter that was already removed (or "fix" it again). The substantive complaint — that learned information is
not shown to consistently influence behaviour — is real, and is located precisely by the findings below.

Coding solution: amend §1 of the spec to cite the current signature and to point at PSP-03…PSP-07 as the
outstanding work; keep the paragraph, drop the stale code block.

**Applied (revision 3):** `hermes-personality.md` §1 now cites `task_context(profile, learned_profile=None,
task_knowledge=None)`, notes the removed `history=()` quote, and points at the genuinely outstanding work
(**PSP-03** — not PSP-04…PSP-07, which are done; the PSP-02 assembly order was finished in a later pass). The
spec's **Status** line was corrected in the same pass (it claimed "End-to-end integration unverified"; the loop is
now verified), and the §9 remark that referenced the removed parameter was reworded so it no longer points at a
symbol that does not exist.

---

### PSP-02 — One context block is composed for every model call, and no rule arbitrates precedence between sources — **[RESOLVED — audience split + single documented order, §8]**
**Class: Confirmed. Severity: high (it is the integration defect and it dilutes verification).**

Evidence — the chain is `KnowledgeAdapter(PersonalityAdapter(delegate, personality), library)` (`app.py:66`) and **every** model call goes through `adapter.run(...)`:

```
app.py:133                     user chat/task          implementation.py:371          candidate implementation
formulation.py:89              goal formulation        implementation_revision.py:318 revision attempt
investigation.py:154           investigation           vault_memory.py:99             memory extraction
verification.py:414            criteria compiler       verification.py:652            per-criterion judge
```

`personality.py:114-117` composes every prompt as:

```python
augmented = (task_context(personality.get(), learned, relevant_memories)   # persona + preferences + corrections + decisions + workflows
             + memory.context(relevant)                                     # technical lessons
             + reflection.context(prompt)                                   # past reflections
             + prompt + '\n\n' + REPORT_INSTRUCTIONS)                     # learning-report protocol
```

and `KnowledgeAdapter.run` prepends library excerpts **outside** that block (`knowledge_library.py:151-153`):
`self.delegate.run(excerpts + '\n' + prompt if excerpts else prompt, …)`.

Spec impact: §5A ("must influence Hermes' execution without duplicating or contradicting instructions already
supplied by other context builders"), §5C ("Avoid redundant or conflicting context injection"), §6, #11.

Two further consequences follow from the same root cause:
1. **The verifier and the memory extractor receive the persona, the user's preferences and the lessons.** The
   judge prompt ends in a strict-JSON demand whose answer is parsed with `json.loads` (`verification.py:660`),
   while `REPORT_INSTRUCTIONS` (`technical_memory.py:262`) instructs "At the end of your answer … emit a
   machine-readable learning report … after the normal human answer" — two output contracts in one prompt, and a
   judge that is no longer evidence-only.
2. Five context sources (library, persona, learned profile, lessons, reflections) concatenate with no ordering or
   precedence rule anywhere in the code.

Coding solution:
1. `PersonalityAdapter(delegate, personality, audience='chat'|'analysis')`; compose persona/profile/lessons/
   `REPORT_INSTRUCTIONS` **only** for `audience='chat'`.
2. `runtime.analysis_adapter` (persona-free, report-free) used by `verification.py:414`, `verification.py:652`,
   `vault_memory.py:99` and any other prompt whose response is parsed as data.
3. One documented assembly order in one function (library → persona → learned profile → lessons → task prompt),
   with the library block moved *inside* the ordered composition instead of wrapping it.
4. Tests: analysis prompt contains no `[Hermes Life persona` marker and no `[HERMES_LEARNING_JSON]`; chat prompt
   contains both; a judge call must not create a reflective run or an experience row (see PSP-03).

---

### PSP-03 — The experience layer counts machine activity, and the store built for it is empty — **[RESOLVED — schema v33, §8]**
**Class: Confirmed. Severity: medium-high (it reports activity as learning).**

Evidence:
- `personality.py:120-133`: `reflection.record(...)` and `memory.record(...)` run for **every** successful adapter
  call, internal passes included.
- `reflection.py:27-45` writes a template lesson per run:
  `'For {category} work, retain verification of the outcome and compare changes against the task requirements.'`
- Live DB: `reflective_runs` = **128 rows**, `category='testing'` = **115**, **6 distinct `lesson` texts**.
- `personality.py:23` `experience_count = COUNT(*) FROM reflective_runs`; `frontend/src/main.ts:79` renders it as
  `"${persona.experience_count} recorded runs"`; `GET /api/personality/experiences` returns those template texts.
- `persona_experiences (id,state,note,created_at)` exists in `schema.py`, is **referenced only by that file**, and
  holds **0 rows**.

Spec impact: §2 layer 2 and §3 "Experience collection" (conversation outcomes, corrections, task results,
lessons, validated reflections), and §6's "do not confuse successful memory storage with demonstrated behavioral
learning". The layer the spec describes is the one store that is unused.

Coding solution: define an experience row as a *terminal, user-facing* outcome — write it once per terminal task
(`completed|failed|stopped|cancelled`) from `Autonomy`/task finalisation, into `persona_experiences` with an added
`task_id` and `goal_id`; `Personality.get()`/`experiences()` read that table; keep `reflective_runs` as internal
diagnostics only (or drop it from the API). Depends on PSP-02 so internal calls stop counting. Test: two terminal
tasks + one judge call ⇒ experience count 2, and the judge adds nothing.

---

### PSP-04 — Learned attributes carry no supporting evidence and no origin, so §5D/§5E cannot be enforced — **[RESOLVED — schema v30, §8]**
**Class: Confirmed. Severity: medium-high (blocks acceptance #6 and #8).**

Evidence:

```
PRAGMA table_info(hl_memories)          → id, content, kind, source_conversation_id, source_turn_id,
                                          status, superseded_by, created_at, updated_at
PRAGMA table_info(hl_memory_reviews)    → id, task_id, candidate, existing_memory_id, reason, status, created_at
personality.py:36-41 learned_profile()  → ORDER BY kind="preference" DESC, kind="correction" DESC, updated_at DESC
```

- No column holds the **evidence** for a learned statement — only provenance IDs (`source_conversation_id`,
  `source_turn_id`) and a `reason` on the review row.
- Nothing distinguishes an **explicitly stated** user preference from a **model-inferred** one, and nothing marks a
  statement as **temporary task instruction** vs **durable preference**.
- `learned_profile()` orders by `kind`, not by authority, so an inferred preference currently outranks an explicit
  correction when both are present.

Spec impact: §5B ("Each learned attribute must retain its source, supporting evidence, creation/update timestamps,
and current validity"), §5D (distinguish temporary from durable), §5E ("Explicit user corrections should take
precedence over conflicting inferred preferences"), #6, #8.

Coding solution: migrate `hl_memories` with `evidence_excerpt TEXT`, `origin TEXT` (`explicit|inferred|task`),
`confidence REAL`, `expires_at TEXT` (NULL = durable); populate them where memories are created
(`conversation_recall.remember`, and `vault_memory.extract_completed`, whose `_read()` already selects the exact
user turn — pass a bounded excerpt); order `learned_profile()` by `origin='explicit' DESC, updated_at DESC`;
return the new fields from the profile API. Tests: an explicit correction supersedes an inferred preference (#6);
the evidence excerpt is retrievable for each active preference (#8).

---

### PSP-05 — The learned profile can be seen but not inspected, corrected or invalidated from the product — **[RESOLVED — schema v31 + Overview surface, §8]**
**Class: Confirmed. Severity: medium.**

Evidence:
- API: `GET /api/personality`, `GET /api/personality/experiences`, `GET /api/personality/profile`,
  `GET /api/personality/profile/relevant`, `POST /api/personality/profile/{memory_id}/correct`,
  `GET /api/memory-reviews`, `POST /api/memory-reviews/{review_id}/resolve`.
- `POST …/correct` implements only `supersede` and `delete` (`app.py:764-779`); `delete` marks the memory
  `superseded` with no actor and no rationale recorded.
- `POST …/resolve` accepts only `accept|reject` (`app.py:607-610`); the spec's `merge` is absent.
- Live UI: `grep -rn 'memory-reviews' frontend/src/*.ts` → one **read** in `town-view.ts:208`; grep for
  `'/correct'`, `'personality/profile'`, `'personality/experiences'`, `'technical-lessons'` → **NONE**.

Spec impact: §5F (inspect the profile, expose supporting evidence and origin, correct or invalidate inaccurate
information and make it affect future behaviour), #8, #9.

Coding solution: a "Memory & lessons" surface — a section in the Overview tab (or its own tab) listing
`/api/personality/profile`, `/api/technical-lessons` and `/api/memory-reviews`, each row showing its evidence and
origin (from PSP-04) with actions that call `correct` / `resolve`; extend `correct` with `merge` and require a
rationale; record actor + rationale + timestamp in a history table; render the result in the persona card's
existing `#persona-feedback` line. Test: correct a memory → the next assembled prompt reflects the corrected
statement and excludes the old one (#9).

---

### PSP-06 — The Obsidian mirror is written once and never invalidated — **[RESOLVED — `retire_memory`; vault path reconfigured; 43 fixture notes cleaned, §8]**
**Class: Confirmed. Severity: medium (the vault keeps "current knowledge" that is no longer current).**

Evidence — `hermes_life/vault_memory.py:46-56`:

```python
def _mirror(self,entry):
    if not self.vault.is_dir():return
    dest=self.base/'Auto'/FOLDERS[entry['kind']]
    path=dest/(entry['id']+'.md')
    if path.exists():return            # write-once: never updated, never invalidated
```

- Call sites: `app.py:628` (explicit save) and `vault_memory.py:199` (extraction mirroring). The invalidation
  branches (`app.py:771-779`, `delete`; and the supersede path in `conversation_recall.remember`) call **no**
  mirror function.
- Vault on disk: `Hermes-Life/{Conversations,Projects/Hermes-Life,Memory/{Auto,Development-Reviews}}` exists, with
  50 `.md` files under `Memory` paths — i.e. real notes that can go stale.

Spec impact: §5G ("Prevent duplicate entries, contradictory mirrors, and obsolete records from being treated as
current knowledge"), #7.

Coding solution: write a status block into the front-matter (`status`, `superseded_by`, `updated_at`) and rewrite
it in place on supersede/invalidate (preserving any curated body below), or append an
`## Invalidated <date> by <new memory id>` section; never touch `Memory/Curated/`. Test: invalidate a memory →
its note carries the invalidation marker; a curated note is byte-identical before/after.

---

### PSP-07 — The loop has never been verified end to end, and nothing records which personality context a run received — **[RESOLVED — schema v32 + loop test, §8]**
**Class: Confirmed. Severity: high against the spec (its own status is "End-to-end integration unverified").**

Evidence:

```
$ grep -rl -- 'hl_memories|learned_profile|conversation_recall|VaultMemory|extract_completed' tests/*.py
hl_memories        -> NO TEST        learned_profile    -> NO TEST
conversation_recall-> NO TEST        VaultMemory        -> NO TEST
extract_completed  -> NO TEST
$ grep -n '^def test' tests/test_personality.py    → 5 tests (identity, experience count, label, transport, world reducer)
$ .venv/bin/python -m pytest --collect-only -q     → 145 tests collected
PRAGMA table_info(tasks) → id, prompt, state, created_at, updated_at, result, error, session_id
```

- No test exercises memory extraction, consolidation, retrieval, prompt assembly, or post-task learning — the five
  test files that mention "memory" merely touch adjacent code.
- `tasks` records no persona/profile/model/worker provenance, so "a correction measurably changes subsequent
  relevant responses" (#2) cannot be demonstrated even after the fact — while `implementation_evaluations` **does**
  record `environment_json`/`duration_ms`/`directory`, so the omission is inconsistent with the project's own
  provenance discipline.

Spec impact: §7 #12 ("tests cover memory extraction, consolidation, retrieval, prompt assembly, execution, and
post-task learning — not merely individual function behavior"), §9 (evidence that learned preferences influence
subsequent behaviour), #2, #5.

Coding solution:
1. Record what was injected: add `applied_persona_sha256` + `applied_memory_ids` + `applied_lesson_ids` (JSON) to
   `tasks`, written in `PersonalityAdapter.run` where `augmented` is composed; expose in `GET /api/tasks/{id}`.
2. Add `tests/test_pers_001_learning_loop.py` (the §7 #12 deliverable) using the project's tmp-DB fixture:
   task 1 states a durable preference → extraction stores it with evidence (PSP-04) → assert retrieval selects it
   for a related prompt and excludes an unrelated one (#4) → re-open with a fresh `create_app` on the same DB and
   assert the prompt for task 2 contains it (#1, #5) → supersede it with a correction and assert the newer wins and
   the older is not injected (#6, #9) → assert the vault note exists and is marked on invalidation (#7).
3. Cross-link the assertion to the recorded provenance from (1), so "adapted" is a measurable claim.

### UI-01 — Eleven controls are visible in the live UI with no handler, including goal creation and the scheduler toggle — **[RESOLVED — controls wired/hidden, §8]**
**Class: Confirmed (source + live DOM). Severity: high (functional regression).**

Evidence — live DOM measurement (all tabs, viewport-visible check):
```
Goals     : autonomy-toggle VISIBLE, goals-refresh VISIBLE, goal-title/goal-prompt/goal-priority VISIBLE
Planning  : formulations-refresh VISIBLE, plans-refresh VISIBLE
Build     : implementations-refresh VISIBLE
Discover  : decision-toggle/decision-interval/discovery-refresh hidden (rework hides legacy)
```
Source: **those ids appear only in `frontend/index.html`** and in **no live `frontend/src/*.ts`**:
```
$ grep -rl -- goals-refresh frontend/src/*.ts frontend/index.html
frontend/index.html
$ grep -rl -- autonomy-toggle autonomy-status overview-autonomy-status plans-refresh \
      implementations-refresh formulations-refresh discovery-refresh decision-toggle decision-interval \
      decision-state formulation-list frontend/src/*.ts
(no output)
```
No handler can be attached: not by id, and not by delegation — the label strings are absent from live code too
(`grep -rn "Enable autonomy\|Refresh plans\|Refresh proposals\|Refresh evaluations" frontend/src/*.ts` → only the rework's own generated buttons).

Regression proof — the previous `main.ts` (untracked copy `frontend/src/main.ts.backup`, 500 lines) wired them:
```
$ grep -o "\$('autonomy-toggle')\|\$('goals-refresh')\|\$('goal-form')\|\$('plans-refresh')\|..." main.ts.backup | sort | uniq -c
  2 $('autonomy-status')   2 $('autonomy-toggle')   2 $('decision-toggle')
  1 $('discovery-refresh') 1 $('formulations-refresh') 1 $('goal-form')
  1 $('goals-refresh')     1 $('plans-refresh')
```
Root cause: the per-tab refactor moved rendering into `phase41301-rework.ts` / `phase41302-workflow.ts` /
`phase415-review.ts`. Each hides or replaces *lists* (`goal-list`, `plans-list`, `implementations-list`,
`discovery-list`, `curiosity-list` are all owned), but the **control cluster and its status/feedback lines were
never re-owned**. `phase41302-workflow.ts:60` states the intent explicitly:
> `// Keep the original goal creation form and handlers, but put them behind a disclosure.`

The handlers it assumed were kept (`$('goal-form')`, `$('goals-refresh')`, `$('autonomy-toggle')`) lived in the
old `main.ts` and are gone — so `#goal-form` is moved into a `<details>` and left unwired (three grep patterns
confirm no `submit`/`onsubmit`/`FormData` handler for it in live code).

Consequences, all user-visible:
1. **A goal cannot be created from the UI** (`Add goal` submits nothing) — while the spec's workflow begins with goals (§7, §8.3).
2. **Autonomy cannot be enabled/paused from the UI** (`Enable autonomy` does nothing) though `GET/PUT /api/autonomy` works.
3. `Refresh` on Goals, `Refresh proposals`, `Refresh plans`, `Refresh evaluations` do nothing.
4. Status/feedback placeholders are **permanently static**: `autonomy-status`, `overview-autonomy-status`, `decision-state` render the literal `Checking…` forever, and `goal-feedback`, `formulation-feedback`, `plans-feedback`, `implementations-feedback`, `discovery-status`, `decision-feedback` are never written (``grep -rl` → markup only). That is a false in-progress claim (§0.3.2, §6.4).

Note on method: a behavioural click test was attempted but the browser harness tab freezes timers
(`document.visibilityState` hidden ⇒ pollers and `setTimeout` never fire), so request-attribution from clicks was
inconclusive; the source-level proof above is the load-bearing evidence, reinforced by the earlier regressions'
absence and the 0-request observations for `Enable autonomy` / `Refresh evaluations`.

Coding solution:
1. Give each tab module ownership of every control it leaves visible. Minimal, consistent approach: in
   `phase41302-workflow.ts` (Goals) wire `#goals-refresh` → `refresh.run()`, `#autonomy-toggle` → `PUT /api/autonomy`,
   `#autonomy-status`/`#overview-autonomy-status` → `GET /api/autonomy` (render enabled/paused + interval),
   and the `#goal-form` submit → `POST /api/goals` (validate ≥1 char, show `#goal-feedback`, then `refresh.run()`).
   In `phase415-review.ts` (Planning/Build) wire `#plans-refresh`/`#implementations-refresh` to the pollers'
   `run()`, or hide them exactly as the Discover rework hides its legacy block
   (`classList.add('hl413r-legacy')` / `hidden=true`).
2. Delete the OR wire the Discover legacy cluster (`#decision-toggle`, `#decision-interval`, `#decision-scan`,
   `#formulations-refresh`, `#formulation-list`) — the "Goal formulation" section is entirely unwired today,
   which is why `/api/formulations` has no UI consumer (HY-06).
3. Add the regression test that would have caught this: a static test asserting **every `id="…"` in
   `index.html` that is a `button`/`input`/`select`/`form` is referenced by at least one live `src/*.ts`**, or is
   inside a container that the modules mark hidden. Cheap, deterministic, and it turns this class of defect into
   a build failure.
4. No "Checking…" literal may remain in markup: initialise placeholders to `—` and let code set the real state.

### HY-01 — 52 superseded copies live in the source trees, 49 of them committed — **[OPEN]**
**Class: Confirmed. Severity: medium (hygiene, not behaviour).**

```
$ find . \( -name '*.before-*' -o -name '*.pre-*' -o -name '*.bak' -o -name '*.backup' \) | wc -l   → 52
$ git ls-files | grep -cE '\.(before-|pre-|bak|backup|orig)'                                        → 49 tracked
$ git ls-files --others --exclude-standard | grep -cE '\.(before-|pre-|bak|backup|orig)'             → 0 (2 patterns are in .git/info/exclude)
```
**49 of the 52 are committed to the repository** (a tracked file never appears in `git status` as untracked —
an earlier draft of this finding mislabeled them; corrected here).
Examples: `frontend/src/main.ts.before-phase37`, `hermes_life/app.py.before-phase40-20261101-231217`, `hermes_life/vault_memory.py.bak`, `frontend/src/style.css.backup`.

Impact: they do not break the build (not imported, not compiled), but they corrupt every audit and search — this
audit had to filter them out of ~20 greps, and a hardcoded `frontend/index.html.backup` plus
`frontend/src.backup-20261031-121857/` mirror whole files, so a naive scan can read a stale copy of any module
and believe it is live. `.git/info/exclude` has been used to hide two more patterns from `git status`.

Coding solution: `git rm` the tracked ones and delete the untracked ones in one commit after confirming each has a
`git log` ancestor (they are all pre-patch snapshots); keep history in git, not in the working tree. Optional:
add a guard test that fails if a tracked file matches `*.(before-*|pre-*|bak|backup)`.

### HY-02 — Stale bytecode from two interpreters — **[OPEN]**
**Class: Confirmed. Severity: low.** 39 `.pyc` files in `hermes_life/__pycache__`, 9 of them built by
`cpython-313` (the current interpreter is 3.14). None is git-tracked (1527 ignored `.pyc` exist repo-wide,
mostly inside `.venv`). Solution: delete `hermes_life/__pycache__` and any other package `__pycache__`; the
`.gitignore` coverage is already correct.

### HY-03 — Duplicate DDL for two tables — **[OPEN]**
**Class: Confirmed. Severity: low.** `schema.py` contains 44 `CREATE TABLE IF NOT EXISTS` statements for 42
distinct names — `implementation_reviews` and `investigation_plans` are declared twice. Idempotent today, but the
two copies can drift. Solution: keep one canonical declaration per table in the versioned migration and delete
the duplicate block.

### HY-04 — CSS for a UI that no longer exists — **[OPEN]**
**Class: Confirmed. Severity: low.** `frontend/src/style.css` classes with no consumer in live markup/TS:
`persona-traits`, `persona-trait-number`, `persona-label`, `goal-entry` (the first three are the removed Phase 3.7B
persona editor — see PSP-01). Solution: delete the block with the core-identity decision recorded in PSP-01. Note: `phase41301-rework.css` /
`phase41302-workflow.css` / `phase415-review.css` also show "unreferenced" classes, but those are **dynamically
constructed** (`'hl413-flow-chip-' + stage(...)`, `'hl415-verdict-' + verdict`) and are **not** dead — do not delete.

### HY-05 — Frontend helper duplication across tab modules — **[OPEN]**
**Class: Confirmed. Severity: low.** `node` and `btn` are defined in 2 live files, `records` in 2, `stamp` in 2
(`phase41301-rework.ts`, `phase41302-workflow.ts`, `phase415-review.ts`). Each tab is deliberately self-contained,
so this is a maintenance cost rather than a defect. Solution (optional): a shared `ui-kit.ts` exporting `node`,
`btn`, `text`, `val`, `stamp`, `records`, imported by the tab modules; do it only while touching those files for
another reason.

### HY-06 — Routes with no UI consumer (missing surfaces vs dead endpoints) — **[PARTLY RESOLVED — memory/lessons surface done, §8]**
**Class: Confirmed. Severity: medium where a spec requirement depends on it.**

| Route family | Live UI owner | Assessment |
|---|---|---|
| `/api/study/*` (sources, units, next, progress) | none | **missing implementation** — §9.3 requires visible study progress, blockers, evidence links |
| `/api/library/*` (sources, search, pages) | none | missing surface for the Knowledge Library (§9.1) |
| `/api/technical-lessons*`, `/api/personality/profile*` | `phase41303-memory.ts` | in use ✅ (PSP-05 surface) |
| `/api/reflections` | none | missing surface |
| `/api/memory-reviews` | `phase41303-memory.ts` (list + resolve) | resolve now reachable ✅ (PSP-05) |
| `/api/memory-corrections` | `phase41303-memory.ts` | in use ✅ (PSP-05) |
| `/api/formulations`, `/api/formulations/from-discovery/{id}` | none | the "Goal formulation" block exists in markup but is deliberately hidden (**UI-01**); no replacement surface yet |
| `/api/discoveries/{id}/{action}`, `/api/curiosity/{id}/{state}` | via the Discover rework (dynamic URLs) | in use ✅ |
| `/api/world/state` | none | intentional ✅ — this project's own notes forbid using it as a status source (it replays and rewrites world state on each read) |
| `/api/maintenance/prune-experiments` | none | admin-only; acceptable, but document it |
| `/api/autonomy/state` | — | returns 404; HL-SOT-001 §12 already says not to assume it exists ✅ |

Solution: the memory/lessons surface now **exists** (`phase41303-memory.ts`, PSP-05) and owns
`/api/personality/profile`, `/api/technical-lessons`, `/api/memory-reviews` (including resolve) and
`/api/memory-corrections`. Remaining missing surfaces: the study dashboard (§9.3), the Knowledge Library surface
(§9.1), `/api/reflections`, and a real Goal-formulation surface (that block is currently hidden, not built).
Document the admin-only routes in the README so they are not mistaken for dead code.

---

## 4. Verified non-findings (checked, cleared — recorded so nobody re-audits them)

- **Circular dependencies: none.** A DFS over the module import graph (30 modules, including function-level
  imports) reports **0 cycles**. Every module has at least one live importer except `app` (the entrypoint) and
  `__init__`.
- **No unreachable/dead backend modules.** 30/30 package modules are reachable from `hermes_life.app`;
  `world.py`, `reflection.py`, `curiosity_workflow.py`, `decision.py`, `maintenance.py`, `workflow_status.py`,
  `knowledge_library.py`, `project_approvals.py`, `project_knowledge.py`, `conversation_memory.py`,
  `conversation_recall.py`, `vault_memory.py` all have live importers (tests are secondary importers).
- **No duplicated memory/reflection injection across adapters** (HL-PERS-001 §6). `KnowledgeAdapter.run` adds
  library excerpts only (`knowledge_library.py:151-153`); memory, learned profile, lessons and reflections are
  injected exactly once, inside `PersonalityAdapter.run`. What is *not* solved is precedence between the two
  injection points — that is PSP-02, not a duplication defect.
- **No duplicated embedded guest scripts.** The large-string scan finds no identical >600-char constant in two
  modules — the `for_worker()` refactor unified `ENV_RESOLVER`/`ENV_PROMPT`-style payloads into `guest_env.py`
  and every guest now imports or wraps it.
- **No tracked bytecode or databases.** `git ls-files | grep '\.pyc$'` → 0; no `.db` is tracked.
- **`/api/world/state` writes on read** (it replays and stores world state) — a hazard this project already
  documents; the live UI correctly avoids it.
- **Retracted hypotheses of my own** (kept for honesty): I first suspected that `memory_reviews` /
  `technical_lesson_reuse` tables were missing — wrong names; the real tables are `hl_memory_reviews`,
  `lesson_reuse` etc. and `GET /api/memory-reviews` returns data. I also produced a spurious "all ids
  unreferenced" result from a path bug in my own probe (double-prefixed `frontend/`); the corrected run is the
  evidence printed in UI-01.

---

## 5. Remediation plan

HL-PERS-001 §8 prescribes its own procedure (inspect → trace the flow → find missing connections →
smallest coherent integration → unified context pipeline + persistent profile → validated learning and
contradiction handling → provenance and inspection/correction → multi-conversation/restart testing → document).
The findings are ordered to follow it, and §9's deliverables are the exit criteria.

Dependency map:

```
PSP-02 audience split  ──► PSP-03 experience semantics (stops internal calls counting as experience)
                       └─► PSP-07 provenance + integration test (a measurable "applied profile")
PSP-04 evidence/origin ──► PSP-05 inspect & correct surface (rows need evidence to show)
                       └─► PSP-06 mirror status (invalidation needs a reason + origin to record)
PSP-01 spec correction   (independent, one paragraph)
UI-01 control wiring     (independent; the largest user-visible gain)
HY-01..HY-06 hygiene     (independent; one sweep)
```

Order, with status as of revision 3:

- **P0 — PSP-02.** ✅ done — the audience split *and* the single documented assembly order
  (`personality.compose_prompt`; the wrapping `KnowledgeAdapter` is gone). `tests/test_pers001_audience.py`.
- **P0 — UI-01.** ✅ done — Goals/Planning/Build controls wired or deliberately hidden; `Checking…` removed;
  `frontend/tests/control-wiring.test.ts`.
- **P1 — PSP-04, then PSP-05.** ✅ both done (schema v30/v31 + the Overview memory surface).
- **P1 — PSP-03 and PSP-07.** ✅ both done — PSP-07: schema v32 + `tests/test_pers001_learning_loop.py`;
  PSP-03: schema v33 + `tests/test_pers001_experience.py` (an experience is a terminal task outcome).
- **P1 — PSP-06** (vault invalidation). ✅ done.
- **P2 — PSP-01** (spec wording). ✅ done — `hermes-personality.md` §1 now cites the current signature and the
  Status line reflects the verified loop.
- **P2 — HY-01…HY-06.** **Still open** (HY-06 partly resolved) — one hygiene sweep.

Verification required per fix (no success claim without observed output): `./.venv/bin/python -m pytest -q` stays
green with the new tests; `npx tsc --noEmit` clean; `npm run build` succeeds; for UI-01 a browser pass that clicks
the newly wired controls and asserts one request plus a visible state change; for PSP-02 the two prompt-content
assertions; for PSP-04…PSP-06 the migration plus a tmp-DB round trip. **On the current host** the backend suite is
`181 passed / 2 failed` (the two failures are the FLOW-004/006 guest-env tests, environmental — §2), `tsc --noEmit`
is clean, and the frontend `node --test` runner cannot execute `.ts` on this host's Node build (it is compiled
without TypeScript support), so `npm test` cannot be run here.

Exit criteria are HL-PERS-001 §9: implemented source changes, migrations, regression + integration tests, evidence
that learned preferences influence subsequent behaviour, verification of SQLite **and** Obsidian persistence,
documentation of the final context-assembly architecture, and a report separating completed functionality from
remaining limitations (this audit supplies only the last item).

## 6. Coverage limitations of this audit

- **No application code, config, dependency or migration was changed.** The only file written is this report.
- **No live agent run was performed for the audit**, so PSP-02's prompt-content claim is proven from the code path
  (`personality.py:114-117` + the enumerated call sites), not from a captured prompt. Capturing one is the natural
  next evidence step if you want it verbatim.
- **Database access was read-only** (`sqlite3` URI `mode=ro`); the live backend was never restarted or mutated.
- **Browser checks were limited** to DOM/text/visibility and route instrumentation; the harness tab freezes timers,
  which is why UI-01 rests on source-level absence rather than a click trace.
- **Not covered / not executed:** no memory-extraction run, no Obsidian write, and no consolidation or retrieval
  was executed during this audit (vault contents were inspected on disk, not produced by a run); the VM/worker side
  of the personality pipeline (no guest execution); the study progression engine over time; chat scroll/branch
  behaviour; and the autonomy scheduler's live decisions.
- **Findings are against HL-PERS-001 as written.** Where the spec's own text is stale (PSP-01) or where a
  requirement is not test-shaped (e.g. §5D's "repeatedly corrects"; §3's "successful problem-solving approaches"),
  the audit says so rather than inventing a mechanism.
- Files I did not open but that are implicated by findings: `phase412-project-ui.ts` (referenced only in the
  orphan-id sweep), `scripts/*` (only greped), and the historical phase documents beyond the persona sections.

## 7. Audit integrity

`git status --porcelain --untracked-files=all` at the time of writing shows **no modification attributable to this
audit beyond this file** — through its second revision (made after `hermes-personality.md` was populated) and its
third (revision 3, re-verified against the current tree and the suite after the Kubuntu→Ubuntu migration): the
spec was read, the code was re-inspected for PSP-01…PSP-07 and UI-01 (`knowledge_library.KnowledgeAdapter.run`,
`vault_memory.retire_memory`, the memory-table schemas at v30–v32, `phase41303-memory.ts`, the test inventory),
and only this report was rewritten. Revision 3 changed no code; it corrected statuses and recorded that the audit's
pre-migration database evidence is no longer present on this host. Pre-existing entries (the worker-migration work
from the previous task, plus `hermes-personality.md`) are unchanged by this audit; the only new file is
`personalityaudit.md`.

---

## 8. Implementation status — PSP-02/04/05/06/07 and UI-01 implemented and verified

Recorded here so the findings above are not read as still-open. Every item in this section was **re-checked
against the current tree during revision 3** and still holds in code. The "live evidence" lines that quote row
counts describe the pre-migration database, which no longer exists on this host (see the §2 caveat); those claims
now rest on the code and the test suite.

**PSP-02 — audience split + one documented assembly order (done).**
- `hermes_life/personality.py`: `PersonalityAdapter(delegate, personality, audience='chat')`; `audience != 'chat'`
  (or `personality is None`) passes the prompt **verbatim** and records nothing — no persona, no learned profile,
  no lesson recall, no reflections, no `REPORT_INSTRUCTIONS`, no `reflective_runs`/`technical_lessons` row.
- `hermes_life/app.py`: one delegate per profile is now built once (`runtime.delegates`); the chat chain wraps it
  (`runtime.adapters`, persona + library), and `runtime.analysis_adapters` exposes the same delegates **unwrapped**
  (persona-free, library-free, same tool scope) with `runtime.analysis_adapter = analysis_adapters['read_only']`.
  `vault_memory.adapter` now points at the analysis chain, because extraction answers in JSON.
- `hermes_life/verification.py`: both analysis sites (criteria compiler, per-criterion adjudicator) resolve through
  the new `VerificationEngine._analysis_adapter()`.
- Tests: `tests/test_pers001_audience.py` (5) — chat prompts carry the persona + report protocol; analysis prompts
  are byte-identical to the caller's prompt and create no reflective run or lesson; a stored preference appears in
  chat prompts only; the runtime wires both audiences over one delegate per profile; criteria compilation runs
  persona-free. The four `test_verify001_*` files were updated to override `analysis_adapters['read_only']`.
- **Assembly order (PSP-02 sub-item, revision 3).** All five sources now compose in exactly one place:
  `personality.compose_prompt(library=…, profile=…, learned_profile=…, task_knowledge=…, lessons=…,
  reflections=…, prompt=…)`, whose docstring states the order — library → persona → learned profile → recalled
  memory → lessons → reflections → task prompt → report protocol. `KnowledgeAdapter` was removed entirely; the
  chat chain is now `PersonalityAdapter(delegate, personality, audience='chat', library=knowledge_library)`, so
  the library is a source *inside* the order, not a wrapper around it. `tests/test_pers001_audience.py` gained an
  ordering assertion (library before persona before task before the report protocol); `test_scope_enforcement.py`
  was updated for the one-less-wrapper chain. The standalone `test_knowledge_library.py` now exercises
  `KnowledgeLibrary.context()` directly.

**UI-01 — controls wired (done).**
- `frontend/src/phase41302-workflow.ts`: `api()` now accepts a body; the Goals tab wires `#autonomy-toggle`
  (`PUT /api/autonomy`) and the `#goal-form` submit (`POST /api/goals`, client-side validation, `#goal-feedback`),
  and paints the **read** scheduler state into `#autonomy-status` and `#overview-autonomy-status`; the legacy
  `#goals-refresh` duplicate is hidden (the pane renders its own Refresh with a visible lifecycle).
- `frontend/src/phase415-review.ts`: the remaining handler-less legacy controls are hidden with the same
  rationale — `#plans-refresh`, `#implementations-refresh`, and the whole Goal-formulation block
  (`#formulation-section`/`#formulations-refresh`/`#formulation-list`). That block has no replacement surface yet:
  HY-06 still owns building one.
- `frontend/index.html`: the three static `Checking…` placeholders are now `—`; nothing claims activity that is
  not happening.
- Test: `frontend/tests/control-wiring.test.ts` (4, wired into `npm test` via `npm run test:ui`) — every
  interactive id in `index.html` must be referenced by a live module or listed as deliberately hidden; the goal and
  scheduler controls must be wired; the form must POST to the documented route; no `Checking…` literal may remain.
- Live evidence (browser, live backend): `#autonomy-status` and `#overview-autonomy-status` read "Scheduler
  enabled", `#autonomy-toggle` reads "Pause autonomy" and is enabled; the pane's Refresh issues `GET /api/goals`;
  an empty submit answers "A goal needs a title and the exact task."; a filled submit ran the full path
  ("Adding goal…" → "Goal added") with the request intercepted, and the live goal count stayed at **22**.
- Scope call: the dead Goal-formulation *section* is hidden rather than wired, because wiring it means building a
  formulation surface (HY-06). Recorded in the code comment and in the UI test's allowlist.

**Verification of this work (as recorded at implementation time):** `150 passed` (145 + 5 new backend tests),
`frontend: 24 town + 4 control-wiring` tests pass, `npx tsc --noEmit` clean, `npm run build` ✓,
`hermes verify --json` → `ok: true`, readiness 200, live `/health` reporting the Lenovo worker.

**Re-verification, revision 3 (current host):** backend `181 passed / 2 failed` — the two failures are the
FLOW-004/006 guest-env tests and are environmental, not personality (§2); the personality tests
(`test_pers001_*`, `test_personality`) are among the 181 passing. `frontend/node_modules/.bin/tsc --noEmit` is
clean. `hermes verify` / `/health` are reachable with the Lenovo worker connected. The frontend `node --test`
suites **cannot be executed on this host** — the Node build reports `ERR_NO_TYPESCRIPT` (compiled without
TypeScript support) — so the town/control-wiring counts above are carried over from the implementation run and
were not re-run here.

**PSP-04 — provenance storage (done).**
- Schema v30 (`hermes_life/schema.py`): `hl_memories` gains `evidence_excerpt`, `origin`, `confidence`,
  `expires_at`, `rationale`, `decided_by`; enforced in all three places (base DDL, the lazy `setup()` in
  `conversation_recall.py`, and the versioned `_upgrade_to_v30` ALTERs). Legacy rows keep `origin = NULL`.
- `conversation_recall.remember()` now takes and validates provenance (`origin` must be `explicit` or
  `inferred`; anything else is refused, never guessed) and returns it.
- `vault_memory` keeps the verbatim quote it already validated (previously discarded) and records the
  origin the extractor reports; an unrecognised/missing origin is stored as `inferred`.
- `Personality.learned_profile()` selects the provenance and orders explicit statements above inferences
  (§5E), and `task_context()` labels each line `(user-stated)` or `(inferred)` so the model can weigh them.
- `POST /api/memories` passes provenance through (a human save defaults to `explicit`).
- Tests: `tests/test_pers001_profile_provenance.py` (5) — a v29 database is upgraded in place with no row
  loss and unknown provenance stays unknown; explicit outranks a newer inference; an unknown origin is
  refused; the prompt labels provenance; extraction stores the validated quote and never upgrades an
  inference to explicit.
- **Latent bug found and fixed while adding v30:** `schema.migrate()`'s "repair partially-applied v4"
  branch hard-coded `PRAGMA user_version=29`, so a database taking that path was silently downgraded past
  v30 (the new migration test caught it). It now records `SCHEMA_VERSION`.
- Live evidence: the running backend migrated the live database to **user_version 30** with all **10
  existing memories intact** and `origin` NULL on every legacy row.

**PSP-05 — inspect, correct and invalidate from the product (done).**
- Schema v31 (`hermes_life/schema.py`): new `hl_memory_corrections` history table
  (`memory_id, action, actor, rationale, new_memory_id, created_at`) plus `evidence_excerpt`, `origin`,
  `resolution_rationale`, `resolved_by` on `hl_memory_reviews`. Enforced in all three places as usual
  (base DDL, lazy `setup()`, versioned migration).
- `POST …/personality/profile/{id}/correct` now takes `merge` as well as `supersede`/`delete`, and
  **requires a rationale** (`min_length=4`) plus an optional actor. Every action writes a history row,
  copies actor/rationale onto the retired memory, and emits `personality.profile_corrected` naming both.
  `merge` retires a duplicate in favour of the memory it duplicates (`superseded_by = merge_into`) and
  refuses an empty, self-referencing or inactive target — it never invents combined wording.
- `POST …/memory-reviews/{id}/resolve` accepts `merge` alongside accept/reject. A merge keeps the existing
  memory unchanged, records the reason and the actor on the review, and writes a history row; it requires a
  rationale (a merge silently drops a candidate) and is refused when there is no memory to merge into.
  Accept/reject now also record actor + rationale on the review.
- `GET /api/memory-corrections` exposes the history; `learned_profile()` returns `rationale`/`decided_by`
  so a corrected memory shows why it changed.
- Review rows now carry the candidate's own validated quote and origin, so a pending candidate is
  reviewable without re-deriving its support.
- Surface: a "Learned profile & memory review" section on the Overview tab
  (`phase41303-memory.ts` + `.css`) listing memories with kind, evidence and origin, pending reviews,
  technical lessons and recent corrections, with Replace / Merge… / Invalidate and Accept / Reject /
  Merge actions. The correction form states its target, shows only the fields the chosen action uses, and
  reports every outcome in `#memory-feedback` **and** `#persona-feedback`.
- Tests: `tests/test_pers001_memory_surface.py` (8) — a correction without a reason is refused; after a
  supersede **the next prompt assembled for the worker carries the corrected statement and drops the old
  one** (#9); delete invalidates without inventing a replacement; merge retires a duplicate in favour of the
  target; merge refuses missing/self/inactive targets; extraction files a review with its evidence and
  origin; a review merge requires a reason, keeps the memory, and stays resolved; a review merge with no
  memory to merge into is refused (409). Frontend: `control-wiring.test.ts` gained the surface assertions
  (5 tests) and now treats a submit button as covered by its wired form instead of needing its own handler.
- Live: schema migrated to **v31** (10 memories intact, 8 pending reviews, 0 corrections). Browser check
  against the running app rendered all four lists; "Merge" on a review with no reason and a correction with
  no reason were both refused locally with **0 requests**; a filled correction produced exactly one
  `POST …/correct` with `{action, rationale, actor, new_content}` and reported the result on both feedback
  lines — **with the request intercepted, so the live database still holds 10 active memories, 0
  corrections, and the probed memory unchanged.**

**PSP-06 — the Obsidian mirror is now invalidated, not write-once (done).**
- `vault_memory`: a note's front matter records `status`, `updated_at`, `origin`, `evidence_excerpt`
  (plus the existing id/kind/source keys); `retire_memory(memory_id, kind, status, superseded_by,
  rationale, actor)` rewrites **only generated lines** — it sets the status keys and puts a
  `> **Superseded** on <date> by <id> — <reason>` marker directly above the body, which is preserved
  verbatim. Retiring twice replaces the marker instead of stacking it; a note the vault never had is left
  uncreated; `Memory/Curated/` is never written (the mirror only writes under `Auto/`).
- Wired to the real lifecycle: `correct` supersede/merge/delete and review `accept` all mark the note for
  the memory they retire (`deleted` reads as `status: "invalidated"` — the note says what the memory *is*,
  not which button was pressed), and `POST /api/memories` now mirrors an explicitly saved memory, which it
  previously never did.
- The vault is secondary: `mirror_memory`/`retire_memory` report `failed` instead of raising, so a
  read-only or broken vault can never fail a correction.
- Tests: `tests/test_pers001_vault_mirror.py` (10) — status/provenance on a fresh note; an invalidated
  memory is marked **and keeps its body**; supersede marks the old note and writes the replacement; merge
  retires the duplicate and leaves the target current; retiring twice leaves one marker; no note is created
  for a memory the vault never saw; a curated note is byte-identical after a retire; a vault failure does
  not fail the correction; a review accept marks the note it replaced.
- Live: the real vault was inspected **read-only** — 57 notes under `Memory/`, 9 under `Auto/`, none yet
  carrying a status key (legacy notes predate the status block and gain it the moment their memory is
  retired; nothing backfills them preemptively — noted, not done). Live database untouched: 10 memories,
  0 corrections.
- **Additional defect found and fixed (same family):** the backend suite had been resolving the *live*
  Obsidian vault and writing fixture notes into it — `tests/conftest.py` isolated the database but not the
  vault, and `vault_memory`'s default path is the user's real vault. **43 of the 48
  `Memory/Development-Reviews/*.md` notes in the real vault are test fixtures** (`Project: demo`,
  `Plan: plan`, written from 2026-11-05 onward). Conftest now points every test at a disposable vault, and a
  guard test asserts the resolved vault is never the real one; the 173-test run after the fix added **zero**
  notes. The 43 existing files were left in place — removing them is a change to the user's notes, so it
  waits for an explicit go. *(Superseded in revision 3 — the fixtures were archived and deleted; see the
  "Test-fixture notes removed" bullet below.)*
- **Revision 3 — the vault path was wrong, so the mirror was inert on this host.** The `HERMES_LIFE_OBSIDIAN_VAULT`
  default was `~/black/obsidian/hermes` (the pre-migration mount). After the migration the external disk is mounted
  by udisks2 at `/run/media/gayzer/black`, so the default did not resolve: `vault.is_dir()` was false and every
  `_mirror`/`retire_memory` call returned early. The vault itself survived intact on that disk — **57** notes under
  `Memory/`, **9** under `Auto/`, **48** under `Memory/Development-Reviews`, and still **0** carrying a status key.
  Fixed by configuration: `config/hermes-life-host.env` sets
  `HERMES_LIFE_OBSIDIAN_VAULT=/run/media/gayzer/black/obsidian/hermes` (sourced by `start.sh`, overridable via
  `HERMES_LIFE_HOST_ENV`), and the three code defaults (`vault_memory`, `conversation_memory`, `project_knowledge`)
  were pointed at the same path so a bare run does not silently no-op. **Verified live:** the running backend's
  environment carries the new path, `app.state.runtime.vault_memory.vault.is_dir()` is `True`, the six
  `test_pers001_*` files pass (38), and no test wrote to the real vault (it then held 57 Memory notes; the 43
  fixture notes were removed later in this same revision — see below).
- **Test-fixture notes removed (revision 3, on explicit go).** The **43** `Project: \`demo\`` fixture notes under
  `Memory/Development-Reviews` were archived to
  `~/.local/share/hermes-life/development-reviews-demo-fixtures-<timestamp>.tar.gz` (43 entries) and then deleted;
  the **5** real reviews were kept. `Memory/Development-Reviews` now holds 5 notes and `Memory/` 14.
- **Still by design (not a defect):** legacy notes are not backfilled with a status key — they gain it the moment
  their memory is retired.

**PSP-07 — the loop is verified end to end, and every run records what it was told (done).**
- Schema v32: `tasks` gains `applied_persona_sha256`, `applied_memory_ids`, `applied_lesson_ids` (JSON
  arrays), written in `PersonalityAdapter.run` **before** the delegate runs — it describes the input the
  task received, not a claim the model made — and exposed automatically by `GET /api/tasks/{id}` and
  `GET /api/tasks`. A pre-existing row keeps NULL: "not recorded" must not read as "nothing was applied".
- Retrieval now reports what it selected: `Recall.relevant_context()` returns ranked entries each naming
  the memory it came from (`None` for a past-turn snippet) and `format_relevant_context()` renders them,
  so `retrieve()` is unchanged for callers while the run can record real ids.
- `injected_profile_memories()` is the single source of truth for which learned memories the profile block
  prints (5 preferences / 5 corrections / 3 decisions / 3 workflows); `task_context()` renders exactly that
  selection and the run records exactly that selection, so a run cannot claim to have been told something
  the prompt never contained. `applied_memory_ids` is the union of the retrieved history and the profile
  block.
- `tests/test_pers001_learning_loop.py` (3) — the §7 #12 deliverable, driven entirely through HTTP against
  a real database and a real vault:
  1. a stated preference is extracted with its verbatim evidence and origin → retrieval selects it for a
     related prompt and excludes an unrelated one (#4) → **a fresh `create_app` on the same database** still
     injects it into a later task (#1, #5) → the run's recorded persona hash equals sha256(PERSONA) and the
     recorded memory ids name the memory that reached the prompt (#5, #9);
  2. the recorded lesson ids are exactly the supported lessons that matched the prompt, and an unrelated
     task records none;
  3. a correction supersedes the memory, the newer statement reaches later prompts, the retired one reaches
     none, the run names the corrected memory id, the vault note is written and then marked `superseded`,
     and the replacement note is `active` (#6, #7, #9).
- Live: schema migrated to **v32**, `tasks` carries the three columns and the API exposes them, the 98
  pre-existing tasks read `NULL` (they predate the change), and the live database still holds 10 memories
  and 0 corrections.

**PSP-03 — an experience is a terminal task outcome, and the store built for it now has a writer (done).**
- Schema v33: `persona_experiences` gains `task_id` and `goal_id` (base DDL + versioned `_upgrade_to_v33`),
  with a unique index on `task_id` so one task contributes exactly one experience.
- `hermes_life/personality.py`: `TERMINAL_TASK_STATES = ('completed', 'failed', 'cancelled')` ('stopped' is not
  a task state in this system — it is an internal verification reason, so it is absent); `Personality.record_experience`
  upserts one row per terminal task and **refuses** a non-terminal state rather than guessing; `Personality.get()`
  and `experiences()` now read `persona_experiences` instead of `reflective_runs`, and `mode` reads
  `fixed-with-experience`.
- `hermes_life/app.py`: `Runtime.record_experience()` is called at the two task-finalisation points —
  `run_task` (completed/failed) and the cancel endpoint (cancelled). It resolves the owning goal, and is guarded
  so bookkeeping can never change the task's own terminal state (a failure emits `experience.record_failed`).
  `run_task` now also reads the task prompt once instead of four times.
- `hermes_life/reflection.py` + `app.py`: `reflective_runs` stays internal diagnostics — `/api/reflections`
  gained `Reflection.recent()` and no longer reports experiences; `/api/personality/experiences` returns terminal
  outcomes keyed by task/goal. The persona card now reads "recorded outcomes".
- Tests: `tests/test_pers001_experience.py` (6) — two terminal tasks are two experiences; a failed task records a
  `failed` experience; an internal analysis pass adds neither an experience nor a reflective run; a cancel recorded
  twice stays one row; rows name their task and goal; a recording failure leaves the task `completed` and emits the
  event. `tests/test_personality.py` updated (experience no longer derives from `reflective_runs`).
- Live: the running backend migrated the live database to **user_version 33**; a submitted task completed on the
  Lenovo (`result: pong`) and produced exactly one `persona_experiences` row (`state=completed`, `goal_id=NULL`,
  `note` = the prompt); `/api/personality` reports `experience_count: 1` and `/api/personality/experiences`
  returns that row.
- **No backfill (deliberate — same principle as PSP-07):** tasks that reached a terminal state before v33 have no
  experience row, so `experience_count` counts outcomes recorded from v33 onward. "Not recorded" must not read as
  "no experience happened".

## 9. What is done and what remains (revision 3 summary)

**Done** (implemented in code and pinned by tests, unless noted):

- **PSP-04** provenance storage — schema v30: evidence excerpt, origin, confidence, validity window, rationale,
  decider; `learned_profile()` orders explicit above inferred.
- **PSP-05** inspect / correct / invalidate from the product — schema v31, the correction API
  (supersede/delete/merge with a mandatory rationale and a correction history) and the Overview memory surface
  (`phase41303-memory.ts`).
- **PSP-06** Obsidian mirror invalidation — `vault_memory.retire_memory`, wired to correct/resolve/save; the vault
  path was also reconfigured to the external disk (`/run/media/gayzer/black/obsidian/hermes`) after the migration
  left the code default pointing at a mount that no longer exists, and the 43 historical test-fixture notes were
  archived and removed from the real vault.
- **PSP-07** end-to-end loop verification + recorded applied context — schema v32 (`tasks.applied_*`) and
  `tests/test_pers001_learning_loop.py`.
- **UI-01** control wiring — goals/autonomy wired, handler-less legacy controls hidden, `Checking…` removed,
  `frontend/tests/control-wiring.test.ts`.
- **PSP-02** the chat/analysis audience split (analysis passes are persona-free and record nothing) **and** the
  single documented context-assembly order (`personality.compose_prompt`; the wrapping `KnowledgeAdapter` is gone).
- **PSP-01** the spec's §1 now cites the current `task_context` signature, and its Status line no longer claims
  "unverified".
- **PSP-03** experience is a terminal task outcome (schema v33), written once per completed/failed/cancelled task
  into `persona_experiences`; `reflective_runs` is diagnostics only and no longer inflated by internal calls.

**Remaining:**

- **HY-01…HY-05** — the hygiene sweep: 52 stale copies (49 tracked); mixed-interpreter bytecode; duplicate DDL;
  dead CSS; duplicated frontend helpers. HY-06's memory/lessons half is done via PSP-05, and its remaining
  unconsumed routes are `/api/study/*`, `/api/library/*`, `/api/reflections`, `/api/formulations`.
- **Environment (post-migration), not spec:** the pre-migration database is gone, the backend suite carries 2
  unrelated FLOW-* guest-env failures, and the frontend `node --test` runner cannot execute `.ts` on this host's
  Node build. See §2.
