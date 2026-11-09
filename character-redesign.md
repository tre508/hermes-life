# VIS-006 — HERMES LIFE CHARACTER REDESIGN

**Project:** Hermes Life — AI Operations Lab  
**Reference:** `HERMES_LIFE_3D_REDESIGN_MASTER_SPEC.md`  
**Type:** Character design, 3D modeling, animation, and visual fidelity  
**Priority:** HIGH  
**Scope:** All seven resident characters and their interaction with the existing environment.

---

# 1. Development Objective

Redesign the seven Hermes Life residents to resemble polished, recognizable characters from a modern stylized 3D simulation game.

The current facility has progressed beyond its initial prototype appearance. Its architecture, furniture, materials, and workstation arrangements now provide a more convincing environment.

However, the individual characters have not received an equivalent level of refinement.

They continue to resemble basic geometric placeholders.

**The goal is to replace the placeholder-quality characters with complete, distinctive, expressive 3D characters while preserving the existing backend-driven activity system.**

The redesign must improve:

1. Character modeling and anatomy.
2. Individual character identity.
3. Clothing and personal accessories.
4. Facial features and expression.
5. Character proportions and scale.
6. Natural body posture.
7. Walking and turning animations.
8. Role-specific working animations.
9. Interaction with furniture and equipment.
10. Animation quality and continuity.

The characters should appear to belong to the same fictional workplace while retaining recognizable individual identities.

---

# 2. CRITICAL — All Seven Characters Look Too Similar

**Severity: CRITICAL**

## Current implementation

The screenshot shows seven humanoid characters represented through similarly constructed geometry.

Most share:

- Nearly identical round heads.
- Similar cylindrical or rectangular torsos.
- Basic limb structures.
- Comparable heights.
- Similar facial arrangements.
- Similar overall proportions.

Their primary distinguishing characteristics are their colors and locations.

The viewer must rely heavily on labels and workstation placement to identify individual residents.

## Expected design

Every resident should have a distinct, recognizable appearance.

The seven characters must share a consistent overall art style without looking like recolored copies of the same model.

## Required corrections

Create a character design system supporting differences in:

- Head and face shapes.
- Hairstyles or headwear.
- Body proportions.
- Clothing silhouettes.
- Facial characteristics.
- Accessories.
- Personal color palettes.
- Standing postures.
- Idle animations.
- Role-specific gestures.

Differences should be immediately recognizable rather than requiring close examination.

### Acceptance criteria

All seven characters must be distinguishable in a lineup without relying on text labels or workstation location.

---

# 3. CRITICAL — Character Models Lack Proper Anatomy

**Severity: CRITICAL**

## Current implementation

The characters appear to have simplified geometric body structures.

Heads resemble basic spheres.

Arms and legs lack sufficient definition.

Hands and feet are difficult to distinguish.

The overall appearance resembles early-stage prototype models.

## Expected design

Stylized humanoid characters with recognizable anatomy and convincing proportions.

Photorealism is unnecessary.

However, the characters should appear intentionally designed rather than assembled from basic shapes.

## Required corrections

Improve the character models to include:

### Head

- Distinct head shape.
- Defined jaw or chin silhouette.
- Properly positioned facial features.
- Recognizable hairstyle or headwear.
- Natural head-to-neck proportions.

### Torso

- Defined shoulders.
- Recognizable chest and waist structure.
- Clothing that follows body shape.
- Improved transitions between body parts.

### Arms

- Clearly defined upper arms and forearms.
- Visible elbows.
- Proper shoulder attachment.
- Hands capable of recognizable gestures.

### Legs

- Defined thighs and lower legs.
- Visible knee articulation.
- Proper leg length relative to the torso.
- Feet that establish convincing floor contact.

### Overall proportions

Use a coherent stylized proportion system across the entire roster.

The models should be visually appealing at the normal isometric viewing angle.

Exaggerated proportions are acceptable when consistent with the selected art direction.

---

# 4. HIGH — Character Faces Have Insufficient Detail

**Severity: HIGH**

## Current implementation

Faces are extremely simplified.

The figures have little visible expression or individuality.

At the current camera scale, it is difficult to interpret what each character is looking at or how they are reacting.

## Expected design

Readable, stylized facial features appropriate for a simulation game.

The characters should communicate basic emotional and operational states without requiring realistic facial animation.

## Required corrections

Implement a lightweight facial-expression system.

Suggested expressions:

| Character state | Facial behavior |
|---|---|
| Idle | Neutral, relaxed expression |
| Working | Focused, attentive |
| Waiting | Patient, expectant |
| Completed | Brief positive acknowledgment |
| Failed | Concerned or disappointed |
| Blocked | Confused or uncertain |
| Unknown | Neutral expression without implied activity |

At minimum, improve:

- Eyes.
- Eyebrows.
- Mouth.
- Head orientation.
- Expression readability.

Use simple facial meshes, texture atlases, or lightweight expression systems where appropriate.

Do not introduce expensive facial rigs unless necessary.

**Important:** Facial expressions must not imply operational success, failure, or active work without corresponding system state.

---

# 5. HIGH — Individual Characters Lack Distinct Personalities

**Severity: HIGH**

## Expected design

Each character should represent a recognizable professional role within Hermes Life.

Their visual identities should communicate their responsibilities without relying exclusively on labels.

The following design directions are proposed concepts rather than established character canon. They should be implemented consistently unless an existing character design has already been approved.

## 5.1 Hermes — Coordinator

**Role:** Central coordination, communication, and system oversight.

### Visual identity

Hermes should appear as the central character of the facility.

Proposed design:

- Contemporary smart-casual clothing.
- Distinctive jacket or layered upper garment.
- Cyan or teal accents.
- Recognizable hairstyle or head silhouette.
- Small wrist-mounted technology accessory.
- Confident but relaxed posture.

### Character behavior

**Idle:** Relaxed standing pose with subtle breathing and occasional natural head movement.

**Chatting:** Turns toward the central communication display.

**Working:** Interacts with the command console when supported by the actual backend activity.

**Waiting:** Attentive posture.

**Completed:** Brief acknowledgment gesture.

**Error:** Short, restrained confused reaction.

### Specific requirement

Hermes should remain visually identifiable even when standing beside another resident.

The coordinator should not simply appear as a differently colored version of the other six characters.

---

## 5.2 Sage — Researcher

**Role:** Research, investigation, discovery, and information analysis.

### Visual identity

Proposed design:

- Distinctive researcher-style clothing.
- Blue or cyan accents.
- Recognizable hairstyle.
- Optional glasses.
- Tablet, notebook, or research accessory.
- Thoughtful posture.

### Character behavior

**Idle:** Relaxed posture near the research workstation.

**Researching:** Examines documents or information displays.

**Reading:** Holds or interacts with a research device.

**Working:** Alternates between the workstation display and research materials.

### Specific requirement

Sage should visually communicate research activity through equipment interaction and deliberate gestures rather than a generic typing loop.

---

## 5.3 Piper — Planner

**Role:** Strategy, planning, task organization, and workflow formulation.

### Visual identity

Proposed design:

- Modern professional-casual clothing.
- Purple accent palette.
- Distinctive hairstyle or silhouette.
- Smartwatch or planning tablet.
- Organized, attentive posture.

### Character behavior

**Idle:** Relaxed seated or standing pose.

**Planning:** Interacts with a planning board.

**Reviewing plans:** Examines a tablet or workstation display.

**Awaiting approval:** Stops working and adopts a clearly distinguishable waiting pose.

### Specific requirement

Piper must not appear to continue working when a plan is awaiting human approval.

---

## 5.4 Forge — Developer

**Role:** Software implementation, coding, and project construction.

### Visual identity

Proposed design:

- Contemporary developer attire.
- Orange or amber accents.
- Distinct hairstyle or headwear.
- Casual jacket or hoodie.
- Comfortable footwear.
- Recognizable workstation accessories.

### Character behavior

**Idle:** Relaxed pose near the development station.

**Coding:** Sits naturally and interacts with a keyboard.

**Reviewing code:** Looks between monitors.

**Implementation:** Uses appropriate computer interaction animations.

**Queued:** Remains idle or waiting rather than typing.

### Specific requirement

Forge should visibly resemble a character operating a development workstation.

Hands should align with the keyboard and body posture should correspond to the chair and desk.

---

## 5.5 Patch — Tester

**Role:** Testing, verification, validation, and failure investigation.

### Visual identity

Proposed design:

- Technical clothing.
- Yellow accent palette.
- Distinct hairstyle or headwear.
- Diagnostic accessory.
- Precise, attentive posture.

### Character behavior

**Idle:** Neutral standing posture.

**Testing:** Operates a diagnostic console.

**Inspecting:** Examines equipment or displays.

**Failure:** Brief reaction followed by an appropriate alert state.

**Completed:** Short acknowledgment animation.

### Specific requirement

Patch should resemble a technical specialist interacting with verification equipment rather than a character performing generic computer work.

---

## 5.6 Echo — Archivist

**Role:** Knowledge organization, memory processing, and archival work.

### Visual identity

Proposed design:

- Distinctive scholarly or technical-casual clothing.
- Warm neutral or bronze accents.
- Recognizable hairstyle.
- Archive-related accessory.
- Calm, thoughtful posture.

### Character behavior

**Idle:** Relaxed posture near the archive.

**Archiving:** Interacts with records, files, or a knowledge terminal.

**Learning:** Examines supported knowledge material.

**Completed:** Brief filing or acknowledgment gesture.

### Specific requirement

Echo's work animations must activate only when actual memory or archival activity is confirmed.

Ordinary background presence must not imply that memory processing is occurring.

---

## 5.7 Vale — Reviewer

**Role:** Evaluation, review, approval monitoring, and result inspection.

### Visual identity

Proposed design:

- Refined professional attire.
- Green accents.
- Distinct hairstyle and facial features.
- Tablet or review-related accessory.
- Composed posture.

### Character behavior

**Idle:** Neutral standing or seated pose.

**Reviewing:** Examines a workstation display or review document.

**Awaiting approval:** Clearly stops active work and displays a waiting posture.

**Completed:** Brief acknowledgment.

**Blocked:** Stationary alert behavior.

### Specific requirement

Vale must visually distinguish active review from waiting for human authorization.

Waiting should never be represented as ongoing execution.

---

# 6. HIGH — Character Clothing Is Underdeveloped

**Severity: HIGH**

## Current implementation

Character clothing is primarily represented by the colors and shapes of basic body geometry.

Individual garments are difficult to distinguish.

## Expected design

Recognizable clothing appropriate to each resident's role.

## Required corrections

Introduce lightweight stylized clothing models.

Examples:

- Shirts.
- Jackets.
- Hoodies.
- Trousers.
- Shoes.
- Belts.
- Collars.
- Sleeves.
- Glasses.
- Watches.
- Role-specific accessories.

Clothing should fit naturally around the character's body.

Avoid simply assigning different material colors to identical torsos.

Shared base meshes may be used, but the visible clothing silhouettes should provide meaningful differentiation.

---

# 7. HIGH — Characters Need Better Scale and Readability

**Severity: HIGH**

## Current implementation

Although the facility now fills the visualization panel, the individual characters remain relatively small.

Some are partially obscured by desks, monitors, or partitions.

Details such as faces, hands, and clothing are difficult to distinguish.

## Expected design

Characters should be readable at the default camera position.

Their identities and basic poses must remain recognizable without zooming.

## Required corrections

Review:

- Character height.
- Head-to-body proportions.
- Workstation dimensions.
- Camera projection.
- Character placement.
- Furniture occlusion.
- Visual contrast.

Consider slightly exaggerated stylized proportions to improve readability.

Avoid arbitrary enlargement that causes characters to become disproportionate to furniture or architectural features.

### Acceptance criteria

At normal desktop viewing size:

- Character silhouettes are recognizable.
- Body orientation is clear.
- Idle and working poses are distinguishable.
- Individual clothing and accessories remain visible.
- Important character features are not permanently obscured by equipment.

---

# 8. HIGH — Character Poses Look Stiff

**Severity: HIGH**

## Current implementation

The screenshot shows residents in stationary poses.

Their simplified geometry and limb positions make several appear stiff.

A static screenshot cannot establish whether their existing animations are smooth or correct.

## Expected design

Natural, readable stylized poses.

Characters should resemble game characters rather than rigid figurines.

## Required corrections

Develop consistent poses for:

- Standing.
- Sitting.
- Walking.
- Turning.
- Working.
- Waiting.
- Reacting.

Introduce subtle asymmetry where appropriate.

Examples include:

- Natural arm positioning.
- Slight weight shifts.
- Relaxed shoulder posture.
- Appropriate head direction.
- Plausible seated posture.
- Proper foot placement.

Avoid extreme or exaggerated movements that conflict with the restrained art direction.

---

# 9. HIGH — Character Animation System Requires a Dedicated Quality Pass

**Severity: HIGH**

## Objective

Ensure the new characters can move convincingly between existing states.

The screenshots alone do not establish defects in the current animation implementation. Inspect actual runtime behavior before replacing any existing animation logic.

## Required animation set

### Idle

- Subtle breathing.
- Natural standing or seated posture.
- Small non-work gestures.
- No implication that a task is executing.

### Walking

- Coordinated arm and leg movement.
- Consistent forward motion.
- Appropriate walking speed.
- Stable ground contact.
- Smooth start and stop transitions.

### Turning

- Smooth rotation toward the destination.
- No abrupt snapping unless reduced motion is enabled.
- Appropriate body orientation during movement.

### Working

- Activity-specific gestures.
- Correct interaction with workstation equipment.
- Consistent head and hand positioning.
- No generic animation that misrepresents the actual role.

### Waiting

- Clearly distinct from working.
- Minimal movement.
- No active keyboard or equipment interactions.

### Completion

- Brief positive acknowledgment.
- Triggered only by an actual completion transition.
- Never replayed simply because a completed record was restored.

### Failure

- Brief reaction followed by a stationary failure state.
- No continued working animation after failure.

### Blocked

- Appropriate stationary posture.
- Clear visual distinction from active execution.

### Unknown

- Neutral presentation.
- No inferred work activity.

---

# 10. HIGH — Character and Furniture Interaction

**Severity: HIGH**

## Current implementation

Several residents appear close to desks, monitors, and partitions.

Some character bodies are difficult to distinguish because of furniture placement.

The screenshot does not demonstrate whether any mesh intersections or movement collisions actually occur.

## Expected design

Characters should visibly interact with furniture in physically coherent ways.

## Required corrections

Define explicit interaction points for each workstation.

Each role should have appropriate positions for:

1. Idle standing.
2. Workstation approach.
3. Working.
4. Waiting.
5. Departure.

When seated:

- Hips should align with the chair.
- Legs should be positioned naturally.
- Feet should reach the floor or appropriate support.
- Hands should align with the keyboard or interaction surface.
- The torso should face the workstation.
- The head should face the relevant display.

When standing:

- Feet should remain grounded.
- Limbs should not intersect nearby objects.
- The character should face the relevant equipment.
- The body should not clip through furniture.

### Acceptance criteria

Every resident can transition between their supported poses without visually intersecting furniture in an obviously incorrect manner.

---

# 11. HIGH — Character Models Need a Consistent Art Style

**Severity: HIGH**

## Expected design

All seven residents should appear to belong to the same game world.

## Required corrections

Create a shared character art-direction system.

Recommended style:

**Modern stylized 3D characters with soft geometry, expressive faces, clean silhouettes, and slightly exaggerated proportions.**

The target is comparable in broad visual approach to polished stylized management and simulation games.

Avoid:

- Photorealistic human models.
- Highly detailed skin rendering.
- Inconsistent proportions.
- Extremely simplified stick figures.
- Unrelated character styles.
- Excessively cartoonish expressions that undermine the intended environment.

### Modeling standards

Characters should share:

- Consistent head-to-body proportion guidelines.
- Similar material quality.
- A coherent clothing style.
- Consistent facial design conventions.
- Compatible animation systems.
- Comparable detail levels.

Individual differences should emerge from deliberate design choices.

---

# 12. MEDIUM–HIGH — Character Lighting and Materials Need Refinement

**Severity: MEDIUM–HIGH**

## Current implementation

Characters use relatively flat materials and simple coloring.

They do not yet demonstrate the same level of surface detail as the improved surrounding furniture.

## Expected design

Characters should have materials appropriate to their clothing, hair, skin, and accessories.

## Required corrections

Develop reusable character materials for:

- Skin.
- Hair.
- Fabric.
- Shoes.
- Accessories.
- Metallic details.
- Technology components.

Use subtle roughness and material variation.

Improve lighting so faces and body shapes remain readable.

Maintain enough contrast between characters and their workstations.

Avoid expensive subsurface scattering or realistic skin shaders.

---

# 13. MEDIUM — Character Selection and Identification

**Severity: MEDIUM**

## Expected design

Clicking a resident should remain a reliable way to inspect its actual activity and associated records.

## Required corrections

Ensure improved character geometry does not break picking.

The interactive target should cover the character's meaningful visible silhouette.

Verify:

- Mouse selection.
- Hover identification.
- Keyboard navigation.
- Tooltip consistency.
- Correct role identifiers.
- Existing read-only popovers.
- Existing navigation links.

Selection must remain reliable even when characters are partially obscured by furniture.

Do not add duplicate task-management controls inside the world.

---

# 14. Character Asset and Animation Architecture

The redesign should reuse the existing Three.js architecture.

## Recommended approach

Create a reusable character system with shared foundations and individual customization.

Suggested conceptual structure:

```text
Character System
│
├── Shared Character Foundation
│   ├── Body proportions
│   ├── Skeletal hierarchy
│   ├── Material definitions
│   ├── Facial expression interface
│   └── Animation controller
│
├── Individual Character Definitions
│   ├── Hermes
│   ├── Sage
│   ├── Piper
│   ├── Forge
│   ├── Patch
│   ├── Echo
│   └── Vale
│
├── Animation Library
│   ├── Idle
│   ├── Walk
│   ├── Turn
│   ├── Work
│   ├── Wait
│   ├── Complete
│   ├── Failed
│   └── Blocked
│
└── Environment Interaction
    ├── Standing positions
    ├── Workstation positions
    ├── Character orientation
    ├── Furniture alignment
    └── Movement transitions
```

This is a proposed conceptual organization, not a requirement to create these exact directories or classes.

Inspect the existing renderer and character implementation before establishing file boundaries.

### Architectural requirements

- Retain the established resident identifiers.
- Preserve the existing presentation-state contract.
- Keep rendering separate from backend state interpretation.
- Reuse shared geometry and materials where practical.
- Avoid unnecessary per-frame allocations.
- Dispose of character resources correctly.
- Preserve the static fallback.
- Do not introduce additional LLM calls for character behavior.

---

# 15. Character Animation State Mapping

All animations must reflect the existing authoritative activity states.

| Backend-derived state | Character presentation |
|---|---|
| `idle` | Natural idle pose |
| `queued` | Neutral waiting pose with queued indicator |
| `working` | Role-appropriate activity animation |
| `waiting_approval` | Stationary waiting pose |
| `completed` | Brief acknowledgment on a genuine transition |
| `failed` | Failure reaction followed by stationary alert |
| `blocked` | Stationary blocked-state presentation |
| `unknown` | Neutral pose with unknown-status indicator |

The renderer must not invent execution progress.

A character's animation finishing must never update backend task state.

Historic completed records must not trigger fresh celebrations after a reload.

---

# 16. Required Development Phases

## Phase A — Character System Audit

**Priority: P0**

Inspect the current implementation.

Determine:

- How characters are constructed.
- Whether models share geometry.
- How body parts are organized.
- How animations are triggered.
- How resident identity is assigned.
- How positions and orientation are calculated.
- How interactive selection works.
- Which existing components can be reused.

Document the current architecture before modifying it.

**Exit condition:** A verified understanding of the existing character implementation and its integration points.

---

## Phase B — Character Art Direction

**Priority: P0**

Define the visual identity of the seven residents.

Produce a consistent design specification covering:

- Character proportions.
- Head and facial design.
- Clothing styles.
- Material palettes.
- Individual silhouettes.
- Role-specific accessories.
- Animation conventions.

**Exit condition:** Seven coherent character designs with distinct, recognizable visual identities.

---

## Phase C — Model Refinement

**Priority: P1**

Implement the improved models.

Prioritize:

1. Anatomical proportions.
2. Head and face design.
3. Clothing.
4. Hands and feet.
5. Accessories.
6. Consistent material treatment.

Reuse shared model components when appropriate.

**Exit condition:** All seven residents look like intentionally designed stylized game characters rather than placeholders.

---

## Phase D — Animation Refinement

**Priority: P1**

Inspect and improve:

- Idle breathing.
- Body weight shifts.
- Turning.
- Walking cycles.
- Start and stop transitions.
- Working animations.
- Waiting poses.
- Completion acknowledgments.
- Failure and blocked-state reactions.

Verify actual movement and animation behavior rather than assuming defects from static screenshots.

**Exit condition:** Character motion is coherent, recognizable, and correctly tied to activity states.

---

## Phase E — Workstation Interaction

**Priority: P1**

Refine:

- Interaction coordinates.
- Character orientation.
- Chair alignment.
- Desk alignment.
- Hand placement.
- Head direction.
- Collision and occlusion behavior.

**Exit condition:** Each resident can convincingly interact with its assigned workstation.

---

## Phase F — Integration and Regression Validation

**Priority: P1**

Verify:

- All seven residents render correctly.
- Character identities remain stable.
- Backend events activate the correct animations.
- Waiting is never represented as working.
- Selection and popovers still function.
- Navigation remains unchanged.
- Reduced motion remains functional.
- Reconnection restores accurate states.
- No animation restarts unnecessarily after polling.
- Performance remains acceptable.
- No resource leaks are introduced.

**Exit condition:** The redesigned characters are visually improved without breaking the established application behavior.

---

# 17. Mandatory Visual Acceptance Tests

## Test 1 — Character Lineup

Display all seven residents together in a temporary development-only comparison view or captured test scene.

Verify that each has:

- A distinct silhouette.
- Recognizable clothing.
- Individual facial characteristics.
- Role-specific accessories.
- Consistent proportions.
- Compatible materials.

The production UI must not gain a permanent character-customization or lineup screen solely for testing.

## Test 2 — Normal Viewing Scale

Capture the standard AI Operations Lab viewport.

Verify that the characters remain recognizable at the normal camera position.

Do not rely exclusively on enlarged model previews.

## Test 3 — Idle Animation

Display all residents in the idle state.

Verify natural, subtle movement.

No character should appear to execute work.

## Test 4 — Role-Specific Working Animation

Activate each supported working state using controlled presentation-state fixtures.

Verify that each resident performs a visually appropriate role-specific animation.

This validates the renderer; separate integration testing must confirm actual backend event mappings.

## Test 5 — Workstation Interaction

Verify the relationship between character body parts and workstation equipment.

Check for:

- Incorrect desk height.
- Floating feet.
- Hands passing through equipment.
- Incorrect sitting posture.
- Characters facing away from their workstations.
- Visible mesh intersections.

## Test 6 — Movement

Verify:

- Start transition.
- Walking animation.
- Direction changes.
- Arrival.
- Stop transition.
- Return to idle.

No sudden jumps, resets, or unexplained changes in body orientation.

## Test 7 — State Accuracy

Verify that the character correctly represents:

- Idle.
- Queued.
- Working.
- Waiting for approval.
- Completed.
- Failed.
- Blocked.
- Unknown.

## Test 8 — Reduced Motion

Disable motion.

Verify that all residents continue displaying their correct status without unnecessary animation.

## Test 9 — Interaction

Select every character.

Verify that the correct read-only information panel opens.

## Test 10 — Performance

Measure the complete facility with all seven redesigned characters visible.

The implementation should preserve the established rendering-performance targets without unnecessary GPU or memory overhead.

---

# 18. Non-Negotiable Constraints

Do not:

- Redesign the entire facility again.
- Replace Three.js.
- Reintroduce Phaser.
- Modify backend task execution.
- Change persisted role identifiers.
- Create actual independent agents for the seven roles.
- Add fabricated character activities.
- Change the existing dashboard tabs.
- Replace authoritative task states with animation states.
- Introduce expensive animation systems without justification.
- Break reduced-motion behavior.
- Break the static fallback.
- Create duplicate character state machines.

The character redesign must operate within the existing Hermes Life architecture.

---

# 19. Definition of Done

The milestone is complete only when:

- [ ] Hermes has a recognizable individual appearance.
- [ ] Sage has a recognizable individual appearance.
- [ ] Piper has a recognizable individual appearance.
- [ ] Forge has a recognizable individual appearance.
- [ ] Patch has a recognizable individual appearance.
- [ ] Echo has a recognizable individual appearance.
- [ ] Vale has a recognizable individual appearance.
- [ ] Character bodies have coherent stylized anatomy.
- [ ] Clothing and accessories distinguish individual residents.
- [ ] Faces support appropriate expressions.
- [ ] Characters are readable at normal viewing scale.
- [ ] Character materials match the improved environment.
- [ ] Standing and sitting poses look natural.
- [ ] Walking and turning animations are smooth.
- [ ] Role-specific working animations are recognizable.
- [ ] Characters interact convincingly with furniture.
- [ ] Resident selection remains accurate.
- [ ] Animations remain synchronized with actual backend activity.
- [ ] Reduced-motion behavior works.
- [ ] Existing functionality remains unchanged.
- [ ] All relevant automated tests pass.
- [ ] Visual comparison captures demonstrate improvements for every character.

---

# 20. Final Expected Result

The finished AI Operations Lab should contain seven distinctive, visually polished characters.

Each character must have an identifiable appearance, recognizable professional role, and coherent set of animations.

The characters should look like individuals inhabiting the same modern 3D simulation environment, not identical geometric figures assigned different colors.

The improved environment must be matched by equally polished character design.

**Final design objective: Seven recognizable, expressive, naturally animated 3D residents whose actions accurately reflect the real Hermes Life system.**

The redesign is successful when users can recognize the characters, understand their current activity, and observe believable interaction with their workstations without depending entirely on text labels or colored indicators.