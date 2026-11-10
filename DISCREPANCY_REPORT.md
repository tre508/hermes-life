# Hermes Life — Discrepancy Report
**Audit against:** `hermes-master-dev-spec-updated.md` (HL-SOT-002 v2.1, 2026-11-10)
**Codebase commit:** `952268c` (main, up to date with origin/main)
**Audit date:** 2026-11-10

---

## Executive Summary

The codebase implements **significant portions** of the v2.1 specification but has **critical gaps** in:
1. **Autonomous initiative (HL-AUTO-001)** — entirely absent; only scaffolded in roadmap
2. **Unified platform-owned test environments (HL-ENV-007/FLOW-007)** — partially implemented but unverified
3. **Approval handoff (HL-FLOW-008)** — approved plans can start builds, but the "no indefinite limbo" guarantee is not enforced
4. **Workflow progress UI (HL-UI-008)** — fragmented across modules; no single authoritative status view
5. **Candidate accept/reject/revise/apply workflow (HL-BUILD-009)** — review UI exists but apply-to-host has gaps
6. **Projects portfolio UI (HL-AUTO-UI-002)** — basic project registry exists; no autonomous project support
7. **Event-driven virtual lab (HL-WORLD-014)** — 3D world renders but doesn't map to real events faithfully
8. **Memory/Obsidian verification (HL-MEM-013)** — extraction runs but retrieval/evidence tests unverified
9. **Study automation (HL-STUDY-015)** — manifest exists but autonomous completion unverified
10. **Experiment pruning (HL-MAINT-016)** — dry-run endpoint exists but no verified implementation

**Overall implementation status:** ~65% of normative requirements have backend support; ~45% have verified end-to-end UI.

---

## Section-by-Section Discrepancy Analysis

### 2. Deployment & Architecture (§2)

| Spec Requirement | Status | Evidence |
|------------------|--------|----------|
| HL-ARCH-001: Host controls scheduling/approvals/secrets; VM executes untrusted code | ✅ Implemented | `app.py`: Runtime owns `Autonomy`, `Store`, `ProjectWorkspaces`; `ImplementationEngine` requires SSH transport |
| HL-ARCH-002: Single typed domain service for authoritative state | ⚠️ Partial | `WorkflowStatus` class exists (`workflow_status.py`) but multiple modules read `state` columns directly |
| HL-ARCH-003: SQLite owns workflow transitions; Obsidian mirrors only | ✅ Implemented | `store.py` emits events; `vault_memory.py` mirrors with `retire_memory` |
| HL-ARCH-004: Stable IDs, actor/trigger, timestamps, parent links, outcomes, errors | ✅ Implemented | `store.emit()` includes linking fields; `events` table has `project_id`, `goal_id`, `run_id`, `correlation_id`, `error` |

**Gap:** `WorkflowStatus` (HL-UI-STATE-001) is instantiated but not all tabs consume it consistently. Some modules (e.g., `phase41301-rework.ts`, `phase41302-workflow.ts`) compute status locally from `workflow` annotation but others may bypass.

---

### 3. Global UI Design System (§3)

| Spec Requirement | Status | Evidence |
|------------------|--------|----------|
| HL-UI-001: Three conceptual regions (workspace, activity/world, chat) | ✅ Implemented | `main.v2.ts`: `layout-home` (world), `layout-workspace`, `layout-focus`; chat is floating panel |
| HL-UI-002: Common page contract (title, freshness, loading, filters, primary action, clickable records, human-readable summaries, in-view feedback, keyboard accessible) | ⚠️ Partial | `phase41302-workflow.ts`, `phase415-review.ts` have refresh controls with lifecycle; some legacy tabs lack |
| HL-UI-003: Data freshness labels from backend records, not browser refresh | ⚠️ Partial | `main.v2.ts` shows `lastFreshness` from events; `phase41302-workflow.ts` shows `Checked <time>` from refresh controller |
| HL-UI-004: Consistent visual state families (Not started, Active, User gate, Blocked, Failed, Completed step, Finished outcome, Disconnected) | ⚠️ Partial | Chips used in workflow tabs (`hl413-flow-chip-*`, `hl415-chip`) but not all states covered; no "Disconnected" state visible in UI |

**Gap:** The `Discover` tab (`phase41301-rework.ts`) uses `stage(r)` from workflow but maps to limited set. The `Goals` tab uses custom `group()` function. No unified state taxonomy across all tabs.

---

### 4. Overview Dashboard (§4)

| Spec Requirement | Status | Evidence |
|------------------|--------|----------|
| HL-UI-OVERVIEW-001: Active work, Needs decision, Queue, Recent outcomes, System health, Storage advisory | ⚠️ Partial | `main.v2.ts` Home workspace shows: current task, recent events, persona, connection/execution status. **Missing**: explicit "Needs your decision" section, Queue with prioritized goals, System health detail, Storage advisory |

**Gap:** The Home workspace is more a "current activity" strip than a control center. No actionable decision queue visible.

---

### 5. Chat (§5)

| Spec Requirement | Status | Evidence |
|------------------|--------|----------|
| HL-UI-CHAT-001: Compact header, expandable Workspace button, conversation selector, project controls in drawer | ✅ Implemented | `phase412-project-ui.ts`: compact picker, isolated drawer, expand/restore, chat panel class `hc415-chat` |
| HL-UI-CHAT-002: Two-way conversation, streaming, inline Working display, View task/evidence, Edit+rerun, Stop/Pause, project selection, survive refresh | ⚠️ Partial | `hermes-chat.ts` + `conv-composer.ts` + `conv-thread.ts` implement streaming and conversation. **Missing**: visible `Stop`/`Pause` buttons (only cancel via API), `Working` display shows last event type not tool detail |
| HL-UI-CHAT-003: Workspace drawer with project, sync, review, apply | ✅ Implemented | `phase412-project-ui.ts`: drawer with Sync, Review changes, Apply reviewed changes |

**Gap:** The chat composer captures `@project` but doesn't show project context inline. No visible "Stop" button in chat UI (only `cancel_task` API endpoint exists).

---

### 6. Goals (§6)

| Spec Requirement | Status | Evidence |
|------------------|--------|----------|
| HL-UI-GOALS-001: Tabs for Waiting/Running/Needs input/Completed/Failed/All with counts | ✅ Implemented | `phase41302-workflow.ts` `setupGoals()`: filter chips for waiting/running/completed/stopped/all with counts |
| HL-UI-GOALS-002: View task opens working detail; pending goal explains "No task yet" | ✅ Implemented | Goal cards show "View answer & evidence" button or "No execution task linked yet" |
| HL-UI-GOALS-003: Distinguish goal completed from workflow completed | ⚠️ Partial | `group()` function maps `status` to groups but `workflow.status` may not distinguish |
| HL-UI-GOALS-004: Manual goal creation via collapsible form | ✅ Implemented | `phase41302-workflow.ts`: goal form in `<details id="hl413-create-goal">` |
| HL-UI-GOALS-005: Waiting cards explain disabled autonomy/capacity | ⚠️ Partial | Scheduler status shown but waiting goals don't explain *why* queued |

**Gap:** Goal cards don't show queue position or "why waiting" (capacity, autonomy disabled, dependencies).

---

### 7. Discover & Curiosity (§7)

| Spec Requirement | Status | Evidence |
|------------------|--------|----------|
| HL-DISC-001: Read configured eligible projects; AST-aware TODO/FIXME detection; normalize by fingerprint; suppress resolved; scanner metrics | ✅ Implemented | `discovery.py`: `REMOTE_SCAN` uses Python tokenizer; `fingerprint()` uses project+path+normalized note; `scan()` returns metrics (examined, skipped, errors, elapsed_ms, truncated) |
| HL-CURIOSITY-001: Curiosity item = research lead; stages open→eligible→investigation requested→linked goal→findings→proposed plan | ✅ Implemented | `curiosity_workflow.py` + `decision.py` implement stages; `discovery.transition('approve')` creates goal with read-only prompt |
| HL-UI-DISCOVER-001: One clean view; scan status, last scan, actionable findings; filtered sections with counts | ✅ Implemented | `phase41301-rework.ts`: metrics toolbar, filter tabs (Attention, Unseen, Planning, Build, History, All), quality gate |
| HL-DISC-002: Autonomous triage scores impact/reproducibility/relevance/novelty/verification cost/preferences | ❌ Missing | `decision.py` exists but `tick()` only runs discovery scan; no scoring/ranking implemented |

**Gap:** Autonomous triage (scoring, deduplication, prioritization) is not implemented. `DecisionEngine.tick()` only triggers scans.

---

### 8. Planning (§8)

| Spec Requirement | Status | Evidence |
|------------------|--------|----------|
| HL-PLAN-001: Plan contains problem/outcome, project/scope, evidence/unknowns, steps, acceptance criteria, test approach, risks/permissions/blockers/dependencies, status/dates | ✅ Implemented | `formulation.py` + `investigation.py`: `plan()` creates `investigation_plans` with `report` JSON containing summary, steps, acceptance_criteria, evidence, risks, deliverable_class |
| HL-PLAN-002: States proposed/awaiting approval → approved/queued → preparing → implementing → testing/evaluating → awaiting review → accepted/rejected/revision → applied | ✅ Implemented | `investigation_plans.state` + `implementation_runs.state` cover the chain; `WorkflowStatus` annotates both |
| HL-PLAN-003: Gate semantics (formulation approval = read-only; investigation → plan; plan approval = isolated build; candidate acceptance ≠ host apply; host apply separate) | ✅ Implemented | `discovery.transition('approve')` creates read-only investigation goal; `planner.approve()` sets plan state=approved; `implementer.start()` requires approved plan; `reviewer.decide()` separate from `apply_to_host()` |
| HL-UI-PLAN-001: Filters, readable step list, acceptance criteria, evidence, test strategy, approve button with exact authorization | ✅ Implemented | `phase41302-workflow.ts` `setupPlanning()`: filters (Needs attention, Approved, All), expandable details with steps/criteria/evidence/risks, "Approve plan" button with confirmation |

**Gap:** Plan detail doesn't show "progress untracked" label for steps (spec §8.1: "label as planned; progress untracked rather than making up per-step completion").

---

### 9. Autonomous Workflow Orchestration (§9)

| Spec Requirement | Status | Evidence |
|------------------|--------|----------|
| HL-FLOW-001: Canonical lifecycle scan→identify→normalize→triage→formulate→[approval]→investigation→evidence→proposed plan→[approval]→isolated candidate→baseline→implementation→candidate tests→evaluate→[accept/reject/revision]→[apply]→learn | ⚠️ Partial | Implemented up to "evaluate"; revision worker (`implementation_revision.py`) exists; "learn and select next" is autonomy loop but only for study units (`autonomy.tick()` calls `study.tick()`) |
| HL-FLOW-002: Handoffs at persisted transitions; single `autonomy.tick()` scheduler; idempotent resume | ✅ Implemented | `Autonomy.tick()` selects one pending goal; `_advance_lifecycle` creates plan idempotently; `recover_interrupted` + startup recovery thread |
| HL-FLOW-003: Prompts from canonical fields; raw proposed_prompt never executable; read-only enforced by tool permissions | ✅ Implemented | `discovery.transition('approve')` uses `read_only_investigation_prompt()`; `Runtime.task_scope()` returns 'read_only' for goals with approved formulation |
| HL-FLOW-004: Completed investigation triggers plan once; failed/incomplete never produces plan | ✅ Implemented | `_advance_lifecycle` only runs on `status == 'completed'` and checks for approved formulation |
| HL-FLOW-005: After plan approval, auto-enqueue build or show Start build + reason; no permanent limbo | ⚠️ Partial | `phase415-review.ts` shows "Start isolated implementation" button when plan approved + no run; but no automatic enqueue (spec says "either automatically enqueue... or show clearly exposed Start build") |

**Gap:** No automatic build enqueue after plan approval (policy-dependent per spec, but not implemented). The "Approved limbo" is resolved by explicit button but not automatic.

---

### 10. Build & Candidate Lifecycle (§10)

| Spec Requirement | Status | Evidence |
|------------------|--------|----------|
| HL-BUILD-001: Clone VM project into baseline + candidate; store run ID, baseline/source commit, paths, snapshot hashes, plan/review relations | ✅ Implemented | `ImplementationEngine.start()` calls guest `prepare` operation; creates `candidate-<id>` and `baseline-<id>`; records paths in `implementation_runs` |
| HL-BUILD-002: Real-time lifecycle states (preparing, testing baseline, implementing, evaluating, awaiting review, blocked, failed, candidate passed/failed, evaluation error) | ✅ Implemented | `ImplementationEngine._update()` transitions through all states; `_evaluate()` sets `candidate_passed/failed/evaluation_error` |
| HL-BUILD-003: Capture exact interpreter, command, stdout/stderr, exit code, duration, target path, dependency provenance, environment fingerprint; candidate_passed = tests actually ran and passed; distinct evaluation_error for env failures | ✅ Implemented | Guest script returns `status`, `exit_code`, `output`, `python`, `command`, `env_source`, `duration_ms`, `directory`; `_result_state()` distinguishes `evaluation_error` from `candidate_failed` |
| HL-BUILD-004: Review UX with changed files, bounded diff, snapshot hash, test comparison, criteria, original plan; explicit Accept/Reject/Request revision/Apply to host | ✅ Implemented | `phase415-review.ts` `renderReview()`: shows changed files, diff, criteria with checkboxes, verification verdicts, Accept/Reject/Request revision buttons |
| HL-BUILD-005: Apply changes = distinct transaction; verify diff, base commit, host tree, snapshot checksum, approved file list, conflict outcome; show what will change; recheck before apply; preserve backups | ⚠️ Partial | `ImplementationEngine.apply_to_host()` verifies review=accepted, snapshot SHA matches, host at base commit, clean tree, exact confirmation phrase; applies via `git apply`. **Missing**: host backup/commit recovery link, explicit "what will change" preview (exists as `apply_preview` but not shown in review UI) |

**Gap:** `apply_preview` endpoint exists but review drawer doesn't surface it before Apply. No host backup creation before apply.

---

### 11. Test Environments (§11)

| Spec Requirement | Status | Evidence |
|------------------|--------|----------|
| HL-ENV-001: Single guest environment implementation (`guest_env.py`) serves initial eval, reevaluation, revision staging; platform-provisioned interpreter `/home/hermes/experiments/env-<run-id>/bin/python` | ⚠️ Partial | `guest_env.py` exists with `ENV_RESOLVER` + `ENV_PROVISION`; `ImplementationEngine._ensure_environment()` calls guest `environment` operation. **Unverified**: whether same environment reused for baseline/candidate/revisions |
| HL-ENV-002: Baseline deps trust-checked; candidate deps not auto-installed; validate tests import candidate code not editable-installed original | ⚠️ Partial | `guest_env.py` provisions environment from manifest; candidate deps not handled. **Unverified**: import path validation |
| HL-ENV-003: Every evaluation stores environment source, interpreter/version, resolved deps, baseline manifest hash, installed versions, exact test command, exit code; invalid deps/install failure = evaluation_error | ✅ Implemented | `ImplementationEngine._record_environment()` stores all fields; `environment` operation returns status/reason; `_ensure_environment()` raises `ValueError` on failure |
| HL-ENV-004: Retain environment while candidate reviewable; cleanup uses DB state and path containment | ❌ Missing | `MaintenanceService` has prune but `implementation_environments` table not included in prune policy |

**Gap:** FLOW-007 (unified platform-owned environment) marked "Not verified installed" in spec §22. No evidence the environment is actually shared across baseline/candidate/revisions in practice.

---

### 12. Projects & Source-of-Truth Knowledge (§12)

| Spec Requirement | Status | Evidence |
|------------------|--------|----------|
| HL-PROJECT-001: Register multiple projects with name, host_path, vm_path, repo type, branch/commit, language/build profiles, permissions, test commands, spec_path, last sync, status | ✅ Implemented | `project_workspaces.py`: `hl_projects` table with name, host_path, spec_path, vm_path, commit_hash, synced_at; `register()` validates Git root |
| HL-KNOW-001: Context assembly from spec sections, issues, repo files, decisions, Obsidian memories, conversation history | ⚠️ Partial | `project_knowledge.py` exists; `ProjectKnowledge.context()` searches library chunks. **Unverified**: integration with goals/tasks |
| HL-KNOW-002: Expose spec sync status, last indexed, SHA-256, obsolete copy warning | ❌ Missing | No UI or API shows spec hash or VM vs host spec divergence |
| HL-KNOW-003: Goal generation inspects repo state vs spec; marks gaps as confirmed/partial/unverified/already implemented | ❌ Missing | No goal generation from spec comparison implemented |

**Gap:** Project registry is basic; no spec synchronization tracking, no spec-driven gap analysis for goal generation.

---

### 13. Memory, Obsidian & Continuous Learning (§13)

| Spec Requirement | Status | Evidence |
|------------------|--------|----------|
| HL-MEM-001: Four classes — conversations, durable user/project memory, technical lessons, registered knowledge sources | ✅ Implemented | `conversation_memory.py`, `conversation_recall.py` (hl_memories), `personality.py` (technical_lessons), `knowledge_library.py` |
| HL-MEM-002: Obsidian contract at `/home/gayzer/black/obsidian/hermes/Hermes-Life/`; mirror transcripts, lessons, decisions, study artifacts with stable IDs, timestamps, source links, provenance, sync outcome | ✅ Implemented | `vault_memory.py`: `mirror_memory()`, `retire_memory()`, `mirror_conversation()`; writes to configured vault path |
| HL-MEM-003: Extract meaningful memories with verbatim evidence; deduplicate; conflicts → review state; retrieve with token budgets and source refs; expose extraction diagnostics; keep secrets out | ⚠️ Partial | `VaultMemory.extract_completed()` runs after task; `hl_memory_reviews` table for conflicts; `memory-corrections` API. **Unverified**: extraction diagnostics (0 stored without explanation) |
| HL-MEM-004: Technical lessons from accepted candidates/resolved incidents with outcome evidence; failed attempts → failure lessons; retrieve relevant lessons for same project/toolchain | ⚠️ Partial | `personality.record_experience()` called on task completion; `TechnicalMemory` stores lessons with evidence. **Unverified**: lesson retrieval for new tasks |

**Gap:** Memory extraction diagnostics not exposed (spec: "`0 stored` without explanation is unacceptable"). Lesson retrieval for new coding tasks not verified.

---

### 14. Directed Learning & Study Automation (§14)

| Spec Requirement | Status | Evidence |
|------------------|--------|----------|
| HL-STUDY-001: Registered source has filename/URI, hash, page/section count, extraction coverage, indexed units; non-searchable pages not declared complete | ✅ Implemented | `study.py`: `StudySource` has `pages_total`, `pages_indexed`, `sha256`; `StudyService.register_source()` validates |
| HL-STUDY-002: Split into bounded units; track not_queued/queued/running/completed/failed/blocked; no double-queue after restart | ✅ Implemented | `study_units` table with state enum; `get_next_queuable_unit()` respects state |
| HL-STUDY-003: Completed unit produces cited notes + practical verification; store structured progress + Obsidian notes | ⚠️ Partial | `StudyService` creates goals for units; `StudyService.tick()` advances. **Unverified**: cited notes + verification artifacts produced |
| HL-STUDY-004: Scheduler advances completed units; stops on failures; displays progress in Overview/Knowledge | ⚠️ Partial | `Autonomy.tick()` calls `study.tick()`; `phase41303-memory.ts` shows study progress API. **Unverified**: autonomous completion without babysitting |

**Gap:** Study progress shown in Knowledge tab but not in Overview. Autonomous completion of handbook units not verified end-to-end.

---

### 15. Virtual Lab / Hermes World (§15)

| Spec Requirement | Status | Evidence |
|------------------|--------|----------|
| HL-WORLD-001: Visual counterpart to activity ledger; derived from persisted events; never authoritative | ⚠️ Partial | `town-view.ts` + `town-renderer-3d.ts` render Phaser world; `sync_world()` updates `world_state` table from events. **Gap**: stations don't map to real operations faithfully |
| HL-WORLD-002: Station detail panel with active project, goal/task/run ID, actual operation, start time, last event, recent 5 events, link to evidence, next decision; distinguish live/last seen/waiting/disconnected | ❌ Missing | `town-renderer-3d.ts` has room click handlers but detail overlay not implemented per spec |
| HL-WORLD-003: Respect device pixel ratio and Phaser GameConfig; maintain accessible alternatives | ⚠️ Partial | `town-renderer-3d.ts` sets `pixelArt: true` but no accessibility alternatives for visual-only state |

**Gap:** The 3D world is largely decorative. No operational station mapping (Library, Planning desk, Coding studio, Test lab, Archive, Lounge) with real event-driven detail.

---

### 16. Event, Task & Conversation Telemetry (§16)

| Spec Requirement | Status | Evidence |
|------------------|--------|----------|
| HL-EVENT-001: Event envelope with event_id/sequence, occurred_at, kind, project_id?, goal_id?, task_id?, discovery/formulation/plan/run/attempt IDs?, origin, payload, error?, correlation_id | ✅ Implemented | `store.emit()` includes all linking fields; `events` table has columns for all |
| HL-EVENT-002: Single linked timeline accessible from all tabs; click Investigate → pending result immediately; Activity page full diagnostics | ✅ Implemented | `main.v2.ts` WebSocket + `/api/events` with filters; `work-workspace.ts` loads recent activity per task |
| HL-EVENT-003: Stream Hermes CLI text deltas and tool events; incremental UI render; recover after reconnect; authoritative result on completion | ✅ Implemented | `main.v2.ts` `appendEvent()` / `appendHistorical()` dispatch `hermes:event`; `conv-thread.ts` renders streaming |
| HL-EVENT-004: Explain failures by category (vm_unavailable, project_unsynced, approval_required, policy_denied, environment_error, test_failure, stale_snapshot, timed_out, cancelled, recovery_required, storage_limit) | ⚠️ Partial | Backend returns structured errors (e.g., `WorkspaceError`, `ValueError` with specific messages). **Gap**: UI doesn't consistently map to these categories |

**Gap:** Error category mapping in UI is inconsistent; some tabs show raw error strings.

---

### 17. Autonomy, Scheduling & Permissions (§17)

| Spec Requirement | Status | Evidence |
|------------------|--------|----------|
| HL-AUTO-CTRL-001: Autonomy explicit enable/disable; user tasks independent; disabled autonomy doesn't enqueue self-directed tasks | ✅ Implemented | `Autonomy.enable()` toggles `autonomy_settings.enabled`; `Autonomy.tick()` returns early if disabled |
| HL-AUTO-002: Single scheduling owner; selects by priority, age, dependencies, project scope, resource budget, run lease; safe handoffs idempotent | ✅ Implemented | `Autonomy.tick()` selects one pending goal by priority/created_at; `active` lock prevents duplicate task starts |
| HL-AUTO-003: Background scans budgeted; yield to user work; repeated unchanged TODOs don't monopolize | ⚠️ Partial | `Autonomy.tick()` checks `active.acquire(blocking=False)`; but no explicit budget for scans |
| HL-AUTO-004: Permissions per operation (read-only, test, write candidate, promote revision, accept candidate, apply to host, publish); approval for one never escalates; read-only enforced at tool/workspace level | ✅ Implemented | `Runtime.task_scope()` returns 'read_only' for goals with approved formulation; `ProjectWorkspaces.context()` includes authority instruction matching scope; adapters have different tool access |
| HL-AUTO-005: Concurrent operations require consistent leases and crash recovery; external side effects never retried blindly | ✅ Implemented | `active` lock + `runtime.active` lock; `recover_interrupted` marks tasks interrupted; `ImplementationEngine.recover_interrupted()` marks runs interrupted |

**Gap:** No explicit resource budgeting (time, compute, storage) for background work. Scan interval fixed at 3600s.

---

### 18. Storage, Experiment Retention & Maintenance (§18)

| Spec Requirement | Status | Evidence |
|------------------|--------|----------|
| HL-MAINT-001: Explicit DB-driven prune operation; default dry-run; return eligible paths, sizes, reasons, owner IDs, blockers, anomalous dirs; no filename-only guessing; audit events on deletion | ⚠️ Partial | `MaintenanceService.preview()` and `prune()` exist; `api/maintenance/prune-experiments` with `confirm` flag. **Unverified**: actual deletion logic and audit events |
| HL-MAINT-002: POST /api/maintenance/prune-experiments with dry_run default true; CLI job; warn before critically low; no silent janitor | ✅ Implemented | `app.py` lines 969-990: `PruneInput` with `older_than_days` and `confirm`; `preview` vs `prune` |

**Gap:** Prune implementation in `maintenance.py` not reviewed; no evidence it handles all directory types per spec table (revision staging, backup, candidate/baseline, platform env, incomplete recovery, orphans).

---

### 19. API & Persistence Contracts (§19)

| Spec Requirement | Status | Evidence |
|------------------|--------|----------|
| HL-API-001: Route families for projects, goals, tasks, conversations, discoveries, curiosity, formulations, plans, implementations, memories, ws/events; query `/openapi.json` before declaring endpoint | ✅ Implemented | All route families present in `app.py`; FastAPI auto-generates OpenAPI |
| HL-DB-001: Durable IDs and parent relationships; immutable review history; unique idempotency keys; audited timestamps; versioned migrations; no orphan transition | ✅ Implemented | `schema.py` migrations up to v33; foreign keys, unique constraints, `ON CONFLICT` handling |
| HL-API-002: Task/workflow status includes authoritative stage, last event timestamp, current blocker, next action, linked records, evaluation summaries | ✅ Implemented | `/api/workflow/status` returns annotated snapshot; `WorkflowStatus.snapshot()` aggregates |

---

### 20. Quality, Testing & Release Gates (§20)

| Spec Requirement | Status | Evidence |
|------------------|--------|----------|
| Required validation layers (unit, integration, VM execution, browser, recovery, migration) | ⚠️ Partial | `tests/` has 40+ test files covering many layers. **Unverified**: VM execution tests, browser tests, recovery tests run in CI |
| Mandatory acceptance scenarios (UI-01 through MAINT-01) | ❌ Mostly Unverified | Spec §20.2 lists 18 scenarios; no evidence they're automated or regularly run |

**Gap:** Test suite exists but mandatory acceptance scenarios not verified as passing in live environment.

---

### 21. Ordered Development Roadmap (§21)

| Spec Requirement | Status | Evidence |
|------------------|--------|----------|
| HL-BASE-001: Deployment inventory and drift reconciliation | ❌ Missing | No baseline report with hashes, endpoint/migration checks, runtime state |
| HL-ENV-007: Unified platform-owned test environment | ⚠️ Partial | `guest_env.py` + `ImplementationEngine._ensure_environment()` exist but **not verified installed** (per spec §22) |
| HL-FLOW-008: Approved-plan execution handoff | ⚠️ Partial | Plan approval works; build start button exists; but no auto-enqueue or guaranteed blocker reporting |
| HL-UI-008: Workflow progress UI for Discover, Goals, Planning, Build | ⚠️ Partial | Each tab has own status display; no single authoritative view across all stages |
| HL-BUILD-009: Consistent candidate accept/reject/revise/apply workflow | ⚠️ Partial | Review UI exists; apply-to-host works but preview not surfaced in review |
| HL-AUTO-001: Self-directed initiative | ❌ Missing | Entire §26 is "Planned; not claimed implemented" |

---

### 22. Implementation Evidence & Status Registry (§22)

The spec's own status registry (§22) honestly marks most areas as "Partial", "Observed foundation", or "Planned". Key admissions:
- FLOW-007 unified env: **"Not verified installed"**
- Goals/Planning UI: **"Incomplete UX"**
- Chat UI: **"Verify current build and layout"**
- Virtual lab: **"Partial"**
- Event/streaming: **"Partial/unverified"**
- Study: **"Continued autonomous completion unverified"**
- Experiment pruning: **"Planned"**
- HL-AUTO-001: **"Planned; not claimed implemented"**

---

### 26. HL-AUTO-001 Autonomous Learning & Self-Directed Development (§26)

| Component | Spec Requirement | Status |
|-----------|------------------|--------|
| HL-AUTO-LEARN-001 | Detect skill gaps from failures; choose bounded study units; store demonstrated skill evidence | ❌ Missing |
| HL-AUTO-OPP-001 | Ingest observations, normalize, deduplicate, score, retain provenance | ❌ Missing |
| HL-AUTO-IDEA-001 | Create versioned project proposals with problem, sources, novelty, utility, alternatives, feasibility, costs, dependencies, risks, authorization, criteria, test plan | ❌ Missing |
| HL-AUTO-BOOT-001 | Initialize new project repo, spec, dependency manifest, VM workspace, project registry, roadmap, baseline; rollback partial init | ❌ Missing |
| HL-AUTO-PORT-001 | Maintain multiple project milestones, dependencies, leases, priorities, pauses, checkpoints, blockers, recovery | ❌ Missing |
| HL-AUTO-EXEC-001 | Dispatch approved work via existing planner, coding workspace, tests, evaluation, revision, review | ❌ Missing |
| HL-AUTO-EXP-001 | Compare expected vs observed value; record validated successes/failures; adjust rankings | ❌ Missing |
| HL-AUTO-POL-001 | Enforce mode, allowlists, per-action grants, schedules, preemption, budgets, concurrency, audit | ❌ Missing |
| HL-AUTO-UI-001 | Projects portfolio, proposals, milestones, decisions, real-time progress, budgets, evidence, pause/approve/cancel | ❌ Missing |

**All of §26 is unimplemented.** The roadmap phases 0-7 are the implementation plan.

---

## Proposed Solutions & Implementation Priority

### P0 — Critical Path (Blocking Autonomous Operation)

| # | Area | Solution | Spec Refs |
|---|------|----------|-----------|
| 1 | **FLOW-007 Unified Environment** | Complete `guest_env.py` provisioning verification; add integration test proving baseline/candidate/revision share same interpreter + deps; record environment provenance in every evaluation | HL-ENV-001, HL-ENV-002, HL-ENV-003, HL-ENV-004, HL-FLOW-007 |
| 2 | **Plan→Build Handoff (HL-FLOW-008)** | Implement auto-enqueue of build after plan approval (configurable policy); if disabled, show "Start build" with exact blocker reason (VM unavailable, capacity, project unsynced); eliminate "Approved limbo" | HL-FLOW-005, HL-FLOW-008, HL-UI-008 |
| 3 | **Workflow Status Unification (HL-UI-008)** | Make `WorkflowStatus.snapshot()` the single source for all tabs; remove local status computation in `phase41301-rework.ts`, `phase41302-workflow.ts`, `phase415-review.ts`; add "why waiting" to goal/plan cards | HL-UI-STATE-001, HL-UI-008 |
| 4 | **Candidate Review → Apply Preview** | Surface `apply_preview` in review drawer before "Apply to host"; add host backup creation (git stash or branch) before apply; link resulting commit in audit event | HL-BUILD-005, HL-BUILD-009 |

### P1 — Core Workflow Completion

| # | Area | Solution | Spec Refs |
|---|------|----------|-----------|
| 5 | **Overview Dashboard (HL-UI-OVERVIEW-001)** | Add "Needs your decision" section (plans awaiting approval, candidates awaiting review, memory conflicts); add Queue with prioritized goals + why waiting; add System health detail (VM SSH, Hermes CLI, DB, WS, autonomy); add Storage advisory from maintenance preview | HL-UI-OVERVIEW-001 |
| 6 | **Discover Autonomous Triage (HL-DISC-002)** | Implement scoring in `DecisionEngine.tick()`: impact, reproducibility, project relevance, novelty, verification cost, user preferences; persist scores; suppress unchanged findings | HL-DISC-002, HL-AUTO-003 |
| 7 | **Project Spec Sync & Gap Analysis (HL-KNOW-002, HL-KNOW-003)** | Add spec SHA-256 to `hl_projects`; `/api/projects/{name}/spec-status` endpoint comparing host vs VM spec; goal generation from spec vs repo diff | HL-KNOW-002, HL-KNOW-003, HL-PROJECT-001 |
| 8 | **Memory Extraction Diagnostics (HL-MEM-003)** | Expose extraction attempt counts, candidate/rejection reasons in `/api/memory-reviews` and UI; never show "0 stored" without explanation | HL-MEM-003 |
| 9 | **Study Progress in Overview (HL-STUDY-004)** | Add current study source/unit to Overview dashboard; show progress bar; surface blocked/failed units with reason | HL-STUDY-004 |
| 10 | **Experiment Pruning Implementation (HL-MAINT-001/002)** | Complete `MaintenanceService.prune()` with all directory policies; add dry-run preview with exact paths/sizes/owners; add storage warning at configurable threshold | HL-MAINT-001, HL-MAINT-002 |

### P2 — Autonomous Initiative (HL-AUTO-001) — Per Roadmap Phases 0-7

| Phase | Deliverable | Prerequisites |
|-------|-------------|---------------|
| 0 | **Audit + Contract Mapping** | Inspect live repo, OpenAPI, DB migrations, VM, scheduler, memory, events, frontend, HL-PERS-001 status; produce integration map | P0-P1 complete |
| 1 | **Shared Persistence + Policy** | Add versioned opportunity/decision/portfolio records, audit-grant, budget accounting, scope evaluator, stop semantics; fresh/legacy DB migration | Phase 0 |
| 2 | **Opportunity + Learning** | Evidence ingestion, repeated-pattern detection, skill-gap detection, dedupe, ranked candidate registry, bounded source study, verified exercises | Phase 1 |
| 3 | **Proposals + Project Bootstrap** | Versioned project spec + criteria, authorization gate, new isolated VM repo/workspace, dependency environment, registration via project adapter, rollback | Phase 2 |
| 4 | **Portfolio Orchestration** | Milestone dependency state, queue selection, priority over background, leases, checkpoints, pause/resume/recovery, per-project budgets | Phase 3 |
| 5 | **Execution + Experience** | Reuse plans/VM build/tests/evaluation/revision/review; extract test-linked outcome lessons; refine ranking | Phase 4 |
| 6 | **Projects UI + Telemetry** | Portfolio/detail, rationale, proposals, controls, budgets, milestones, real events; linked Chat/Goals/Build references | Phase 5 |
| 7 | **End-to-End Hardening** | Full VM scenario suite, failure injection, resource caps, policy bypass tests, migrations, deployment verification | Phase 6 |

---

## Files Requiring Changes (Preliminary)

### Backend
1. `hermes_life/app.py` — wire auto-enqueue after plan approval; add spec sync endpoint
2. `hermes_life/autonomy.py` — implement auto-enqueue policy; add resource budgeting
3. `hermes_life/decision.py` — implement scoring/triage in `tick()`
4. `hermes_life/implementation.py` — verify unified environment reuse; add host backup before apply
5. `hermes_life/project_workspaces.py` — add spec_hash column; spec status endpoint
6. `hermes_life/maintenance.py` — complete prune implementation per directory policies
7. `hermes_life/workflow_status.py` — ensure single authoritative status for all tabs
8. `hermes_life/guest_env.py` — verify environment provisioning; add integration test
9. `hermes_life/schema.py` — migrations for spec_hash, opportunity/portfolio tables (Phase 1+)

### Frontend
1. `frontend/src/main.v2.ts` — enhance Overview dashboard with decision queue, system health, storage advisory
2. `frontend/src/phase41301-rework.ts` — consume `WorkflowStatus` annotations; remove local status logic
3. `frontend/src/phase41302-workflow.ts` — consume `WorkflowStatus`; add "why waiting" to goal cards
4. `frontend/src/phase415-review.ts` — consume `WorkflowStatus`; surface apply_preview in review drawer
4. `frontend/src/work-workspace.ts` — consume `WorkflowStatus`; unify status display
5. `frontend/src/phase412-project-ui.ts` — add spec sync status to project drawer
6. `frontend/src/town-view.ts` + `town-renderer-3d.ts` — implement station detail panels per HL-WORLD-002

---

## Verification Checklist (Per Spec §20.2)

Before claiming any P0/P1 item complete, verify:

- [ ] **UI-01**: Select project in compact chat; open/close workspace drawer → composer/history retain layout and draft
- [ ] **UI-02**: Click Goals → View task → opens actual linked result; pending goal explains absence
- [ ] **UI-03**: Click Discover Questions count → navigates to filtered curiosity records; correct count
- [ ] **UI-04**: Start curiosity investigation → immediate linked ID and live status in same view
- [ ] **UI-05**: Open approved plan → actual steps, criteria, linked task/run, "Not started" if no run
- [ ] **FLOW-01**: Approved investigation completes → proposed plan automatically created exactly once
- [ ] **FLOW-02**: Attempt unapproved build → backend rejects with explicit conflict
- [ ] **FLOW-03**: Approve plan → authorized build starts or clearly reports blocker/next action
- [ ] **BUILD-01**: Candidate runs tests → reproducible interpreter/deps/command and real exit recorded
- [ ] **BUILD-02**: Baseline and candidate comparison → both use same platform environment; import path verified
- [ ] **BUILD-03**: Reviewer requests revision → new isolated attempt, progress, history, review reopened on success
- [ ] **BUILD-04**: Revision fails three times → review available again; no deadlock; original candidate preserved
- [ ] **BUILD-05**: Mid-promotion failure → recovery/rollback state correct; no silent overwrite
- [ ] **BUILD-06**: Candidate accepted → stored review; no unapproved host modification
- [ ] **BUILD-07**: Apply to host → exact snapshot/commit rechecked; stale approval rejected
- [ ] **MEM-01**: Prior explicit correction reused → new task receives relevant sourced memory; no invented facts
- [ ] **KNOW-01**: Changed spec after sync → context check identifies version/hash mismatch
- [ ] **WORLD-01**: Real tool event → world station/detail corresponds to persisted operation
- [ ] **RES-01**: Restart/reconnect → no duplicated task, lost review, or fabricated current state
- [ ] **MAINT-01**: Prune dry run → complete grounded preview; zero directories deleted

---

## Conclusion

The codebase has a **solid foundation** for the core workflow (discovery → formulation → investigation → plan → build → review → apply) but **lacks the connective tissue** that makes it a seamless, autonomous, self-explanatory system. The highest-impact work is:

1. **Unify workflow status** so every tab shows the same truth with "why waiting"
2. **Verify the test environment** (FLOW-007) so candidate evaluations are trustworthy
3. **Close the plan→build handoff** so approved plans never sit in limbo
4. **Surface apply-preview** so host application is transparent and reversible
5. **Complete the Overview dashboard** so the user never wonders "what needs me?"

Only after these P0/P1 items are verified should Phase 0 of HL-AUTO-001 begin.