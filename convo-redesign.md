# Hermes Life — Task Interaction & Conversation Redesign

**The main problem is that Hermes Life treats task submission, execution monitoring, conversation, and results as separate experiences, when they should be parts of one continuous interaction.**

Your latest screenshots expose a more fundamental usability issue than the earlier layout problems.

Currently, the application follows this pattern:

**Submit task → Input clears → Hermes executes → Open Results → Read answer → Interaction ends.**

What you actually need is:

**Submit task → Follow live execution → Respond when needed → Review results → Provide feedback or instructions → Continue the same task.**

That difference is significant. It changes Hermes Life from a task-submission dashboard into an interactive AI development workspace.

I would address this with a **persistent, task-linked conversation and execution interface**.

The important distinction is that this should not simply be a bigger chat box. It needs to connect conversations, execution records, approval requests, and results to the same task.

## 1. Confirmed problems in the current interface

| Problem | Current behavior | Required behavior |
|---|---|---|
| Task submission | Input clears immediately | Show submitted request in a persistent conversation |
| Execution feedback | Only a generic running indicator | Display streaming responses, tool calls, and progress |
| Hermes asks a question | No obvious way to answer within the task | Present a task-linked reply interface |
| User sends a follow-up | Treated as a new independent statement/task | Continue the existing task or explicitly create a follow-up |
| Investigation finishes | Results appear without a continuation workflow | Offer relevant next actions |
| Investigation needs approval | No clear approval interaction in the results view | Present an actionable approval request |
| Results | Primarily read-only | Allow follow-up questions, revisions, and authorized next steps |
| Work navigation | Work and Results are disconnected | Both open the same task context |
| Current-work sidebar | Displays task IDs and status | Open the active conversation and execution timeline |

Your screenshots also show that the Work area still has substantial unused space. That space could accommodate the persistent task conversation and lifecycle rather than creating another narrow panel.

---

# 2. Recommended solution: Unified Task Conversation

Every task should have a dedicated, persistent conversation that remains accessible throughout its lifecycle.

For example, suppose you submit:

> Investigate why the frontend navigation is broken.

Instead of clearing the input and returning to an empty task box, Hermes Life should immediately open the task workspace.

### Task Workspace

**Investigate frontend navigation**

`Running · Task #1efade12`

The main content area should display a chronological conversation and execution feed.

| Sender | Content |
|---|---|
| You | Investigate why the frontend navigation is broken. |
| Hermes | Task accepted. Starting investigation. |
| Tool activity | Reading `frontend/src/main.ts` |
| Tool activity | Searching for navigation handlers |
| Hermes | Investigation found a possible mismatch between route handling and navigation state. |
| Tool activity | Running verification |
| Hermes | Investigation complete. Three files are involved. |

The user should be able to see this progression without switching to Activity or Results.

**The conversation becomes the central interface for the task.**

The execution timeline becomes part of that conversation, with detailed tool calls expandable when needed.

### What happens to the current sidebar?

The right sidebar should display contextual task information:

- Current status.
- Current execution stage.
- Project.
- Relevant files.
- Pending approvals.
- Quick navigation to evidence.

It should no longer contain a separate task-submission box once a task has been selected.

---

# 3. Implement a proper task-linked reply system

This is the most important functional change.

Currently, your application has a general-purpose task submission mechanism.

That mechanism creates new work.

It does not necessarily support replying to an existing execution.

You need to distinguish **three different operations**.

| Operation | Meaning | Expected backend behavior |
|---|---|---|
| New Task | Start an independent request | Create a new task |
| Reply | Respond to a question or clarification | Continue the existing interaction |
| Follow-up | Request more work based on an earlier result | Create a linked continuation or reopen an existing task when supported |

These operations must not be implemented as identical calls to the task-creation endpoint.

## A. When Hermes asks a question

Suppose Hermes reaches a decision it cannot make without your input.

Hermes displays:

> I found two possible approaches. Should I modify the existing component or replace it?

The task should enter an explicit state such as:

**Waiting for your response**

The interface should display the question with its available options.

**Option A:** Modify the existing component.

**Option B:** Replace the component.

**Custom response:** Enter additional instructions.

When you answer, Hermes should continue from the relevant execution context.

The application must not treat your response as an unrelated task.

### Required implementation

The backend needs a way to associate the response with the outstanding question.

A conceptual API could be:

```http
POST /api/tasks/{task_id}/responses
```

Example request:

```json
{
  "request_id": "clarification-123",
  "response": "Modify the existing component."
}
```

This is a **proposed API**, not an endpoint confirmed to exist in your current backend.

The actual implementation should first inspect whether Hermes Life or its underlying Hermes execution interface already supports resumable tasks, clarification requests, or structured approvals.

If the underlying execution cannot pause and resume, adding a text box alone will not solve the problem.

---

# 4. Distinguish waiting for input from completing a task

Your current system already recognizes states such as `working`, `waiting_approval`, `completed`, and `blocked`.

However, the user interface needs a more precise distinction between different types of human intervention.

I would introduce a task-level interaction model:

| Interaction state | Meaning | User action |
|---|---|---|
| `running` | Hermes is executing | Follow execution |
| `awaiting_clarification` | Hermes needs an answer | Respond |
| `awaiting_approval` | Hermes needs authorization | Approve or reject |
| `completed` | Execution has finished | Review or request follow-up |
| `failed` | Execution failed | Inspect failure and retry |
| `cancelled` | Execution was stopped | Review or restart |

These should be derived from actual backend execution and request records.

**Do not simply change every `completed` task into a resumable task.**

A completed execution and a continuing conversation are different concepts.

A conversation may contain several executions, each with its own task ID, while remaining one coherent user interaction.

This distinction prevents misleading statuses and avoids unnecessarily modifying the existing task lifecycle.

---

# 5. Results must become actionable

Your Results screenshots demonstrate the next major problem.

Hermes provides detailed answers, supporting code, analysis, and evidence.

But the interface does not offer a clear way to act on the information.

For example, Hermes identifies a problem and recommends a fix.

The user should be able to respond:

> Apply the recommended fix.

Or:

> Before making changes, investigate whether this affects other components.

Or:

> Revise the proposal to preserve backward compatibility.

These responses should preserve the context of the investigation.

## Recommended Results redesign

At the end of an investigation, display the outcome within the task conversation.

Below it, present contextual actions.

### Example: Investigation completed

**Status:** Investigation completed

**Finding:** Navigation state is not synchronized with route changes.

**Recommendation:** Update the navigation controller.

**Available actions:**

| Action | Behavior |
|---|---|
| Discuss findings | Continue the conversation about this result |
| Create implementation plan | Start a linked planning workflow |
| Request additional investigation | Create a follow-up investigation with context |
| Open evidence | Inspect the supporting records |

For a completed implementation, the available actions would differ.

For example:

**Implementation completed**

- Review changes.
- View test results.
- Request revision.
- Submit for approval where required.

The buttons should be generated from the actual task type, lifecycle state, and available backend operations.

Do not show an **Apply Changes** button unless the corresponding authorized action exists.

---

# 6. Introduce a persistent conversation composer

The task workspace needs an input field that remains visible and changes behavior based on the current task state.

This is different from the existing New Task form.

### When no task is selected

Display:

**Start a new task**

The composer creates an independent task.

### When an active task is selected

Display:

**Send a follow-up instruction**

If the backend supports live steering, the message may be delivered to the running execution.

Otherwise, the interface must explicitly offer a linked follow-up rather than pretending to interrupt or modify the active run.

### When Hermes requests clarification

Display:

**Reply to Hermes**

The input should be associated with the specific outstanding question.

### When approval is required

Display:

**Approval required**

Provide the approved actions and an optional explanation field.

### When the execution is complete

Display:

**Ask about this result or request additional work**

A follow-up should preserve the original request, execution outcome, and relevant evidence.

If the original execution cannot be resumed, create a new linked execution under the same conversation.

### Draft preservation

The composer should also retain unsent text when navigating between Work, Activity, and Results.

Clearing the submitted text is acceptable **after** the message has been successfully recorded and appears in the conversation. It should never simply disappear without a visible record.

---

# 7. Combine conversation, execution, and results

I would change the structure of the Work workspace to something like this:

```text
┌──────────────────────────────────────────────────────────────┐
│  WORK                                                        │
│                                                              │
│  Tasks / Conversations                                       │
├──────────────┬──────────────────────────────┬────────────────┤
│              │                              │                │
│  TASK LIST   │  ACTIVE TASK                 │ TASK DETAILS   │
│              │                              │                │
│  ● Running   │  Investigate navigation      │ Status         │
│    Task A    │                              │ Running        │
│              │  YOU                         │                │
│  ✓ Complete  │  Investigate the frontend.   │ Current stage  │
│    Task B    │                              │ Investigation  │
│              │  HERMES                      │                │
│  ✓ Complete  │  Starting investigation...   │ Project        │
│    Task C    │                              │ Frontend       │
│              │  ┌────────────────────────┐  │                │
│              │  │ TOOL · read_file       │  │ Files          │
│              │  │ src/main.ts            │  │ 3 inspected    │
│              │  │ ✓ Completed            │  │                │
│              │  └────────────────────────┘  │ Evidence       │
│              │                              │ View details   │
│              │  HERMES                      │                │
│              │  Found a routing issue.      │                │
│              │                              │                │
│              ├──────────────────────────────┤                │
│              │ Reply or request more work…  │                │
│              │                       [Send] │                │
└──────────────┴──────────────────────────────┴────────────────┘
```

This gives the application a clear structure.

**Left:** What am I working on?

**Center:** What is happening, and what can I say or do?

**Right:** What is the current task's status and context?

The 3D environment remains the centerpiece of Home, where it can visualize the same execution events through characters and thought bubbles.

---

# 8. Preserve the distinction between conversation and execution history

One possible mistake would be dumping every raw runtime event into the chat.

Your earlier Activity screenshots showed hundreds of `hermes.text` events.

That would make the new conversation difficult to read.

Instead, use a layered presentation.

### Primary conversation

Show:

- User messages.
- Hermes's visible responses.
- Significant execution milestones.
- Clarification questions.
- Approval requests.
- Final outcomes.

### Collapsible tool activity

Group related tool calls.

For example:

**Investigating files — 12 operations**

Expand to see:

- `read_file` — `main.ts`
- `grep` — navigation handlers
- `read_file` — `router.ts`
- `list_directory` — components
- Additional operations.

### Detailed execution view

The existing Activity workspace remains available for complete runtime telemetry.

This approach provides visibility without overwhelming the conversation.

The same underlying events should feed the conversation, Activity timeline, and 3D activity bubbles.

---

# 9. The existing Chat interface should be integrated, not duplicated

Currently, Hermes Life has several ways to communicate with Hermes:

- New Task.
- Global Chat.
- Floating Chat.
- Results.

That fragmentation is contributing to the usability problem.

I would establish the following rules.

**New Task** starts a new conversation or execution.

**Chat** opens the persistent conversation interface. It can operate independently when no task is selected, but should show the linked conversation when opened from a task.

**Work** provides the full task lifecycle and conversation.

**Activity** displays execution telemetry.

**Results** displays completed outputs and contextual follow-up actions.

Users should not have to manually copy a task ID, previous answer, or original prompt to continue discussing the same work.

---

# 10. What must change in the backend?

This is where I would focus the technical investigation before implementing more UI.

Your previously supplied source establishes that Hermes Life already has task creation, task records, backend events, and execution-state projection.

It does **not** establish that the backend currently supports responding to an interrupted task or resuming an execution after a question.

Those are distinct capabilities.

The developer should inspect four things:

| Capability | What to determine |
|---|---|
| Conversation persistence | Are user and assistant messages associated with a durable conversation ID? |
| Task continuation | Can an existing Hermes execution accept new input without restarting? |
| Human input requests | Can Hermes explicitly pause and request a response? |
| Follow-up execution | Can a new execution inherit the context of a completed task? |

If the backend supports these operations, connect the interface to them.

If not, implement the minimum additional backend contracts needed.

A suitable conceptual relationship would be:

```text
Conversation
    │
    ├── User message
    │
    ├── Execution #1
    │     ├── Tool calls
    │     ├── Visible responses
    │     ├── Clarification request
    │     ├── User response
    │     └── Result
    │
    ├── User follow-up
    │
    └── Execution #2
          ├── Previous context
          ├── Tool calls
          └── Updated result
```

This structure allows a conversation to continue without pretending every execution can be reopened after completion.

It also provides the foundation for your previously requested **Edit & Rerun**, Pause, and task-linked chat features.

---

# 11. Recommended development priorities

| Priority | Milestone | Outcome |
|---|---|---|
| **P0** | Persistent task-linked conversation | Submitted tasks remain visible and navigable |
| **P0** | Live execution feed | Users can follow work without leaving the task |
| **P0** | Clarification and response handling | Hermes can request and receive human input when supported |
| **P0** | Context-preserving follow-ups | Users can continue discussing completed work |
| **P1** | Actionable investigation results | Findings can lead directly to planning or further investigation |
| **P1** | Approval workflow integration | Human authorization occurs in context |
| **P1** | Unified conversation composer | Input behavior adapts to the selected task |
| **P1** | Task-centered Work layout | Tasks, conversation, and details share one workspace |
| **P2** | Grouped tool activity | Live visibility without overwhelming raw logs |
| **P2** | Chat, Activity, Results, and 3D synchronization | Multiple views share one authoritative execution context |

## Final recommendation

**Stop treating a task as a one-time submission that ends when Hermes produces an answer.**

Treat it as an ongoing conversation containing one or more executions, decisions, approvals, and results.

The biggest improvement would be to make the **Work workspace the primary place to interact with Hermes**.

Home remains the visual operations center. Activity provides technical execution details. Results provides durable outputs and evidence. But Work becomes the place where users can submit requests, follow progress, answer Hermes, approve decisions, request changes, and continue an investigation.

The most important implementation requirement is this:

**Whenever Hermes asks for user input, the interface must provide a response mechanism linked to that exact request. Whenever Hermes completes work, the interface must provide a way to continue the same conversation without losing its context.**

That is the missing interaction model in the current Hermes Life interface.