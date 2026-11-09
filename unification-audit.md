# HERMES LIFE — UI UNIFICATION DISCREPANCY AUDIT

**Audit ID:** UUX-002  
**Application:** Hermes Life — AI Operations Lab v0.4.0  
**Implementation:** First iteration of the unified AI Development Workspace  
**Reference:** Previous seven-tab interface and approved unified workspace redesign  
**Scope:** Layout integrity, 3D viewport, navigation, responsive behavior, contextual sidebar, visual hierarchy, and interaction consistency.

**Overall assessment:** The navigation restructuring is directionally correct, but the implementation has significant layout and presentation defects that prevent the interface from functioning as a cohesive workspace.

---

# 1. Executive Summary

The current implementation introduces several intended improvements:

- Persistent left-side navigation.
- Four primary workspace destinations.
- A dedicated System navigation item.
- A global connection indicator.
- A global execution indicator.
- A contextual right sidebar.
- Integrated task submission.
- A current-work summary.
- A persistent Chat entry point.

These changes establish the foundation of the proposed unified application.

However, the current presentation has substantial discrepancies.

### Primary findings

1. The 3D scene does not appear correctly constrained to its parent viewport.
2. The scene overlaps or obscures existing interface elements.
3. The main workspace contains a substantial unused area.
4. The right sidebar is too narrow and extends beyond the visible screenshot.
5. The three-column layout lacks balanced proportions.
6. Operational status is inconsistent between application regions.
7. The contextual sidebar contains excessive vertically stacked content.
8. The relationship between Home, Work, Activity, Results, and Chat remains unclear.
9. Multiple visual and interaction systems appear to coexist without complete integration.
10. The overall composition still resembles an intermediate migration rather than a finished unified workspace.

The most important correction is **layout containment and composition**, followed by contextual sidebar restructuring and workflow integration.

---

# 2. CRITICAL — 3D Scene Escapes Its Intended Viewport

**Severity: P0 — Critical**

## Observed discrepancy

The 3D environment is no longer presented within a clearly defined, correctly sized visualization region.

Instead, a large rectangular portion of the rendered facility appears to extend across the main workspace and cover elements that should remain outside the scene.

The scene begins around the top of the central content area and extends downward across existing interface content.

Several elements appear partially hidden along the left and bottom edges.

The world does not appear properly integrated with the new workspace dimensions.

## Expected behavior

The Three.js scene should be contained entirely within its designated visualization component.

It must not:

- Cover dashboard controls.
- Extend over neighboring sections.
- Obscure labels or status information.
- Overlap content outside its assigned region.
- Exceed the available workspace dimensions.

The world should resize dynamically with the central workspace.

## Required correction

Inspect the DOM hierarchy and CSS positioning of:

- The world container.
- The Three.js canvas.
- The original game host.
- The new workspace container.
- Any legacy wrappers.
- Existing overlay elements.

Determine whether the problem originates from inherited absolute positioning, fixed dimensions, conflicting aspect-ratio rules, or an incorrectly sized parent.

Correct the actual layout relationship rather than applying arbitrary transforms to the canvas.

### Acceptance criteria

- The 3D scene stays entirely inside its intended container.
- No interface elements are unintentionally covered.
- The world resizes with the main content region.
- Scene rendering remains correctly aligned with pointer interactions.
- No overflow occurs when the sidebar changes size.

---

# 3. CRITICAL — Existing World UI Is Being Obscured

**Severity: P0 — Critical**

## Observed discrepancy

The previous world implementation contained several elements below the visualization:

- Resident interaction instructions.
- Connection status.
- Role counts.
- Current activity summary.
- Motion controls.
- Expandable role information.

In the new screenshot, parts of these elements appear along the edges of the world region, but portions are obscured by the enlarged 3D scene.

This suggests that the scene and its supporting HUD have not been fully adapted to the new layout.

## Expected behavior

The world visualization and its associated controls should form one coherent component.

Supporting UI must have a clear location relative to the scene.

## Required correction

Restructure the world component into distinct layout regions:

**World header**

Contains the current operational summary and contextual actions.

**3D viewport**

Contains the canvas, resident labels, and appropriate visual overlays.

**World footer**

Contains essential controls and concise status information.

The scene must not overlap the footer.

Avoid restoring every old HUD element if the same information is already displayed globally.

### Acceptance criteria

- Resident instructions remain readable.
- Motion controls remain accessible.
- No content is hidden beneath the canvas.
- Redundant status elements are consolidated.
- The world component has a predictable structure.

---

# 4. CRITICAL — Main Workspace Contains Excessive Unused Space

**Severity: P0 — Critical**

## Observed discrepancy

The main content area extends substantially below the 3D facility.

A large dark region occupies much of the remaining vertical space.

This area contains no visible information, controls, or useful workspace content.

The result makes the application feel incomplete.

The issue is particularly noticeable because the contextual sidebar contains more information than fits vertically, while the much larger central region remains mostly unused.

## Expected behavior

The Home workspace should use its available area intentionally.

The central region should not contain large unexplained gaps.

## Required correction

Reconsider the Home composition.

The world does not necessarily need to fill the entire screen vertically.

However, the remaining area should have an explicit purpose.

Recommended structure:

### Upper section

3D Operations Lab.

### Lower section

A compact operational workspace containing relevant information such as:

- Current execution.
- Recently completed tasks.
- Pending approvals.
- Recent activity.
- Relevant system notifications.

These elements should be contextually selected rather than duplicating the entire dashboard.

Alternatively, the main world region may occupy more vertical space if the additional area genuinely improves the visualization.

Do not merely stretch the 3D image to fill empty space.

### Acceptance criteria

- No large unexplained blank region remains.
- The main workspace has deliberate vertical organization.
- Important operational information is visible without unnecessary navigation.
- The world remains appropriately proportioned.

---

# 5. HIGH — Three-Column Layout Is Poorly Balanced

**Severity: P1 — High**

## Observed discrepancy

The interface contains three primary regions:

1. Narrow left navigation.
2. Very large central workspace.
3. Narrow right contextual sidebar.

The central region occupies most of the available width.

The right sidebar appears compressed.

The visual balance is inconsistent with the content each area contains.

The main workspace has substantial empty space, while the sidebar has dense information and limited reading width.

## Expected behavior

Layout proportions should reflect the current activity.

The central workspace should remain dominant, but the right sidebar must have sufficient width for its intended content.

## Required correction

Implement an adaptive three-region layout.

Suggested initial desktop proportions:

| Region | Suggested width |
|---|---|
| Navigation | 72–88 px |
| Main workspace | Remaining flexible width |
| Context sidebar | 320–380 px |

These values are starting targets, not mandatory fixed dimensions.

The actual implementation must respond to available screen width.

### Additional requirements

- Navigation remains compact.
- Main content grows and shrinks correctly.
- Context sidebar supports collapsing.
- Minimum widths are respected.
- Content does not overflow horizontally.
- Layout remains usable at smaller desktop widths.

---

# 6. HIGH — Contextual Sidebar Is Overloaded

**Severity: P1 — High**

## Observed discrepancy

The right sidebar currently includes several vertically stacked sections:

- Hermes identity.
- Core persona.
- Experience.
- New Task.
- Current Work.
- Selection.

Each section is individually understandable.

Together, however, they create a long sidebar that does not establish a clear priority.

The sidebar appears to function simultaneously as:

- An agent profile.
- A task submission form.
- An execution dashboard.
- A navigation panel.
- A selection inspector.

This makes the sidebar feel like a compressed version of the previous Overview page.

## Expected behavior

The right sidebar should provide **contextual information relevant to what the user is currently viewing or doing**.

It should not permanently contain every available category of information.

## Required correction

Create a contextual panel hierarchy.

### Default Home state

Display:

**Hermes status**

Compact identity and operational status.

**Current work**

Active task and most relevant next action.

**Contextual action**

New Task or Continue Task.

### When a resident is selected

Replace the default context with:

- Resident identity.
- Current activity.
- Associated task.
- Relevant workstation.
- Available navigation actions.

### When a task is selected

Display:

- Task title.
- Status.
- Current stage.
- Required approval.
- Related execution information.

### When nothing requires attention

Show a concise idle summary.

Do not fill the sidebar with permanently expanded informational cards.

### Acceptance criteria

- The sidebar changes meaningfully with context.
- Irrelevant sections are hidden or collapsed.
- Users can understand the current focus immediately.
- The sidebar remains useful without extensive scrolling.

---

# 7. HIGH — Hermes Identity Information Occupies Too Much Space

**Severity: P1 — High**

## Observed discrepancy

The Hermes identity card consumes a large portion of the upper sidebar.

It includes:

- Hermes name.
- Resident title.
- Personality description.
- Communication style.
- Experience count.
- Identity confirmation.

This information is useful, but most of it is static.

It does not need to remain fully expanded whenever the user opens Home.

## Expected behavior

The Home sidebar should prioritize operational context.

Static identity information should be accessible without dominating the primary workflow.

## Required correction

Replace the expanded identity block with a compact profile header.

Suggested structure:

**Hermes**

Resident software researcher

**Status:** Idle / Running / Waiting

**Experience:** 5 recorded outcomes

Provide an expandable **View profile** action for personality, communication style, and identity details.

### Acceptance criteria

- Hermes remains clearly identifiable.
- Static biography text does not dominate the sidebar.
- Operational information receives higher visual priority.
- Full identity details remain accessible.

---

# 8. HIGH — Task Submission Is Disconnected From the Main Workspace

**Severity: P1 — High**

## Observed discrepancy

The New Task form appears in the right sidebar.

The central workspace shows the 3D environment.

However, there is no visible connection between creating a task and what happens next.

The form resembles an independent dashboard widget.

## Expected behavior

Task submission should be the beginning of a unified workflow.

Once submitted, the interface should provide immediate continuity.

## Required correction

After successful task submission:

1. Show the new task's authoritative state.
2. Associate it with the active execution.
3. Expose its conversation or activity stream.
4. Provide access to the corresponding Work workspace.
5. Update the contextual panel to represent the newly submitted task.

Do not create a second task state store merely for UI convenience.

Use the existing backend task records and events.

### Acceptance criteria

- Submission produces clear feedback.
- The resulting task can be followed immediately.
- The user does not need to search for the task in another section.
- Task context persists when navigating between workspaces.

---

# 9. HIGH — Chat and New Task Appear to Be Competing Entry Points

**Severity: P1 — High**

## Observed discrepancy

The interface contains:

- A global Chat button.
- A floating Chat button.
- A New Task form.
- A Send to Hermes button.

These potentially represent multiple ways to interact with the same agent.

The distinction between conversation and task execution is not clear from the screenshot.

## Expected behavior

Users should understand whether they are:

- Starting a new conversation.
- Submitting an executable task.
- Continuing an existing task.
- Inspecting current execution.

## Required correction

Define a consistent relationship between Chat and New Task.

Recommended approach:

**Chat** is the primary conversational interface.

**New Task** is a structured action for creating an executable task.

Both should be connected to the same task and conversation context when applicable.

If a conversation can initiate execution, the transition must be clearly represented.

Avoid two visually equivalent Chat entry points with different behavior.

### Acceptance criteria

- Chat and task submission have distinct, understandable purposes.
- Duplicate Chat buttons do not compete for attention.
- Existing conversations remain associated with their tasks.
- The UI does not accidentally create duplicate executions.

---

# 10. HIGH — Global Status Indicators Are Contradictory

**Severity: P1 — High**

## Observed discrepancy

The top-right header displays:

**Connection: Live**

**Execution: running**

Meanwhile, the world header displays:

**Command center · no role working**

**Nothing waiting**

The screenshot therefore simultaneously communicates that execution is running and that no role is working.

This may reflect different status sources or different underlying definitions of execution.

However, those distinctions are not explained.

## Expected behavior

The interface should communicate a coherent operational state.

Connection, execution, and role activity are distinct concepts.

They should not appear contradictory without explanation.

## Required correction

Inspect the source of each status.

Determine whether:

- The global execution indicator uses the backend agent state.
- The world uses a separate role projection.
- The two components receive updates at different times.
- One indicator is stale.
- One indicator represents a different category of execution.

Do not simply force both labels to match.

If they represent different facts, make their meanings explicit.

For example:

**Backend:** Running

**Visible role activity:** None confirmed

If they are intended to represent the same underlying state, correct the synchronization problem.

### Acceptance criteria

- Each status indicator has a defined source.
- Status labels do not create unexplained contradictions.
- Stale information is identified.
- The displayed states update consistently.

---

# 11. HIGH — The Navigation Rail Lacks Clear Workflow Context

**Severity: P1 — High**

## Observed discrepancy

The left navigation now contains:

- Home.
- Work.
- Activity.
- Results.
- System.

This is an improvement over the previous seven-tab structure.

However, the navigation itself is extremely minimal.

There is little visible explanation of how the sections relate to each other.

The application does not clearly establish where the current task lives or how the user moves between workspaces.

## Expected behavior

Navigation should organize the user's primary activities.

## Required correction

Maintain the simplified navigation while strengthening contextual behavior.

### Home

Operational overview and 3D environment.

### Work

Tasks, goals, investigations, plans, implementations, approvals, and verification.

### Activity

Live execution and chronological events.

### Results

Completed outputs, evidence, changes, and outcomes.

### System

Configuration, diagnostics, connection details, and advanced controls.

The navigation should preserve the selected task or execution context whenever the destination supports it.

### Acceptance criteria

- The active destination is clearly indicated.
- Each destination has a distinct purpose.
- Navigation does not unexpectedly discard task context.
- The user can return to the active operation without searching for it.

---

# 12. MEDIUM–HIGH — The World Header and Application Header Duplicate Information

**Severity: P2 — Medium–High**

## Observed discrepancy

The application has a global header showing connection and execution information.

Below it, the Home workspace has another status header describing command-center activity.

Both occupy separate horizontal regions.

The relationship between these status areas is not entirely clear.

## Expected behavior

The application header should report global system status.

The world header should report context specific to the world.

## Required correction

Establish clear ownership.

### Global header

- Application identity.
- Connection status.
- Overall execution status.
- Global Chat access.

### World header

- Current resident activity.
- Selected resident or department.
- Relevant task.
- Follow Activity action.

Avoid repeating the same information in multiple locations.

---

# 13. MEDIUM–HIGH — The 3D World Has Become Visually Cropped

**Severity: P2 — Medium–High**

## Observed discrepancy

Compared with the previous implementation, the 3D facility is now displayed at a different apparent scale and framing.

Parts of the facility near the upper boundary are cropped.

The command center remains visible, but some peripheral details and upper workstations are less clearly framed.

This may be intentional, but the screenshot suggests that the scene has not been recomposed specifically for the new layout.

## Expected behavior

The world should remain readable within its new container.

Important residents, workstations, and activity bubbles should be visible.

## Required correction

Recalculate the scene framing based on the new viewport dimensions.

Inspect:

- Renderer resize behavior.
- Orthographic camera bounds.
- Canvas aspect ratio.
- Parent container dimensions.
- World-space content boundaries.

Preserve the improved immersive presentation.

Do not revert to the earlier miniature-diorama framing.

### Acceptance criteria

- All seven residents remain visible.
- Resident nameplates remain readable.
- Workstations remain identifiable.
- Activity bubbles have adequate space.
- Important scene elements are not unintentionally clipped.

---

# 14. MEDIUM — No Clear Main Workspace Heading

**Severity: P2 — Medium**

## Observed discrepancy

The selected navigation destination is Home.

However, the central workspace does not have a clear page heading explaining its purpose.

Instead, it begins immediately with the command-center status strip.

The user must infer that the 3D environment is the Home workspace.

## Expected behavior

Each primary destination should have a recognizable page identity.

## Required correction

Introduce a consistent workspace heading system.

For example:

**Home — AI Operations Lab**

A concise secondary line may describe the current activity.

Other destinations should follow the same pattern.

Avoid unnecessarily large headings that reduce useful working space.

---

# 15. MEDIUM — Visual Hierarchy Remains Inconsistent

**Severity: P2 — Medium**

## Observed discrepancy

The interface uses several competing visual treatments:

- Dark outlined cards.
- Teal section headings.
- Beige application branding.
- Mint primary buttons.
- Colored status pills.
- Floating Chat controls.
- Multiple independent borders.
- Large empty surfaces.

The styles are individually compatible but do not yet establish a consistent hierarchy.

## Expected behavior

The interface should use a unified visual system.

## Required correction

Define consistent design tokens for:

- Primary backgrounds.
- Secondary surfaces.
- Borders.
- Typography.
- Primary buttons.
- Secondary buttons.
- Status indicators.
- Navigation states.
- Spacing.
- Card radii.

Use visual emphasis intentionally.

Primary actions should be immediately identifiable.

Secondary information should not compete with the current task.

---

# 16. MEDIUM — Sidebar Scrolling and Information Density Need Review

**Severity: P2 — Medium**

## Observed discrepancy

The contextual sidebar contains multiple tall sections.

The bottom of the sidebar extends beyond the visible screenshot.

The Selection section begins near the lower edge and is not fully visible.

The screenshot does not establish whether the sidebar scrolls independently, but its content arrangement creates a likely usability concern.

## Expected behavior

The sidebar should support content overflow without affecting the primary workspace.

## Required correction

Verify and refine:

- Independent sidebar scrolling.
- Sticky contextual controls where appropriate.
- Collapsible secondary content.
- Consistent section spacing.
- Proper minimum and maximum widths.
- Keyboard accessibility.
- Focus visibility.

Do not allow sidebar content to increase the entire page height unnecessarily.

---

# 17. MEDIUM — No Clear Empty State for the Main Workspace

**Severity: P2 — Medium**

## Observed discrepancy

The Home workspace contains a large empty region beneath the 3D scene.

There is no visible explanation of what should appear there.

## Expected behavior

Empty states should communicate their purpose.

## Required correction

If the area is reserved for current execution or recent work, show a meaningful empty state.

For example:

**No active task**

Hermes is ready for a new request.

Provide a clear entry point to create or resume work.

If the area is not needed, remove it rather than leaving unused layout space.

---

# 18. Required Remediation Plan

## Phase A — Layout Containment

**Priority: P0**

1. Inspect the new workspace DOM structure.
2. Verify the ownership and dimensions of the 3D canvas.
3. Correct overlapping elements.
4. Remove conflicting legacy layout constraints.
5. Ensure the canvas remains inside its designated container.
6. Verify pointer and interaction coordinates.
7. Confirm that the world HUD is fully visible.

**Exit condition:** No clipping, overlap, or unintended overflow.

---

## Phase B — Workspace Composition

**Priority: P0**

1. Correct the balance between navigation, main content, and contextual sidebar.
2. Remove unnecessary empty space.
3. Establish a deliberate Home layout.
4. Add meaningful operational content where appropriate.
5. Ensure all content fits within the available screen area.
6. Preserve the 3D environment as the Home centerpiece.

**Exit condition:** The interface uses the available screen area efficiently.

---

## Phase C — Contextual Sidebar Redesign

**Priority: P1**

1. Reduce the default Hermes profile to a compact summary.
2. Make the sidebar context-sensitive.
3. Prioritize current work and next actions.
4. Move secondary identity details behind an expandable section.
5. Support resident and task selections.
6. Verify scrolling and responsive sizing.

**Exit condition:** The sidebar responds to the user's current focus instead of displaying a permanent stack of unrelated cards.

---

## Phase D — Workflow Integration

**Priority: P1**

1. Clarify the relationship between Chat and New Task.
2. Connect task submission to the Work workspace.
3. Preserve active task context during navigation.
4. Establish clear navigation between execution and results.
5. Ensure world selections open meaningful contextual information.

**Exit condition:** Users can move naturally from task creation to execution, review, and results.

---

## Phase E — Status Synchronization

**Priority: P1**

1. Audit global connection status.
2. Audit global execution status.
3. Audit world resident states.
4. Confirm the authoritative source for each indicator.
5. Identify stale or asynchronous updates.
6. Correct inconsistent presentation.
7. Clearly distinguish backend execution from resident visualization.

**Exit condition:** Operational status is consistent and understandable throughout the application.

---

## Phase F — Visual Refinement

**Priority: P2**

1. Standardize spacing and typography.
2. Reduce unnecessary card nesting.
3. Improve navigation active states.
4. Standardize primary and secondary buttons.
5. Refine world and sidebar borders.
6. Improve empty states.
7. Verify responsive behavior.

**Exit condition:** The interface feels like one designed product rather than several components assembled together.

---

# 19. Regression Requirements

The unification work must preserve the existing functionality.

Specifically:

- The Three.js renderer remains functional.
- All seven residents remain accessible.
- Backend-driven resident states remain authoritative.
- Activity bubbles remain connected to real events.
- The existing task submission API remains unchanged.
- Existing goals and autonomous workflows remain available.
- Investigation and planning functionality is retained.
- Build and verification functionality is retained.
- Activity and evidence records remain accessible.
- Approval gates are preserved.
- Existing task execution remains operational.
- Chat functionality remains available.
- Static fallback remains functional.
- Reduced-motion behavior is preserved.
- WebSocket reconnect behavior remains intact.
- Existing task and workflow identifiers are unchanged.

Do not resolve layout problems by replacing functioning backend integrations.

---

# 20. Final Acceptance Criteria

The unified workspace redesign is acceptable only when:

### Layout

- [ ] The 3D environment remains fully contained.
- [ ] No UI elements are covered by the canvas.
- [ ] World controls remain accessible.
- [ ] The main workspace has no unexplained blank regions.
- [ ] Navigation, content, and context panels have balanced proportions.
- [ ] The layout adapts correctly to supported viewport sizes.

### Navigation

- [ ] Home, Work, Activity, Results, and System have clear responsibilities.
- [ ] Active navigation is visually obvious.
- [ ] Task context is retained across relevant destinations.
- [ ] Users can reach the current task without unnecessary navigation.

### Contextual sidebar

- [ ] Default content is concise.
- [ ] Resident selection changes the displayed context.
- [ ] Task selection changes the displayed context.
- [ ] Static profile information does not dominate.
- [ ] Sidebar scrolling works independently.

### Operations

- [ ] Connection and execution indicators have authoritative sources.
- [ ] World status is consistent with the actual backend records.
- [ ] New tasks can be followed immediately after creation.
- [ ] Chat and task submission have clear relationships.
- [ ] Activity and results remain connected to their originating tasks.

### Visual quality

- [ ] The application has consistent spacing.
- [ ] Card nesting is reduced.
- [ ] Primary actions are visually prominent.
- [ ] Empty states are meaningful.
- [ ] The 3D environment retains its established visual quality.
- [ ] The application feels like one cohesive workspace.

---

# 21. Final Assessment

The first unification pass establishes the correct general navigation direction.

The transition from seven horizontal tabs to a compact primary navigation system is an improvement.

The addition of global status indicators and a contextual sidebar also provides a foundation for a more capable application.

However, the implementation currently suffers from significant layout problems.

**The most immediate defect is the apparent failure to contain and correctly size the 3D visualization within the new workspace.**

This is followed by inefficient screen-space allocation, an overloaded sidebar, and incomplete integration between the new navigation model and existing operational components.

The next iteration should not introduce additional dashboard features.

It should first correct layout containment, establish the final workspace proportions, and make the contextual panel genuinely responsive to the user's current activity.

### Required outcome

A stable, responsive, unified AI Development Workspace where:

- Navigation is predictable.
- The 3D environment is properly contained.
- The main content area is used efficiently.
- The right sidebar displays relevant context.
- Chat and task execution are connected.
- Operational status is consistent.
- Existing backend functionality remains intact.

**The redesign is complete when Hermes Life behaves and feels like one cohesive application rather than a new navigation shell placed around the previous interface.**