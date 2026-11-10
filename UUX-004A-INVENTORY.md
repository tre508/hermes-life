# UUX-004A — Ownership and Navigation Baseline Inventory

**Status**: Complete audit before any DOM moves
**Date**: 2026-11-10
**Scope**: All frontend/src modules that attach handlers, fetch state, or produce navigation events

---

## 1. ELEMENT ID INVENTORY BY SECTION

### 1.1 Discover & Decision (Work workspace — left management column)

| Element ID | Purpose | Owner Module | Mount Point |
|------------|---------|--------------|-------------|
| `decision-section` | Fold container for Independent Decisions | `index.html` (static) | `workspace-work` → `work-management` |
| `decision-state` | Discovery loop status text | `index.html` / `main.v2.ts` (updates via event) | Inside `#decision-section` |
| `decision-scan-interval` | Scan interval input (seconds) | `index.html` | Inside `#decision-section` |
| `decision-toggle` | Enable scheduled discovery button | `index.html` / `phase41301-rework.ts` (wires handler) | Inside `#decision-section` |
| `decision-scan` | Run decision now button | `index.html` / `phase41301-rework.ts` | Inside `#decision-section` |
| `decision-feedback` | Status feedback paragraph | `index.html` / `phase41301-rework.ts` | Inside `#decision-section` |
| `curiosity-list` | Curiosity queue list container | `index.html` / `phase41301-rework.ts` (renders) | Inside `#decision-section` |
| `discovery-section` | Fold container for Independent Discovery | `index.html` (static) | `workspace-work` → `work-management` |
| `discovery-scan` | Scan worker projects button | `index.html` / `phase41301-rework.ts` | Inside `#discovery-section` |
| `discovery-refresh` | Refresh button | `index.html` / `phase41301-rework.ts` | Inside `#discovery-section` |
| `discovery-status` | Status paragraph | `index.html` / `phase41301-rework.ts` | Inside `#discovery-section` |
| `discovery-list` | Discovery findings list container | `index.html` / `phase41301-rework.ts` (renders `#hl413r`) | Inside `#discovery-section` |

**Phase 4.13.1r overlay** (`phase41301-rework.ts`) mounts `#hl413r` inside the `#discovery-list` ancestor panel, hiding legacy children via `hl413r-legacy` class. It owns:
- `#hl413r` (root), `#hl413r-toolbar`, `#hl413r-sections`, `#hl413r-advanced`, filter buttons, metric buttons, mark-seen, scan/decision buttons

### 1.2 Autonomy & Goals (Work workspace — left management column)

| Element ID | Purpose | Owner Module | Mount Point |
|------------|---------|--------------|-------------|
| `autonomy-section` | Fold container for Autonomous Goals | `index.html` (static) | `workspace-work` → `work-management` |
| `autonomy-status` | Scheduler status text | `index.html` / `phase41302-workflow.ts` (wires `#autonomy-toggle`) | Inside `#autonomy-section` |
| `overview-autonomy-status` | Duplicate status in overview | `index.html` / `phase41302-workflow.ts` | Inside `#overview-section` (legacy) |
| `autonomy-toggle` | Enable/pause autonomy button | `index.html` / `phase41302-workflow.ts` | Inside `#autonomy-section` |
| `goals-refresh` | Refresh button (hidden by phase41302) | `index.html` / `phase41302-workflow.ts` hides it | Inside `#autonomy-section` |
| `goal-form` | Create goal form | `index.html` / `phase41302-workflow.ts` (wires submit) | Inside `#autonomy-section` |
| `goal-title` | Goal title input | `index.html` / `phase41302-workflow.ts` | Inside `#goal-form` |
| `goal-prompt` | Goal prompt textarea | `index.html` / `phase41302-workflow.ts` | Inside `#goal-form` |
| `goal-priority` | Priority number input | `index.html` / `phase41302-workflow.ts` | Inside `#goal-form` |
| `goal-feedback` | Form feedback paragraph | `index.html` / `phase41302-workflow.ts` | Inside `#autonomy-section` |
| `goal-list` | Legacy goal list (hidden by phase41302) | `index.html` / `phase41302-workflow.ts` hides it | Inside `#autonomy-section` |
| `#hl413-goals` | Phase 4.13.2 goals pane (replaces `#goal-list`) | `phase41302-workflow.ts` | Inserted before `#goal-list` |

**Phase 4.13.2 overlay** (`phase41302-workflow.ts`) owns `#hl413-goals`, `#hl413-plans`, their filter tabs, render logic, and refresh controllers. Legacy `#goal-list`, `#goals-refresh`, `#autonomy-toggle` (in overview) are hidden but NOT unwired — phase41302 re-wires `#autonomy-toggle` and `#goal-form` submit.

### 1.3 Formulations & Plans (Work workspace — left management column)

| Element ID | Purpose | Owner Module | Mount Point |
|------------|---------|--------------|-------------|
| `formulation-section` | Fold container for Goal Formulation | `index.html` (static) | `workspace-work` → `work-management` |
| `formulations-refresh` | Refresh proposals button | `index.html` / `phase415-review.ts` hides it | Inside `#formulation-section` |
| `formulation-feedback` | Status paragraph | `index.html` / `phase415-review.ts` hides it | Inside `#formulation-section` |
| `formulation-list` | Legacy proposals list (hidden by phase415) | `index.html` / `phase415-review.ts` hides `#formulation-section` | Inside `#formulation-section` |
| `plans-list` | Legacy plans list (hidden by phase415) | `index.html` / `phase415-review.ts` hides it | Inside sibling section |
| `plans-refresh` | Refresh plans button (hidden by phase415) | `index.html` / `phase415-review.ts` hides it | Inside plans section |
| `plans-feedback` | Status paragraph | `index.html` / `phase415-review.ts` hides it | Inside plans section |

**Phase 4.15 overlay** (`phase415-review.ts`) mounts:
- `#hl415-planning` (inserted before `#hl413-plans` / `#plans-list`)
- `#hl415-build` (inserted before `#implementations-list`)
- `#hl415-review` (dynamic, appended after `#hl415-build` on demand)
- Hides `#plans-refresh`, `#implementations-refresh`, `#formulation-section` entirely

### 1.4 Implementations / Build (Work workspace — left management column)

| Element ID | Purpose | Owner Module | Mount Point |
|------------|---------|--------------|-------------|
| `implementations-list` | Legacy evaluations list (hidden by phase415) | `index.html` / `phase415-review.ts` hides it | `workspace-work` → `work-management` |
| `implementations-refresh` | Refresh evaluations button (hidden by phase415) | `index.html` / `phase415-review.ts` hides it | Inside implementations section |
| `implementations-feedback` | Status paragraph | `index.html` / `phase415-review.ts` hides it | Inside implementations section |

**Phase 4.15 overlay** owns `#hl415-build` with run cards (`#hl415-run-{id}`), review detail (`#hl415-review`), verification settings, compile/verify actions.

### 1.5 Task Thread & Composer (Work workspace — center column)

| Element ID | Purpose | Owner Module | Mount Point |
|------------|---------|--------------|-------------|
| `task-list-container` | Left column: task list wrapper | `index.html` (static) | `workspace-work` → `work-grid` → `work-list` |
| `task-list` | Task entry list (rendered by `work-workspace.ts`) | `work-workspace.ts` | Inside `#task-list-container` |
| `work-task-count` | Task count badge | `index.html` / `work-workspace.ts` | Inside `#task-list-container` |
| `task-detail-container` | Center column: detail shell (hidden until selection) | `index.html` (static) | `workspace-work` → `work-grid` → `work-center` |
| `task-center-empty` | Empty state when no task selected | `index.html` (static) | Inside `#task-center-empty` |
| `task-thread-host-{id}` | Dynamic per-task thread mount point | `work-workspace.ts` (creates) | Inside `#task-detail-container` shell |
| `task-composer-host` | Composer mount point | `work-workspace.ts` (creates) | Inside `#task-detail-container` shell |
| `task-detail-composer` | Composer wrapper (built by `buildComposerShell`) | `work-workspace.ts` | Inside `#task-composer-host` |
| `task-detail-composer-text` | Composer textarea | `work-workspace.ts` / `conv-composer.ts` | Inside `#task-detail-composer` |
| `task-detail-composer-submit` | Composer submit button | `work-workspace.ts` / `conv-composer.ts` | Inside `#task-detail-composer` |
| `task-detail-composer-count` | Character counter | `work-workspace.ts` / `conv-composer.ts` | Inside `#task-detail-composer` |
| `task-detail-composer-feedback` | Composer feedback paragraph | `work-workspace.ts` / `conv-composer.ts` | Inside `#task-detail-composer` |
| `task-context` | Right column: contextual cards | `index.html` (static) | `workspace-work` → `work-grid` → `work-context` |

**`conv-composer.ts`** (shared with Home):
- Mounts on any textarea + submit button pair
- Draft key: `hermes.conv.draft.{conversation_id}` or `hermes.conv.draft.__new`
- Submitted marker: `hermes.conv.draft.submitted.{conversation_id}`
- Returns `{ rebind(), clear(), setConversationId(), wasDraftRestored() }`

**`conv-thread.ts`** (mounted by `work-workspace.ts` per selection):
- Fetches `/api/conversations/{id}/turns` + `/api/events?correlation_id={task_id}`
- Groups tool activity via `tool-group.ts`
- Listens to `hermes:event` (debounced 250ms)
- Returns `{ refresh(), dispose(), lastConversationId() }`

### 1.6 Results Workspace (Full-width answer & evidence)

| Element ID | Purpose | Owner Module | Mount Point |
|------------|---------|--------------|-------------|
| `workspace-results` | Results workspace view | `index.html` (static) | `main#main-workspace` |
| `response-workspace` | Response section root | `index.html` (static) | Inside `#workspace-results` |
| `response-source` | Source label ("Latest agent activity") | `main.v2.ts` | Inside `.response-top` |
| `response-status` | Task state badge | `main.v2.ts` (`loadTask`) | Inside `.response-meta` |
| `response-id` | Task ID display | `main.v2.ts` (`loadTask`) | Inside `.response-meta` |
| `response-follow` | Follow live toggle button | `main.v2.ts` | Inside `.response-actions` |
| `response-copy` | Copy answer button | `main.v2.ts` | Inside `.response-actions` |
| `response-tab-*` | Tab buttons: answer/tools/history | `main.v2.ts` | Inside `.response-tabs` |
| `response-answer-panel` | Answer tabpanel | `main.v2.ts` | Inside `#response-workspace` |
| `response-tools-panel` | Tool activity tabpanel | `main.v2.ts` | Inside `#response-workspace` |
| `response-history-panel` | History tabpanel | `main.v2.ts` | Inside `#response-workspace` |
| `response-error` | Error alert (hidden) | `main.v2.ts` | Inside `#response-workspace` |
| `response-raw-toggle` | Show raw text checkbox | `main.v2.ts` | Inside `#response-answer-panel` |
| `response-rich` | Rich-rendered answer article | `main.v2.ts` (`renderAnswer`) | Inside `#response-answer-panel` |
| `response-text` | Raw text pre (hidden) | `main.v2.ts` (`renderAnswer`) | Inside `#response-answer-panel` |
| `tool-events` | Tool activity container | `main.v2.ts` (`renderTools`) | Inside `#response-tools-panel` |
| `tool-count` | Tool count badge in tab | `main.v2.ts` (`renderTools`) | Inside tab button |
| `task-history` | History list container | `main.v2.ts` (`refreshHistory`) | Inside `#response-history-panel` |
| `refresh-history` | Refresh history button | `main.v2.ts` | Inside `#response-history-panel` |

**`main.v2.ts` owns all Results workspace logic**: `loadTask()`, `refreshHistory()`, `renderAnswer()`, `renderTools()`, `setResponseTab()`, `scheduleTaskRefresh()`, `syncLatestTask()`, `hermes:open-task` listener.

### 1.7 Memory / System Workspace

| Element ID | Purpose | Owner Module | Mount Point |
|------------|---------|--------------|-------------|
| `workspace-system` | System workspace view | `index.html` (static) | `main#main-workspace` |
| `memory-section` | Memory review section | `index.html` (static) | Inside `#workspace-system` |
| `memory-refresh` | Refresh button | `index.html` | Inside `#memory-section` |
| `memory-feedback` | Status paragraph | `index.html` | Inside `#memory-section` |
| `memory-correct-form` | Correction form (hidden) | `index.html` | Inside `#memory-section` |
| `memory-correct-target` | Target memory display | `index.html` | Inside `#memory-correct-form` |
| `memory-correct-action` | Action select (supersede/delete/merge) | `index.html` | Inside `#memory-correct-form` |
| `memory-merge-label` | Merge target label (hidden) | `index.html` | Inside `#memory-correct-form` |
| `memory-correct-merge` | Merge target select | `index.html` | Inside `#memory-correct-form` |
| `memory-correct-content` | New wording textarea | `index.html` | Inside `#memory-correct-form` |
| `memory-correct-rationale` | Reason input | `index.html` | Inside `#memory-correct-form` |
| `memory-correct-actor` | Decided-by input | `index.html` | Inside `#memory-correct-form` |
| `memory-correct-submit` | Apply correction button | `index.html` | Inside `#memory-correct-form` |
| `memory-correct-cancel` | Cancel button | `index.html` | Inside `#memory-correct-form` |
| `memory-profile-list` | Memories list container | `index.html` / `phase41303-memory.ts` (wires) | Inside `#memory-section` |
| `memory-review-list` | Pending reviews list | `index.html` / `phase41303-memory.ts` | Inside `#memory-section` |
| `memory-lesson-list` | Technical lessons list | `index.html` / `phase41303-memory.ts` | Inside `#memory-section` |
| `memory-history-list` | Recent corrections list | `index.html` / `phase41303-memory.ts` | Inside `#memory-section` |

**`phase41303-memory.ts`** (imported in `main.v2.ts` line 20) wires all memory handlers.

---

## 2. NAVIGATION PATTERN INVENTORY

### 2.1 Intra-document Scrolling (`scrollIntoView`)

| File | Line | Target | Purpose | Classification |
|------|------|--------|---------|----------------|
| `work-workspace.ts` | 800 | `(target.closest('details') \|\| target)` | Work subnav → scroll to section | **Intra-workspace** (Work subnav) |
| `work-workspace.ts` | 822 | `entry` (task list row) | `hermes:task:focus` → select & scroll task | **Cross-view sync** (3D → Work) |
| `phase41301-rework.ts` | 104 | `.hl413r-group` (Findings/Questions) | Metric button → scroll to filtered group | **Intra-component** (Discover overlay) |
| `phase41302-workflow.ts` | 192 | `details` element | Approve plan → open details & scroll | **Intra-component** (Planning overlay) |
| `phase415-review.ts` | 117 | `#hl415-run-{id}` | "View in Build" → click Build tab + scroll to run | **Cross-subnav** (Planning → Build) |
| `main.ts` | 344 | `#response-workspace` | Legacy — scroll to results workspace | **Legacy** (old main.ts, not in v2) |

### 2.2 `location.hash` / `href="#"` / Deep Links

| Pattern | Location | Purpose | Status |
|---------|----------|---------|--------|
| `history.replaceState(null, '', \`#task=${encodeURIComponent(taskId)}\`)` | `work-workspace.ts:510` | Encode task filter in URL for Activity workspace | **Active** — P2 sync |
| `hermes:workview` custom event | Multiple | Cross-module Work subnav activation | **Active** — canonical |
| `hermes:open-task` custom event | Multiple | Open task in Results workspace | **Active** — canonical |
| `hermes:task:focus` custom event | `town-view.ts:511`, `work-workspace.ts:805` | 3D resident click → Work task selection | **Active** — P2 sync |
| `hermes:workspace:activity` custom event | `main.v2.ts:77`, `work-workspace.ts:511` | Work → Activity with task filter | **Active** — P2 sync |
| `hermes:connection` custom event | `main.v2.ts:352`, `town-view.ts:96` | Connection status broadcast | **Active** |
| `hermes:event` custom event | `main.v2.ts:293`, `town-view.ts:95`, `conv-thread.ts:224` | Live event bus | **Active** |
| `town:building` custom event | `command-centre-ui.ts:35`, `town-view.ts:105` | Room selection (3D or nav) | **Active** |
| `town:select` custom event | `town-view.ts:104` | 3D resident click | **Active** |
| `hermesha:room:select` custom event | `command-centre-ui.ts:59` | 3D room click → nav highlight | **Active** |

**No `href="#"` or `location.hash` navigation** found in current v2 codebase. The old `main.ts` used hash-based tabs; v2 uses `data-workspace` / `data-workview` buttons + custom events.

### 2.3 `openTab` / `data-tab` Legacy Shims

| File | Lines | Pattern | Replacement |
|------|-------|---------|-------------|
| `phase41301-rework.ts` | 141-143, 161-164 | `openTab('Planning')`, `openTab('Build')` | Clicks button by textContent (fragile) |
| `phase41302-workflow.ts` | 45-48, 138-139 | `openTab('Build')` | Same fragile textContent match |
| `phase415-review.ts` | 117 | `[data-tab="build"]` click + scroll | Direct subnav click would be cleaner |
| `index.html` | 53-59 | `#nav-shims` hidden buttons for `build` | Shim for legacy `openTab` calls |

**Classification**: All `openTab` / `data-tab` are **legacy shims** from Phase 4 tab bar. They should route through `hermes:workview` events instead of DOM textContent matching.

### 2.4 `#primary-nav` Click Handlers

| Handler | File | Line | Scope |
|---------|------|------|-------|
| Workspace switch (home/work/activity/results/system) | `main.v2.ts` | 111-113 | **Canonical** — `setWorkspace()` |
| Room link click → `selectRoom()` + Home switch | `command-centre-ui.ts` | 90-97 | **Canonical** — presentation only |
| Work subnav buttons → Work subnav click | `command-centre-ui.ts` | 99-108 | **Shim** — delegates to `#work-subnav` |
| Chat button → header chat click | `main.v2.ts` | 125-127 | **Shim** — delegates to header |
| `hermes:workview` listener → `setWorkspace('work')` | `main.v2.ts` | 119-122 | **Canonical** — cross-module entry |
| `hermes:task:focus` listener → Work + task select | `work-workspace.ts` | 805-828 | **Canonical** — P2 sync |
| `hermes:workspace:activity` listener → Activity + filter | `main.v2.ts` | 77-88 | **Canonical** — P2 sync |
| `hermes:open-task` listener → Results + loadTask | `main.v2.ts` | 590-596 | **Canonical** |

---

## 3. REPRODUCIBLE BASELINE FLOWS

Each flow captures: **URL**, **Visible DOM sections**, **Selected task**, **Draft content**, **Listener counts**.

### 3.1 Work → Discover
- **URL**: `/` (hash unchanged; Work workspace active)
- **Visible sections**: `#workspace-work` (layout-workspace), `#work-subnav` with `data-workview="discover"` active, `#discovery-section` scrolled into view, `#hl413r` rendered inside `#discovery-list` ancestor
- **Selected task**: None (Discover is global, not task-scoped)
- **Draft content**: N/A (composer hidden)
- **Listeners**: `phase41301-rework.ts` refresh interval (30s), `hermes:event` on window, metric button clicks, filter toolbar buttons, scan/decision buttons

### 3.2 Work → Planning
- **URL**: `/`
- **Visible sections**: `#workspace-work`, `#work-subnav` with `data-workview="planning"` active, `#hl415-planning` rendered (phase415), `#plans-list` hidden
- **Selected task**: None (Planning shows all plans)
- **Draft content**: N/A
- **Listeners**: `phase415-review.ts` refresh interval (5s), approve plan buttons, start build buttons, criteria compile/verify

### 3.3 Room → Role → Task (3D → Work)
- **Trigger**: Click resident in 3D town OR click room in nav
- **Event chain**: `town:select` (resident) → `hermes:task:focus` + `hermes:open-task` dispatched → `work-workspace.ts` catches `hermes:task:focus` → clicks `#primary-nav button[data-workspace="work"]` → retries task list selection up to 6×80ms → `selectTask(id)` → renders detail, thread, composer
- **URL**: `/` (Work workspace active)
- **Visible sections**: `#workspace-work`, `#task-detail-container` visible, `#task-list-container` hidden, `#app.work-detail-open` class set
- **Selected task**: The resident's `taskId` (e.g., `task_abc123`)
- **Draft content**: Restored from `localStorage['hermes.conv.draft.{conversation_id}']` via `conv-composer.ts.rebind()`
- **Listeners**: `conv-thread.ts` (debounced `hermes:event`), `conv-composer.ts` (input/submit), `work-workspace.ts` global `hermes:event` (refreshes list on task.*), `town-view.ts` ongoing

### 3.4 Follow-up Composer (Work detail → reply)
- **Trigger**: Type in `#task-detail-composer-text`, click `#task-detail-composer-submit`
- **Flow**: `conv-composer.ts` submit hook → POST `/api/tasks` with `conversation_id` → on success: clears draft, sets `hermes.conv.draft.submitted.{conversation_id}`, calls `loadData()` → `work-workspace.ts` re-renders list + detail
- **Draft persistence**: Survives Work ↔ Home ↔ Activity ↔ Results navigation via localStorage keyed by conversation_id
- **Listener count**: 1 composer instance per task selection (disposed on `backToList()`)

### 3.5 Approval Action (Plan approve / Review candidate)
- **Plan approve**: `#hl415-planning` card → "Approve plan" button → `confirm()` → POST `/api/investigation-plans/{id}/approve` → refresh → `#hl415-build` gets new run card
- **Review candidate**: `#hl415-build` card → "Review candidate changes" → `openReview(run)` → mounts `#hl415-review` → verification verdicts → Accept/Reject/Revision buttons → POST `/api/implementations/{id}/review`
- **Listeners**: Phase415 refresh interval (5s), review auto-refresh while revision queued (5s)

### 3.6 Home → Work → Results → Work (Round-trip)
1. **Home**: `#workspace-home` visible, `#ctx-home` in aside, `#home-recent-open` → `setWorkspace('work')`
2. **Work**: `#workspace-work` visible, select task → `#task-detail-container` visible, thread + composer mounted
3. **Results**: Click "Open in Results →" (action panel or contextual card) → `hermes:open-task` → `main.v2.ts` → `setWorkspace('results')` → `loadTask(id)` → `#workspace-results` visible, answer + tools + history tabs
4. **Back to Work**: Click `#primary-nav button[data-workspace="work"]` → `setWorkspace('work')` → task list still shows selection (persisted in `selectedId`), detail re-rendered via `renderDetail(selectedId)`

---

## 4. OWNERSHIP DEFINITION (Canonical Boundaries)

| Module | Owns | Must Not |
|--------|------|----------|
| **`main.v2.ts`** | Primary workspace shell: `#app` layout classes, `#primary-nav` workspace switching, global status (connection/execution/freshness), event stream (`hermes:event` dispatch), answer/evidence viewer (`loadTask`, `refreshHistory`), persona load, town mount (`installTown`), `hermes:open-task` / `hermes:workview` / `hermes:workspace:activity` listeners, Home ↔ Work ↔ Activity ↔ Results ↔ System routing | Invent new top-level navigation state; duplicate workspace switch logic |
| **`work-workspace.ts`** | Work view state: task list (`#task-list`), task selection (`selectedId`), detail shell (`#task-detail-container`), thread + composer mount per task, contextual right column (`#task-context`), Work subnav (`#work-subnav`) scroll targets, `hermes:task:focus` listener (3D → Work), `hermes:workview` listener (cross-module → Work subnav), 15s poll for selected task | Own world/room presentation; fetch town data; manage Results workspace |
| **`command-centre-ui.ts`** | World/room presentation ONLY: `#primary-nav` room link highlighting (`aria-current`), `#hc-room-info` panel, `#world-room-panel` content, `town:building` / `hermesha:room:select` listeners → visual updates only, `hc-sync` → `location.reload()` | Fetch task/workflow state; manage composer/thread; invent navigation events |
| **`conv-composer.ts`** | Draft semantics: localStorage draft keyed by conversation_id, submit hook returning `{task_id, conversation_id}`, rebind/clear API, character counter, feedback | POST to `/api/tasks` directly (caller does); manage conversation list |
| **`conv-thread.ts`** | Thread rendering: `/api/conversations/{id}/turns` + grouped tool activity, debounced `hermes:event` refresh, turn expand/collapse, task link clicks | Manage task selection; own composer |
| **`phase41301-rework.ts`** | Discover dashboard overlay (`#hl413r`): filter toolbar, metric cards, findings/questions cards, scan/decision actions, quality gate, localStorage "seen" marker | Modify Work workspace shell; invent new navigation |
| **`phase41302-workflow.ts`** | Goals & Planning overlays (`#hl413-goals`, `#hl413-plans`): filter tabs, cards, scheduler toggle, goal form, plan approve/start build, criteria view | Modify Work workspace shell; own Results workspace |
| **`phase415-review.ts`** | Planning/Build/Review overlays (`#hl415-planning`, `#hl415-build`, `#hl415-review`): plan cards, run cards, verification, review decisions, compile/verify actions | Modify Work workspace shell; own town view |
| **`phase41303-memory.ts`** | Memory/system workspace: profile list, reviews, lessons, corrections, correction form | Modify other workspaces |
| **`town-view.ts`** | 3D town + HUD: renderer, resident popovers, building panels, live event overlay, backend signal polling, `town:select` / `town:building` dispatch | Manage task lifecycle; own Work/Results workspaces |
| **Feature modules** (goals, discover, planning, build, review, memory) | Their own business controls: forms, buttons, API calls, card rendering within their designated mount points | Invent top-level navigation state; reach outside their mount point |

**Gate Confirmation**: All existing functional mounts and cross-view event producers catalogued above. Every existing operation has an assigned destination module. No DOM moves until this inventory is reviewed and approved.