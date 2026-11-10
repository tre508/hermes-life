# Hermes Life — 3D World Redesign Master Specification
## Amendment 2026-11-09 — Hermesha Command Centre

**Status:** Authoritative visual target amendment; not yet implemented or validated.  
**Applies to:** `HERMES_LIFE_3D_REDESIGN_MASTER_SPEC.md` (prior version 1.0).  
**Authority:** Supersedes contradictory visual, spatial, layout, and presentation-language requirements in that document. Existing backend, security, task, resident and event contracts continue to govern behavior.  
**Visual reference:** User-provided starship-facility screenshot from November 9, 2026. The screenshot determines composition, relative room placement, aesthetic treatment and dashboard hierarchy—not literal placeholder names, project selectors, numerical values or operational claims. Retain a copy alongside the project and record its path.

## 1. Single command centre — explicit user correction

The application must have **one and only one command centre**, named **Hermesha Command Centre**. The reference screenshot shows `ISONET` and `WeKeKe` as two workspace options, but these are **not requirements**. Do not reproduce their labels, a workspace selector for different command centres, a second facility, or separate world instances.

**Hermesha Command Centre** names the overall dashboard/facility. **Control Room** is one physical room at its centre, not a second command centre. Existing project/task context can remain available through current application workflows, but must not be confused with multiple command centres. Other sample labels in the screenshot, such as `Axiom`, are illustrative and must not override verified Hermes Life resident identity.

## 2. Requirements that MUST be preserved

1. **One logical Hermes Life backend**, not seven autonomous agents. Preserve the seven existing operational roles and identities: coordinator/Hermes, researcher/Sage, planner/Piper, builder/Forge, tester/Patch, archivist/Echo, reviewer/Vale. Do not introduce an eighth backend role just to fill an eighth room.
2. **Stable backend identifiers and data contracts**, including the existing `LocationId` values (`town_square`, `library`, `planning_house`, `workshop`, `testing_lab`, `archive`, `review_office`). Eight *visual rooms* do not entail eight persisted workflow locations.
3. **Three.js as the single animated renderer**, existing `TownRenderer` contract, clean teardown, and the accessible static DOM fallback. Do not reintroduce Phaser.
4. **Authoritative task and agent state** from real backend records and events. Keep `idle`, `queued`, `working`, `waiting_approval`, `completed`, `failed`, `blocked`, `unknown`, and live/reconnecting/disconnected semantics. Never fabricate activity, outcomes, tools, tool arguments, reasoning, progress, or timestamps.
5. **Working application features**: tasks and lifecycle, chat/conversations, Goals, Memory, Knowledge, reviews/approvals, results/evidence, and actual agent activity. Retain real deep links and authorization. Reuse implementation rather than building competing control surfaces.
6. **Real-time contextual bubbles** and grounded role animation. Preserve the existing `town-world/bubbles.ts` event pipeline and mapping of user-visible execution data. No representation of private model reasoning.
7. **Accessibility, responsiveness and performance**, including keyboard navigation, focus, reduced motion, legibility, static fallback, lifecycle cleanup, truthful state after reconnect, and measured client FPS.

## 3. Previous architectural decisions SUPERSEDED or amended

| Previous rule | New authority |
|---|---|
| Open-plan low-poly operations lab with six stations on an elliptical ring around a central dais | **Superseded.** Build the screenshot's eight-room interconnected facility with physically identifiable rooms, walls, doors, passages and the central Control Room. |
| Seven backend locations imply seven physical rooms/stations | **Amended.** Keep seven backend roles/IDs but define **eight physical visual rooms**. Room-to-role mapping is presentation-only. |
| `RING`/`facilityPlan()` automatically distributes surrounding stations | **Superseded as spatial target.** Replace with explicit room footprints, corridor graph, door openings, resident/station anchors and a tested layout. |
| Dashboard layout and navigation must remain unchanged | **Superseded for presentation only.** Reorganize frontend shell to reflect screenshot's header, left navigation, dominant facility, lower activity/task area and right contextual panels. Preserve working behaviors. |
| Fixed 800×425 composition is mandatory | **Amended.** Preserve reasonable responsive bounds, but choose view framing based on whole-facility visibility, aspect ratio and label legibility. |
| Imported textures/assets and detailed architecture are merely optional later polish | **Amended.** Screenshot-level recognizable architecture and material identity are acceptance criteria. Optimized procedural geometry/textures or imported assets may be used. |
| Deep rooms/corridors deferred as future expansion | **Superseded.** All eight architectural rooms and connections are required now. Advanced pathfinding remains separately scoped. |
| `AI Operations Lab` / `Command Center` is the primary display name | **Superseded.** Show **Hermesha Command Centre** as the sole command-centre name; **Control Room** labels its central room. |
| The screenshot's `ISONET` and `WeKeKe` buttons are functional requirements | **Explicitly rejected.** No multi-command-centre selector or second space. |
| Earlier visual milestones marked complete prove design convergence | **Superseded.** Historical milestone claims do not establish compliance with this new reference. |

**Decisions retained:** Three.js renderer, static fallback, Git rollback, existing role/location IDs, backend event authority, no duplicate agents, and performance-conscious stylized 3D.

## 4. NEW visual target

### 4.1 Eight-room floor plan

Use a fixed orthographic isometric view of one enclosed, connected sci-fi facility. From the viewer's perspective, match these placements and proportions from the reference screenshot:

| Room | Reference position | Purpose / role presentation |
|---|---|---|
| Director Office | Top center | Direction/coordination setting (do not invent a director agent) |
| Research Station | Upper left | Sage / research |
| Review Station | Upper right | Vale / reviews and approvals |
| Dev Station | Middle left | Forge / implementation |
| **Control Room** | **Centre** | Hermes / coordination; prominent circular holographic console |
| Lab | Middle right | Patch / testing and verification |
| Archive | Lower left | Echo / memory and knowledge |
| Break Room | Lower right | Environmental space for permitted, non-work idle presentation |

**Piper must not disappear.** Preserve planner/Piper as a discoverable resident with a recognizable planning workstation or sub-zone within the Director Office or Control Room. This does not add a ninth room or another backend role.

The facility must contain continuous/recognizable room shells, structural separation, doors, corridor links, differentiated flooring, appropriate furniture, readable room signage and stable interaction targets. The entire complex must remain visible at the reference desktop viewport. Do not substitute an elliptical collection of isolated station platforms.

### 4.2 Art direction

Dark navy/slate metallic sci-fi architecture; warm orange/red illuminated doorway and walkway edging; cyan/blue monitor and hologram glow; localized warm office light; detailed wall panels, beams and equipment; visible space/starfield/nebula views through external windows where consistent with the reference. Distinct room dressing: research displays, review consoles, developer desks, testing apparatus, archive shelves, director furnishings and a comfortable Break Room. The image is a *stylized target*, not a mandate for expensive photorealistic rendering. Use restrained emissive materials and optimized assets and record performance costs.

### 4.3 Characters and bubble presentation

Preserve seven distinguishable resident models. Define a home room, current visual room and actual backend activity separately. Place residents at believable desk/floor anchors; support correct seated, idle, working, waiting and alert poses. Follow projected head positions with readable, non-overlapping runtime bubbles. Allow authored room/corridor transitions **only** when grounded in real changes or clearly identified decorative, non-work idle motion; do not invent execution or autonomous actions. Advanced collision-aware route planning is not a requirement of this initial redesign.

### 4.4 One-command-centre dashboard composition

- **Header:** Hermes Life identity, **Hermesha Command Centre**, genuine Hermes connection indicator, supported motion and refresh controls. **No `ISONET`/`WeKeKe` switcher.**
- **Left rail:** World, Task Board, Chat, Goals, Memory, Knowledge, Agents, followed by room navigation shortcuts. Route to existing working modules and avoid duplicate business logic.
- **Main area:** Dominant isometric world, overview/room labels, lower task queue, current operational focus and recent activity based only on real backend records.
- **Right rail:** Context-sensitive selected resident/director details, task/focus status, application status and Hermes connection. Director actions must be backed by existing authorized operations.
- **Responsive:** Collapse/reflow rails as needed; keep world accessible, room labels legible and functional navigation discoverable.

Do not hardcode the screenshot's numerical counters, user/avatar names, timestamps, workspace labels, or operational statuses.

## 5. Functional changes PERMITTED by this redesign

Allowed: presentation-layer changes to `frontend/index.html`, `frontend/src/main.v2.ts`, `frontend/src/unified-layout.css`, `frontend/src/town-world/layout.ts`, `facility.ts`, `workstations.ts`, `props.ts`, `palette.ts`, `residents.ts`, `bubbles.ts`, `town-renderer-3d.ts`, `town-view.ts` and related tests. Introduce a typed **presentation-only** physical-room identifier and explicit room/door/corridor layout. Existing backend `LocationId` and event shape remain authoritative and stable.

Allowed: reorganizing working navigation, room selection, selected-resident context, current-task/status panels, task counters, and the already-implemented conversation/activity modules into the screenshot's single-centre presentation. Keep state and API ownership in the existing application controllers.

Not allowed without an independently approved backend change: multi-command-centre switching, new autonomous agent identities, new persisted role/location IDs, unauthorized director actions, duplicated task queues or chats, cosmetic events presented as true execution, fabricated thoughts/tool calls, or extra model calls solely to animate the facility.

## 6. Acceptance criteria based on the reference image

The implementation is accepted only when evidence demonstrates **all** of the following:

- [ ] **Exactly one Hermesha Command Centre** is presented. Neither a second space nor screenshot-derived `ISONET`/`WeKeKe` command-centre selector exists.
- [ ] All **eight listed physical rooms** exist, are recognizably bounded and occupy the reference's relative positions, with connecting doors/corridors and center-dominant Control Room.
- [ ] The *entire facility* is readable in a fixed desktop isometric overview, with no cropped rooms or substantial overlap of labels and interactive elements.
- [ ] Room identity is recognizable from geometry, furnishing and lighting even with text labels hidden.
- [ ] Dark metallic structure, warm illuminated corridor/door accents, cyan holographic displays, recognizable room-specific furnishings and space-facing windows reflect the reference's visual direction.
- [ ] All seven actual residents remain discoverable, including Piper/planning, with appropriate role anchors and truthful activity states. The Break Room does not create an eighth agent.
- [ ] Header, left rail, dominant world canvas, lower task/activity panels and right contextual rail reproduce the reference's *information hierarchy*, not its example values.
- [ ] Tasks, chat, approvals, Goals, Memory, Knowledge, agent details and results/evidence still work through existing application state and backend APIs.
- [ ] Live and historical events, role assignments, tool bubbles, task statuses and reconnect behavior are demonstrably truthful; replay never fabricates current work.
- [ ] Keyboard navigation, reduced motion, no-WebGL fallback and responsive layouts preserve functional access.
- [ ] A browser screenshot at the reference aspect ratio is reviewed against the supplied reference, with documented discrepancies in room placement, architectural silhouette, materials, lighting, UI hierarchy and readability.
- [ ] Frontend/build tests and a real task-lifecycle integration check pass; performance and teardown/resource behavior are measured and documented.

**Visual gate precedence:** Architectural layout fidelity comes before decorative polish. A polished elliptical/open-plan laboratory or a two-command-centre selector fails even if it builds successfully. Screenshot comparison does not authorize fabricated data or changes to backend semantics.

## 7. Implementation sequence

1. Record/retain the reference screenshot and amend the master spec to point to it.
2. Define the eight-room plan, Piper's planning zone, doors, corridors, role anchors and camera framing.
3. Reconstruct architectural geometry and room-specific furnishings while retaining the existing renderer interfaces.
4. Apply environmental textures, sci-fi materials, lighting and exterior windows.
5. Restructure the frontend as **one Hermesha Command Centre**, reusing existing functionality and removing the two-workspace concept.
6. Re-anchor residents and runtime bubbles; verify actual lifecycle and tool-event mapping.
7. Compare browser captures with the reference, validate interactions/accessibility/performance, and record acceptance results.

**Document governance:** Insert this amendment immediately after the metadata/introduction of `HERMES_LIFE_3D_REDESIGN_MASTER_SPEC.md`, or integrate its requirements into the matching canonical sections. It supersedes contradictory previous architectural decisions, visual scope limits, old room-count assumptions and screenshot placeholders. Preserve the prior implementation history as explicitly **historical**, not as evidence that the new target is implemented.
