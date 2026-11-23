I recommend two changes to the existing Hermes Life chat:

1. **Expand should open a true full-window chat workspace**, not simply enlarge the floating panel.
2. **The Project/Working Directory selector should become a file-context manager**, allowing Hermesha to inspect an entire project and attach selected files or folders to a conversation.

I inspected the relevant implementation in the repository. Both features can extend existing functionality without replacing the chat system.

# 1. HL-CHAT-005 — Full-Window Chat Workspace

### Current behavior

The Expand button is implemented in `frontend/src/phase412-project-ui.ts`.

It currently toggles the CSS class:

```typescript
chatPanel.classList.toggle('hc415-expanded', on);
```

That enlarges the existing floating chat.

### Desired behavior

Clicking **Expand** should transform Chat into a full-window application view occupying the entire browser viewport.

```text
┌───────────────────────────────────────────────────────────────┐
│ ✦ HERMESHA        Provider / Model     Threads     ⤡ Restore │
├───────────────────────────────────────────────────────────────┤
│ CONTEXT PANEL │                                               │
│               │                                               │
│ Project       │                                               │
│ hermes-life   │          HERMESHA CONVERSATION                 │
│               │                                               │
│ Files         │  💭 Hermesha's Thoughts                        │
│ ▾ src         │  ...                                          │
│ ▾ tests       │                                               │
│ ▾ docs        │  ✨ Hermesha's Response                        │
│               │  ...                                          │
│ Attachments   │                                               │
│ 12 files      │                                               │
│               │                                               │
├───────────────┼───────────────────────────────────────────────┤
│ Context usage │  [ + Files ]  Message Hermesha...       Send  │
└───────────────┴───────────────────────────────────────────────┘
```

**Required behavior:**

- Occupy 100% of the viewport width and height.
- Hide the underlying Command Centre while expanded.
- Preserve the active conversation and scroll position.
- Keep the composer fixed at the bottom.
- Allow the conversation area to scroll independently.
- Include a collapsible file-context sidebar.
- Restore the original floating-chat dimensions when Restore is clicked.
- Preserve expanded/collapsed preference across page reloads.

This should be implemented as a genuine full-screen workspace layout, not by continually increasing the floating panel's width.

---

# 2. HL-CHAT-006 — Working Directory & Project File Context

This is the more substantial feature.

### What already exists

Your repository contains a project-management implementation in:

- `frontend/src/phase412-project-ui.ts`
- `hermes_life/project_workspaces.py`

The current Project dropdown retrieves registered projects from `/api/projects`.

Selecting a project automatically adds a project reference to submitted messages.

The backend then supplies Hermesha with the associated synchronized worker workspace.

**However, this doesn't provide a file browser or allow users to explicitly choose which project files should enter the conversation context.**

That's what I would add.

## 2.1 Working directory selector

Replace the compact Project dropdown with a more capable workspace selector.

Example:

**Working Directory: `hermes-life`**

Clicking it opens:

```text
SELECT WORKSPACE

● General Chat
○ Hermes Life
○ Media Viewer

[ Browse registered projects ]

Current workspace:
hermes-life

Host:
/home/gayzer/Apps/hermes-life

Worker:
/home/glenn/...

[ Open File Explorer ]
```

The host and worker locations must be labeled separately because your architecture intentionally distinguishes the authoritative NUC repository from the worker's execution workspace.

## 2.2 Integrated project file explorer

When a working directory is selected, display its folder structure in a collapsible tree.

For example:

```text
📁 hermes-life
│
├── ☑ frontend
│   ├── ☑ src
│   │   ├── ☑ hermes-chat.ts
│   │   ├── ☑ hermes-chat.css
│   │   └── ☐ navigation-state.ts
│   └── ☐ tests
│
├── ☑ hermes_life
│   ├── ☑ app.py
│   └── ☑ project_workspaces.py
│
├── ☐ docs
└── ☐ README.md
```

Users should be able to select:

- One file.
- Several individual files.
- An entire folder.
- Multiple folders.
- The entire project.

Include **Select All**, **Clear Selection**, and **Add to Context** controls.

The explorer should show file sizes and context-cost estimates where available.

## 2.3 Entire-folder context

You specifically want the ability to add all files from a folder.

I would support this, but distinguish **making files available to Hermesha** from **inserting their entire contents into a model request**.

These are different operations.

### Mode A — Workspace Access

Selecting a working directory makes its files available for Hermesha to inspect using its existing tools.

Hermesha can browse, search, and read files when needed.

This should be the default for development conversations.

### Mode B — Attach Folder to Context

Selecting **Add Folder to Context** creates a persistent attachment representing every eligible file in the selected folder and its subfolders.

The attachment should include:

- Relative file paths.
- File contents or retrievable references.
- File type.
- File size.
- Modification information.
- An associated project snapshot or version.

Hermesha can then use the complete collection when answering.

For large projects, the system should build a searchable file index and retrieve relevant content rather than send every file's contents to the model simultaneously.

This allows the entire folder to be available without automatically exceeding the selected model's context window.

### Mode C — Include Complete File Contents

Users should also have an explicit option to include all selected readable file contents directly in the next request.

For example:

**Attach complete contents — 14 files / 38,200 estimated tokens**

This action must check the selected model's available context capacity.

If the files exceed the available context, the interface should report which contents cannot fit rather than silently truncating them.

---

# 3. Context attachment panel

The selected files should appear above the message composer.

Example:

```text
CONTEXT ATTACHED

📁 frontend/src/                18 files
📄 hermes_life/app.py
📄 README.md

Total: 20 files
Estimated context: 42,600 tokens

[ Manage Files ] [ Clear ]
```

The user should be able to remove individual files without changing the selected working directory.

Attachments should persist for the conversation unless removed.

Hermesha should also be able to reference the actual files used in her responses.

For example:

**Files consulted**
- `frontend/src/hermes-chat.ts`
- `hermes_life/app.py`

That record should reflect actual file reads, not merely files made available.

---

# 4. Integration with the context meter

This feature should connect directly to the model/context controls we discussed earlier.

The context meter should account for attached file contents when they're actually included in a request.

Example:

| Context source | Tokens |
|---|---:|
| Conversation history | 12,400 |
| System instructions | 3,200 |
| Attached file contents | 38,200 |
| Retrieved project knowledge | 8,100 |
| **Total** | **61,900** |

**Selected files that are only indexed or available through tools should not count as occupied context until their contents enter the model's request.**

This distinction is essential for accurate context monitoring.

---

# 5. File access and project synchronization

The existing project system uses Git-backed worker snapshots. That matters for the implementation.

The context manager should clearly distinguish:

**Host files:** The authoritative project files stored on the NUC.

**Worker files:** The synchronized version used by Hermesha for execution.

A selected folder should identify which version of its contents is being attached.

For example, a file edited on the NUC after the last synchronization may differ from the corresponding worker file.

The interface should not silently present one as the other.

It should also avoid automatically selecting virtual environments, dependency directories, Git internals, generated builds, or credentials when attaching an entire source tree.

---

# 6. Recommended implementation sequence

| Phase | Development task |
|---|---|
| 1 | Convert Expand into a genuine full-window chat workspace |
| 2 | Introduce a collapsible project/context sidebar |
| 3 | Integrate the existing registered-project selector |
| 4 | Implement a backend-backed project file explorer |
| 5 | Add file and folder selection with persistent attachments |
| 6 | Implement indexed workspace access and explicit full-content inclusion |
| 7 | Connect attachment usage to the context meter |
| 8 | Verify conversation persistence, worker synchronization, and navigation |

## Recommended final architecture

The intended result is:

**Hermesha Chat becomes a full-featured AI development workspace when expanded, while remaining a convenient floating assistant when collapsed.**

The user can select a project, browse its directory structure, attach individual files or entire folders, and converse with Hermesha using that context.

Most importantly, Hermesha should be able to understand and operate within the selected project without requiring the user to copy source code manually into every message.

**I would implement the fullscreen layout and working-directory context system together**, because the full-window sidebar provides the space needed for a practical project file explorer.