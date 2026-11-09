# HERMES LIFE — 3D WORLD VISUAL DISCREPANCY AUDIT V2

**Reference document:** `HERMES_LIFE_3D_REDESIGN_MASTER_SPEC.md`  
**Implementation:** Hermes Life Town v0.4.0  
**Scope:** 3D scene composition, viewport utilization, environment design, architectural presentation, characters, workstations, materials, lighting, and visual fidelity.

**Primary objective:** Transform the current miniature, boxed-in 3D facility into an immersive, visually complete AI Operations Lab that properly occupies the existing visualization panel.

---

# 1. Executive Assessment

The latest implementation shows substantial progress compared with the previous version.

Improvements visible in the screenshot include:

- More detailed workstation equipment.
- Recognizable computer monitors.
- Dedicated development and verification areas.
- Research bookshelves.
- Glass workstation partitions.
- More detailed flooring.
- Wall-mounted technology panels.
- Additional environmental furniture.
- More substantial command-center equipment.
- Improved differentiation between functional departments.

However, the implementation still does not achieve the desired visual presentation.

**The central problem is that the facility is presented as a small, isolated architectural model surrounded by unused dark space, rather than as an immersive environment occupying the available viewport.**

The environment also continues to rely heavily on simplistic procedural geometry, lacks visual depth and atmosphere, and uses a composition that makes many of the newly added details difficult to appreciate.

The next iteration should prioritize viewport composition and environmental presentation before adding further decorative objects.

---

# 2. CRITICAL — The Facility Is Confined to a Square-Like Island Inside the Canvas

**Severity: CRITICAL**  
**Priority: P0**

## Expected behavior

The 3D environment should occupy the available visualization area naturally.

The scene should feel like the viewer is looking into the facility itself, not observing a miniature model floating inside a rectangular presentation box.

The facility should visually extend toward the boundaries of the visualization panel.

The background, flooring, walls, and environmental structure should appear integrated with the available viewing area.

## Current implementation

The screenshot shows a large rectangular canvas containing an isolated, diamond-shaped facility.

The facility has clearly visible outer floor boundaries, with empty, nearly black space surrounding the structure.

The result resembles a miniature building model sitting on a platform.

This creates several problems:

1. Large sections of the canvas contain no meaningful visual content.
2. The facility feels disconnected from the rest of the interface.
3. The 3D world appears unnecessarily small.
4. Characters and equipment become difficult to distinguish.
5. The visible floor perimeter makes the facility look like a floating display model.
6. The dark surrounding area emphasizes the artificial boundary of the environment.
7. The scene does not feel spatially immersive.

## Likely underlying design issue

The screenshot is consistent with a finite room model being framed entirely within an orthographic camera view.

The entire floor and exterior boundaries are deliberately visible, leaving background space around the model.

This is primarily a scene-framing and world-composition issue, not necessarily a problem with the HTML canvas dimensions.

**Changing the canvas width alone will not resolve the problem if the camera continues framing the same isolated model.**

## Required correction

Redesign the camera composition and environment boundary treatment.

The implementation should:

- Make the rendered world visually occupy substantially more of the available panel.
- Reduce unnecessary empty margins.
- Reconsider whether the full outer perimeter of the room must remain visible.
- Allow the environment to extend beyond the visible camera frame where appropriate.
- Remove the appearance of a standalone platform floating in a black void.
- Establish a cohesive relationship between the background and the physical environment.
- Preserve the visibility and usability of all seven functional departments.

The renderer should not simply scale the existing model until objects are clipped randomly.

Instead, redesign the scene composition intentionally.

## Required visual outcome

The viewer should perceive the facility as the environment they are looking into.

**Not:** A miniature laboratory model surrounded by black space.

**Target:** A laboratory environment that occupies the visualization panel and feels like a coherent three-dimensional workspace.

---

# 3. CRITICAL — The Background Is Not Integrated With the 3D World

**Severity: CRITICAL**  
**Priority: P0**

## Expected design

The surrounding visual space should complement the 3D environment.

The environment should have an intentional background treatment that reinforces the laboratory setting.

The background should not appear as an empty void outside a self-contained model.

## Current implementation

The scene uses a nearly black background.

The edges of the facility terminate abruptly against this empty space.

The room effectively exists as a separate island inside the canvas.

There is no visual continuation beyond the room's physical boundaries.

## Required correction

Replace the current isolated-world presentation with a cohesive environment treatment.

Potential solutions include:

### Approach A — Extended environment

Continue the floor and environmental surfaces beyond the immediate seven-department facility.

The primary work areas would occupy the foreground while additional architectural surfaces provide continuity.

### Approach B — Immersive interior framing

Position the camera closer to the interior and allow surrounding architecture to extend outside the visible frame.

This removes the need to display the entire exterior perimeter.

### Approach C — Integrated scene background

Create a designed background that visually connects to the laboratory through compatible geometry, lighting, and environmental detailing.

The result should not resemble a black canvas behind an architectural model.

## Preferred direction

Use **immersive interior framing combined with limited environmental extension**.

This should provide greater visual occupancy without requiring a substantially larger facility or introducing additional fictional work areas.

Do not simply replace the black background with a flat gradient while leaving the same boxed-in composition.

---

# 4. HIGH — Camera Framing Makes the Facility Appear Too Small

**Severity: HIGH**  
**Priority: P1**

## Expected design

The isometric camera should emphasize:

- Characters.
- Workstations.
- Environmental details.
- Functional departments.
- The central command center.

The viewer should be able to appreciate the facility's design without excessive empty space.

## Current implementation

The camera is positioned far enough away to show almost the entire floor and both perimeter walls.

As a result, the facility occupies a relatively small portion of the canvas.

The newly added monitors, furniture, and equipment become visually compressed.

Character figures are particularly difficult to distinguish.

## Required correction

Reevaluate:

- Orthographic camera bounds.
- Camera target position.
- Camera angle.
- Facility proportions.
- Scene scale.
- Distribution of visible objects.
- Required margins around interactive elements.

The goal is to improve the effective size of the environment and its contents.

The camera should prioritize meaningful visual information rather than showing the entire room boundary at all times.

## Acceptance criteria

At normal desktop panel dimensions:

1. The facility is the dominant visual element.
2. Characters are clearly identifiable.
3. Workstations have recognizable shapes.
4. Environmental details remain legible.
5. The central command center remains prominent.
6. Important objects are not accidentally cropped.
7. No major portion of the scene is occupied by unnecessary empty background.

---

# 5. HIGH — The Environment Still Resembles an Architectural Diorama

**Severity: HIGH**  
**Priority: P1**

## Expected design

The target is a modern laboratory–office environment with a coherent, immersive appearance.

It should resemble a stylized simulation-game environment rather than an architectural presentation model.

## Current implementation

The facility has:

- A completely visible exterior floor platform.
- Exposed perimeter walls.
- Clearly defined outer geometry.
- Uniform low-poly construction.
- An elevated viewing angle showing the entire structure.

Combined, these elements make the environment look like a tabletop diorama.

## Required correction

Reduce the architectural-model appearance by reconsidering:

- Exposed platform edges.
- Outer wall visibility.
- Floor termination.
- Camera distance.
- Environmental depth.
- The relationship between work areas and the surrounding structure.

The floor should feel like part of a building rather than a detached platform.

The viewer should experience the workspace as an interior environment.

Maintaining an isometric perspective is acceptable, but the current isolated-platform presentation should not remain the defining visual feature.

---

# 6. HIGH — Architectural Detail Is Inconsistent

**Severity: HIGH**  
**Priority: P1**

## Expected design

The facility should have a cohesive architectural design.

Its interior should resemble a deliberately constructed modern technology workspace.

## Current implementation

The new scene includes walls, partitions, cabinets, monitors, and flooring.

However, these elements are not consistently integrated.

The outer walls have little architectural detailing beyond panel divisions and screens.

Several departments appear separated by thin glass frames rather than meaningful interior architecture.

The environment lacks clear transitions between different functional spaces.

## Required correction

Improve architectural cohesion through:

- Consistent wall construction.
- Integrated glass partition systems.
- More deliberate flooring transitions.
- Structural elements that define functional departments.
- Realistic relationships between cabinets, equipment, and walls.
- Integrated lighting fixtures.
- Consistent materials and construction details.
- Better treatment of corners, entrances, and circulation areas.

Every major environmental element should appear to belong to the same facility.

Avoid simply adding more unrelated objects to fill empty areas.

---

# 7. HIGH — Characters Remain Too Small and Visually Simplistic

**Severity: HIGH**  
**Priority: P1**

## Expected design

All seven residents should have recognizable, stylized character models.

They should be distinguishable through appearance, posture, and accessories rather than relying primarily on names and colors.

## Current implementation

The characters still appear as small geometric figures.

The screenshot shows limited visible differentiation in:

- Body structure.
- Clothing.
- Proportions.
- Individual features.
- Facial direction.
- Posture.

Their reduced apparent size makes this especially noticeable.

Several figures are partially hidden by furniture, partitions, or interface labels.

## Required correction

Improve character representation.

Recommended direction:

**Stylized, polished low-poly humanoid characters with distinct appearances.**

Each should have:

- Recognizable head and body proportions.
- Clear arms and legs.
- Distinctive accessories or clothing.
- Consistent character scale.
- Readable orientation.
- Natural idle posture.
- Convincing workstation interaction poses.

The character designs should remain lightweight enough for integrated graphics.

Avoid replacing simple geometry with unnecessarily high-poly assets.

## Acceptance criteria

All seven residents must be recognizable at the normal viewing scale.

Their bodies and silhouettes must remain visually distinct even when the associated text labels are not visible.

---

# 8. HIGH — The Central Command Center Is Not Yet a Strong Visual Focal Point

**Severity: HIGH**  
**Priority: P1**

## Expected design

Hermes occupies the central command area.

This should be the visual and operational focal point of the entire laboratory.

It should communicate coordination, system monitoring, and interaction with the surrounding departments.

## Current implementation

The command center now contains additional equipment and a more elaborate floor design.

However, the command area is visually crowded by nearby workstation structures, dividers, and overlapping labels.

The command ring is noticeable, but the central equipment does not establish a strong, readable command-center identity.

## Required correction

Develop a clearer central command composition.

The area should include:

- A recognizable primary command console.
- A clearly visible Hermes character.
- A coherent central platform.
- Integrated information displays.
- A restrained lighting accent.
- Clear separation from adjacent department furniture.

The command area must remain distinct without occupying an excessive proportion of the room.

---

# 9. HIGH — Text Labels Obstruct the Environment

**Severity: HIGH**  
**Priority: P1**

## Expected design

Labels should identify residents and departments without obscuring the environment.

They should support the visual design rather than dominate it.

## Current implementation

The updated labels appear as rectangular signs floating above work areas.

They overlap or visually compete with:

- Monitors.
- Characters.
- Furniture.
- Glass partitions.
- Other environmental elements.

The central label is particularly prominent.

Some department signs are difficult to read because of their position and the surrounding geometry.

## Required correction

Redesign the labeling system.

Separate three types of information:

### Permanent department identification

Use integrated architectural signage, wall markings, or clearly positioned nameplates.

### Resident identification

Use compact contextual labels or readable character nameplates.

### Operational status

Display contextual activity indicators only when relevant, grounded backend state is available.

Avoid permanently displaying large floating rectangles over every department.

## Acceptance criteria

- Department names remain readable.
- Labels do not obscure characters.
- Labels do not cover important equipment.
- Text remains legible at normal panel size.
- Labels do not overlap when the layout changes.
- Operational status is visually distinct from permanent signage.

---

# 10. HIGH — Workstation Details Are Difficult to Appreciate

**Severity: HIGH**  
**Priority: P1**

## Expected design

Each department should contain recognizable equipment and visual details appropriate to its purpose.

## Current implementation

The new implementation includes meaningful improvements:

**Development Studio**
- Computer equipment.
- Multiple monitors.
- Additional workstation geometry.

**Verification Laboratory**
- Equipment racks.
- Technical screens.
- Dedicated testing infrastructure.

**Research Laboratory**
- Bookshelves.
- Research-related furniture.

**Knowledge Archive**
- Dedicated equipment and storage elements.

These additions improve the visual differentiation of departments.

However, the overall scene scale and camera composition make many of these details difficult to distinguish.

Some equipment also appears crowded into relatively small areas.

## Required correction

Refine the environment rather than continuing to add objects indiscriminately.

Prioritize:

1. Clear silhouettes for each workstation.
2. Consistent furniture proportions.
3. More readable equipment arrangements.
4. Better spacing between objects.
5. Clear interaction positions for characters.
6. Visual differentiation between departments.
7. Reduced unnecessary clutter.

**Important:** Increasing object quantity is not the same as improving environmental quality.

The goal should be intentional, recognizable workspaces.

---

# 11. HIGH — Lighting and Material Quality Remain Underdeveloped

**Severity: HIGH**  
**Priority: P1**

## Expected design

The facility should feature a cohesive material system and restrained futuristic lighting.

Materials should differentiate:

- Metal.
- Glass.
- Flooring.
- Walls.
- Furniture.
- Screens.
- Interactive technology.

## Current implementation

Most of the environment remains composed of similarly shaded gray surfaces.

Although the room contains colored accent lighting, the overall appearance remains flat.

The screenshot provides limited visual depth between different material types.

Several glass partitions appear as transparent outlines with little material presence.

## Required correction

Introduce a more deliberate material and lighting system.

### Materials

Define a consistent palette for:

- Primary architecture.
- Secondary structural elements.
- Workstation furniture.
- Glass surfaces.
- Display screens.
- Accent components.

### Lighting

Improve:

- Ambient illumination.
- Directional lighting.
- Contrast between surfaces.
- Separation of characters from the background.
- Localized workstation accents.
- Command-center visual emphasis.

### Depth

Use inexpensive depth cues where feasible, such as:

- Carefully controlled material shading.
- Subtle floor and wall variations.
- Limited contact shading.
- Architectural layering.

Do not introduce expensive real-time rendering effects without measuring their performance impact.

---

# 12. MEDIUM–HIGH — The Environment Lacks Visual Atmosphere

**Severity: MEDIUM–HIGH**  
**Priority: P2**

## Expected design

The AI Operations Lab should have a recognizable atmosphere combining:

- Modern technology.
- A comfortable working environment.
- A restrained futuristic appearance.
- A sense of operational purpose.

## Current implementation

The environment is clean and technically organized.

However, it still resembles a procedural scene assembled from independent geometric objects.

The design lacks some of the visual qualities associated with a finished 3D environment.

## Required correction

Improve environmental atmosphere through a cohesive combination of:

- Better architectural material variation.
- Integrated light sources.
- More convincing display surfaces.
- Detailed but restrained equipment.
- Appropriate environmental furniture.
- Consistent futuristic accents.
- Improved object placement.
- Greater depth and scene continuity.

Do not rely on particles, excessive glowing effects, or animated decorations to compensate for weak environmental composition.

The facility should look complete even when every resident is idle.

---

# 13. MEDIUM — The Scene Does Not Use Its Available Screen Space Efficiently

**Severity: MEDIUM**  
**Priority: P1**

## Expected design

The visualization should make effective use of the space allocated to it.

The existing dashboard layout should remain intact, but the world should occupy its assigned panel meaningfully.

## Current implementation

The world panel occupies a substantial portion of the interface.

Inside that panel, however, the facility is surrounded by unused space.

This creates an inefficient presentation:

- A large canvas.
- A relatively compact environment.
- Small characters.
- Compressed equipment details.
- Significant empty margins.

## Required correction

Improve viewport utilization through camera framing and environment composition.

Do not solve this by enlarging the entire application layout or removing neighboring dashboard controls.

The change should remain within the existing world visualization container.

## Acceptance criteria

At supported desktop viewport sizes:

- The scene fills the world panel visually.
- The composition is balanced.
- Important content remains visible.
- The environment does not appear unnecessarily distant.
- All seven departments remain accessible.
- No horizontal or vertical overflow is introduced into adjacent UI components.

---

# 14. MEDIUM — Scene Styling and Dashboard Styling Are Not Fully Integrated

**Severity: MEDIUM**  
**Priority: P2**

## Expected design

The 3D environment should feel like an integrated component of Hermes Life.

The world and the surrounding dashboard should use a compatible visual language.

## Current implementation

The dashboard uses a relatively polished dark interface with structured cards, borders, badges, and typography.

The 3D environment uses a more basic procedural rendering style.

This creates a noticeable difference in visual maturity between the two areas.

The canvas itself is also surrounded by a prominent frame, reinforcing the appearance of a separate embedded display.

## Required correction

Improve visual continuity between the world and dashboard through:

- Coordinated colors.
- Compatible typography.
- Consistent accent colors.
- A more subtle canvas-frame treatment.
- Better scene-background integration.
- Consistent visual hierarchy.

The goal is not to redesign the existing dashboard tabs.

Only the world panel's presentation and immediately associated visual elements should change.

---

# 15. MEDIUM — Some Town-Era Terminology Remains

**Severity: MEDIUM**  
**Priority: P2**

## Expected design

The interface should consistently identify the redesigned environment as the AI Operations Lab.

Internal model identifiers must remain unchanged.

## Current implementation

Several user-facing labels have already been updated:

- Command Center.
- Development Studio.
- Strategy Room.
- Research Laboratory.
- Knowledge Archive.
- Review & Approval.

However, the application header still displays:

`HERMES LIFE TOWN / 0.4.0`

The new environment also retains some town-related presentation terminology.

## Required correction

Complete the user-facing terminology transition.

Suggested primary header:

**HERMES LIFE — AI OPERATIONS LAB**

Retain established internal role IDs, location IDs, API contracts, and navigation handlers.

Display labels may change without changing backend identity.

---

# 16. MEDIUM — Character-to-Furniture Relationships Require Refinement

**Severity: MEDIUM**  
**Priority: P2**

## Expected design

Characters should appear correctly positioned and naturally integrated with their workstations.

## Current implementation

Some figures appear close to, behind, or partially obscured by furniture.

This is not inherently incorrect in a 3D environment.

However, the small character scale and simplified geometry make their positioning difficult to interpret.

## Required correction

Verify and refine:

- Character scale.
- Floor contact.
- Desk interaction positions.
- Standing and sitting poses.
- Character orientation.
- Furniture clearance.
- Occlusion.
- Movement destinations.

Ensure that every role has a clearly defined idle position and task interaction position.

Residents must not pass through or become embedded in furniture during movement.

Runtime animation testing is required before identifying specific locomotion defects.

---

# 17. Required Implementation Strategy

The next development iteration should focus on improving the existing Three.js renderer rather than replacing the architecture.

## Phase A — Viewport and Camera Redesign

**Highest priority.**

1. Inspect the current scene dimensions and orthographic camera configuration.
2. Determine why the entire room is framed as a small isolated model.
3. Redesign the composition to occupy the available visualization panel.
4. Eliminate excessive empty background space.
5. Reconsider the visible exterior floor boundaries.
6. Improve the environment-background relationship.
7. Preserve interaction hit-testing and camera-coordinate accuracy.

**Exit condition:** The world reads as an environment occupying the panel, not as a miniature diorama.

## Phase B — Architectural and Environmental Refinement

1. Improve the integration of walls, flooring, and partitions.
2. Establish stronger departmental identities.
3. Refine workstations and furniture placement.
4. Improve material consistency.
5. Introduce architectural depth.
6. Remove unnecessary visual clutter.

**Exit condition:** The facility resembles a deliberately designed laboratory–office interior.

## Phase C — Characters and Workstation Presentation

1. Improve resident geometry and proportions.
2. Establish recognizable individual silhouettes.
3. Improve scale relative to furniture.
4. Refine workstation interaction positions.
5. Improve character visibility.
6. Preserve accurate backend-driven poses and animations.

**Exit condition:** All seven residents are visually recognizable and correctly integrated into the environment.

## Phase D — Labels, Lighting, and Visual Identity

1. Replace intrusive floating labels with more coherent signage.
2. Improve readable resident identification.
3. Refine lighting and material differentiation.
4. Strengthen the central command-center composition.
5. Complete the AI Operations Lab terminology transition.
6. Improve integration with the existing dashboard styling.

**Exit condition:** The environment has a cohesive visual identity and readable operational presentation.

## Phase E — Functional and Performance Validation

Verify the resulting changes against the existing master specification.

Required validation includes:

- Accurate backend-to-visual mapping.
- Correct resident activity states.
- Reliable character and workstation selection.
- Correct navigation to existing records.
- Proper reconnect and state restoration.
- Reduced-motion behavior.
- Static fallback behavior.
- Responsive layout.
- Stable rendering performance.
- Correct WebGL resource cleanup.
- No regressions to the existing dashboard.

---

# 18. Explicit Non-Goals

The remediation must not introduce unnecessary changes to Hermes Life.

Do not:

- Replace Three.js.
- Reintroduce Phaser.
- Rewrite the task or event system.
- Modify the backend solely for visual improvements.
- Create additional autonomous agents.
- Introduce fictional agent activity.
- Change persisted location or role identifiers.
- Add a second workflow state machine.
- Modify the seven existing dashboard tabs.
- Require photorealistic rendering.
- Require expensive lighting or postprocessing.
- Replace the static fallback with the retired renderer.

The primary goal is to improve the **presentation of the existing world**, not reconstruct its underlying functionality.

---

# 19. Final Acceptance Criteria

The visual refinement is complete only when all of the following conditions are satisfied.

### Environment and viewport

- [ ] The facility no longer appears as a small model floating inside a dark rectangular canvas.
- [ ] The environment visually occupies the available world panel.
- [ ] Unnecessary empty background margins are eliminated.
- [ ] The floor and architectural boundaries have a coherent presentation.
- [ ] The camera framing prioritizes characters and functional work areas.
- [ ] Important scene elements remain visible at supported viewport sizes.

### Architectural design

- [ ] The environment resembles a modern AI laboratory–office hybrid.
- [ ] All seven functional areas are visually distinguishable.
- [ ] Walls, partitions, flooring, and equipment share a cohesive design.
- [ ] Furniture and workstations have consistent proportions.
- [ ] Environmental detail improves the scene without introducing unnecessary clutter.

### Characters

- [ ] All seven residents have recognizable visual identities.
- [ ] Character proportions and silhouettes are consistent.
- [ ] Characters remain visible and properly positioned.
- [ ] Character interaction poses correspond to their actual activities.
- [ ] Movement and animation preserve the existing backend-driven behavior.

### Rendering and presentation

- [ ] Materials clearly distinguish structural surfaces, glass, furniture, and screens.
- [ ] Lighting provides readable depth and visual hierarchy.
- [ ] The command center is the primary focal point.
- [ ] Labels are readable without obstructing important objects.
- [ ] The scene visually integrates with the surrounding dashboard.
- [ ] User-facing terminology reflects the AI Operations Lab design.

### Functional integrity

- [ ] Existing backend contracts remain unchanged.
- [ ] All seven roles retain their original logical identities.
- [ ] State-driven animation remains accurate.
- [ ] All resident and workstation interactions function.
- [ ] Reconnect and state restoration remain correct.
- [ ] Reduced-motion and static fallback modes remain operational.
- [ ] No dashboard functionality regresses.
- [ ] Performance remains within the established rendering budget.

---

# 20. Final Assessment

The latest iteration has improved the amount of environmental detail and made the individual work areas more recognizable.

However, the overall visual result remains constrained by an architectural-diorama composition.

The environment contains more objects than before, but those improvements are undermined by the distant camera framing, visible platform boundaries, large dark background, and limited character readability.

**The next iteration should not begin by adding more furniture or decorative geometry.**

The priority is to correct the relationship between the 3D environment, the camera, and the available visualization panel.

Once the environment properly occupies the panel, the remaining improvements to architecture, characters, materials, lighting, and signage will have a much greater visual impact.

**Required outcome:** A cohesive, immersive, stylized AI Operations Lab that fills its designated visualization area, showcases all seven residents and functional departments, and preserves the existing Hermes Life architecture and operational accuracy.