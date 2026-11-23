# Hermesha — Codebase Audit & Implementation Plan

**Audited against:** `hermesha.md` ("Hermesha — A Living Autonomous AI Environment")
**Codebase:** `/home/gayzer/Apps/hermes-life` (frontend `frontend/`, backend `hermes_life/`)
**Date:** 2026-11-23
**Author:** Hermes (audit only — no code changed)

---

## 0. TL;DR

The plan in `hermesha.md` is **~70% already standing in the codebase**. The three-group
navigation, the one-shell/one-chat/one-work-graph architecture, the Attention Center, the
contextual inspector ring, the conversation overlay states and the World→Work separation are
all *implemented*, not proposed.

The real work is **not** a rebuild. It is a bounded set of gaps:

1. **Conversation is still not *in* the World** (no in-world composer bar) — spec §5/§6.
2. **The World was never visually upgraded** — the facility still floats in dead canvas — spec §11.
3. **One live functional bug**: Attention "Resolve in Memory" routes to a deleted workspace and
   blanks the main pane — spec §9.
4. Smaller gaps: global search, full Director identity view, visible work-origin (autonomous vs
   user-directed), Results integration, work-subview alignment, narrow-screen drawer nav.

`hermesha.md` is a design narrative, not a formal spec — it even carries a couple of typos
(`tj# HERMESHA…`). The companion **`hermesha-ui-ux-obsidian-spec.md`** is the formal phase spec
(P0–P6, acceptance tests §9) and this codebase already tracks its phases. I have turned
`hermesha.md`'s prose proposals into verifiable criteria below and graded the code against them.

---

## 1. Scope & method

- Read the spec end-to-end (`hermesha.md`, 596 lines) and the companion spec
  (`hermesha-ui-ux-obsidian-spec.md`).
- Read the implemented shell in full: `frontend/index.html` (579), `src/main.v2.ts` (779),
  `src/navigation-state.ts` (501), `src/attention-center.ts` (304), `src/town-view.ts` (614),
  `src/town-renderer.ts`, plus the chat/overlay CSS and grep sweeps.
- Inspected 13 current-UI screenshots in `uipics/` (the `2026-11-22 22-17` shot is the **old**
  pre-Hermesha chat and is excluded).
- Every claim below cites `file:line`. No grade is taken from a comment or docstring.

---

## 2. What already complies (do **not** regress)

| Spec area | Evidence |
|---|---|
| One shell, one workspace host | `index.html:14` grid `#app`; `main.v2.ts:43` workspace list |
| Three-group nav (Experience/Operations/Intelligence) | `index.html:37-46` |
| 8 rooms + resident/workstation projection | `index.html:48-56`, `town-view.ts:100-143` |
| World vs Work separated; World reads authoritative records | `town-view.ts:305-348` (reads `/api/tasks`, `/api/goals`, `/api/implementations`…) |
| Attention Center (badge + aggregate) | `attention-center.ts:253-302`, badge `index.html:25`, `:311-319` |
| Contextual inspector ring (typed selection + scopes) | `navigation-state.ts:97-179`, `context-inspector.ts` |
| Conversation overlay: minimized / docked / focus | `hermes-chat.ts:19` (pill), `unified-layout.css:1773-1810`, reparent `main.v2.ts:186-202` |
| Conversations workspace = reparented same chat (one system) | `main.v2.ts:70-75,186-202`, `index.html:327-335` |
| Status strip (running count, latest event, Activity link) | `index.html:63-75`, `main.v2.ts:210-233` |
| Home = overview (recent activity + current focus + attention) | `index.html:122-145` |
| Work = 6 subviews (Tasks/Discover/Goals/Planning/Build/Projects) | `index.html:156-163` |
| Research session (sources/findings/questions/vault links) | `index.html:344-375`, `research-workspace.ts` |
| Knowledge = library + vault memory + folded Memory | `index.html:378-458` |
| Room→task link from World (room inspector) | `town-view.ts:100-143,532-556` |

`uipics/` confirms all of the above renders in the live app (World, Home, Work/*, Knowledge,
Discover, Planning, Build, Projects all captured).

---

## 3. Compliance scorecard (`hermesha.md` section by section)

| § | Section | Verdict | Notes |
|---|---|---|---|
| 1 | Living Command Centre / one intelligence | ✅ | One shell, one chat, one work graph |
| 2 | Keep World, elevate purpose + Overview/Focus levels | ⚠️ partial | Room selection exists; **no true camera focus/zoom** into a room |
| 3 | Separate World from Work | ✅ | World consumes the same records Work does |
| 4 | Re-navigate around 3 groups | ✅ / ⚠️ | Groups done; **global search missing**; Results not integrated |
| 5 | Persistent shell w/ configurable central workspace | ⚠️ | Shell done; **no in-World composer bar**; no top-bar search |
| 6 | Conversation as overlay (3 states) | ⚠️ | 3 states done; **conversation not integral to World** |
| 7 | Real operational identity (Hermesha/Director) | ⚠️ | Compact persona card only; **full identity view missing** |
| 8 | Visible agency: 3 kinds of work | ⚠️ | Data exists (origin/autonomy); **not surfaced** as origin/justification |
| 9 | Attention Center | ✅ (1 bug) | Implemented; **one route bug** (D3) |
| 10 | Five operational questions everywhere | ⚠️ | Consistent-ish; "why"/"what next" uneven |
| 11 | World visual upgrade | ❌ | **Not done** — facility floats in dead canvas, no focus/zoom |
| 12 | Information architecture | ✅ | Matches the work-graph map |
| 13 | Keep / redesign / consolidate table | ✅ | Mostly realized |
| 14 | The entry experience | ⚠️ | World-first landing ✅; the click→evidence→ask→decide flow is partly wired |

---

## 4. Discrepancies (highest severity first)

### D1 — HIGH — Conversation is not *inside* the World (spec §5, §6)
**Spec:** §5 mock shows a composer bar inside the World (`◈ Ask Hermesha anything…` with
`+ Attach · Workspace ▾ · Send ➤`); §6 states "conversation becomes an integral part of Hermes
World rather than a disconnected application destination."
**Actual:** `#workspace-world` (`index.html:93-120`) contains only the heading, status strip and
canvas. The chat is a floating pill/dock (`hermes-chat.ts:19`, `main.v2.ts:186-202`); there is no
composer surface in the World. The attach/workspace controls exist but live inside the chat panel
project UI (`phase412-project-ui.ts:27,51-55,355-368`), not in the World.
**Change needed:** Add an in-World composer bar that mounts the *same* composer path
(`conv-composer.ts`) and the same attach/workspace affordances, bound to the canonical
conversation id — presentation only, no second chat instance.

### D2 — HIGH — The World was never visually upgraded (spec §11)
**Spec:** §11 — facility should occupy more of the scene; better framing/zoom; stronger room
readability; more visible residents; subtle activity indicators; hover/select affordance;
project panels should **reframe** not crop the World.
**Actual:** the default renderer is the from-scratch `town-renderer-v2.ts`
(`town-renderer.ts:104-115`, selected first when WebGL2 is present). Its camera is a fixed
near-top-down **orthographic** camera (`town-renderer-v2.ts:862-878`) with a constant fit factor
of `0.88` (`:1082`, applied `:1118`). Screenshots (`uipics/…07-24-51`, `…04-50-18`) show the
facility centred with large empty margins — exactly the §11 complaint. There is **no per-room
camera focus/zoom**; the ResizeObserver re-fits on panel resize (`town-view.ts:188-196`) but that
is a re-measure, not a deliberate reframe.
**Change needed:** replace the fixed top-down orthographic camera with a **perspective
"operations-centre" look** (DECIDED 2026-11-23, see §8), plus room focus (zoom-to-room),
a room/resident readability pass, and an explicit re-frame on inspector/chat open.

### D3 — HIGH — Attention "Resolve in Memory" blanks the main pane (spec §9)
**Actual:** `attention-center.ts:143` calls `void openWorkspace('system')`. The `system` workspace
was removed (Memory folded into Knowledge — `index.html:513-515`). `openWorkspace` sets state
directly (`navigation-state.ts:352-357`) and does **not** run the `system→knowledge` redirect,
which only lives in `parseNavQuery` (`navigation-state.ts:210`). Result: clicking "Resolve in
Memory" navigates to a workspace with no `#workspace-*` section → blank main.
**Change needed:** change the intent to `openWorkspace('knowledge')` (the memory-review list
already lives in `#memory-section`, `index.html:428-457`).

### D4 — MEDIUM — Global search absent (spec §2, §3, §5)
**Spec:** top bar should carry global search; §3 lists Search as a global utility; §5 mock shows
it in the header line.
**Actual:** `index.html:17-28` has brand + centre label + Chat/Logout only. No search input
anywhere in the top bar (grep confirms; the only `type="search"` fields are the Research and
Knowledge panes). Backend has no global search endpoint (consistent with the shell-map note).
**Change needed:** decide scope — either build a `/api/search` aggregate (tasks + vault +
discoveries + projects) and a header search, or formally defer with a documented decision.

### D5 — MEDIUM — Director identity view is incomplete (spec §7)
**Spec:** Hermesha/Director view should show current state, **current focus**, **associated
project**, **recent completed work**, **pending decisions**, and **available actions** (open
conversation, inspect current work, view activity).
**Actual:** the persona card (`index.html:521-543`) shows name/subtitle/mood/experience and a
"Workspace status · Current work" block shows current/recent/last-outcome/attention
(`index.html:553-560`, fed by `main.v2.ts:327-359`). Missing: current focus, associated project,
recent completed work list, pending-decision count, and the three available actions.
**Change needed:** expand the Director panel into the full status/identity view.

### D6 — MEDIUM — Work origin (user vs autonomous vs collaborative) not surfaced (spec §8)
**Spec:** the three kinds of work must be distinguishable; an autonomously initiated task
"should retain its origin, justification, associated project, and authorization status," and a
resident should be clickable to learn *why* work started.
**Actual:** the World already receives an `autonomous` signal (`town-view.ts:386-387`, `:414-417`)
but only uses it for routing/coloring; the resident card (`town-view.ts:558-611`) lists
project/task/workflow but **not** origin/justification/authority. Work records carry provenance,
but the World does not present it as the spec's "why did this start."
**Change needed:** surface origin + justification + authority on the resident card and room
inspector, sourced from the same records.

### D7 — MEDIUM — World "Focus mode" is selection-only, no camera focus (spec §2)
**Spec:** Overview mode shows the whole facility; **Focus mode** opens a contextual detail view
for a selected room/workstation/resident.
**Actual:** selecting a room opens a small in-canvas panel + the inspector
(`town-view.ts:532-556`) — good — but the camera never moves; there is no spatial "focus."
**Change needed:** add a zoom-to-room camera state (pairs with D2).

### D8 — LOW — Five operational questions not uniform (spec §10)
**Actual:** the inspector/room card cover location/purpose/linked work; "Why is it happening"
(linked project/goal) and "What can I do next" (context-sensitive actions) are applied
inconsistently across World vs Work vs Activity.
**Change needed:** a consistency pass so the same selection shows the same status/ownership/
evidence/actions in every view.

### D9 — LOW — Results not integrated into Work/Activity (spec §4, §13)
**Actual:** Results is a standalone deep-link workspace (`index.html:474-511`) with no nav entry;
spec §4/§13 says Results should be "an integrated destination within Work and Activity."
**Change needed:** expose Results via Work/Activity (tab or action), keeping the deep link.

### D10 — LOW — Work subviews don't match spec §4 tab list
**Spec §4:** Overview · Discoveries · Goals · Plans · Tasks · Builds · Reviews · Results.
**Actual:** Tasks · Discover · Goals · Planning · Build · Projects (`index.html:156-163`,
`navigation-state.ts:28`). Close but not aligned (no Overview/Reviews/Results subview).
**Change needed:** reconcile naming/coverage, or document the divergence.

### D11 — LOW — Narrow-screen nav is a forced icon rail, not a drawer (spec §2)
**Actual:** ≤1080px forces an icon rail; spec asks for a drawer on narrow screens.
**Change needed:** drawer nav below the breakpoint (currently unbuilt).

### D12 — LOW — Attention category "permission requests" has no source (spec §9)
**Spec §9** lists permission requests among attention items; no pending-request surface exists
(the approvals ledger is a grants record, not a request queue).
**Change needed:** either add the source or mark it explicitly deferred (don't fake it).

---

## 5. Implementation plan

Sequenced so each phase ships independently and gates on the user's own browser verification
(per standing rule: no agent-side screenshots as proof). Suggested order P-A → P-F.

### P-A — Correctness (bundled, NOT shipped standalone)
> **Locked decision (2026-11-23):** the D3 fix is *held* and folded into the full bundled
> implementation pass — it does not ship on its own.
- [ ] **D3**: `attention-center.ts:143` → `openWorkspace('knowledge')`; add a headless test that
      asserts the memory attention item routes to `knowledge` (not `system`).
- [ ] Grep for any other caller of the removed `system` workspace in live paths.

### P-B — Conversation inside the World (spec §5, §6)
- [ ] Add an in-World composer bar (`#workspace-world`) mounting the existing
      `conv-composer.ts` path, bound to the canonical conversation id.
- [ ] Wire `+ Attach` and `Workspace ▾` to the existing attachment-mode logic
      (`phase412-project-ui.ts:51-55`) — presentation only, one chat system.
- [ ] Verify: typing in the World composer creates/continues the same thread as the docked chat;
      draft persists across presentation changes.

### P-C — World visual upgrade (spec §11, §2 focus mode)
- [ ] Camera composition pass in `town-renderer-v2.ts` (tighter framing; optional perspective).
- [ ] Zoom-to-room focus mode (D7) with a "back to overview" affordance.
- [ ] Room readability + resident visibility + subtle active-workstation indicators.
- [ ] Hover/select affordance on rooms/residents (interaction feedback).
- [ ] Explicit re-frame (not crop) when the inspector or docked chat opens; keep the existing
      ResizeObserver path (`town-view.ts:188-196`) but drive a deliberate camera target.
- [ ] Verify each against the live app at 1440px and at the ≤1439px overlay breakpoint.

### P-D — Identity & agency (spec §7, §8)
- [ ] Expand the Director panel: current focus, associated project, recent completed work,
      pending decisions, actions (open conversation / inspect current work / view activity).
- [ ] Surface work origin + justification + authorization on the resident card and room inspector
      (reuse the `autonomous` signal already computed in `town-view.ts:386-417`).

### P-E — Coverage gaps (spec §2, §4)
- [ ] Global search decision + implementation or documented deferral (D4).
- [ ] Integrate Results into Work/Activity (D9) while keeping the deep link.
- [ ] Reconcile Work subviews with the §4 tab list (D10).

### P-F — Consistency & responsive (spec §10, §2)
- [ ] Five-questions consistency pass across World/Work/Activity (D8).
- [ ] Drawer navigation below the narrow breakpoint (D11).
- [ ] Decide the "permission requests" attention source or mark deferred (D12).

---

## 6. Verification strategy

- **Type-check + tests:** `cd frontend && npm run build` (tsc covers `src` + `tests`), then
  `node --import tsx --test tests/*.test.ts` — full suite must stay green. (No run performed in
  this audit; the audit made no code changes.)
- **Headless unit tests** for pure helpers introduced (camera target math, origin-labelling,
  attention routing) so logic is covered without a display.
- **Structural DOM tests** exist for navigation and the shell — grep the test tree before moving
  or renaming regions/ids (`index.html` regions and `#global-status` ids are gated by tests).
- **User-verified in-app:** each phase ships with a short manual checklist (which room/task to
  click, what should change) — not agent screenshots.
- **Backend routes:** verify existence via `/openapi.json` (not gated); remember uvicorn runs
  without `--reload` (`./start.sh`), so route-adjacent changes need a restart.

---

## 7. Boundaries / non-goals (unchanged from the spec)

- Do **not** restructure the Obsidian vault on disk; build on existing paths.
- Preserve one conversation system, one work graph, one inspector ring — no forks.
- Do not invent data sources (e.g. "permission requests") with no backend.
- Keep the existing World rooms/resident mappings and backend contracts.
- No changes to working backend workflow or telemetry.

---

## 8. Decisions

**Locked (2026-11-23):**
- **Sequencing:** everything ships as one **bundled pass** — the D3 fix is held inside it, not
  shipped standalone.
- **World camera (D2/D7):** move from the top-down orthographic camera to a **perspective
  "operations-centre" look** — eye-level-ish, purposeful, with zoom-to-room focus.
- **Obsidian vault (from the standing spec):** unchanged — no on-disk restructuring.

**Still open:** none — all answered. See `hermesha-build-spec.md` for the consolidated, build-ready
spec: search = real `/api/search` aggregate, Work tabs renamed to the spec, everything bundled into
one pass.

*Nothing in this repo was modified by this audit.*
