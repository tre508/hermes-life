# Hermes Life — Codebase Audit Against Your Target UI

**Repository:** [tre508/hermes-life](https://github.com/tre508/hermes-life)  
**Branch:** `main`  
**Latest inspected commit:** `516ae332` — November 9, 2026  
**Reference:** Your attached Starship Bridge screenshot

## 1. Overall assessment

**Hermes Life has much of the underlying functionality needed, but its current frontend architecture and 3D environment do not yet match your target screenshot.**

The most important finding is that **the current implementation is designed around a different visual layout from the one you want.**

Your screenshot shows a detailed, interconnected science-fiction facility with eight distinct rooms, a central control room, corridors, resident workstations, and a surrounding application interface.

The current code implements a simpler, open-plan 3D operations laboratory with seven workstations arranged around a central command area.

That difference is architectural, not simply cosmetic.

Changing colors, adding textures, or adjusting lighting will not produce your target. The facility's geometry, spatial arrangement, camera composition, and UI layout need coordinated changes.

### Current implementation versus target

| Component | Current repository | Target screenshot | Assessment |
|---|---|---|---|
| Three.js renderer | Implemented | Detailed isometric facility | Retain and extend |
| Facility geometry | Open-plan room | Eight interconnected rooms | Major redesign |
| Central control room | Central command dais | Enclosed central control room | Redesign |
| Workstations | Seven role-based stations | Dedicated furnished departments | Reorganize |
| Corridors | Open circulation paths | Visible connecting corridors | Build |
| Architectural details | Procedural walls, flooring, props | Detailed sci-fi architecture | Major visual work |
| Lighting | Hemisphere and directional lighting | Localized blue/orange environmental lighting | Enhance |
| Characters | Seven procedural 3D residents | Small identifiable residents | Improve integration |
| Character animations | State-driven animation exists | Contextual behavior in individual rooms | Extend |
| Activity bubbles | Implemented | Live contextual activity above residents | Validate and refine |
| Camera | Orthographic isometric | Fixed overview of entire facility | Reconfigure |
| Sidebar | Home, Work, Activity, Results, System | Starship navigation and room shortcuts | Redesign |
| Right panel | Contextual information | Director, workspace status, focus, connection | Reorganize |
| Workspaces | Unified workspace architecture | Two selectable workspaces | Extend existing model |
| Backend integration | Existing tasks and events | Genuine live operational status | Preserve |
| Responsive layout | CSS layout exists | Three-column dashboard | Rework and validate |

**My assessment:** The best approach is to retain the backend, Three.js rendering infrastructure, resident state model, event handling, and existing workflow logic while replacing the facility composition and reorganizing the dashboard presentation.

A complete rewrite would discard useful work without addressing the actual architectural differences.

---

## 2. The biggest discrepancy: Facility architecture

### What your screenshot requires

The central facility has eight identifiable spaces:

| Room | Position in screenshot | Intended function |
|---|---|---|
| Director Office | Top center | Hermes/Axiom coordination |
| Research Station | Upper left | Research and investigations |
| Review Station | Upper right | Reviews and approvals |
| Dev Station | Middle left | Development and implementation |
| Control Room | Center | Operational command |
| Lab | Middle right | Testing and verification |
| Archive | Lower left | Knowledge and memory |
| Break Room | Lower right | Resident downtime and informal activity |

These rooms are connected by visible corridors and doorways.

Their placement is deliberate. The central control room is the visual anchor, and the surrounding rooms create an organized, readable facility.

### What the current code does

**File:** `frontend/src/town-world/layout.ts`

The current station arrangement is generated mathematically:

```typescript
export const ROOM = {
  width: 17,
  depth: 11,
  wall: 2.9
};

export const RING = {
  x: 6.4,
  z: 3.6,
  startDeg: 30
};
```

Inside `facilityPlan()`, six workstations are positioned around the center using an ellipse.

Conceptually:

```text
        Station       Station

  Station    Command    Station

        Station       Station
```

This produces seven operating areas, not the eight-room structure in your image.

Additionally, `facility.ts` explicitly constructs a continuous deck and two large exterior walls. It does not construct eight enclosed rooms with corresponding corridors and doors.

### What needs to change

**Primary files:**
- `frontend/src/town-world/layout.ts`
- `frontend/src/town-world/facility.ts`
- `frontend/src/town-world/workstations.ts`
- `frontend/src/town-renderer-3d.ts`

Replace the elliptical station layout with a fixed architectural floor plan.

The new layout should define:

- Eight individually identifiable spaces.
- A central control room.
- Shared corridors connecting each room.
- Physical walls and door openings.
- Distinct floor and wall treatments.
- Room-specific furniture.
- Dedicated resident positions.
- World-space anchors for labels and interaction.
- Camera framing that shows the complete facility.

**Important architectural decision:** Hermes Life currently models seven operational locations, while your target has eight physical rooms.

I recommend distinguishing **physical rooms from operational roles**.

The Break Room does not require an eighth autonomous agent or a new backend workflow. It can exist as a physical space that residents may occupy.

Similarly, room ownership and resident presence should be modeled separately. A resident can move between rooms without changing its operational role.

This allows the target layout without unnecessarily changing backend workflows.

---

## 3. Visual quality: What needs to change

The second major discrepancy is the rendering style.

Your screenshot has a much richer visual identity than the current Three.js scene is designed to produce.

### A. Architecture and environmental detail

**Current files:**
- `town-world/facility.ts`
- `town-world/props.ts`
- `town-world/palette.ts`
- `town-world/workstations.ts`

The current renderer already constructs:

- Procedural floors and walls.
- Workstations and monitors.
- Cabinets, shelving, and equipment racks.
- Illuminated architectural details.
- Holographic panels.
- Department-specific materials.

These are useful foundations.

However, the screenshot requires a more sophisticated architectural composition:

| Feature | Required change |
|---|---|
| Room walls | Create continuous, recognizable room boundaries |
| Doorways | Add visible openings connecting rooms and corridors |
| Corridors | Construct a shared circulation network |
| Flooring | Differentiate room surfaces from corridor surfaces |
| Ceiling structures | Add framing, overhead beams, and illuminated edges |
| Windows | Add simulated exterior windows and space backgrounds |
| Screens | Create higher-detail monitor interfaces |
| Control center | Build a central command console with holographic display |
| Lighting | Introduce room-specific environmental lighting |
| Room decoration | Make each department visually identifiable without labels |

**Recommendation:** Extend the existing procedural geometry system rather than replacing Three.js.

The current `props.ts` and `palette.ts` already provide reusable geometry and material infrastructure.

That makes the proposed changes feasible without introducing a completely different rendering engine.

### B. Materials and lighting

**File:** `frontend/src/town-renderer-3d.ts`

The renderer currently uses:

```typescript
THREE.HemisphereLight
THREE.DirectionalLight
THREE.ACESFilmicToneMapping
```

It also uses procedural textures defined in `palette.ts`.

However, your screenshot emphasizes:

- Deep blue-gray metallic surfaces.
- Orange illuminated door frames.
- Cyan holographic interfaces.
- Strong localized contrast.
- Warm interior lighting.
- Darker corridors.
- Exterior space imagery.

The current lighting setup is primarily global.

To match your target more closely, the renderer needs localized lighting effects, more deliberate emissive materials, and stronger variation between rooms.

Actual dynamic lights should be used selectively. Much of the target's illuminated appearance can be produced with emissive surfaces and carefully authored textures.

This matters because the current design specification targets usable performance on integrated GPUs.

### C. The background

Your screenshot has several exterior windows showing space.

The current renderer creates a gradient background:

**File:** `frontend/src/town-renderer-3d.ts`

```typescript
function backgroundGradient(): THREE.Texture
```

That is appropriate for the existing open-plan scene, but it cannot provide the same appearance as the screenshot.

The redesigned facility should use actual window geometry containing starfield or nebula imagery.

These could be procedurally generated textures or optimized image assets.

---

# 4. Characters and resident behavior

**Primary file:** `frontend/src/town-world/residents.ts`

The repository already contains a substantial procedural character system.

It includes distinct character definitions, geometry for heads, hair, clothing, limbs, and role-specific accessories.

The renderer also supports state-driven animation.

This is one area where I would preserve most of the existing implementation.

### What needs improving

The screenshot shows residents physically occupying their departments.

The current implementation positions residents relative to station coordinates generated by `facilityPlan()`.

Once the facility layout changes, this positioning logic must also change.

I recommend introducing three separate concepts:

| Concept | Purpose |
|---|---|
| Home room | The resident's assigned department |
| Current room | Where the resident is visually located |
| Activity state | What the backend confirms the resident is doing |

For example, Forge could have the Development Station as a home room but temporarily appear in the Lab when a verified workflow transition warrants it.

The system should also support believable idle animations, seated working poses, standing and turning, and short movement transitions.

### Important limitation in the current design

The existing master specification explicitly states:

> Full in-room navigation/pathfinding is not implemented or required.

The existing renderer primarily supports movement between station positions.

For the target screenshot, you do not immediately need sophisticated pathfinding.

However, **if your longer-term goal is to watch residents physically move through the facility**, you will eventually need:

1. Room entry and exit points.
2. A connected corridor graph.
3. Defined walking routes.
4. Collision-aware movement.
5. Animation transitions between walking, sitting, and working.

These should be implemented as a later stage rather than bundled into the initial architectural redesign.

---

# 5. Real-time activity bubbles

**Status: Already substantially implemented.**

This is an important finding because you recently added functionality for displaying Hermes's actual execution process above residents.

I inspected:

- `frontend/src/town-world/bubbles.ts`
- `frontend/src/town-world/bubbles.css`
- `frontend/src/town-view.ts`
- `liveagent.md`

The implementation already supports several of the requested capabilities.

### What exists

`BubbleController` processes runtime events and associates them with residents.

The event adapter recognizes:

```typescript
hermes.tool_use
hermes.tool_result
hermes.text
hermes.result
```

It also handles task lifecycle and workflow events.

The code supports displaying tool names, relevant arguments or targets, results, execution status, and streamed assistant text.

The bubble system is connected to the existing event stream through `town-view.ts`.

For example:

```typescript
bubbleController?.processEvent({
    type: event.type,
    payload: event.payload,
    task_id: event.task_id,
    sequence: event.sequence,
    timestamp: event.timestamp,
});
```

The current configuration limits each resident to one active bubble:

```typescript
maxPerResident: 1
```

That is consistent with your target of keeping the environment readable.

### What still needs attention

The bubble implementation needs validation against the redesigned facility.

Specifically:

**1. Positioning**

Bubbles must follow residents when the camera framing and room positions change.

**2. Overlapping elements**

Multiple bubbles must not obscure residents, room labels, or nearby controls.

**3. Event-to-role assignment**

The current implementation uses separate mappings for activity state and bubble assignment.

`town-model.ts` determines activity roles, while `bubbles.ts` contains additional tool-to-role and event-to-role logic.

These mappings should share an authoritative role-resolution mechanism to prevent inconsistent behavior.

**4. Historical events**

The current frontend replays historical events through the same dispatch mechanism as live events.

That requires particular attention so older completed operations do not appear to be occurring now.

**5. Real execution**

The bubble feature must be verified with actual Hermes execution events.

The presence of frontend event handlers does not establish that every runtime event contains the necessary data.

**Conclusion:** Keep the bubble implementation. Refactor and validate it rather than rebuilding it.

---

# 6. Dashboard interface: The second architectural mismatch

Your target screenshot is not simply a 3D scene.

It is an integrated operational dashboard.

The current repository has moved toward a different application structure.

### Current implementation

**Files:**
- `frontend/index.html`
- `frontend/src/main.v2.ts`
- `frontend/src/unified-layout.css`

The current application uses three primary layout regions:

```css
grid-template-areas:
    "header header header"
    "nav    main   panel";
```

That is actually a good starting point because your screenshot uses the same broad structure.

The difference is how these regions are populated.

### Target interface

**Top header**

Your screenshot includes:

- Hermes Life branding.
- Workspace selection.
- Local Hermes connection status.
- Ambient motion toggle.
- Synchronization control.

**Left sidebar**

The screenshot shows:

- World
- Task Board
- Chat
- Goals
- Memory
- Knowledge Deck
- Agents

It also contains shortcuts to the individual rooms.

**Center**

The 3D facility dominates the center.

Below it are task and activity panels.

**Right sidebar**

The screenshot contains:

- Axiom / Director controls.
- Workspace status.
- Current focus.
- Hermes connection information.

### What needs to change

The current navigation uses:

```text
Home
Work
Activity
Results
System
```

Those sections should not simply be deleted.

Instead, the frontend needs a navigation model that presents your desired interface while retaining access to existing functionality.

For example, Task Board can expose the existing Work functionality without duplicating task-management logic.

The same applies to Goals, Memory, and Chat.

The visual structure should change without creating parallel implementations of the same backend features.

### Two-workspace support

Your screenshot also shows two workspaces:

- ISONET
- WeKeKe

The repository already has project and workspace-related backend functionality.

However, the screenshot implies a persistent, top-level selector with workspace-specific operational context.

That requires checking that switching workspaces updates the relevant task lists, active focus, activity records, and displayed execution context.

The 3D facility can remain visually shared, but its operational information must reflect the selected workspace accurately.

---

# 7. Important issue: Your current specification conflicts with your target

This is probably the most important finding for your development process.

The repository contains:

`HERMES_LIFE_3D_REDESIGN_MASTER_SPEC.md`

That document currently defines the intended visualization.

However, several of its architectural decisions conflict with the screenshot.

| Existing specification | Your actual target |
|---|---|
| One open laboratory | Eight-room facility |
| Seven locations | Eight physical rooms |
| Six stations around central dais | Specific fixed room arrangement |
| Procedural low-poly geometry | More detailed stylized sci-fi environment |
| Existing dashboard layout preserved | Screenshot's dashboard composition |
| No in-room navigation | Potential future room-to-room movement |
| World visualization primarily as a panel | World as the dashboard's visual centerpiece |

The specification explicitly makes various UI layout changes out of scope.

It also describes its current architectural decisions as locked.

**That means an agent following the existing specification correctly may continue implementing something that does not look like your target.**

The problem is not necessarily the agent's ability to implement the UI.

The instructions it is following describe a different destination.

### Required action

Update `HERMES_LIFE_3D_REDESIGN_MASTER_SPEC.md` so that your screenshot becomes the authoritative visual reference.

The specification should explicitly distinguish:

- Requirements that must be preserved.
- Previous architectural decisions that are now superseded.
- New visual requirements.
- Functional changes permitted by the redesign.
- Acceptance criteria based on the target image.

Otherwise, future audits and autonomous development passes could repeatedly push the implementation toward the old design.

---

# 8. Recommended implementation roadmap

I would divide this into six development phases.

## Phase 1 — Specification and architectural alignment

**Priority: Critical**

**Objective:** Establish the correct target before further implementation.

Tasks:

1. Update the 3D redesign master specification.
2. Make the attached screenshot the primary visual reference.
3. Define all eight physical rooms.
4. Preserve the seven existing operational roles.
5. Define the relationship between rooms, residents, and backend locations.
6. Specify the navigation and dashboard layout.
7. Identify superseded requirements.
8. Establish measurable visual and functional acceptance criteria.

**Deliverable:** An updated master specification and an implementation plan grounded in the existing code.

## Phase 2 — Facility reconstruction

**Priority: Critical**

**Objective:** Recreate the screenshot's overall composition.

Files primarily affected:

```text
frontend/src/town-world/layout.ts
frontend/src/town-world/facility.ts
frontend/src/town-world/workstations.ts
frontend/src/town-renderer-3d.ts
```

Tasks:

1. Replace the elliptical workstation layout.
2. Construct the eight-room architecture.
3. Add connecting corridors and doorways.
4. Build the central control room.
5. Define room-specific floor and wall geometry.
6. Establish consistent world-space coordinates.
7. Reconfigure the orthographic camera.
8. Ensure every room remains visible.

**Acceptance criterion:** The rendered facility should have the same recognizable floor plan and room arrangement as the screenshot, even before detailed materials are applied.

This is the most important visual milestone.

## Phase 3 — Environmental art and lighting

**Priority: High**

**Objective:** Bring the reconstructed facility closer to the reference's visual quality.

Files primarily affected:

```text
frontend/src/town-world/palette.ts
frontend/src/town-world/props.ts
frontend/src/town-world/facility.ts
frontend/src/town-world/workstations.ts
frontend/src/town-renderer-3d.ts
```

Tasks:

1. Improve architectural materials.
2. Add blue/orange environmental lighting.
3. Introduce the exterior space windows.
4. Improve holographic displays.
5. Add room-specific equipment.
6. Improve signage and readable labels.
7. Add structural details and trim.
8. Optimize geometry and rendering performance.

**Acceptance criterion:** Each room should be visually recognizable without relying exclusively on its text label.

## Phase 4 — Dashboard redesign

**Priority: High**

**Objective:** Match the surrounding application interface.

Files primarily affected:

```text
frontend/index.html
frontend/src/main.v2.ts
frontend/src/unified-layout.css
```

Tasks:

1. Recreate the screenshot's header.
2. Reorganize the left navigation.
3. Add room navigation shortcuts.
4. Reconstruct the right contextual panel.
5. Position task and activity panels beneath the world.
6. Integrate workspace selection.
7. Maintain navigation to existing functional modules.
8. Validate responsive behavior.

**Acceptance criterion:** The full dashboard should resemble the screenshot in both layout and information hierarchy.

## Phase 5 — Resident and runtime integration

**Priority: High**

**Objective:** Make the new environment genuinely operational.

Files primarily affected:

```text
frontend/src/town-model.ts
frontend/src/town-view.ts
frontend/src/town-world/residents.ts
frontend/src/town-world/bubbles.ts
frontend/src/town-renderer-3d.ts
```

Tasks:

1. Assign residents to their new physical rooms.
2. Preserve authoritative backend status mapping.
3. Position activity bubbles correctly.
4. Improve resident work and idle animations.
5. Connect room interactions to existing views.
6. Support director controls through existing APIs.
7. Keep workspace-specific data synchronized.
8. Implement room transitions only when supported by actual workflow activity.

**Acceptance criterion:** Tasks, activity, resident states, and displayed results must reflect actual Hermes execution.

## Phase 6 — Validation and optimization

**Priority: Critical before release**

The existing master specification already contains a validation milestone that is marked outstanding.

That should be completed against the new design.

Required validation includes:

- Browser rendering at supported viewport sizes.
- Runtime event correctness.
- WebSocket reconnection.
- Resident and room interactions.
- Task lifecycle integration.
- Static fallback behavior.
- Reduced-motion behavior.
- Rendering performance.
- Cleanup of event listeners and Three.js resources.
- Visual comparison against the reference screenshot.

**Acceptance criterion:** The target is visually recognizable and existing application workflows remain functional.

---

# 9. Development priorities

Not every change has equal value.

This is the order I would actually implement them.

| Priority | Task | Impact |
|---|---|---|
| P0 | Correct the master specification | Prevents further work against the wrong target |
| P0 | Replace the facility floor plan | Largest visual difference |
| P0 | Build eight physical rooms | Establishes target architecture |
| P0 | Reconfigure camera composition | Ensures entire facility is visible |
| P1 | Improve materials and lighting | Major visual improvement |
| P1 | Rework dashboard layout | Matches screenshot structure |
| P1 | Assign residents to correct rooms | Integrates the existing character system |
| P1 | Integrate activity bubbles | Makes the environment operational |
| P1 | Implement workspace-aware context | Supports your two-workspace design |
| P2 | Improve character animations | Adds visual liveliness |
| P2 | Add room-to-room movement | Adds observable transitions |
| P2 | Environmental animation | Adds polish |
| P2 | Further rendering optimizations | Improves performance |

---

# 10. What I would preserve

A substantial amount of the current implementation is reusable.

| Existing component | Recommendation |
|---|---|
| `town-model.ts` | Preserve backend state model; extend presentation mapping |
| `town-renderer.ts` | Preserve renderer interface |
| `town-renderer-3d.ts` | Retain renderer, replace scene composition |
| `town-renderer-static.ts` | Preserve and adapt fallback |
| `residents.ts` | Preserve character infrastructure |
| `bubbles.ts` | Preserve and validate activity visualization |
| `props.ts` | Reuse and expand geometry library |
| `palette.ts` | Reuse material infrastructure; revise art direction |
| `town-view.ts` | Preserve event integration and lifecycle handling |
| `main.v2.ts` | Preserve application logic; reorganize navigation |
| `work-workspace.ts` | Preserve task functionality |
| Backend Python modules | Avoid unnecessary changes |

The existing implementation already has the foundations for a functional agent visualization.

The central problem is that the facility and UI were developed around an architectural specification that differs from your final target.

---

# 11. Additional observations from the latest commit

The latest commit introduces several conversation-related changes.

These include:

- `frontend/src/conv-composer.ts`
- `frontend/src/conv-thread.ts`
- `frontend/src/tool-group.ts`
- Updates to `work-workspace.ts`
- Updates to `bubbles.ts`
- Updates to `main.v2.ts`

This indicates active development of the conversational and execution interfaces.

Those changes should be integrated into the dashboard redesign rather than replaced.

I also found a testing gap.

The repository contains additional tests, including:

```text
frontend/tests/bubbles.test.ts
frontend/tests/conv-composer.test.ts
frontend/tests/tool-group.test.ts
frontend/tests/work-p1.test.ts
```

However, the current `npm test` script only runs the town model, control wiring, renderer, and lifecycle test groups.

Consequently, running the standard test command does not execute all of the newer tests.

**Recommendation:** Update the test configuration as part of the redesign so that the newer conversation and bubble tests are included in the regular validation process.

I inspected the source but did not execute the application or its test suite. Runtime appearance, actual frame rate, and browser behavior therefore remain unverified.

---

# 12. Final recommendation

**Do not continue with isolated visual improvement tasks against the current floor plan.**

The current Three.js architecture is sufficient to support your goal, but its facility composition is fundamentally different from your reference.

The most productive next development sprint is:

### HERMES-LIFE-UI-VIS-008 — Eight-Room Starship Bridge Reconstruction

**Primary objective:**

Replace the current open-plan operations laboratory with the eight-room, interconnected isometric facility shown in your reference image.

**Scope:**
- Correct the master specification.
- Introduce a physical room model independent of backend roles.
- Reconstruct room and corridor geometry.
- Preserve the existing Three.js renderer.
- Retain all seven resident roles.
- Reconfigure camera framing.
- Preserve backend state and existing task integrations.
- Establish screenshot-based visual acceptance tests.

**Do not bundle the complete dashboard redesign, advanced resident pathfinding, and further bubble development into this first sprint.** Those depend on having stable room geometry and coordinates.

Once the eight-room structure is correct, the subsequent environmental art, dashboard, and animation work becomes much more manageable.

### Bottom line

Your repository is not missing a 3D engine, resident system, or runtime event infrastructure.

**It is missing the specific architectural composition and presentation design represented by your screenshot.**

Fixing the development specification and reconstructing the facility are the two highest-value steps toward achieving the UI you actually want.