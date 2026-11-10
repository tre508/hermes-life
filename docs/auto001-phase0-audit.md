# HL-AUTO-001 Phase 0 — Audit & Contract Map (2026-11-10)

Live inspection of repo (branch main), schema v33→34, existing services. Naming follows the
actual code, not the proposal DOCX.

## Existing (reuse — do not duplicate)

| Capability | Module | Notes |
|---|---|---|
| Single scheduler | `autonomy.py` `Autonomy.tick()` | pending goals, priority DESC / created_at ASC, one active lease |
| Decision loop (scans → curiosity) | `decision.py` `DecisionEngine.tick()` | interval-gated, yields to active tasks |
| Discovery/curiosity | `discovery.py`, `curiosity_workflow.py` | fingerprints, Investigate buttons |
| Goal → formulation → plan → run → review → revision | `formulation.py`, `investigation.py`, `implementation.py`, `implementation_review.py`, `implementation_revision.py`, `verification.py` | approval gates enforced server-side |
| VM isolation | `hermes_adapter.py`, `guest_env.py`, `project_workspaces.py` | SSH worker, profile-scoped adapters |
| Project registry | `hl_projects` (v22) + `project_knowledge.py` | |
| Memory / experience | `personality.py`, `conversation_recall.py`, `technical_memory.py`, `vault_memory.py` (Obsidian) | HL-PERS-001 complete; persona_experiences keyed by task_id |
| Events | `store.emit` → `events` table, `/ws/events` | |
| Study | `study.py` | units, HL-STUDY-004 scheduler hook |

## Phase 1 added (schema v34, `autonomy_policy.py`, `opportunities.py`)

- `autonomy_policy_settings` (mode/allowlist/policy_version), `autonomy_opportunities`
  (unique dedupe_key, evidence_refs), `project_proposals` (versioned, UNIQUE
  opportunity_id+version), `autonomy_grants` (audit ledger: granted/denied/expired/revoked),
  `budget_ledger` (per-project/per-global caps, unknown resource = not enforced),
  `autonomy_decisions` (action + scores + rationale; no_action is valid).
- API: `/api/autonomy/config` GET/PATCH, `/api/opportunities` (+`/propose`,`/dismiss`),
  `/api/proposals` (+`/{id}/decision`), `/api/autonomy/decisions`, `/api/approvals`
  (+POST grant, +`/{id}/revoke`), `/api/autonomy/budgets`.
- Policy: mode ladder observe/suggest/guided/independent; grant-only actions
  (host_apply, network_download, package_install, publish, external_message, spend,
  secrets_access); modify_core forbidden outright; deny-without-mutation audited.

## Phase 2 added (schema v35, `initiative.py`)

- `initiative_settings` (last_scan/last_error/weights), `learning_objectives`
  (unique dedupe_key, gap_source), `skill_evidence` (UNIQUE objective_id+task_id).
- `InitiativeEngine.detect()`: one bounded pass over persisted evidence — failed tasks
  → `task_outcome` opportunities + `failed_task` skill gaps; repeated completed goals →
  `repeated_workflow`; memory corrections → `user_correction`. Reinforcement requires
  genuinely NEW evidence references; unchanged sources yield `created=0, updated=0`.
- Skill verification: 'passed' evidence is accepted only from an existing COMPLETED task
  (`record_exercise` refuses failed/missing tasks). `skills()` reports only verified.
- Ranking: configurable weights (relevance/evidence/novelty), score breakdown exposed.
- API: `POST /api/opportunities/scan`, `GET /api/opportunities/ranked`,
  `GET|POST /api/learning/objectives`, `POST /api/learning/objectives/{id}/exercise`,
  `GET /api/skills`.
- Tests: `tests/test_auto001_phase2_learning.py` (8) — exit gate met.

## Phase 3 added (schema v36, `bootstrap.py`)

- `autonomy_projects` (autonomous project identity; host registration remains a separate
  authorization), `project_bootstraps` (UNIQUE per proposal; steps, spec hash, base commit).
- Gate order in `ProjectBootstrapper.bootstrap`: approved proposal → policy
  `create_project_repo` → workspace allowlist containment → VM `git init` + SPEC.md +
  requirements manifest + initial commit. All denials happen BEFORE the SSH transport is
  invoked (fail-closed, zero writes).
- Failure classification: pre-existing target → `failed` (nothing modified, never deleted);
  mid-flight with cleanable fresh dir → `rolled_back` and retryable; ambiguous/unknown →
  `recovery_required` (further mutation blocked until reconciled); `failed`/`rolled_back`
  records are superseded on retry so a proposal is never deadlocked.
- API: `POST /api/proposals/{id}/bootstrap` (403 policy / 409 classified), `GET /api/bootstraps`,
  `GET /api/autonomy/projects`.
- Tests: `tests/test_auto001_phase3_bootstrap.py` (8) — exit gate met. Policy fix:
  `create_project_repo` mode-allowance no longer misreads a new project's name as a
  registry reference; path scope is enforced by the allowlist gate.

## Phase 4 added (schema v37, `portfolio.py`)

- `project_milestones`: durable ordered work items per autonomy project, with dependency
  ids, acceptance criteria, estimated seconds, checkpoint, blocker; goal_id is the LEASE
  (one live goal per milestone, UNIQUE by construction in `select_next`).
- Selection runs INSIDE `Autonomy.tick` (no second scheduler): when no user/queued goal is
  pending, the portfolio enqueues ONE bounded background action at priority 30 — direct
  user requests always outrank it. Budget caps mark milestones `blocked` with the reason.
- Dependency handling: dependents are created `blocked` ("Waiting on milestone …"),
  unblocked to `ready` when dependencies complete; `select_next` also re-evaluates blocked
  markers so restart cases recover. Goal failure/cancel blocks the milestone with reason.
- Restart reconciliation (`portfolio.reconcile()` at startup): in_progress milestones are
  resolved against the ACTUAL goal state — completed→completed, missing→requeued,
  failed/cancelled→blocked; live goals keep their lease. No duplicate jobs.
- User controls: pause/resume/cancel via `/api/autonomy/projects/{name}/…` — cancel stops
  queued background goals and cancels open milestones; all states durable across restart.
- API: `POST|GET /api/autonomy/projects/{name}/milestones`, `/pause`, `/resume`, `/cancel`.
- Tests: `tests/test_auto001_phase4_portfolio.py` (6) — exit gate met, including the
  full-API two-project drain + restart with goal-count equality (no duplicated jobs).

## Phase 5 added (schema v38, `experience.py`)

- `experience_records`: one scored outcome per (project, milestone, task) — UNIQUE, so
  restarts cannot double-count. Stores expected (acceptance criteria), measured (real task
  state/result/error), classification (success/failure/partial), evidence refs
  (task/goal/milestone IDs) and a lesson — success lessons cite the verifying task;
  failure lessons are explicitly labelled `FAILURE LESSON`, never presented as validated.
- Wired into the portfolio completion hook: every milestone goal that reaches a terminal
  state is scored against the real task row. Milestone `retry` gives bounded revisions
  (attempts tracked in the checkpoint, MAX 3) then requires human review; a still-live
  goal is never retried underneath itself.
- Ranking refinement: outcome classification adjusts the originating opportunity's
  confidence (+0.05 success / −0.05 failure, bounded 0.05–0.95) through the project →
  proposal → opportunity chain — calibration from measured outcomes, auditable via events.
- API: `GET /api/autonomy/experiences` (filter by project), `POST /api/autonomy/milestones/{id}/retry`.
- Tests: `tests/test_auto001_phase5_experience.py` (4) — exit gate met end-to-end: a
  milestone implemented and completed through the real Autonomy.tick → task pipeline,
  scored with fetchable task artifacts, records survive restart without duplicates.

## Phase 6 added (`frontend/src/portfolio-view.ts`, Work ▸ Projects subview)

- New exclusive Work subview `projects` (nav button, `#workview-projects` panel, own
  scroll, empty/loaded/error/status states) following the existing Discover/Goals pattern.
- Portfolio cards from `/api/autonomy/projects` with origin badges and REAL milestone
  progress from `/api/autonomy/projects/{name}/milestones`; project detail shows milestone
  states, blockers, acceptance criteria, and links a leased milestone to its task via the
  standard `hermes:open-task` event (Chat/Goals stay the authoritative task views).
- Controls act on the backend: Pause/Resume/Cancel (cancel needs confirmation),
  bounded milestone `Retry`, proposal Approve/Reject (rejection requires a recorded
  reason) — all against the real endpoints from Phases 1–5.
- Ranked opportunities and recent outcome records rendered from
  `/api/opportunities/ranked` and `/api/autonomy/experiences`; mode shown from
  `/api/autonomy/config`.
- Live refresh on `hermes:event` for project./milestone./experience./opportunity./
  proposal. families only — `autonomy.*` scheduler internals deliberately excluded.
- Pure helpers (`assemblePortfolio`, `projectSummary`, `nextProjectAction`,
  `portfolioEventRelevant`) unit-tested in `frontend/tests/portfolio-view.test.ts` (4);
  `work-layout.test.ts` updated to six panels. Full frontend suite 172/172;
  `npm run build` type-checks clean.

## Phase 7 — live end-to-end verification (2026-11-10, real worker glenn-mem)

Backend deployed to the live installation (schema 33→38, restart verified). Scenarios run
against 127.0.0.1:8766 with the real SSH worker:

- **AUTO-04/08 (denials)**: Observe mode refused `propose_project` (403) and an unbounded
  `create_project_repo` grant (422 after the fix below); zero VM writes.
- **AUTO-01**: live opportunity scan produced 2 evidence-backed opportunities from the
  database's real failed tasks (HTTP 402 credit failures) + 2 skill objectives, provenance
  = task IDs.
- **AUTO-03**: user-approved proposal (policy snapshot recorded) → bounded, expiring grant
  → live bootstrap of `hl-auto-demo` at `/home/glenn/experiments/hl-auto-demo`; verified
  ON THE WORKER: git repo, base commit `42e47d6` matching the record, SPEC.md + manifest.
- **AUTO-05/06**: one read-only milestone executed through the single scheduler and the
  real Hermes adapter; task completed with real streamed `hermes.text` events; worker
  output accurately described the fixture (including the missing pytest module the SPEC
  promises); success experience record with task/goal/milestone evidence.
- **AUTO-07**: backend restart → identical goal count (3), milestone still completed with
  its lease, experience count unchanged — reconcile enqueued nothing.
- **AUTO-10**: `/ws/events?after=0` replayed persisted events over WebSocket.
- **AUTO-11**: existing project registry, learned behavioral profile (3 entries), persona
  experiences (10) and workflow status all intact; new Projects UI bundle served by Vite.
- **Live defect found and fixed**: `create_project_repo` was mode-authorizable and
  grantable without rationale/scope/expiry. Now grant-only with required rationale; the
  stray live grant was revoked with a recorded reason.

**Honest limits**: AUTO-02 (study exercise → verified skill → demo proposal) and AUTO-09
(failed-test revision → ranking change) are covered by the offline fixture suites, not yet
by live study/VM-revision runs. HL-AUTO-001 status: phases 0–6 implemented and verified;
Phase 7 live subset verified as above.

## Deliberate non-goals

- No second scheduler: policy governs authorization only; `Autonomy.tick` stays the
  selection owner (pinned by `tests/test_pers001_policy_separation.py`).
- Personality policy (`personality.py`) is never read by policy/selection code.
