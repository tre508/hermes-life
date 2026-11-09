# VIS-005 — HERMES LIFE 3D VISUAL FIDELITY OVERHAUL

**Project:** Hermes Life — AI Operations Lab  
**Reference:** `HERMES_LIFE_3D_REDESIGN_MASTER_SPEC.md`  
**Type:** Visual redesign and graphics-quality improvement  
**Priority:** HIGH  
**Scope:** Existing Three.js renderer, environment assets, character presentation, lighting, materials, and visual effects.

## 1. Objective

Transform the current AI Operations Lab from a basic procedurally generated 3D prototype into a visually polished, modern, stylized simulation-game environment.

The latest implementation successfully addresses the previous viewport utilization and room-layout deficiencies.

The environment now fills the available visualization panel and contains recognizable functional departments.

However, its appearance remains unfinished.

The geometry, materials, lighting, characters, and environmental details still resemble an early game development prototype.

**The objective is not to add more objects. It is to significantly improve the visual quality of the objects and environment that already exist.**

The desired result is a stylized, high-quality 3D simulation environment with a cohesive art direction, visually distinct departments, believable materials, polished characters, and atmospheric lighting.

The result must remain compatible with the established Three.js architecture and performance requirements.

---

# 2. Critical Discrepancy — Excessive Gray and Monochromatic Appearance

**Severity: CRITICAL**

### Current implementation

The screenshot shows extensive use of gray across nearly every major environmental component.

This includes:

- Floor tiles.
- Structural walls.
- Workstation desks.
- Equipment cabinets.
- Glass partition frames.
- Computer housings.
- Storage units.
- Architectural supports.
- Central command platform.

Although individual workstation accents use orange, yellow, cyan, purple, and green, these colors occupy relatively small portions of the scene.

The dominant impression remains gray.

### Expected result

A cohesive, visually sophisticated laboratory environment with deliberate material and color variation.

The environment should feel contemporary, welcoming, and technologically advanced rather than industrial and unfinished.

### Required correction

Establish a comprehensive material and color system.

**Recommended art direction: Contemporary Technology Campus + Futuristic AI Laboratory.**

Use a balanced mixture of:

| Surface | Recommended visual treatment |
|---|---|
| Main floors | Warm neutral stone, light concrete, or muted blue-gray composite |
| Department floors | Distinctive material zones with subtle accent variation |
| Walls | Warm off-white, slate blue, soft charcoal, and architectural panels |
| Desks | Wood, brushed aluminum, and dark composite surfaces |
| Furniture | Fabric, leather-like materials, and painted metal |
| Cabinets | Muted complementary tones rather than uniform gray |
| Glass | Subtle blue-green transparent material with visible reflections |
| Monitors | Deep dark screens with high-contrast interface details |
| Command center | Distinctive materials with restrained cyan illumination |
| Decorative elements | Natural greens, warm materials, and selected accent colors |

Colors should be coordinated rather than randomly assigned.

Do not solve the problem by simply increasing saturation across the existing gray geometry.

The objective is meaningful variation in materials and surfaces.

### Acceptance criteria

- The scene is no longer overwhelmingly monochromatic.
- Floors, walls, furniture, and equipment are visually distinguishable.
- Department colors complement the overall environment.
- The facility looks intentional and professionally designed.
- Materials remain readable without relying on emissive lighting.

---

# 3. Critical Discrepancy — Flat and Unconvincing Lighting

**Severity: CRITICAL**

### Current implementation

The facility appears evenly illuminated.

There is limited visual separation between surfaces, and many objects have similar shading regardless of their position.

The lighting reveals geometry but does not create a convincing atmosphere.

### Expected result

A modern laboratory interior with soft, natural-looking illumination and controlled futuristic lighting accents.

The environment should have visible depth and a coherent lighting direction.

### Required correction

Redesign the lighting system.

Introduce a layered approach:

**Primary illumination**

Provide soft, broad illumination that gives the room a consistent base exposure.

**Directional lighting**

Use a directional source to reinforce three-dimensional forms, clarify object shapes, and establish visual depth.

**Localized lighting**

Use small emissive features to suggest workstation lights, monitor illumination, and equipment indicators.

**Contact depth**

Introduce inexpensive ambient-occlusion-like shading or baked contact shading where appropriate.

This should strengthen the visual connection between:

- Characters and floors.
- Desks and surrounding surfaces.
- Furniture and walls.
- Equipment and workstations.
- Architectural elements and flooring.

**Important:** Do not automatically introduce multiple expensive real-time shadow-casting lights.

The renderer's established performance budget remains mandatory.

### Acceptance criteria

- Objects no longer appear flat or disconnected.
- Architectural depth is clearly visible.
- Lighting contributes to the facility's visual identity.
- Emissive accents enhance the scene without overwhelming it.
- Performance remains within the defined rendering budget.

---

# 4. High Discrepancy — Geometry Still Looks Procedural and Unfinished

**Severity: HIGH**

### Current implementation

Many scene elements are visibly constructed from basic rectangular and cylindrical shapes.

Examples include:

- Cabinets.
- Desks.
- Monitors.
- Benches.
- Shelving.
- Computer equipment.
- Structural partitions.
- Characters.

Procedural geometry is not inherently undesirable.

However, the current implementation exposes the simplicity of its construction.

Objects lack the detailing and proportions associated with polished stylized game assets.

### Expected result

Furniture and equipment should resemble intentionally modeled game assets.

### Required correction

Improve existing asset geometry.

Prioritize:

- Small bevels and softened edges.
- Better proportions.
- Recognizable furniture construction.
- More detailed monitor housings.
- Desk legs and structural supports.
- Distinct cabinet doors and handles.
- Equipment ventilation and access panels.
- More convincing shelving.
- Properly modeled chairs.
- Environmental trim.

Use reusable modular components.

Where procedural geometry cannot achieve the required visual quality efficiently, consider lightweight optimized glTF assets.

Imported assets must not be introduced indiscriminately.

### Acceptance criteria

The environment should retain a stylized appearance while no longer resembling a collection of unrefined geometric primitives.

---

# 5. High Discrepancy — Characters Look Like Placeholder Models

**Severity: HIGH**

### Current implementation

The seven residents remain small, simplified humanoid figures.

Their visual identities depend heavily on their colors and name labels.

They lack enough physical detail to resemble finished stylized characters.

### Expected result

Seven distinctive characters with a coherent visual style.

They should look like residents of a modern 3D simulation game.

### Required correction

Redesign the resident models.

Each should have:

- A recognizable head shape.
- A defined torso.
- Arms and legs.
- Appropriate hands and feet.
- Consistent anatomical proportions.
- Distinct clothing.
- Individual silhouette features.
- Role-specific equipment or accessories.
- Appropriate idle and working poses.

### Suggested character differentiation

| Character | Visual identity |
|---|---|
| Hermes | Distinctive coordinator attire and subtle cyan accents |
| Sage | Researcher appearance with tablet or book |
| Piper | Planner with smart-casual clothing and planning accessories |
| Forge | Developer appearance with workstation-related accessories |
| Patch | Technical testing attire and diagnostic equipment |
| Echo | Archivist appearance with knowledge-related accessories |
| Vale | Professional reviewer attire and inspection accessories |

The characters should appear visually related, as though designed for the same game.

Avoid seven unrelated art styles.

### Animation requirements

Retain backend-driven state transitions.

Improve the visual quality of:

- Idle breathing.
- Turning.
- Walking.
- Arriving at workstations.
- Sitting or standing.
- Working.
- Waiting.
- Completion acknowledgment.
- Error and blocked-state presentation.

Never display working animations without supporting backend state.

---

# 6. High Discrepancy — Departments Lack Distinct Interior Design

**Severity: HIGH**

### Current implementation

The departments contain different equipment, but most share the same underlying gray structural design.

Their identities depend heavily on colored floor outlines, labels, and selected props.

### Expected result

Each department should have a recognizable interior style while remaining part of one cohesive facility.

### Required correction

Introduce differentiated design treatments.

**Command Center**

A refined operations area with premium materials, integrated displays, and prominent architectural treatment.

**Research Laboratory**

A warmer knowledge-oriented environment combining bookshelves, display surfaces, research equipment, and comfortable furniture.

**Strategy Room**

An organized planning environment with large visual boards, collaborative surfaces, and contemporary office furniture.

**Development Studio**

A modern software engineering workspace with refined computer equipment, ergonomic furniture, and integrated technical displays.

**Verification Laboratory**

A precise technical workspace with diagnostic consoles, testing equipment, and purposeful lighting.

**Knowledge Archive**

A hybrid digital/physical archive featuring organized storage systems, information terminals, and distinct material accents.

**Review & Approval**

A professional evaluation space with structured information displays and a clean, focused interior.

The differences should be communicated through furniture, materials, and architectural details rather than color alone.

---

# 7. High Discrepancy — Lack of Surface Detail and Texture

**Severity: HIGH**

### Current implementation

Most surfaces use flat, uniform colors.

Floors, walls, cabinets, and furniture lack meaningful surface characteristics.

This contributes substantially to the unfinished appearance.

### Expected result

Stylized materials with controlled surface detail.

### Required correction

Introduce lightweight material variation.

Potential improvements include:

- Subtle flooring texture.
- Wood grain on selected furniture.
- Brushed-metal details.
- Fabric-like chair materials.
- Cabinet surface variation.
- Slight roughness differences.
- Normal-map details where justified.
- Architectural panel seams.
- Decorative trim.

Textures should be consistent with the intended art direction.

Avoid excessive realism, noisy patterns, or large high-resolution texture sets.

Prefer reusable materials and shared texture atlases.

### Acceptance criteria

Surfaces should have recognizable material characteristics without becoming visually cluttered.

---

# 8. Medium–High Discrepancy — The Facility Lacks a Finished Game Atmosphere

**Severity: MEDIUM–HIGH**

### Current implementation

The facility contains appropriate office equipment but lacks the visual cohesion and environmental atmosphere associated with a finished 3D game.

### Expected result

A modern, inhabited, visually appealing AI operations environment.

### Required correction

Add restrained environmental polish.

Examples include:

- Integrated architectural lighting.
- More refined planters and greenery.
- Wall decorations appropriate to each department.
- Consistent signage.
- Purposeful small-scale equipment details.
- Improved computer screen presentation.
- Soft material contrast.
- Subtle reflective or emissive accents.
- Carefully considered negative space.

Decorative details should remain secondary to the characters and workstations.

Do not introduce unnecessary animated activity that could be mistaken for actual backend work.

---

# 9. Medium–High Discrepancy — Monitors and Technical Displays Need Better Visual Design

**Severity: MEDIUM–HIGH**

### Current implementation

Screens appear as dark rectangles containing relatively simple colored lines and interface elements.

They communicate the presence of computers but do not yet look like polished workstation displays.

### Expected result

Recognizable modern displays with carefully designed interface content.

### Required correction

Improve:

- Monitor geometry.
- Screen proportions.
- Display borders.
- Screen materials.
- Interface typography.
- Visual hierarchy.
- Controlled screen illumination.
- Role-specific content.

The content should reflect the department's function.

Where screens present operational state, they must use real backend information.

Decorative screens must not falsely imply that tasks are executing.

---

# 10. Medium — Glass and Reflective Materials Are Unconvincing

**Severity: MEDIUM**

### Current implementation

Partitions are primarily communicated through dark frames and transparent panels.

The glass lacks enough visual presence to consistently resemble a real architectural material.

### Expected result

Clean, contemporary glass partitions integrated into the surrounding architecture.

### Required correction

Improve:

- Transparency.
- Tint.
- Edge highlights.
- Material roughness.
- Frame construction.
- Depth relationships.
- Visual separation from surrounding objects.

Use inexpensive Three.js material features where possible.

Avoid expensive screen-space reflections.

---

# 11. Medium — Insufficient Environmental Contrast

**Severity: MEDIUM**

### Current implementation

Several characters and pieces of equipment blend into similarly colored surrounding surfaces.

Dark monitors, black partitions, gray furniture, and gray architecture can become difficult to distinguish.

### Expected result

Clear visual separation among:

1. Architecture.
2. Furniture.
3. Characters.
4. Interactive equipment.
5. Operational indicators.

### Required correction

Establish a consistent hierarchy of contrast.

Characters and interactive equipment should remain distinguishable from the environment.

Background architecture should provide visual structure without dominating the scene.

Accent colors should highlight relevant information rather than compensate for insufficient material contrast.

---

# 12. Required Development Approach

The existing environment layout should remain intact unless a specific visual problem requires adjustment.

The goal is to improve visual fidelity, not restart the redesign.

## Phase A — Art Direction and Material System

**Priority: P0**

1. Audit existing colors and materials.
2. Establish a cohesive architectural palette.
3. Replace excessive gray surfaces with differentiated materials.
4. Create shared material definitions.
5. Introduce restrained surface texture and roughness variation.
6. Verify the new palette across all seven work areas.

**Exit condition:** The facility is visually cohesive and no longer overwhelmingly gray.

## Phase B — Lighting and Depth

**Priority: P0**

1. Inspect the current lighting setup.
2. Improve primary illumination.
3. Strengthen depth cues.
4. Refine emissive workstation effects.
5. Introduce inexpensive contact shading where appropriate.
6. Validate performance.

**Exit condition:** The facility has convincing visual depth and a consistent lighting atmosphere.

## Phase C — Asset Quality

**Priority: P1**

1. Refine furniture geometry.
2. Improve monitor and console models.
3. Improve cabinet and shelving details.
4. Add appropriate edge treatment.
5. Improve material assignments.
6. Reuse optimized geometry and materials.

**Exit condition:** Furniture and equipment resemble polished stylized game assets.

## Phase D — Character Redesign

**Priority: P1**

1. Establish a shared character art style.
2. Improve proportions and anatomy.
3. Give all seven residents distinct appearances.
4. Improve role-specific accessories.
5. Verify workstation placement.
6. Preserve existing activity-state mappings.
7. Refine animations and transitions.

**Exit condition:** All seven residents are recognizable as finished stylized characters.

## Phase E — Department Refinement

**Priority: P1**

1. Differentiate departmental interior designs.
2. Refine workstation equipment arrangements.
3. Improve signage.
4. Upgrade monitor interface presentation.
5. Add restrained environmental detail.
6. Improve overall visual consistency.

**Exit condition:** Each department is recognizable without relying primarily on floating labels.

## Phase F — Final Visual and Functional Validation

**Priority: P1**

Validate:

- Standard desktop presentation.
- Smaller supported viewports.
- Character visibility.
- Department readability.
- Camera composition.
- Resident selection.
- Workstation selection.
- Backend event synchronization.
- Activity animations.
- Reduced motion.
- Static fallback.
- Performance.
- Resource cleanup.

Document before-and-after screenshots and measured rendering performance.

---

# 13. Mandatory Constraints

Preserve the existing:

- Three.js rendering architecture.
- Renderer interface.
- `town-model.ts` state management.
- Backend event and snapshot mappings.
- Seven logical residents.
- Current facility layout.
- Existing dashboard tabs.
- Task and project workflows.
- Navigation handlers.
- Approval systems.
- WebSocket synchronization.
- Reduced-motion support.
- Static fallback renderer.

Do not create additional autonomous agents or fabricated activities.

Do not introduce expensive rendering features without measuring their impact.

The established performance target remains 60 FPS on the reference system, with a documented minimum target of 30 FPS.

---

# 14. Acceptance Criteria

The milestone is complete only when:

- [ ] The facility no longer appears overwhelmingly gray.
- [ ] Materials clearly distinguish floors, walls, furniture, glass, and equipment.
- [ ] The environment has a cohesive, recognizable art direction.
- [ ] Lighting provides visible depth and atmosphere.
- [ ] Workstations resemble polished stylized game assets.
- [ ] Characters have recognizable, individual appearances.
- [ ] All seven departments have distinctive interior designs.
- [ ] Surface details and textures improve visual quality without excessive noise.
- [ ] Monitors and technical displays have refined, readable designs.
- [ ] The central command center is visually prominent.
- [ ] The layout remains readable at the normal panel size.
- [ ] The renderer meets its established performance requirements.
- [ ] Existing agent-state visualization remains accurate.
- [ ] No backend, dashboard, or workflow regressions are introduced.
- [ ] Before-and-after screenshots demonstrate substantial improvements in visual fidelity.

---

# 15. Definition of Done

The goal is not simply to make the existing scene more colorful.

The finished environment must display:

**Material quality:** Surfaces resemble recognizable real-world materials.

**Lighting quality:** Objects have convincing shape, separation, and depth.

**Asset quality:** Furniture, equipment, and characters appear intentionally modeled rather than assembled from obvious placeholders.

**Environmental quality:** Departments feel like distinctive, coherent areas within a shared facility.

**Visual identity:** The entire scene has a unified modern, stylized, futuristic design.

**Operational integrity:** All activities continue to represent actual Hermes Life backend state.

### Final Design Target

A polished, visually engaging 3D AI Operations Lab with the aesthetic quality of a modern stylized management or simulation game.

The environment should retain the existing successful layout and functionality while substantially improving materials, lighting, character modeling, environmental detail, and overall visual cohesion.

**Success means that the world looks like an intentionally art-directed game environment rather than a functional 3D prototype.**