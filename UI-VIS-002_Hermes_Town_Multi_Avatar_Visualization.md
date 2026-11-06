# UI-VIS-002 — Hermes Town Multi-Avatar Visualization

**Type:** Development specification / implementation milestone  
**Priority:** UI enhancement (after visualization-event correctness)  
**Status:** Proposed — not implemented  
**Scope:** Frontend visualization only  
**Depends on:** UI-VIS-001 (Hermes Town-style map or equivalent town scene), existing Hermes Life task/event APIs

## 1. Purpose

Replace the single-character spaceship/office visualization with a **top-down, pixel-art town populated by specialized role avatars**. Each avatar makes one part of Hermes Life's real workflow visible: research, planning, coding, verification, memory, review, and orchestration.

**This is a visualization of one logical Hermes Life system, not an implementation of separate autonomous agents.** Avatars do not have independent permissions, prompts, task queues, or decision-making authority. The backend remains the source of truth.

The visual town should let the user answer at a glance: **What is Hermes doing? Which project/task? What is waiting? What finished or failed?** The town may be animated and lively, but must not imply work that isn't occurring.

## 2. Non-negotiable boundaries

### In scope
- A town map, locations/buildings, role-specific resident sprites, walking paths, animations, status labels, activity indicators, and optional read-only detail popovers.
- A single frontend state adapter translating existing backend events/snapshots into town presentation state.
- Correct restoration after reload, WebSocket reconnect, and missed events.
- Responsive rendering inside the **current visualization panel**.

### Out of scope
- No replacement, rearrangement, or behavioral changes to **Overview, Goals, Discover, Planning, Build, Activity, or Evidence** tabs.
- No changes to chat, project selector, project synchronization, approvals, memory persistence, task execution, test environments, autonomy scheduling, or authorization policy.
- No second approval UI, independent mini-dashboard, or duplicate workflow state machine inside the visualization.
- No real subagent creation or additional LLM calls solely to animate residents.
- No Hermes Town plugin, Node server, iframe, or external runtime dependency. Hermes Town is a **visual/conceptual reference**, not a source of runtime data.

If an event needed for a desired visual is absent, display a truthful **unknown/idle** state or document a future backend requirement; do not fabricate a new event in this milestone.

## 3. Visual structure and scene

Use the existing Phaser renderer and current panel container. Replace only the existing `WorldScene`/scene graphics and the presentation-specific event mapping. Preserve the canvas mounting point, resize handling, and existing application layout.

### Town layout (illustrative, not pixel-locked)

| Location | Resident | Purpose |
|---|---|---|
| Town Square / Town Hall | **Hermes** (coordinator) | General chat, scheduling, system overview, waiting |
| Library / Research Center | **Sage** (researcher) | Discovery scan, curiosity investigation, reading source or docs |
| Planning House | **Piper** (planner) | Formulation, investigation planning, acceptance-criteria preparation |
| Workshop / Forge | **Forge** (builder) | Isolated candidate creation, editing, implementation, revision |
| Testing Lab | **Patch** (tester) | Baseline tests, candidate tests, reevaluation, verification |
| Archive / Memory Vault | **Echo** (archivist) | Memory extraction, vault updates, reflection and learning |
| Review Office | **Vale** (reviewer) | Candidate review status, awaiting approval, adjudication, integration status |

Names are *display aliases only* and may be changed independently of persisted backend IDs. Provide distinct palettes/silhouettes and readable labels; avoid relying on color alone.

### Scene rules
- Show all residents in stable home locations when idle. Small ambient actions (breathing, sitting, walking around home area) are acceptable **only if clearly non-work animations**.
- Use paths between buildings; walking indicates a **visual state transition**, not a backend execution transition.
- Show one or more active residents only when independent backend states/events support that concurrency. If the backend has one active task, do not imply multiple simultaneously executing tasks.
- A resident working at a building shows a distinct activity animation and short status text, e.g. `Patch · Testing candidate`.
- A waiting resident uses a waiting badge/icon, not working animation. A completed or failed action produces a short finite visual transition, then moves to the next grounded state.
- Decorative townspeople, if included, must be visually distinguishable from workflow residents and must never show job badges.
- Provide an accessible, reduced-motion mode (freeze movement, preserve state labels).

## 4. Frontend model and architecture

Create a single, testable **town presentation adapter**. It consumes persisted backend snapshots and live events and outputs render state for Phaser. It must not persist or mutate workflow records.

Suggested types (adjust to established project conventions):

```ts
type ResidentRole =
  | 'coordinator' | 'researcher' | 'planner' | 'builder'
  | 'tester' | 'archivist' | 'reviewer';

type ActivityState =
  | 'idle' | 'queued' | 'working' | 'waiting_approval'
  | 'completed' | 'failed' | 'blocked' | 'unknown';

type TownResident = {
  role: ResidentRole;
  state: ActivityState;
  location: string;
  activityLabel: string;
  projectId?: string;
  workflowId?: string;
  taskId?: string;
  eventSequence?: number;
  observedAt?: string;
};

type TownSnapshot = {
  connection: 'live' | 'reconnecting' | 'disconnected';
  residents: Record<ResidentRole, TownResident>;
  observedAt?: string;
  lastSequence?: number;
};
```

**Source of truth:** Explicit task/goal/run states and persisted timestamps take precedence over transient animation events. Do not derive backend lifecycle completion from a sprite finishing its animation.

### Required boundaries
1. **Backend data adapter:** Load authoritative current snapshots from existing endpoints (e.g. goals, tasks, plans, implementations and runtime state as available). Confirm actual shapes in source before implementation.
2. **Event reducer:** Apply existing WebSocket events to the presentation model; de-duplicate by event ID or sequence, ignore stale/reordered events, and request a fresh snapshot after a gap.
3. **Resident renderer:** Sprite creation, movement/pathfinding, animation transitions, badges, click targets.
4. **Read-only interaction bridge:** Navigate to existing tabs/record details using existing router handlers; do not reimplement business controls.

Do not assume names or payload fields in the mapping below exist exactly as written. Inspect and map **actual** backend event names first. Maintain one explicit mapping table and tests for all handled cases.

## 5. Activity-to-avatar mapping contract

| Real underlying state or event category | Role | Visual behavior | Destination |
|---|---|---|---|
| No executing work / connected and idle | Coordinator | Idle in square; others at home | Town Square |
| User chat task active | Coordinator | Talking/working icon, linked task | Town Hall |
| Discovery scan running | Researcher | Searching shelves / papers | Library |
| Curiosity investigation goal running | Researcher | Reading and note-taking | Library |
| Formulation or investigation plan creation running | Planner | Working at desk/board | Planning House |
| Plan proposed, waiting for human approval | Planner / Reviewer | Waiting indicator; **not working** | Planning House / Review Office |
| Implementation run `preparing` / `implementing` | Builder | Preparing materials / coding | Workshop |
| Implementation run `testing_baseline` / `evaluating` | Tester | Test console activity | Testing Lab |
| Candidate passed, awaiting review | Reviewer | Awaiting-review marker | Review Office |
| Revision queued | Builder | Queued marker | Workshop |
| Revision running | Builder | Coding animation | Workshop |
| Revision test / reevaluation running | Tester | Testing animation | Testing Lab |
| Memory extraction / vault write actually in progress | Archivist | Filing books/records | Archive |
| Backend-reported error / blocked run | Relevant role | Stationary alert with reason | Current building |
| Explicit completion event | Relevant role | Brief completion acknowledgement, then current state | Current building |

**No inference from mere existence of records:** Old `completed` goals and `approved` plans should not animate residents as if currently executing. An approved plan can remain `waiting_approval` only if the next applicable gate truly awaits human action; approved-but-unstarted implementation is `queued` or `waiting_start`, as supported by the actual data.

### Priority when multiple records exist
- Resolve each resident from the most recent **nonterminal, authoritative** operation for its role, using timestamps and identifiers.
- Never treat a historic event as current solely because it is the latest received WebSocket packet.
- If concurrency really exists, show a concise count (e.g., `2 active investigations`) and allow inspection; don't fabricate additional execution processes.
- If records disagree or are incomplete, show `Status unknown` and link to Activity; never guess progress percentages.

## 6. User interactions

**Click resident:** Display a small read-only details popover with role, current state, activity, project/task identifier (if available), actual timestamp, and `View task` / `View plan` / `View evidence` navigation where relevant.

**Click building:** Highlight its role and show a short summary of current/waiting/recent activity. Navigation opens the matching **existing** dashboard tab. Do not introduce duplicate Approve/Apply/Run buttons.

**Hover/focus:** Accessible tooltip with semantic state label. Enable keyboard navigation and visible focus indicator when renderer/input architecture permits.

**Connection banner:** `Live`, `Reconnecting`, `Disconnected — last known state at [time]`. Last known statuses may remain visible but must be visually marked stale while disconnected.

## 7. Event handling and recovery

- Initial load: fetch authoritative snapshots before presenting any `working` state. Until loaded, show neutral initializing state.
- WebSocket message: validate name and payload shape; ignore unknown messages without crashing; apply known mapping; update timestamp/sequence.
- Reconnection: fetch a fresh snapshot and reconcile residents; do not replay stale animation as current activity.
- Missed sequence: request resynchronization rather than extrapolating undocumented events.
- Task failure or cancellation: terminate the relevant work animation and show failure/stopped with evidence link.
- Restart: render based on current persisted state, not previously stored sprite positions.
- Never include model-generated activity claims without matching runtime evidence.

## 8. Art, animation, and performance

- Pixel-art, top-down layout consistent with the overall Hermes Life aesthetic; original/appropriately licensed artwork.
- Sprite states: `idle`, `walk`, `work`, `wait`, `complete`, `error` as supported by the role. At minimum idle/walk/work/wait with shared fallback assets.
- Fit entirely inside the existing viewport; respect `Phaser.Scale.FIT` (or the current supported scale policy). Do not add unsupported Phaser `GameConfig` props.
- Preload/cache assets once; dispose event listeners, timers, textures, and scene state on teardown.
- Stop unnecessary animations when the tab is hidden; resume from the backend snapshot rather than catching up fictitious work.
- Avoid background polling duplicates; reuse the application's existing API/event layer where possible.
- Provide a nonanimated label-based fallback if sprites fail to load.

## 9. Build plan / milestones

### VIS-002A — Visual contract and town layout
- Audit the current Phaser scene, event wiring, CSS sizing, and existing navigation integration.
- Define the stable resident roster, location identifiers, asset structure, and town tile map.
- Implement town rendering with idle residents, tooltip labels, responsive scaling and no changes to dashboard tabs.

### VIS-002B — Shared status adapter
- Implement one pure reducer from existing snapshots/events to town state.
- Add role mappings with precise state/timestamp semantics and unit tests.
- Show correct active, queued, waiting, completed, failed, blocked, and unknown representations.

### VIS-002C — Movement and interactions
- Add route/path movement and role-specific animations driven only by active state changes.
- Add resident/building details and navigation to existing workflow UI.

### VIS-002D — Synchronization and accessibility
- Handle initial state, disconnect, reconnect, out-of-order/duplicate events and browser reload.
- Add reduced motion, keyboard support where feasible, and render/resource cleanup.

### VIS-002E — Integration validation
- Validate against real Hermes Life backend, active goal, investigation, plan approval, candidate test, revision, memory event, and failure event.
- Run frontend build and relevant existing regression tests; ensure no functionality changed outside visualization.

## 10. Acceptance criteria (mandatory)

1. Existing spaceship/office scene replaced with a top-down town inside the **same panel**.
2. All seven existing dashboard tabs remain in the same positions and retain their functionality.
3. Chat, project selection, approval, API behavior, SQLite, Obsidian, and autonomy are unaffected.
4. At least seven stable visual residents exist: coordinator, researcher, planner, builder, tester, archivist, reviewer.
5. Each resident has a distinct name/silhouette and a recognizable home building.
6. A real investigation start activates the researcher and a real completion stops that animation.
7. Planning and approval-wait states are visually distinct; waiting is never displayed as ongoing execution.
8. Candidate coding activates the builder; actual testing/reevaluation activates the tester.
9. Old completed records do not trigger ongoing activity after reload.
10. A failed or blocked operation displays a clear status without pretending to be working.
11. Multiple active residents appear only if real concurrent operations exist, with correct work counts.
12. Clicking an avatar/building opens read-only context and a working link into the existing tab/record.
13. Lost WebSocket connectivity displays stale/disconnected state; reconnection restores correct activity from persisted data.
14. Duplicate and out-of-order events do not create duplicate residents or regress states.
15. Scene fits the original panel at supported desktop widths without overflowing or crowding adjacent controls.
16. No backend or database schema migration is needed for this visual-only milestone.
17. Frontend TypeScript build passes and the scene has no leaked listeners after remount/unmount.
18. A recorded integration test demonstrates event-to-visual behavior for investigate → plan → build → test → review.
19. A reduced-motion or static fallback conveys the same status information.
20. An event with insufficient information renders `Unknown` rather than inventing a task or action.

## 11. Regression and test scenarios

| Test | Input | Required result |
|---|---|---|
| T01 | Application loads with no active task | All residents idle; no fake activity |
| T02 | Investigation task started | Researcher at Library, linked task visible |
| T03 | Investigation completed + plan proposed | Researcher stops, planner/reviewer shows plan readiness accurately |
| T04 | Plan approved but implementation not started | No builder work animation; valid waiting/queued status |
| T05 | Implementation preparing / implementing | Builder active at Workshop |
| T06 | Baseline/candidate evaluation running | Tester active; builder not falsely shown testing |
| T07 | Candidate passed, review pending | Reviewer waiting with navigation link |
| T08 | Revision queued → running → tested | Correct transitions and timestamps, no duplicate job |
| T09 | Memory update event | Archivist animation only when supported by a genuine event |
| T10 | Duplicate / reordered events | State remains consistent, resident count unchanged |
| T11 | WebSocket disconnected then reconnected | Stale indicator appears, snapshot restores truth |
| T12 | Scene panel remounted repeatedly | No extra WS subscriptions or timer leaks |
| T13 | Reduced-motion enabled | State labels preserved with movement disabled |
| T14 | Existing tabs and buttons tested | No behavioral regressions |

## 12. Deliverables and definition of done

Deliver:
- New/updated Phaser scene source and original/licensed map/sprite assets.
- One documented event-to-resident mapping module with unit tests.
- Read-only resident/building information popovers and navigation handlers.
- Disconnect/reconnect recovery and reduced-motion handling.
- Build/test results and a short source-level change report.

**Done only when:** the town is visually populated, each resident's apparent activity corresponds to observable backend state, navigation works, and **the existing tab system and all functional workflows remain unchanged**.

## 13. Source-of-truth relationship

This milestone supplements `HERMES_LIFE_MASTER_DEV_SPEC.md`; it does **not** supersede the existing architecture, workflow, or security contracts. If the visual spec conflicts with established backend semantics, preserve the backend behavior and adjust the visualization.

Implementation agents should first inspect the live/current source and determine the actual event names and component boundaries rather than copying illustrative identifiers or assuming a Hermes Town plugin dependency.
