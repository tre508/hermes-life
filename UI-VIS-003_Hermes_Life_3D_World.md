# UI-VIS-003 — Hermes Life 3D World

**Type:** Development specification / implementation milestone
**Priority:** UI enhancement (visual layer only)
**Status:** In progress — milestones 0–4 complete; milestone 5 (validation) not started
**Scope:** Frontend visualization only (`frontend/src/town-*`, `frontend/index.html` canvas host, `frontend/package.json`)
**Depends on:** UI-VIS-002 (the town model and adapter, already implemented), existing Hermes Life task/event APIs
**Supersedes:** UI-VIS-002 §3 (Visual structure and scene) and §8 (Art, animation, and performance). Everything else in UI-VIS-002 — the non-negotiable boundaries (§2), the model contract (§4), the activity mapping (§5), the interactions (§6), event handling and recovery (§7) — remains in force.

---

## 1. Purpose

Replace the top-down pixel-art town with a **stylized smooth-3D facility**: one connected laboratory/office hybrid, viewed from an isometric camera, occupied by the same seven role residents, whose movement and activity reflect **real backend state and events** and nothing else.

The redesign changes the environment and the rendering layer only. The agent-activity system, the backend, the event stream and the dashboard are untouched. The rule that governs the current town still governs the 3D one: **no resident may appear to be working unless a persisted record or a live event says so.** An idle resident breathes; it does not perform work.

The facility should read as a modern research lab and a comfortable office rather than a games town, with restrained futuristic touches: emissive station screens, a soft holographic accent on active workstations, a small completion effect.

---

## 2. Locked decisions

These are settled for this milestone. Changing one means amending this document first.

| # | Decision | Rationale |
|---|---|---|
| D1 | **Three.js only.** Phaser is removed; the pixel-art town is deleted, not wrapped. | Chosen by the operator. A true 3D world needs a 3D renderer; keeping Phaser for a design being retired would leave two renderers, two input paths and two test surfaces to maintain forever. |
| D2 | **Visual direction: option 1 + option 3 hybrid** — stylized smooth 3D with futuristic holographic accents. | The operator's choice, and the doc's own recommendation for integrated graphics: realistic 3D (option 2) was rejected as too expensive on the GPU budget in §8. |
| D3 | **Procedural low-poly geometry first.** Stations, furniture and residents are built in code from primitives. | There are **zero art assets in the repo today** (everything is drawn procedurally). Adding glTF means a new asset pipeline, licensing, a loader and download weight. Procedural geometry keeps the whole milestone inside one dependency and matches "relatively lightweight". Imported models remain a possible later step, not a prerequisite. |
| D4 | **The runtime fallback is a static, label-based view — not the pixel town.** Shown when WebGL is unavailable or reduced motion is on. | A fallback must cover the real failure mode ("3D cannot run") and still convey state. Keeping the retired pixel town would not even guarantee escaping WebGL (Phaser.AUTO drops to Canvas2D), and would ship permanent dead code. |
| D5 | **A short-lived alternative is the git branch, not shipped code.** The Phaser scene stays in history until the 3D world passes validation. | This repository treats superseded copies in the tree as a defect (see the HY-01 finding: 52 stale copies corrupting searches and audits). Rollback belongs in version control, not in the working tree. |
| D6 | **Terminology:** the UI keeps calling these buildings/stations and residents/roles in code, even though the visual metaphor becomes a lab. The model's ids (`library`, `workshop`, …) do not change. | Renaming model ids would churn the model, its 24 tests and the mapping for no functional gain. Display names already come from the model (`TOWN_LOCATIONS[*].name`, `ROSTER[*].name`). |

---

## 3. Current state (verified against the source)

| Piece | File | What it is |
|---|---|---|
| Renderer | `frontend/src/town-scene.ts` (667 lines) | `TownScene extends Phaser.Scene`. Draws terrain, lane, square, six buildings and seven residents entirely with Phaser `Graphics` (`drawTerrain`, `drawSquare`, `drawBuildings`, `drawResident`). Fixed 800×425 design space, `PULSE_MS = 150`, layout hard-coded in `BUILDINGS` / `SQUARE` / `PALETTE`. Exposes `applyState(state)`, `setMotion(bool)`, `positions()`, `frames()`. |
| Model | `frontend/src/town-model.ts` | Pure, no Phaser. `Role` (7), `Activity` (idle/queued/working/waiting_approval/completed/failed/blocked/unknown), `LocationId`, `TOWN_LOCATIONS`, `ROSTER`, `TownState`, `applyEvent`, `withBaseline`, `projectServerState`, `expireOverlays`, `setConnection`, `countsFor`, `summarize`, `toolLocation`, `roleForEvent`, `labelForEvent`. Constants: `WORKING_TTL_MS = 180_000`, `TERMINAL_FLASH_MS = 9_000`, `REPLAY_GRACE_MS = 5_000`, `UNKNOWN_LIMIT = 4`. |
| Adapter / mount | `frontend/src/town-view.ts` | `installTown()`: creates the Phaser game (parent `#game`, 800×425, `pixelArt: true`, `Phaser.Scale.FIT`), owns the 20 s snapshot poll (`REFRESH_MS = 20_000`), the event listeners, the HUD overlays and popovers, the reduced-motion toggle (`hermes-life-town-motion`), and the test hook `window.__hermesTown`. |
| Tests | `frontend/tests/town-model.test.ts` (24), `frontend/tests/control-wiring.test.ts` (6) | Pin the model and the DOM wiring. Run via `node --test`. |
| Styles | `frontend/src/town.css`, `frontend/src/phase45-world-layout.css` | `#game.town` box pinned to `aspect-ratio: 800 / 425`; canvas `image-rendering: pixelated`; HUD below the canvas. |
| Host | `frontend/index.html` | `#game` inside `.world-wrap`. No changes planned. |

**Roster (already matches the redesign doc exactly):** Hermes/coordinator/town_square, Sage/researcher/library, Piper/planner/planning_house, Forge/builder/workshop, Patch/tester/testing_lab, Echo/archivist/archive, Vale/reviewer/review_office.

**Backend reads (unchanged, owned by `town-view.ts`):** `/api/tasks`, `/api/agent/state`, `/api/goals`, `/api/investigation-plans`, `/api/implementations`, `/api/memory-reviews`, plus `/api/implementations/{id}/revisions`, `/review-state` and `/verification` for the newest run.

**Browser event contract (unchanged):**

```
main.ts            -> dispatches  hermes:event        (WebSocket event, validated + de-duplicated)
main.ts            -> dispatches  hermes:connection   {status: 'live' | 'reconnecting'}
town-view / any UI -> dispatches  hermes:open-task    {id}
town-view (new)    -> listens     hermes:event, hermes:connection
town-view (new)    -> listens     town:select {role}, town:building {location}
renderer (new)     -> dispatches  town:select {role}, town:building {location}
```

---

## 4. Architecture target

```
                 town-model.ts            (pure reducer — UNCHANGED, 24 tests)
                        |
        snapshots + hermes:event          (town-view.ts — UNCHANGED backend/event/HUD layers)
                        |
                  TownState
                        |
              town-renderer.ts            (module boundary + factory)
                        |
              town-renderer-3d.ts         (Three.js scene, camera, picking)   <-- new
                        |
              town-renderer-static.ts     (label fallback, no WebGL)          <-- new
```

The renderer boundary is a **module seam, not a swap mechanism** (D1 removed the second real renderer): it exists so `town-view.ts` and the tests never depend on Three.js internals, and so the static fallback shares the same input (`TownState`).

**Renderer interface — confirmed in milestone 0** (`frontend/src/town-renderer.ts`):

```ts
export type RendererKind = '3d' | 'static';

/** One row per resident: what a test (and the acceptance run) asserts the world is showing. */
export interface RendererPoint {
  role: string; x: number; y: number; state: string; location: string;
}

export interface TownRenderer {
  readonly kind: RendererKind;
  /** The only way the world changes: authoritative state in, drawing out. Idempotent. */
  applyState(state: TownState): void;
  /** Reduced motion: freeze movement, keep every state label. */
  setMotion(on: boolean): void;
  /** Re-measure the host box. The container resizes without a window resize event. */
  resize(): void;
  /** Introspection for tests and acceptance runs — never read by the UI. */
  positions(): RendererPoint[];
  /** Frames drawn so far; 0 for the static renderer, which has no clock. */
  frames(): number;
  /** Release geometries, materials, textures, listeners, RAF handles and any WebGL context. */
  destroy(): void;
}

/** Picks the 3D renderer when the client can run it, otherwise the static fallback. A failed WebGL
 *  probe is not an error — it is what selects the fallback (D4). */
export function createTownRenderer(host: HTMLElement, opts: { motion: boolean }): TownRenderer;
```

Rules the seam enforces:

- `town-view.ts` imports only this module — never Three.js or renderer internals.
- The renderer dispatches `town:select` / `town:building` itself (picking belongs to the drawing layer); `town-view.ts` keeps listening for exactly those, unchanged.
- `applyState` is idempotent: re-applying an unchanged state changes nothing.
- `createTownRenderer` treats a failed WebGL probe as a fallback, not an error: it returns the static renderer (D4).

Picking moves **into** the renderer: the 3D module raycasts against stations and residents and dispatches `town:select` / `town:building`. `town-view.ts`'s popovers, its `hermes:open-task` links and its navigation into the existing tabs do not change. The current `toScreen()` coordinate maths (which existed only to correct Phaser's canvas transform) is deleted with the Phaser scene.

---

## 5. Preserved, non-negotiable

1. One logical system, not seven agents. Residents carry no independent permissions, prompts or queues.
2. No animation without evidence — persisted state and live events only; decorative figures (if any) carry no name and no badge.
3. All seven dashboard tabs, chat, project selection, approvals, memory, SQLite, Obsidian and autonomy unchanged.
4. `town-model.ts` and its 24 tests unchanged (except where a change is explicitly justified here).
5. The event contract in §3 unchanged.
6. Reduced motion preserves state labels with movement disabled.
7. Reload, WebSocket reconnect and missed-sequence recovery behave exactly as today.
8. No backend or schema migration.

---

## 6. Replaced or removed

| Removed | Replaced by |
|---|---|
| `frontend/src/town-scene.ts` (Phaser pixel art) | `frontend/src/town-renderer-3d.ts` (Three.js) |
| `phaser` in `frontend/package.json` | `three` (+ `@types/three` in devDependencies) |
| `image-rendering: pixelated` and the pixel-art canvas notes in `town.css` | A plain canvas rule; the `#game.town` box and `800 / 425` aspect ratio stay (layout is renderer-agnostic) |
| `toScreen()` in `window.__hermesTown` | Renderer-owned picking; `__hermesTown` keeps `state`, `refresh`, `setMotion`, `motion`, `summarize`, `frames`, `positions` and gains `renderer` |

`index.html`, all other `frontend/src/*.ts` and the entire backend are untouched.

---

## 7. Milestones

### 0 — Foundations — **DONE**
- **0.1 Frontend test runner fixed.** `node --test` on this host cannot execute `.ts` (`ERR_NO_TYPESCRIPT`: this Node build has no TypeScript support), so neither suite could run at all. Fixed with devDependencies — `tsx` (loader) and `@types/node@^22` (matching the v22 runtime) — and the scripts are now `node --import tsx --test …` for `test:town` and `test:ui`.
- **0.1b The tests are now inside the build gate.** `frontend/tsconfig.json`'s `include` gained `tests/**/*.ts`, so `npm run build` (`tsc --noEmit`) type-checks the tests as well as `src/`. This is what surfaced the missing `@types/node`: untyped `node:*` imports made downstream values `any` and failed the build.
- **0.2 UI-VIS-002's header corrected** — it now reads "Implemented", with a note that §3 and §8 are superseded by this document.
- **0.3 Seam confirmed** — the `TownRenderer` interface and the static-fallback output are fixed in §4 and §9.

**Evidence (milestone 0):**

```
$ npm test
  test:town   # tests 24  # pass 24  # fail 0
  test:ui     # tests 5   # pass 5   # fail 0

$ npm run build            # tsc --noEmit (src + tests) && vite build
  ✓ 29 modules transformed
  dist/assets/index-*.js   1,604.68 kB │ gzip: 377.88 kB
```

That 1.6 MB bundle is almost entirely Phaser — it is the baseline the renderer swap replaces. Recording the before-size here so milestone 5 can report the after-size honestly rather than guessing.

### 1 — Renderer seam and an empty room (VIS-003A) — **DONE**
- `frontend/src/town-renderer.ts` — the interface (§4), `DESIGN`, `prefersReducedMotion`, `supportsWebGL2`, and `createTownRenderer`.
- `frontend/src/town-renderer-3d.ts` — the Three.js facility: floor, two walls with lighter top lips, a floor edge line, one directional light plus a hemisphere fill, orthographic isometric camera, DPR capped at 1.5, rendering paused while the tab is hidden.
- `frontend/src/town-renderer-static.ts` — the no-WebGL fallback, with its content as the pure `staticRows(state)` so it is unit-testable (D4).
- `frontend/src/town-view.ts` — builds through `createTownRenderer`, never imports Three.js; `game`/`scene`/`toScreen()`/`_game`/`_scene` are gone; `__hermesTown` gained `renderer()` (kind) and `_renderer`.
- `frontend/src/town-scene.ts` **deleted** and `phaser` **removed** from `package.json`. `town.css` lost the pixel-art rules but kept the `#game.town` box and its `800 / 425` ratio.

**Evidence (milestone 1):**

```
$ npm run build            # tsc --noEmit (src + tests) && vite build
  dist/assets/index-*.js   632.46 kB │ gzip: 164.40 kB      # was 1,604.68 kB / 377.88 kB with Phaser

$ npm test
  test:town 24/24 · test:ui 5/5 · test:renderer 6/6        # 35 passed
```

Live, in a browser against the running backend (`window.__hermesTown`):

```
renderer() = '3d'      WebGL2 available, so the facility is the active renderer
canvases = 1           one canvas, 1073x570 at the 800:425 design ratio, buffer == CSS box
host width = canvas width (canvas fills the panel, nothing stretched)
town-connection = '● Live', summary reads the backend
frames: 0 -> 1 on setMotion(false), 2 on applyState   (the harness tab freezes rAF;
                                                       the draw path itself is proven)
destroy(): canvas 1 -> 0, no throw, frames stop       (teardown releases the canvas)
positions() = []       deliberate: no resident is drawn yet, so none is claimed
```

**Two findings worth keeping:**

- The first render was near-invisible: the floor came out at `(27,32,36)` against a `(20,23,28)` background — 24/255 apart. Not a bug in the seam, but the palette/light intensities were wrong for the design. Floor and walls were lightened and the lights raised; the floor's centre now sits 105/765 from the background and the shape is unmistakable in a pixel map.
- The room is framed by fitting the room's bounding box into the ortho frustum at the design aspect (§4's `DESIGN`), so it cannot clip at any panel size; a pixel map of the canvas confirms wide margins on every side.

### 2 — The facility (VIS-003B) — **DONE**
- `facilityPlan()` is a pure function of the model — one station per `ROLES` entry, one per `TOWN_LOCATIONS` entry, signage text and dashboard destination read straight from `TOWN_LOCATIONS`, accent from `ROSTER`. Position comes from the role's index in `ROLES`, so there is **no hand-written coordinate table** to drift out of step with the roster; each station turns to face the centre.
- **Reading note:** the milestone text says "seven stations plus the central command centre", but the model has seven locations in total and `town_square` *is* the coordinator's. So the plan is seven places: six working stations on a ring plus the central command dais. Inventing an eighth place would have meant inventing a location the model does not have.
- Procedural geometry (D3): a desk, an accent console and a signage sprite per station; a low-glass divider between neighbouring stations (workspaces, not opaque walls); a cylindrical dais with an accent ring for the coordinator.
- A figure per resident — accent-coloured body, neutral head, name label — plus a **per-role accessory** giving each a distinct silhouette: halo (coordinator), book (researcher), board (planner), crate (builder), probes (tester), drum (archivist), seal (reviewer). Colour is never the only difference.
- Idle residents stand at their home station and only breathe. Ambient motion is gated on `state !== null`, so nothing animates before the first snapshot resolves, and `positions()` reports `'unknown'` until one arrives.

**Evidence (milestone 2):**

```
$ npm run build
  dist/assets/index-*.js   651.25 kB │ gzip: 169.58 kB      # +19.8 kB over milestone 1

$ npm test
  test:town 24/24 · test:ui 5/5 · test:renderer 11/11       # 40 passed
```

The new `test:renderer` cases hold the "derived from the model" rule down: the plan covers every
role and every location with no invented place, signage and destinations match `TOWN_LOCATIONS`
verbatim, the coordinator holds the centre, no station overlaps another or leaves the floor, every
station faces the dais, and the plan is deterministic.

Live, in a browser against the running backend, with motion frozen so the frame is reproducible:

```
positions() -> 7 entries, 7 distinct points, all inside the 800x425 design box
  coordinator  x=400 y=234  idle  town_square      (the dais, at the centre)
  researcher   x=467 y=311  idle  library
  planner      x=339 y=273  idle  planning_house
  builder      x=273 y=200  idle  workshop
  tester       x=333 y=165  idle  testing_lab
  archivist    x=461 y=204  idle  archive
  reviewer     x=527 y=277  idle  review_office
states = ['idle']    the real backend: nothing is running, so nothing claims to be
```

A pixel map of the canvas confirms the fit: the facility forms a clean isometric lozenge with
~135 px of margin on each side and ~27 px top and bottom — no station, label or wall reaches an
edge. Signage is really drawn, not merely in the scene graph: ~18,800 ink pixels, 3.2% of the panel.

**A caveat worth stating:** the "nothing animates before the first snapshot" gate is **structural** —
`if (state) breathe(); else settle();` — not something the browser run observed directly. The fetch
resolves before a script can sample the page, so the pre-snapshot window was never caught live. What
*is* observable is the honest default: `positions()` answers `'unknown'` for a resident no snapshot
has described yet.

### 3 — Activity animation bound to state (VIS-003C) — **DONE**
- One table, `activityVisual(Activity)` → `{ pose, badge, screen, flash }`, is the entire contract (UI-VIS-002 §5 in one place). Two fields of the model drive everything: `Resident.location` decides *where* a figure stands (`spotFor`), `Resident.state` decides *what it looks like*.
- Walk: a `location` change starts a 750 ms eased walk to that building's spot. The coordinator therefore relocates when a read/write/test tool runs and walks home when the task ends — visibly, and without a single invented destination: the destination is always a real `TOWN_LOCATIONS` entry. A visitor stands *beside* another role's desk (`VISIT_OFFSET`) rather than inside the resident who works there.
- Pose: only `working` leans to the desk and lights the console. `waiting_approval`/`queued` stand still with a badge; `failed`/`blocked` are a stationary alert; `unknown` is an unknown marker with no motion at all.
- Badges are distinguished by **shape**, not just colour: cone = queued, ring = waiting (and only the waiting ring breathes), octahedron = alert, icosahedron = unknown.
- `completed` plays a single 900 ms ring, and **only on a real transition** — never on the first snapshot to arrive.
- Consoles: the task label appears on a billboarded holo screen, and the desk device (or the command ring, for the coordinator) glows while that role works.
- Reduced motion (`setMotion(false)`) freezes the walk — a relocation lands instantly — drops the flash and the pulse, and keeps every badge and label.

**Two findings worth keeping:**

- **A plane on a desk is invisible from half the ring.** The first build put the task label on a textured plane facing the resident. The camera is at 45°, so for the three stations whose desks face away from the viewer that label was a blank back panel — measurably: the working/idle pixel difference at the researcher's bay was 3 px out of ~300. Rebuilt as a camera-facing sprite over a physical accent device; the same measurement is now ~500 px, and a vision pass reads "Investigating / Hermes' life" off the panel.
- **The harness tab does not run `requestAnimationFrame` until it is brought to the front.** Earlier notes recorded rAF as simply frozen; it is not — after `Page.bringToFront` it ran 49 → 117 frames in 1.5 s (~45 fps). Every animated behaviour below was verified live, not inferred.

**Evidence (milestone 3):**

```
$ npm run build
  dist/assets/index-*.js   659.44 kB │ gzip: 172.40 kB

$ npm test
  test:town 24/24 · test:ui 5/5 · test:renderer 20/20       # 49 passed
```

The 9 new `test:renderer` cases pin the mapping table down: every activity has a visual; only
`working` takes the working pose and lights the console; waiting and queued get different badge
kinds and no glow; failed and blocked are stationary alerts; only `completed` flashes; `unknown`
invents nothing; a resident stands at its own desk while a visitor stands beside it; every
role/location pair lands inside the room; and the walk easing is clamped and monotonic.

Live, against the running app, driving the app's own state object through `window.__hermesTown`
(`state()` + `_renderer().applyState(...)`) — the same object the backend refreshes:

```
walk out (a read tool puts the coordinator in the Library):
   t=0.0s (400,237)  t=0.1s (403,242)  t=0.2s (408,253)  t=0.4s (415,271)
   t=0.5s (424,291)  t=0.6s (431,308)  t=0.7s (439,326)  t=0.8s (444,336)
   t=1.0s (446,343)  t=1.1s (446,344)  t=1.2s (446,344)   -> settles, 12 distinct points
walk home (task ends, baseline returns to town_square):
   (446,344) -> (445,339) -> (440,328) -> (432,311) -> (424,290) -> (416,274)
   -> (409,256) -> (403,243) -> (400,237) -> (400,237)      -> back on the dais
the researcher never moves; the coordinator stops beside her desk, not on top of her.

reduced motion (setMotion(false)), same relocation:
   immediately (261,175) at the Workshop, and unchanged 0.5 s later   -> no walk at all

console, measured as bright ink in the researcher's bay:
   idle 2752 · working 3259 (+507: the label panel) · idle again 2740 · waiting 2821 (+81: badge only)
   -> waiting is visibly not working

completion acknowledgement, ink in the bay over a 7-capture burst:
   first state after a reload is a stale `completed`: 314 314 314 314 314 314 314   (spread 0)
   a real working -> completed transition:            976 1028 1106 1183 915 927 858  (spread 325)
   -> history does not re-animate; a genuine completion does play, and settles back
```

### 4 — Interaction, accessibility, teardown (VIS-003D) — **DONE**
- Picking is a `Raycaster` against the real meshes, with the pointer mapped through the canvas box, and hits resolve through `userData` to a model id — so a click can only ever open a record the model knows. A resident always wins over the desk they are standing at; the command dais is pickable as `town_square`.
- Both paths reuse the app's existing events: `town:select` → the resident popover, `town:building` → the room panel, and from there the existing tab links. No new controls.
- Hover tooltip (`role="tooltip"`, `aria-describedby` on the canvas) carries the semantic state word through `stateWordFor`, so the hover text and the no-WebGL list cannot disagree — the `unknown` case reads "Status unknown" in both.
- Keyboard: the stations and residents are real buttons in a group that is in the accessibility tree at all times and laid out only while it holds focus (`:focus-within`), so it is tab-reachable and cannot cover the art.
- Reduced motion keeps the camera fixed, disables movement, drops the flash and the pulse, and preserves every badge, label and tooltip.
- Teardown removes the pointer listeners, the RAF handle, both interval timers, the borrowed live-status banner (put back where it came from) and every geometry, material and canvas texture; `document.hidden` already stops the loop. `installTown()` now runs the previous mount's undo first, so a remount replaces rather than stacks.

**Two findings worth keeping:**

- **The renderer was destroying the resident popover.** `host.replaceChildren(canvas)` — written in milestone 1 — wiped every other child of `#game`, and `town-view` puts the popover aside there. The element was never in the document, so `town:select` had been doing nothing since milestone 1; the station path only worked because its panel lives outside `#game`. Both renderers now mount through `mountInto()`, which removes only their own previous output. **This is exactly what the milestone's exit criterion is for.**
- **A remount test is only valid if it reaches the same module instance.** Loading `/src/town-view.ts` while the app had `/src/town-view.ts?t=…` produced a *second* instance, which built a second HUD and made a correct cleanup look broken. Re-running against the URL the app actually loaded gave the clean result below.

**Evidence (milestone 4):**

```
$ npm run build
  dist/assets/index-*.js   663.91 kB │ gzip: 174.00 kB

$ npm test
  test:town 24/24 · test:ui 5/5 · test:renderer 22/22       # 51 passed
```

Live, against the running app, with real input events (CDP `Input.dispatchMouseEvent`, not synthetic
`dispatchEvent`):

```
#game children: [ASIDE#town-selection, CANVAS, DIV#town-tooltip, DIV.town-access]
                -> the popover element is alive again

hover the researcher   -> tooltip "Library · Sage · idle — No open investigation"
click at the feet      -> town:building library   (the desk is genuinely in front)
click at the body      -> town:select researcher, popover opens:
     "Sage — Researcher | idle · No open investigation | Place: Library | Project/task: — |
      Workflow id: — | Last event: — | Observed: records 22:07:36 · records | Backend read: ..."
     clicking its "Open discovery" button switched the active tab overview -> discovery

click the dais         -> tooltip "Town Square · Hermes · idle — No task running"; panel "Town Square"
click beside it        -> panel "Planning House"; its link reads "Open overview workspace"

keyboard: 14 buttons in groups labelled Stations / Residents
   unfocused .town-access clip-path: inset(50%)
   on focus: clip-path none, :focus-visible true, outline solid 2px
   Enter on "Workshop"  -> room panel title becomes Workshop
   Enter on "Echo"      -> resident card "Echo — Archivist"

reduced motion: motion() false, positions identical 1.2 s apart, tooltip still reads
   "Piper · Planner · waiting for you — Plan awaiting your approval"

remount (the app's own module instance):
   before listeners 13 · canvases 1 · huds 1 · banners 1
   after  listeners 13 · canvases 1 · huds 1 · banners 1 · tooltips 1 · access 1
   one click afterwards produced exactly 1 town:select event

no WebGL (getContext('webgl2') denied before any app script):
   renderer 'static', 0 canvases, frames 0, 7 rows + 7 station buttons
   "Hermes · Coordinator | idle — No task running · Town Square"  (the model's own words)
   clicking a row and a station dispatched town:select and town:building
```

*Harness note:* CDP needs `rawKeyDown` + `char` for Enter to produce a default action; a plain
`keyDown`/`keyUp` pair activates nothing and is not evidence either way.

### 5 — Validation (VIS-003E)
- Drive the model through investigate → plan → build → test → review via `window.__hermesTown` and assert renderer-agnostic output (`positions()`, labels) — the recorded integration test.
- `tsc --noEmit`, `npm run build`, model + control-wiring tests, and a real browser pass against the live backend.
- Confirm the whole app is otherwise unchanged.
- **Exit:** §13 acceptance criteria all demonstrated with recorded output.

### 6 — Optional, later
- Expandable facility: a new room appears **only** when a real capability exists, wired off actual data. Where no event exists, record it as a future backend requirement rather than inventing one.

---

## 8. Performance budget

The world renders in the **viewer's browser**, not on the host, so the budget must survive the weakest client (this host is Intel TigerLake-H UHD; a phone is worse).

- Canvas 800×425 CSS-scaled into the panel; render at `devicePixelRatio` capped to **1.0–1.5**.
- **One** real light plus baked/emissive accents. No SSAO, no screen-space reflections, no post-processing chain.
- No real-time shadows by default. If one cheap shadow map is affordable it must be measured, not assumed.
- Instanced/merged geometry for repeated furniture; frustum-culled; no per-frame allocation.
- Target 60 fps idle on the host, and a documented floor of 30 fps; pause rendering entirely while the tab is hidden.
- Particles limited to short, low-count, one-shot effects and disabled under reduced motion.

---

## 9. Interaction, accessibility, reduced motion

- **Click resident / station:** the existing read-only popover (role, state, activity, project/task id, timestamp, and `View task` / `View plan` / `View evidence` navigation through the existing handlers). No new Approve/Apply/Run controls.
- **Hover / focus:** accessible tooltip carrying the state word, not just an icon.
- **Keyboard:** stations reachable and activatable without a pointer where the renderer allows; visible focus ring.
- **Connection banner:** `Live` / `Reconnecting` / `Disconnected — last known state at [time]`, with last-known statuses visibly marked stale.
- **Reduced motion:** camera frozen, movement disabled, particles off, state labels preserved.
- **No WebGL:** the static label fallback conveys the same seven residents, states and click-through.

**Static fallback output — confirmed in milestone 0.** The fallback renders a plain DOM list inside `#game` (no canvas), reading `ROLES`, `ROSTER`, `ACTIVITY_WORDS` and `TOWN_LOCATIONS` from the model and the current `TownState` directly:

- one row per role, in `ROLES` order;
- each row shows the display name and title (`ROSTER`), the state word (`ACTIVITY_WORDS[state]`), the station name (`TOWN_LOCATIONS[location].name`), and the relative observed time when the model knows one;
- a completed or failed row keeps its state word — never an animation replay;
- an `unknown` row reads "Status unknown" and links to Activity; nothing is invented;
- each resident row is a `<button>` dispatching `town:select {role}`; each station heading dispatches `town:building {location}` — so the existing popovers and deep links work unchanged;
- keyboard-navigable with a visible focus indicator; inherently motionless, so reduced motion is satisfied by construction;
- reports `kind === 'static'` and `frames() === 0`.

---

## 10. Event and data contract

Unchanged from UI-VIS-002 §7 and the current implementation: authoritative snapshots first, live events applied on top, de-duplicated by sequence, stale/reordered events ignored, resync requested after a gap, no inference from the mere existence of records, `Unknown` rather than a guess. `town-model.ts` implements this today and is not modified.

---

## 11. Files

**New:** `frontend/src/town-renderer.ts`, `frontend/src/town-renderer-3d.ts`, `frontend/src/town-renderer-static.ts`, a renderer test file, and this document. *(Milestones 1–2: all created. `frontend/tests/town-renderer.test.ts` holds 22 cases.)*

**Edited:** `frontend/src/town-view.ts` (factory, picking wiring, teardown), `frontend/package.json` (dependencies + test scripts), `frontend/tsconfig.json` (type-check the tests), `frontend/src/town.css` (drop the pixel-art rules; add the tooltip and the keyboard access group), `UI-VIS-002_Hermes_Town_Multi_Avatar_Visualization.md` (status header + supersede note). Milestone 0 has already edited `package.json`, `tsconfig.json` and the UI-VIS-002 header; nothing else from this list is touched yet.

The small pure surface the tests lean on, so that "the world matches the model" is a unit test and not
a screenshot: `DESIGN`, `prefersReducedMotion`, `supportsWebGL2`, `stateWordFor`, `mountInto` and
`createTownRenderer` from the seam, `staticRows`/`staticRowDetail` from the fallback, and
`facilityPlan`/`spotFor`/`walkEase`/`activityVisual`/`ROOM` from the 3D renderer. Everything else in
`town-renderer-3d.ts` is private. `town-model.ts` — the model, the event table and the recovery rules —
is untouched throughout.

**Deleted:** `frontend/src/town-scene.ts`, the `phaser` dependency. *(Milestone 1: both are gone.)*

**Untouched:** `frontend/src/town-model.ts` and its tests, `frontend/index.html`, every other frontend module, the whole backend.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| Perf on integrated GPUs steered by the hybrid's particles/glow | Hard budget (§8); effects are additive decoration that can be cut without touching state logic |
| Procedural art looks worse than expected | D3 keeps the door open to glTF models later without an architectural change |
| Click mapping regresses (the old canvas transform caused ~15 px drift once) | Picking lives inside the renderer and emits the existing events; acceptance criterion 12 verifies it. **Answered in milestone 4:** raycast + canvas-box NDC, confirmed with real input events |
| A new dependency contradicts UI-VIS-002 §2/§8 | This document supersedes those clauses; the spec change is explicit, not silent |
| WebGL unavailable on the client | D4 static fallback, verified in milestone 4 |
| Frontend tests unverifiable on this host | Milestone 0.1 is a blocker, done first |
| Scope creep into gameplay | §14: no simulation features, no second dashboard, no new backend events |

---

## 13. Acceptance criteria

Adapted from UI-VIS-002 §10; the behavioural criteria are unchanged, the art/rendering ones are re-scoped to 3D.

1. The pixel-art town is gone; the 3D facility renders in the **same panel**.
2. All seven dashboard tabs keep their position and behaviour.
3. Chat, project selection, approvals, API behaviour, SQLite, Obsidian and autonomy are unaffected.
4. Seven stable residents exist (coordinator, researcher, planner, builder, tester, archivist, reviewer), each with a distinct silhouette, accent and home station.
5. A real investigation start activates the researcher; its completion stops that animation.
6. Planning and approval-wait states are visually distinct; waiting is never shown as execution.
7. Candidate coding activates the builder; real testing/reevaluation activates the tester.
8. Old completed records do not animate anyone after reload.
9. A failed or blocked operation shows a clear stationary alert, not work.
10. Multiple active residents appear only when real concurrent operations exist.
11. Clicking a resident or station opens read-only context and a working link into the existing tab/record.
12. Lost connectivity shows stale/disconnected; reconnect restores truth from persisted data.
13. Duplicate and out-of-order events do not duplicate residents or regress states.
14. The scene fits the panel at supported desktop widths.
15. No backend or schema migration.
16. TypeScript build passes; no leaked listeners, timers, RAF handles or WebGL contexts after remount.
17. A recorded integration test demonstrates event→visual behaviour for investigate → plan → build → test → review.
18. Reduced motion and the no-WebGL static fallback convey the same status information.
19. An event with insufficient information renders `Unknown` rather than inventing an action.

---

## 14. Out of scope

No changes to Overview, Goals, Discover, Planning, Build, Activity or Evidence beyond what §4 requires; no gameplay, economy, pathfinding AI or free-roam simulation; no second approval UI or mini-dashboard; no duplicate state machine inside the visualization; no real subagents or extra LLM calls to animate residents; no new backend events invented for visuals; no external runtime server, iframe or plugin.

---

## 15. Open items

- Station signage wording (technical labels such as `TEST LAB` vs plainer names) — cosmetic, decide during milestone 2.
- Whether the seven residents share one humanoid base mesh with role accessories, or use distinct silhouettes per role — decide during milestone 2.
- Whether the command centre replaces `town_square` visually or sits inside it — the model id stays `town_square` either way (D6).

---

## Appendix A — Decision log

| Date | Decision | By |
|---|---|---|
| (this milestone) | Phaser → Three.js; pixel town deleted, no runtime fallback of the old renderer (D1, D5) | Operator |
| (this milestone) | Visual direction = option 1 + option 3 hybrid (D2) | Operator |
| (this milestone) | Procedural geometry before any asset pipeline (D3) | Proposed in the plan, defaulted |
| (this milestone) | Static label fallback as the only runtime fallback (D4) | Proposed in the plan, defaulted |
