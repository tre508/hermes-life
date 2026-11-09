# Hermes Life — 3D World Redesign Master Specification

**Document ID:** HERMES-LIFE-UI-VIS-MASTER  
**Version:** 1.0 (consolidated, 2026-11-08)  
**Status:** Implementation in progress — milestones 0–4 complete; art pass (audit v1), composition pass (audit v2 Phase A), material/lighting pass (audit v3 Phases A–E), character redesign (VIS-006 Phases A–E) and work-surface pass (poses checked against the furniture at runtime) applied; milestone 5, audit-v3 Phase F and VIS-006 Phase F outstanding  
**Scope:** Frontend visualization within the existing Hermes Life world panel  
**Authority:** Single source of truth for the *visualization redesign*. `HERMES_LIFE_MASTER_DEV_SPEC.md` remains authoritative for broader application architecture, workflows, security and backend semantics.  
**Consolidates:** `redesignidea.md`, `UI-VIS-002_Hermes_Town_Multi_Avatar_Visualization.md`, `UI-VIS-003_Hermes_Life_3D_World.md`.

> **Implementation status is documentary, not independently reverified.** The reported build, tests and browser checks below come from UI-VIS-003; inspect the live repository and rerun validation before marking this specification complete.

## 1. Purpose and target outcome

Replace the retired top-down pixel-art town with a **smooth, stylized 3D AI Operations Lab**: a connected laboratory/office facility with restrained futuristic accents, seven recognizable role residents and an adjustable *design direction* based on an isometric view. The visualization is an operational window into **one logical Hermes Life system**, not a game simulation or seven autonomous agents.

Users must be able to determine what Hermes is doing, which project/task is involved, what is queued or awaiting approval, what completed or failed, and whether the displayed information is live or stale. Visual activity must correspond to actual backend evidence.

### Visual identity

- Stylized low-poly 3D, smooth shapes and animation; no pixel-art rendering.
- Modern research facility blended with comfortable office elements: workstations, glass dividers, command dais, task screens and clear signage.
- Restrained holographic accents, emissive consoles and short completion effects; avoid expensive realism, reflections, shadows and postprocessing by default.
- Orthographic isometric camera with coherent depth, perspective, scale, lighting and occlusion. Pan/zoom were explored in the concept, **not committed to the current milestone**; do not add without a separate scoped decision.
- One connected facility in the existing panel, not a separate application or a set of gameplay rooms.
- Procedural primitives are the current asset strategy. Imported glTF characters, detailed furniture and additional environmental polish are optional later work, not acceptance blockers.

## 2. Scope and immutable boundaries

**In scope:** Replace the presentation renderer; render seven role residents and their stations; map actual activity to positions, poses, labels and badges; preserve read-only inspection and navigation; ensure responsive layout, accessibility, synchronization, performance and cleanup.

**Out of scope:** Any backend, database, authorization, scheduling, memory or workflow changes; additional autonomous agents; separate prompts/queues/permissions for visual residents; extra LLM calls for animation; new fabricated backend events; chat or project selector changes; rearrangement of Overview, Goals, Discover, Planning, Build, Activity or Evidence; duplicate approval controls or dashboards; gameplay, economy, pathfinding AI, free roaming, external runtime/plugin/iframe.

The visualization **must not mutate or persist workflow state**. If backend evidence is missing or contradictory, show `unknown` or an appropriately grounded idle/waiting state and provide navigation to the existing Activity UI. Do not invent progress, activity or completion.

## 3. Locked architectural decisions

| ID | Canonical decision | Consequence |
|---|---|---|
| D1 | Three.js is the sole animated renderer | Remove Phaser and retired `town-scene.ts`; do not ship dual-renderer fallback. |
| D2 | Stylized 3D + restrained futuristic accents | Realistic high-cost rendering is excluded from this milestone. |
| D3 | Procedural low-poly geometry first | No required glTF asset pipeline or external art dependency. |
| D4 | Static accessible DOM view is the no-WebGL fallback | Preserve all seven roles, states and click-through actions without canvas. |
| D5 | Git history/branch is rollback | No obsolete Phaser copies in the working tree. |
| D6 | Keep existing model IDs and role/location contracts | Lab presentation labels may change; `town_square`, `library`, etc. remain stable. |
| D7 | Backend snapshots and events are authoritative | Animation is a read-only consequence, never evidence of backend work. |
| D8 | No dashboard or backend migration | Preserve application boundaries and existing routing. |

Changes to locked decisions require an explicit amendment to this file before implementation.

## 4. Canonical resident and station roster

| Role ID | Display name | Location ID | Lab presentation | Grounded work category |
|---|---|---|---|---|
| `coordinator` | Hermes | `town_square` | Central command center / dais | Chat, coordination, tool-associated movement and system overview |
| `researcher` | Sage | `library` | Research laboratory | Discovery, investigation, source/document review |
| `planner` | Piper | `planning_house` | Strategy / planning room | Plan formulation and preparation |
| `builder` | Forge | `workshop` | Development studio | Implementation, candidate creation and revision |
| `tester` | Patch | `testing_lab` | Testing laboratory | Baseline, candidate testing and reevaluation |
| `archivist` | Echo | `archive` | Knowledge archive | Actual memory extraction and vault updates |
| `reviewer` | Vale | `review_office` | Review office | Review, approval waiting and integration status |

Seven roles correspond to **seven model locations total**: six surrounding stations and the coordinator's central dais. Do not introduce an eighth location merely because an illustrative design calls the dais an additional command center. Display aliases are not persisted agent identities. Distinguish roles by silhouette/accessory, text and accent, not color alone. All roles have stable home positions when idle.

## 5. Single presentation state model

`frontend/src/town-model.ts` remains the pure, renderer-independent adapter. It consumes persisted backend snapshots and live events, and supplies the presentation state to the renderer. Do not introduce a competing workflow state machine.

**Roles:** `coordinator`, `researcher`, `planner`, `builder`, `tester`, `archivist`, `reviewer`.

**States:** `idle`, `queued`, `working`, `waiting_approval`, `completed`, `failed`, `blocked`, `unknown`.

**Connection:** `live`, `reconnecting`, `disconnected`.

Each resident must resolve its role, state, model location, activity label and available project/workflow/task identifiers, timestamps and event sequence. Preserve the existing model's actual TypeScript shapes; do not substitute illustrative types for verified source definitions.

### Evidence and conflict resolution

1. Fetch authoritative current snapshots before showing any resident as `working`.
2. Persisted lifecycle state and timestamps take precedence over transient animation events.
3. Validate WebSocket event names/payloads; deduplicate by ID/sequence; ignore stale or reordered messages; resync on gaps.
4. Resolve the most recent authoritative **nonterminal** operation per role; old completed records do not become current work after reload.
5. Show concurrent working residents only when the backend confirms genuine concurrency; use grounded counts where applicable.
6. Approval waiting is not execution; an approved but unstarted plan is not builder work.
7. An unsupported event, inconsistent record or missing evidence must not be converted into invented work or percentage completion.
8. On disconnect, retain last known state only with an explicit stale/connection indicator; reconcile from fresh snapshots after reconnect.
9. Failure/cancellation must stop the relevant work animation. A completion animation may run only on a genuine live transition, never merely because a historical completed snapshot was loaded.

### Existing integration contract

`main.ts` dispatches `hermes:event` and `hermes:connection`; the renderer dispatches `town:select {role}` and `town:building {location}`; `town-view.ts` handles inspection and uses existing navigation, including `hermes:open-task {id}`. Confirm exact payloads in current source before editing.

Existing backend reads, owned by `town-view.ts`, include `/api/tasks`, `/api/agent/state`, `/api/goals`, `/api/investigation-plans`, `/api/implementations`, `/api/memory-reviews` and relevant implementation revision/review/verification endpoints. Do not add endpoints merely for visual effects.

## 6. Authoritative activity-to-visual mapping

| Backend-grounded condition | Role | Required visual result |
|---|---|---|
| No executing work | All | At home; subtle non-work idle motion only |
| Active chat task | Hermes | Working/talking indicator linked to task |
| Discovery scan or investigation running | Sage | Research pose and truthful label |
| Plan formulation running | Piper | Planning desk/board work pose |
| Plan proposed, approval pending | Piper / Vale as supported | Waiting badge; **no working pose** |
| Implementation preparing/implementing | Forge | Builder work pose and lit console |
| Baseline test, evaluation or reevaluation | Patch | Tester work pose and lit console |
| Candidate passed, awaiting review | Vale | Waiting-for-review marker; not executing |
| Revision queued | Forge | Queued badge; no work animation |
| Revision actively running | Forge | Builder work pose |
| Memory extraction/vault write actually active | Echo | Archive work pose |
| Backend error or blocked operation | Relevant role | Stationary alert, actual reason if available |
| Explicit live completion transition | Relevant role | Brief one-shot acknowledgement, then current grounded state |
| Missing/contradictory evidence | Relevant role | `unknown` badge and meaningful label |

Only `working` activates a work pose and workstation glow. `queued` and `waiting_approval` use different shapes and labels; `failed`/`blocked` use stationary alerts; `unknown` does not animate work. Resident movement represents a **visual relocation**, not a new execution step. Current implementation describes a 750 ms eased walk when `location` changes and a 900 ms completion ring only on an actual transition. These are existing reported behaviors, not permission to invent new states.

## 7. Renderer and frontend integration

### Module ownership

```text
backend snapshots + WebSocket events
                |
       town-model.ts                 pure presentation model
                |
       town-view.ts                  fetch/poll, events, HUD, popovers, routing
                |
       town-renderer.ts              factory + renderer interface
            /       \
 town-renderer-3d.ts   town-renderer-static.ts
      Three.js            accessible DOM fallback
```

The `TownRenderer` contract comprises `kind`, `applyState(state)`, `setMotion(on)`, `resize()`, `positions()`, `frames()` and `destroy()`. The factory `createTownRenderer(host, { motion })` selects Three.js if WebGL2 works and otherwise selects the static view. `applyState` must be idempotent. The 3D renderer owns raycast picking and dispatches existing `town:select` / `town:building` events. `town-view.ts` must not import Three.js internals.

The renderer must mount only its own DOM nodes: **never replace or delete the existing resident popover or HUD children**. Repeated `installTown()` calls must tear down prior mounts and not stack listeners, canvases, banners, timers or RAF loops.

### Layout and 3D scene

- Keep `#game` within `.world-wrap` and retain the current `800 / 425` aspect ratio and application panel layout.
- Seven distinct stations/positions derived from `ROLES`, `ROSTER` and `TOWN_LOCATIONS`, not a separate drifting list of location IDs.
- Central dais, surrounding desk/console/signage, low glass dividers and role-specific figure accessories.
- Orthographic isometric camera; all residents and station labels must remain within supported viewport bounds.
- Billboard task labels toward the camera; ensure no station label disappears because a plane faces away.
- Maintain correct floor contact, scene depth, occlusion and clear click targets. A visiting coordinator must not occupy the same position as the station's home resident.
- Preserve actor identity and in-flight movement across repeated state updates. State refreshes must not restart walks or swap out moving actors.
- Motion transitions must be explicit and grounded: idle → start/turn → move → arrive/stop → appropriate pose. No automatic celebratory work claims.
- The current milestone's relocation is station-to-station; **full in-room navigation/pathfinding is not implemented or required**. Do not imply it exists.

### Read-only interactions

Clicking a resident shows role, actual state, activity, project/task/workflow identifier where available, observation time and links to existing task/plan/evidence views. Clicking a station shows its role and current/waiting/recent summary and routes to an existing dashboard tab. No duplicate Run, Apply or Approve buttons. Hover/focus tooltips use semantic state labels. Preserve keyboard-accessible resident/station controls and visible focus indicators.

### Reduced motion and fallback

Reduced motion disables movement, pulses and particles while preserving state labels, badges, focus and navigation. If WebGL2 is unavailable, show a static DOM list of all seven residents and seven station controls with the same authoritative states and interaction events. Static renderer reports `kind: 'static'` and `frames(): 0`. Never revive the pixel town as a fallback.

## 8. Performance and resource budget

- Browser-rendered, including integrated GPUs and weaker clients; do not budget only for the host workstation.
- Design canvas 800×425 CSS-scaled to the panel; cap device pixel ratio at **1.0–1.5**.
- One main light plus low-cost fill/emissive accents; no SSAO, screen-space reflections or default postprocessing.
- No real-time shadows by default; add only after measurement.
- Prefer merged/instanced repeated geometry, frustum culling and no unnecessary per-frame allocations.
- Target **60 fps idle** on the host; document a **30 fps floor**. These are targets, not yet certified acceptance results.
- Pause the render loop when hidden; avoid duplicate polling; dispose geometries, materials, textures, canvas textures, event handlers, timers, RAF handles and WebGL context on teardown.
- Keep particles short-lived and minimal; disable under reduced motion. If visual polish threatens the budget, cut decorative effects before state accuracy.

## 9. Implementation inventory and progress

**Reported repository files:**

| Area | Canonical path | Status in UI-VIS-003 |
|---|---|---|
| Pure model | `frontend/src/town-model.ts` | Preserved |
| Presentation vocabulary | `frontend/src/town-vocabulary.ts` | Added (facility wording; Three-free so the controller can share it) |
| Art: palette, materials, geometry cache | `frontend/src/town-world/palette.ts` | Added |
| Art: layout + proportional system | `frontend/src/town-world/layout.ts` | Added |
| Art: labels and text | `frontend/src/town-world/labels.ts` | Added |
| Art: furniture and equipment | `frontend/src/town-world/props.ts` | Added |
| Art: the seven stations | `frontend/src/town-world/workstations.ts` | Added |
| Art: the seven residents | `frontend/src/town-world/residents.ts` | Added |
| Art: room, architecture, command centre | `frontend/src/town-world/facility.ts` | Added |
| Art: static merge pass | `frontend/src/town-world/optimize.ts` | Added |
| Integration/controller | `frontend/src/town-view.ts` | Updated for renderer factory and cleanup |
| Renderer contract/factory | `frontend/src/town-renderer.ts` | Added |
| 3D world | `frontend/src/town-renderer-3d.ts` | Added |
| Static fallback | `frontend/src/town-renderer-static.ts` | Added |
| Visualization styles | `frontend/src/town.css` | Updated |
| Existing layout | `frontend/src/phase45-world-layout.css` | Layout preserved |
| Host element | `frontend/index.html` | Preserved |
| Dependencies/tests | `frontend/package.json`, `frontend/tsconfig.json` | Updated |
| Model tests | `frontend/tests/town-model.test.ts` | Preserved |
| UI wiring tests | `frontend/tests/control-wiring.test.ts` | Preserved |
| Renderer tests | `frontend/tests/town-renderer.test.ts` | Added |
| Retired renderer | `frontend/src/town-scene.ts` | Deleted |
| Retired dependency | `phaser` | Removed |

### Milestone ledger (reported, not independently rerun)

| Milestone | Scope | Recorded state |
|---|---|---|
| 0 — Foundations | Repair TypeScript test runner/build gate; lock interface and fallback | **Done** |
| 1 — Renderer seam | Replace Phaser, mount 3D empty room and static fallback, verify teardown | **Done** |
| 2 — Facility | Seven model-derived stations, silhouettes, labels and correct idle rendering | **Done** |
| 3 — Activity | Evidence-bound poses, relocation, badges, completion and reduced motion | **Done** |
| 4 — Interaction | Raycast picking, popovers, keyboard, tooltips, cleanup and fallback | **Done** |
| 5 — Validation | Full investigate → plan → build → test → review recorded integration and regression pass | **Outstanding** |
| 6 — Expansion | New stations only for real implemented capabilities | **Optional later** |

**Last recorded milestone-4 evidence:** `npm run build` succeeded; `npm test` reported 24 model + 5 UI + 22 renderer tests = **51 passed**; bundle `663.91 kB` / gzip `174.00 kB`. Browser checks reported live hover/click, tab navigation, keyboard interaction, reduced motion, clean remount, and no-WebGL fallback. These figures are historical test results from the supplied specification, **not a fresh run against the current checkout**.

**Documentation inconsistencies resolved:** UI-VIS-002's original Phaser and pixel-art sections are obsolete. Its behavioral rules are retained here. UI-VIS-003 is newer and controls the implementation and status ledger. UI-VIS-003's earlier narrative mentions seven stations *plus* a command center; the verified model has seven locations **including** the command center. Its §11 edited-file note contains an older “not touched yet” phrase; the milestone completion record is used instead. Concept suggestions such as freely adjustable camera, extensive environmental effects and full in-room movement are not silently promoted to shipped requirements.

### Art-direction pass (against `descrepencyreport.md`)

The functional milestones above produced a working renderer but a visually thin one. The discrepancy
report's findings 1–15 were all art-direction, so the artwork was lifted out of the renderer into
`frontend/src/town-world/` and rebuilt. `town-renderer-3d.ts` is now the orchestrator only: camera,
lights, state → visual mapping, animation, picking, lifecycle.

| Report finding | What was done |
|---|---|
| §1, §4, §15 environment identity, density, cohesion | Zoned floor (plaza, department plates, walkways, grid), kerbed deck, panel seamed walls with base trim, cornices, lit fixtures, wall displays, storage, equipment rack, planters, benches. One palette and one material set for the whole scene. |
| §2 workstations are one desk in seven colours | Seven compositions: research lab (shelves, reading table, info display), strategy room (planning board with work items, wood desk), development studio (three-screen bank, tower, tool wall, crates), verification lab (raised test bench, unit under test, instrumentation rack), knowledge archive (drawer stacks, reference shelving, canisters), review office (decision board, document trays). |
| §3 characters are placeholder geometry | Real proportions from one `SCALE` system: hips, torso, shoulders, arms, legs, neck, head — 1.75 units tall against a 0.76 desk. Silhouette first: hard hat, hood, long hair, bun, goggles, visor, headset. |
| §5 flat lighting and materials | One key light, one cool fill, one hemisphere; no shadows. Palette separates architecture (mid-tone), furniture (light grey + one warm wood), technology (near-black housings, emissive screens) and people. |
| §6 futuristic elements underdeveloped | Monitors, wall displays, holo panels, LED columns, status lights, the command ring, and per-role emissive hardware that lights **only** when that role is really working. |
| §7 command centre underdeveloped | Two-tier platform, arc of operator consoles, standing status display, holographic ring, twelve status lights, its own readout. |
| §8 no spatial definition | Department floor plates edged in the role's accent, glazed side partitions on every station, floor transitions and circulation. |
| §9 labels too small / unreadable | Larger type on a dark plate, auto-fitted so a long name shrinks rather than clipping; permanent station signage separated from the activity readout; names repositioned clear of the signs. |
| §10 obsolete town terminology | `town-vocabulary.ts` is the single source: Command Center, Research Laboratory, Strategy Room, Development Studio, Verification Laboratory, Knowledge Archive, Review & Approval, and "AI Operations Lab" in the header. Model ids are untouched. A test forbids "town" in the visible vocabulary. |
| §11, §12 composition and scale | Room tightened to 17×11, ring to 6.4/3.6, framing margin 1.02, characters 45% taller relative to the room, everything sized from `SCALE`. |

**Measured:** the facility builds **840 static meshes**, merged to **70** per-material batches (12× fewer
draw calls) with an unchanged triangle count. Per frame: **~52 draw calls, ~5.4k triangles**.

**Performance measurement is limited by the harness, and this is recorded rather than papered over:** the
automation browser runs **SwiftShader** (software rasteriser, no GPU), so frame rate there is fill-rate
bound by the software renderer — 19 fps at 1073×570, 44 fps at 447×237, i.e. it scales with pixel count,
not scene cost. The 60 fps target and 30 fps floor are therefore **not certified** here; they need one run
on a machine with a real GPU.

**Not attempted, by design:** a ceiling or fully enclosed rooms (the camera looks down into the facility);
imported glTF characters or furniture (D3 keeps procedural primitives); camera pan/zoom (not scoped).

### Composition pass (against `descrepencyreport2.md`, audit v2)

Audit v2's central finding was not about detail but about **where the world sits in its panel**: the
facility read as a small architectural model floating in a black rectangle. Its own §17 says to fix that
first, because every other improvement is undermined by it. That is what this pass did.

**The cause, measured.** The camera fitted the room's bounding box *including the wall tops at its far
corners*, then took `max(vertical span, horizontal span ÷ aspect)`. The vertical span won by a wide
margin, so on a 800×425 panel the frustum was 26 units wide for content 19.8 wide: 24% of the panel was
empty on each side, and the room's own deck edge and wall ends were inside the frame — the "island".

**What changed.**

| Audit item | Change |
|---|---|
| §2, §5, §13 the island, the diorama, wasted panel | The camera now fits `CONTENT` — the seven plates, the figures and their names — instead of the room box. The deck is 30×23 and the two visible walls are 5 units tall and 38–52 long, all deliberately larger than the frame, so **no perimeter, kerb, platform edge or wall end is ever drawn**. The kerb is gone; the floor simply continues past the edge. |
| §4 camera framing | Elevation lowered 34° → 27°, which makes the isometric projection's aspect match the panel's; the frustum is now 19.3 units wide for content 17.5 wide. Everything is 1.4× larger on screen and characters roughly 1.35× taller in pixels, with no content cropped. |
| §3 background not integrated | Aerial fog (`THREE.Fog`, 78→112) dissolves the far deck and walls into the backdrop instead of ending them at a hard line; the panel's own frame and "mat" were removed so the scene's background meets the panel edge. |
| §9 labels obstruct the environment | The floating plates are gone. Department names are **painted decals lying in the floor** at each plate's front edge, and the command centre's name is painted on its plaza apron. Name tags are smaller (0.92 units) and stay above the head. |
| §7 characters too small and simplistic | Deliberately stylised proportions: larger head, thicker limbs, wider shoulders, and a dark band across the face so orientation is readable at panel size. |
| §11 lighting/materials flat | Ambient cut from 1.05 to 0.72 with the key raised to 2.25, so surfaces turn away from the light — a depth cue with no shadow map, post pass or extra light. Floor got paving seams for scale. |
| §14 world not integrated with the dashboard | Canvas border, radius, drop shadow, `image-rendering: pixelated` and the lighter "mat" behind it removed; the panel is edge-to-edge. |
| §15 town terminology | Header pill now reads **AI OPERATIONS LAB / 0.4.0** (`main.ts` was overwriting the HTML's already-correct label). |

**Measured on the live render (1600×950, 1073×570 canvas):** 90.1% of the canvas is world rather than
background (74.4% immediately after the framing change, and much less before it); all four frame edges are
97.9–99.9% content except the top, where the fog-faded far wall reaches the edge; every horizontal band of
the image carries detail (luminance σ 15–37), so there is no featureless region left. Hit-testing still
works: hovering the coordinator, tester and archivist reports the right resident and place, and clicking
opens the corresponding panel.

**Still open from audit v2 (not claimed):** §6 consistent interior architecture beyond wall trim; §7
characters remain procedural low-poly (recognisable, not "polished"); §8 a stronger command-centre focal
point; §10 workstation spacing and clutter; §12 atmosphere; and the whole of Phases B–E, including the
runtime animation/locomotion review §16 asks for and the performance run on a machine with a real GPU.

### Material and lighting pass (against `descrepencyreport3.md`, audit v3)

Audit v3's finding was that the scene looked like "a functional 3D prototype" rather than an
art-directed game environment. Its two critical items were that the facility is overwhelmingly grey (§2)
and that the lighting is flat (§3). The report is explicit that the fix is "meaningful variation in
materials and surfaces", not more saturation on the same grey boxes, so the work was done in the art
modules rather than the renderer.

| Audit item | Change |
|---|---|
| §2 critical: monotonous grey | A coordinated palette in four deliberately separated families replaces one grey family: **warm stone** flooring with joint tiling, **warm off-white** panelling, **slate** structure, **walnut** and **brushed aluminium** furniture, **painted metal** cabinets, **fabric** seating, **blue-green** glazing, **near-black** technology, plus natural greens. |
| §7 high: no surface detail | Procedural textures generated once into shared canvases and cached by (kind, repeat, tone): floor tiling with per-tile drift, plaster speckle, wood grain with figure, fabric/panel weave, brushed metal streak, a workstation interface, and a soft contact gradient. No external assets, no texture files (D3). |
| §3 critical: flat lighting | Three layers: a hemisphere base at 0.6, a strong warm key at 2.75, a weak cool fill at 0.34, plus a low rim at 0.42 to separate silhouettes. ACES filmic tone mapping (a per-pixel curve, not a post pass) so emissive accents roll off instead of clipping. |
| §3 contact depth | Soft contact shadows — one shared transparent material — under every workstation, under each resident (parented to the figure, so it walks with them) and around the command dais. This is the "inexpensive ambient-occlusion-like shading" the report asks for, with no shadow maps. |
| §4 high: geometry looks procedural | A chamfered-box primitive (`b.g.bevel`) that insets each face at build time, so every edge catches the key light. Desks gained aprons, a modesty panel, a foot rail and four legs; chairs a five-star base, gas column, fabric back and armrests; cabinets a plinth, recessed doors and handles; racks vents and an access door; monitors a bezel, neck and weighted foot. |
| §6 high: departments look alike | A per-department material kit: each area has its own floor tone, painted storage and acoustic screen tone, all drawn from the shared palette so the seven still read as one facility. |
| §9 screens need design | Every monitor, console and wall display now carries a drawn interface — title bar, navigation column, data table and chart — with the role's accent in the chrome. It is decorative chrome only; anything reporting real state is still painted from the model. |
| §10 glass unconvincing | Glazing reworked with a blue-green cast, a real reflection channel (metalness) and a faint edge emission, framed in aluminium with mullions and a handrail. |
| §11 insufficient contrast | The families are separated by value as well as hue, the architecture was darkened so it reads as background, and the rim light separates figures from what is behind them. |
| §5 high: characters | Seven garments — coat, lab coat, vest, work jacket with hi-vis banding, harness, cardigan, blazer — over the shared body, in coordinated tones, each with its own accent detail. **A real defect was found and fixed:** every hat, hood, visor, goggle set, satchel and belt was positioned in whole-body coordinates but parented to the upper body, which sits 0.66 units up. Every accessory had been floating half a metre above its owner, which is a large part of why the residents read as mannequins. |

**Measured, before → after (same camera, 1073×570 canvas):** mean saturation of lit pixels **0.169 →
0.258** (+53%); luminance standard deviation **34.5 → 45.7** (+32% more tonal separation); mean luminance
75 → 96. Materials are now named from the render rather than described as grey: tile with joints, wood
grain, fabric weave, brushed metal, plaster, glass, and screens showing a recognisable graph interface.

**Performance cost of the pass:** 1,104 static meshes → 89 after per-material merging; **71 draw calls
and ~10k triangles per frame** (was 60 and ~8k). Still far inside budget. As before, **fps itself is
uncertified**: this harness renders with SwiftShader (software, no GPU), so its frame rate says nothing
about the reference machine.

**Still open from audit v3 (not claimed):** §4 is improved but the assets remain procedural primitives,
not modelled game assets — the report permits lightweight glTF here and that step has not been taken;
§5's characters are more distinct and correctly assembled but still stylised primitives with no facial
detail; §7's textures are 512 px procedural canvases, not hand-authored material sets; §8's atmosphere and
§12's negative space are only partly addressed; and all of Phase F (validation across viewport sizes,
reduced motion, static fallback, resource cleanup and a real performance run) is outstanding.

### Character redesign (against `character-redesign.md`, VIS-006)

The environment had outgrown the residents: they were "nearly identical character models with different
colors", with oversimplified heads, bodies, hands and feet and clothing that was really a tinted torso
(§2, §3, §6). The residents are now built by a **character system** rather than seven hand-written
figures.

| Audit item | Change |
|---|---|
| §2 critical: seven near-identical models | `CAST` holds seven design records — height (0.95–1.06), build (0.88–1.16), head shape, hair, skin tone, garment, shirt, trousers, shoes and a role accessory. No two residents agree on all of them, so a lineup is readable before colour is considered. |
| §3 critical: no anatomy | `ANATOMY` is one proportional system (sole, ankle, knee, hip, waist, chest, shoulder, neck, head) from which every part derives. Limbs are **articulated** — hip → knee → shin → foot and shoulder → elbow → forearm → hand are nested groups — and each hand has a palm, thumb and finger slab. |
| §3: heads are spheres | Five head shapes (round, oval, square, long, wide) each with a jaw, plus seven hairstyles (swept, bun, ponytail, curls, long back, tied, crop) that change the outline in greyscale. |
| §4 high: no faces | `faces.ts` is a six-pose expression system — neutral, focused, patient, pleased, concerned, confused — built from eyes, pupils, brows and a two-piece mouth so a smile is a rotation rather than a second mesh. Expressions are driven by the same activity table as the body, and **may never imply work that is not happening**: only `working` looks focused, `failed`/`blocked` look concerned and stay still. |
| §6 high: clothing underdeveloped | Seven garments built as shapes, not tints: jacket with lapels and a lit seam, lab coat with instrument pockets, waistcoat with buttons, hoodie with a collapsed hood and hi-vis banding, instrument harness with straps, cardigan with a scarf, blazer with structured shoulders. |
| §8 high: stiff poses | A seated work pose (hips on the chair, knees under the desk, hands on the work surface, eyes down), a folded-arm waiting stance, a relaxed alert stance, a walking stride with knee bend and counter-swinging arms, and a slow idle weight shift with an asymmetric stance. |
| §10 high: furniture interaction | `seatTurnFor()` seats a resident at the *end* of its desk — see the defects below. Sitting is allowed only for `working` at the resident's own station; a resident working in another department stands at that console. |
| §12: character materials | Skin, hair, garment, trouser, shoe and metal tones all come from the shared material cache; seven residents cost a handful of materials and one geometry per distinct size. |

**Three real defects were found and fixed while verifying, all of which had been visible on screen:**

1. **Every accessory floated half a metre above its owner.** Hats, hoods, visors, goggles, satchels and
   tool belts were positioned in whole-body coordinates but parented to the upper body, which sits 0.66
   units up. This is a large part of why the residents read as mannequins.
2. **The eyes were larger than the head.** The facial features were scaled by `radius / 0.185` — about
   1.0 — so every coefficient was being applied as an absolute size, and the residents wore giant white
   spheres beside their skulls. Features are now fractions of the head's own radius.
3. **A seated resident was invisible.** Sitting at the desk's centre put the figure directly behind its
   own monitor from the isometric eye. Residents now sit at the end of the desk, turned to face along
   it, on whichever side the camera can actually see (`seatTurnFor`, a pure function).

**Verified:** the position contract holds — for the planner, `idle`, `queued`, `waiting_approval` and
`completed` all leave her standing at her own station (291, 299–300), `working` at her own station seats
her (276, 283), and `working` while visiting another department leaves her standing at the visit position
(282, 273). All seven residents still answer the cursor with the correct tooltip. The hard hat was cut
back from a bucket that hid the face to a crown that does not.

**Cost:** 91.5 draw calls and ~14k triangles per frame (71 and ~10k before the character work). Still far
inside budget. **fps remains uncertified** — this harness renders with SwiftShader, not a GPU.

**Still open from VIS-006 (not claimed):** at the default camera a resident is roughly 40 px tall on a
1073 px canvas, so fine facial detail is at the limit of legibility — the audit's §7 concern is reduced
but not eliminated, and the honest fix is a closer camera or larger figures, both of which change the
composition the previous milestone settled. Character surfaces are flat tones rather than textured (§12).
Animation was verified through the state contract and by reading the pose code, not frame-by-frame at
runtime, so §9's walking, turning and transition review is unfinished. §17's ten visual acceptance tests
were partly performed (lineup via driven states, state accuracy, interaction, performance) and the rest
are outstanding.

### Work-surface pass (poses verified against the furniture at runtime)

This pass came from a live report, not from an audit document: while a task executed, only the
coordinator animated, he appeared to turn away from his desk and mime typing at nothing, and the
per-resident task readout was no longer visible. Each symptom traced to a specific defect.

| Reported symptom | Root cause found in code | Fix |
|---|---|---|
| Hermes "typing" while facing away from his computer | The seat rule was `visual.seat && location === own location`, which seated him at the **command dais** — a platform with a chair-shaped offset (`seatTurnFor`) and no chair. `seatTurnFor` then turned him 90°, so he sat on nothing and typed along a desk that does not exist. | Seating now requires a desk station (`location !== coordinator location`); the dais is consoles, not a desk. The coordinator takes a standing `console` pose. |
| Hands reaching into empty air | The dais has consoles only on its rim (radius 1.62) with a deliberate front gap, so nothing was within reach of a figure standing at its centre. | Added the coordinator's own standing console (waist-high, keyboard with glow key strips) where his forearms actually fall. It is placed and rotated along `plan.yaw` because the dais is built unrotated — without that it sat 0.6 units to his side and only one hand landed on it. |
| A resident working in another department faced away from that desk | The visitor pose used the station's own yaw plus a 1.5-unit side offset, so the desk was beside him rather than in front. | Visitors take the `seatTurnFor` end-of-desk position at 92% radius, turn to face along the desk, and reach onto its surface. |
| Task readout no longer visible | Panels were children of the station, anchored at the station origin, while residents now sit or stand offset from that origin — so the readout drifted off the person it describes and hovered over the desk. | Panels are added to the scene and repositioned each frame at `figure position + 2.9`, directly over the resident's head. Measured: accent-plate coverage above the head rises **32.9% → 56.7%** when a resident is working, with the plate's x-centroid within **2–3 px** of the resident. |
| The six specialists appeared frozen | Correct behaviour, not a bug: only the role with a real active workflow step animates, and during a plain chat task that is the coordinator alone. The idle animation itself was under one pixel at panel scale. | Idle amplitudes raised (weight shift ±0.012 → ±0.022, larger breath and arm sway) and a slow head turn added. Measured between frames 1.3 s apart: **0.5%–6.7% of a resident's body box** changes, so idle motion is now on screen. |

**Deliberately not done:** the six specialists do not fake activity while the coordinator runs a task.
`deriveFromRecords` gives each role a state only from its own real record (autonomous goal running, plan
drafted or awaiting approval, an implementation run, a pending memory review). Animating them otherwise
would breach §2's rule that the world never claims work that is not happening.

**Removed:** the holographic ring that used to circle the dais was deleted — every height it could take
collided with the name plate or the task readout, and lower down it crossed the coordinator's face. The
console's glowing key strips, the dais rim ring and the LED dots carry that accent instead.

**Evidence:** `npm run build` green at `701.17 kB` / gzip `186.99 kB`; `npm test` 24 + 5 + 23 = **52
passed, 0 failed**. Poses checked at runtime by driving each state through `applyState` and reading the
result, not by inference from the code.

### Reachability of the seven residents (found while building the test fixture)

`scripts/town-visual-fixture.py` writes records in the same shapes the renderer reads, so every
displayable state can be exercised without waiting for the real pipeline. Building it surfaced two
things the world can and cannot show, which matter for testing and for honest documentation:

1. **The planner can now be shown working.** It previously could not: `deriveFromRecords` had a
   `drafting` branch, but the backend only ever wrote a plan as `proposed` or `approved`, so that
   branch was dead code. The drafting phase is real work — a 30-90 s model call — and it now has a
   record: `InvestigationPlanner.plan()` inserts the plan row in state `drafting` *before* the call and
   flips the same row to `proposed` in place afterwards. The planner therefore reads `working` for the
   whole draft, survives a reload, and is corroborated by a row the database can show you.
   Consequences handled at the same time: `IN_FLIGHT` in `town-model.ts` gained `drafting`; the status
   resolver reports `Drafting the plan` / `next_action: await` so the Planning tab does not offer to
   approve a plan that has no body yet; `stateMessage` explains it in the tab.
2. **Builder, tester and reviewer cannot be non-idle together.** All three read the same newest
   implementation run, so the richest honest tableau is coordinator + researcher working, planner and
   archivist gated, builder working, and tester + reviewer idle. Verified live: 3 working, 2 waiting.

Both limitations are properties of the data model, not of the 3D scene, and the fixture refuses to
fabricate either — a test that shows a state the system cannot reach proves nothing. (Point 1 is now a
real reachable state; the fixture gained a `planner-drafting` step for it.)

**Draft rows cannot be left behind.** `investigation_plans.formulation_id` is UNIQUE and `plan()`
refuses while any row exists for the formulation, so an abandoned draft would block that formulation
permanently, invisible to the UI. Two guards, both tested: a failed or rejected draft deletes its own
row so the formulation stays retryable, and a drafting row older than
`InvestigationPlanner.DRAFT_STALE_AFTER` (15 min) is swept as crash debris by `plan()` and by restart
recovery. A fresh draft still blocks a duplicate, so genuine work in progress is not clobbered.

**Fixture safety:** ids are real UUIDs recorded in `~/.local/share/hermes-life/town-fixture.json`;
`clear` deletes exactly those rows and restores the agent state it found. It refuses to run while a real
task is executing. Round trip verified: applying and clearing leaves the four real tasks and an `idle`
agent exactly as before.

## 10. Final validation plan — next required work

**Precondition:** Inspect the live source and confirm that the reported files, module contracts, test scripts and backend event shapes still match. Record any drift before changing code.

1. Run the frontend TypeScript/build gate and the model, control-wiring and renderer test suites. Capture commands, exit codes and totals.
2. Against a running Hermes Life backend, record a real or controlled **investigate → plan → build → test → review** sequence using the application's `window.__hermesTown` state/introspection hooks and UI. Assert displayed role, location, label, state and navigation at each step.
3. Verify waiting/approval versus working; queued versus working; explicit completion versus historical completed records; failure/blocked/unknown; genuine concurrency versus fabricated parallel activity.
4. Verify initial snapshot, refresh, duplicate/out-of-order events, sequence gap, disconnect/reconnect, browser reload and cancellation; no invented activity or stale completion replay.
5. Verify resident and station clicks, actual task/plan/evidence navigation, hover tooltip, keyboard access, visible focus, reduced-motion semantics and no-WebGL static fallback.
6. Verify repeated remount/unmount and hidden-tab behavior: one active canvas (or none in fallback), no duplicate event subscriptions, polling, timers, RAF or retained WebGL resources.
7. Check supported viewport widths, label legibility, ground contact, occlusion, resident overlap, motion smoothness and panel overflow. Measure fps and report actual client/browser/GPU conditions rather than claiming an unmeasured target.
8. Regression-test all seven existing dashboard tabs, chat, project selection, approval workflows and relevant API interactions. Confirm no backend/schema changes.
9. Publish a short validation report with evidence, failures, exact changed files, known limitations and explicit pass/fail against the acceptance gate below.

## 11. Release acceptance gate

The redesign is **done only when all** conditions below are demonstrated:

- [ ] Three.js facility replaces the pixel town **in the same panel**, with no shipped Phaser renderer or dependency.
- [ ] Seven stable role residents and seven corresponding model locations are present, with distinct names, silhouettes and readable labels.
- [ ] Investigation, planning, implementation, testing, memory and review visuals activate only from supported backend records/events.
- [ ] Queued, working, awaiting approval, completed, failed, blocked, idle and unknown are distinguishable and truthful.
- [ ] Historical completed records do not replay as active work or fresh celebrations.
- [ ] Multiple working roles appear only when concurrency is supported by authoritative data.
- [ ] Resident/station selection and deep links into existing tabs work by pointer and keyboard.
- [ ] WebSocket disconnect, reconnect, missed/duplicate/reordered events and reload restore accurate, visibly fresh/stale state.
- [ ] Reduced motion and no-WebGL static mode preserve the same information and navigation.
- [ ] World fits the panel without clipping, overlapping controls, disappearing labels or invalid scene-depth relationships.
- [ ] Movement is smooth, idempotent across state refreshes and does not invent in-room pathfinding or task transitions.
- [ ] TypeScript build and all relevant tests pass; no listeners, timers, RAF loops or WebGL resources leak on remount.
- [ ] A recorded investigate → plan → build → test → review integration sequence passes.
- [ ] Performance is measured against the documented budget and any shortfall recorded.
- [ ] Overview, Goals, Discover, Planning, Build, Activity, Evidence, chat, project selection, approvals and backend behavior remain unchanged; no schema migration.
- [ ] Validation report is attached or referenced and this document's status is updated with the actual evidence.

## 12. Future expansion (not part of current acceptance)

Additional network operations, automation or project-specific workstations may be added **only when corresponding real capabilities and events exist**. Imported 3D assets, richer character rigs, camera pan/zoom, deeper room layouts and extra visual polish require separately approved scope, performance measurement and tests. The scene remains an honest representation of the system, not a fictional activity simulator.

## 13. Document governance and precedence

1. **For visualization redesign:** this file supersedes all three source documents as the sole normative requirements, decisions, architecture, progress and acceptance reference.
2. **For Hermes Life as a whole:** `HERMES_LIFE_MASTER_DEV_SPEC.md` and the live backend's established workflow/security semantics remain authoritative. This visual document cannot override them.
3. **For implementation reality:** live code, runtime API shapes and reproducible tests must be checked before changes; historical milestone claims are not proof of the current checkout.
4. Keep historical source documents as archival references if desired, but remove their normative links from implementation instructions. Amend **this file only** when requirements or decisions change; update its milestone ledger and acceptance evidence as work completes.
5. When the live code conflicts with this specification, document the discrepancy and resolve it explicitly. Do not silently redefine backend behavior or claim a feature is shipped because it appears in an aspirational design paragraph.

### Source consolidation trace

- **`redesignidea.md`:** design direction, lab metaphor, role/station concept, performance-conscious stylization, truthful activity animation, movement-quality expectations and possible expansion.
- **`UI-VIS-002`:** single-system boundaries, authoritative model/event handling, activity mappings, read-only interaction, reconnect semantics, regression tests and workflow preservation; retired Phaser/pixel-art clauses excluded.
- **`UI-VIS-003`:** locked Three.js decisions, renderer interface, module ownership, actual file inventory, reported milestone evidence, performance constraints, accessibility/static fallback and outstanding validation.
