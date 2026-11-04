# Hermes Life — Phase 4.13: Workspace UX and Live Lab Redesign

Status: Proposed product and implementation requirements; not a claim that the features exist.
Authority: Complement to `HERMES_LIFE_DEV_SPEC.md`. Do not supersede autonomy, memory, project workspace, or approval safety requirements.
Scope: Frontend UX and read-only activity presentation; backend API changes only where necessary for reliable, traceable activity data.

## Problem evidence (screenshots, 2026-11-02)

- Discover shows scan response as unformatted JSON (`{"action":"discover","questions_added":0,"found":19,"new":0}`), and old curiosity records lack clear timestamps, recency, and provenance. Its state controls appear as large vertically stacked buttons.
- The main page exposes tabs Overview, Goals, Discover, Planning, Build, Activity, Evidence, but doesn't clearly distinguish new, active, stale, completed, and archived records.
- Chat is a narrow overlay combining thread navigation, conversation history, project selection, synchronization, a raw scrollable Git diff, approval phrase input, apply control, and composer in one limited column.
- Evidence has substantial raw output and task identifiers but little scan-friendly task chronology.
- Virtual lab scene has labeled rooms (Archive, Library, Studio, Planning, Test Lab, Lounge) and a small character, but activity does not yet explain concrete operations, paths, tool names, or progress at a glance.

## Product outcome

For any current task, the user must be able to answer within a few seconds: What is Hermes doing? On which project? When did it start/change? What has completed? What requires user approval? What can I inspect? The user can converse without a code diff or approval controls crowding the composer.

## Non-goals

- Do not change existing autonomous decision or task execution semantics merely to make the UI livelier.
- Do not invent progress percentages, 'live' states, tool actions, or successful tests from room location, time elapsed, or polling alone.
- Do not auto-apply code or auto-approve a change.
- Do not require new backend APIs where existing endpoints and events already provide the necessary information.

## Workstream A — Global information architecture

Keep Overview, Goals, Discover, Planning, Build, Activity, Evidence, but implement a shared visual system for tab header, filters, lifecycle badges, last refresh, and record cards. Default to actionable items, not archived results. Every record card should display a human-readable title, short context, project, relevant created/updated timestamp, provenance and latest actionable state. Provide `Active`, `New`, and `History` filters where relevant; define `New` by persisted last-seen checkpoint per user/browser, not by a hardcoded age threshold. Keep search and filter state stable while switching tabs. Group history by date and default collapsed. Empty states should say whether there are zero records, zero new records, or an API failure. A request error must never look like an empty success.

Overview: current agent state, selected/active project, active goals, recent outcomes, attention-required approvals. Goals: queued/running/blocked/completed with source and timestamps. Discover: concise latest-scan summary, outstanding findings, deduplicated evidence, explain statuses and scan actions. Planning: formulations and investigation plans with linked discovery and goal, latest outcome and blockers. Build: candidate implementations, test evidence, change review status and approval-required count. Activity: chronological event timeline with event type and task/project correlation. Evidence: task-scoped answer/tool events in readable mode; raw event dumps behind a disclosure.

## Workstream B — Chat and project workflows

Use a wider right-side panel on desktop (responsive width; a near-fullscreen mode) and full-screen mobile sheet. Chat header: current conversation title, task status, active project selector, collapse/expand, threads, close. Conversation area: primary scroll region only; differentiate user, Hermes answer, tool activity, system feedback, and approval requests. Composer remains visible at the bottom. Project controls reduce to project selector and a small workspace button. `Sync`, `Review changes`, exact diff, approval phrase and `Apply` go to a separate project workspace drawer/modal with steps `Workspace → Review → Apply`. Do not make review/apply available unless a project is selected and prerequisites are satisfied. Present a clear `Not synced` status.

Review panel: changed file list, summarized diff stats, expandable diff viewer (syntax-safe escaped content, preserved whitespace), base commit, diff hash, review expiry, test evidence if available, approval phrase, apply confirmation. Use the existing Phase 4.12 review/apply endpoints and do not weaken server-side validations. Keep visible error messages local to the operation; do not mix them into chat conversation. Preserve chat scroll position during project refresh/review. Remember project selection and panel width locally (where supported).

## Workstream C — Virtual lab telemetry

Existing scene rooms remain. Each room shows specific *observed* work: Archive—memory storage/retrieval; Library—document study/research; Studio—coding/editing; Planning—formulation/plans; Test Lab—test execution/review; Lounge—idle/waiting. Use a typed mapping from backend event names to a task activity state. Each room should be clickable; show `room`, `active task`, `project`, `observed action`, `last event timestamp`, and most recent 3-5 related events. When activity occurs, animate the relevant device/room; keep it subtle. Display a compact real-time activity ribbon below or over the world, e.g. `Testing · hermes-life · pytest · started 22:41` **only** when those fields came from actual events. Distinguish queued/running/completed/failed/waiting-approval. If events contain no tool name or file path, label `Working on task` rather than invent details. Do not expose full secrets or SSH parameters in the scene.

Supply an event-to-visual-state reducer with deterministic handling of late/out-of-order events using sequence IDs, deduplication, and a reconnection catch-up from persisted events. Mark `Disconnected` when stream unavailable; show last-known state without implying live execution. World animation is secondary; task/activity detail must remain accessible as text for accessibility.

## Workstream D — Timestamps, freshness, and lifecycle rules

For all major records: show source-backed `created_at`, `updated_at`, task correlation, `completed_at` if available, `last_seen_at` where applicable. Use relative time in cards with absolute time on hover/tap; browser-local timezone; unparseable or missing values display `Time unavailable`. Freshness is not the same as state: a `completed` record can be recent, and a `running` record can be stale. Add stale-running warning only when backend heartbeat/lease rules actually support it. Retain statuses from backend; never infer successful completion from a missing event. Event timeline sorted by server sequence and timestamp, with stable per-task correlation.

## Workstream E — Interaction/accessibility/responsive rules

Buttons have one obvious action and meaningful disabled reasons. Compact action buttons appear together, not stacked vertically, except on narrow/mobile layouts. Keyboard navigation, focus states, contrast, aria labels and accessible dialogs are required. Virtual lab does not block use of other tabs. Avoid nested uncontrolled scroll containers; one scroll container per content panel. Keep chat composer, send, and interrupt controls reachable. Preserve a calm, readable visual hierarchy matching the existing dark teal palette, with colors used to distinguish real statuses rather than decoration.

## Implementation sequence

1. Inspect current `frontend/src/main.ts`, its CSS, `phase412-project-ui.ts`, world scene and backend event/API response schemas. Record contracts and existing listeners before edits.
2. Implement shared status/timestamp/filter/card components and migrate Discover first, without disrupting API calls.
3. Separate the project workspace review/apply controls from chat. Preserve existing review token, SHA and host-check semantics.
4. Migrate the remaining dashboard tabs to the shared lifecycle presentation.
5. Implement the event-to-visual reducer and observed telemetry ribbon, then enrich room details and animation.
6. Regression-test task creation, chat replies, project selection/sync, review/apply (with dry-run/test repository), discovery scanning, approval states, and stream reconnect. Run `npm run build`.

## Acceptance criteria

AC-01 Discover raw scan JSON is replaced with a human summary (`scanned`, `new`, last scan time); JSON remains available through a technical-details disclosure.
AC-02 Every record view clearly identifies active/new/history and provides source-backed timestamps, or `Time unavailable` if absent.
AC-03 Dismissed/resolved discoveries are not shown as new merely because they were fetched again; refresh does not wipe user filters.
AC-04 Chat can be used comfortably without the Git diff/approval controls visible. Composer and task status remain accessible when the project panel is open or closed.
AC-05 Project sync, review, and approval still work via existing endpoints. No unapproved write to host repository occurs. Reviewed content and confirm wording remain exact and verifiable.
AC-06 New and existing chat threads can be navigated without losing selected project; an explicit `@project` in message still takes precedence as currently designed.
AC-07 Virtual lab reports only event-backed project, operation, task, tool, status and timestamp. Missing data is not synthesized.
AC-08 Room details reveal the last related activity events and navigate to the relevant task/evidence when correlation IDs exist.
AC-09 Event disconnection and recovery are visually distinguishable from task completion, without duplicates after catch-up.
AC-10 Works across typical laptop/desktop widths and narrow/mobile screens; no overlapping chat controls, clipped review actions, or inaccessible buttons.
AC-11 `cd frontend && npm run build` passes. Manual checks of all seven tabs and one completed chat → VM edit → review → approved apply journey pass without regressions.

## First actionable implementation goal

Title: UI-413-01 — Readable discovery state and recency
Problem: Discover currently mixes raw scan JSON with old curiosity findings without distinguishing their freshness or lifecycle.
Implementation: Build common record presentation for Discover with source-backed timestamps, concise scan summaries, lifecycle filters (`Active`, `New`, `History`), clear action feedback, and compact buttons. Preserve existing discovery, decisions and curiosity endpoints and identifiers.
Done when: AC-01, AC-02, AC-03, AC-10 and relevant frontend build checks pass. No backend state semantics changed.
