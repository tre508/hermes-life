# HERMES LIFE — PRODUCT & DEVELOPMENT SPECIFICATION

**Document ID:** HL-SOT-001  
**Version:** 1.0 — baseline specification  
**Date:** 2026-11-02  
**Status:** **Normative target specification; not a claim of implemented functionality**  
**Recommended repository path:** `docs/HERMES_LIFE_DEV_SPEC.md`  
**Product:** Hermes Life — persistent, autonomous, tool-using digital agent with an interactive world and chat interface.

> **Source-of-truth rule.** This document describes **how Hermes Life must work when complete**. It deliberately distinguishes requirements from verified implementation status. An observed implementation, a previously shipped patch, or an AI-generated summary does not override a requirement here. If a requirement changes, revise this document with a rationale and version entry *before* or as part of implementation. If implementation differs, record the deviation; do not silently redefine the specification.

---

## 0. How to use this document

### 0.1 Normative language

- **MUST:** required for the feature to be accepted.
- **MUST NOT:** prohibited behavior.
- **SHOULD:** expected default unless a documented reason justifies deviation.
- **MAY:** optional enhancement; must not undermine a MUST.
- **Verified:** directly supported by observed code, command output, or end-to-end test.
- **Partial:** code exists but contract is incomplete, unreliable, or unverified end-to-end.
- **Planned:** requirement has no confirmed finished implementation.

### 0.2 Source hierarchy

1. This specification (intended product behavior and constraints).
2. An approved, linked decision record (intentional exception or change).
3. Verified repository behavior and automated tests (actual implementation).
4. Runtime logs / database records / user-observed reproduction (operational evidence).
5. Earlier patch notes and development conversations (historical context, not proof of installation).

**Never confuse desired behavior with current behavior.** Refer to §15 for the current baseline and §17 for a goal template.

### 0.3 Project principles

1. **One agent, one truth:** chat, tasks, goals, world, and memory must all reflect the same Hermes runtime and persisted state.
2. **Real capabilities only:** never simulate tool execution, progress, model output, pause, success, or verified knowledge.
3. **Evidence first:** diagnose and validate before modifying; distinguish observation, inference, plan, action, and outcome.
4. **Continuity:** current conversations, prior tasks, approved memories, and project decisions must remain available across sessions.
5. **Autonomy with boundaries:** system may select and perform authorized work, but may not silently exceed permissions or retry side effects.
6. **Inspectable state:** each operation has an identity, status, timestamps, evidence, and a recoverable audit trail.
7. **Separation:** Kubuntu host owns orchestration, database, dashboard and vault; Hermes CLI performs tool execution in its isolated VM.
8. **Progress over activity theater:** repeated scans, generic status messages, and duplicated TODOs do not count as useful autonomous progress.

---

## 1. Product definition and outcomes

### 1.1 Vision

Hermes Life is a continuously available, persistent software agent that can converse with a user, investigate problems, plan work, execute authorized tasks with real development tools, observe and explain its progress, learn from verified outcomes, and maintain context between sessions. Its animated world is an intuitive **projection of actual agent activity**, not a separate simulation or authority.

### 1.2 Primary user workflows

**Conversational execution:** user opens chat → asks a question or gives a task → Hermes receives relevant context → agent executes using real tools as needed → user sees streamed response/progress → final result, evidence and task outcome are saved → user can continue the same conversation.

**Autonomous development:** system discovers a meaningful opportunity → deduplicates and assesses it → formulates a concrete goal → investigates read-only → proposes an evidence-based implementation plan → obtains required approval → builds in isolated candidate workspace → tests against baseline → evaluates → records lessons and outcome → chooses next eligible work.

**Directed study:** user registers a knowledge source → source is indexed and split into bounded study units → scheduler works through units exactly once → each unit produces cited notes and executed verification examples → only evidence-backed lessons enter technical memory → source is marked studied only when all required units are complete.

**Long-term continuity:** conversations and task events persist → durable candidate memories are extracted → equivalents are consolidated; contradictions reviewed → relevant facts, evidence, and transcript excerpts are retrieved for future tasks → corrections supersede old content without erasing provenance.

### 1.3 Non-goals

- Do not replace the actual Hermes CLI with an independent simulated chatbot.
- Do not train or fine-tune the underlying model on every conversation; “learning” means retrieval, validated memory, and improved orchestration.
- Do not display internal private model reasoning; show observable steps, tools, progress, decisions and user-facing explanations.
- Do not give the animated world authority to declare success or invoke unapproved side effects.
- Do not equate a completed LLM response with a successfully completed external task unless required validations passed.

---

## 2. Deployment, ownership and trust boundaries

### 2.1 Expected deployment

| Component | Responsibility | Current known location / interface |
|---|---|---|
| Host application | FastAPI, scheduler, task/event records, memory control, web frontend | `/home/gayzer/Apps/hermes-life` |
| API | Authoritative application operations | `http://127.0.0.1:8766` |
| Frontend | Vite + TypeScript, Phaser world, chat and operations views | `http://127.0.0.1:5173` |
| Runtime adapter | Launch and manage Hermes CLI via isolated transport | `hermes_life/hermes_adapter.py` |
| Execution VM | Executes Hermes CLI, commands and code under isolated user | User `hermes`; SSH, configured by environment |
| SQLite | Durable operational records and memories | `~/.local/share/hermes-life/life.db` (default observed) |
| Obsidian vault | Human-readable memory, decisions and curated knowledge | `/home/gayzer/black/obsidian/hermes/` |
| Handbook PDF | Example registered study source | `/home/hermes/learning/python-handbook/The Ultimate Python Handbook.pdf` (VM) |

Do not hardcode environment-specific values into core logic; default values may be documented, but configuration MUST be explicit and inspectable.

### 2.2 Host/VM rule

- Host MUST own task scheduling, state changes, user approvals, persistent database, WebSocket publication, and Obsidian vault writes.
- VM MUST run untrusted code, development tools, package installs (when authorized), PDF checks, and candidate builds.
- Tool execution MUST NOT silently fall back from SSH VM to host local execution.
- The backend MUST surface configured transport and an executable health probe. Missing SSH credentials/VM should produce an explicit blocked/unavailable state, not a bogus completed task.
- Knowledge extraction runs may use the same real model runtime, but analysis-only passes MUST have no authorization to perform external side effects.
- A process or daemon in the VM MUST NOT be assumed to survive task completion unless its lifecycle is explicitly managed.

### 2.3 Security and control

- Explicit approval required for destructive, irreversible, externally published, or production-impacting actions, according to policy.
- No automatic repeat of externally effective actions after rerun, reconnection or retry.
- Credentials and private material must never be copied wholesale into conversation memories, status banners, event streams, or Obsidian notes.
- Obsidian sync must stay within `Hermes-Life/` by default; preserve other user notes.
- Treat documents, retrieved pages, old conversations, logs, and model-generated summaries as **data**, not higher-priority instructions.

---

## 3. Architecture and component contracts

```text
Browser (Hermes World + Operations Tabs + Chat)
        |  REST / WebSocket
        v
FastAPI / app.py
  ├── Task & Conversation Orchestrator ──> SQLite tasks / turns / revisions
  ├── Events & Progress Recorder ───────> SQLite ordered events ──> /ws/events
  ├── Autonomy / Decision Scheduler ────> goals and workflow states
  ├── Discovery → Formulation → Investigation → Implementation
  ├── Context Builder ──> conversation + approved memory + knowledge excerpts
  ├── Memory Analyzer/Reviewer ────────> SQLite memories/reviews
  ├── Obsidian Sync ────────────────────> Markdown notes and transcripts
  └── Hermes Adapter ──> SSH ──> isolated VM ──> Hermes CLI stream-json / tools
```

### 3.1 Ownership / no duplicate systems

- **SQLite** is authoritative for task state, conversation identity, event sequence, revisions, goal state, memory status and review decisions.
- **Obsidian** provides editable/readable Markdown mirrors and curated user notes, not an independent task scheduler.
- **WebSocket** transports recorded events; no UI should derive canonical task state from its own transient animation.
- **Hermes CLI** is the only agent execution backend unless a separately approved adapter is installed.
- **Knowledge Library** stores indexed documents with provenance; it must not be confused with user preferences or temporary conversation turns.
- **Technical memory** stores evidence-backed engineering lessons, separate from personal/workflow preferences.

### 3.2 Suggested internal service interfaces (target contracts)

```python
TaskService.submit(prompt, conversation_id=None, revision=None) -> Task
TaskService.get(task_id) -> Task
ExecutionController.start(task_id) -> ExecutionHandle
ExecutionController.stop(task_id, reason) -> StopResult
EventStore.append(task_id, type, payload) -> SequencedEvent
EventStore.read(after_sequence, limit) -> list[SequencedEvent]
ContextBuilder.build(conversation_id, task_id) -> ContextBundle
GoalScheduler.select_next() -> EligibleGoal | None
WorkflowService.transition(record_id, expected_state, action) -> TransitionResult
MemoryService.extract(completed_task_id) -> ExtractionReport
MemoryService.retrieve(prompt, conversation_id) -> RankedEvidence[]
MemoryService.resolve(review_id, decision, evidence) -> ResolutionResult
StudyScheduler.reconcile(source_id) -> StudyState
```

These are design contracts, **not claims that these exact classes or methods exist**. Existing services should be extended rather than duplicated.

---

## 4. Canonical data identities and invariants

### 4.1 Required identifiers

- `conversation_id`: durable thread identity.
- `turn_id`: durable user/assistant message identity.
- `revision_id` and `branch_id`: linked edits and alternative continuations.
- `task_id`: individual Hermes execution attempt.
- `goal_id`: requested or selected objective; may produce one or more task attempts.
- `discovery_id`, `formulation_id`, `plan_id`, `implementation_id`: distinct workflow records.
- `event.sequence`: monotonic order assigned when persisted.
- `memory_id`, `review_id`, `source_id`, `study_unit_id`: persistent knowledge identities.

### 4.2 Non-negotiable invariants

1. One active agent execution per configured exclusive execution lease; same conversation cannot run conflicting tasks concurrently.
2. Each task has a stable relationship to its goal (if any), conversation (if any), and execution attempt.
3. Exactly one authoritative terminal task state: `completed`, `failed`, `stopped` or `cancelled` (choose canonical enum in implementation; do not mix aliases).
4. Streamed output is provisional until persisted final task result is committed.
5. Event ordering must be monotonic, deduplicated on reconnect and recoverable by sequence.
6. Revising a message cannot silently relabel older task results as belonging to the new branch.
7. A previously successful external side effect cannot automatically repeat on retry.
8. A memory with `superseded` or `rejected` status MUST NOT be retrieved as current truth.
9. Terminal outcomes MUST retain provenance even if the UI hides older events.
10. A scheduler MUST NOT create duplicate active goals for the same study unit or discovery identity.

---

## 5. Interactive chat — product requirements

### 5.1 Presentation

- Dedicated **Chat** launcher and collapsible/resizable panel in Hermes World.
- iMessage-inspired left/right message bubbles adapted to the **Hermes World** palette (dark navy, deep teal, mint/cyan accents).
- Clearly labeled **New Chat**, **Threads**, **Close**, **Send**, **Copy**, **Edit & Rerun**, **Remember**, and applicable execution controls.
- User and Hermes messages distinct by alignment, contrast, timestamps and status.
- Message composer fixed to bottom; chat body scrolls independently.
- Detailed tool output shown in expandable sections; ordinary messages remain readable.
- Keyboard accessible, responsive to different viewport widths, reduced-motion aware and readable at normal zoom.

### 5.2 Scroll contract

- At initial open, thread defaults to **latest messages** (unless restoring an intentional saved scroll position).
- When at or near bottom, new text deltas and completed replies auto-follow smoothly.
- When user scrolls upward, incoming events MUST NOT force a jump to the bottom or top; show a “new messages” affordance.
- Re-render, history fetch, tab switching, close/reopen, and streaming completion MUST NOT reset scroll to the top.
- Avoid unmounting/recreating the message DOM for every update; update by stable message ID or restore scroll anchors after a necessary rebuild.

### 5.3 Submission and persistence

- User sends ordinary questions and executable instructions through the same composer.
- Backend associates message with conversation, records the user turn, and creates a task with an ID.
- Frontend observes active task until terminal event and renders authoritative final assistant response exactly once.
- Thread reopen restores message history and active task state; refresh/reconnect must not double-submit.
- Context building includes bounded recent messages, active-task state, relevant confirmed memories, and citations/references to previous work.

### 5.4 Streaming

Hermes CLI produces `--format stream-json` events including `type: "text"`, `tool_use`, `tool_result`, `system`, `result` (verified in VM diagnostic). The adapter MUST forward text deltas as task-scoped events, preserving order and without rebuffering until completion. The chat MUST append to one in-progress assistant bubble. Final `result` replaces/reconciles provisional text, not duplicates it.

Requirements:
- `hermes.text` includes `task_id`, `event.sequence`, and `payload.text` delta.
- Reconnect with `after=last_seen_sequence`; reconcile gaps using persisted final result.
- Large tool payloads should be summarized in chat and available in detailed evidence view.
- Task may finish with no text stream; final answer retrieval remains a fallback.
- No pseudo-typing or fabricated stream chunks.

### 5.5 Editing, regenerations and branches

- User edits create linked revisions, preserving the original turn and timestamp.
- Assistant-message edits are **user-authored corrections**, never a silent rewrite of the historical Hermes response.
- Rerun uses context as of the selected revision/branch; later original-branch turns must not leak in.
- Each rerun gets a new task/attempt ID, linked to the revised message and branch.
- When earlier attempts had side effects, the UI must explicitly ask what to rerun and disclose known effects.
- Show revision history and branch selection; provide clear provenance for generated responses.

### 5.6 Stop, pause, resume and redirect

**Truthful controls are mandatory.** The runtime must expose actual process handling before UI displays a functional Pause.

- **Stop** sends a supported cancellation to active SSH/CLI execution, waits for termination acknowledgment, and persists `stopped` with partial output and reason.
- **Pause** is shown only if the adapter supports safe suspension (and resumes same process state). Otherwise offer **Stop & revise**.
- **Resume** may resume a suspended execution only when supported; restarting is a new task attempt with explicit semantics.
- **Redirect** either sends a supported runtime intervention or queues instructions for a controlled stop/restart.
- Controls must disable conflicting submissions until release/termination is confirmed.
- Cancellation failure must be visible and recoverable; do not mark task stopped while process still runs.

---

## 6. Hermes World — visual state machine

### 6.1 Purpose and composition

Hermes World is a visual projection of the agent's **real activities**, with a world grid, Hermes character, room/station interactions, status banner, and operations tabs. It exists to make task state understandable at a glance, not replace task evidence.

### 6.2 World stations

| Station | Intended meaning | Example triggering evidence |
|---|---|---|
| Control | Waiting, accepting, planning or choosing goals | Goal selected, queued, policy approved |
| Library | Reading documentation, querying knowledge, researching | File read, research/search tool, source ingestion |
| Workshop | Writing code, builds and modifications | Code edit, patch, compilation, tool execution |
| Laboratory | Tests, validation, comparisons | Test runner, benchmark, validation result |
| Archive | Saving outcomes, reflecting, maintaining memory | Final result persisted, memory review, record update |
| Rest | No active executable work | No current task, idle scheduler |

If an event doesn't justify a station change, leave position unchanged. Do not infer hidden activity.

### 6.3 Layout and rendering

- World is immediately visible near top of desktop viewport, not pushed below operation logs.
- Use viewport-bounded layout; operations tabs scroll independently.
- Render text as crisp HTML or at appropriate device-pixel resolution; scale pixel art intentionally, without blurring labels.
- World grid should meaningfully occupy the available region and retain layout across tab switches.
- Evidence and full response belong in an **Evidence** operations tab, not a permanent duplicate panel beneath chat.
- World and chat must remain usable simultaneously without obscuring critical controls.

### 6.4 Live activity banner

- Display *observable* task steps: task title, actual tool name, bounded safe arguments, status or a short user-facing progress summary.
- Show streamed response excerpts only when real `hermes.text` data is available; label it as generating response, not thinking.
- Use stable task IDs to avoid mixing concurrent/replayed events.
- Generic fallback status allowed only when no richer event exists.
- Status must be time-consistent; terminal events replace an in-progress banner and should not be immediately overwritten by stale replay.

---

## 7. Tasks, goals and execution

### 7.1 Task states

```text
created → queued → running → completed
                     ├────────→ failed
                     └────────→ stopping → stopped
queued ───────────────────────→ cancelled
```

Implementation may use `pending` aliases temporarily, but all API/UI code must normalize to one canonical state list. Invalid transitions return conflict errors with explanation. Each transition records timestamp, actor, source and sequenced event.

### 7.2 Task execution contract

1. Validate input and authorization.
2. Reserve execution lease atomically.
3. Persist task and any user turn before execution.
4. Resolve relevant context/knowledge; record sources included.
5. Launch configured Hermes CLI in isolated VM.
6. Emit real tool/text/system events, bounded and sequenced.
7. Persist authoritative result, evidence, error and session ID.
8. Complete corresponding goal/workflow transition.
9. Release execution lease, even on error/cancellation.
10. Trigger post-run memory extraction as a **separate, failure-isolated step**; memory failure MUST NOT retroactively fail successful task.

### 7.3 Goals

- A goal expresses a measurable outcome, not a vague desire to “explore” or “think.”
- A goal includes `title`, scope, rationale, priority, source, acceptance criteria, execution boundaries, state and linked attempts.
- Distinguish **goal selection**, **goal execution**, and **goal verification**.
- A finished attempt does not mean a goal is complete unless acceptance criteria hold.
- Scheduled goals should be idempotent and recoverable after backend restart.

### 7.4 Outcome requirements

Each completed task records: objective, actual actions/tools, relevant observed evidence, final answer, artifacts, test commands/results (if relevant), deviation from plan, errors/unknowns and links to next steps. A failed task records failure stage and whether any side effects occurred.

---

## 8. Autonomous discovery, formulation, investigation, build

### 8.1 High-level lifecycle

```text
scan → identify → deduplicate → triage → formulate → approve
  → investigate (read-only) → evidence-based plan → approve
  → isolated candidate implementation → baseline/test → evaluate
  → accept / reject / revise → record learning → next eligible item
```

### 8.2 Discovery

- Scan only approved VM project roots and supported sources.
- Findings must reference project, path, evidence location, marker content, stable fingerprint and scan timestamp.
- Stable fingerprint should use **canonical project + canonical path + normalized issue content**; line number is evidence, not primary identity.
- Exact and semantically equivalent markers must be merged or linked; never spawn duplicate investigation goals because a TODO shifted by one line.
- Track lifecycle: `proposed`, `approved`, `deferred`, `dismissed`, `investigating`, `resolved`, `stale` (or normalized equivalents).
- Do not repeatedly propose resolved/dismissed unchanged findings; reopen only on material source changes or explicit user action.
- Report scan `found`, `new`, `existing`, `changed`, `suppressed`, errors and last successful time.
- Discovery must consider *usefulness*, not simply number of TODO tags. Avoid repeatedly selecting a trivial fixture issue when higher-value work is available.

### 8.3 Decision engine

- Scheduled discovery must expose enabled/paused state, interval, last success, last failure, selected candidate and reason.
- It must select only eligible candidates, honor deferrals, avoid thrashing and use fair prioritization.
- A scheduler must not claim “active autonomy” merely because periodic scans run; progress requires state transitions or documented no-work reason.
- User must be able to enable/pause decision scheduling and trigger one scan with immediate visible feedback.

### 8.4 Formulation

- Convert a discovery into a bounded, actionable proposed goal.
- Formulation should include concrete issue definition, evidence, rationale, proposed action, constraints, reproducible acceptance criteria and scope.
- State transitions must require explicit approval when the next stage changes files or executes unsafe code.
- UI must show success and backend errors in the same panel; no silent clicks.

### 8.5 Read-only investigation

- Inspect files and state; do not modify source or install packages.
- Produce source-referenced facts, root-cause hypotheses clearly labeled, unknowns, implementation plan and verification criteria.
- A claim of reproducibility requires executed reproduction evidence; otherwise label as proposed reproduction.
- Existing findings with completed equivalent investigation should link to that report instead of rerunning.

### 8.6 Build / isolated candidate implementation

- Only work from an approved plan with explicit project scope.
- Maintain original, baseline and candidate workspaces distinctly in VM.
- Capture baseline results before changes; implement candidate only; run matching validation; compare outcomes.
- Produce artifact paths, diff/commit identifiers when applicable, test stdout/stderr/exit codes, failure reason and recommendation.
- Never auto-merge candidate into original or publish externally without approval.
- Resume/retry must not corrupt original workspaces or treat partially executed runs as complete.

### 8.7 Workflow UI

Every Discover/Planning/Build control must: (a) explain the action, (b) request correct backend endpoint, (c) show immediate pending state, (d) display response/error with record ID, (e) refresh related records, (f) expose next valid action. If no eligible plans exist, show exact prerequisite rather than inert button.

---

## 9. Knowledge Library and directed learning

### 9.1 Source registration

- Sources store original URI/path, title, checksum, page/section count, indexed count, extraction method, timestamp and provenance.
- Unsearchable/blank pages may be indexed as extraction gaps, not silently omitted from total coverage.
- Source lookup and citation must identify exact PDF page (not printed page) when relevant.

### 9.2 Study-unit planner

- Units must cover source content without gaps or overlap, unless intentional and documented.
- Prefer verified chapter boundaries; when detection is ambiguous, use bounded page ranges rather than misleading chapter labels.
- Each unit stores source_id, page range, index, goal_id, completion state, evidence locations and attempt history.
- Manifest must be durable, validated and not rebuilt over active goals.

### 9.3 Automatic progression

- Exactly one current unit/goal per source, unless user explicitly authorizes parallel study.
- Reconcile actual goal state from backend before advancing.
- After verified completion, queue next unit once; on failure, stop progression and report blocker.
- Recover from process/backend restarts; a periodic systemd timer is an acceptable initial driver if it uses locks and idempotent enqueue logic.
- Study status must distinguish queued, running, completed, failed, blocked and not_queued.
- Study should not monopolize all execution capacity indefinitely; scheduled work must coexist with interactive user requests.

### 9.4 Unit deliverables and acceptance

Each unit MUST have (1) notes with source page references, (2) runnable verification examples where applicable, (3) captured execution evidence, (4) clearly separated document-sourced vs execution-verified claims, and (5) outstanding questions/limitations. The last unit's completion must trigger final study coverage report and artifact index.

### 9.5 Current handbook baseline

The known source contains **61 PDF pages, 60 searchable pages**, partitioned into **13 units**: Preface 1–3; then 4–8, 9–13, …, 59–61. Last observed status: units 1–2 completed, 3 queued; systemd user timer enabled for `enqueue-next`. Later progress needs fresh verification. A goal's `completed` status does not alone prove reports/check scripts exist.

---

## 10. Conversations, long-term memory and Obsidian

### 10.1 Four distinct storage classes

| Class | Contains | Source of truth | Retrieval policy |
|---|---|---|---|
| Conversation history | Exact turns, timestamps, revisions and task links | SQLite; mirrored Markdown | Current thread, or relevant excerpts with clear source |
| Durable user/project memory | Preferences, decisions, corrections, workflows and project context | SQLite active/review/superseded states | Only relevant active approved records |
| Technical lessons | Evidence-backed tool and implementation findings | Existing technical memory store | Relevant, confidence-aware, traceable lessons |
| Knowledge sources | PDF/doc excerpts with page identifiers | Knowledge Library index | Topic-relevant cited excerpts |

### 10.2 Extraction and provenance

After a task finishes, analyze the last eligible user input and **verified task outcome** for durable candidates. Implicit preferences may be inferred only when supported by repeated or clearly corrective user behavior; never treat a single hypothetical as a stable preference. Candidate schema SHOULD include:

```json
{
  "kind": "preference|decision|project|correction|workflow|lesson",
  "statement": "standalone durable assertion",
  "source_conversation_id": "...",
  "source_turn_id": 42,
  "source_task_id": "...",
  "verbatim_evidence": "short exact supporting quote",
  "relation": "new|equivalent|contradiction|uncertain",
  "related_memory_ids": [],
  "validation": "proposed|verified|rejected|needs_review"
}
```

- Candidate validation must report counts, rejection reasons, and whether it was stored/queued for review.
- A completed extractor that stores zero memories is legitimate **only when its reason is inspectable** (e.g., no durable claims, duplicate, invalid evidence).
- Extraction errors must be reported as events and recorded independently; the originating task remains completed.
- Model-generated analysis cannot self-approve uncertain claims, claim tests ran, or override source-of-truth data.

### 10.3 Equivalence and contradiction

- Normalize text and compare semantics with existing active memories.
- **Equivalent:** consolidate provenance and mention count; do not create duplicate standalone memories.
- **Contradiction:** keep both claims and evidence, flag review, exclude ambiguous fact from confident recall until resolved.
- **Supersession:** approved correction marks old entry superseded; retain history and old Obsidian note with visible status.
- **Uncertain:** queue review; no silent override.
- Reviews need accept/reject/merge/supersede actions with actor, rationale, evidence and timestamp.
- Similarity scores alone are insufficient proof that two facts are semantically identical.

### 10.4 Transcript retrieval

- Current conversation: recent full turns plus bounded active-task context.
- Other conversations: retrieve **relevant excerpts** via search/index, with conversation_id, turn_id and date; favor project/topic/explicit references.
- Summaries of lengthy prior work must link to source transcript spans and concrete artifacts.
- Corrected or superseded turns must not be passed as current instructions; preserve only historical context with annotation.
- Retrieval must be budgeted (token limits, rank and relevance), deduplicated and inspectable.
- “Relevant memory retrieved” should be visible in task evidence (references, not necessarily full private text).

### 10.5 Obsidian directory contract

```text
/home/gayzer/black/obsidian/hermes/
└── Hermes-Life/
    ├── Conversations/       # transcripts (mirrors, source IDs)
    ├── Memory/
    │   ├── Auto/
    │   │   ├── Preferences/
    │   │   ├── Decisions/
    │   │   ├── Projects/
    │   │   ├── Corrections/
    │   │   └── Workflows/
    │   └── Curated/          # user-edited canonical notes
    ├── Projects/             # project reference and decisions
    ├── Study/                # study coverage and artifact links
    └── Reviews/              # optional review exports
```

Paths above are **intended organization**, not proof all folders currently exist. Never overwrite user-edited curated notes, and detect conflicts between manual edits and stored records. Mirroring failures must be visible but must not erase SQLite records.

### 10.6 Persona vs acquired memory

A fixed user-chosen persona is a separate configuration layer. Personality does not authorize invention of facts, nor does it replace user preferences, runtime evidence or task context. Changes to persona require explicit user instruction; memory extraction must not silently mutate it.

---

## 11. Event streaming, observability and recovery

### 11.1 Event envelope

```json
{
  "id": "uuid",
  "sequence": 1001,
  "timestamp": "2026-11-02T10:00:00Z",
  "task_id": "uuid-or-null",
  "conversation_id": "uuid-or-null",
  "goal_id": "uuid-or-null",
  "type": "hermes.text",
  "payload": {"text": "incremental delta"}
}
```

Current events may lack some optional fields; the above is the desired normalized envelope.

### 11.2 Event types

Required families: `task.*`, `goal.*`, `discovery.*`, `formulation.*`, `investigation.*`, `implementation.*`, `hermes.system`, `hermes.text`, `hermes.tool_use`, `hermes.tool_result`, `hermes.result`, `memory.*`, `study.*`, `autonomy.*`.

- Event payload schemas must be versioned and documented.
- UI must not assume every tool has the same argument shape.
- Avoid replay storms: initial history fetch may be paginated, and WebSocket cursor should start at the last known sequence.
- Tool result payloads should be bounded/redacted in UI; complete evidence may be stored separately with secure references.
- UI should display exact failure reason for API 4xx/5xx, not silently swallow it.

### 11.3 Recovery behavior

- Backend restart reconciles orphaned `running` tasks with actual VM processes. Don't mark them completed without evidence.
- Interrupted attempts should become explicit `interrupted`/`failed` or require manual recovery, based on verified runtime state.
- New frontend connections fetch current task and event cursor, then replay missing events exactly once.
- Schedulers reconcile existing goal records before enqueueing; periodic retry is idempotent.
- Outage of VM/SSH/API/Obsidian should degrade the specific subsystem, not corrupt unrelated task/memory state.

### 11.4 Operational diagnostics

Expose health for API, scheduler enabled state, active lease/task, configured transport, VM reachability, event lag, memory-extraction outcomes, vault write/read health and study progression. Use structured event logs with correlation IDs. Each UI error links to a diagnosis code and relevant task/operation ID.

---

## 12. API behavior contracts

**Existing observed route families** (precise payloads and response shapes must be checked against running OpenAPI before implementation):

| Route | Intent |
|---|---|
| `POST /api/tasks` and `GET /api/tasks/{id}` | Submit and inspect Hermes tasks |
| `GET /api/goals`, `POST /api/goals` | Goal list and creation |
| `GET /api/events`, `WS /ws/events` | Sequenced event history and live updates |
| `GET /api/conversations`, `GET /api/conversations/{id}` | Thread list and turns |
| `GET/POST /api/memories` | Durable memory list and explicit save |
| `GET /api/memory-reviews`, `POST /api/memory-reviews/{id}/resolve` | Review and resolution |
| `GET /api/discoveries`, `POST /api/discoveries/scan`, `POST /api/discoveries/{id}/{action}` | Discovery operations |
| `GET/PUT /api/decisions`, `POST /api/decisions/scan` | Discovery decision scheduling |
| `GET /api/curiosity`, `POST /api/curiosity/{id}/{state}` | Research questions |
| `GET /api/formulations`, `POST /api/formulations/from-discovery/{id}` | Proposed goal formulation |
| `GET /api/investigation-plans` and plan-creation endpoints | Investigation outputs |
| `GET /api/implementations`, `POST /api/implementations/from-plan/{id}` | Candidate build/evaluation |

**API requirements:**
- Success with `200`/`201`/`202` must return machine-readable body with stable ID and actual state.
- `409 Conflict` must identify conflicting active task/lease or invalid state transition.
- `422` must identify rejected field and condition.
- Long-running operations return IDs immediately; UI polls/subscribes to real events.
- Response envelopes must be consistent or frontend adapters explicitly normalize documented variants.
- A nonexistent endpoint should not be included in instructions or health checks; `/api/autonomy/state` was observed returning 404 and must not be assumed to exist.
- Routes that alter data must be authenticated/authorized appropriately before any non-local deployment.

---

## 13. Quality requirements and acceptance criteria

### 13.1 Functional acceptance scenarios

**CHAT-01 — Persistent multi-turn:** send two dependent prompts; second resolves references to first. Close/reopen; transcript identical; no duplicate tasks.

**CHAT-02 — Scroll:** 50-message thread, open at latest; scrolling up during new output keeps reader position; returning to bottom resumes live following; completion never jumps to top.

**CHAT-03 — Streaming:** CLI emits multiple text chunks; WebSocket sends matching sequenced `hermes.text` deltas before `task.completed`; one bubble updates incrementally; final result stored once.

**CHAT-04 — Revisions:** edit old user turn → new branch and task; original result preserved, branch's context excludes incompatible downstream turns. Editing Hermes text is recorded as user correction.

**EXEC-01 — Stop:** terminate known active process through real adapter, verify exit, persist stopped state and partial output, release lease; no phantom running task.

**WORLD-01 — Truthful projection:** tool event drives appropriate room and named activity; no event means no invented “thinking.” World remains visible when switching tabs.

**DISC-01 — Stable deduplication:** duplicate TODO content on lines 2 and 3 yields one actionable discovery; rescanning unchanged source produces zero new proposals.

**DISC-02 — No activity loop:** completed/dismissed unchanged discovery not resubmitted on each scan; last-scan counters explain suppression.

**FLOW-01 — End-to-end workflow:** accepted discovery → formulation → investigation → approved plan → isolated candidate → tests → evaluation; all IDs and statuses linked; invalid transitions clearly rejected.

**FLOW-02 — Button response:** every click visibly changes pending/result/error state and links to resulting record within bounded time.

**STUDY-01 — Full coverage:** 61 pages covered exactly once by 13 planned units; only one active unit; successful completion auto-enqueues next without duplicates.

**STUDY-02 — Actual evidence:** completed unit has report + executed checks/log or an explicit reason example execution wasn't applicable; page citations correct.

**MEM-01 — Explicit preference:** user preference stored with verbatim evidence, provenance and active status; new conversation retrieves it when relevant.

**MEM-02 — Implicit preference:** repeated unambiguous corrections produce a proposed preference, never an unsupported fact; extraction report shows outcome.

**MEM-03 — Duplicate consolidation:** paraphrased existing preference does not become a separate conflicting record; sources are combined.

**MEM-04 — Contradiction:** new opposite preference creates review; old memory is not silently removed; approved resolution supersedes and excludes old from active recall.

**MEM-05 — Transcript:** cite the correct earlier conversation and turn when asked to continue prior work; revisions are respected.

**REC-01 — Restart:** restart backend mid-task and reconnect browser; actual process state is reconciled; events and results not duplicated.

**SEC-01 — Isolation:** execution occurs as VM user `hermes`; host files unchanged absent explicit authorized host operation.

### 13.2 Testing tiers

1. **Unit tests:** state transitions, dedup keys, context selection, parsers, memory validator, scroll anchoring helpers.
2. **Contract tests:** REST payloads/statuses, event ordering, database migrations, wrappers forwarding callbacks.
3. **Integration tests:** real backend + test adapter + SQLite temporary DB, frontend mocked API/event stream.
4. **End-to-end tests:** connected VM Hermes CLI, real WebSocket, chat + world + workflows, source study artifacts.
5. **Failure tests:** VM offline, SSH timeout, 409 conflict, malformed model JSON, vault read-only, WebSocket reconnect, user cancellation, backend restart.
6. **Regression tests:** previous phase functionality survives each new patch (chat revisions, memory, world Evidence tab, handbook scheduler).

### 13.3 Definition of done

A feature is done only when code and migrations are installed, automated tests pass, at least one representative end-to-end scenario is observed, errors/recovery are covered, docs updated, and acceptance evidence is linked. A syntactically valid installer or successful ZIP extraction is **not** completion proof.

---

## 14. Engineering and implementation conventions

- Prefer small, reversible changes to existing services; avoid speculative rewrites or duplicate adapters.
- Read current source and schema before patching. Patch installers must be **idempotent**, version-aware and stop before writing on incompatible signatures.
- Preserve repository modifications, user data and existing vault notes. Back up modified files and maintain migration/rollback notes.
- Use temporary test databases rather than operating on live SQLite for destructive tests.
- Never patch by broad brittle string replacement without verifying exact target and post-install compilation/build.
- Backend Python version and frontend Node/Vite versions must be checked against actual environment, not assumed from old patches.
- Prefer explicit typed frontend models and typed backend response contracts; minimize sprawling DOM string templates.
- Keep state mutation behind services; avoid handlers with hidden cascading side effects.
- Add observability whenever an operation may legitimately return `0 stored`, `0 new`, `no work` or `409`.
- Track schema changes and forward/backward compatibility.

---

## 15. Current implementation baseline and known gaps

**This table is an observation ledger (last available evidence), not part of normative future behavior.** Refresh as tests are completed.

| Subsystem | Last supported state | Outstanding gap / verification |
|---|---|---|
| VM execution | Real Hermes CLI via SSH demonstrated; CLI emits `stream-json` text deltas | Runtime interruption/recovery; latest stream end-to-end verification |
| API/tasks/events | FastAPI, SQLite tasks/events, `/ws/events`, goal scheduler exist | Normalized event schema, replay scaling, cancellation |
| Conversation chat | Styled floating chat, multi-turn history, edit-linked revisions, memory action | Scroll regression patch not verified; branches and safe stop missing |
| World | Interactive stations, operation tabs, Evidence tab, larger scene/live activity | Real detailed progress and crisp consistent rendering need verification |
| Discovery | Source scans TODO/FIXME markers; button handlers and endpoints present | Fingerprint includes line; repeated findings; no meaningful-work prioritization |
| Decisions/planning | API and UI handlers registered | End-to-end transitions and clicked-button outcomes not established |
| Implementation | Isolated candidate/testing engine and endpoints exist | Approved-plan availability and full build handoff not verified |
| Handbook | 61 pages; 13 units; first 2 completed, third queued at last check | Timer enabled but continued automatic progress and unit artifacts unverified |
| Conversation memory | SQLite turns and Obsidian transcript mirroring implemented | Rich transcript-aware retrieval and branch correctness need tests |
| Semantic memory | Model can produce valid preference candidate; extraction/review store present | Former `0 stored`; Phase 4.10.2 diagnostics unverified after installation |
| Technical memory | Evidence-backed lessons, confidence and conflict review previously developed | Verify current deployment and integration with new memory system |
| Autonomy | Scheduler/decision loops exist | Repetitive scans, eligibility, recovery, advancement, truthful status |

### 15.1 Known high-priority defects

- **HL-BUG-001:** Stable discovery deduplication fails when same issue appears on different line numbers.
- **HL-BUG-002:** Discover/Planning/Build workflow controls reported nonfunctional/stagnant despite bound event handlers; API state and error visibility need verification.
- **HL-BUG-003:** Autonomous discovery spends time on repeated low-value test TODOs rather than meaningful progress.
- **HL-BUG-004:** Chat scroll resets or jumps after response in previously observed build; later corrective patch unverified.
- **HL-BUG-005:** Semantic extraction previously completed with `0 stored` for a valid explicit preference without explanation; diagnostics patch exists but not verified.
- **HL-BUG-006:** Full streaming pipeline produced zero `hermes.text` in one pre-restart test; later live behavior unverified.

### 15.2 Missing/partial features

- Robust cancellation, pause/resume only when supported, user redirection.
- Genuine conversation branches with side-effect-aware reruns.
- Semantic cross-thread transcript search and consolidation, reliable contradiction review.
- Verified automatic goal/workflow handoffs and stable discovery lifecycle.
- Full study automatic continuation, artifacts and visible study-dashboard progress.
- Connection/replay/restart guarantees and structured diagnostics for every operation.

---

## 16. Recommended development sequence / dependency map

### Milestone A — Workflow recovery (P0)

1. Verify current `/api/autonomy`, `/api/discoveries`, `/api/decisions`, `/api/formulations`, `/api/investigation-plans`, `/api/implementations` states and frontend responses.
2. Normalize and migrate discovery fingerprints; preserve existing IDs/links and reconcile duplicates.
3. Make lifecycle transitions explicit with meaningful user feedback and “no eligible work” reasons.
4. Run real Discover → Formulate → Investigate → Candidate → Evaluate test on isolated fixture project.
5. Ensure scheduler doesn't revisit stale/resolved unchanged findings.

### Milestone B — Scheduler and handbook (P1)

1. Verify user timer and goal scheduler enabled; reconcile active Unit 3.
2. Test auto-advance and crash/idempotent restart; don't duplicate unit goals.
3. Validate study artifact existence/evidence before marking source fully learned.
4. Add dashboard study progress with blockers and evidence links.

### Milestone C — Chat execution integrity (P1)

1. Verify `hermes.text` full pipeline in one new task.
2. Fix scroll anchoring definitively with browser tests.
3. Implement real Stop & Revise, then supported Pause/Resume if available.
4. Implement revision-aware branches and side-effect protection.

### Milestone D — Memory and knowledge reliability (P1)

1. Verify extraction diagnostics and create controlled explicit/implicit/duplicate/contradiction cases.
2. Consolidate equivalent memories and provenance; correct supersession behavior.
3. Index/retrieve relevant historical transcript passages and cite their turn IDs.
4. Reconcile Obsidian mirrors and human-edited curated notes.
5. Run end-to-end “new conversation recalls correction from previous task” test.

### Milestone E — Product polish (P2)

Improve accessibility, live world projection, dashboard rendering, status/error clarity and observability without breaking existing workflows.

---

## 17. Canonical development-goal format

Every goal derived from this specification MUST be testable, narrowly scoped and evidence-linked. Avoid redundant “read everything” instructions when task context and code evidence are already provided.

```markdown
# HL-GOAL-XXXX — <specific behavior/outcome>

## Specification references
- HL-SOT-001 §<sections>; acceptance scenario <ID>

## Classification
- Type: bug | missing feature | integration | refinement | test
- Priority: P0 | P1 | P2
- Status: proposed | approved | in_progress | blocked | validated

## Problem and observed evidence
- Current behavior: <what actually happens>
- Evidence: <code path, API result, event, screenshot, reproduction>
- Root cause: <confirmed cause or explicitly labeled hypothesis>

## Required behavior
- <exact observable before/after state and constraints>

## Scope
- Change: <target files/modules/services>
- Preserve: <other working behavior, data, security boundary>
- Out of scope: <deliberately excluded features>

## Implementation contract
1. <small concrete change>
2. <migration/state/transport consideration>
3. <observability and recovery behavior>

## Acceptance criteria
- Given <initial conditions>, when <action>, then <measured outcome>.
- Given <failure/restart>, when <recovery>, then <safe behavior>.
- Existing <regression> still passes.

## Verification
- Tests/commands to execute: <exact steps>
- Evidence to preserve: <results/log/IDs/artifacts>
- No claims of success without observed passing results.

## Delivery
- Diff summary, tests and outputs, limitations, outstanding issues.
```

### 17.1 Example goal — deduplicate discoveries

**HL-GOAL-0001 — Stable discovery identity across line changes**  
Refs: §8.2, §13 DISC-01, HL-BUG-001.  
Observed: fingerprint uses `(project, file, line, note)` and thus treats duplicate TODOs at different lines as distinct findings.  
Required: canonical fingerprint independent of line for equivalent issue content, preserve line evidence; reconcile old duplicates without losing linked goal/history; scans unchanged source yield zero new findings.  
Verify: fixture containing same TODO at lines 2 and 3; scan twice; assert one actionable record, zero new on second scan; existing approved record retained.  
Out of scope: redesigning the entire autonomy scheduler.

### 17.2 Example goal — real chat response follow

**HL-GOAL-0002 — Anchor chat scroll on streaming and history reload**  
Refs: §5.2, §13 CHAT-02, HL-BUG-004.  
Observed: renderer clears and reconstructs message elements, causing scroll reset.  
Required: stay at latest on open; follow when reader near bottom; preserve historical reading position while scrolled up; no jumps during completion, redraw or reconnect.  
Verify: browser test with 50 turns, live delta input, close/reopen and completion; demonstrate no scroll jump.  
Out of scope: backend token format changes.

---

## 18. Change control, review and decision log

### 18.1 Review procedure

For each change:

1. Name the section(s) and acceptance ID(s) affected.
2. Identify whether it changes intent, implementation detail, or observed status.
3. Record compatibility implications for schema, VM, chat, scheduler, memory and Obsidian.
4. Update the requirements/acceptance criteria and version notes.
5. Preserve a decision record for deviations, including what was intentionally deferred.

### 18.2 Decision record template

```markdown
# HL-ADR-XXXX — <decision>
Date: YYYY-MM-DD
Status: proposed | accepted | superseded
Context: <evidence and constraints>
Decision: <chosen behavior>
Alternatives: <rejected options and why>
Consequences: <migration/recovery/testing>
Affected spec: HL-SOT-001 §...
```

### 18.3 Version history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-11-02 | Consolidated intended behavior, architecture, contracts, workflows, memory, chat, world, study, acceptance tests, known gaps and development-goal format from project history and available patch/source evidence. |

---

## 19. Final product acceptance gate

Hermes Life is considered product-complete only when a user can:

1. Open chat and have a continuous multi-turn conversation connected to the **real Hermes agent**.
2. Submit a task, observe actual tool events and response deltas, stop safely when supported, and receive an evidence-backed result.
3. Reopen a historical conversation, edit/revise without corrupting prior branches, and continue with relevant context.
4. Watch a truthful, crisp Hermes World representation of current real activity and use fully functioning operation tabs.
5. Run an autonomous discovery-to-evaluation workflow that progresses on meaningful work and does not repeat unchanged findings.
6. Register a document, have Hermes study all units automatically with cited and tested outputs, and retrieve the resulting validated knowledge.
7. See relevant preferences, decisions, prior task results and transcript excerpts recalled across conversations, with contradictions and superseded facts handled transparently.
8. Restart backend/frontend, recover interrupted state correctly, and avoid duplicated or silently retried side effects.
9. Audit each claimed outcome back to a stored task, action, verification record and acceptance criterion.

**Build toward these behaviors, not toward a patch count, a busy animation, or a growing number of speculative features.**
