# HERMESHA — Unified UI/UX, World, Work Graph & Obsidian Memory Bank

**Status:** Proposed design specification; implementation and existing Obsidian integration are **not verified**.

## 1. Product intent

Hermesha is a persistent personal assistant for life, research, and autonomous development. The app is one operational environment for talking with Hermes, observing its active processes in the World, directing tasks, managing projects from discovery through delivery, inspecting evidence, and resolving decisions.

The interface must answer, without cross-panel hunting:
1. What is Hermes working on?
2. Why, and which project or goal owns it?
3. What actually happened, with evidence?
4. What requires my decision?
5. What can I do next?

### Non-negotiable invariants
- **One conversation system**: all chats share canonical thread/message IDs. Docking or fullscreen mode only changes presentation.
- **One work graph**: projects, discoveries, goals, plans, tasks, runs, outcomes, decisions, and evidence are linked records.
- **One contextual inspector**: displays the selected item for the active view; stale unrelated selections never remain visible.
- **Truthful execution**: show public runtime events, user-visible text, tool calls/results, timestamps, and persisted outcomes only; no invented reasoning or progress.
- **Explicit authorization**: proposals, authorized actions, tested candidates, and applied changes are separate states.
- **Uninterrupted navigation**: changing view must not cancel tasks, discard drafts, or create duplicate chat sessions.

## 2. App shell and responsive layout

Desktop, >= 1440px:
- Top application bar: 56–64px; identity/workspace, global search, agent status, attention count, settings.
- Navigation rail: 210–240px expanded; 56–64px collapsed.
- Main stage: flexible width, World by default; central camera auto-fits scene while inspector/chat changes.
- Contextual inspector: 320–380px, resizable, collapsible; only appears when selected or pinned.
- Bottom status strip: 32–40px; show authoritative running count, blocked/waiting state, latest event, and direct Activity link.
- Chat: collapsed composer launcher, resizable dock (roughly 360–500px), or full-focus conversation centered at max-width 960–1080px.
- Maintain user-set widths, selection, scroll position, drafts, and layout on route changes and reload.
- Never let top configuration fields consume an entire horizontal section. Model/provider belong in session settings or compact popovers.

At 1024–1439px, inspector overlays or slides over content, World reframes. On narrow screens, navigation becomes a drawer and panels occupy one surface at a time.

## 3. Primary navigation

**Experience**: World, Conversations, Home.
**Operations**: Work, Activity.
**Intelligence**: Knowledge, Research.
**Global utilities**: Search, Attention, model/provider settings, account/authentication.

Legacy Task Board, Goals, Results, and Knowledge Deck routes can redirect to their respective new workspace with preserved selection, rather than dropping current features.

## 4. Primary surfaces and interactions

### World
- Keep the existing eight shared rooms and backend-driven residents; do not discard working world mechanics.
- Room hover: name, role, actual state. Click: contextual inspector populated from selected `room_id` and linked active work.
- Resident click: role, current operation, real events, originating thread/task, and link to Activity.
- Follow Activity is opt-in and never hijacks navigation or camera during user inspection.
- Scene fits available stage rather than being cropped after opening a panel.
- Do not derive completed-task status from an animation or room occupancy; animations subscribe to authoritative events.

### Conversations
- Canonical thread selector; each message persists with thread ID, author, timestamp, content, and artifact references.
- Chat states: minimized, docked, focus. Transitions keep active thread and unsent draft.
- Each task/action initiated from a message links back to the originating message and project; task detail does not spawn its own independent chat.
- Inline execution cards render persisted operation events; expand to reveal calls, arguments (redacted where necessary), outputs, artifacts, and result links.

### Work
- Tabs: Overview, Discoveries, Goals, Plans, Tasks, Builds, Reviews, Results; Projects is a portfolio accessible from Work overview and navigation shortcuts.
- All records expose provenance, owning project/goal, real status, next permitted action, and evidence.
- Approval UX separates `proposed`, `awaiting_approval`, `approved`, `executing`, `tested`, `applied`, `rejected`, and `failed` according to the actual domain model; never label an un-applied tested candidate 'done'.
- New autonomous projects remain clearly marked by origin and authority. Review may approve plans without automatically granting all future permissions.

### Research
- Research session with thread, sources, claims/findings, open questions, and note links.
- Each fact can be traced to a document, URL, user input, or execution result.
- Promote a finding to durable knowledge only through an explicit configured policy; preserve its evidence links.

### Knowledge / Memory
- One searchable experience merging **indexed vault notes** with linked project context; distinguish vault contents from ephemeral context, chat history, and runtime state.
- Tabs: Search, Notes, Graph, Sources, Sync/Health. Optional editor for authorized vault notes.
- Note detail displays title, path, tags, backlinks, project links, timestamps, source references, and sync status.
- The World Archive room opens the same Knowledge context, not a second memory store.

### Attention Center
- Global badge shows actual items awaiting decisions: proposed plan, candidate changes, blocked work, conflicting evidence, or permission requests.
- Each item includes `Why`, `Evidence`, `Authority needed`, and `Next action`.
- Acknowledge/approve/defer actions update the same work record used by World/Work/Activity.

## 5. Source-of-truth / data boundaries

| Data | System of record | Exposed in UI |
|---|---|---|
| Threads and messages | Canonical conversation service/database | Chat, project context, activity references |
| Projects, goals, tasks, runs, decisions | Hermes work graph/database | Work, World inspector, Attention |
| Runtime execution events | Hermes event stream + durable event store | World activity, Activity timeline, inline chat cards |
| Agent presence / room occupancy | Derived from authoritative task/event state | World |
| Long-term authored notes & research memory | Obsidian Markdown vault (if connected) | Knowledge, Research, project context |
| Search index and embeddings | Rebuildable derived index, **not** source of truth | Global Search / Knowledge |
| Attachments and evidence | File/artifact store with stable references | Work, Research, Knowledge |

**Obsidian is a knowledge store, not the authoritative scheduler, conversation database, event log, or approvals ledger.** A note may link to a task, but editing a note must not silently change task authorization.

## 6. Proposed Obsidian wiring

This section defines the integration target. Actual vault path, Obsidian plugins, existing sync API, existing memory schema, and read/write permissions must be discovered from the repository and host configuration before implementation. Do not assume an existing Obsidian REST plugin or public API.

```text
       HERMESHA UI
World / Chat / Work / Research / Knowledge / Attention
                       |
             Hermes API / BFF
                       |
        +--------------+------------------+
        |              |                  |
 Canonical Work     Conversation       Runtime Event
 Graph + Decisions  Threads/Messages   Store + Stream
        |              |                  |
        +--------------+------------------+
                       |
              Context / Retrieval
                       |
          Memory Service (stable API)
                 |           |
        Obsidian Vault    Search Index
     Markdown / assets    (derived)
                 |
         File Watcher + Writer
       (policy + conflict handling)
```

### Minimum memory service capabilities
- `GET /memory/health`: vault reachable, read/write mode, index freshness, watcher health, last indexed revision, errors.
- `GET /memory/search?q=&scope=&project_id=`: results with stable note ID, title, path, excerpt, timestamps, source type, citation anchor, and relevance.
- `GET /memory/notes/{id}`: Markdown body, frontmatter, backlinks, outgoing links, attachments, revision.
- `POST /memory/notes`: create an allowed note, with project association, origin, and source links.
- `PATCH /memory/notes/{id}`: edit by `expected_revision` or content hash, reject conflicts rather than overwrite silently.
- `POST /memory/reindex`: privileged diagnostic/scheduled action; progress is reported from actual indexer state.
- `GET /memory/graph?note_id=...`: linked note relations, projects, sources, and backlinks.

These are **proposed endpoint contracts**, not claims about existing implementation. Adapt to repo naming and current services before coding.

### Vault structure (proposed; map existing paths first)
```
HermeshaVault/
  00-Inbox/
  10-Projects/<project-slug>/
  20-Research/<investigation-slug>/
  30-Knowledge/
  40-People-and-Places/
  50-Reference/
  90-Archive/
  _assets/
```
Do **not** move or rewrite an existing vault to match this structure without explicit migration authorization. Existing folders and wikilinks take precedence.

### Suggested stable note metadata
```yaml
---
hermes_note_id: "note_01EXAMPLE"
title: "Property ownership investigation"
kind: research_finding
project_id: "project_123"
research_id: "research_456"
source_ids: ["source_abc"]
origin: hermes_research
created_at: "2026-11-23T00:00:00+01:00"
updated_at: "2026-11-23T00:00:00+01:00"
confidence: unverified
---
```
Use stable IDs independent of filename and path; allow normal Obsidian `[[wikilinks]]`, tags, Markdown attachments, and frontmatter. `confidence` must indicate evidence quality and must not be generated as an arbitrary numeric score.

### Read pipeline
1. Vault watcher detects changed Markdown/assets; scan existing notes initially.
2. Parser extracts YAML frontmatter, Markdown structure, wikilinks, tags, headings, attachments, and source references.
3. Normalize note IDs and resolve Obsidian links without assuming unique titles; retain file path and aliases.
4. Update a rebuildable full-text index and optional embeddings store with vault revision metadata.
5. Retrieval service resolves queries, filters by project/permission/scope, returns note excerpts with citation anchors.
6. Hermes uses retrieved context with source labels; Knowledge UI can open the exact original vault note.

### Write pipeline
1. Hermes proposes a durable memory write with note target, purpose, provenance, and content.
2. Authorization policy evaluates whether this category is auto-writeable, draft-only, or approval-required.
3. Memory service validates target path, permissions, vault availability, note ID, and expected revision.
4. Write through a temporary file + atomic rename where filesystem supports it; maintain original note metadata and user-authored sections.
5. Watcher/indexer observes the committed revision; UI displays `synced` only after verification.
6. Failures/conflicts surface as Attention items; never display success based solely on queued intent.

### Conflict and safety model
- Single-writer coordination or optimistic revision check for simultaneous Obsidian/Hermes edits.
- File deletion, mass rename, or bulk moves require distinct authorization.
- Never modify source notes just because an agent inference changed; corrections are appended or explicitly edited with provenance.
- Scope memory operations to the configured vault root and explicitly permitted paths; reject path traversal/symlink escapes.
- Secrets in the vault are not automatically included in prompts or search results; apply access and redaction policies.
- Log note read/write/rename/delete actions with actor, operation, note ID, timestamp, and outcome, excluding confidential content where appropriate.

## 7. Cross-surface wiring: interaction contracts

| User action or event | Routed operation | UI updates |
|---|---|---|
| Click Research Station | Resolve room -> role -> active task/goal/project | Context Inspector, relevant Activity links |
| Ask Hermesha a question | Append to canonical thread; invoke permitted agent action | Chat, optional linked task, World only if actual event occurs |
| Autonomous discovery recorded | Create discovery linked to origin/project/evidence | Work, Activity; optional World role indicator |
| Candidate awaiting review | Create decision with review artifact and authority boundary | Attention badge, Work Review, contextual inspector |
| Approve candidate | Persist decision then dispatch authorized operation | Work status, Activity events, completion evidence |
| Open Knowledge from Archive | Open Knowledge with `origin=world&room=archive` | Same Knowledge store; selected context retained |
| Save research finding to memory | Memory write pipeline, index verification | Research, Knowledge, sync status, project backlinks |
| Edit note in external Obsidian | Watcher parse + reindex + event | Knowledge search, backlinks, related project context |
| Change chat between docked and focus | Presentation state only | Same thread ID, same draft, no duplicate request |

## 8. Layout / interaction state model

```ts
// Conceptual shape, not repo-specific code
interface UIState {
  view: 'home' | 'world' | 'conversation' | 'work' | 'activity' | 'research' | 'knowledge';
  selection?: { type: 'room' | 'resident' | 'project' | 'discovery' | 'goal' | 'plan' | 'task' | 'run' | 'decision' | 'note'; id: string };
  chat: { threadId?: string; presentation: 'minimized' | 'docked' | 'focus'; draftsByThread: Record<string, string> };
  inspector: { open: boolean; pinned: boolean; width: number };
  world: { followActivity: boolean; cameraPreset?: string };
}
```
Selection must be typed and resolved per-view; a prior selected task cannot appear as the Research inspector unless explicitly linked.

## 9. Critical acceptance tests

1. Starting a task in chat creates one canonical thread/task linkage; task inspection never creates another chat history.
2. Closing chat leaves World and task execution unaffected; reopening restores thread and unsent draft.
3. World resident activity corresponds to a real event/record; idle workers do not display fabricated work.
4. Selecting a Research room updates inspector with research-context data; selecting a Dev room displays development-context data.
5. A reviewed but not applied candidate is never represented as an applied code change.
6. Each decision shows the triggering record, evidence, scope of authority, and next action.
7. Existing Obsidian note can be searched, opened, and cited without modification.
8. Obsidian edit externally updates Hermesha's index and backlink view after watcher/index verification.
9. Simultaneous Obsidian and Hermes edits produce a visible conflict rather than silent overwrites.
10. Unauthorized vault paths and secrets are not accessible through retrieval or write requests.
11. World camera reframes when inspector or docked chat opens; no canvas clipping.
12. Offline vault state appears as unavailable/stale, not falsely connected.
13. Changing projects preserves independent thread drafts and selection.
14. User-created and autonomously initiated projects appear in the same Project portfolio, differentiated by origin.
15. Global status/Attention only reflect persisted current states and decisions.

## 10. Recommended build sequence

**P0 — Inventory and contracts:** inspect current routes, shared conversation IDs, work graph, runtime event schemas, world role mappings, and actual Obsidian vault configuration. Record what exists vs what is proposed. Do not rewrite storage blindly.

**P1 — Unified shell:** responsive app chrome, compact global status, collapsible navigation, typed inspector, dock/focus chat presentation, preserved drafts.

**P2 — World-to-work interactions:** clickable residents/rooms, linked tasks/owners/evidence, camera framing, verified event mapping.

**P3 — Work and Attention:** linked entities, Review/Approval states, contextual inspector, actionable decisions.

**P4 — Obsidian adapter:** read/index/search first; then gated writes, conflict handling, external edit watcher, note graph and links to projects/research.

**P5 — Research/Knowledge workspaces:** sources, findings, note-linked evidence, backlinks, cross-navigation.

**P6 — Validation:** end-to-end real event trace from autonomous discovery -> project -> plan/task -> review -> outcome -> optionally a cited vault note.

## 11. Design boundaries

- **Not asserted:** the actual configured Obsidian vault path, vault folder structure, plugins, current implementation, existing agent memory store, or operational status.
- **Not replaced:** existing World rooms/resident mappings, functional backend workflow, runtime telemetry, or source-of-truth records.
- **Required before development:** reconcile these proposals against the current repository and existing memory integration so no duplicate state/store is introduced.
