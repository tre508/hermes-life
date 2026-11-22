# HERMES LIFE — UNIFIED WORKSPACE UI DEVELOPMENT SPECIFICATION

**Document ID:** HL-UX-001  
**Status:** Implementation-ready target design  
**Scope:** Hermesha Command Centre — Chat, Work, operational workspaces, navigation, context, and execution visibility  
**Requirements:** HL-CONV-001 · HL-WORK-001  
**Type:** Forward-looking UI/UX and application architecture specification; **not a repository audit**

---

## 1. Product objective

Transform Hermesha Command Centre into one cohesive operational interface for communicating with Hermes, directing work, observing autonomous activity, reviewing proposed changes, and managing projects from discovery through delivery.

The user must always be able to answer five questions without hunting across panels:

1. **What is Hermes working on?**
2. **Why is this work happening, and which project or goal owns it?**
3. **What has actually happened, with evidence?**
4. **What requires my decision?**
5. **What can I do next?**

The application must support both user-directed tasks and independently initiated autonomous development, including projects Hermes creates from scratch. Conversations and work items are related, but not interchangeable.

### Experience principles

- **One conversation system.** All messaging uses the same canonical conversation/thread model. Task details never create an independent duplicate chat.
- **One work graph.** Projects, discoveries, goals, plans, tasks, build runs, and results are linked entities rather than disconnected dashboards.
- **One contextual inspector.** The right panel shows information and actions for the object selected in the current workspace.
- **Live, truthful execution.** Display actual public Hermes text, tool calls, tool results, status, and persisted outcomes. Never manufacture intermediate actions or private reasoning.
- **Actionable density.** Present real records and decisions ahead of decorative counters, empty containers, and technical controls.
- **Navigation without interruption.** Switching views, projects, or conversations does not cancel unrelated execution or lose draft text.
- **Explicit authority.** Distinguish suggested work, permission to proceed, tested candidates, and changes actually applied.

## 2. Scope and deliverables

**Included:** Information architecture, application shell, unified Chat, Task Board workspaces (Tasks, Discover, Goals, Planning, Build, Projects), Context Inspector, Activity/Results integration, screen behaviors, domain contracts, live event architecture, state management, accessibility, responsive layouts, delivery increments, and acceptance scenarios.

**Preserved product surfaces:** The 3D World/rooms, Memory, Knowledge Deck, Results, Activity, and existing Hermes execution/VM isolation concepts remain part of Hermes Life. This specification defines how they connect to the unified work experience; it does not replace their specialized functionality.

**Not part of this document:** A retrospective code audit, existing-file-by-existing-file comparison, speculative bug diagnosis, or a mandate to replace functional backend services solely for visual consistency.

## 3. Information architecture

### 3.1 Primary navigation

```text
HERMESHA COMMAND CENTRE
├── World              Live spatial view of Hermes and resident activities
├── Work               Unified workspace with six contextual views
│   ├── Tasks          Queue, active execution, blockers, work history
│   ├── Discover       Findings, questions, opportunity triage
│   ├── Goals          Outcomes, progress, dependencies, priorities
│   ├── Planning       Proposed plans, milestones, approval decisions
│   ├── Build          Candidate development, tests, review, apply
│   └── Projects       Registered projects, autonomous initiatives, proposals
├── Chat               Full conversation workspace
├── Memory             Persistent knowledge, provenance, retrieval
├── Knowledge Deck     Curated, navigable knowledge and related artifacts
├── Results            Final deliverables and outcome evidence
└── Activity           Searchable chronological runtime events
```

**Naming:** Use **Work** as the primary navigation label; retain **Task Board** only as a transitional alias if compatibility requires it. Preserve existing deep links until migration is complete.

**Chat access:** Chat is available as both a full-page destination and a collapsible, resizable side drawer. Both display the *same* conversation data and state.

### 3.2 Application shell

```text
┌───────────────────────────────────────────────────────────────────────────────┐
│ Brand / Hermesha Command Centre   Global project ▾  Active work   Sync / Chat│
├───────────────┬────────────────────────────────────────┬──────────────────────┤
│ Primary nav   │ Workspace title + purpose              │ Context Inspector    │
│ World         │ [scope] [search] [filters] [primary CTA]│ Selected entity      │
│ Work          │────────────────────────────────────────│ Status & ownership   │
│ Chat          │ Workspace-specific real records        │ Links & evidence     │
│ Goals*        │                                        │ Context actions      │
│ Memory        │                                        │                      │
│ Knowledge     │                                        │                      │
│ Results       │                                        │                      │
│ Activity      │                                        │                      │
├───────────────┴────────────────────────────────────────┴──────────────────────┤
│ Optional live execution dock: current task · step · progress · Open activity │
└───────────────────────────────────────────────────────────────────────────────┘
```

`*` Existing global Goals navigation may deep-link to Work > Goals rather than creating a second goals implementation. The same applies to overlapping routes.

**Persistent shell rules:**

- Top bar displays connection/backend state, active project scope, pending decisions count, and a Chat entry point.
- Workspace toolbar displays only controls relevant to that workspace.
- Context Inspector is **selection-driven**, not a stale global task preview.
- Chat drawer overlays or resizes the workspace by user choice; its conversation selection is preserved when switching views.
- A compact, optional execution dock surfaces current work without monopolizing the screen. Clicking it opens the relevant task or Activity trace.
- Any count is computed from the same filtered dataset shown in the workspace, with its scope clear.

## 4. Interaction model and navigation rules

### 4.1 Selection

Selection is a typed reference:

`Selection = { kind: 'task' | 'discovery' | 'goal' | 'plan' | 'build' | 'project' | 'result', id: string } | null`

A selection belongs to a workspace instance. Each Work subview remembers its last valid selection independently. Changing from Tasks to Build must never display a task inspector in Build. When no record is selected, the inspector shows contextual guidance/summary or collapses; it does not borrow an unrelated selection.

### 4.2 Deep links and restoration

Every primary object has a stable route and can be opened directly, refreshed, bookmarked, and navigated backward to:

```text
/work/tasks/:taskId
/work/discover/:discoveryId
/work/goals/:goalId
/work/planning/:planId
/work/build/:runId
/work/projects/:projectId
/chat/:conversationId?focus=:messageId
/results/:resultId
/activity?task=:taskId
```

Routes are **target contracts**, not claims about currently existing backend or frontend paths. Existing query-string routes may remain as compatibility redirects. Browser Back returns to the previous list/filter/scroll position where feasible. Invalid IDs display a recoverable “Record unavailable” state.

### 4.3 Global project context

The global project selector scopes work lists by project when chosen. **All projects** is the default. Task/Chat navigation to a different project must make any project-scope change explicit rather than silently hiding the linked record. Project-specific filters persist independently per view.

### 4.4 Navigation actions

- **Open in Chat:** Select the linked conversation and focus the originating or relevant message; never start a new thread implicitly.
- **View Execution:** Navigate to the exact task/run trace in Activity.
- **Open Project/Goal/Plan:** Navigate to the linked entity and show its contextual inspector.
- **Continue in Chat:** Open or create an explicitly linked conversation, prefilling an optional reference to the selected object; no hidden prompts or automatic execution.
- **Review Candidate:** Open the review surface with test evidence and change diff.
- **Open Results:** Open a persisted result/deliverable associated with the selected item.

## 5. Unified Chat — HL-CONV-001

### 5.1 Chat's responsibilities

Chat is the sole conversational home for questions, commands, clarifications, task follow-up, and review discussion. Conversations contain messages and may refer to one or more tasks; a task may be referenced by multiple messages. A conversation is not itself an execution job.

**Full-page Chat layout:** thread sidebar; scrollable message timeline; optional execution/details rail; composer with project context and task/reference attachments.

**Drawer Chat layout:** compact thread switcher, timeline, composer, and expandable activity details. Same underlying conversation ID and persisted state as full page.

### 5.2 Message rendering

Message types: `user`, `assistant`, `system_notice`, `task_reference`, `result_reference`, `error_notice`. Display public streamed assistant output progressively; coalesce deltas into the correct assistant message by message/stream ID, not by the currently selected task. Render markdown safely and display source/task links as clickable chips.

**Task reference card in chat:** task title, project, live state, last public activity, `Open Task`, `View Execution`, `View Result` when available. Do not dump every tool event into message prose by default; expose a compact expandable execution trace.

### 5.3 Conversation behavior

- Explicit **New Chat** always creates a new conversation; selecting a task never does.
- A composer has a visible selected project and thread. Messages always show where they will be sent.
- Tasks started from a chat message record `origin_conversation_id` and `origin_message_id`.
- Retrying a task creates a **new attempt** linked to the same task or creates a clearly identified successor task; previous history is immutable.
- Switching chats never changes running task ownership or cancels a task.
- Drafts persist per conversation (including drawer/full-page transitions).
- `Stop` targets the explicitly identified running task/attempt, not all tasks in the selected conversation.
- A task with no textual assistant response displays its actual state and any error; never fabricate a reply.
- Provider/auth/billing denial is shown as a failed attempt with exact available diagnostic text and a retry path only after the blocker is addressed.

### 5.4 Autonomous work in Chat

Autonomous tasks may have no originating conversation. Their task details remain fully accessible. **Discuss in Chat** opens a user-visible linked discussion thread for the autonomous work, with a task reference card and links to the original evidence. This does not rewrite autonomous provenance or masquerade as the initiating event.

## 6. Workspaces — HL-WORK-001

### 6.1 Tasks — Execution control

**Purpose:** Track and control individual units of work from submission through outcome.

**Above the fold:** Search, project/status/ownership filters, counts (`Running`, `Needs action`, `Queued`, `Completed`, `Failed`) and one primary **New Task** action. Counts are contextual and clickable.

**Task list:** table/card density toggle. Each row shows title, project, origin (`user`/`autonomous`/`scheduled`), priority, current status, latest event, last update, and next action. Sort by activity by default; keep blocked tasks conspicuous.

**Task detail:** Overview, Timeline, Artifacts, Attempts. Show goal/plan/conversation relationships; exact status; last step; elapsed time; public textual response; source events; output files; errors; attempt history. The Task detail is **not** a separate conversation transcript with its own independent reply editor.

**Actions:** `Open in Chat`/`Discuss in Chat`, `View Execution`, `Retry`, `Pause/Resume` where supported, `Cancel`, `Open Results`. Disabled actions explain why unavailable. Confirmation is required for destructive/irreversible operations.

**Task states:** `queued → running → completed | failed | cancelled`; `blocked` or `paused` where supported. An attempted retry is a distinct execution attempt with its own trace.

### 6.2 Discover — Evidence to decisions

**Purpose:** Identify and triage findings, curiosity questions, and development opportunities.

**Default view:** actionable findings list, not a dashboard of empty metric boxes. Show `Needs review`, `Investigating`, `Converted`, `Dismissed` segments with actual record counts. Filter by source project, category, significance, date, and provenance.

**Discovery card/detail:** clear title, concise finding, linked project/source, evidence references, confidence or evidence quality when supported, suggested follow-up, current disposition, relevant history. A finding may come from automated scans, user input, or autonomous research. A curiosity question is distinguished from a verified finding.

**Actions:** `Investigate`, `Create Goal`, `Draft Plan`, `Link to Project`, `Mark Seen`, `Dismiss`, `View Evidence`. Creating a goal/plan preserves a back-reference to discovery ID. Research tasks are tracked as tasks, not implied to have completed instantly.

**Advanced controls:** Scan VM projects, decision trigger, scheduler/status and technical scanner detail reside in an unobtrusive collapsible **Discovery Operations** section.

### 6.3 Goals — Outcomes and priorities

**Purpose:** Define desired outcomes and measure progress across user-directed and autonomous work.

**Views:** Active, Proposed, Blocked, Achieved, Archived. Optional timeline/board. Each goal includes owner/origin, project, desired outcome, measurable success criteria, priority, child tasks/plans, dependencies, progress based on evidence, and last update.

**Actions:** `Create Goal`, `Approve/Decline Proposal`, `Prioritize`, `Create Plan`, `Open Tasks`, `Pause/Resume` subject to autonomy policy, `Archive`.

**Progress:** Derived from linked milestone or verification evidence where possible; if no measurable evidence exists, show **Not yet measurable**, not an invented percentage.

### 6.4 Planning — Executable proposals

**Purpose:** Turn goals and discoveries into reviewable implementation plans and decisions.

**Plan card/detail:** objective, source finding/goal, affected project, scope, assumptions, milestones, dependencies, proposed verification, resource/worker environment, risks, permission gate, owner, status, and revisions.

**Plan states:** `draft → proposed → approved | rejected`; approved plans can move to `in_progress → completed | blocked | cancelled`, with explicit versioning for major changes.

**Actions:** `Generate Plan`, `Edit`, `Request Revision`, `Approve`, `Reject`, `Start Build`, `Open Linked Tasks`. Planning does not imply files were modified.

**Approval experience:** Show the exact proposed actions, target environment, expected changes, and verification criteria before accepting. Autonomous runs may proceed only within configured authority limits.

### 6.5 Build — Candidate implementation and verification

**Purpose:** Make actual development runs reviewable, testable, and controllable.

**List:** active runs and candidates, with project, plan, worker environment, current phase, test outcome, review status, last update, and next action. Prioritize `Needs review`, `Failed`, and `Running` over historical successes.

**Build run detail stage rail:**

`Prepare → Baseline → Implement → Test → Evaluate → Review → Apply`

The rail describes **recorded** phases, not automatically claimed success. For each phase show timestamp, responsible execution/task, outcome, logs/evidence link, and possible restart/revision action. A failed stage identifies the reason and the latest completed stage.

**Candidate review:** modified files, diff/patch, test summary, observed regressions, Hermes report, verification evidence, target branch/worktree, and authoritative apply/merge destination.

**Actions:** `View Changes`, `View Tests`, `Open Execution`, `Request Revision`, `Approve Candidate`, `Apply Changes` (only when separately authorized), `Reject`, `Re-run Verification`.

**Safety/authority semantics:** `verified` means checks passed; it does **not** mean approved, merged, applied, or deployed. State labels must remain distinct. Isolated worker modifications remain isolated until the applicable explicit policy/approval allows host changes.

### 6.6 Projects — The authoritative portfolio

**Purpose:** Make all user-registered and autonomous development projects visible and operable, including newly created projects and existing repositories.

**Default view:** **Registered Projects** grid/list, not only ranked opportunities. Include user projects, autonomous projects, paused projects, and archived projects. Secondary views: **Initiatives**, **Proposals**, **Outcomes**.

**Project card:** name, description, origin, repository/workspace location, worker environment, health/status from available evidence, goals, tasks/builds, next milestone, last activity, next decision. Do not show repository URLs/path values unless persisted and available.

**Project detail tabs:** `Overview`, `Goals`, `Plans`, `Tasks`, `Builds`, `Files/Artifacts`, `Activity`, `Settings`. The project overview provides an objective, roadmap, recent milestones, progress evidence, and outstanding decisions.

**Project registration:** User can register an existing directory/repository or create a new project. Clearly distinguish project metadata registration from repository creation or code generation. Worker reachability, access permissions, and allowed execution environment are explicit.

**Autonomous initiatives:** A proposed autonomous project displays rationale, benefit, evidence, expected work, resource budget, authorization state, and planned milestones. Approval creates or activates a project under the configured autonomy policy. An independently initiated project has traceable origin and decisions.

**Actions:** `Open Project`, `Start/Continue Work`, `Create Goal`, `Create Plan`, `Review Proposal`, `Pause/Resume`, `Archive`; permissions/authority govern state-changing operations.

### 6.7 Context Inspector — all Work views

**Inspector header:** entity type + title, status badge, project association, close/pin control.

**Core sections:** `Summary`, `Current state`, `Next action`, `Relationships`, `Evidence`, `History` (only when meaningful). Highlight exactly one primary next action, followed by secondary actions.

**Behavior:**

- Selecting a record updates Inspector content without changing conversations or unrelated executions.
- Switching Work subviews displays that subview's last selection, or its empty inspector.
- Clicking a related object navigates and selects the target in its native workspace.
- The Inspector may be widened, collapsed, or promoted to a full detail page.
- Data loading, stale, absent, and forbidden states are explicit.
- At narrow widths, Inspector opens as a dismissible drawer, not a fixed column crushing content.

## 7. Supporting product surfaces

### 7.1 World — embodied execution

The World visualizes residents, locations, and execution; it is an alternate *view of the same runtime records*. Residents can show public text activity bubbles and tool/status indicators. Bubble content and Activity detail must trace back to event IDs. Clicking a resident bubble can open the corresponding task or precise Activity event. Room assignment does not determine conversational ownership.

### 7.2 Activity — detailed source of truth

Activity is the chronological execution trace: task started, emitted assistant text, tool call, tool result, progress, approval, cancellation, failure, and completion events. Offer filtering by task, run, project, type, and time; grouped tool call/result pairs; expandable raw structured payload for diagnostics; and links back to related records.

Display visible assistant commentary only when present as user-visible runtime output. Do not label inferred summaries as original Hermes statements. Allow explanatory summaries only when visibly identified as summaries and grounded in trace data.

### 7.3 Results — durable outcomes

Results are finished outputs and outcome records, with file/artifact links, execution references, verification status, associated project/goal/task/run, and timestamps. `Completed` does not imply a written answer exists; show actual results or “No textual response was produced,” with the trace/error accessible.

### 7.4 Memory and Knowledge Deck

Memory provides stored facts/lessons with provenance and retrieval context. Knowledge Deck provides browsable, curated knowledge objects and their relationships to projects, findings, goals, and artifacts. **Knowledge Deck is a distinct destination**, not a disguised redirect to Discover or Goals. Items may link to those views without substituting for them.

## 8. Target domain and data architecture

### 8.1 Authoritative records

Define stable entities with persistent IDs and auditable timestamps:

| Entity | Essential fields | Relationships |
|---|---|---|
| Project | `id`, `name`, `origin`, `repo/workspace`, `state`, `worker`, `created_at`, `updated_at` | goals, plans, tasks, builds, outcomes |
| Conversation | `id`, `title`, `project_id?`, `created_at`, `updated_at` | messages, referenced tasks |
| Message | `id`, `conversation_id`, `role`, `content`, `stream_status`, `created_at` | originating task IDs / references |
| Task | `id`, `title`, `origin`, `state`, `project_id?`, `goal_id?`, `plan_id?`, `origin_conversation_id?`, `origin_message_id?` | attempts, events, results |
| Attempt | `id`, `task_id`, `state`, `started_at`, `ended_at`, `error?` | runtime events, result |
| Discovery | `id`, `kind`, `title`, `evidence`, `state`, `source_project_id?` | proposed goals/plans |
| Goal | `id`, `project_id?`, `outcome`, `criteria`, `state`, `priority` | plans, tasks, milestones |
| Plan | `id`, `version`, `goal_id?`, `project_id?`, `milestones`, `verification`, `approval_state` | builds, tasks |
| BuildRun | `id`, `project_id`, `plan_id?`, `candidate_id?`, `phase`, `verification_state`, `approval_state`, `apply_state` | attempts, logs, artifacts |
| Result | `id`, `kind`, `task_id?`, `build_run_id?`, `project_id?`, `content/artifact_ref`, `verification` | trace and owner |
| RuntimeEvent | `id`, `sequence`, `timestamp`, `type`, `payload`, `task_id?`, `attempt_id?` | project/run/conversation via references |

Schema may use separate link tables for many-to-many relationships; the table represents **behavioral contracts**, not a dictated database migration.

### 8.2 Separation of responsibilities

```text
Hermes runtime / worker
    │ user-visible text, tool calls, tool results, status, outputs
    ▼
Runtime event ingestion ─────► append-only event store ───► Activity / World
    │                                 │
    ▼                                 ▼
Task & attempt state            live event subscription
    │                                 │
    ├── results / artifacts           ├── execution dock
    ├── project / goal / plan         ├── contextual inspector
    └── conversation references       └── chat task reference updates

Canonical conversation store ──► Chat full-page and Chat drawer
Project/work graph store ──────► Work views and related-object navigation
```

**Ownership rules:**

- Backend is authoritative for entity states, permissions, workflow transitions, persisted messages, and event sequence.
- Frontend is authoritative only for ephemeral presentation state: selected view, inspector width, filters, scroll, drawer visibility, unsent drafts.
- Renderers derive their views from the same canonical records/events. They must not maintain competing definitions of task success or conversation membership.
- Reconnect rehydrates persisted state before resuming live events and deduplicates by event/message ID or monotonic sequence.
- Partial text deltas are correctly merged without changing the message's task/conversation association.
- Terminal events never erase preceding public text or tool detail.

### 8.3 API capability contracts

Provide or adapt API capabilities for:

- List/get/create conversations; list/send messages; retrieve message stream and linked tasks.
- List/get/create tasks; list attempts; transition controlled task actions; task event history.
- List/get/update projects, discoveries, goals, plans, build runs, and results.
- Retrieve related entities in both directions (`project → goals`, `task → conversation`, `build → plan`, etc.).
- Stream durable events with cursor/resume and replay; do not rely on transient websocket delivery as the only record.
- Return structured error codes, permissions, timestamps, artifact references, and transition affordances.

**Transport is an implementation choice** (existing REST/WebSocket patterns may be reused). UI behavior must not depend on a single connection remaining uninterrupted.

### 8.4 Core invariants

1. Every visible work record has a stable ID and canonical detail view.
2. A single conversation ID produces the same messages in full Chat and drawer Chat.
3. Opening a task does not send, duplicate, or reparent messages.
4. Autonomously initiated tasks retain explicit `origin=autonomous`, even when discussed later in Chat.
5. Switching tabs cannot change task state or execution environment.
6. `verified`, `approved`, `applied`, and `deployed` are separate states.
7. A completed task without assistant text is not represented as a successful conversational answer.
8. A failed attempt retains its original error and result evidence across retries.
9. Runtime activity shown in World can be located in Activity history.
10. Every record-driven status/count uses backend data and displays the current filter/scope.

## 9. End-to-end user journeys

### Journey A — Ask Hermes a question

1. User opens Chat, selects existing thread, enters a question.
2. Message persists immediately with pending/sent state.
3. Hermes attempt is linked to that message; a task reference is shown if task execution occurs.
4. Real assistant text streams into the same conversation bubble.
5. Completion yields either a persisted response, a clearly identified no-text outcome, or a specific error; the task and Activity trace remain accessible.
6. Navigation away and back restores the same messages and relevant execution state.

### Journey B — Start work from a project

1. User opens Projects, selects project, then `Start/Continue Work`.
2. User chooses task/goal/plan context in the action dialog.
3. Hermes starts a task associated with the project and optionally the selected goal/plan and conversation.
4. Task is visible in Tasks; execution in Activity; current activity in World.
5. Results and subsequent Build runs link back to the same project.

### Journey C — Autonomous discovery becomes a project

1. Hermes records an evidence-backed discovery, visibly marked autonomous.
2. Discover shows an actionable card with source and proposed next step.
3. Hermes creates a linked goal and plan under authorized policy or queues a decision if approval is required.
4. Reviewer approves/revises according to permission policy.
5. Projects shows a proposed initiative, then a registered project if creation is authorized.
6. Planning and Build track candidate development with tests and explicit review/apply distinctions.
7. Results stores outcome; project roadmap and goal status update with linked evidence.
8. User can discuss any stage in Chat without changing its provenance.

### Journey D — Review and apply a build candidate

1. Build shows `Awaiting review` with project and plan context.
2. User opens candidate review: actual changes, test output, failed checks, and execution history.
3. User approves or requests revision; approval state persists.
4. If policy allows a separate apply step, user selects `Apply Changes` and sees the target environment/branch.
5. Apply outcome records commit/artifact evidence or a precise failure; no silent host modification.

### Journey E — Switch contexts while work runs

1. User starts Task A in Conversation A.
2. User opens Projects and switches to another project, then Conversation B.
3. Task A continues running and remains discoverable in global active work.
4. The new sidebar shows the selected project; it does not show Task A merely because Task A was selected earlier.
5. User opens Task A via the execution dock and returns to Conversation A with the correct message focused.

### Journey F — Failure, retry, and trace

1. Provider/worker failure marks the attempt `failed` with the actual available error.
2. Tasks and Chat show consistent failure state; a successful textual answer is not implied.
3. User opens Activity to view the exact failing event and available logs.
4. Retry creates a new attempt with original error/history intact; outcome and subsequent responses correlate to the new attempt.

## 10. UI design system and layout behavior

### 10.1 Visual direction

Retain the Hermesha Command Centre identity: deep navy/black surfaces, restrained cyan/teal for information and navigation, mint for positive/available actions, amber for decisions/warnings, red for errors/destructive actions. Use neon accents sparingly to signal interaction and activity, **not** as a substitute for information hierarchy. Typography prioritizes legible work records over compact decorative labels.

### 10.2 Density and hierarchy

- Page title and one-line purpose at top; compact filter/action toolbar below.
- Keep important lists/records in the primary content area, not buried under several summary panels.
- Summary counters are compact, relevant, and interactive; no giant empty metric cards.
- Each record uses consistent order: title → context/project → state → evidence/progress → next action.
- Show meaningful empty states with why/what next; avoid stacks of bordered empty boxes.
- Use drawers for contextual details and full-page views for complex content (diffs, long traces, large plans).

### 10.3 Responsive behavior

- **Wide desktop ≥ 1360px:** left navigation + flexible work area + resizable context inspector. Chat drawer overlays by default unless user opts to dock.
- **Compact desktop 900–1359px:** inspector collapses to slide-over drawer; main work view maintains usable width; navigation may compact.
- **Narrow < 900px:** one main content column, menu drawer, selection detail as separate layer, full-screen Chat when opened. Horizontal scrolling must not hide primary actions.
- Long logs and code diffs use dedicated scroll areas; nested scroll traps are prohibited.
- Scroll position, selection and draft state survive non-destructive navigation.

### 10.4 Accessibility

Keyboard navigation through worklists, tabs and inspector; visible focus; proper buttons/links; accessible names for icons; contrast-compliant text; reduced-motion option for live activity; announced important status changes without flooding assistive technology during streaming. Streaming text should not reset keyboard focus or scroll users away from historical messages.

## 11. Loading, empty, offline and error states

| Situation | Required UI behavior |
|---|---|
| First load | Skeleton/compact loading states matching actual records; no fabricated counts |
| Empty project portfolio | Explain no registered projects; `Register Project`/`Create Project` |
| No discoveries | Explain no findings under current filters; `Scan` when supported |
| No plan/build records | Explain stage and provide the valid originating action |
| Live connection lost | Show connection state; preserve cached records and unsent drafts; resynchronize on reconnect |
| Backend error | Explicit error and retry in affected panel; do not erase unrelated content |
| Missing/forbidden entity | Recoverable unavailable message; navigation back to filtered list |
| Provider denied request | Distinguish attempted execution failure from missing textual assistant response |
| Unsaved draft | Persist per conversation where possible; no accidental cross-thread send |
| Historical/replayed events | Render chronology without falsely re-activating old running states |

## 12. Implementation work packages

### WP1 — Foundations and navigation

Implement typed selection, stable routes, project scope, shared Work shell, context inspector contracts, navigation restoration, and consistent status/action primitives. Deliver functional contextual selection in all six Work views, even before their complete redesign.

### WP2 — Unified conversation system (HL-CONV-001)

Implement shared thread/message store, Chat full-page and drawer parity, streaming reconstruction, task/message references, draft persistence, task-specific `Open in Chat`, and explicit autonomous-work discussion flow. Retire independent task reply composers only after equivalent linked-chat workflow works.

### WP3 — Tasks and live execution

Implement task list/detail, attempts, runtime trace, activity dock, error/response semantics, and cross-links to Chat, Activity, World, and Results. Ensure task state and public text are consistent under reconnection and retry.

### WP4 — Discover, Goals and Planning

Implement evidence-based discovery cards and dispositions; goal outcome/dependency views; plan editor/review and approvals; bidirectional relationships; authority-dependent transitions.

### WP5 — Build and candidate review

Implement build registry, stage rail, results and diff review, revision workflow, verification/approval/apply state distinctions, controlled apply interactions, and links to project/plan/task.

### WP6 — Projects portfolio and autonomous initiatives

Implement registered-project registry, project detail tabs, project creation/registration, autonomous project proposal/approval lifecycle, outcomes, and active work connections. Project functionality is useful even when no autonomous proposals exist.

### WP7 — Cross-surface polish and hardening

Wire World/Activity/Results/Memory/Knowledge Deck navigation; polish empty/failed states and responsive behavior; verify accessibility, event replay, permissions, refresh/deep-link persistence, and end-to-end workflows.

**Incremental delivery rule:** Each package must leave existing core navigation and task execution usable. Reuse authoritative persisted records where available; add missing contracts as needed. Do not add fake counters or simulation-only objects to satisfy UI screenshots.

## 13. Definition of done and acceptance criteria

**AC-01 — Contextual inspector:** Selecting a build in Build shows build data; switching to Discover never retains that build/task as an unrelated inspector object.

**AC-02 — Canonical chat:** A message sent in full Chat appears in the drawer and vice versa, with identical conversation ID, order, and persisted history after refresh.

**AC-03 — Task-to-chat navigation:** `Open in Chat` opens the correct existing thread and relevant message. It does not create a new conversation or duplicate the message.

**AC-04 — Autonomous provenance:** Autonomous task can be opened and discussed in Chat while retaining its autonomous origin and original event history.

**AC-05 — Correct execution display:** When public Hermes text exists, the correct message shows it. Tool details remain accessible through Activity. No invented internal reasoning appears.

**AC-06 — Honest outcome:** Missing text, worker error, and provider access denial have distinct UI states. Completed/failed status matches persisted task state.

**AC-07 — Project portfolio:** Registered projects appear regardless of discovery/proposal counts. Every project has a canonical detail view with linked goals/tasks/builds.

**AC-08 — Workflow links:** Discovery → Goal → Plan → Build → Project → Result can be traversed with stable links and breadcrumbs, including browser Back/Forward.

**AC-09 — Build authority:** Verified candidate is not shown as applied. Apply is an explicit action with a visible target and recorded outcome where policy requires approval.

**AC-10 — Navigation continuity:** Changing workspaces or chat threads does not stop unrelated running tasks, discard other thread drafts, or lose the ability to return to previously selected records.

**AC-11 — Runtime reconnect:** After reconnect/refresh, history is restored, event duplicates are suppressed, and historical events do not falsely show current execution.

**AC-12 — Useful empty states:** No empty portfolio or dashboard displays a blank framed area without meaning or a next action.

**AC-13 — Responsive:** Core list, inspector and chat interactions work on wide and compact desktop without clipping or inaccessible controls.

**AC-14 — Accessibility:** Keyboard navigation, focus, status labels, and reduced motion function across every view.

**AC-15 — Cross-surface coherence:** Every World runtime bubble and task status can be traced to Activity and its owning task; Results link back to their producer.

**AC-16 — No parallel UI state machines:** Chat and Work may present data differently, but they use canonical entities and backend-authoritative transitions.

## 14. Implementation instruction for Hermes development agent

> Implement this document as the **target product design** for Hermesha Command Centre. Prioritize functional, cohesive user journeys and reusable components. Treat HL-CONV-001 and HL-WORK-001 as one coordinated program delivered in the specified work packages. Build the intended screens, flows, relationships, state behavior and acceptance tests. Inspect existing modules only as necessary to integrate and safely modify code; **do not turn this assignment into an audit or a report comparing old versus new architecture**. Preserve working backend services, VM isolation and 3D World functionality unless a specific integration change requires otherwise. Every displayed execution detail must originate from real persisted runtime data. Finish each increment with actual working navigation, data-driven UI, and verification against the corresponding acceptance criteria.

---

**End of specification — HL-UX-001**
