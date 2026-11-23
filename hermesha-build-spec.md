# HERMESHA — Consolidated Build Spec (bundled pass)

**Status:** Build-ready, awaiting your go-ahead. Supersedes the phase plan in
`hermesha-audit.md` §5 as the single source of work.
**Sources consolidated:** `hermesha.md`, `hermesha-ui-ux-obsidian-spec.md`, and the audit
`hermesha-audit.md` (findings D1–D12).
**Codebase:** `/home/gayzer/Apps/hermes-life`
**Date:** 2026-11-23

---

## 0. Decisions locked

| # | Decision | Value |
|---|---|---|
| 1 | Sequencing | **One bundled pass.** Nothing ships standalone; the D3 bug fix is folded in. |
| 2 | World camera | **Perspective "operations-centre" look** (replaces top-down orthographic), with zoom-to-room focus. |
| 3 | Global search | **Build a real `/api/search` aggregate** (backend + top-bar UI). Not deferred. |
| 4 | Work tabs | **Rename to the spec** (Overview/Discoveries/Goals/Plans/Tasks/Builds/Reviews/Results). |
| 5 | Obsidian vault | Unchanged — **no on-disk restructuring**; build on existing paths. |

---

## 1. Ground rules (do not violate)

- **One conversation system** — one canonical thread/message store; presentation changes only
  (`hermes-chat.ts`, reparent in `main.v2.ts:186-202`). Never spawn a second chat.
- **One work graph** — projects, discoveries, goals, plans, tasks, runs, decisions, evidence are
  linked records (`store.py`, `schema.py`). No parallel store.
- **One contextual inspector** — typed selection ring (`navigation-state.ts:97-179`,
  `context-inspector.ts`); stale selections never linger.
- **Truthful execution** — render persisted events/records only; never invent progress, never
  label an un-applied candidate "done" (`attention-center.ts` predicates are the model).
- **Preserve ids/regions gated by tests** — `#global-status` ids, workspace section ids, and
  nav `data-*` hooks are asserted in `frontend/tests/`; grep before renaming.
- **User verifies UI in the running app** — agent screenshots are not proof; each workstream
  ships with a manual checklist.

---

## 2. Baseline (already built — do not regress)

Three-group nav (`index.html:37-56`), 8 rooms + resident projection (`town-view.ts:100-143`),
World↔Work separation (`town-view.ts:305-348`), Attention Center (`attention-center.ts`),
contextual inspector, conversation overlay states (`unified-layout.css:1773-1810`),
status strip (`index.html:63-75`), Home overview (`index.html:122-145`), Work subviews
(`index.html:156-163`), Research, Knowledge + folded Memory. Details and evidence: `hermesha-audit.md` §2.

---

## 3. Workstreams

### WS1 — Correctness (audit D3) · S · no deps
- **Fix:** `attention-center.ts:143` `openWorkspace('system')` → `openWorkspace('knowledge')`.
  `system` was removed in the regroup; `openWorkspace` does **not** run the `system→knowledge`
  redirect (that lives only in `parseNavQuery`, `navigation-state.ts:210`), so the click currently
  blanks the main pane.
- **Also:** grep every live caller of the removed `system` workspace and correct or delete.
- **Test:** headless — assert the memory attention item's `run()` opens `knowledge` and that no
  `#workspace-system` lookup is attempted.
- **Files:** `frontend/src/attention-center.ts`, `frontend/tests/*`.

### WS2 — Conversation inside the World (audit D1) · M · depends WS3 (layout)
- **Goal (spec §5/§6):** an in-World composer bar bound to the canonical conversation id —
  presentation only, same thread as the docked chat.
- **Build:** add a composer bar to `#workspace-world` (`index.html:93-120`) that mounts the
  existing composer path (`conv-composer.ts`) and reuses the attach/workspace controls from
  `phase412-project-ui.ts:51-55,355-368` (`+ Attach`, `Workspace ▾`, `Send`).
- **Contracts:** must read/write the same conversation id the pill/dock uses; unsent draft
  persists across minimized/docked/focus transitions.
- **Test:** structural DOM test that the World composer and the docked composer resolve to the
  same thread id; manual checklist for draft persistence.
- **Files:** `index.html` (world section), `main.v2.ts`, `hermes-chat.ts`, `conv-composer.ts`.

### WS3 — World perspective camera + focus mode (audit D2, D7, D11) · L · no deps
- **Goal (spec §2/§11):** perspective "operations-centre" look; facility fills the stage; rooms
  and residents readable; zoom-to-room focus; explicit re-frame (not crop) when inspector/chat
  opens.
- **Build:**
  - Replace `THREE.OrthographicCamera` (`town-renderer-v2.ts:862-878`) with a `PerspectiveCamera`;
    replace the `FIT = 0.88` ortho fit math (`:1082-1123`) with perspective framing (FOV + distance
    derived from scene bounds and aspect).
  - Camera presets: `overview` (whole facility, eye-level-ish pitch) and `focus(roomId)` (zoom to
    the room's bounds). Expose `setCamera(preset, target)` on the `TownRenderer` interface
    (`town-renderer.ts`).
  - On inspector/docked-chat open, drive a deliberate camera target so nothing clips (keep the
    existing ResizeObserver, `town-view.ts:188-196`, but treat it as a re-measure, not the
    framing authority).
  - Readability pass: room labels, resident sprites, subtle active-workstation indicators,
    hover/select affordance.
- **Contracts:** camera math must be a pure, headless-testable helper (bounds→camera params);
  no per-frame allocation regressions.
- **Test:** unit tests for the framing helper (aspect/bounds → fov/distance/target); manual
  visual checklist at 1440px and the ≤1439px overlay breakpoint.
- **Files:** `town-renderer-v2.ts`, `town-renderer.ts`, `town-view.ts`, `town.css`.

### WS4 — Identity & agency (audit D5, D6) · M · no deps
- **Goal (spec §7/§8):** full Director identity view + visible work origin.
- **Build:**
  - Expand the Director panel (`index.html:521-543`) to show: current state, **current focus**,
    **associated project**, **recent completed work**, **pending decisions**, and actions
    (open conversation / inspect current work / view activity).
  - Surface **origin + justification + authorization** on the resident card
    (`town-view.ts:558-611`) and room inspector (`town-view.ts:100-143`), reusing the
    `autonomous` signal already computed at `town-view.ts:386-417` and the work records'
    provenance fields. Do **not** infer origin from animation/occupancy.
- **Test:** headless test that a resident card for an autonomous task renders its origin label;
  manual checklist for the Director actions.
- **Files:** `index.html`, `main.v2.ts`, `town-view.ts`, `context-inspector.ts`.

### WS5 — Global search: `/api/search` aggregate (audit D4) · L · no deps
- **Goal (spec §2/§3/§5):** a real aggregate search + top-bar search field.
- **Backend — new `GET /api/search`:**
  - Query params: `q` (required, min len 2), `limit` (default 20, cap 50), optional
    `scopes` (comma list), optional `project_id`.
  - Response (stable shape):
    ```json
    {
      "query": "…",
      "results": [
        {
          "kind": "task|goal|discovery|plan|run|project|conversation|note|library",
          "id": "…",
          "title": "…",
          "excerpt": "…",
          "project_id": "…|null",
          "source": "work_graph|conversations|vault|library",
          "score": 0.0,
          "deeplink": { "intent": "openTask|openWorkspace|openWorkView|setSelection",
                        "args": { } }
        }
      ],
      "groups": { "task": 3, "note": 2 },
      "degraded": [ "vault:unreachable" ]
    }
    ```
  - **Sources — reuse, don't reinvent:**
    - tasks / goals / discoveries / investigation-plans / implementations / projects → work graph
      (`store.py`); add per-table `search()` helpers rather than loading everything in the route.
    - conversations → `conversation_recall.py` / `chat_models.py`.
    - vault notes → `memory_service.search` (`memory_service.py:233`).
    - library → `knowledge_library.search` (`knowledge_library.py:174`).
  - **Degradation is explicit:** an unreachable vault is reported in `degraded[]`, never faked
    as "no results" (spec §5/§12).
  - Route lives in `hermes_life/app.py` (factory style like `library_search` at `:336`).
  - **Verify route existence via `/openapi.json`** (not gated). Backend runs without `--reload`
    (`./start.sh`) — restart needed after adding the route.
- **Frontend:**
  - Add a search field to the top bar (`index.html:17-28`, `.hc-header-actions`).
  - Results dropdown groups by `kind`, renders title/excerpt/source; click routes through
    `navigation-state.ts` intents (map `deeplink.intent`→ existing `openTask` / `openWorkspace` /
    `openWorkView` / `setSelection`). Never invent a second navigation path.
  - Keyboard: `/` focus, `Esc` close, `Enter` open first result.
- **Test:** backend pytest for the route shape + degradation; frontend structural test for the
  field and routing; manual checklist for a real query.
- **Files:** `hermes_life/app.py`, `hermes_life/store.py`, `hermes_life/conversation_recall.py`,
  new `frontend/src/global-search.ts`, `index.html`, `unified-layout.css`.

### WS6 — Work tabs rename + Results integration (audit D9, D10) · L · after WS5
- **Goal (spec §4):** Work tabs = **Overview · Discoveries · Goals · Plans · Tasks · Builds ·
  Reviews · Results**.
- **Mapping (old → new):**
  | old `data-workview` | new | note |
  |---|---|---|
  | (none) | `overview` | new Work landing + **Project portfolio** |
  | `discover` | `discoveries` | rename |
  | `goals` | `goals` | unchanged |
  | `planning` | `plans` | rename |
  | `tasks` | `tasks` | unchanged (default) |
  | `build` | `builds` | rename |
  | (none) | `reviews` | new — candidate review queue (reuse Build review records) |
  | `projects` | — | folded into `overview`; keep nav shortcut |
  | (standalone) | `results` | **integrate** `#workspace-results` (`index.html:474`) into Work |
- **Code touchpoints:** `navigation-state.ts:23,28,44,101,126,354,389` (`WorkView` union,
  `WORK_VIEWS`, default, `VIEW_SELECTION_KINDS`); `index.html:156-163` (`data-workview` buttons)
  and the `workview-*` panels; `main.v2.ts` work-view switching; the render modules per subview;
  **grep `frontend/tests/` for `workview` literals and update**.
- **Keep deep links working:** legacy labels remain redirects with preserved selection
  (`navigation-state.ts:452-459` pattern).
- **Test:** structural test that every `WORK_VIEWS` entry has a matching panel and button; nav
  redirect test for legacy labels.
- **Files:** `navigation-state.ts`, `index.html`, `main.v2.ts`, `frontend/tests/*`.

### WS7 — Consistency & responsive (audit D8, D11, D12) · M · after WS4/WS6
- **Five questions pass (spec §10):** every selection (room/resident/task/plan/run/note) shows
  status, ownership (project/goal), evidence, and a context-sensitive "what can I do next" —
  uniform across World/Work/Activity.
- **Narrow-screen drawer (spec §2):** below the breakpoint, the nav rail becomes a drawer instead
  of a forced icon rail (current behaviour noted in the shell map).
- **Permission requests (spec §9):** either wire a real source or mark the attention category
  **explicitly deferred** in code — never fabricate a count.
- **Test:** structural test for the drawer toggle; manual checklist for the five-questions
  uniformity.
- **Files:** `unified-layout.css`, `main.v2.ts`, `attention-center.ts`.

---

## 4. Sequencing & gates

```
WS1 ─┐
WS3 ─┼─> WS2 ─> WS4 ─> WS5 ─> WS6 ─> WS7 ─> final validation
     └──────────────(WS3 layout feeds WS2)─────────
```
- WS1, WS3, WS4, WS5 are independent and can proceed in parallel.
- WS2 depends on WS3 (World layout changes first).
- WS6 depends on WS5 (Overview surfaces search + portfolio).
- **Gate:** after each WS, run `npm run build` + `node --import tsx --test tests/*.test.ts` and
  hand you a manual checklist. Do not fold a later WS into an earlier one.
- **Final validation (spec §10/§9):** one real end-to-end trace — autonomous discovery → project
  → plan/task → review → outcome → optional cited vault note — with attention, inspector, and
  World all reflecting the same persisted records.

---

## 5. Verification

- **Type-check + tests:** `cd frontend && npm run build` (tsc covers `src` + `tests`), then
  `node --import tsx --test tests/*.test.ts`. Baseline must stay green (pytest has 9 known
  pre-existing failures — not regressions).
- **Backend:** pytest for the new `/api/search`; route existence via `/openapi.json`; restart
  uvicorn (no `--reload`) after backend changes.
- **Headless-first:** pure helpers (camera framing math, search ranking/scoring, workview
  resolution) get unit tests so logic is covered without a display.
- **User-verified in-app:** manual checklist per WS; no agent screenshots as proof.
- **Never launch GUI windows on the live desktop** — headless/offscreen, or hand over a script.

---

## 6. Acceptance criteria (from both specs, mapped)

1. Chat-started task links to one canonical thread; task inspection never creates a new chat. (WS2)
2. Closing/reopening chat preserves thread + draft; World unaffected. (WS2)
3. World resident activity corresponds to a real event/record; no fabricated work. (WS4)
4. Selecting a Research room shows research context; Dev room shows dev context. (WS4)
5. A reviewed-but-not-applied candidate is never shown as applied. (baseline, keep)
6. Each decision shows triggering record, evidence, authority, next action. (baseline, keep)
7. Existing vault note is searchable/openable/citable unmodified. (WS5)
8. External Obsidian edit updates the index after watcher verification. (baseline)
9. Simultaneous edits surface a conflict, not silent overwrite. (baseline)
10. Unauthorized vault paths/secrets are not reachable via search or write. (WS5)
11. World camera reframes when inspector/chat opens; no canvas clipping. (WS3)
12. Offline vault shows unavailable/stale, never falsely connected. (WS5 `degraded[]`)
13. Changing projects preserves independent drafts and selection. (WS2/WS6)
14. User-created and autonomous projects share the portfolio, differentiated by origin. (WS4/WS6)
15. Global status/Attention reflect only persisted states and decisions. (WS1/WS7)

---

## 7. Risks

- **Work tab rename is wide** (union type + ids + tests). Mitigate with the legacy-redirect
  pattern and a structural test that every `WorkView` has a panel/button.
- **Perspective camera changes interaction math** — raycasting (`town-renderer-v2.ts:988`) and
  label projection (`:1322-1324`) assume the camera; re-verify hit-testing after the swap.
- **`/api/search` cost** — must not load whole tables per query; add indexed/`LIKE`-bounded
  store helpers and cap results.
- **Vault availability** — search must degrade, not fail.

---

## 8. Out of scope

- Obsidian vault on-disk restructuring or migration.
- Replacing working backend workflow/telemetry.
- Any change that forks the conversation store, work graph, or inspector.
- Fabricating data sources that don't exist (e.g. permission-request queue).

*Nothing in this repo was modified by writing this spec.*

---

## 9. Delivery record — bundled pass (2026-11-23)

All seven workstreams implemented. **Frontend: 259 tests pass, `npm run build` clean. Backend: 284 passed / 9 failed — the 9 are the documented chronic baseline, zero regressions.**

| WS | Delivered | Key files | Tests added |
|---|---|---|---|
| WS1 | Attention "Resolve in Memory" → `knowledge` (was blanking on removed `system`) | `attention-center.ts:143` | `tests/attention-routing.test.ts` |
| WS2 | In-World composer bar; Send hands off to the ONE chat (`hermes:open-in-chat` + `submit:true`); Attach/Workspace delegate to the real controls | `index.html`, `world-composer.ts`, `hermes-chat.ts` | `tests/world-composer.test.ts` |
| WS3 | Perspective "operations-centre" camera + `focusRoom`/`overview` + focus ring; readability (figure scale, lighting, fog); re-frame on panel open | `town-camera.ts`, `town-renderer-v2.ts`, `town-renderer.ts`, `town-view.ts` | `tests/town-camera.test.ts` |
| WS4 | Director identity panel (focus/project/recent/pending + 3 actions); work origin on resident card + room inspector | `director-panel.ts`, `index.html`, `town-view.ts` | `tests/director-panel.test.ts` |
| WS5 | `GET /api/search` aggregate (work graph + conversations + vault + library, explicit `degraded[]`) + top-bar field routing via nav intents | `search.py`, `app.py`, `global-search.ts` | `tests/test_search.py`, `tests/global-search.test.ts` |
| WS6 | Work tabs renamed to spec (Overview/Discoveries/Goals/Plans/Tasks/Builds/Reviews/Results); Results folded into Work; legacy deep links redirect; portfolio moved to Overview; new Reviews queue | `navigation-state.ts`, `index.html`, `work-workspace.ts`, `portfolio-view.ts`, `work-reviews.ts`, `phase41*.ts`, CSS | `tests/work-layout.test.ts`, `tests/navigation-url.test.ts`, `tests/selection-inspector.test.ts`, `tests/build-inspector.test.ts`, `tests/portfolio-view.test.ts` |
| WS7 | Narrow-screen nav drawer (toggle + scrim + Escape); permission-requests category documented as deferred, not faked | `main.v2.ts`, `index.html`, `unified-layout.css`, `attention-center.ts` | `tests/nav-drawer.test.ts` |

### Required to see WS5 live
The backend runs **without `--reload`** (`./start.sh`). `/api/search` is **not** in the running server's
`/openapi.json` until uvicorn is restarted. The frontend (Vite) has hot-reloaded every change.

### Manual verification checklist (user)
1. **Search:** top bar → type 2+ chars → grouped results; click a task/note/goal routes via the normal nav intents.
2. **World camera:** World shows a perspective 3/4 view; click a room → camera zooms to it (ring under it); close → overview.
3. **World composer:** type in the World bar → Send → the message lands in the conversation; Attach/Workspace open the chat panel.
4. **Director panel:** Home inspector shows Current focus / Associated project / Recent completed / Pending decisions + 3 working buttons.
5. **Work tabs:** Overview/Discoveries/Goals/Plans/Tasks/Builds/Reviews/Results all switch; old `?view=work&workview=planning` links land on Plans; `?view=results` lands on Work → Results.
6. **Drawer:** ≤1080px → ☰ opens the nav drawer; scrim/Escape/destination closes it.
7. **Attention:** a memory-review item's "Resolve in Memory" opens Knowledge (no blank pane).
