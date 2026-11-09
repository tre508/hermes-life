# UI-VIS-007 — Live Agent Thought & Execution Bubbles

**Project:** Hermes Life — AI Operations Lab  
**Priority:** HIGH  
**Scope:** Three.js character visualization, real-time execution events, contextual thought bubbles, tool-call visualization, and execution history.

## 1. Feature Overview

Implement a real-time activity bubble system that displays Hermes's execution process directly above the relevant 3D resident.

When Hermes executes a task, users should be able to observe a sequence of contextual bubbles showing:

- What Hermes is currently communicating.
- What operation is being performed.
- Which tools are being called.
- What arguments or targets are relevant to those tools.
- Which specialized role is responsible for the operation.
- Whether an operation is running, completed, blocked, or failed.
- What result was returned.

The objective is to make the agent's execution workflow visually observable without requiring users to constantly switch to the Activity tab or inspect raw event logs.

**The bubbles must display actual runtime information, not invented character dialogue or fabricated reasoning.**

Any displayed reasoning must originate from explicitly available, user-visible agent output or generated execution summaries. The interface must not imply access to private internal model reasoning.

---

## 2. Visual Behavior

Each of Hermes Life's seven residents receives a contextual bubble interface.

The bubble appears above the character's head when a relevant runtime event occurs.

### Thought bubbles

Used for available planning statements, reasoning summaries, investigation descriptions, and other explanatory activity messages.

Example:

💭 Hermes  
"Analyzing the requested changes…"

### Tool-call bubbles

Used when Hermes invokes an actual tool.

Example:

⚙ Forge  
`edit_file()`  
`src/components/Dashboard.tsx`

### Execution bubbles

Used to show ongoing activity.

Example:

⚙ Patch  
"Running frontend tests…"

### Result bubbles

Used when an operation finishes.

Example:

✓ Patch  
"Tests passed: 24/24"

### Error bubbles

Used when an operation fails or becomes blocked.

Example:

! Forge  
"Build failed — TypeScript error"

These examples illustrate presentation formatting. Actual displayed contents must come from verified runtime events and records.

---

## 3. Role-Based Bubble Assignment

Bubbles should appear above the character representing the operation being performed.

| Character | Activity category | Bubble content |
|---|---|---|
| Hermes | Coordination, conversation, task execution | User-facing explanations, execution summaries, coordination activity |
| Sage | Research and investigation | Searches, document reads, research findings |
| Piper | Planning | Planning operations, plan generation, approval preparation |
| Forge | Development | File modifications, code generation, builds, Git operations |
| Patch | Testing | Test execution, verification, validation results |
| Echo | Memory | Memory extraction, archival operations, recorded learning |
| Vale | Review | Code review, candidate evaluation, approval status |

### Important mapping rule

The character receiving a bubble must be determined from the existing authoritative event-to-role mapping.

Do not infer additional autonomous agents from tool usage.

For example, if Hermes invokes a file-editing tool while executing a chat task, the existing backend may still identify Hermes as the executing coordinator.

The visualization may associate the activity with Forge's development area, but it must not falsely imply that Forge independently executed the tool.

The display should distinguish the **executing role** from the **functional category** of the operation.

---

## 4. Bubble Appearance

Bubbles should visually complement the stylized 3D laboratory.

### Design characteristics

- Rounded rectangular panels.
- Soft corners and subtle shadows.
- Semi-transparent dark or lightly tinted backgrounds.
- Thin outlines matching the resident's accent color.
- A small pointer connecting the bubble to its character.
- Clear typography.
- Small contextual icons.
- Smooth entry and exit animations.
- Consistent dimensions and spacing.

Each bubble should visually identify its associated character.

### Bubble categories

**Thought:** Rounded panel with a thought-cloud indicator.

**Tool:** Technical panel displaying the tool name and relevant parameters.

**Execution:** Activity panel with a subtle progress animation.

**Success:** Green or role-accented completion indicator.

**Failure:** Red error indicator.

**Waiting:** Amber or neutral waiting indicator.

Color must not be the only means of distinguishing bubble types.

---

## 5. Live Execution Sequence

When Hermes receives a task, the visualization should progressively display its execution activity.

### Example workflow

**User request:**

"Inspect the frontend and fix the broken navigation."

#### Step 1 — Task received

Hermes displays:

"Task received: inspect frontend navigation."

The execution state changes to active.

#### Step 2 — Investigation

An actual file-read operation occurs.

The appropriate character displays:

`read_file()`  
`frontend/src/main.ts`

#### Step 3 — Analysis

If an explanatory analysis summary is emitted:

"Checking how navigation events are handled."

This appears as a thought bubble.

#### Step 4 — Implementation

A file-edit operation begins.

The relevant character displays:

`edit_file()`  
`frontend/src/navigation.ts`

#### Step 5 — Verification

A test command begins.

Patch or the actual executing role displays:

`npm test`

#### Step 6 — Results

The runtime reports successful completion.

The corresponding bubble displays:

"Tests completed successfully."

#### Step 7 — Task complete

Hermes displays the final task status.

"Navigation task completed."

The execution bubbles disappear after their display period, and the residents return to their current authoritative states.

**All seven stages are illustrative.** The interface only displays stages for which corresponding runtime events or user-visible output actually exists.

---

## 6. Streaming Behavior

Bubbles should update while Hermes is executing tasks.

Users should not need to wait until the entire task finishes.

### Requirements

1. Subscribe to the application's existing WebSocket event stream.
2. Process available runtime events incrementally.
3. Identify the corresponding executing role.
4. Create or update that role's activity bubble.
5. Distinguish tool invocation from tool completion.
6. Replace temporary execution indicators with actual results.
7. Preserve meaningful event order.
8. Handle interruptions and failures.

### Supported event categories

The existing Hermes Life model recognizes runtime event categories including:

- `hermes.text`
- `hermes.system`
- `hermes.tool_use`
- `hermes.tool_result`
- `hermes.result`

The implementation must inspect their actual payload structures before interpreting content.

An event's existence does not guarantee that every desired field, reasoning summary, argument, or tool result is available.

Where the event lacks sufficient information, display a concise factual status rather than inventing details.

---

## 7. Bubble Positioning

Every bubble should be anchored to the corresponding character's world-space position.

### Requirements

- Follow the character when walking.
- Remain above the character's head.
- Adjust to camera projection.
- Avoid covering the character's face.
- Avoid overlapping other bubbles.
- Stay within the visualization viewport where possible.
- Reposition when the panel resizes.
- Avoid obscuring important controls.

### Recommended implementation

Use Three.js world-to-screen projection with an HTML/CSS overlay for bubble rendering.

This provides better typography, text wrapping, accessibility, and interaction than rendering large quantities of text directly into 3D textures.

The overlay should track each resident's projected head position.

For multiple simultaneous operations, bubble positioning should resolve overlapping panels or collapse lower-priority content.

---

## 8. Multiple Simultaneous Bubbles

If multiple operations are genuinely active, multiple residents may display bubbles simultaneously.

For example:

Forge:

"Building frontend…"

Patch:

"Running verification…"

Sage:

"Searching documentation…"

However, concurrency must reflect the actual execution system.

A single sequential Hermes task must not be portrayed as three independent tasks executing simultaneously.

### Display rules

- One primary expanded bubble per resident.
- Additional events are queued or summarized.
- Multiple roles may display active bubbles only when supported by actual backend activity.
- Completed operations may briefly retain a result indicator.
- Old or superseded bubbles must not remain indefinitely.

---

## 9. Expanded Bubble Details

Hovering over or clicking a bubble should reveal additional information where available.

### Tool-call details

- Tool name.
- Relevant arguments.
- Target file or resource.
- Execution status.
- Start time.
- Completion time.
- Result summary.
- Error information.

Long arguments and outputs should be truncated in the default view.

The expanded view may show more information or link to the existing Activity or Evidence tab.

### Navigation

Clicking a bubble should provide navigation to the associated execution record when a valid record identifier exists.

Do not create a duplicate task-execution interface inside the 3D world.

---

## 10. Bubble Animation

Bubble animations should communicate changes in execution state.

### Appearance

When an event arrives:

- Bubble fades in.
- Slight upward movement.
- Content becomes visible.

### Running

While a tool is executing:

- A small activity indicator remains visible.
- The bubble stays anchored to the character.

### Completed

When a result arrives:

- Running indicator stops.
- The actual result replaces or supplements the tool-call information.
- A short completion transition plays.

### Failed

When an operation fails:

- The bubble changes to an error state.
- The error summary becomes visible.
- No success animation plays.

### Dismissal

After the configured display period:

- Bubble fades out.
- The character remains in its correct backend-derived state.

### Reduced motion

When reduced motion is enabled:

- Bubbles appear without movement.
- Fade and movement animations are disabled as appropriate.
- Status information remains accessible.

---

## 11. Execution History

Temporary bubbles should not cause execution information to disappear permanently.

Maintain a bounded frontend event history for the visualization session.

Users should be able to inspect recent bubble events.

### History information

- Timestamp.
- Associated role.
- Event category.
- Tool name.
- Available content summary.
- Execution outcome.
- Associated task identifier.

The existing Activity and Evidence systems remain authoritative for durable records.

The visualization history is a presentation cache, not a replacement database.

Reloading must not reconstruct fictional execution steps from incomplete history.

---

## 12. Event-to-Bubble Architecture

Implement the feature as a dedicated presentation layer.

Recommended conceptual architecture:

```text
Hermes Life Backend
        │
        ▼
Existing WebSocket Event Stream
        │
        ▼
Runtime Event Interpretation
        │
        ├── Existing Town Model
        │       └── Character States
        │
        └── Bubble Event Adapter
                │
                ├── Role Assignment
                ├── Content Formatting
                ├── Tool Status Tracking
                ├── Event Ordering
                └── Recent Event History
                         │
                         ▼
                 Bubble Controller
                         │
                         ▼
                Screen-Space Overlay
                         │
                         ▼
               Character Head Position
```

### Architecture requirements

The bubble system must remain separate from task execution.

It must never:

- Start or stop backend operations.
- Modify execution records.
- Invent reasoning content.
- Change resident identity.
- Infer task completion from animation.
- Create additional autonomous agents.
- Duplicate the existing workflow state machine.

The existing backend remains authoritative.

---

## 13. Performance Requirements

The bubble system must remain lightweight.

### Requirements

- Reuse the existing WebSocket connection.
- Avoid additional polling solely for bubble animations.
- Limit simultaneously visible bubbles.
- Reuse DOM elements where practical.
- Avoid unnecessary layout recalculations.
- Throttle screen-position updates appropriately.
- Do not introduce additional WebGL rendering passes.
- Pause unnecessary visual updates when the tab is hidden.
- Dispose of event listeners and timers on unmount.

The feature must preserve the established facility rendering budget.

---

## 14. Acceptance Criteria

The feature is complete when:

- [ ] Each of the seven characters supports contextual activity bubbles.
- [ ] Tool calls appear when corresponding runtime events are received.
- [ ] Available user-visible reasoning summaries appear as thought bubbles.
- [ ] Tool names and relevant arguments are displayed accurately.
- [ ] Tool results update the corresponding bubble.
- [ ] Completed and failed operations are visually distinguishable.
- [ ] Bubbles follow moving characters.
- [ ] Bubble placement prevents excessive overlap.
- [ ] Bubble text remains readable at normal viewport sizes.
- [ ] Multiple active bubbles appear only when supported by actual events.
- [ ] Bubble content does not invent reasoning or execution steps.
- [ ] Historic events do not replay as new execution.
- [ ] Reconnection does not duplicate bubbles.
- [ ] Reduced-motion settings remain respected.
- [ ] Clicking a bubble can navigate to an existing record when available.
- [ ] Existing task execution and navigation remain unchanged.
- [ ] The static fallback continues presenting correct system states.
- [ ] No backend changes are required for events that already provide sufficient information.
- [ ] Performance remains within the existing rendering budget.

---

## 15. Definition of Done

The AI Operations Lab should provide a live, understandable representation of Hermes's execution workflow.

When an operation begins, the appropriate character displays a contextual bubble describing the activity.

As tool calls occur, bubbles update to show the tools being used and their actual outcomes.

When a task moves between activities, the visible explanations change accordingly.

When execution finishes, the characters return to their authoritative states and temporary bubbles disappear.

The viewer should be able to follow the available execution process simply by watching the characters and their activity bubbles.

**Final objective: Transform Hermes Life into a visually transparent AI operations environment where character actions, tool calls, and contextual explanations are synchronized with real execution events.**