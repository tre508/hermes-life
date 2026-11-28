# plan.md — Three-Workspace UI Transformation (Home · Chat · Projects)

**Project:** Hermes Life ("Hermesha")
**Doc ID:** HL-UI-PLAN-001
**Type:** Implementation plan — delta from the current build to the desired UI
**Status:** Build in progress. Decision gates **G1–G2 RESOLVED** (2026-11-28, per user "go with your recommendations"); **G3–G5 open** (§3) — resolve before/while building the affected areas.
**Date:** 2026-11-28

**Desired-state authority:** `/run/media/gayzer/black/obsidian/new.md.md` — the "new UI" design (three distinct full-sized workspaces sharing one shell). This is the **only** spec this plan targets.
**Current-state evidence:** live code audit of `/home/gayzer/Apps/hermes-life` + the three current-UI screenshots (`chatscreenshot.png`, `projecttabscreenshot.png`, `landingpagescreenshot.png`).
**Explicitly NOT referenced:** the retired specs (`hermesha-unified-ui-spec.md`, `hermesha-ui-ux-obsidian-spec.md`, `hermesha-life-master-dev-spec.md`, etc.). They are removed and superseded. Where a prior **user decision** still governs (recorded in the implementation skill, not in a retired doc), it is named as "recorded decision" and surfaced in §3 rather than silently overridden.

---

## 0. What this is

`new.md.md` asks for **three native workspaces under one minimal shell**, each with its own character:

| Workspace | Purpose | Reference | Desired character |
|---|---|---|---|
| **Home / World** | Observe + interact with Hermesha's operational environment | Futuristic operations centre | Atmospheric, immersive |
| **Chat** | Communicate, collaborate, research, direct | ChatGPT | Conversational, minimal |
| **Projects** | Access/manage/edit hosted files & workspaces | VS Code | Technical, compact |

The design principle is explicitly **not** "make all three look identical" but "make them feel like three native capabilities of one application." This plan therefore (a) rebuilds the **shared shell + design system** once, then (b) lets each workspace adopt its own layout.

This is a **delta plan**. The recent HA-001→047 remediation left the app hardened and green (frontend `461/461`, backend `2 failed / 459 passed` = the guest-VM environment baseline). Much of the requested surface already exists in some form — notably the **Projects IDE** and the **Chat composer**. Each change item is tagged:

- **[EXISTS]** — already implemented; keep or lightly refine to match the design.
- **[CHANGE]** — exists but must be reworked to match the design.
- **[NEW]** — not present; build it.

---

## 1. Verified current state (grounded in code)

### 1.1 Shared shell
- **Grid** `#app` (`unified-layout.css:7`): `"header header header / nav main panel / status status status"`, rows `60px / minmax(0,1fr) / 36px`. So today: **top brand bar (60px) + LEFT nav rail + main + RIGHT inspector + status strip (36px)**.
- **Navigation is a LEFT rail** `#primary-nav` (`index.html:41`), grouped Experience / Operations / Intelligence / Eight-rooms, buttons keyed `data-workspace` (`index.html:47–67`). Rail collapses 220px ↔ 64px.
- **Workspace union** `navigation-state.ts:22`: `world | home | conversations | projects | attention | work | activity | results | system | knowledge | research`.
- **Top brand bar** (`.topbar`, `index.html:17`): brand block + centre "Hermesha Command Centre" pill + right-side `Search everything… (/)`, `Chat +`, `Project (35)`, `Logout`, `Passkey`.
- **Status strip** `#status-strip` → `#global-status` (connection, backend, last event, running counts) + `#status-ide-slot` (Projects IDE status, reparented, shown only in Projects).

### 1.2 Home & World (currently two separate destinations)
- `#workspace-world` (`index.html:110`, `data-layout="world"`): mounts `#game` (the 3D facility, `town-renderer-v2.ts`), `#world-room-panel`, `#world-composer`. This is the **immersive** view.
- `#workspace-home` (`index.html:143`, `data-layout="workspace"`): a **dashboard** — `#home-recent-events` (Recent activity) + `#home-current-*` (Current focus: Active / Recent task / Last outcome / Needs you) + CTAs. This is the **overview** view.
- **Inspector**: `#contextual-panel` (`index.html:621`) → `#ctx-home` + `#ctx-inspector` (`context-inspector.ts`, typed `SelectionKind` ring).

### 1.3 Chat
- `#workspace-conversations` (`index.html:402`, `data-layout="focus"`) → `#chat-focus-host`, which mounts the single chat root (`hermes-chat.ts`).
- Conversation sidebar (thread list, `thread-groups.ts`), conversation column, **composer** already three-band: entry / tools row (`＋ Attach` pill) / action row with **model selector (`#hc-model-button`) + usage chip (`Context: · Tokens: · Cost: · Balance:`) + Send** (`hermes-chat.ts` around 315–647). This matches the **recorded decision (2026-11-26/27)**: keep the model selector and usage metrics inline.
- Attachments (`chat-attach.ts`) = reference chips; execution trace (`tool-group.ts`, `trace-format.ts`); markdown (`chat-markdown.ts`).

### 1.4 Projects (already an IDE)
`phase412-project-ui.ts` already builds a VS Code-style surface into `#project-focus-host` (`index.html:411`):
- Activity bar `#hc415-activity` (monochrome glyph icons) with sidebar views `#hc415-view-explorer / -search / -scm / -settings` (`phase412-project-ui.ts:270–273`) — exactly the §4.1 activity-bar model.
- `#hc415-main` = editor head `#hc415-editor-head` + tab strip `#hc415-tabs` + stage `#hc415-stage` + bottom panel `#hc415-bottom` (CHANGES/ACTIVITY/… panes).
- `#hc415-file-sidebar` (explorer tree), `#hc415-ide-status` (workspace · version · files · sync chips).
- CodeMirror editor (`project-editor-lib.ts`, `@codemirror/*` deps in `package.json`).
So §4 (Projects/IDE) is **largely [EXISTS]** — the work is refinement to the exact proportions/sections, not a rebuild.

### 1.5 Design system
- **No central token layer.** Colours are hard-coded hexes scattered across `unified-layout.css`, `style.css`, `hermes-chat.css` (which has its *own* `--hc-*` palette), `chat-clarity.css`, etc.
- **Current palette is teal/mint/cyan** (e.g. `#0b1720` bg, `#82e2c0`, `#65cbaa`, `#9ce5c7`, `#90d7c8`). Top hexes are all teal-family.
- **`style.css` is a pre-unification prototype** with conflicting `:root` blocks (`style.css:1` monospace/teal, `:48` Inter/navy) and **bare-element selectors** (`aside`, `section`, `button`, `header`, `p`, `h1/h2`) that leak globally — a known hazard the implementation skill warns about repeatedly.
- **Typography:** Inter and JetBrains Mono are *already referenced* (`unified-layout.css:19`, `:951/956`) — partially aligned with the desired system.
- **Icons:** text glyphs / emoji (`◈ ◉ ⬒ ▤ ⚗`), not Lucide.

### 1.6 Build & test health (do not regress)
- Frontend `npm run build` ✅ (type-checks src + tests). Node suite **461 pass / 0 fail**. **Structural tests read the shipped files** and assert ids/selectors/layout (`chat-audit-layout.test.ts`, `phase3-ide-surfaces.test.ts`, `navigation-url.test.ts`, etc.) — any shell/id/CSS restructure must rewrite the affected assertions to the new contract (never delete them).
- Backend pytest **2 failed / 459 passed** (guest-VM baseline). Backend routes under `/api/*`; new routes need a backend restart + `/openapi.json` verification.

---

## 2. The gap at a glance (current → desired)

| Layer | Current | Desired (`new.md.md`) | Verdict |
|---|---|---|---|
| App nav | Left rail (Experience/Operations/Intelligence/8 rooms) | **Compact top bar** `HERMESHA · Home Chat(→Chat,Projects) Work Activity Knowledge Research · ●Online ◉2 ⚙` | **[CHANGE]** shell restructure |
| Home vs World | Two destinations (`world` immersive + `home` dashboard) | **One "Home = Living Command Centre"**, 3D world is hero, overview → inspector | **[CHANGE]** merge |
| Chat | Good conversation + composer (model + metrics) | ChatGPT-style; keep composer; add Tools/Mic; execution cards; memory actions | mostly **[EXISTS]**, refine |
| Projects | Already an IDE (activity/explorer/tabs/bottom/status) | Exact VS Code proportions + SCM + file menus + empty states | mostly **[EXISTS]**, refine |
| Design system | Scattered teal hexes, prototype `style.css` leaks | **Central token layer**, navy/slate + indigo, Inter + JetBrains Mono + Lucide, 48–56px header, 28px status, 6–8px radii | **[CHANGE]** re-theme |
| Settings | No top-level destination | Top-level **Settings** nav item | **[NEW]** |
| Status | 36px strip | 28px, compact authoritative indicators | **[CHANGE]** |
| Cross-workspace | Event stream exists (`hermes:event`, `/ws/events`) | Shared event stream + cross-links + preserved state | mostly **[EXISTS]**, wire |

---

## 3. Decision gates (resolve before / while building)

These are places where `new.md.md`'s sketch collides with a **recorded user decision** or a **structural test**. Per how this project works, the newest sketch is *not* automatically authoritative — each needs an explicit pick. Recommendations included.

- **G1 — Chat/Projects navigation grouping.** `new.md.md` §2 shows Projects **nested under a "Chat" destination as a sibling tab** (`Chat | Projects`). The **recorded decision (2026-11-26)** is that Chat and Projects are **two equal, TOP-LEVEL peer workspaces, neither nested in the other** — and `phase3-ide-surfaces.test.ts` / nav tests encode "two equal top-level workspaces, not nested." Adopting the tab model reverses that decision and requires rewriting those tests.
  - *Recommendation:* keep them **peers in the top bar** (`… Chat  Projects …`) and use the `Chat | Projects` tab row only as an in-page switcher if you want the visual grouping — this satisfies the "sibling tabs" *feel* without nesting one workspace inside the other or breaking the peer invariant.
  - **RESOLVED 2026-11-28** (user: "go with your recommendations"): **keep Chat & Projects as top-bar peers**, with an in-page `Chat | Projects` tab row for the grouping look. Neither workspace is nested inside the other. Peer invariant + its structural tests stay in force (rewrite the shell-facing tests to the new top-bar contract; do not weaken the "not nested" assertions).

- **G2 — Composer metrics.** `new.md.md` §3.3 sketch shows `+  Tools ▾  Model ▾  Mic ↑` (Model kept, **no usage metrics**, adds Tools + Mic). The **recorded decision (2026-11-26/27)** is to **KEEP the model selector AND the inline usage chip (Context · Tokens · Cost · Balance)** and NOT strip/move them. Removing them would read as a misread of your earlier chat audit.
  - *Recommendation:* **keep the metrics + model selector**, and ADD the `Tools ▾` menu and `Mic` as new controls on the action row.
  - **RESOLVED 2026-11-28** (user: "go with your recommendations"): **keep the model selector + inline usage metrics** (Context · Tokens · Cost · Balance) and **add** a `Tools ▾` menu + a `Mic` control to the composer action row. The three-band composer shape stays.

- **G3 — "Eight rooms · shared map" nav section.** `new.md.md`'s nav tree omits it; the **recorded decision** keeps the 8 room links (integral to the app).
  - *Recommendation:* **keep** the room links (they deep-link into Home/World focus). Fold them under Home or into a secondary menu so the top bar stays compact. Low risk.

- **G4 — Settings scope.** `new.md.md` adds a top-level **Settings** destination but doesn't spec its contents. Today there is **no** Settings workspace (`navigation-state.ts:22` has none; no `data-workspace="settings"`).
  - *Recommendation:* build a **Settings workspace shell** first (reachable, with sections for the existing settings surfaces), and scope its contents in a follow-up. Don't block the shell on a full settings product.

- **G5 — Home/World ownership.** Confirm that the new "Home" **absorbs** the current immersive `world` (the 3D scene becomes Home's hero) and the current `home` dashboard data moves into the **inspector / status**, rather than both staying as separate nav items.
  - *Recommendation:* merge as `new.md.md` §2 describes. This is the cleanest read of the design.

---

## 4. Change plan

> Build order: **4.2 design tokens → 4.1 shell → 4.3 Home → 4.4 Chat → 4.5 Projects → 4.6 integration → 4.7/4.8.** Tokens first so every surface is re-themed once, not restyled repeatedly. Verify each increment (§6) before the next.

### 4.1 Shared shell & navigation  ·  **[CHANGE]**
1. **Replace the left nav rail with a compact top nav bar.** Rework `#app` grid (`unified-layout.css:7`) from `"header / nav main panel / status"` to a **top bar + content + bottom status** shell. Keep `#global-status` ids intact (styles/tests key off them).
   - Top bar (48–56px): brand `◈ HERMESHA` · primary nav (`Home · Chat · [Projects] · Work · Activity · Knowledge · Research · Settings`) · right cluster (`● Online`, `◉ <active ops>`, `⚙`).
2. **Nav destinations** = `Home, Chat(+Projects per G1), Work, Activity, Knowledge, Research, Settings`. Re-point `data-workspace` buttons in `index.html:47` and `openWorkspace()` in `navigation-state.ts`/`main.v2.ts`.
3. **Merge World + Home** (per G5): one `home` destination carrying the 3D scene; retire the standalone `world` nav entry (deep-links to rooms still land on Home + focus). Update the `Workspace` union (`navigation-state.ts:22`) and `WORKSPACES`.
4. **Add `Settings`** to the union + a nav button + a workspace section (G4 shell).
5. **Rehome the current top-bar utilities** (global search `/`, Chat/Project shortcuts, Logout, Passkey, account) into the new top bar / `⚙` area without losing any control (the "never hide a panel's only launcher" rule).
6. **Status strip → 28px**, compact authoritative indicators (§8: no large decorative status). Keep `#status-ide-slot` behaviour (Projects status shown only in Projects).
7. **Rewrite structural tests** that assert the old rail/grid/peer shape to gate the new shell (assert new destinations present, folded ones deep-linkable). Never delete the assertions.

### 4.2 Design system (tokens, palette, type, icons, chrome)  ·  **[CHANGE]**
1. **Introduce a single token layer** (`:root` custom properties) — the source of truth every stylesheet consumes. Replace the scattered hard-coded hexes and the conflicting `:root` blocks in `style.css:1`/`:48`.
   - Palette (from `new.md.md`): `--bg #0B0E14`, `--surface #11151D`, `--surface-2 #171C26`, `--elevated #202633`, `--border #252D3A`, `--text #E5E9F0`, `--text-2 #939CAB`, `--accent #7C8CF8`, `--active #38BDF8`, `--success #34D399`, `--warning #FBBF24`, `--error #F87171`.
   - This is a **teal → navy/indigo re-theme**. Collapse `hermes-chat.css`'s separate `--hc-*` palette onto the shared tokens (or alias them) so chat matches the app.
2. **Typography:** Inter (UI) + JetBrains Mono (editor/technical) — both already referenced; standardize and set the base `font-family` on the token.
3. **Icons → Lucide.** Replace the text glyphs/emoji (`◈◉⬒▤⚗`) in the nav/IDE/controls with Lucide icons.
4. **Geometry:** control radius 6–8px; panel separation = subtle 1px borders; header 48–56px; status 28px; per-page proportions (Home: world 75–80% + inspector 280–340px; Chat: sidebar 240–280px + reading column max 800–960px; Projects: activity 44–48px + explorer 240–300px + bottom panel 180–260px).
5. **Neutralize `style.css`'s bare-element prototype rules** (or scope them with `:where()`) so new surfaces don't inherit prototype sizing — a recurring, measured bug in this repo.
6. **Restrained, state-driven animation** only (no gradients/glow/decorative cards — §8).

### 4.3 Home — The Living Command Centre  ·  **[CHANGE + EXISTS]**
1. **Make the 3D World the primary content** of Home (`new.md.md` §2.1): the scene fills the viewport; no dashboard framing around it. Merge the current `home` overview data (Recent activity / Current focus) into the **inspector** and **status bar** so it survives without a separate dashboard.
2. **World controls overlaid on the viewport** (not a big toolbar): Overview / Focus / Follow activity / Reset camera / Zoom / Fullscreen / Activity-bubbles toggle (`new.md.md` §2.1 table).
3. **Contextual inspector** (right, 280–340px, collapsible) — content changes by selection (Hermes / resident / room / workstation / bubble / task) per `new.md.md` §2.3. This maps onto the existing `context-inspector.ts` typed-selection ring — **extend it**, don't build a second inspector.
4. **Live agent bubbles as compact execution cards** (not speech balloons) per §2.2 — populated from **real runtime events only** (never invented activity). The bubbles infra (`town-world/bubbles.ts`, `tool-group.ts`) exists; restyle the bubble into the §2.2 card and keep call/result correlation.
5. **Camera**: auto-reframe on inspector open/close (the `ResizeObserver` → `resize()` seam already exists — reuse it), focus transitions, follow-activity that doesn't override manual inspection.
6. Preserve existing room layout + resident identities (the design's rooms are conceptual; keep the real ones).

### 4.4 Chat — Conversational workspace  ·  **[EXISTS → refine]**
1. **Conversation sidebar** (240–280px): New conversation, Search, Pinned / Today / Yesterday / Previous 7 days / Archived (the `thread-groups.ts` grouping exists — align labels/sections to §3.1).
2. **Empty state** (§3.2): clean, centred composer only — **no mandatory project selection, no config form, no file dashboard, no suggested-prompt cards**.
3. **Composer** (§3.3): keep the three-band shape + **model selector + usage chip (per G2)**; ADD `Tools ▾` and `Mic`. Attachment menu = `Upload from device / Browse hosted files / Browse hosted directories / Attach registered project / Recent attachments / Generated artifacts` (extend `chat-attach.ts`). Preserve unsent drafts + attachments across Chat↔Projects switches.
4. **Agent execution in Chat** (§3.4): a compact execution card (`✓ Inspected repository … ● Running …  Show execution details ▾`) that expands to a timestamped tool log + "Open in Activity". **Reuse the same event records as Home** — one execution-tracking system, no duplicate.
5. **Persistent memory as contextual actions** (§3.5): per-message menu (view remembered context, inspect related conversations, correct memory, exclude from future memory, save to Knowledge) — contextual, not permanent panels.
6. **Reading column** capped (800–960px), centred regardless of width; message spacing 20–28px.

### 4.5 Projects — IDE workspace  ·  **[EXISTS → refine to spec]**
1. **Activity bar** (44–48px): Explorer / Search / Source control / Agent activity / Settings (§4.1) — verify all five views render and swap the sidebar correctly (`hc415-view-*` already exist).
2. **Explorer** (240–300px, resizable): tree with modified markers (`M`/`A`/`D`), workspace menu (Open Folder / Open Workspace / Recent / Add / Close / Register as Project), OUTLINE/TIMELINE sections (§4.2).
3. **File context menu** (§4.3): Open / Open to Side / Rename / Move / Copy Path / Delete / **Attach to Chat / Explain / Review with Hermes** / View Changes / View File History. Attach fills the Chat composer **without auto-sending**.
4. **Editor** (§4.4): tabs (35–38px) + breadcrumbs (24–28px) + multi-type presentation (code / JSON-YAML / Markdown source-preview-split / images / PDF / logs / binary-info / diff). CodeMirror is already the editor — **do not swap to Monaco** (the design explicitly says don't replace a working editor).
5. **Source control view** (§4.5): branch, commit box, CHANGES / STAGED / HISTORY / **AGENT CANDIDATES** (clearly distinct from real git changes) + the indicator table.
6. **Bottom panel** (180–260px, collapsible/resizable, remembered independently of Chat): TERMINAL / CHANGES / OUTPUT / ACTIVITY / PROBLEMS (§4.6). Terminal only if a restricted host-execution mechanism supports it.
7. **Empty state** (§4.7): activity bar + "No workspace open" + Open Folder / Open Workspace + Recent Workspaces. (Analogous empty states exist — align copy/layout.)
8. **Status row**: branch · host connected · changes · workspace synced · Ln/Col · UTF-8 · language (the `hc415-ide-status` chips exist — align to §4's status bar).

### 4.6 Cross-workspace integration  ·  **[EXISTS → wire]**
Implement the §5 interaction table against the **existing shared event stream** (`/ws/events`, `hermes:event` fan-out) — no second tracking system:
- Send task from Chat → visible on Home; click resident on Home → opens execution details.
- Hermes modifies a file → Projects reflects it live; click file link in Chat → opens the Projects tab; attach from Projects → appears in Chat composer.
- Switch Chat↔Home↔Projects preserves conversation, drafts, open files, unsaved edits, running operations.
- An error or a pending approval updates Home + Chat + Activity together.

### 4.7 Responsive behaviour  ·  **[CHANGE]**
Implement the §6 matrix (1920+ / 1440 / 1024 / 768 / mobile): Home overlay inspector at 1024, Chat collapsible history, Projects collapsible explorer, mobile Projects = file browser + single-file viewer (don't squeeze the desktop IDE onto a phone). Verify geometry in **Firefox** (the user's engine) per §6, not only Chromium.

### 4.8 Persistent state  ·  **[EXISTS → wire]**
Implement the §7 table (camera position, selection, inspector visibility, active conversation, scroll, drafts, attachments, selected workspace, expanded dirs, open tabs, unsaved edits, cursor, bottom-panel state — plus running ops / connectivity / auth / approvals globally). Navigation must never destroy workspace state. Some of this survives via "hidden, never unmounted" workspaces — audit and complete it.

---

## 5. What to avoid (anti-patterns the design calls out — §8)

- Dashboard cards around everything → continuous surfaces.
- Oversized headers → compact top nav.
- Multiple nested containers → independent workspace layouts.
- Permanent config forms → contextual menus/settings.
- Large decorative status → compact authoritative status.
- Separate chat systems / repeated execution histories → one conversation service, one runtime event record.
- Mandatory project-centric conversations → general-purpose chat.
- Simulated agent activity → real backend-driven visualization.
- Manual refresh requirements → event-driven updates.
- Permanently open inspectors → contextual, collapsible.

---

## 6. Build constraints & verification (from the project's implementation rules)

- **Verify every increment:** `cd frontend && npm run build` (type-checks src+tests), then `node --import tsx --test tests/*.test.ts` (must be 100% green; do not glob `--test tests`). Backend: pytest for backend changes.
- **Structural tests encode approved structure** — when a shell/id/layout restructure supersedes one, **rewrite the test to gate the new contract**, never delete it and never revert the code to satisfy a stale test. Grep `tests/` for forbidding assertions before restructuring `index.html` / `unified-layout.css`.
- **User verifies UI himself in the running app.** Ship a runnable state fixture per surface (`frontend/harness/<name>.html`, gate-free, one card per state) rather than agent-side screenshots.
- **Firefox first** for geometry (the user's engine); Chromium-only "correct" is not proof. The entrance gate blanks data-dependent text headless — measure geometry, not `innerText`.
- **Known CSS traps** (this repo, measured): cascade order is not file order (runtime-injected module CSS beats links at equal specificity); the `[hidden]`-beats-`display` trap (guard every toggled region with `[hidden]{display:none!important}`); bare-element rules in `style.css` leak onto new elements; a grid inside a flex host needs `grid-template-rows:minmax(0,1fr)`.
- **Backend changes** need a restart + `/openapi.json` check. Frontend hot-reloads.

---

## 7. Acceptance criteria (maps to `new.md.md`)

- [ ] Shell is a compact **top nav bar**; three workspaces are distinct full-size layouts sharing one visual identity.
- [ ] **Home** = immersive 3D World as primary content + contextual inspector + overlaid world controls; bubbles are compact execution cards driven by real events.
- [ ] **Chat** is ChatGPT-like: sidebar + centred reading column + composer (model + metrics kept per G2, Tools/Mic added); execution cards; memory as contextual actions; empty state with only the composer.
- [ ] **Projects** is a full VS Code layout: activity bar (5 views), explorer, editor tabs + breadcrumbs, SCM with agent candidates, bottom panel, status row, empty state.
- [ ] Design system is tokenized (navy/slate + indigo), Inter + JetBrains Mono + Lucide, header 48–56px, status 28px, radii 6–8px; no teal residue, no prototype leaks.
- [ ] Top-level **Settings** destination reachable.
- [ ] Cross-workspace table (§5) works on one shared event stream; state preserved across switches (§7).
- [ ] Responsive matrix (§6) holds; verified in Firefox.
- [ ] Anti-patterns (§8) absent.
- [ ] Build green: `npm run build` ✅, node suite 100%, structural tests gate the NEW shell (rewritten, not deleted).

---

## 8. Decision log

| # | Decision | Status | Resolution |
|---|---|---|---|
| G1 | Chat/Projects: top-bar peers vs tabs-nested-under-Chat | **RESOLVED** | Peers in top bar + in-page `Chat|Projects` tab row (2026-11-28) |
| G2 | Composer: keep inline usage metrics? | **RESOLVED** | Keep model + metrics; add Tools + Mic (2026-11-28) |
| G3 | Eight-rooms nav section present? | **OPEN** | — (recommend keep, folded for compactness) |
| G4 | Settings destination scope | **OPEN** | — (recommend shell now, contents follow-up) |
| G5 | Home absorbs immersive World? | **OPEN** | — (recommend merge per §2) |

*Prior recorded decisions that remain in force unless a gate above says otherwise:* chat is never pre-attached to a project; project registration ≠ attachment; file delete is soft (`.trash`); Chat and Projects mount as hidden-not-unmounted peers; one conversation system (`hermes-chat.ts`); one inspector ring (`context-inspector.ts`).

---

## 9. Build progress

**Increment 1 — 2026-11-28** (verified: `npm run build` ✅, node suite **462 pass / 0 fail**, was 461):

- **G2 DONE.** The composer action row now carries `Tools ▾` + `Mic` alongside the preserved model selector + usage metrics (three-band shape intact).
  - `Tools ▾` opens a popover (`#hc-tools-popover`) hosting the **real file-access mode** control, consolidated out of the tools row (its `#hc-attach-mode` id is preserved so `chat-markdown-images.test.ts` stays green). Open-then-render so a render error can't hide it.
  - `Mic` is **real Web Speech dictation** into `#hc-input`, auto-disabled with a tooltip where the engine is unsupported (e.g. Firefox) — never a dead control.
  - Files: `hermes-chat.ts`, `chat-attach.ts`, `hermes-chat.css`; new gate test in `tests/chat-audit-layout.test.ts`.
- **§4.2.1 design-token layer DONE.** The `new.md.md` palette/type/geometry is now a `:root` token block in `unified-layout.css`; the `#app` shell base consumes `--hl-text / --hl-bg / --hl-font-ui`. Verified additive (462/462).

**Next — G1 top-bar shell restructure (§4.1).** G1's build is the left-rail → top-bar move. Its *contents* depend on the still-open G3–G5 (where the eight-room links go, whether Settings is a destination, whether Home/World merge). Resolve those, then: restructure `#app` grid + relocate nav → top bar (Chat & Projects as peers + the in-page `Chat|Projects` tab row), rewrite the shell-facing structural tests to the new contract, and migrate surfaces onto the tokens (the visible re-theme).

**Deferred / offered:** a runnable composer state fixture (`frontend/harness/…`, gate-free) showing Tools/Mic states — ask if wanted. Mic voice dictation is browser-native (no backend); if you want a server-side speech pipeline instead, that's a backend addition.

**Increment 2 — 2026-11-28 · G1 top-bar shell (§4.1)** (verified: `npm run build` ✅, node suite **465 pass / 0 fail**):

- Left rail replaced by **one horizontal top navigation row** (`#primary-nav`, under the 60px header). Grid is now header / nav row (44px) / main + inspector / status (36px); the `220px`/`64px` rail columns and all their variants are gone.
- **G1 applied:** Chat and Projects are peers inside one segmented group (`.hc-segment`), neither nested in the other.
- **G3 applied:** the eight physical rooms fold into an `Eight rooms ▾` menu (`details.hc-rooms-menu`); all 8 deep links remain.
- **G4 applied (shell only):** `Settings` is a top-level destination (`navigation-state` union + `workspace-settings` section). Contents are a stated follow-up, not invented.
- Retired with the rail: the nav collapse toggle, the narrow-screen drawer and its scrim. Narrow screens now scroll the nav row horizontally.
- Inspector grip and overlay offsets moved to 104px / 114px to clear the nav row.
- Tests: `nav-drawer.test.ts` rewritten to the new contract (its drawer assertions no longer describe the shell; the attention deferral assertion is kept verbatim). New `top-nav-bar.test.ts` pins grid rows, peer grouping, the rooms menu, Settings, and the grip offsets.

**Still open after increment 2:**
- **G5 (World/Home merge) NOT done.** World and Home remain separate destinations. It's decoupled from the top bar, so it's a separate step.
- **Header (60px) and status strip (36px) NOT changed** to the §4.1 52px / 28px targets. Changing them touches the inspector offsets and status ids, so I held them for a dedicated pass.
- **Token migration is partial.** Only the `#app` base consumes `--hl-*`. The nav row still uses the legacy teal hexes. The full re-theme is still to do.
- **Not verified in a real browser.** Geometry is checked by build and structural tests only. It needs a look in Firefox (the user's engine) before it's called done.

**Increment 3 — 2026-11-28 · cascade fix (live screenshot showed the old rail)**

- Root cause: `src/command-centre.css` (loaded AFTER `unified-layout.css`) still carried the Phase-4 rail skin: `185px/288px` and `150px`/`58px` column grids, a `54px` row, and vertical `display:block` nav buttons. Same specificity, later in the cascade, so it overrode the top-row rules. The rendered page showed the new nav markup inside the old left column.
- Fix: removed every rail-width grid rule and the vertical nav-button rules from `command-centre.css`; the nav row rules now live there as the top-row skin. Narrow breakpoints use the two-column grid (`minmax(0,1fr) 0`).
- Header: the header actually renders at 54px (command-centre's row), so the shared grid now says 54px, not 60px. Grip and overlay offsets moved to 98px / 108px to match.
- Verified: build ✅, node suite 465 pass / 0 fail. Not verified visually in a browser: the entrance gate blocks headless screenshots, so the layout needs a look in your running app.
- Lesson for this repo: a grid or nav rule that "works" in isolation can still be overridden by a later stylesheet. Check every stylesheet that targets the same selector before trusting a layout change.

**Increment 4 — 2026-11-28 · chat trace regression (resolved, no code change)**

- Symptom: hermes-life chat turns failed before any tool call, so no reasoning or tool-call trace streamed.
- Root cause: the registered project spec (`hl_projects.spec_path` = `hermesha-life-master-dev-spec.md`) was missing from disk. `hermes_life/project_knowledge.py:109` fails closed on a missing registered spec, by design.
- Fix: the spec file was restored at the registered path (HL-SOT-002, 115,624 bytes, under the 250 KB `MAX_FILE` limit). Registration unchanged. Confirmed by a direct read and excerpt check.
- Confirmed by the user: the chat stream returns. Trace rendering was not changed.
- Operational note: if the spec is removed again, every hermes-life turn fails with "Registered specification is missing". Keep the file or clear `spec_path` deliberately.

**Increment 5 — 2026-11-28 · G5 merge: World + Home are one Home destination**

- The 3D command centre is the single Home hero. Its section is now `#workspace-home` (`data-layout="world"`). The old separate overview section is gone.
- The overview strip (Recent activity and Current focus, ids unchanged) moved to a sibling inspector block `#ctx-overview`. It shows whenever Home is active, so a room pick does not hide it. `#ctx-home` keeps its room and persona role.
- Nav: the World button is removed. Home is the destination. The eight room links deep-link to Home.
- `world` is no longer a `Workspace`. Old `?view=world` links are aliased to `home` in `parseNavQuery`. The default landing and `selectRoom` use `home`.
- Layout: Home uses the world layout (canvas plus inspector).
- Tests: updated the five files that named the old destinations. Added a G5 contract test to `top-nav-bar.test.ts`.
- Verified: build passes; suite 466 pass, 0 fail.
- NOT verified in a browser: the entrance gate blocks headless screenshots. Needs a look in your running app: canvas size, inspector overview placement, and room selection with the overview still visible.

**Increment 6 — 2026-11-28 · §4.3.1 the 3D world fills Home**

- Decision (user, 2026-11-28): fill the viewport, drop the locked 2.85:1 box.
- Change: `#game` no longer has `aspect-ratio: 2.85/1`. It fills the Home area (`flex: 1`). The heading and composer float over the scene (absolute, translucent). CSS only.
- Why it works: the renderer already re-fits to the host box's aspect (`town-renderer-v2` resize -> `frameBounds(aspect = rect.width/rect.height)`), and a ResizeObserver triggers it.
- Verified: build passes, suite 466 pass / 0 fail. The `world-framing` tests already measure fill across aspect ratios, which supports this.
- NOT verified in a browser (gate blocks headless). Hard reload needed: the public domain caches stylesheets for 4 hours (`max-age=14400`).
- Still open in §4.3: 2 world controls overlaid on the viewport, 3 inspector selection types, 4 execution-card bubbles, 5 camera follow/focus behaviour, and the status-bar overview.

**Increment 7 — 2026-11-28 · §4.3.2 world controls overlaid on the viewport**

- Overlaid top-right on the Home box: Overview (reset camera), Focus room (last selected room, disabled until one is picked), Fullscreen (toggles, reflects state).
- Architecture: `world-controls.ts` emits `hermes:world-camera` intents only. `town-view.ts` executes them via the renderer's existing `overview()` and `focusRoom()`. Camera logic stays in one place.
- Not offered, because the renderer has no support: Zoom, Follow activity, on-canvas Activity-bubbles toggle. The Motion toggle and the Roles/Bubbles disclosures already live in the status strip, so they were not duplicated.
- Verified: build passes; suite 466 + new controls contract tests, 0 fail.
- NOT verified in a browser (gate blocks headless). Needs a look: Focus enabling after a room click, Overview returning the camera, Fullscreen re-fitting the scene.

**Increment 8 — 2026-11-28 · §4.3.3 contextual inspector selection types**

- The existing typed-selection ring (`context-inspector.ts`) is extended, not duplicated.
- Hermes: already covered. Hermes is a resident and uses the resident card. No change.
- Resident and room: unchanged, existing cards.
- NEW `bubble` kind ("Execution event"): a World bubble click dispatches `hermes:bubble-select` (`town-world/bubbles.ts`). The inspector card shows only recorded fields: headline, category, shown-for role, tool name and target, status, sequence, start/end times, details. "Open task" appears only when a task id exists. The executing resident is never inferred (UI-VIS-007). Content was already redacted at creation.
- NOT built: `workstation` selection (no desk hit-test exists in the renderer) and `task` on Home (the task renderer lives in the Work domain, so a Home task card needs its own record path). Both stay open.
- Verified: build passes; suite 474 pass, 0 fail (new `world-inspector.test.ts`).
- NOT verified in a browser. Needs a check: click a bubble, see the event card, dismiss it, confirm the room card returns underneath.

**Increment 9 — 2026-11-28 · chat flicker, Stop, silent Home submits (diagnosis + fixes 1-2 of 4)**

Diagnosis (static code reading; NOT reproduced live, the entrance gate blocks headless):
- Flicker: `pollTask` (1.5s) called `setRunning` every tick, rewriting the Send button's markup; the 3s trace poll force-redrew the live trace even when its steps were unchanged.
- No Stop on Home: the Home composer had no Stop control at all. Chat's own Stop path exists (Send becomes Stop, progress strip, cancel route).
- Home submits silently ignored: Chat drops a submit while a task runs, but Home still said "Sent".
- Not a cause: the backend `in_progress` state (it belongs to portfolio milestones, not chat tasks).
- Still open: Home sends continue the last conversation (the stored conversation id is always reused unless the user clicks + New in Chat). Home has no new-conversation intent. Fix 3.

Fixes applied:
- `setRunning` is change-only (touches the DOM and dispatches `hermes:chat-running` only on a real change).
- Trace refresh skips an unchanged read.
- Home: Stop button beside Send, shown while Chat runs; it dispatches `hermes:chat-stop`, which Chat handles with its own cancel handler.
- Home refuses a submit while a task runs, with a status message, instead of a silent no-op.
- Tests: `chat-flicker-stop.test.ts` (5 contracts). Suite 479 pass / 0 fail. Build passes.
- NOT verified live: whether the flicker is gone and Stop appears in a real run. Needs the DevTools console output from the user.
- Remaining from diagnosis: fix 3 (Home new-conversation intent), fix 4 (Home live conversation panel per uichange.md §2).

**Increment 10 — 2026-11-28 · Home conversation slot (fix 3 of 4)**

- Home keeps its own conversation slot: `hl-home-conversation` in localStorage holds the canonical thread id (uichange.md §8). Only Home-initiated sends set it (`homeSendPending`), so a Chat-tab send never moves it.
- Home submit: continues the slot's conversation when set (`conversation_id`), otherwise starts a new one (`new_conversation`).
- Chat honours `new_conversation` (clears the stored conversation before opening and submitting), and announces the conversation id via `hermes:chat-conversation` after each accepted send.
- Home gets an explicit "＋ New" control that clears the slot. It is refused while a task runs.
- Tests: `home-conversation-slot.test.ts`. Suite 484 pass / 0 fail. Build passes.
- NOT verified live. Known limit: if the slot's conversation was deleted in Chat, the next Home send will fail to open it. Needs handling with fix 4.
- Remaining: fix 4, the Home live conversation panel (uichange.md §2). Home still opens the Chat panel on send, so the "open the Chat tab" flow is not yet fixed.

**Increment 11 — 2026-11-28 · Home live conversation panel (fix 4 of 4; uichange.md §2–§3)**

- State A (no slot): the floating Home composer, World full width (unchanged).
- State B (live): a left conversation column (340–400px) appears in Home. The World and inspector stay. The SAME chat root is moved into it (`hostChatRootIn`), so there is one chat instance, one thread and one draft.
- State minimized: the panel hides, the session keeps running, and a "Resume" control appears in the composer.
- Finish: releases the Home slot. The conversation stays in Chat history.
- Open in Chat: switches to the Chat workspace. The chat root moves back to the Chat host.
- Module split: `home-slot.ts` (pure storage, no imports) for the thread id; `home-conversation.ts` for the panel, placement and states; the composer requests session changes via `hermes:home-session` events and never imports the chat.
- Placement rule (one function, `sync()`): the panel shows only when live, not minimized, and on Home; the chat root lives in the Home panel only then.
- Grid: `#app.layout-home.home-live` switches to a 3-column layout with the conversation in a new `conv` area.
- Status copy now says the reply streams "into the live conversation on the left", replacing "the conversation panel is open".
- Tests: `home-live-conversation.test.ts` (6 contracts). Suite 490 pass / 0 fail. Build passes.
- NOT verified in a browser (gate blocks headless). Visual checks needed: the chat fills the Home panel, the overrides in `command-centre.css` (`#home-conversation-body #hermes-chat-root`/`#hc-panel`, with `!important`) do not break the chat, and the grid holds at 1440px.
- Known limits: (1) at narrow widths (≤1000px) the 3-column live layout is not adapted. (2) The chat's own close button inside the Home panel hides the chat body but leaves the session live; Minimize is the intended action. (3) A slot whose conversation was deleted in Chat will fail to open on the next Home send.

**Increment 12 — 2026-11-28 · palette: the app adopts the chat's teal (user decision)**

- Method: a mechanical hue remap of every hardcoded blue, indigo and purple colour (hue 200–300°) in the app stylesheets (`src/*.css`, `index.html` inline) into the chat's teal family (185–207°). Lightness and saturation are preserved, so the hierarchy holds. Reds, ambers, greens and the existing teal/mint (semantic colours) are untouched. 325 colour values changed.
- Backup of the pre-change stylesheets: `/home/gayzer/.hermes/cache/scratch/palette-backup/`.
- Verified: build passes; suite 492 pass / 0 fail. No test pinned a palette value.
- NOT changed (separate design surface): the 3D World's colours in TypeScript. `town-renderer-v2.ts:823` (starfield/nebula canvas gradients), `:890` (fog `0x0a1220`), `town-renderer-3d.ts:178` (fog `0x0d1b30`), plus ~53 hex and ~67 `0x` literals across `town-*.ts`. The purple-blue around the World is mostly this scene backdrop, so it still needs a decision.
- NOT verified in a browser. Needs a hard reload (the stylesheets are cached up to 4 hours by the public domain).

**Increment 13 — 2026-11-28 · Home sends start a new conversation (user decision)**

- Decision: every Home send starts a new conversation. The previous Home thread stays in Chat history. Resume and the Chat tab reach older threads.
- Change: Home clears its slot and sends with `new_conversation`. The old behaviour (continue the slot) is removed.
- Root cause of the "append to last conversation" complaint: the slot persisted the old thread, so Home sends continued it. The 503 and 409 earlier were separate (transport and the global agent lock).
- Verified: build passes; suite 492 pass / 0 fail. Not verified live: the send itself, after the transport fix. Needs a live check.

**Increment 14 — 2026-11-28 · backend worker config was never exported**

- `start.sh` sourced `config/hermes-life-host.env` and `config/hermes-life-lenovo.env` with a plain `.`, so the variables stayed shell-local and never reached uvicorn. The backend ran in local transport, looked for the Hermes CLI on the NUC, and every chat send returned HTTP 503 "Hermes CLI unavailable".
- Fix: both sources wrapped in `set -a` / `set +a`. Created `config/hermes-life-lenovo.env` (transport=ssh, worker glenn@192.168.178.37, key path, guest home; no secrets).
- Verified: the running backend has `HERMES_LIFE_TRANSPORT=ssh`; the adapter reports `available=True` with ssh.
- Open: `config/hermes-life-host.env` does not exist, so the log says "vault may not resolve".

**Increment 15 — 2026-11-28 · processing glitch: event-driven UI rebuilds coalesced (unverified)**

- Finding: each `hermes:event` ran `renderUi()` synchronously (`town-view.ts` onEvent), which replaces the activity rows and rebuilds the inspector body. A run emits many events a second, so the DOM was rebuilt continuously.
- Change: event-driven updates are coalesced to one `renderUi()` per animation frame (`scheduleRenderUi`). Data unchanged.
- Also observed (not yet explained): one `WebGL context was lost` in the console (`town-renderer.ts`, reported by three.js). The renderer is created once per mount, so the cause is still open.
- Verified: build passes; suite 492 pass / 0 fail. NOT verified: whether the glitch is gone. Needs a live measurement during a run (see snippet given to the user).

