# HERMESHA — Unified UI/UX, World, Work Graph & Obsidian Memory Bank

**Type:** DESIGN & IMPLEMENTATION RECORD — absorbed into §27 of the master specification; supersedes the earlier design proposal with verified code state.

**Status:** Implementation completed through §6A (enhanced memory subsystem); P4 Obsidian adapter live; Knowledge workspace UI present. Design intent preserved where not yet implemented. Verified against repo head at time of writing.

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

**Implementation note:** The current UI (`main.v2.ts`, `hermes-chat.ts`, `knowledge-workspace.ts`, etc.) uses a tabbed workspace layout with focus/docked/minimized chat. The full app-bar/nav-rail/inspector shell described here is the design target; the current layout approximates it but does not match every dimension.

## 3. Primary navigation

**Experience**: World, Conversations, Home.
**Operations**: Work (Projects, Builds, Reviews, Goals/Initiatives), Activity.
**Intelligence**: Knowledge (Library, Vault, Memory subsystems), Research.
**Global utilities**: Search (aggregate), Attention (pending decisions), model/provider settings, account/authentication (gate + passkey).

**Implementation:** Navigation state is managed by `navigation-state.ts`. Workspace views are in `main.v2.ts` section switching. All named routes exist except Home (not yet built).

## 4. Primary surfaces and interactions

### World
- Eight shared rooms (`ship-rooms.ts`, `town-world/`) with backend-driven residents.
- Room hover: name, role, actual state from event stream. Click opens contextual inspector.
- Resident click: role, current operation, real events, originating thread/task, link to Activity.
- Follow Activity is opt-in and never hijacks navigation or camera during user inspection.
- Camera framing (`town-camera.ts`) fits available stage.
- Completed-task status comes from authoritative event state, not animation.

### Conversations
- Canonical thread selector with persistent thread/message IDs (`hermes-chat.ts`, `conv-thread.ts`, `conv-composer.ts`, `thread-groups.ts`).
- Chat states: minimized, docked, focus. Transitions keep active thread and unsent draft.
- Each task links back to originating message and project.
- Inline execution cards render persisted operation events.
- Session resume supported (`convo-redesign.md §10`).

### Work
- Tabs: Overview, Projects (`portfolio-view.ts`), Goals/Initiatives (`initiative.py`), Plans, Tasks, Builds (`build-lifecycle.ts`), Reviews (`phase415-review.ts`, `work-reviews.ts`), Results.
- All records expose provenance, owning project/goal, real status, next permitted action, and evidence.
- Approval UX separates `proposed`, `awaiting_approval`, `approved`, `executing`, `tested`, `applied`, `rejected`, `failed` according to the domain model.
- Project workspaces with filesystem browser (`phase412-project-ui.ts`, `project_workspaces.py`).
- Project knowledge (search within project scope, `project_knowledge.py`).

### Research
- Research session with thread, sources, claims/findings, open questions, and note links (`research-workspace.ts`).
- Each fact can be traced to a document, URL, user input, or execution result.
- Findings promoted to durable knowledge through extraction pipeline.

### Knowledge / Memory
**Implemented sections (all in `knowledge-workspace.ts` + `index.html`):**

| Section | Source | Data |
|---|---|---|
| Library | `/api/library/sources`, `/api/library/search` | Indexed source documents with search |
| Obsidian vault | `/api/memory/*` | Note search, detail, graph, health, reindex |
| Episodic memory | `/api/memory/episodic/*` | Significant experiences, kind-filtered |
| Relational memory | `/api/memory/relational/*` | Conversational patterns, category-filtered |
| Memory consolidation | `/api/consolidation/*` | Status, interval, manual trigger + theme results |
| Learned profile | `phase41303-memory.ts` | Active memories, pending reviews, technical lessons, correction history |

Search across vault and library is unified in the Knowledge workspace. The World Archive room opens the same Knowledge context.

### Attention Center
- Global badge (`attention-center.ts`) shows actual items awaiting decisions: proposed plans, candidate changes, blocked work, conflicting evidence, permission requests.
- Each item includes Why, Evidence, Authority needed, and Next action.
- Acknowledge/approve/defer actions update the same work record used by World/Work/Activity.

## 5. Source-of-truth / data boundaries

| Data | System of record | Exposed in UI |
|---|---|---|
| Threads and messages | `hl_conversations` / `hl_conversation_turns` tables | Chat, project context, activity references |
| Projects, goals, tasks, runs, decisions | Hermes work graph (`tasks`, `goals`, `formulated_goals`, `discoveries`, `curiosity`, `decisions` tables) | Work, World inspector, Attention |
| Runtime execution events | Event stream + `events` table | World activity, Activity timeline, inline chat cards |
| Agent presence / room occupancy | Derived from authoritative task/event state | World |
| Long-term authored notes & research memory | Obsidian Markdown vault (mounted) | Knowledge, Research, project context |
| Episodic & relational memories | `hl_episodic_memories` / `hl_relational_memories` tables + vault mirror | Knowledge (knowledge-workspace.ts) |
| Search index and embeddings | Rebuildable in-memory index (`MemoryService._index`), **not** source of truth | Knowledge vault search |
| Attachments and evidence | File/artifact store with stable references | Work, Research, Knowledge |

**Obsidian is a knowledge store, not the authoritative scheduler, conversation database, event log, or approvals ledger.** A note may link to a task, but editing a note must not silently change task authorization.

## 6. Obsidian wiring (P4 — fully implemented)

```
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

### Memory service capabilities — all implemented in `memory_service.py` + `add_memory_routes()`

| Endpoint | Method | Status | Notes |
|---|---|---|---|
| `/api/memory/health` | GET | ✅ | Vault reachable, read/write mode, index freshness, watcher health, errors |
| `/api/memory/search?q=&limit=` | GET | ✅ | Results with note_id, title, path, excerpt, kind, project_id, relevance, citation_anchor |
| `/api/memory/notes/{note_id}` | GET | ✅ | Body, frontmatter, revision (sha256), outgoing_links, backlinks, headings, kind, mtime |
| `/api/memory/notes` | POST | ✅ | Create note in folder with title, body, meta, origin. Atomic rename. Auto-indexes |
| `/api/memory/notes/{note_id}` | PATCH | ✅ | Edit by expected_revision; rejects conflicts (409). Atomic rename |
| `/api/memory/reindex` | GET | ✅ | Full rebuild of derived index. Reports note count and errors |
| `/api/memory/graph?note_id=` | GET | ✅ | Outgoing links (resolved/unresolved), backlinks, project clusters |

**Note:** The spec previously proposed `scope=` and `project_id=` query params for search. These are not currently implemented; search is global within the vault and filterable post-hoc in the UI.

### Vault mirror structure (implemented — differs from earlier proposal)

The vault mirror does **not** use the `HermeshaVault/` folder structure originally proposed. Instead, it writes to the existing vault layout:

```
<vault_root>/
  Hermes-Life/
    Memory/Auto/
      Preferences/
      Decisions/
      Projects/
      Corrections/
      Workflows/
    70-Episodic-Memory/
      Significant-Conversations/
      Shared-Experiences/
      Milestones/
      Unfinished-Discussions/
      Lessons-Learned/
    75-Relational-Memory/
      Shared-Humour/
      Conversational-History/
      Collaborative-Patterns/
      Evolving-Understanding/
      Recurring-References/
```

Mirroring is one-way (Hermes → Vault), idempotent, and never overwrites human-authored content. The `MemoryService` scans all `.md` files under the vault root for its index — it does not require a specific folder structure for reading.

### Stable note metadata — fully implemented

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

Legacy notes with `hermes_memory_id` in frontmatter are also honoured as note IDs. IDs are stable independent of filename and path.

### Read pipeline — fully implemented

1. Vault watcher detects changed Markdown/assets; scan existing notes initially (`MemoryService._watch_loop`, `reindex`).
2. Parser extracts YAML frontmatter, Markdown structure, wikilinks, tags, headings (`_parse_frontmatter`, `_WIKILINK`, `_HEADING`).
3. Normalize note IDs and resolve Obsidian links; retain file path as identity fallback.
4. Rebuildable full-text index (`MemoryService._index`, `_by_id`).
5. Retrieval resolves queries, returns note excerpts with citation anchors (`search()`).
6. Knowledge UI opens exact original vault note via `GET /api/memory/notes/{id}`.

### Write pipeline — fully implemented

1. Memory proposal evaluated on task completion by analysis adapter (`vault_memory.py::extract_completed()`).
2. Authorization: auto-write for extraction candidates, pending review for uncertain/conflicting.
3. Memory service validates target path, permissions, vault availability, note ID, revision (`create_note()`, `patch_note()`).
4. Temporary file + atomic rename (`_atomic_write`).
5. Watcher/indexer observes committed revision via poll loop.
6. Failures surface as events; extraction summary recorded per task.

### Conflict and safety model — fully implemented

- Optimistic revision check (`_sha` comparison on PATCH) — concurrent Obsidian edits that change the content hash are rejected with 409.
- Atomic rename avoids partial writes.
- Human-locked (read-only) files are detected and refused rather than bypassed.
- Path traversal and symlink escape protection in `_resolve()`.
- Secrets in the vault are not automatically included in retrieval (no vault content reaches the model directly).
- All note operations emit events with actor, operation, note ID, origin for audit trail.
- `POST /memory/notes` refuses overwriting existing files; `PATCH /memory/notes/{id}` requires matching revision.

## 6A. Enhanced memory subsystem (§6A of `hermeshaobsidianexpansion.md` — fully implemented)

The spec previously described only the base Obsidian adapter. The following memory layers have been built on top of it:

### 6A.2 Episodic & Relational memory (`extended_memory.py`)

**Episodic Memory** — records significant experiences with temporal and narrative context:
- Kinds: significant_conversation, shared_discovery, milestone, unfinished_discussion, lesson_learned, humorous_exchange, important_decision, opinion_change, personal_milestone
- API: `GET /api/memory/episodic`, `GET /api/memory/episodic/{id}`, `POST /api/memory/episodic`, `PATCH /api/memory/episodic/{id}/supersede`
- Vault mirror to `Hermes-Life/70-Episodic-Memory/`

**Relational Memory** — tracks evolving conversational dynamics with reinforcement counting:
- Categories: shared_reference, conversational_dynamic, collaborative_pattern, evolving_understanding, shared_humour, recurring_theme
- Each reinforcement increments count and expands trigger keywords
- API: `GET /api/memory/relational`, `GET /api/memory/relational/{id}`, `POST /api/memory/relational`, `PATCH /api/memory/relational/{id}/reinforce`, `PATCH /api/memory/relational/{id}/supersede`
- Vault mirror to `Hermes-Life/75-Relational-Memory/`

### 6A.5 Autonomous memory formation (`autonomous_memory.py`)

After every completed conversation turn, autonomously evaluates whether the exchange produced something worth remembering:
- Episodic formation: evaluates for significance, discovery, milestone, lesson, humour, decision
- Relational formation: detects patterns; reinforces existing entries or creates new ones
- Safeguards: skips messages <40 chars or >6000 chars, detects private content, tracks processed task IDs
- API: `GET /api/autonomous-memory/status`, `GET /api/autonomous-memory/stats`, `POST /api/autonomous-memory/extract`

### 6A.6 Memory consolidation (`consolidation.py`)

Three-pass periodic consolidation following the same threading pattern as DecisionEngine:
1. **Episodic dedup** — Jaccard similarity of keyword sets (>=55%), supersedes newer by older
2. **Relational dedup** — trigger overlap comparison (>=60%), merges into more-reinforced entry
3. **Theme detection** — keywords shared by 3+ distinct memories of same kind
- Never deletes — only supersedes with provenance pointer
- Configurable interval (default 6h)
- API: `GET /api/consolidation/status`, `PUT /api/consolidation/configure`, `POST /api/consolidation/run`

### 6A.7 Enhanced contextual retrieval (`retrieval.py`)

Six-stage pipeline replacing three independent keyword-matching calls:
1. **Entity extraction** — capitalized phrases, §6A.X refs, snake_case IDs, project terms
2. **Multi-layer candidate generation** — semantic + episodic + relational + vault simultaneously
3. **Unified scoring** — token overlap (x10), entity boost (+8), recency (+3 today → +0.5 this year), reinforcement (+3)
4. **Diversity pruning** — clusters by Jaccard overlap (>=0.4), ensures cross-layer coverage
5. **Budget management** — proportional allocation (semantic 25%, episodic 35%, relational 35%, vault 5%), default 2000 chars
6. **Unified formatting** — single `[Contextual memory]` block with layer labels
- Fallback to legacy separate-layer retrieval on pipeline failure
- Integrated into `PersonalityAdapter.run()` in `personality.py`
- API: `GET /api/retrieval/status`, `POST /api/retrieval/search`, `POST /api/retrieval/entities`

### Personality integration (`personality.py`)

`compose_prompt()` assembles 10 layers in documented order:
1. Reference library excerpts
2. Core identity (fixed persona)
3. Learned behavioral profile
4. Recalled task memory
5. Contextual memory (from retrieval pipeline — replaces separate episodic + relational blocks)
6. (Legacy fallback) Episodic memory
7. (Legacy fallback) Relational memory
8. Technical lessons
9. Past reflections
10. Task prompt + learning report protocol

The retrieval pipeline is attempted first; on failure it falls through to the separate-layer calls.

## 7. Cross-surface wiring: interaction contracts

| User action or event | Routed operation | UI updates |
|---|---|---|
| Click Research Station | Resolve room → role → active task/goal/project | Context Inspector, relevant Activity links |
| Ask Hermes a question | Append to canonical thread; invoke permitted agent action | Chat, optional linked task, World only if actual event occurs |
| Autonomous discovery recorded | Create discovery linked to origin/project/evidence | Work, Activity; optional World role indicator |
| Candidate awaiting review | Create decision with review artifact and authority boundary | Attention badge, Work Review, contextual inspector |
| Approve candidate | Persist decision then dispatch authorized operation | Work status, Activity events, completion evidence |
| Open Knowledge from Archive | Open Knowledge with `origin=world&room=archive` | Same Knowledge store; selected context retained |
| Save research finding to memory | Extraction pipeline (model proposes → validated → stored) | Knowledge vault, sync status, project backlinks |
| Edit note in external Obsidian | Watcher parse + reindex + event | Knowledge search, backlinks, related project context |
| Change chat between docked and focus | Presentation state only | Same thread ID, same draft, no duplicate request |
| View episodic/relational memories | Load from `GET /api/memory/episodic` / `/api/memory/relational` | Knowledge workspace memory sections |
| Run consolidation | POST `/api/consolidation/run` | Consolidation status detail with theme observations |
| Autonomous memory formation | Runs automatically after task completion | Episodic/relational lists update on next load |

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

**Note:** Tests 1-15 are acceptance criteria. Tests 8, 9, 12, 13, 15 are design targets not yet end-to-end verified against the current UI.

## 10. Build sequence — implementation status

### P0 — Inventory and contracts ✅ (completed)
Inspect current routes, shared conversation IDs, work graph, runtime event schemas, world role mappings, and actual Obsidian vault configuration. Record what exists vs what is proposed.

### P1 — Unified shell ⬜ (design target, partially implemented)
Responsive app chrome exists with tabbed workspace layout. The full app-bar, collapsible nav rail, contextual inspector, and bottom status strip from §2 are design targets.

### P2 — World-to-work interactions ✅ (completed)
Clickable residents/rooms, linked tasks/owners/evidence, camera framing, verified event mapping. World state sync, room-based residents, activity bubbles, labels, camera controls all implemented.

### P3 — Work and Attention ✅ (completed)
Linked entities (goals, discoveries, formulations, tasks, implementations, verifications), review/approval states, contextual inspector, actionable decisions. Project workspaces, approvals, build lifecycle, code review.

### P4 — Obsidian adapter ✅ (completed)
Read/index/search first (`MemoryService`), gated writes (POST/PATCH with revision checks), conflict handling, external edit watcher, note graph and links to projects/research. See §6 for full endpoint inventory.

### P5 — Enhanced memory subsystem ✅ (completed)
Episodic memory, relational memory, autonomous formation, memory consolidation, enhanced contextual retrieval. All integrated into the personality prompt. UI sections in Knowledge workspace. See §6A for full detail.

### P6 — Research/Knowledge workspaces ✅ (completed)
Sources, findings, note-linked evidence, backlinks, cross-navigation. Research workspace, Knowledge workspace with library, vault, and memory sections. Cross-surface handoff via `hermes:open-note` event.

### P7 — End-to-end validation ⬜ (ongoing)
Real event trace from autonomous discovery → project → plan/task → review → outcome → optionally a cited vault note. Individual paths work; full end-to-end automated validation is ongoing.

## 11. Design boundaries

- **Not changed by the implementation:** World rooms/resident mappings, functional backend workflow, runtime telemetry, source-of-truth records.
- **The vault structure is not restructured by the implementation:** The MemoryService reads any `.md` tree; the mirror writes to `Hermes-Life/` but does not move existing notes.
- **Not replaced:** The legacy memory extraction pipeline (`vault_memory.py`) still runs alongside autonomous formation (`autonomous_memory.py`).
- **Consolidation never deletes data:** It supersedes, merges, or archives with provenance — you can always trace what happened.
- **The retrieval pipeline has a legacy fallback:** If the pipeline fails (e.g., schema not yet migrated), separate episodic + relational keyword matching still runs.