# HERMES LIFE — MASTER PRODUCT, UI & ENGINEERING SPECIFICATION

**Document ID:** HL-SOT-002  
**Version:** 2.0 (consolidated target)  
**Prepared:** 2026-11-04  
**Status:** Normative product specification and development roadmap  
**Repository destination:** `/home/gayzer/Apps/hermes-life/HERMES_LIFE_MASTER_DEV_SPEC.md`  
**Replaces as planning authority:** `HERMES_LIFE_DEV_SPEC.md` v1.0, once explicitly adopted; retain the old document as historical reference.  
**Important:** Describing an intended feature below **does not** assert it is deployed or operational. See §22 for verified observations and outstanding verification.

---

## 0. How this document is used

### 0.1 Mission

Hermes Life is a **persistent personal AI coding and task assistant**, controlled from one web application. Its purpose is to let a user describe a goal, select or create a project, observe Hermes investigate and plan, approve changes at appropriate boundaries, have Hermes build and test real code in an isolated VM, review and revise candidates, and retain useful knowledge over time. It also supports noncoding tasks, document study, research, and self-directed improvement **within declared authorization boundaries**.

The virtual world is a readable representation of **real** agent work, not a game running a separate simulated agent. Chat, goals, plans, builds, events, and memories are views into **one persisted system**.

### 0.2 Normative vocabulary

- **MUST / MUST NOT:** required/prohibited for acceptance.
- **SHOULD:** default requirement; exception requires a recorded decision.
- **MAY:** optional enhancement, subordinate to required behavior.
- **Target:** intended end-state, not a deployment claim.
- **Observed:** supported by current conversation logs, code, test, or API output.
- **Unknown/unverified:** do not mark implemented without checking actual repository **and** running system.
- **Goal:** a durable requested outcome; **task:** one actual execution; **plan:** a reviewed proposal; **implementation run:** isolated build/evaluation attempt; **review:** user's disposition of a candidate. These are NOT interchangeable.

### 0.3 Authority, drift prevention, and document maintenance

1. This document defines product intent and UI behavior.
2. Approved Architecture Decision Records (ADRs) describe intentional exceptions or changed requirements.
3. Current repository code and automated tests establish the **implemented** behavior, not product intent.
4. Database records, live API responses, VM execution output, and screenshots establish **operational observations**.
5. Previous ZIPs, AI-generated reports, and earlier chats are historical evidence only. A ZIP being produced is **not** evidence of installation.
6. Never silently rewrite this specification to excuse a defective implementation. Record the gap, then create a narrowly scoped development goal.
7. Every requirement has a durable ID. A completed goal cites its requirement IDs and verifiable evidence. An obsolete issue is changed to `resolved` or `historical`, not left as an active bug.
8. Maintain an implementation status registry (§22) separate from normative requirements. Do not let a model invent completion statuses.

### 0.4 Product principles

- **Conversation first:** all major functionality is accessible conversationally; structured views improve discoverability and review.
- **Explain state:** every action reveals what happened, what is happening, what is waiting, and why.
- **One truth:** no competing schedulers, chat-only task statuses, or synthetic UI progress.
- **Actual work:** activity and completion claims require persisted events/evidence.
- **Progress without babysitting:** safe authorized handoffs proceed automatically; human approvals are explicit and meaningful.
- **Reversible changes:** candidate work stays isolated; durable history and recovery protect user work.
- **Project awareness:** source, specifications, tasks, tools, memories, and outcomes are scoped to a project when applicable.
- **Reproducible outcomes:** store exact commands, environments, commits, evidence and errors.
- **Readable over crowded:** the UI defaults to relevant outcomes; diagnostics are available on demand.

---

## 1. Product outcomes and users

**Primary user:** an individual managing several coding and personal projects on Kubuntu, using Hermes as a persistent coding/task assistant. Additional users and remote/multiuser authentication are out of the initial single-user scope unless explicitly approved.

### 1.1 Primary scenarios

**A. Direct coding:** “Fix the duplicate discovery list in Hermes Life.” User selects project, Hermes retrieves source-of-truth context, inspects the actual code, drafts an evidence-backed plan, obtains authorization for edits, builds an isolated candidate, tests, streams progress, and presents a diff and evidence for acceptance/revision. Applying to the host is a **separate** authorization.

**B. Autonomous coding:** With autonomy enabled and a registered project, Hermes discovers a meaningful opportunity, discards low-quality duplicates, forms a goal, investigates safely, produces a plan, and waits at the plan-approval gate. Approval advances to an isolated build automatically when the project is eligible and resources are available. Candidate review remains explicit.

**C. Conversational assistant:** User sends a question, file/task request, or correction. Hermes responds in the same chat, supports follow-ups, can run authorized tools, and remembers relevant preferences and project facts with provenance.

**D. Directed study:** User registers a PDF/document/repository. Hermes indexes it, studies bounded units, verifies exercises where appropriate, produces cited notes and technical lessons, and advances units until completed or blocked.

**E. Troubleshooting:** User can see an exact task/goal state, error, timestamps, current tool activity, historical transitions, and actionable next step without navigating an opaque event dump.

### 1.2 Explicit non-goals

- No separate fictional AI running inside the virtual world.
- No claim of changing model weights or magically self-training after conversations. “Learning” means durable, evidence-backed retrieval, corrections, and workflow improvements.
- No automatic host merge, publishing, deployment, purchases, or destructive system changes because a candidate passed tests.
- No presentation of model private reasoning as an execution timeline. Show observable tool and event facts instead.
- No promise that a successful LLM response equals a verified successful user outcome.

---

## 2. Deployment, components, and data ownership

### 2.1 Reference deployment (configurable, not hardcoded)

| Component | Role | Observed example |
|---|---|---|
| Kubuntu host | FastAPI, task scheduler, SQLite, UI, secrets, approvals, vault writer | `/home/gayzer/Apps/hermes-life` |
| Backend API | REST + WebSocket | `127.0.0.1:8766` |
| Browser UI | Vite/TypeScript and Phaser world | `127.0.0.1:5173` |
| Hermes isolated VM | Real Hermes CLI, investigations, coding, builds/tests | SSH user `hermes` |
| Database | Authoritative state, links, events, reviews, learning metadata | `~/.local/share/hermes-life/life.db` |
| Obsidian vault | Human-readable knowledge and mirrored history | `/home/gayzer/black/obsidian/hermes/` |
| Project host repository | Authoritative user source code | e.g. `/home/gayzer/Apps/hermes-life` |
| VM source workspace | Synced, non-authoritative development source | e.g. `/home/hermes/workspaces/hermes-life/<commit-prefix>` |
| VM experiment workspaces | Isolated baseline, candidate, revision, and test environments | `/home/hermes/experiments/` |

**Architecture rule HL-ARCH-001:** The host controls scheduling, durable state, approvals, secrets and vault writes. The VM executes untrusted code and tooling. No silent fallback from failed VM execution to host execution.

**HL-ARCH-002:** A single typed domain service provides the authoritative state; screens, virtual world and chat consume it, not their own separately inferred truth.

**HL-ARCH-003:** SQLite transactions own durable workflow transitions. Obsidian mirrors and markdown summaries are not an independent scheduler or source of workflow status.

**HL-ARCH-004:** All durable operations must carry stable IDs, actor/trigger, timestamps, parent links, outcomes, and recorded errors.

### 2.2 Component responsibilities

```text
Browser: World | Chat | Work Queue | Projects | Discover | Planning | Build | Knowledge | Activity
         | REST commands + sequenced event stream
FastAPI: auth/local policy | project registry | task runner | lifecycle engine | approvals
         | evidence/events | evaluations | revision worker | context/memory | maintenance
SQLite: projects, conversations, goals, tasks, discoveries, formulations, plans,
        implementation runs, reviews, revisions, environment metadata, events, memories
Host integrations: Git workspace sync/apply | Obsidian vault | user timers | SSH transport
VM: Hermes CLI | temporary source copies | candidate & baseline | tests | report artifacts
```

### 2.3 Host vs VM files

- The VM cannot naturally access `/home/gayzer/...`; workspace registration and synchronization must resolve that mapping explicitly.
- **Sync** means **host → VM**; **Apply reviewed changes** means **VM candidate → authorized host change**, with separate approval and stale-snapshot validation.
- Display sync direction and source/target prominently. Never label the two operations simply “Sync” if doing so could confuse their effects.
- Sync must warn/refuse when it could overwrite unreviewed VM edits. Preserve patch/workspace snapshots or require a user-confirmed archival path before replacement.
- A host Git tree with uncommitted changes needs an explicit supported policy (refuse with exact files, or create a controlled snapshot); never silently discard local changes.

---

## 3. Global UI design system and information architecture

### 3.1 Screen structure (HL-UI-001)

Desktop layout has **three conceptual regions**: a navigable operational workspace, a persistent activity/world surface, and an expandable assistant chat. The chat must not fight a full project control panel for the same narrow space.

**Global navigation** (labels may be changed deliberately, but semantics must remain):

1. **Overview** — summary of current work and next user action.
2. **Goals** — intended outcomes and actual execution state.
3. **Discover** — findings, curiosity questions, relevance, and investigation requests.
4. **Planning** — investigation findings and **actual structured plans**, approvals and blockers.
5. **Build** — implementation runs, candidate tests, reviews, revisions and application status.
6. **Projects** — registration, permissions, sync, specifications and source status.
7. **Knowledge** — registered documents, study progress, Obsidian memory and memory reviews.
8. **Activity/Evidence** — searchable timeline and linked execution evidence. These may remain separate tabs if they are semantically distinct.
9. **Settings** — autonomy mode, scheduler status, VM connectivity, retention and integrations.

Small screens may use a drawer and stacked views, but all operations remain accessible.

### 3.2 Common page contract (HL-UI-002)

Every tab MUST have:

- Descriptive title and one-line purpose.
- Explicit freshness: **Last data refresh** versus **Last real backend operation**. Never present browser refresh as scan time.
- Clear loading, disconnected, empty, error, and stale states.
- User-filterable state groupings; no mixing completed and queued work without labels.
- At least one clear primary action; destructive actions require confirmation.
- Records with clickable title, summary, actual status, created/updated time, linked identifiers and next available action.
- Human-readable summaries first; raw JSON only in expandable **Technical details**.
- Activity/error feedback **in the same view** as the action; opening Activity must be optional.
- Keyboard reachability, visible focus, contrast, and accessible labels.

### 3.3 Common data freshness (HL-UI-003)

A record card may display: `Updated 14:07`, `Task started 14:03`, `Waiting since 13:58`; timestamps must originate from backend records/events. A separate `Refreshed just now` label may describe the browser fetch. If server time unavailable, say `Last operation unknown` rather than invent it. Stale/connection-lost status must not imply an idle agent.

### 3.4 Consistent visual states (HL-UI-004)

| State family | Label example | Meaning / available action |
|---|---|---|
| Not started | `Queued` / `Waiting for capacity` | Hasn't executed; show queue position/why if known |
| Active | `Investigating`, `Planning`, `Building`, `Testing` | Real operation in progress; show last event and elapsed time |
| User gate | `Awaiting plan approval`, `Awaiting candidate review` | Clear next decision and what it authorizes |
| Blocked | `Blocked: VM unavailable` | Exact blocker and action to recover |
| Failed | `Test execution failed` | Evidence and retry/revision path |
| Completed step | `Investigation complete` | Step finished; larger workflow may not be complete |
| Finished outcome | `Accepted`, `Rejected`, `Applied` | Distinct persisted dispositions |
| Disconnected | `Connection lost; last known state…` | No claim of current execution state |

Never label an approved plan “in progress” until an implementation run actually exists.

### 3.5 Sorting, grouping, search

Default order: active and actionable first, then most recently updated, then history. Filters: state, project, time, priority, origin, and text search where useful. Counts must be clickable or explicitly noninteractive labels; clicking a metric navigates to its filtered underlying records. Counts must use clearly defined query criteria and consistent totals.

---

## 4. Overview dashboard: the user's control center

**HL-UI-OVERVIEW-001** The first screen answers: **What is Hermes doing? What happened recently? What requires me? What is blocked?**

Sections:

- **Active work:** current goal/task, project, stage, most recent real event, duration, direct `Open task` link.
- **Needs your decision:** proposed plans, candidates awaiting review, memory conflicts, blocked permission prompts; every item clickable.
- **Queue:** pending goals, prioritized work and known prerequisites.
- **Recent outcomes:** completed investigations, passed/failed builds, accepted changes, study units; outcome timestamp and evidence.
- **System health:** backend, VM SSH, Hermes CLI availability, autonomy enabled/paused, websocket link, database/vault sync; show meaningful failures.
- **Storage advisory:** experiment storage use and pruning preview, not silent deletions.

No fake work counters or repeated generic “Recording” status. An empty dashboard explicitly explains the preconditions for starting work.

---

## 5. Chat: primary user interaction surface

### 5.1 Layout (HL-UI-CHAT-001)

Chat has a compact header with `Hermes` state, selected project, expandable **Workspace** button, conversation selector, expand/restore and close. Project setup and approval controls **MUST NOT** occupy half the chat permanently. Project name is visible in a single compact row, and its detailed controls open in an on-demand drawer. The review diff opens in a dedicated wide panel, not between the messages and composer.

The message list owns the flexible middle region; the composer remains anchored at the bottom. The panel is resizable and supports a near-fullscreen mode. Chat width, selected project and drawer state persist appropriately. Opening/closing project tools does not reset the draft, response, conversation or review snapshot.

### 5.2 Behavior (HL-UI-CHAT-002)

- Two-way conversation with real Hermes and actual tool-backed tasks.
- Per-message author, time, linked task status, streaming text and tool summaries.
- Inline `Working` display with last actual event (reading file, SSH tool invocation, writing changes, tests), not fabricated thinking text.
- Stream deltas into one live assistant bubble; stop live-follow when user scrolls away, resume when they return to bottom.
- `View task/evidence` navigates to the actual linked record and displays a visible result.
- Edit + rerun retains original history and creates a traceable revision/branch; does not silently duplicate external side effects.
- `Stop` must terminate or safely interrupt an actual operation; `Pause/Resume` only if supported by real process control and valid checkpointing. Never ship inert buttons.
- Chat can select project explicitly. For ambiguous project routing, ask/select rather than silently editing wrong repo.
- Task output, evidence and completion survive refresh/reconnect by replaying persisted events.

### 5.3 Workspace drawer (HL-UI-CHAT-003)

Displays project name, host/VM locations (expand for technical detail), branch/commit, last successful sync, clean/dirty state, **Sync host → VM**, **Review VM changes**, and **Apply approved changes to host**. Review drawer includes exact file diff, snapshot hash, test summary, approval phrase/action and blocking reasons. Review closing retains pending state; a new sync explicitly invalidates stale approvals.

---

## 6. Goals: what Hermes intends vs what it has executed

**HL-UI-GOALS-001:** A goal is a durable outcome request, *not* proof any task was started.

Tabs or filter chips: **Waiting**, **Running**, **Needs input**, **Completed**, **Failed/Stopped**, **All/history**. Display count for each. Every card includes goal title, purpose, project, priority, origin (user, curiosity, discovery, study, formulation), state, created/updated dates, task link, and parent discovery/formulation where applicable.

**HL-UI-GOALS-002:** `View task` must open a working task detail view with final answer, progress timeline, underlying task status and errors; for a pending goal explain `No task yet` rather than an inert button.

**HL-UI-GOALS-003:** Distinguish **goal completed** from **development workflow completed**. An investigation may finish while its plan is awaiting approval or a candidate is still being tested. Show both statuses when linked.

**HL-UI-GOALS-004:** Manual goal creation is available but not permanently dominant; use a collapsible form/drawer. Allow priority, project, success criteria, permission scope and optional deadline. Submission returns a real goal ID and queue state.

**HL-UI-GOALS-005:** If autonomy is disabled or capacity unavailable, waiting cards explain that condition. Do not imply active execution.

---

## 7. Discover and Curiosity: from signal to qualified work

### 7.1 Discovery engine (HL-DISC-001)

Read configured eligible project sources; identify meaningful TODO/FIXME markers and other explicitly supported detectors. For Python use tokenization/AST-aware logic where applicable; distinguish actual code comments from string literals, generated code, tests, template examples and documentation. Other languages need appropriate grammar-aware or conservative detection; avoid universal text regex pretending to parse everything.

Normalize fingerprints by stable project/path/issue identity, *not line number alone*. Line numbers remain evidence. Suppress unchanged known resolved findings and reconcile historic duplicates without destroying linked IDs or prior outcomes. Scanner metrics record examined files, eligible findings, newly stored, suppressed, filtered, errors and true scan time.

### 7.2 Curiosity question model (HL-CURIOSITY-001)

A curiosity item is **a research lead requiring triage**, not a task and not a development plan. It holds question, rationale, discovery link, source evidence, source file/line, confidence/quality, created/updated time, and lifecycle state.

Stages: `open → eligible → investigation requested → linked goal pending/running/completed → findings available → proposed plan`, with `deferred`, `dismissed`, `ineligible/false_positive`, `blocked` branches. Adapt existing schema; do not require exact string values unless adopted in migration.

Buttons: **Investigate** (creates/reuses a safe, linked investigation through existing discovery/formulation flow), **View investigation**, **Defer**, **Dismiss**, **See evidence**. `Open` as a status-only action must be labeled `Reopen`; do not present it as an execution command. Duplicate clicks MUST reuse an existing linked goal and show its state.

### 7.3 Discover UI (HL-UI-DISCOVER-001)

One clean view, not legacy controls stacked over new controls. Top row: scan status, last actual scan, new actionable findings, eligible questions, scanner diagnostics. Filtered record sections: `Actionable`, `New`, `In progress`, `History / filtered`. Counts navigate directly to their sections. Each question/finding card shows its source and next action; malformed code snippets from prior scans are historical/ineligible, not repeated as active actionable questions.

Clicking **Investigate** immediately shows request acknowledgment, linked goal ID, actual queued/running state and **Open task**. If no eligible item, explain why.

### 7.4 Autonomous triage (HL-DISC-002)

Deduplication is not prioritization. Score impact, reproducibility, project relevance, novelty, verification cost and user preferences. No repeated cycle may be counted as progress unless it yields newly actionable evidence, new eligible work, or changed source data. Unregistered projects cannot inherit another project's spec arbitrarily.

---

## 8. Planning: real plans, dependencies, approvals, and progress

### 8.1 A plan is a structured artifact (HL-PLAN-001)

A valid investigation plan MUST contain:

1. **Problem and desired outcome** (human-readable title + summary).
2. **Project and scope** (repo/commit, source paths, linked discovery/formulation/goal/task).
3. **Evidence and unknowns** (source citations and actual inspection vs inference).
4. **Step-by-step implementation** (ordered, individually readable actions).
5. **Acceptance criteria** (specific, testable claims; note which need human confirmation).
6. **Test/evaluation approach** (baseline commands, candidate tests, expected environment/deps).
7. **Risks, permissions, blockers, dependencies**.
8. **Status and dates** (created, approved, started, last event, completed/reviewed where applicable).

A JSON blob is acceptable for storage but never the default UX. `report.steps`, `report.acceptance_criteria`, etc. should render as proper checklists/details. Planned steps are *not* automatically complete just because the model mentioned them. If individual step progress isn't emitted, label as **planned; progress untracked** rather than making up per-step completion.

### 8.2 States and transitions (HL-PLAN-002)

`proposed / awaiting approval → approved / queued → preparing → implementing → testing/evaluating → awaiting review → accepted/rejected/revision requested → applied (separate)`.

Some are plan-level states and some implementation-run/review states; the UI must combine them as **one linked timeline without conflating records**. For example, `Approved — implementation not started` means approval exists but no run record; `Building` requires a real implementation run; `Blocked` includes concrete cause.

### 8.3 Gate semantics (HL-PLAN-003)

- A formulation approval authorizes **read-only investigation only**.
- Successful investigation may automatically generate a proposed plan.
- **Plan approval** authorizes isolated candidate implementation, *not* host application.
- **Candidate acceptance** confirms a review decision, *not* host application or deployment.
- **Host apply approval** separately authorizes applying an exact reviewed Git diff/snapshot.
- The backend MUST reject implementation without an approved plan even if a frontend control is hidden.
- A plan cannot self-approve based on untrusted discovered content.

### 8.4 Plan UI (HL-UI-PLAN-001)

Filters: `Awaiting approval`, `Approved / not started`, `In progress`, `Awaiting review`, `Blocked/failed`, `History`. A plan detail opens a readable step list, acceptance criteria, evidence, test strategy, linked goal/task, implementation run and current reason. Approve button explains exact authorization and creates a durable transition. After approval, the UI either shows a real queued/started implementation or `Not started — [why]` with **Start build** when appropriate.

---

## 9. Autonomous workflow orchestration

### 9.1 Canonical lifecycle (HL-FLOW-001)

```text
scan → identify → normalize/deduplicate → triage → formulate
  → [approval to investigate] → safe read-only investigation → evidence
  → proposed plan → [approval to build]
  → isolated candidate preparation → baseline → implementation → candidate tests
  → evaluate → [accept | reject | request revision]
  → [separate apply approval if desired] → learn and select next eligible work
```

**HL-FLOW-002:** Handoffs occur at persisted transition events, not because the user manually clicks every subsequent API. Existing `autonomy.tick()` controls eligible goal execution. Do not introduce a second competing task scheduler. Resume/reconcile handoffs idempotently on restart.

**HL-FLOW-003:** Discovery/formulation prompts are built from canonical source fields. Raw `proposed_prompt` or untrusted marker text must never be used as executable instructions. Source-derived prompts for investigation must be read-only and scoped to the registered project when available. Prompt text is **not sufficient** to enforce read-only: tool permissions and workspace controls also enforce it.

**HL-FLOW-004:** Completion of a successfully approved investigation triggers a plan **once**. Failed, cancelled or incomplete investigations cannot silently produce implementation plans. A completed planning pass produces an explicit approval state, never starts implementation by itself.

**HL-FLOW-005:** After plan approval, either automatically enqueue the authorized isolated build (if product policy permits and VM/project/environment are ready) or show a clearly exposed **Start build** and exact reason. No permanent Approved limbo. Avoid starting multiple runs for one plan unless versioned revision semantics permit it.

**HL-FLOW-006:** On completion, the UI and scheduler record why it stopped: waiting for capacity, disabled autonomy, missing project, unmet dependency, waiting for user, failed operation, resource limit, or finished. Every block has a recovery action or an explicit permanent terminal explanation.

### 9.2 Workflow record graph

`project_id → discovery_id → curiosity_id? → formulation_id → investigation_goal_id → investigation_task_id → plan_id → implementation_run_id → evaluation_id → review_id → revision_attempt_ids → host_apply_id?`

Many-to-one/optional edges must be defined explicitly by schema; never infer identity from a display title. Existing uniqueness constraints must be preserved or migrated safely. Legacy rows need backfill/linking policy rather than destructive recreation.

### 9.3 Approval and event invariants

- Approval metadata: actor, timestamp, authorized scope, linked snapshot, previous state, resulting state.
- Only eligible source/plan states can transition; invalid transitions return explicit conflict details.
- Duplicate requests are idempotent or clearly report the existing result.
- Crash/restart cannot silently promote a candidate or duplicate an external side effect.
- Success labels require validation evidence. `Accepted` and `Applied` are different states.

---

## 10. Build and candidate lifecycle

### 10.1 Isolation and workspace ownership (HL-BUILD-001)

For an approved plan: clone/copy trusted VM project into an untouched **baseline** and a mutable **candidate**, preserving original project. Store run ID, baseline/source commit, paths, snapshot hashes, plan and review relations. Use an isolated revision staging directory per revision attempt.

### 10.2 Real-time lifecycle (HL-BUILD-002)

Publish and persist `preparing`, `testing baseline`, `implementing`, `evaluating`, `awaiting review`, `blocked`, `failed`, `candidate passed`, `candidate failed`, and `evaluation error` states as supported by actual operations. Show last tool event, test output and errors in Build and on linked Planning/Goals cards. Never infer per-file edits solely from a natural-language model response.

### 10.3 Evidence and evaluation (HL-BUILD-003)

- Capture exact interpreter, command, stdout, stderr, exit code, duration, target path, dependency provenance and environment fingerprint.
- `candidate_passed` means specified test command actually ran and passed; it does **not automatically** mean every plan criterion or product requirement passed.
- `candidate_failed` means tests ran and failed; missing test runner, invalid environment, SSH failure, timeout and untestable setup must use distinct evaluation/infrastructure errors.
- Compare baseline and candidate under compatible, reproducible environments. Do not equate “baseline pytest unavailable” with proof of regression.
- Reevaluation should reuse an existing candidate without invoking Hermes to edit it; preserve previous results and provenance.

### 10.4 Review UX and candidate disposition (HL-UI-BUILD-001)

Build has filters for `Active`, `Awaiting review`, `Revisions`, `Failed/blocked`, `Completed`. Run card shows project, plan, timestamps, actual step, test summary, linked task and **Review candidate**. Review drawer displays actual changed files and bounded diff, snapshot hash, test comparison, criteria and original plan. Explicit decisions: **Accept**, **Reject**, **Request revision**, optionally **Apply to host** after separate review/approval. Never leave a dead button or opaque technical JSON as primary output.

### 10.5 Automatic revisions (HL-BUILD-004)

A revision request supplies structured feedback and links to the immutable prior review. A worker queues a **bounded** new attempt, verifies the reviewed snapshot is still current, copies to staging, authorizes edits **only in staging**, evaluates with the shared test environment, and records attempt evidence.

A passing revision may be promoted back to the VM candidate only after reliable rollback/recovery guarantees, then independently reevaluated, prior review archived, and a **new** review window opened. A failed revision preserves the original candidate and permits a bounded retry; on exhaustion it returns to a valid human-review state, not a deadlocked `revision_requested` row. On ambiguous mid-promotion recovery, expose `recovery_required` and block further mutation until resolved.

### 10.6 Applying changes (HL-BUILD-005)

Accepting a candidate **does not** change host files. Host application is a distinct transaction: verify exact diff, base commit, host working tree, snapshot checksum, approved file list and conflict outcome. Show what will change. Recheck immediately before applying. Preserve host backups/commit recovery and link resulting commit/patch. If repo advanced, approval expires and re-review is required.

---

## 11. Test environments: reproducible, platform-owned (FLOW-007)

### 11.1 Shared rule (HL-ENV-001)

One guest environment implementation, e.g. `hermes_life/guest_env.py`, MUST serve initial evaluation, reevaluation, and revision staging. Both guest scripts must embed/invoke identical evaluator logic, with a regression test preventing drift.

For new runs, the authoritative interpreter is a platform-provisioned `/home/hermes/experiments/env-<run-id>/bin/python`, created from the trusted baseline dependency manifest. The same environment is used for baseline, candidate and revisions. No agent-created `candidate/.venv`, `staging/.venv`, or unstable private Hermes toolchain may silently supersede it. Legacy runs may need explicit migration/reprovisioning, with provenance and a surfaced failure if recovery is impossible.

### 11.2 Dependency policy (HL-ENV-002)

Baseline dependency sources are trust-checked; supported manifest syntax and install policy must be documented and enforced. Candidate-authored dependency changes are not installed automatically. Changes to requirements requiring new packages need a separate review/approval path. Prohibit editable installs or local build backends unless policy explicitly permits them in a further sandbox. The system must validate that tests truly import the **candidate** code, not an editable-installed original from `.pth` paths or `PYTHONPATH` leakage.

### 11.3 Provenance and errors (HL-ENV-003)

Every evaluation stores environment source, interpreter/version, resolved dependency list, baseline manifest hash, installed distribution versions, exact test command and exit code. Invalid dependency directives, install failure, missing pytest, corrupt venv or stale manifest are `evaluation_error` with actionable diagnostics; never `candidate_failed` by default.

### 11.4 Retention (HL-ENV-004)

Keep an environment while its associated candidate is reviewable/reevaluable. Cleanup uses database state and path containment checks; never deletes an environment merely because its folder name looks old.

---

## 12. Projects and source-of-truth knowledge

### 12.1 Project registry (HL-PROJECT-001)

Register multiple projects with unique name, host path, VM workspace, repo type, branch/commit, language/build profiles, allowed tool permissions, test commands, documentation links, spec path, last sync and status. Project selection persists per conversation, and automatic routing can be suggested **only when unambiguous and verifiable**.

For Hermes Life itself: `HERMES_LIFE_MASTER_DEV_SPEC.md` is the intended authority after adoption; previous `HERMES_LIFE_DEV_SPEC.md` and issue files remain reference material, not independently competing instructions. Project metadata must designate one authoritative document/version.

### 12.2 Context assembly (HL-KNOW-001)

For each goal/task: gather project spec sections, relevant current issues, matching repository files, recent approved decisions, relevant curated Obsidian memories and conversation history. Include source paths/checksums and bounded excerpts. Distinguish user instruction from retrieved/untrusted content. Do not grant a document permission to bypass user gates.

### 12.3 Knowledge freshness (HL-KNOW-002)

Expose whether a project spec is synced to the VM, when last indexed, its SHA-256, and whether an obsolete copy is being used. If host and VM copies differ, present a blocking discrepancy or explicit selection rather than silently choosing.

### 12.4 Goal generation (HL-KNOW-003)

Before creating an implementation goal, inspect actual repository state and compare it to the relevant specification requirement. Mark each candidate gap as `confirmed`, `partially implemented`, `unverified`, or `already implemented`; do not keep reopening stale BUG-001-type findings. Goal content follows §23.

---

## 13. Memory, Obsidian and continuous learning

### 13.1 Four distinct information classes (HL-MEM-001)

1. **Conversations:** full turns, task IDs, revision/branch lineage, timestamp and transcript provenance.
2. **Durable user/project memory:** explicit preferences, stable facts, decisions, corrections with supporting evidence and privacy boundaries.
3. **Technical lessons:** verified problems/solutions with commit/run/evaluation citations, version applicability and confidence.
4. **Registered knowledge sources:** indexed PDFs, repos, manuals, design specifications and cited study notes.

Do not treat an entire chat transcript as durable fact or a model-generated claim as a verified lesson.

### 13.2 Obsidian contract (HL-MEM-002)

Use the configured vault under `/home/gayzer/black/obsidian/hermes/Hermes-Life/` by default. Mirror key transcripts, accepted lessons, project decisions and study artifacts in human-readable Markdown, with stable IDs, timestamps, source links/checksums, provenance and sync outcome. Edits to vault notes should have a defined reconciliation policy; no silent overwrites.

### 13.3 Extraction, contradictions, retrieval (HL-MEM-003)

- Extract only meaningful explicit/implicit memories with verbatim supporting evidence.
- Deduplicate equivalent memories, preserve older provenance and supersede corrections.
- Conflicts enter a review state; do not silently resolve by recency alone where materially ambiguous.
- Retrieve semantically relevant approved memories and transcript excerpts, with token budgets and source references.
- Expose memory extraction attempts, candidate/rejection counts and reasons; `0 stored` without explanation is unacceptable.
- Keep secrets and unnecessary personal data out of routine memory or diagnostic output.

### 13.4 Development learning (HL-MEM-004)

An accepted candidate or resolved incident may yield a technical lesson **only when supported by outcome evidence**, including tests and acceptance decision. Rejected/failed attempts can generate lessons about failures, labeled as such. A new coding task should retrieve relevant lessons for the same project/toolchain without copying stale instructions blindly.

---

## 14. Directed learning and study automation

**HL-STUDY-001:** A registered learning source has filename/URI, hash, page/section count, extraction coverage and indexed units. A PDF with 61 pages and 60 searchable pages must not be declared 60/60 complete without accounting for the nonsearchable page.

**HL-STUDY-002:** Split source into bounded units; track `not queued`, `queued`, `running`, `completed`, `failed`, `blocked`. One unit should not be enqueued twice after restart.

**HL-STUDY-003:** Each completed unit produces cited notes and practical verification (when appropriate). Store structured progress and Obsidian notes, not merely a model claim of having studied.

**HL-STUDY-004:** Scheduler/timer may advance completed units, but must stop and explain genuine failures or missing backend/VM access. Display progress and current source/unit in Overview/Knowledge.

---

## 15. Virtual lab / Hermes World: truthful visual telemetry

### 15.1 Purpose (HL-WORLD-001)

The virtual lab is the visual counterpart to the activity ledger, showing the same real work in a more intuitive form. It is never authoritative for execution; animations and location are derived from persisted events/task state.

### 15.2 Suggested stations and operational mapping

| Station | Real operations | Detail overlay |
|---|---|---|
| Library | Reading spec, manuals, sources, indexed docs | Source/document, section, study unit |
| Planning desk | Investigation synthesis, goal formulation, plan creation | Goal, linked evidence, pending approval |
| Coding studio | Source search, file edits, Git diff | Repo, file count, edited paths as recorded |
| Test lab | Environment provisioning, baseline/candidate tests, reevaluation | Exact command, progress/exit status, errors |
| Archive | Obsidian notes, memory lookup/extraction, knowledge indexing | Note IDs, successful sync/failure |
| Lounge | Idle, user gate, disconnected | Why idle, what Hermes is waiting for |

If no station maps to an event, show neutral activity, not fabricated actions. Room travel can animate but must not imply a tool action happened unless an event exists.

### 15.3 Detail and controls (HL-WORLD-002)

Click a station or current task to open a compact detail panel: active project, goal/task/run ID, actual operation, start time, last event, recent five events, link to full evidence, and next decision. Distinguish `live`, `last seen`, `waiting for user`, `disconnected`. Mark missing telemetry rather than guessing. The scene may adapt layout to screen space; chat expansion must not crush the room detail controls.

### 15.4 Rendering constraints (HL-WORLD-003)

Respect device pixel ratio and Phaser version's supported GameConfig types; do not inject unsupported top-level properties merely for sharpness. Maintain usable image rendering, responsive layout and accessibility alternatives for visual-only state.

---

## 16. Event, task, and conversation telemetry

### 16.1 Event envelope (HL-EVENT-001)

At minimum: `event_id/sequence`, `occurred_at`, `kind`, `project_id?`, `goal_id?`, `task_id?`, `discovery/formulation/plan/run/attempt IDs?`, `origin`, `payload`, `error?`, `correlation_id`. Emission follows a durable state transition and is replayable after reconnect. If changes affect several records, store the transition atomically and publish after commit.

### 16.2 Timeline behavior (HL-EVENT-002)

A single linked timeline is accessible from Chat, Goals, Discover, Planning, Build, and Activity. A user clicking `Investigate` sees a pending result immediately; once the task starts, activity updates in that same card. The corresponding Activity page supplies full diagnostics but is not required to know what's happening.

### 16.3 Streaming integrity (HL-EVENT-003)

Stream Hermes CLI text deltas and tool events into sequenced backend records. The UI renders an incremental response without duplication and recovers after reconnect. On final completion, show one authoritative result and evidence. No fictional stream messages or private reasoning dumps.

### 16.4 Error states (HL-EVENT-004)

Explain failures by category: `vm_unavailable`, `project_unsynced`, `approval_required`, `policy_denied`, `environment_error`, `test_failure`, `stale_snapshot`, `timed_out`, `cancelled`, `recovery_required`, `storage_limit`. Do not use HTTP 500 or generic “Connection error” as the sole visible explanation when structured server context is available.

---

## 17. Autonomy, scheduling, and permissions

**HL-AUTO-001:** Autonomy is an explicit enable/disable state. User-triggered tasks can be executed independently according to permissions. Disabled autonomy must not silently enqueue new self-directed tasks.

**HL-AUTO-002:** One scheduling owner selects eligible goals by priority, age, dependencies, project scope, resource budget and current run lease. Safe handoffs are idempotent. No duplicate task starts because of repeated browser clicks or restart.

**HL-AUTO-003:** Background scans and knowledge loops must be budgeted and yield to user work. Repeated unchanged TODOs cannot monopolize resources.

**HL-AUTO-004:** Permissions are per operation: read-only inspect; test baseline or run project code; write isolated candidate; promote a revision; accept candidate; apply to host; publish/deploy. Approval for one scope never silently escalates to another. Read-only must be enforced at tool/workspace level, not prompt text alone.

**HL-AUTO-005:** Concurrent operations require consistent leases and crash recovery. An external side effect is never retried blindly; replaying an internal idempotent state transition is allowed if the transition has a unique key.

---

## 18. Storage, experiment retention, and maintenance

### 18.1 Pruning model (HL-MAINT-001)

Implement an explicit database-driven prune operation. Default is **dry run**; return exact eligible paths, sizes, reasons, owner IDs, blockers and anomalous unmatched directories. No filename-only guessing. Every actual deletion emits an audit event.

| Directory | Default policy |
|---|---|
| Revision staging | Eligible after terminal attempt, persisted evidence and retention window |
| Revision backup | Eligible only after no open revision/recovery is dependent on it |
| Candidate/baseline | Keep if accepted but not applied; eligible for rejected/abandoned runs after retention |
| Platform env | Keep while associated run needs reevaluation/revision; then eligible by lifecycle |
| Incomplete recovery dirs | Never auto-delete; surface anomaly |
| Orphans/unrecognized | Report; never automatically delete |

**HL-MAINT-002:** Example interface `POST /api/maintenance/prune-experiments` with `dry_run` default `true` and `older_than_days` explicit. CLI job may invoke same service. Warn before storage is critically low; do not add a silent janitor that deletes artifacts without visible policy.

---

## 19. API and persistence contracts

### 19.1 API design (HL-API-001)

Existing route families include `/api/projects`, `/api/goals`, `/api/tasks`, `/api/conversations`, `/api/discoveries`, `/api/curiosity`, `/api/formulations`, `/api/investigation-plans`, `/api/implementations`, `/api/memories`, and `/ws/events`. Additional endpoints for plan approval, review, reevaluation and revisions are version-dependent. **Query the installed `/openapi.json` before declaring an endpoint available.**

All mutating endpoints return an ID and new state or a structured conflict/error; long-running work returns a job/run ID immediately. A frontend control without a functioning backend operation must be disabled with an explanation, not presented as active.

### 19.2 Schema invariants (HL-DB-001)

Durable IDs and parent relationships; immutable review history; unique idempotency keys; audited timestamps; versioned migrations; no orphan transition. A failed migration leaves the database recoverable and reports its version. Database changes are tested against fresh and legacy schemas.

### 19.3 Required status query (HL-API-002)

A task or workflow status response should include authoritative current stage, last event timestamp, current blocker, next action, linked records and evaluation summaries. Avoid requiring browser code to infer state by scraping error strings or searching unrelated lists.

---

## 20. Quality, testing, and release gates

### 20.1 Required validation layers

1. **Unit:** state guards, prompts, environment resolver, fingerprints, serialization.
2. **Integration:** temporary SQLite + fake adapter; full discovery → formulation → investigation → proposed plan → approval → build/review transitions.
3. **VM execution:** real SSH, tools, baseline environment provisioning, candidate edits, tests and revision rollback.
4. **Browser:** real route loads, empty states, click handlers, task links, live polling/streaming, filtering, resizing, responsive behavior.
5. **Recovery:** restart mid-task, duplicate action, stale approval, interrupted promotion, exhausted revisions, no pytest/VM failure.
6. **Migration:** preexisting database and historical records retained; failed installs refuse mismatched files rather than overwriting them.

### 20.2 Mandatory acceptance scenarios

| ID | Scenario | Passing evidence |
|---|---|---|
| UI-01 | Select project in compact chat; open/close workspace drawer | Composer/history retain layout and draft; no permanent crowding |
| UI-02 | Click Goals → View task | Opens actual linked result; pending goal explains absence |
| UI-03 | Click Discover Questions count | Navigates to filtered curiosity records; correct count |
| UI-04 | Start curiosity investigation | Immediate linked ID and live status in same view |
| UI-05 | Open approved plan | Actual steps, criteria, linked task/run, `Not started` if no run |
| FLOW-01 | Approved investigation completes | Proposed plan automatically created exactly once |
| FLOW-02 | Attempt unapproved build | Backend rejects with explicit conflict |
| FLOW-03 | Approve plan | Authorized build starts or clearly reports blocker/next action |
| BUILD-01 | Candidate runs tests | Reproducible interpreter/deps/command and real exit recorded |
| BUILD-02 | Baseline and candidate comparison | Both use same platform environment; import path verified |
| BUILD-03 | Reviewer requests revision | New isolated attempt, progress, history, review reopened on success |
| BUILD-04 | Revision fails three times | Review available again; no deadlock; original candidate preserved |
| BUILD-05 | Mid-promotion failure | Recovery/rollback state correct; no silent overwrite |
| BUILD-06 | Candidate accepted | Stored review; no unapproved host modification |
| BUILD-07 | Apply to host | Exact snapshot/commit rechecked; stale approval rejected |
| MEM-01 | Prior explicit correction reused | New task receives relevant sourced memory; no invented facts |
| KNOW-01 | Changed spec after sync | Context check identifies version/hash mismatch |
| WORLD-01 | Real tool event | World station/detail corresponds to persisted operation |
| RES-01 | Restart/reconnect | No duplicated task, lost review, or fabricated current state |
| MAINT-01 | Prune dry run | Complete grounded preview; zero directories deleted |

### 20.3 Definition of done

A feature is complete only if: (a) the UI and API match specified behavior, (b) backend state transition is validated, (c) tests cover success/failure/restart as relevant, (d) no preexisting workflow regressions, (e) live deployment verified when claiming operational success, (f) document and status registry updated, (g) result has evidence links. “Patch built,” “tests passed in fixture,” and “installed on host” are three different claims.

---

## 21. Ordered development roadmap

This roadmap is **dependency-based**, not a promise that every earlier patch has been deployed. Before each item, inspect the host commit, VM commit, OpenAPI, DB migrations and frontend bundle.

| Order | Goal ID / priority | Intended deliverable | Depends on | Completion gate |
|---|---|---|---|---|
| 0 | **HL-BASE-001 / P0** | Deployment inventory and drift reconciliation: host/VM code, migrations, frontend bundle, approved spec | None | Baseline report with hashes, endpoint/migration checks and actual runtime state |
| 1 | **HL-ENV-007 / P0** | Unified platform-owned baseline/candidate/revision test environment | 0 | Real VM tests on project with third-party deps, same interpreter, recorded provenance |
| 2 | **HL-FLOW-008 / P0** | Approved-plan execution handoff: queue/build or explicit blocker; no indefinite limbo | 0, 1 | Approved plan produces run or actionable blocked state |
| 3 | **HL-UI-008 / P0** | Workflow progress UI for Discover, Goals, Planning and Build | 2 | All linked stages and why-waiting visible without Activity tab |
| 4 | **HL-BUILD-009 / P0** | Consistent candidate accept/reject/revise/apply workflow, including host-vs-VM clarity | 1, 2 | Live candidate review + safe standalone apply; stale changes rejected |
| 5 | **HL-REV-010 / P1** | Production-safe revision worker recovery/exhaustion and real VM test | 1, 4 | Fault-injection cases and revised candidate reopened for review |
| 6 | **HL-UI-011 / P1** | Compact chat polish, reliable task links, accessible review drawer | 3 | Browser layout and action tests; no crowding |
| 7 | **HL-DISC-012 / P1** | False-positive suppression, historical dedup reconciliation, curiosity prioritization | 0, 3 | Real VM scan + migrated historic records, no repeated template TODOs |
| 8 | **HL-MEM-013 / P1** | Cross-task memory/Obsidian verification, knowledge freshness and contradiction flow | 0 | Source-backed retrieval test and memory extraction diagnostics |
| 9 | **HL-WORLD-014 / P1** | Event-driven virtual lab stations and details | 3 | Room/activity changes map to actual events and explain task status |
| 10 | **HL-STUDY-015 / P2** | Reliable directed study progress and reports | 0, 8 | Full source units complete exactly once with artifacts |
| 11 | **HL-MAINT-016 / P2** | Experiment retention and DB-driven dry-run prune | 1, 4, 5 | Safe preview/orphan/retention tests, storage warnings |
| 12 | **HL-QUALITY-017 / P2** | Full recovery, browser regression, install and end-to-end suite | All | Continuous real-environment release gate |

**Suggested first sprint:** 0 → 1 → 2 → 3. Do not begin storage cleanup while candidate recovery and environment ownership remain unverified. UI polish should not obscure the underlying execution-state gap.

---

## 22. Implementation evidence and status registry (snapshot)

**Snapshot date: 2026-11-04.** Status entries are intentionally conservative. `Observed` is not a claim that every code path was independently inspected in this document. Update against the running installation before acting.

| Area | Evidence from this project conversation | Status for planning |
|---|---|---|
| Backend/API, SQLite, VM SSH | Working API, SSH commands, goals and task/event records demonstrated | Observed foundation |
| Git project registry | `/api/projects` returned registered `hermes-life` and VM path; Sync worked | Observed foundation; apply path separately verify |
| Obsidian | Docs copied to vault/VM; memory and project knowledge integration patched | Partial; full retrieval/evidence tests needed |
| Discovery fingerprints | Hermes source inspection: excludes line, dedup test passing | Resolved in source; historic DB reconciliation unverified |
| Curiosity Investigate | User reported action now works after FLOW-003 | Observed UI action; live linked-goal reliability needs tests |
| Lifecycle investigation → plan | Route loaded, linked approved formulation / completed goal / proposed plan seen | Partial live validation; new full chain still needed |
| Plan approval | `POST /api/investigation-plans/{plan_id}/approve` loaded | Observed endpoint; implementation handoff incomplete |
| Candidate evaluator | Existing candidate reevaluated `candidate_passed`, 3 tests passed | Observed on simple Python test project only |
| Baseline environment | Baseline returned missing pytest error | Confirmed defect at previous state; FLOW-007 rollout needs proof |
| Candidate review | One run reported accepted in Hermes audit | Observed report; acceptance does not imply host application |
| Auto revisions | FLOW-006/006.1 patches produced; audit found missing DB tables and stale bundle before subsequent changes | Deployment and fault recovery require live verification |
| FLOW-007 unified env | Merged package produced from uploaded host files; user had not yet reported successful install | **Not verified installed** |
| Goals/Planning UI | Screenshots show unclear statuses, approved plans lacking progress, task clicks not useful | Incomplete UX |
| Chat UI | Crowded project control panel reported; compact-chat patch produced | Verify current build and layout |
| Virtual lab | Rooms/world exist but insufficient live detail | Partial |
| Event/streaming | `/ws/events` exists; real stream end-to-end and UI recovery not established | Partial/unverified |
| Study | Handbook 13-unit manifest and timer installed earlier | Continued autonomous completion unverified |
| Experiment pruning | Proposed policy, no confirmed implementation | Planned |

**Known conflict with older spec:** The earlier `HL-SOT-001` §15 `HL-BUG-001` and milestone sequence were a snapshot from November 2; they should not be treated as currently confirmed defects. This document's registry and verified source/runtime evidence supersede those stale status claims once this document is adopted.

---

## 23. Canonical development-goal format for Hermes

Do **not** ask Hermes to “build everything in this spec” as one goal. It must select the smallest independently testable discrepancy and respect dependency order.

```markdown
# HL-<AREA>-<NUMBER> — <outcome-based name>

## Specification reference
Requirement IDs and exact sections of HERMES_LIFE_MASTER_DEV_SPEC.md.

## Evidence & classification
- Confirmed defect / partial / missing / unverified / already implemented
- Current host commit + VM workspace commit
- Source paths/functions and current behavior
- API/DB/runtime evidence; what remains unverified

## User-visible problem
What the user cannot do today, and the precise state that causes it.

## Required behavior
Observable outcome; actual approval boundary; failure and restart handling.

## Implementation scope
Files/services expected, dependencies, migration requirement, affected routes.

## Out of scope
Explicit non-goals to avoid side quests and unrelated refactoring.

## Acceptance criteria
Numbered, reproducible outcomes including negative and recovery tests.

## Work sequence
Inspect actual source → edit only authorized VM workspace → run tests →
compare against acceptance → report change list, diff and validation.

## Delivery
Candidate/run identifiers, changed files, tests, schema changes, known limitations,
review state. No host modification without distinct approval.
```

**Generation constraints (HL-GOAL-001):** Avoid redundant instructions such as “read the entire audit” when task evidence is already provided. No duplicate goals for confirmed completed requirements. Do not treat requirements from an obsolete document as overrides. Do not mark a goal complete without test/evidence links. If blocked, record the exact blocker and recommended next valid action.

---

## 24. ADR, release, and adoption rules

### 24.1 Decision records

```markdown
# HL-ADR-YYYY-NNN: <decision>
Date / status / owner
Requirement IDs affected
Context and alternatives
Chosen behavior and why
Risks and rollback
Verification and migration plan
```

### 24.2 Installing a development change

1. Read the current host files and VM source version; detect divergence.
2. Produce a reviewable diff against the **actual current base**, preserving later features.
3. Run relevant tests and full suite when possible.
4. Review changed files, migrations and approval semantics.
5. Apply only an approved exact snapshot to host; commit intentional source changes.
6. Restart backend if backend/schema changes; rebuild frontend if UI changes.
7. Verify live routes, database version, frontend asset freshness and actual scenario.
8. Record status/evidence in §22 or linked status ledger and relevant ADR.

An installer should refuse incompatible files and explain the conflict; it must not offer dangerous blind overwrites as a default. No assumption that `git sync` transfers VM candidate back to host.

### 24.3 Adopting this document as authority

Copy this file into the host repository; review it; explicitly designate `HERMES_LIFE_MASTER_DEV_SPEC.md` as the project registry's `spec_path` and synchronize it to the VM only **after preserving pending VM edits**. Keep `HERMES_LIFE_DEV_SPEC.md` and `CURRENT_ISSUES_01.md` as historical/context material. Future goals must cite the new document's requirement IDs. The Obsidian vault can contain a mirrored copy with canonical file hash and an “authority” pointer; a mirrored file must not silently override the registered authoritative copy.

### 24.4 Change log

- **v2.0 / 2026-11-04:** Consolidated product purpose, architecture, full UI information model, interactive curiosity, goal/task distinction, plan lifecycle, approval gates, candidate review/revisions, reproducible test environments, memory/Obsidian, virtual lab event mapping, maintenance policy, deployment gates and updated dependency roadmap.
- **v1.0 / 2026-11-02:** Original HL-SOT-001 target specification, retained as historical context.

---

## 25. Final product acceptance (north star)

Hermes Life is ready to act as the user's everyday personal AI coding/task assistant when a user can, **without command-line babysitting**:

1. Choose a project and ask for a change in normal language.
2. See what is queued, running, done, waiting and blocked in the same view.
3. Watch a real read-only investigation generate evidence and a structured plan.
4. Approve that plan and see an isolated candidate build actually start (or a concrete blocker).
5. See reproducible baseline and candidate evaluation with matching platform-owned environments.
6. Review the exact diff, request bounded revisions, accept/reject, and separately approve host application.
7. Recover from crashes/restarts and never lose or duplicate a review/action.
8. Continue conversations and future projects with sourced Obsidian memory and accurate project context.
9. Understand Hermes' current work from both activity cards and the virtual lab, without guessing what animations mean.
10. Trust that every completion claim maps to an actual persisted state, real execution evidence and a verifiable outcome.

**Design invariant:** Hermes must never leave the user wondering: *What is this record? Is it new or old? Has it started? What did Hermes do? What stopped it? What is the next action?*
