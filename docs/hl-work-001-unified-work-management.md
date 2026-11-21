# HL-WORK-001 — Unified Work Management & Contextual Workspace Architecture

**Type:** Development specification (design + implementation plan)
**Priority:** High
**Status:** In progress — M1 landed (typed selection model + Context Inspector shell); M2 landed (registered-projects section, registry contract tests, sync 500→409 fix); M3–M5 pending
**Scope:** `frontend/src/` (work-workspace.ts, portfolio-view.ts, phase41301-rework.ts, phase41302-workflow.ts, phase412-project-ui.ts, main.v2.ts, index.html, workspace CSS), `hermes_life/app.py` (read-only decoration endpoints if needed). No changes to the task execution pipeline, autonomy scheduler, or conversation architecture (HL-CONV-001 is a prerequisite and is complete).
**Depends on:** HL-CONV-001 (unified conversation model + Open-in-Chat hand-off — landed), `/api/projects` registry (exists), `/api/autonomy/*` portfolio routes (exist)
**Supersedes:** the Projects workview as an autonomy-only portfolio (portfolio-view.ts keeps its data sources, loses its role as the whole tab)

## 1. Problem

The Work area is six dashboards sharing a navigation bar, not one workspace. Three failure modes, all verified in the tree:

1. **A global, task-only context panel.** `#ctx-selection` (index.html:421) is a single DOM node shared by every workview. It is filled only by `updateSelection(t: TaskRec)` (work-workspace.ts:522) and hidden only on Home (main.v2.ts:58-60). Result: a task selected last week keeps occupying the sidebar of Build, Discover and Projects — the "stale failed task next to hl-demo-worker" symptom. The panel even defaults its placeholder to "Select a task in Work to see it here." (index.html:423), which is wrong for five of six views.
2. **The Projects tab is not a project portfolio.** It renders only the autonomy portfolio (`/api/autonomy/projects`, `/api/proposals`, `/api/opportunities/ranked`, `/api/autonomy/experiences`, `/api/autonomy/config` — portfolio-view.ts). But a registered-project registry already exists in the backend: `ProjectWorkspaces` (project_workspaces.py:37) with `GET/POST /api/projects`, `/{name}/sync`, `/{name}/changes` (add_project_routes, project_workspaces.py:166-181), plus review/apply flows — and those are surfaced only inside the chat Workspace drawer (phase412-project-ui.ts). Registered projects are invisible in the one tab named "Projects."
3. **Discover is presentation-heavy for its information density.** 6 metric tiles, 6 filter buttons, 3 action buttons, an advanced details block, and two group sections render before/around a handful of findings (phase41301-rework.ts render(), ~lines 100-160). Counts and chrome dominate; the finding cards and their next action don't.

## 2. Current state (verified)

| Fact | Anchor |
|---|---|
| One global `#ctx-selection` panel for all workviews, task-typed only | `frontend/index.html:421-423` |
| Panel hidden only on Home; never re-typed per view | `frontend/src/main.v2.ts:58-60` |
| Only writer is `updateSelection(t: TaskRec)` | `frontend/src/work-workspace.ts:522-536` |
| WorkView union includes 'projects' | `frontend/src/navigation-state.ts:23,28` |
| Projects panel `#workview-projects` mounted by portfolio-view.ts; autonomy-only endpoints | `frontend/src/portfolio-view.ts:110-141,325` |
| Registered-project registry exists with list/register/sync/changes routes | `hermes_life/project_workspaces.py:53,57,98,166-181` |
| Registered projects surfaced only in the chat Workspace drawer | `frontend/src/phase412-project-ui.ts:69-100` |
| Discover: 6 metric tiles (3 clickable), 6 filters, 3 actions, advanced details | `frontend/src/phase41301-rework.ts:100-119` |
| Build/Goals/Planning share the phase41302 workflow renderer | `frontend/src/phase41302-workflow.ts` |
| Discoveries/questions come from `/discoveries` + `/curiosity/workflow` | `frontend/src/phase41301-rework.ts:84-90` |
| Chat hand-off event `hermes:open-in-chat` exists (HL-CONV-001) | `frontend/src/hermes-chat.ts` |

## 3. Locked decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | **One Context Inspector, typed per workspace.** `#ctx-selection` becomes `#ctx-inspector` driven by a `Selection = {kind, id}` model: `task`, `discovery`, `goal`, `plan`, `build` (implementation run), `project`. Each workview owns its selection; cross-view selection memory is allowed but the panel never renders a foreign kind's stale record | Fixes symptom 1 at the root instead of hiding symptoms per tab |
| 2 | **Backend-authoritative states only.** The inspector renders fields the API actually returns (state, timestamps, counts, review status). No frontend-invented lifecycle stages; the Build lifecycle display maps stages to the existing chain/status records | The 41302 renderer already derives stage from records; a second state machine would drift |
| 3 | **Projects = registry + autonomy + proposals.** The Projects tab gains a "Registered projects" section backed by `GET /api/projects` (name, remote_path/sync state, changes count via `/{name}/changes` lazily, actions: Sync / Review changes / Open in Chat with `@project` prefill via `hermes:open-in-chat`). Autonomy portfolio (existing portfolio-view) and Proposals/Ranked move below it as distinct sections | The registry is the durable, user-owned portfolio; autonomy is a subset, not a substitute |
| 4 | **No new state-management system.** Selection, filters and per-view state live in the existing `navigation-state.ts` pattern (localStorage-backed), extended with a typed map `selections: Record<WorkView, Selection \| null>` | One selection store, six consumers; avoids the "another conflicting state system" regression |
| 5 | **Build keeps its data sources; its presentation becomes implementation-centric.** Group by implementation (plan/candidate), show stage, last operation, test outcome, files changed, review status, and next action per run. The empty sidebar shows a workspace summary (counts), not a stale task | Builds already exist as chain records; this is a render contract change, not a backend one |
| 6 | **Discover: cards first, chrome collapsible.** Summary strip is one line of derived counts (findings / unreviewed / in planning / needs attention) linking to filtered views; scanner controls and technical details move inside the existing `<details class="hl413r-advanced">` | The advanced block already exists — this is a re-parenting, not a new component |
| 7 | **Useful empty states everywhere.** Every section states why it is empty and one action (e.g. Projects/Registered: "No projects registered — register with POST /api/projects or the Workspace drawer") | portfolio-view.ts:157 already does this for autonomy; extend the pattern |
| 8 | **Conversation stays in Chat.** All discussion actions dispatch `hermes:open-in-chat` (HL-CONV-001). No per-tab composers | Already implemented; spec codifies it as an invariant |

## 4. Design

### 4.1 Selection model (`navigation-state.ts`)

```ts
type SelectionKind = 'task' | 'discovery' | 'goal' | 'plan' | 'build' | 'project';
type Selection = { kind: SelectionKind; id: string };
// localStorage key: hermes-life-selections — per-workview map
```

- `getSelection(view: WorkView): Selection | null`, `setSelection(view, sel | null)`.
- `main.v2.ts` on view change: if `ctxHome`-style panel would render a selection whose kind does not match the view's domain kinds, render the workspace summary instead (counts + "Select a …").

### 4.2 Context Inspector (`work-workspace.ts` → new `context-inspector.ts`)

One render entry: `renderInspector(view, selection)`. Per kind, a small typed card:

| Kind | Header | Body | Actions |
|---|---|---|---|
| task | prompt/state/created | chain status, stage | Open in Results, Open in Chat |
| discovery | note/title | source, status, stage, evidence refs | Investigate (→ prefill task), View in Chat |
| goal / plan | title/state | linked discovery, criteria, progress | Open in Build, Open in Chat |
| build | implementation id/state | plan link, stage, last op, test outcome, files changed, review status | Review candidate, Open project, Open in Chat |
| project | name | remote_path / synced, changes summary | Sync, Review changes, Open in Chat (`@project` prefill) |

Empty selection → workspace summary (per-view counts from the view's own load), or panel collapsed at narrow widths (CSS: `#ctx-inspector` collapses under one breakpoint).

### 4.3 Projects tab (`portfolio-view.ts` restructured)

Order: (1) Registered projects (`/api/projects`); (2) Autonomous initiatives (`/api/autonomy/projects` + milestones, unchanged internals); (3) Opportunities & proposals (`/api/proposals`, `/api/opportunities/ranked`, experiences). Registered card actions reuse the phase412 drawer's endpoints; the drawer remains authoritative for apply-with-confirmation.

### 4.4 Discover restructure (`phase41301-rework.ts`)

- Replace the 6-tile metrics row with one summary line + up to 4 clickable count chips that set the filter (existing filter state machine reused).
- Finding cards keep their existing fields and gain one emphasized next-action button per stage (`open_review` → "Review candidate", etc. — mappings already in the file).
- `advanced` details absorbs scan button, schedule/technical details, refresh diagnostics.

### 4.5 Build restructure (`work-workspace.ts` build panel)

Implementation-centric grouping of the existing phase41302 records; lifecycle row Prepare→Baseline→Implement→Test→Evaluate→Review→Apply rendered from existing stage derivation (task-lifecycle.ts / chain status), each stage annotated with its backing record when present. The Build selection sets `selections.build = {kind:'build', id}`; the sidebar shows that run, not the last task.

## 5. Milestones

| M | Deliverable | Exit criteria |
|---|---|---|
| M1 | Selection model + Context Inspector shell | typed per-view selection persisted; foreign-kind selections no longer render; empty state = workspace summary; existing tests pass |
| M2 | Projects tab: Registered projects section | `GET /api/projects` rendered with sync state + actions; Sync and Review-changes work end-to-end against a registered repo; autonomy + proposals sections preserved below |
| M3 | Build: implementation-centric view + build-typed inspector | selecting a run updates the inspector with run facts; stage row backed by records; stale-task symptom gone |
| M4 | Discover: summary strip + collapsible chrome | counters reduced to summary line + filter chips; scanner/technical details inside `<details>`; cards carry one next-action |
| M5 | Cross-workflow links + test pass | Discover card → goal/plan/task links preserved (openWorkView with target selection); frontend test suite green; `npx tsc --noEmit` clean |

M1 first (infrastructure every other milestone consumes), then M2 (independent, biggest user-visible win), then M3–M5.

## 6. Verification

- `npx tsc --noEmit` and the frontend test runner after each milestone.
- Manual contract per tab: with a task selected in Tasks, switch to Build/Discover/Projects and confirm the inspector shows the workspace summary, not the task.
- Projects tab shows a registered repo with correct synced/not-synced state and a working Sync round-trip.
- Discover with 2 findings renders without empty filter groups dominating the first viewport.
