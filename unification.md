# Hermes Life — UI/UX Review and Redesign Direction

**The main problem isn't the visual styling. It's the information architecture.**

the interface looks like two separate applications placed next to each other:

1. **Left:** A 3D simulation showing Hermes and the seven operational roles.
2. **Right:** A traditional administrative dashboard containing tasks, planning, development, approvals, execution logs, and system information.

Both sections are individually understandable, but **they don't work together as one cohesive experience**.

The biggest issue is that the 3D environment occupies approximately 70% of the available width, while almost all practical functionality is squeezed into the remaining 30%.

That arrangement makes the most visually interesting part of Hermes Life the least interactive, while the part containing the actual work becomes cramped and difficult to navigate.

redesign the application around a unified workspace rather than continuing to refine the existing tab system.

---

## 1. What specifically feels disjointed?

### Problem 1 — The 3D world dominates every screen

**Severity: Critical**

Across all eight screenshots, the 3D facility remains almost identical.

Whether you're reviewing execution output, planning a task, inspecting a build, or reading memories, the facility continues occupying most of the screen.

This creates an awkward relationship.

For example, when you open **Evidence**, you're trying to read and inspect detailed execution results. Yet the actual answer is confined to a narrow column while a large, mostly static 3D environment occupies the majority of the display.

The same thing happens in Activity, where hundreds of execution events are compressed into a thin scrolling list.

**The 3D environment should not consume the same amount of space regardless of what you're doing.**

### Recommended solution

Introduce three workspace layouts:

| Layout | Purpose | 3D world | Content area |
|---|---|---|---|
| World | Observe Hermes and the facility | Large | Compact contextual panel |
| Workspace | Planning, development, goals | Approximately 35% | Approximately 65% |
| Focus | Reading output, reviewing evidence, inspecting logs | Minimized or hidden | Nearly full width |

The layout should respond to the user's activity.

For example, opening Evidence could automatically enter Focus mode while retaining a small, expandable facility preview.

Users should also be able to change the layout manually.

This single change would make a substantial difference.

---

## 2. Problem 2 — Seven tabs represent backend architecture rather than user workflows

**Severity: Critical**

Your current navigation is:

`Overview | Goals | Discover | Planning | Build | Activity | Evidence`

These categories make sense from a technical perspective.

However, they force users to understand how Hermes Life's internal systems are divided.

Consider a common workflow:

You ask Hermes to investigate a problem, create a solution, implement the changes, and test the result.

To follow that operation, you may need to visit:

- Discover to find the investigation.
- Planning to review the proposed approach.
- Build to inspect the implementation.
- Activity to examine execution events.
- Evidence to read the outcome.

**That's five different tabs for one logical task.**

The application separates information according to which subsystem produced it instead of which task it belongs to.

### Recommended solution

Replace the seven primary tabs with four main workspaces.

| Proposed navigation | Consolidates | Purpose |
|---|---|---|
| **Home** | Overview | Hermes overview, system health, recent work, approvals |
| **Work** | Goals, Discover, Planning, Build | Manage tasks from investigation through implementation |
| **Activity** | Activity, execution telemetry | Watch live execution, tools, events, and history |
| **Results** | Evidence, completed work | Review outputs, changes, tests, and evidence |

The original functionality does not disappear.

It becomes organized around what the user is trying to accomplish.

For example, **Work** would contain an individual task with its investigation, plan, implementation, and verification stages.

Instead of switching between several primary tabs, you would open the task and navigate its lifecycle within one workspace.

---

## 3. Problem 3 — There is no central concept of a task

**Severity: Critical**

This is arguably the biggest architectural UX issue.

Hermes Life has tasks, autonomous goals, investigations, plans, implementation runs, tests, and results.

But the interface does not present them as a coherent unit of work.

The user sees individual systems, not the overall operation.

### Recommended solution: Task Workspace

Every task should have its own unified workspace.

For example:

**Task: Investigate and fix frontend navigation**

| Section | Information |
|---|---|
| Overview | Objective, current status, project, elapsed time |
| Investigation | Findings and relevant source files |
| Plan | Proposed approach, decisions, approval |
| Implementation | Files changed, tool operations, code changes |
| Verification | Tests, failures, fixes, results |
| Outcome | Final response and supporting evidence |

Display the lifecycle as a progress indicator:

**Investigate → Plan → Build → Test → Review → Complete**

Each stage should have a clear state:

- Not started
- In progress
- Waiting for approval
- Completed
- Failed
- Blocked

This provides one place to follow an operation from beginning to end.

Importantly, the stages should reflect the actual workflow. A task that only answers a question should not be forced through coding stages that never occurred.

---

# 4. Problem 4 — The interface uses too many nested containers

**Severity: High**

The current dashboard relies extensively on:

- Large bordered panels.
- Smaller panels within those panels.
- Collapsible sections.
- Cards within collapsible sections.
- Secondary bordered information boxes.
- Multiple rows of buttons.

For example, the Build tab contains an outer section, an evaluated-implementation container, another candidate-evaluations panel, a refresh button, status text, and additional controls.

Each additional boundary makes the information feel further removed.

The result is a dashboard where nearly everything looks equally important.

### Recommended solution

Use a flatter visual hierarchy.

A typical content view should contain:

**Page heading → Status summary → Primary content → Contextual actions**

Use cards for meaningful information groups, not every individual text block.

Reduce unnecessary borders and backgrounds.

Create hierarchy primarily through spacing, typography, and grouping.

This would make the existing dark visual style feel substantially more refined without requiring a complete color redesign.

---

# 5. Problem 5 — Important actions are difficult to find

**Severity: High**

Look at the Goals screen.

The primary action, creating a goal, is inside a collapsed section.

The page prominently shows several status counters and filters, but the action that starts the workflow is comparatively hidden.

Similarly:

- Planning places manual controls behind another expandable section.
- Build emphasizes refresh controls.
- Discover has several buttons competing for attention.
- Overview places task submission far below other information.

There isn't a consistent relationship between the user's current page and the action they're most likely to take.

### Recommended solution

Each main workspace should have one clear primary action.

| Workspace | Primary action |
|---|---|
| Home | New task |
| Work | Create task or goal |
| Activity | Follow current execution |
| Results | Open latest result |

Secondary controls should remain available but have less visual prominence.

**Refresh should not be the most prominent action on pages whose primary purpose is creating or executing work.**

---

# 6. Problem 6 — Activity and Evidence should be connected

**Severity: High**

Your Activity screenshot shows a long sequence of entries such as:

`#775 hermes.text`  
`#774 hermes.text`  
`#773 hermes.text`

These entries expose technical event names without providing enough immediate context.

The Evidence screen, meanwhile, shows the actual agent answer and related execution information.

These are effectively two views of the same execution.

However, the user must navigate between them manually.

### Recommended solution

Create a unified execution viewer with two complementary modes.

**Live Activity**

Displays a chronological timeline:

| Time | Event | Status |
|---|---|---|
| 15:23:41 | Hermes started the task | Running |
| 15:23:43 | Read `main.ts` | Completed |
| 15:23:47 | Inspected navigation handling | Completed |
| 15:24:02 | Edited `navigation.ts` | Completed |
| 15:24:10 | Executed tests | Completed |

**Result**

Shows:

- Final response.
- Files changed.
- Test results.
- Relevant tool output.
- Supporting evidence.

Users should be able to switch between execution details and the resulting answer without losing their place.

Raw event names such as `hermes.text` can remain available in an expandable technical view.

This is especially relevant to your planned **thought-bubble feature**.

The bubbles and Activity timeline should be two visual representations of the same execution stream, not separate implementations.

---

# 7. Problem 7 — System status is fragmented and sometimes contradictory

**Severity: High**

Your screenshots show several status messages simultaneously:

At the top:

**Reconnecting**

In the facility status:

**Command center · no role working**

Under the scene:

**Reconnecting since 3:42:26 PM**

In the Goals, Build, Planning, and Discover screens:

**NetworkError when attempting to fetch resource**

Yet Evidence still displays a previously completed task.

None of these messages is necessarily incorrect individually.

However, together they make it difficult to distinguish:

- Is Hermes currently executing?
- Is the backend accessible?
- Is the displayed information current?
- Did the last task complete?
- Is this page showing cached data?

### Recommended solution

Create one global connection and execution status system.

The application header should distinguish:

**Connection:** Connected / Reconnecting / Offline

**Execution:** Idle / Running / Waiting / Failed

**Data freshness:** Live / Last updated [time]

These are three different concepts.

For example:

**Offline · Last known execution: Completed · Updated 15:39**

Individual workspaces can show contextual error messages when necessary, but they should not each independently dominate the interface with repetitive connection warnings.

Also, the screenshots suggest a real connectivity problem. The UX redesign will make it clearer, but it will not resolve the underlying network failure.

---

# 8. Problem 8 — The chat feature feels detached from the rest of the application

**Severity: High**

The chat button is positioned in the bottom-right corner.

Visually, it resembles a generic support-chat widget.

But Hermes is the central intelligence and primary interaction mechanism of the entire application.

That is an important mismatch.

###  solution

Make Hermes conversation a first-class interaction surface.

I would retain the floating button for convenience but expand it into a proper conversation panel.

The panel should support:

- Conversational task submission.
- Live streaming responses.
- Tool execution information.
- Task progress.
- Pause and cancellation.
- Edit and rerun.
- Links to the current task workspace.
- Associated files and outputs.

When Hermes is working, the conversation should stay connected to the relevant task.

Users should be able to move from a conversation into its full workspace without losing context.

A question should not require opening an entirely separate page just to inspect what Hermes did.

---

# 9. Proposed overall layout

 use a **three-region workspace architecture**.

### Region A — Primary navigation

A narrow, persistent navigation rail on the left.

It contains:

**Home, Work, Activity, Results**

Below these would be access to projects and settings.

The current horizontal seven-tab navigation disappears.

### Region B — Main workspace

This is where the primary content appears.

Depending on the selected workspace, it displays:

- The 3D AI Operations Lab.
- A task workspace.
- Execution activity.
- Final results.

This region receives most of the available width.

### Region C — Contextual panel

A collapsible side panel containing information related to the current selection.

For example:

**When viewing the world:** Selected resident, current activity, and associated task.

**When viewing a task:** Hermes conversation, task status, and next actions.

**When viewing results:** Relevant files, evidence, and execution metadata.

This creates a consistent application structure.

The content changes, but the user no longer feels like they're navigating between unrelated interfaces.

---

# 10. What should happen to the 3D facility?

**Keep it. But change its role in the interface.**

Right now, the facility is the application's permanent centerpiece.

I think it should become the **Home workspace centerpiece** instead.

That gives the world a clear purpose: monitoring Hermes Life's operational activity.

When the user needs to work, the world should become secondary.

For example:

| User action | Interface behavior |
|---|---|
| Opens Home | Large 3D facility appears |
| Clicks Forge | Forge's details open in the contextual panel |
| Selects an active task | Opens the unified task workspace |
| Opens Activity | Full-width execution timeline |
| Opens Results | Full-width response and evidence viewer |
| Opens Chat | Contextual conversation panel |
| Returns Home | Large facility restored |

You could additionally offer a compact facility preview in the contextual panel.

This would preserve the visual identity of Hermes Life without forcing users to sacrifice reading and working space.

---

# 11.  Home screen

The current Overview page contains useful information, but its contents are fragmented across a long vertical column.

I would reorganize Home into three clear levels.

### Top: Operational status

A concise summary showing:

**Hermes: Idle | Connection: Live | Pending approvals: 0 | Active tasks: 0**

This replaces scattered status indicators.

### Center: AI Operations Lab

The 3D world occupies the main section.

Characters remain interactive, with nameplates and live activity bubbles.

### Bottom or contextual side panel: Current work

A compact section showing:

**Current task:** None

**Recent task:** Frontend navigation investigation

**Last outcome:** Completed

**Requires attention:** None

A prominent **New Task** button provides an obvious starting point.

The complete memory system, technical lessons, and correction history should remain accessible, but they do not all need to occupy the Home screen.

---

# 12. redesign priorities

| Priority | Change | Expected improvement |
|---|---|---|
| **P0** | Replace seven primary tabs with four workflow-oriented sections | Simplifies navigation |
| **P0** | Introduce a unified task workspace | Connects investigation, planning, development, and results |
| **P0** | Stop permanently displaying the large 3D world on every page | Gives functional content appropriate space |
| **P1** | Consolidate Activity and Evidence around individual executions | Makes execution easier to follow |
| **P1** | Make Chat a first-class contextual panel | Connects conversation with task execution |
| **P1** | Unify connection, execution, and data freshness indicators | Reduces ambiguity |
| **P2** | Simplify cards, borders, and nested panels | Improves visual hierarchy |
| **P2** | Standardize primary actions and secondary controls | Improves usability |

## The design direction I recommend

**A modern AI development workspace with an interactive 3D operations center—not a 3D operations center with a small administrative dashboard attached.**

That distinction matters.

Hermes Life is ultimately an autonomous development and execution platform. The 3D facility makes its activity interesting and understandable, but the user still needs to assign work, monitor execution, review decisions, and inspect results efficiently.

The design should support that workflow first.

### One decision I would make differently from your current design

I would not make all seven existing tabs disappear into four giant pages without preserving their underlying structure.

Instead, I would keep **Discover, Planning, Build, and Review as stages within individual task workspaces**.

That allows you to preserve their functionality while removing the feeling of jumping between disconnected administrative modules.

For example, clicking an investigation in Work opens the investigation's complete lifecycle. A user can move directly from its findings to its proposed plan, implementation, tests, and final result.

This is the change that will make Hermes Life feel like one cohesive application rather than several related tools sharing the same screen.

**My recommendation is to prioritize the navigation architecture and unified task workflow before making further cosmetic changes.** The existing dark theme, typography, and color palette are already a workable foundation. The disjointed feeling comes primarily from how the functionality is divided and presented—not from the colors or the 3D artwork.