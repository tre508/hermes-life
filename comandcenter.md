**the Task Board combines several independent workflows without clearly connecting them to the selected task, project, or overall development lifecycle.**

However, the problem differs slightly between Discover, Build, and Projects.

## 1. What's wrong with each tab

### Build — Missing workflow context
example
The Build tab currently displays a completed implementation for `hl-demo-worker`, while the right sidebar still shows the unrelated failed task:

> What default model are you using?

This creates two problems:

- **The selection panel is disconnected from the Build workspace.** It continues showing a previously selected task instead of the implementation being inspected.
- **The Build interface does not clearly explain what happens next.** It displays a completed, verified run with a “Review candidate changes” button, but the relationship between implementation, review, acceptance, and applying changes is not immediately apparent.

The Build tab should function as an implementation-management workspace, not simply a collection of evaluation records.

### Projects — An incomplete portfolio

The Projects tab currently contains:

- Proposals awaiting decision
- Ranked opportunities
- Recent outcome records

All three sections are empty.

More importantly, **it doesn't display the actual registered projects**.

That's a significant mismatch with your goal for Hermes Life.

Projects should be the central place to manage both user-created and autonomously initiated projects, including existing repositories and new projects Hermes creates.

The current interface resembles an autonomous-opportunity dashboard rather than a project-management workspace.

### Discover — Too much presentation, too little useful information

The Discover tab displays:

- Six summary counters.
- Seven filter buttons.
- Three operational buttons.
- Two mostly empty result sections.
- An additional technical-details section.

There are only two findings, yet the interface dedicates most of the screen to navigation, counts, and empty containers.

The distinction between **Needs attention**, **Unseen**, **Planning**, **History**, and **Questions** is also not particularly clear from the interface.

The functionality may be present, but the presentation makes it difficult to understand what Hermes has discovered and what should happen next.

---

# 2. Recommended solution: Redesign the Task Board as a unified Work Management system

Rather than independently redesigning each tab, I recommend establishing one consistent architecture.

**HL-WORK-001 — Unified Work Management & Contextual Workspace Architecture**

The main principle should be:

> Every workspace displays records belonging to its own domain, while using a shared system for selection, navigation, status, and contextual actions.

That means the right sidebar should not always display the last selected task.

Instead, it should reflect the currently selected object.

| Active workspace | Main content | Right sidebar |
|---|---|---|
| Tasks | Task queue and execution history | Selected task |
| Discover | Opportunities and findings | Selected discovery |
| Goals | Active objectives and dependencies | Selected goal |
| Planning | Investigations and implementation plans | Selected plan |
| Build | Implementation runs and reviews | Selected implementation |
| Projects | Registered and autonomous projects | Selected project |

If nothing is selected, the sidebar should display a useful workspace summary or remain collapsed.

**Selection should be contextual, not global.**

A selected task may remain remembered when navigating between tabs, but it should not automatically occupy the sidebar of every unrelated workspace.

---

# 3. How I would redesign the three tabs

## Discover — Opportunity Intelligence

Replace the existing dashboard-heavy layout with a discovery workflow.

**Header**

**Discover**  
*Identify opportunities, investigate findings, and turn evidence into actionable work.*

**Summary strip**

`2 Findings` · `1 Unreviewed` · `1 In Planning` · `0 Needs Attention`

**Primary content**

Display actual discoveries as readable cards.

Each card should show its title, source project, evidence, discovery date, status, and recommended next action.

For example:

**Finding: Potential test coverage gap**

Project: Hermes Life  
Status: Unreviewed  
Source: Repository scan  
Evidence: Relevant source files and identified test coverage

Actions: `Investigate` · `View evidence` · `Dismiss`

Once investigated, the discovery should link directly to the resulting goal or plan instead of remaining an isolated record.

**Remove redundant counters and empty sections.** Keep advanced scanner settings and technical diagnostics in a collapsible section.

## Build — Development & Verification

Build should be organized around actual implementation runs.

**Header**

**Build**  
*Track implementations, tests, revisions, and candidate reviews.*

**Summary strip**

`Active Builds` · `Awaiting Review` · `Failed` · `Completed`

**Main content**

Each implementation should show:

- Project and linked plan.
- Current development stage.
- Last actual operation.
- Test and evaluation outcome.
- Files changed.
- Review status.
- Next available action.

Selecting an implementation should open its details in the right sidebar.

The detail view should show the lifecycle:

**Prepare → Baseline → Implement → Test → Evaluate → Review → Apply**

Each completed stage must be backed by actual execution records.

The current `hl-demo-worker` entry would remain accessible, but it would be presented as a completed implementation with a clear review and application status.

## Projects — Project Portfolio

This needs the largest conceptual change.

The Projects tab should become the central portfolio for all projects Hermes knows about.

**Header**

**Projects**  
*Manage existing repositories, autonomous initiatives, and long-term development.*

**Primary content**

Use three distinct sections:

**Registered Projects**

All projects registered with Hermes Life, regardless of whether they have autonomous activity.

Each project should show its repository, workspace, current state, active goals, recent work, and next action.

**Autonomous Initiatives**

Projects Hermes has independently proposed or started.

These should show their origin, justification, approval status, milestones, progress, and blockers.

**Opportunities & Proposals**

Ranked opportunities that have not yet become projects.

This is where your current “Proposals awaiting decision” and “Ranked opportunities” sections belong.

They should not replace the registered-project portfolio.

---

# 4. Fix navigation between workflows

The most important architectural improvement is connecting related records.

For example, when Hermes discovers an opportunity:

```text
DISCOVER
  Finding identified
       ↓
GOALS
  Investigation goal created
       ↓
PLANNING
  Evidence-backed plan generated
       ↓
BUILD
  Candidate implemented and tested
       ↓
PROJECTS
  Project progress updated
       ↓
RESULTS
  Outcome and lessons recorded
```

These should be linked views of the same development workflow.

A user should be able to open a project, see its active goals, inspect a related plan, examine its implementation, and return to the project without losing context.

For autonomous development, this becomes particularly important because Hermes may have multiple projects progressing independently.

---

# 5. Fix the right sidebar across the entire application

Your screenshots demonstrate that the current Selection sidebar is effectively a persistent task inspector.

That is inappropriate for a multi-domain workspace.

I recommend introducing a **Context Inspector**.

Its content changes according to the active workspace and selected record.

For example, selecting an implementation in Build would display:

**Implementation: hl-demo-worker**

Status: Completed  
Verification: Verified  
Latest revision: Passed  
Project: Linked project  
Plan: Linked plan

**Available actions**

`View test results` · `Review candidate` · `Open project`

Selecting a discovery would instead display its source, confidence, evidence, and investigation options.

This would make the right sidebar operationally useful rather than a repeated display of unrelated task information.

---

## 6. Development requirement

I would add the following to your master development specification:

**HL-WORK-001 — Unified Work Management & Contextual Workspace Architecture**

Its implementation should cover:

1. **Shared selection model:** Establish typed selection for tasks, discoveries, goals, plans, implementations, and projects.
2. **Context-aware inspector:** Render details and actions appropriate to the selected record.
3. **Workspace-specific presentation:** Redesign Tasks, Discover, Goals, Planning, Build, and Projects around their actual responsibilities.
4. **Cross-workflow navigation:** Preserve links between discoveries, goals, plans, implementation runs, and projects.
5. **Unified status representation:** Use backend-authoritative states, timestamps, and outcomes.
6. **Useful empty states:** Explain why no records exist and provide an appropriate action.
7. **Project portfolio integration:** Show registered projects alongside autonomous initiatives and proposals.
8. **Conversation integration:** Use the existing Hermes Chat interface for discussion rather than duplicating conversation systems inside operational tabs.
9. **Persistent navigation:** Preserve relevant selection, filters, and workspace state across navigation and refresh.
10. **Responsive layout:** Allow the inspector to collapse or expand without wasting the central workspace.

### Implementation order

I would implement **HL-CONV-001 first**, followed by **HL-WORK-001**.

The conversation architecture needs to be unified before redesigning the Task Board's navigation and contextual inspector.

Then the workspaces can be redesigned incrementally without introducing another set of conflicting state-management systems.

**The intended result is one coherent Hermes Life application, not six separate dashboards sharing a navigation bar.**