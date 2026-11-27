# Hermesha — Current Implementation Audit

Consolidated audit of the Hermesha implementation against `hermesha-unified-ui-spec.md`. This document supersedes the previous `review.md` (2026-11-27 earlier revision, 18 findings D1–D18); every previous finding is revalidated in §4 and the historical record is retained in §16. All claims are labeled with their verification method. Application code was not modified.

## 1. Audit Metadata

- **Audit date:** 2026-11-27 (CET), completed ~22:30.
- **Git branch/commit:** `main` @ `463e396` (ahead of `origin/main` by 1 commit).
- **Working-tree status:** heavily dirty — 74 changed entries (staged + unstaged), untracked build specs, deleted docs/screenshots staged for removal. `review.md` and `hermesha-unified-ui-spec.md` are untracked. Notable uncommitted source deltas: `hermes_life/app.py`, `hermes_life/project_workspaces.py`, `hermes_life/schema.py`, `frontend/src/hermes-chat.ts`, `frontend/src/phase412-project-ui.ts`, `frontend/src/chat-attach.ts` (new).
- **Specification reviewed:** `hermesha-unified-ui-spec.md` (255 lines; self-described "Consolidated UI/UX design proposal — subordinate to the master specification"). Cross-references to `hermesha-life-master-dev-spec.md` (HL-SOT-002) where the unified spec defers (memory §13, autonomy §17, DB §19).
- **Sources inspected:** the spec; previous `review.md`; build specs `d1-d5-build-spec.md`, `d6-build-spec.md`, `d7-d13-build-spec.md`; screenshots `chatscreenshot.png`, `projectscreenshot.png`, `word-home screenshot.png` (captured at `dev.hermeshaplease.com`, 2026-11-27 21:26–21:27); frontend (36 test files, ~50 TS modules); backend `hermes_life/` (~50 modules); live SQLite `~/.local/share/hermes-life/life.db`; live services on 127.0.0.1:8766 (uvicorn) and 127.0.0.1:5173 (vite); `/openapi.json`; git history.
- **Verification environment:** this machine **is** the application host: `cloudflared` (since 05:11) tunnels `dev.hermeshaplease.com` → local vite dev server (which proxies `/api`,`/ws` → 127.0.0.1:8766). Local runtime probes are therefore application-host verification, not workstation-only checks. Frontend tests: host node 22.22.1 + tsx. Backend tests: project `.venv`, ambient `HERMES_LIFE_*` vars stripped.
- **Audit limitations:** see §18. Most importantly: the entrance gate (401) blocks authenticated runtime clicking, so end-to-end behavior was verified by source tracing, contract tests, headless module probes and unauthenticated runtime probes only; and the running backend predates the current source (HA-004), so several features cannot be exercised at runtime at all right now.

## 2. Executive Summary

**Current implementation state.** The architecture is genuinely spec-shaped: one WebSocket event stream with watermark replay, one canonical conversation store (SQLite + read-only Obsidian mirror), one work graph, a presentation-only World/bubble layer driven by real runtime events, and a real hosted-filesystem IDE with containment-checked endpoints and an mtime conflict guard. The frontend test suite is fully green (400 pass / 0 fail, verified twice) and `npm run build` passes. Most of the previous audit's 18 findings were genuinely acted on: 8 fully resolved, 9 partial, 1 mislabeled.

**Most significant confirmed problems.**

1. **A live authentication bypass (HA-001, P0).** The entrance-gate password hash for the public `dev.hermeshaplease.com` deployment is committed in `config/hermes-life-host.env` (commits `885e6bd`, `da77725`) and pushed to `origin/main`; its line hash is byte-identical to the live value in `~/.config/hermes-life/keys.env` (verified by sha256 comparison without printing values). Because `entrance_gate.py:89-90` derives the cookie-signing key as `sha256('hash:'+hash)`, anyone with repo access can mint valid session cookies without cracking the password. This is live right now.
2. **An unauthenticated server shell (HA-002, P0).** `/ws/terminal` forks `/bin/bash` with the server's full `os.environ` (which `start.sh` populates with `keys.env` secrets) and no in-code auth or command boundary; the only guard is the same gate whose key is derivable from HA-001.
3. **The backend source tree cannot boot (HA-003, P1).** `hermes_life/app.py:99` uses `self.personality` before its assignment at `app.py:122`; 153 of 159 backend test failures plus all 13 setup errors share this single root cause. The running service only works because it predates the change.
4. **The deployed backend is stale and un-restartable (HA-004, P1).** The live uvicorn (started 19:14) predates the current source (edited 21:10) and its OpenAPI (137 routes) lacks `POST /{name}/dir`, `POST /{name}/move`, `GET /{name}/search`, `PUT /api/fs/upload` and the `file.changed` emitter. The previous audit's "RESOLVED" claims for D1/D2/D6/D12 are true in source but **not operational at the application host**, and cannot be made operational until HA-003 is fixed and the service restarted.
5. **The §4.4 integration promises are broken end-to-end (HA-005…HA-008, P1).** Chat file links silently do nothing in the common cases (D3 was not actually fixed — a dead end in `pendingOpen` handling); applied host changes never emit `file.changed` (the §4.4 pipeline is fed only by manual IDE writes); the implementation-apply endpoint is orphaned so accepted candidates cannot be applied from any UI; and switching IDE workspace silently re-scopes outgoing conversation messages via `@project` injection.

**Major improvements since the previous audit.** Draft ledger wired (D7); project-free uploads (D6, source); bubble overflow queueing (D10); single WebSocket fan-out (D17); explorer create/rename/move + content search + dirty tracking + tab persistence (D2/D4/D5/D12, source); Send-selection/Send-file-reference (D9); the three previously failing frontend tests fixed (D14–D16) — the suite is now 400/0.

**Overall specification compliance.** Strong on §2 shell/state, §3.3 event truthfulness, §4.1 conversation, §5 work surfaces and §6 state boundaries. Partial on §3.2 composition, §4.2 attachment semantics, §4.3 editor completeness. Not met on §4.3's "no permanent attachment panel" (HA-011), §4.4's applied-change fan-out and link-opening (HA-005/006/007), §4.4's conversation-scope independence (HA-008), and the §1/§8 principle that the interface never mislabels activity (HA-012 conflates candidate with applied).

**Principal remediation priorities.** (1) Rotate the gate credential and purge git history (HA-001); lock down `/ws/terminal` (HA-002). (2) Fix `app.py:99`, fix schema-test drift, restart the backend (HA-003/004/009) — this alone makes six claimed fixes real. (3) Repair the §4.4 integration chain (HA-005/006/007/008/012/013). (4) Then the UX cluster (HA-010/011/014/017).

## 3. Architecture and Implementation Assessment

**Application shell and navigation.** A persistent shell (`frontend/index.html`: header 60px / workspace / status strip; `main.v2.ts`) with a nav rail, global search, Attention indicator and one status strip. Eleven workspaces are registered (`main.v2.ts:49`): world, home, conversations, projects, attention, work, activity, results, system, knowledge, research. Canonical navigation state with URL serialization and legacy redirects lives in `navigation-state.ts`. **Deviation (documented, intentional):** the spec's §2 "Chat menu containing Chat tab + Projects tab" is implemented as two flat peer destinations ("Chat", "Projects" in the sidebar). Functionally equivalent; recorded as spec-judgment S1 (HA-047) rather than a defect.

**Component hierarchy / ownership.** World (town-* modules) is derived presentation; Chat (`hermes-chat.ts` + `chat-attach.ts` + `conv-composer.ts`) is the only conversation surface; Projects (`phase412-project-ui.ts` + `project-editor-lib.ts`) is the only filesystem surface; Work/Activity/Knowledge/Research/Attention have dedicated modules. Selection is typed per view (`navigation-state.ts:158-173`), so stale foreign selections cannot leak — verified.

**Shared services and sources of truth.** Execution/events: one `/ws/events` socket (`main.v2.ts:538-546`) fanning out one `hermes:event` DOM event; `/ws/terminal` is a PTY service, not a second event stream. Conversation: `hl_conversations`/`hl_conversation_turns` (schema.py:462-474) mirrored read-only to Obsidian (`conversation_memory.py`). Files: `ProjectWorkspaces` with allowed-root containment. Work graph: `workflow_status.py` over task/plan/run/review tables. UI navigation is presentation state only and cannot alter execution — verified.

**State management.** Workspaces are hidden, not unmounted, so view switches preserve state (`main.v2.ts:60-63`). Drafts: one localStorage ledger (`conv-composer.ts`). Editor tabs persist per workspace. **Weakness:** conversation identity is split across two localStorage keys (`hermes-life-chat-conversation` vs `hermes-life-conversation-id`) letting the Home composer and Chat tab diverge (HA-044), and attachment chips are in-memory only (HA-038).

**Duplicate / competing implementations.** Renderer family (`town-renderer-v2/-3d/-static/-ts`) is an intentional capability fallback chain, not duplication. Dead markup: a legacy `#chat-host` div (`index.html:683`) is referenced by no module. The Projects stage embeds chat-attachment machinery (HA-011) — the clearest "two features sharing one surface" defect.

**API contracts.** 137 routes live (enumerated from `/openapi.json`); the source registers more (HA-004). All gated endpoints return 401 without a session, so route existence must be verified via `/openapi.json` (not gate-protected). Contract shapes are Pydantic-pinned and covered by 60 backend test files (currently red — HA-003).

**Coherence verdict.** The system is one coherent operational core (events, store, work graph) with three presentation surfaces that mostly agree with it; the failures concentrate at the seams (apply→file-change fan-out, chat→projects links, deploy lag), not in the foundations.

## 4. Previous Audit Revalidation

Verdicts: RESOLVED / PARTIAL / UNRESOLVED / REGRESSED / INCORRECT-PREVIOUS. Full evidence in §14 findings.

| Prev | Title | Verdict | Evidence summary |
|---|---|---|---|
| D1 | No file-change event infrastructure | **PARTIAL** | Emitter + subscriber + dedup/conflict handling all exist (`project_workspaces.py:450-464`, `phase412-project-ui.ts:684-715`) but (a) not live (HA-004), (b) apply/sync paths never emit (HA-006), (c) `make_dir` emits nothing. Zero `file.*` rows in the 131,737-event store. |
| D2 | Explorer cannot create/rename/move | **PARTIAL** | `POST /{name}/dir` + `/{name}/move` + context-menu dialogs exist (`project_workspaces.py:811-816`, `phase412-project-ui.ts:951-1044`) but absent from the live route table (HA-004). |
| D3 | Chat file links never open Projects | **REGRESSED / previous claim incorrect** | Handler exists (`phase412-project-ui.ts:722-747`) but `pendingOpen`'s only consumer (`:1167`) is unreachable in the common paths (HA-005, verified at source). |
| D4 | No dirty/unsaved editor state | **PARTIAL** | Dirty/conflict markers + close-confirm + mtime guard exist and are pinned by tests; but tab switches silently discard dirty buffers and background dirty tabs never get conflict flags (HA-013). |
| D5 | Editor tabs/scroll don't persist | **RESOLVED** | `persistOpenDocs`/`restoreOpenDocs` + per-doc scroll (`phase412-project-ui.ts:1149-1171, 1254, 1286`); scroll deliberately in-memory across reloads (matches claimed scope). |
| D6 | Local uploads project-coupled | **PARTIAL** | `PUT /api/fs/upload` project-free (`chat-attach.ts:237`, `project_workspaces.py:837-838`), gating code fully removed, contract test green — but route not live (HA-004) and upload provenance invisible (HA-037). |
| D7 | Draft ledger unwired | **RESOLVED** | Wired: per-keystroke save, swap-on-switch, clear-only-on-ack (`hermes-chat.ts:12, 1049-1057, 1079-1080`); contract test `d7-d9-drafts-send.test.ts` green. |
| D8 | Markdown/image/artifact rendering | **PARTIAL** | Editor image previews + honest binary handling shipped (`phase412-project-ui.ts:1267-1279`); chat answers still render no images and no artifact/file links (HA-014). |
| D9 | No Send Selected Text / File Reference | **RESOLVED** | All three actions exist and none auto-send (`chat-attach.ts:309-314`, `phase412-project-ui.ts:197, 963-965, 1300-1311`); caveat: chips carry workspace-relative paths (HA-045). |
| D10 | Bubble overflow dismissed | **RESOLVED** | Queued + "+N more" summary (`bubbles.ts:875-891, 1095-1118`), pinned by `bubbles-d10-d11.test.ts` (green). |
| D11 | No sensitive-field redaction | **PARTIAL** | `redactSensitive` covers Bearer/JSON/key-value, but leaks HTTP-Basic credentials and multi-word values (HA-015, probed headless). |
| D12 | Search is label filter | **PARTIAL** | Backend content search + debounced results exist (`project_workspaces.py:401-448`, `phase412-project-ui.ts:465-495`) but route not live (HA-004). |
| D13 | Minor Projects mismatches | **PARTIAL** | Resolved: resizable sidebar, SCM decorations, branch chip, image previews, drag-drop code. Regressed: split pane now renders permanently (HA-010). Still open: tree file-type icons, Markdown preview, bottom-panel resize, Recent Workspaces (HA-040…HA-043). |
| D14 | Failing test: attachment panel placement | **RESOLVED** | Suite green 400/0 (verified). |
| D15 | Failing test: manufactured activity | **RESOLVED** | Suite green 400/0 (verified). |
| D16 | Failing test: uploads land in workspace | **RESOLVED** | Suite green 400/0 (verified). |
| D17 | Second WebSocket | **RESOLVED** | Chat subscribes to the shared `hermes:event` fan-out (`hermes-chat.ts:979-997`); only `/ws/events` + `/ws/terminal` sockets remain. |
| D18 | Resident focus inspector | **PARTIAL** | Resident card has role/operation/project/goal/event/evidence links (`town-view.ts:593-664`) but floats in a popover while the Inspector shows the room card, and only one event is shown (HA-032). |

**Previous verification-baseline corrections (INCORRECT-PREVIOUS).** The prior review's "372 pass / 3 fail" frontend baseline is stale — the suite is **400 pass / 0 fail**. Its "backend pytest has the known pre-existing baseline (3 failed / 366 passed)" is wrong for the current tree: measured **159 failed / 231 passed / 13 errors**, dominated by the in-flight `app.py` refactor (HA-003). Its live event-store counts (131,737 events; hermes.text 116,870 · tool_use 5,554 · tool_result 5,554 · system 433 · result 389) re-verified exactly.

## 5. Development Specification Compliance Matrix

Status keys: ✅ implemented-and-verified · 🟡 partial · 🔴 not met.

### §8 "Home and live agents"
| # | Criterion | Status | Refs |
|---|---|---|---|
| 1 | Home retains facility/residents/Director; Chat/Projects not Home tabs | ✅ (nav-grouping deviation recorded as S1/HA-047) | §3 |
| 2 | World overview + focus; camera reframe; selected objects link to work/evidence | 🟡 reframe ✅; resident links live in a popover, not the inspector; framing wastes canvas | HA-017, HA-032 |
| 3 | All seven residents support bubbles; real tool calls/params/results incrementally | ✅ | §6 |
| 4 | Executing role vs functional category distinguished; genuine concurrency; no fabrication | 🟡 honest mapping ✅; same-tool concurrency corrupts correlation | HA-016 |
| 5 | Bubbles readable, overlap-limited, success/failure/waiting, dismissal, reduced motion | 🟡 queue/summarize ✅; clamp constants stale; hover shows no detail | HA-033, HA-034 |
| 6 | Bubble detail links to records; history durable; reconnect no replay | ✅ | §6 |
| 7 | Rendering budget, static fallback, execution independent of nav | ✅ | §6 |

### §8 "Chat and Projects"
| # | Criterion | Status | Refs |
|---|---|---|---|
| 1 | General conversation without active project; ChatGPT-style UI | ✅ | §7 |
| 2 | Hosted files/dirs attachable without registration, contextual | ✅ in source (uploads not live until restart) | HA-004 |
| 3 | Projects independent workspace + editing + SCM; IDE occupies workspace | 🟡 capabilities real; permanent attachment meter + phantom split pane mar the surface; create/rename/move/search not live | HA-004, HA-010, HA-011 |
| 4 | Applied changes auto-update Projects; dirty buffers protected | 🟡 manual IDE writes ✅; apply/sync paths emit nothing; tab switches discard dirty edits | HA-006, HA-013 |
| 5 | Pending vs applied changes distinguishable | 🟡 review labels honest; workflow status conflates accepted with applied | HA-012 |
| 6 | Project→Chat attach without auto-send; Chat links open Projects resource | 🟡 forward ✅; reverse broken in common paths | HA-005 |
| 7 | Repeated switches preserve drafts/attachments/tabs/dirs/unsaved/runs | 🟡 most persist; chips lost on reload; dirty lost on tab switch | HA-038, HA-013 |
| 8 | No redundant conversation/filesystem/execution infrastructure | ✅ | §3 |

### §8 "Operational consistency"
| # | Criterion | Status | Refs |
|---|---|---|---|
| 1 | Surfaces show consistent authoritative state and linked identifiers | 🟡 identifiers shared; conversation-key split; candidate/applied mislabel | HA-044, HA-012 |
| 2 | Autonomous work retains origin/justification/permissions; Attention genuine | ✅ (badge lag ≤75s) | HA-046 |
| 3 | Work/execution continue when UI closed or fails | ✅ | §3 |
| 4 | Existing memory/research/evidence/approval capabilities accessible | ✅ | §12 |

## 6. Home and Living World Audit

The Living-World stack is the strongest area for spec §3.3 truthfulness. Bubbles are driven exclusively by real persisted runtime events (`hermes.text/system/tool_use/tool_result/result` plus workflow events); `categorizeEvent` returns null for unknown payloads and `hermes.system` deliberately yields no bubble — no manufactured activity anywhere (verified in `bubbles.ts:255-257, 343-344, 390-395`, pinned by `bubbles-ac14.test.ts`). The executing-role vs functional-category rule holds: every `hermes.*` event is pinned to the coordinator role with only a secondary functional tag, so Hermes calling a file tool never claims Forge executed (`bubbles.ts:278-293, 308-330`). Event integration reuses the single socket with `?after=` watermark, sequence dedupe and a `historical` flag; historical replays never render as live. Lifecycle (running→result merge by `tool_call_id`, retention, dismissal, reduced motion, DOM reuse, rAF throttling, full dispose incl. ResizeObserver) is complete. Static fallback is truthful (`town-renderer-static.ts`). Camera reframes on panel resize (`town-view.ts:226-234`) and no auto-follow exists. Director identity/status separation and links to conversation/work/activity are compliant (`director-panel.ts:22-57`).

Defects: overview framing wastes over half the canvas (HA-017 — the facility fills ~47% of viewport width, matching the screenshot); concurrent same-tool calls merge into one bubble and lose correlation (HA-016); redaction leaks Basic credentials (HA-015); resident selection shows the room in the Inspector while the resident card floats separately (HA-032); clamp constants no longer match bubble CSS (HA-033); hover exposes no details (HA-034); resident labels are small at overview zoom (HA-035).

## 7. Chat Workspace Audit

Chat is a genuine general-purpose surface: it works with no project or attachment (submit posts `/api/tasks` with `conversation_id|null` and no project field — `hermes-chat.ts:1079`); no IDE/SCM/registration controls live in the composer; the empty start state is clean with a persistent composer; agent activity is a secondary expandable strip; markdown/code render with copy buttons; the reading column is a comfortable 76ch. Message separation exists (right-aligned mint user bubbles vs full-width assistant column — the screenshot's "flat" look is a mid-answer scroll position, not missing segmentation). Persistence is canonical (`hl_conversations` + turn store) with per-conversation drafts that survive switches and reloads. Token/cost/context telemetry is notably honest (refuses to draw a lying utilization bar; shows cost provenance; reports "unavailable" instead of inventing numbers).

Gaps: answers never render images or artifact/file references (HA-014 — `chat-markdown.ts:5-24` has no image grammar and only https anchors); the history sidebar is searchable but not collapsible (HA-036); uploaded attachments are visually indistinguishable from host references (HA-037); chips are lost on reload (HA-038); there is no attachment preview (HA-039); "Send file reference" chips carry workspace-relative paths the worker cannot resolve (HA-045). Attachment semantics are otherwise spec-compliant: hosted files/dirs attach without registration, directory references are on-demand (contents explicitly not injected), and nothing auto-grants authority or auto-sends. Project-free uploads work in source (`PUT /api/fs/upload`) but are not live (HA-004).

## 8. Projects Workspace Audit

Structurally a real IDE: top-level workspace with no Conversations wrapper, activity bar (Explorer/Search/Source Control with icons), hierarchical tree with context menus, create/rename/move/delete and drag-drop, resizable persisted sidebar, CodeMirror editor with tabs/breadcrumbs/syntax highlighting/line numbers, per-tab ● dirty / ⚠ conflict markers, mtime-guarded save, image previews, honest binary handling, diff view, Terminal|Changes|Output bottom panel with a real gated PTY, compact status chips (workspace · branch@commit(dirty) · files), and an honest empty state that offers workspace opening. Filesystem ops are containment-checked end to end (`_contained` resolve+symlink collapse, denylists, atomic writes, soft-delete trash — `project_workspaces.py:277-302, 603-676`). Opening a workspace requires no conversation.

Two screenshot artifacts are now root-caused: the always-present "No files attached" strip is a permanently mounted chat-attachment meter inside the IDE stage (HA-011 — spec §4.3 forbids a permanent attachment panel), and the mysterious blank input-like box with × is the read-only split pane rendering despite `hidden=true` because `phase415-workspace.css:156` sets `display:flex` with no `[hidden]` guard (HA-010 — verified by computed-style probe: `hidden=true, display:flex, 1060×121px`).

Remaining defects: create/rename/move/search/upload exist in source but not in the live server (HA-004); no Markdown rendered preview (HA-040); tree rows show generic glyphs instead of file-type icons (HA-041); bottom panel is collapsible but not resizable (HA-042); no Recent Workspaces (HA-043); tab switches discard dirty buffers (HA-013).

## 9. Cross-Workspace Integration Audit

**Projects→Chat (D9): verified good.** Context "Send file reference to chat" and the "Send selection" header button land content in the composer and never auto-send (`chat-attach.ts:309-314`, `phase412-project-ui.ts:963-965, 1300-1311`). Chips compose into the next message and clear on ack.

**Chat→Projects (D3): broken.** `hermes:projects:open-file` exists and resolves paths with honest failure messages, but `pendingOpen` has exactly one consumer (`restoreOpenDocs:1167`), which is unreachable in the common cases: same-project links and workspace-relative links set `pendingOpen` and call `refreshFileContext()`, which never consumes it; and `restoreOpenDocs` early-returns at `:1165` before its own `pendingOpen` check when no tab state is persisted (HA-005, control-flow verified). Clicking "Files consulted" entries therefore silently does nothing in most situations, and a stale `pendingOpen` can later open an unrelated file.

**§4.4 pipeline (candidate→apply→file events→both surfaces): broken at the fan-out node.** `file.changed` is emitted only by manual IDE write endpoints. `project_approvals.apply` and `implementation.apply_to_host` run `git apply` and emit nothing (or only `implementation.applied`) (HA-006); the Projects apply button refreshes nothing after success; and `POST /api/implementations/{ident}/apply` has zero frontend callers, so an accepted candidate cannot be applied to the host from any UI (HA-007). The review labels themselves are honest ("Accepted for separate application"), but the workflow-status resolver then labels the same run "Completed"/"integrated" (HA-012) — violating §4.4's "a tested candidate is not an applied host change."

**Conversation scope (§4.4): violated.** A capture-phase submit listener prepends `@project <IDE selection>` to every outgoing chat message based on the Projects tab's *global* selection (HA-008, verified at source) — switching workspace in the IDE silently re-scopes the next message of whatever conversation is active. Conversation switching correctly does not move the IDE.

**Dirty-buffer protection:** active document protected (conflict marking + mtime save guard); background dirty tabs silently lose unsaved edits on tab switch (HA-013).

## 10. Agent Execution and Runtime Events Audit

Orchestration: `POST /api/tasks` → `create_task` (holds `runtime.active`) → `run_task` on a worker thread via the adapter chain (persona vs judge chains selected by `task_scope` bound to approved formulation lineage) → durable task/plan/run/review records → events. Runtime events are real, persisted, ordered (`sequence`), correlated (`tool_call_id`), and streamed once over `/ws/events` with `?after=` watermark; replay is tagged `historical` and consumers (bubbles, chat, Projects) ignore it. Execution history and trace endpoints exist (`/api/chat/trace/{task_id}`, `/api/tasks/{task_id}`), with failure events (`task.failed` 11, `task.cancelled` 4 in store) and cancellation (`POST /api/tasks/{id}/cancel`). Approval boundaries: plan approval text states it authorizes isolated implementation only; autonomy policy separates allowed/grant-only/never with audited denials.

Defects: `cancel_task` can release the global task lock it doesn't own (HA-022 — race with `run_task`'s `finally`); cancellation is untested at runtime here (gate). The visible execution states correspond to actual backend activity everywhere we could trace (the status strip "Backend: completed · Last event: task.completed" is derived from the event store, not fabricated). The one honesty violation in the operational chain is label-level, not event-level: HA-012.

## 11. Work Management Audit

Work, Activity, Knowledge, Research and Attention exist with the responsibilities §5 assigns them (registered in `main.v2.ts:49`; Work owns portfolio + chain subviews; Activity renders the event timeline; Knowledge/Research have dedicated modules). The contextual inspector resolves the selected object through typed per-view renderers with real status, ownership (why/project), evidence and permitted next actions; stale foreign selections cannot leak across views (verified). Attention items are re-derived from live predicates only (proposed plans, undecided candidates, evaluation errors, pending memory reviews, awaiting-approval proposals, unreachable vault) — genuine unresolved decisions; resolved items drop from the count (with up to ~75s lag, HA-046). Autonomous initiatives retain origin/justification/authorization (origin badges in `portfolio-view.ts:83`; rationale required before decision). The work graph is navigable end-to-end at the record level (task→plan→run→review→result with shared ids), with one honesty gap (HA-012) and one missing edge: the apply step cannot be traversed from the UI (HA-007).

## 12. Memory and Conversational Continuity Audit

Mapped to master-spec HL-MEM/HL-CONV requirements (the unified spec defers here). **Implemented and verified:** canonical conversation persistence (`hl_conversations` 25 / `hl_conversation_turns` 234) with read-only Obsidian mirroring (atomic writes, frontmatter; vault live at `/run/media/gayzer/black/obsidian/hermes/Hermes-Life`); memory extraction with honest candidate/rejection accounting (156 extraction runs, rejection breakdowns recorded); retrieval pipeline in prompt assembly (entity extraction → generation → scoring → pruning); revision-aware vault notes (`expected_revision` conflict path, `memory_service.py:350-363`); health endpoint surfaces vault state. **Partial:** provenance fields exist (`evidence_excerpt/origin/confidence/expires_at`) but are NULL in live rows and the correction flow has zero runtime use (`hl_memory_corrections` = 0) (HA-030); consolidation is implemented but disabled and its table is not even migrated on the live DB (schema v41 vs code v42, HA-009); cross-model continuity is turn-store-level only — CLI session resume is model-bound and opt-in. Episodic (2 rows) and relational (1 row) stores are nearly empty after 156 extraction runs because validators reject almost everything. The spec's "do not introduce a second memory system" is honored: exactly one store plus a mirror. (Obsidian desktop is a second concurrent *writer* to the vault; the revision-conflict path is the designed protection and is implemented.)

## 13. Technical Quality, Performance and Security Audit

**Security (headline: HA-001/HA-002 — both verified by direct probe).**
- HA-001 (P0): gate password hash committed and pushed (`885e6bd`, `da77725`, both ancestors of `origin/main`); cookie key derived from it (`entrance_gate.py:89-90`) → mintable sessions → live auth bypass of the public deployment.
- HA-002 (P0): `/ws/terminal` = `/bin/bash` with full server environ (incl. `keys.env` secrets), no in-code auth; reachable through the vite proxy at the public host.
- HA-018/019/020/021: gate fails open when env is absent; `/health` is gate-exempt and leaks worker topology; rate limiting is one global bucket behind the proxy; session tokens are deterministic and unrevocable.
- Path containment is otherwise strong (resolve + containment checks, denylists, soft-delete, atomic writes); the review/apply flow is digest-bound with confirmation phrases. HA-026 (extra-roots projects register then fail all ops) and HA-027 (size check after base64 decode) are correctness/resource issues rather than escapes.

**Reliability:** HA-003 (tree cannot boot), HA-004 (stale deployment), HA-022 (cancel lock race), HA-028 (PTY zombies), HA-029 (no logging framework; swallowed exceptions in recovery paths).

**Performance:** HA-023 (global store lock serializes reads; no `task_id`/`type`/`timestamp` indexes on a 131,737-row events table), HA-024 (`/ws/events` polls the DB and writes world state every 0.4s *per connection*), HA-025 (blocking git/ssh subprocesses with 35–120s timeouts on request paths). Frontend is lean: single WebGL pass, 20s snapshot polling skipped when hidden, rAF-bounded bubble positioning, DOM reuse, complete disposal; build passes with one chunk-size warning (1.6MB single chunk — worth code-splitting eventually).

**Error handling / type safety:** frontend is strict-TS and type-checks clean; backend errors map to HTTP codes through a consistent `handle()` wrapper; gaps are the swallowed exceptions (HA-029) and the unparseable `after` query param in `ws_events` (HA-024).

## 14. Consolidated Findings

Severities: P0 critical · P1 high · P2 medium · P3 low. Verification method per finding: [S] source inspection, [T] automated test, [R] runtime probe, [V] visual, [H] headless module probe.

### P0 — Critical

**HA-001 — Entrance-gate password hash in git history; live auth bypass.** [S+R]
- Status: INCORRECTLY SECURED · Subsystem: security/auth. Spec: master §13.3 secret handling (the unified spec's §6 "authoritative operational state" assumes protected services).
- Observed: `config/hermes-life-host.env` in commits `885e6bd` and `da77725` contains `HERMES_LIFE_GATE_PASSWORD_HASH` (pbkdf2 value); both commits are ancestors of `origin/main` on github.com/tre508/hermes-life.git; the line's sha256 is identical to the live value in `~/.config/hermes-life/keys.env` (verified without printing values). `entrance_gate.py:89-90` derives the cookie-signing key as `sha256('hash:'+hash)`.
- Expected: secrets never in VCS; cookie key from an independent secret.
- Root cause (confirmed): the hash originally lived in tracked config and was moved to keys.env without history purge or rotation; `.gitignore` covers `.env`/`*.local` but not `config/*.env`.
- Impact: anyone with repo access can mint valid session cookies for the live public deployment without cracking the password. Full gate bypass including `/ws/terminal` (HA-002).
- Remediation: rotate the gate password now (rotation re-derives the cookie key and invalidates leaked hash + outstanding cookies); add `HERMES_LIFE_GATE_COOKIE_KEY` in keys.env; purge history (filter-repo) or treat the repo as burned; gitignore/untrack `config/*.env`.
- Verification/acceptance: new hash differs from the committed one; `git log -p -- config/*.env` shows no credential; old-cookie replay returns 401.

**HA-002 — `/ws/terminal` is an unauthenticated server shell with secret-bearing environment.** [S+R]
- Status: INCORRECTLY IMPLEMENTED · Subsystem: execution/security. Spec: §4.3 "terminal or diagnostics only where supported by existing execution and permission infrastructure" (master HL-AUTO-004).
- Observed: `app.py:1520-1586` forks and `execve('/bin/bash', ['--norc'])` with `environ = dict(_os.environ)`; no auth/authorization/command boundary in the handler; `start.sh` sources keys.env into the server env, so the PTY inherits `OPENROUTER_API_KEY`, `HERMES_LIFE_GATE_PASSWORD_HASH`; vite proxies `/ws` to the backend, so the endpoint is reachable at `dev.hermeshaplease.com`. Only guard: the optional gate cookie (whose key is derivable per HA-001).
- Expected: per-session capability/role check for terminal access; child env filtered to a safe allowlist.
- Impact: any gate breach yields a full server shell with secrets (host user `gayzer`, Apps dir, DB).
- Remediation: dedicated capability token or role for `/ws/terminal`; env allowlist for the child; consider disabling on the public deployment.
- Acceptance: unauthenticated WS connect to `/ws/terminal` is refused; PTY env contains no key material (asserted by test).

### P1 — High

**HA-003 — `app.py:99` uses `self.personality` before assignment; the backend tree cannot boot and its test suite is red.** [S+T]
- Status: REGRESSED (in-flight refactor) · Subsystem: backend core. Spec: master §20.1 validation gate.
- Observed: `Runtime.__init__` passes `self.personality` into `PersonalityAdapter(...)` at `app.py:98-100` while it is assigned at `app.py:122-123`. Pytest: 159 failed / 231 passed / 13 errors; 153 failures and all 13 setup errors attribute to `AttributeError: 'Runtime' object has no attribute 'personality'` at `app.py:99`.
- Expected: constructors assign before use; suite failures limited to refactored features.
- Impact: any restart of uvicorn on this tree fails at startup (which is why HA-004 persists); nothing that builds `create_app()` is validated, including auth/scope/memory tests.
- Remediation: build `self.personality` before `self.adapters` (or lazy-getter); add a unit test instantiating `Runtime` directly.
- Acceptance: `pytest` failures drop to the documented pre-existing set (entrance_gate logic, flow004, flow006 — each re-validated once the app boots); service restarts cleanly.

**HA-004 — Deployed backend is stale and un-restartable: four claimed fixes are not operational at the application host.** [S+R]
- Status: PARTIALLY IMPLEMENTED (source complete, not live) · Subsystem: deployment. Spec: §7.6 "No feature is considered implemented merely because its UI exists."
- Observed: uvicorn pid 2766791 started 19:14:19; `project_workspaces.py` edited 21:10:19, `app.py` 19:22:59. Live `/openapi.json` (137 routes) lacks `POST /api/projects/{name}/dir`, `POST /{name}/move`, `GET /{name}/search`, `PUT /api/fs/upload`; the `file.changed` emitter (`project_workspaces.py:459`, uncommitted, absent from HEAD) is likewise not in the live process. Vite hot-reloads, so the live UI already ships controls for these (explorer create/rename/move, search view, upload) whose calls 404 behind the gate.
- Expected: deployed API matches source; claimed fixes verifiable at the application host.
- Impact: D1/D2/D6/D12 features broken on the live app despite "RESOLVED" status in the previous audit; zero `file.*` events in the store.
- Root cause (confirmed): no `--reload`/restart after source edits; restart blocked by HA-003.
- Remediation: fix HA-003 (and HA-009 tests), restart the backend, re-run the smoke checks for each route; consider running the dev backend with `--reload`.
- Acceptance: live `/openapi.json` contains all four routes; a scratch write emits `file.changed` visible in `/api/events`; the D-claims verified at runtime, not just source.

**HA-005 — Chat file links silently fail to open in Projects (D3 not actually fixed).** [S]
- Status: INCORRECTLY IMPLEMENTED · Subsystem: integration. Spec: §4.4 "Chat artifact/file links can open the corresponding resource in Projects."
- Observed: handler `phase412-project-ui.ts:722-747`; `pendingOpen` set at `:738/:745` but consumed only at `:1167` inside `restoreOpenDocs`, which is called only from `selectProject:641` and mount `:1606`, and which early-returns at `:1165` before its `pendingOpen` check when no tabs are persisted. Same-project links and workspace-relative links (which is what "Files consulted" emits — headers list tree-relative paths, `:1447-1484`) never trigger a consumer. Stale `pendingOpen` can open an unrelated file at the next project switch.
- Expected: clicking a file reference opens that file's editor resource (or says why not).
- Root cause (confirmed): pendingOpen consumption placed behind an early-return guard; two handler branches schedule no consumer.
- Remediation: check `pendingOpen` before the saved-tabs guard; open directly in same-project/relative branches; clear stale `pendingOpen` on explicit project selection.
- Acceptance: a "Files consulted" click opens the file for (a) same-project absolute, (b) workspace-relative, (c) cross-project; unresolvable path shows the existing honest message.

**HA-006 — Applied host changes never emit `file.changed`; §4.4's shared-event fan-out is fed only by manual IDE writes.** [S]
- Status: PARTIALLY IMPLEMENTED · Subsystem: integration. Spec: §4.4 pipeline diagram and "shared file change events."
- Observed: emitters only in the manual file API (`project_workspaces.py:397, 638, 675, 761`); `project_approvals.apply` (`:84-90`) and `implementation.apply_to_host` (`implementation.py:581-601`) git-apply without emitting; Projects listener filters `type==='file.changed'` (`phase412-project-ui.ts:684-686`); the apply button refreshes nothing after success (`:1421-1428`); `hc-task-finished` fires only from the chat composer's polling (`hermes-chat.ts:927`).
- Expected: every host mutation (apply, sync, write, delete, move, upload, mkdir) updates the explorer/editor/diffs via shared events without reload.
- Remediation: emit per-file `file.changed` (or one project-level event) from `project_approvals.apply`, `implementation.apply_to_host` and `/sync`; make the apply button call `load()` after success regardless; include `make_dir` (currently emits nothing).
- Acceptance: applying a candidate produces events consumed by the Projects UI (tree refresh + dirty-conflict marking) with no reload; a test asserts emission from each producer.

**HA-007 — Accepted candidates can never be applied to the host from any UI; apply endpoint is orphaned.** [S]
- Status: PARTIALLY IMPLEMENTED · Subsystem: work pipeline. Spec: §4.4 "Chat request → … → candidate / review / apply → actual hosted filesystem changes."
- Observed: `POST /api/implementations/{ident}/apply` + `apply-preview` exist (`app.py:907, 919-927`, `implementation.py:492-703`, incl. blocker taxonomy) but have zero frontend callers; Build review ends at Accept/Reject/Request revision with the label "Accepted for separate application" and no apply action anywhere.
- Impact: the pipeline's apply step is unreachable in-product; combined with HA-012 the UI both under- and mis-represents the candidate lifecycle.
- Remediation: "Apply to host" action on the accepted-run card driving `apply-preview` first (show `can_apply`/blockers) then `apply`; label "applied" only after the endpoint confirms.
- Acceptance: from an accepted run, a user can apply to host; run state becomes `applied`; file events (HA-006) update Projects.

**HA-008 — Switching the Projects workspace silently re-scopes the active conversation.** [S]
- Status: CONTRADICTS SPEC · Subsystem: integration. Spec: §4.4 "Switching projects must not silently change a conversation's scope."
- Observed: capture-phase submit listener (`phase412-project-ui.ts:1433-1440`) prepends `@project <name>` (from the Projects tab's global `choice()`) to every outgoing message — including when nothing is attached — and the conversation→project map is explicitly "never the authority" (`:632-635`).
- Impact: agent work can be scoped to the wrong project with no prompt or visible scope control; cross-conversation contamination of scope.
- Remediation: scope injection per conversation (`CONV_PROJECT_KEY` entry for the current conversation, updated only on explicit user action) or surface the effective `@project` scope in the composer with an explicit change affordance.
- Acceptance: switching the IDE workspace does not alter the scope of an unrelated conversation; the message scope is visible before send.

### P2 — Medium

**HA-009 — Schema migration tests drifted from SCHEMA_VERSION=42; live DB one version behind code.** [S+T+R] `tests/test_lib001_m2.py:64` asserts `42==40`; its v38-cap fixture deletes only v39/v40 so `_build_registry()` raises `_upgrade_to_v[41, 42] defined beyond SCHEMA_VERSION=38`; `test_schema_registry.py:27-39` hard-code v41-era assumptions. Live `PRAGMA user_version=41` while `schema.py:4` declares 42 (consolidation_settings absent in production). Root cause (confirmed): v41/v42 upgrades added without updating v40-era test fixtures. Remediation: assert `SCHEMA_VERSION` symbolically; delete upgrade stubs above the cap dynamically; restart so `migrate()` applies v42. Acceptance: schema tests green against fresh and legacy DBs; live user_version=42.

**HA-010 — Split pane renders permanently despite `hidden=true` (the phantom input box with ×).** [S+V+R] `phase415-workspace.css:156` sets `#hc415-split{…display:flex…}` overriding the UA `[hidden]` rule with no `[hidden]{display:none!important}` guard (siblings have one at `:10, :29`); verified live DOM: `hidden=true, display:flex, 1060×121px`. Expected: pane only when opened via "Open in split view". Remediation: add the `[hidden]` guard. Acceptance: pane invisible until opened; screenshot area reclaimed.

**HA-011 — Permanent chat-attachment panel inside the Projects IDE.** [S+V] Spec §4.3: no "permanent attachment panel". `#hc415-file-meter` ("No files attached") is unconditionally mounted at the stage bottom (`phase412-project-ui.ts:220, 525, 847-856`), with attach toggles on every tree row. Remediation: move the meter/mode state to the Chat composer or an on-demand Project→Chat menu; keep only contextual attach actions (§4.4). Acceptance: IDE stage shows no attachment chrome until an attach action is invoked.

**HA-012 — Workflow status conflates accepted candidate with applied host change.** [S] `workflow_status.py:37-41` maps `accepted` → "Completed"; `:228-229` ranks it "integrated"; while a truly applied run carries state `applied` (`implementation.py:588-593`). Spec §4.4: "A tested candidate is not an applied host change." Remediation: label "Accepted — not yet applied to host" with next_action apply; reserve Completed/integrated for state=applied. Acceptance: status surfaces show four distinct states (running, pending review, accepted-not-applied, applied).

**HA-013 — Unsaved edits silently discarded on editor tab switch; background dirty tabs never conflict-flagged.** [S] `openFile` (`phase412-project-ui.ts:1251-1295`) re-fetches and replaces content on every tab click (`:1223`) with no dirty guard (close does confirm — `:1234`); external-change handling inspects only the active doc (`:697`). Spec §4.4 "do not silently overwrite unsaved work." Remediation: keep live buffer for dirty docs on tab switch; extend `file.changed` conflict marking to all open dirty docs. Acceptance: dirty buffer survives round-trip tab switch; background dirty tab shows ⚠ on external change.

**HA-014 — Chat answers render no images and no artifact/file references.** [S+V] `chat-markdown.ts:5-24` has no image grammar (`![alt](url)` degrades to text) and creates only https anchors; no path linkification, no open-in-Projects links, no artifacts picker source (`chat-attach.ts:278-283`). Spec §4.1 "Markdown/code/image rendering, generated artifacts and file references" (and §4.4 link opening). Remediation: add sandboxed `<img>` handling with alt fallback; linkify host paths/artifacts as chips that dispatch the (fixed, HA-005) open-file event; add an Artifacts picker source. Acceptance: a message containing `![…](…)` shows the image; a file reference chip opens in Projects.

**HA-015 — `redactSensitive` leaks HTTP-Basic credentials and multi-word secret values.** [S+H] Probed the real function headless: `Authorization: Basic <12-char cred>` kept the credential verbatim (only "Basic" was redacted — value regex `[^\\s,;&\"']+` (`bubbles.ts:110`) consumes just the first token); `password=hello world and more` leaks the tail. Spec §3.3 "redact sensitive fields." Remediation: handle scheme-prefixed credentials and extend redaction to the run/line; add Basic + multi-word tests. Acceptance: probe strings show no credential residue.

**HA-016 — Concurrent same-tool calls collapse into one bubble and lose call/result correlation.** [S+H] `addOrUpdateBubble` merges by category+toolName ignoring `tool_call_id` (`bubbles.ts:849-851`) and `mergeContent` overwrites `content.id` (`:496-556`); headless probe: two `read_file` calls → one bubble, first call's result orphaned into a generic success. Spec §3.3 "preserve event order, correlate calls and results; concurrent bubbles must represent genuine concurrency." Remediation: merge only on matching `content.id` (or thought-same-task); preserve original id; overflow queue handles the cap. Acceptance: interleaved two-call regression test passes.

**HA-017 — World framing wastes over half the canvas.** [S+V] Facility fills ~47% of viewport width (frameBounds probe reproduces the screenshot's ~40%); `MAX_ASPECT=2.6` letterboxes wide hosts (`town-renderer-v2.ts:1152-1155`); azimuth projects the grid as a narrow diagonal band (`town-camera.ts:22-27, 88-97`). Spec §3.2 "do not crop the World or waste large areas of the canvas." Remediation: fit the projected silhouette on both axes (or convex hull); revisit the aspect cap. Acceptance: facility fills ≥75% of both dimensions at 16:9 and wider; no cropping at panel-open reframe.

**HA-018 — Gate fails open when credentials are absent.** [S] `GateConfig.enabled = bool(hash or passkey_store)` (`entrance_gate.py:77`); middleware passes everything when disabled (`:225-227`) with no startup warning — on a stack published at `dev.hermeshaplease.com`. Remediation: `HERMES_LIFE_GATE_REQUIRED` aborting startup on public deployments; log gate state at boot. Acceptance: missing-credential startup refuses to serve publicly.

**HA-019 — `/health` is gate-exempt and leaks worker topology.** [S+R] Returns `transport/target/guest_home/agent` (e.g. `glenn@192.168.178.37:22`) unauthenticated (`entrance_gate.py:229`). Remediation: public `{"status":"ok"}`; move topology under gated `/api/*`. Acceptance: unauthenticated `/health` contains no topology.

**HA-020 — Gate rate limiting is one global bucket keyed by proxied peer IP.** [S] `_client_id()` uses the raw ASGI peer (`entrance_gate.py:205-207`); behind the vite proxy everyone shares 127.0.0.1 → 10 failures lock out all users; no per-attacker limiting. Remediation: forwarded-client-IP identity behind the trusted proxy; persistent counters. (Hypothesis flagged: exact Cloudflare header behavior unverified.)

**HA-021 — Gate session tokens are deterministic and unrevocable.** [S] `issue_token() = HMAC(key, 'v1.<exp>')` (`entrance_gate.py:158-161`) — same expiry-second ⇒ same token; logout only clears the cookie (`:279-287`); stolen cookies valid up to 12h. Remediation: random session id + server-side store (or short-lived tokens + refresh).

**HA-022 — `cancel_task` releases the global task lock it may not own.** [S] `app.py:1446-1448` releases `runtime.active` after a stale state read while `run_task`'s `finally` (`:257-258`) also releases → `RuntimeError('release unlocked lock')` 500s or premature second-task start. Remediation: ownership-guarded release or cancellation inside `run_task`. Acceptance: concurrent finish-vs-cancel test passes.

**HA-023 — Global store lock + missing event indexes scale poorly.** [S+R] `store.py:19` serializes all queries incl. reads; per-insert commits; `events` has no `task_id`/`type`/`timestamp` index (`schema.py:387-391`) against 131,737 live rows; `/api/events?task_id=` full-scans. Remediation: `idx_events_task_id` (+type/timestamp if filtered), batched commits, read connections outside the global lock.

**HA-024 — `/ws/events` polls the DB and writes world state every 0.4s per connection.** [S] `app.py:1510-1516`: each loop calls `sync_world` (query + `store.set_world` commit) then `store.events(after)`, all under the global lock; `int(query_params['after'])` can raise past the except clause (`:1509, 1517`). Remediation: one background poller/notifier feeding all sockets; startup-only `sync_world`; defensive parsing.

**HA-025 — Blocking git/ssh subprocesses (35–120s timeouts) on request paths.** [S] `project_workspaces.py:164-267, 477-515`: `file()` runs 3 git subprocesses per response via `_host_version`; `tree()` adds SCM status; `sync()`/`changes()` run scp/ssh while holding `manager.lock`. Remediation: mtime-keyed status caching; background sync returning a run id.

**HA-026 — Projects under extra allowed roots pass registration then fail every operation.** [S] `register()` accepts any `allowed_roots` entry (`project_workspaces.py:95-99, 116-121`) but `_root()`/`sync()`/approvals re-validate against `allowed_root` only (`:183-188, 277-282`) → "Registered path no longer valid". Remediation: use the same any(is_relative_to(allowed)) predicate everywhere. Acceptance: project registered under `HERMES_LIFE_PROJECT_EXTRA_ROOTS` reads/writes/syncs.

### P3 — Low

- **HA-027** [S] Upload/write decode unbounded bodies before the 1MB size check (`project_workspaces.py:371-376, 716-727`) — check encoded length first; cap body size in middleware.
- **HA-028** [S] `/ws/terminal` leaves zombie children (fork at `app.py:1526`, SIGTERM `:1584`, never waitpid) and has no connection cap — reap + limit.
- **HA-029** [S] No logging framework anywhere in `hermes_life/`; swallowed `except Exception: pass` in startup/recovery paths (`app.py:276-287, 343-349`) leave no trace — add module loggers; record swallowed failures as warning events.
- **HA-030** [S+R] Memory provenance fields NULL in live rows; `hl_memory_corrections`=0 despite full API; episodic/relational stores nearly empty after 156 extraction runs (validators reject nearly everything) — tune validators against recorded rejection rates; populate `confidence/origin` at write; exercise the correction path.
- **HA-031** [S+R] Plaintext bot token at `/run/media/gayzer/black/gayzerbottoken.txt` next to the vault — move into keys.env/keyring, shred.
- **HA-032** [S+V] Resident selection puts the resident card in a floating popover while the Inspector shows the room card, and shows only one event (`town-view.ts:593-664`) — register a `resident` inspector kind with the last N events (closes D18).
- **HA-033** [S] Bubble clamp constants (110px half-width, 110px top) no longer match bubble CSS (200–320px, 400–500px expanded) (`bubbles.ts:1168-1184` vs `bubbles.css:22-23, 244-249`); overlap nudges can push bubbles past the top (`:1208-1230, 1503-1530`) — measure elements when clamping; re-clamp after overlap.
- **HA-034** [S] Hover on bubbles only glows; details require click (`bubbles.ts:1346-1350`) — reveal the detail block on hover-with-delay (spec says "hover or click", so fidelity gap only).
- **HA-035** [S+V] Residents ~40px at overview zoom with no persistent name plates — after HA-017, add screen-space constant-size name labels.
- **HA-036** [S+V] Conversations sidebar has no collapse toggle (`hermes-chat.ts:27-29`) — spec §4.1 "collapsible".
- **HA-037** [S] Uploaded attachments are visually indistinguishable from host references (`chat-attach.ts:21, 241, 297-303`) — spec §4.2 "distinguish uploaded content"; add provenance badge/glyph.
- **HA-038** [S] Attachment chips are in-memory and lost on reload (drafts survive; chips don't) — persist per conversation like the draft ledger.
- **HA-039** [S] No attachment preview (`chat-attach.ts:33-40`) — spec §4.2 "preview, inspect and remove"; add thumbnail/first-lines popover.
- **HA-040** [S] Editor renders Markdown as raw text in preview (`phase412-project-ui.ts:1281`) — wire `renderHermesMarkdown` behind a Preview toggle (spec §4.3).
- **HA-041** [S] Tree rows show generic glyphs; file-type icon map exists but is only used in tabs (`phase412-project-ui.ts:891` vs `1178-1179`) — spec §4.3 "file-type icons".
- **HA-042** [S] Bottom panel collapsible but not resizable (fixed `max-height:40%`, `phase415-workspace.css:279`) — spec §4.3 "collapsible/resizable"; add a drag grip like the sidebar's.
- **HA-043** [S] Workspace dialog lacks Recent Workspaces (`phase412-project-ui.ts:799-813`) — spec §4.3 lists it among dialog contents.
- **HA-044** [S] Two competing current-conversation localStorage keys (`hermes-life-chat-conversation` vs `hermes-life-conversation-id`, `main.v2.ts:583-622` vs `hermes-chat.ts:18`) let the Home composer and Chat tab diverge — unify the key or hand off via `hermes:open-in-chat`.
- **HA-045** [S] "Send file reference" chips carry workspace-relative paths though the worker contract requires absolute host paths (`phase412-project-ui.ts:965` vs `chat-attach.ts:73`) — resolve to `host_path + '/' + path`.
- **HA-046** [S] Attention badge can lag ~75s behind out-of-band resolutions (15s throttle + 60s poll, `attention-center.ts:260-308`) — force refresh on review-resolve/review-decision events.
- **HA-047** [S+V] Nav lists Chat and Projects as peers, not one Chat-menu grouping (`navigation-state.ts:22`, `main.v2.ts:217-226`) — documented intentional deviation from §2; resolve via spec judgment S1 below, not code churn.

## 15. Prioritized Remediation Plan

Dependency-ordered. Each phase: objective, findings, changes, dependencies, risks, preserved functionality, tests, acceptance criteria.

### Phase 0 — Credential and shell exposure (immediate, no dependencies)
- **Objective:** close the live auth bypass and the unauthenticated shell. **Findings:** HA-001, HA-002, HA-031, HA-019.
- **Changes:** rotate gate password (re-derives cookie key, invalidates leaked material); add `HERMES_LIFE_GATE_COOKIE_KEY`; purge `config/*.env` from git history (or burn+re-push) and gitignore them; restrict `/ws/terminal` (capability token/role, env allowlist, or disable publicly); move `/health` topology behind the gate; move the bot token into keys.env.
- **Risks:** rotation logs out the user's own sessions (expected); history purge rewrites the GitHub repo (coordinate).
- **Preserve:** passkey/WebAuthn flows; local dev usability (explicit `GATE_REQUIRED=0` for tests).
- **Tests:** cookie-derivation independence; WS-terminal refusal without capability; `/health` payload shape.
- **Acceptance:** committed hash ≠ live hash; old cookies rejected; unauthenticated `/ws/terminal` connect refused; `/health` leaks nothing.

### Phase 1 — Make the tree bootable and the deployment current (unblocks Phase 2)
- **Objective:** `create_app()` works, suite reflects reality, live backend matches source. **Findings:** HA-003, HA-004, HA-009.
- **Changes:** reorder `Runtime.__init__` (personality before adapters) + regression test; fix schema-test drift (symbolic `SCHEMA_VERSION`, dynamic stub deletion); restart backend; smoke-check routes.
- **Risks:** restart runs `migrate()` to v42 on the live DB (back it up first); the refactor may surface further latent breaks once tests run.
- **Preserve:** current runtime behavior — the running (older) service is the baseline to match.
- **Tests:** `Runtime` instantiation test; schema tests fresh+legacy; full pytest re-baselined.
- **Acceptance:** pytest failures = documented pre-existing only; live `/openapi.json` has dir/move/search/fs-upload; a scratch write emits `file.changed`; D1/D2/D6/D12 verified at runtime.

### Phase 2 — Integration chain correctness (depends on Phase 1 for runtime verification)
- **Objective:** make §4.4's workflows work end-to-end and truthfully. **Findings:** HA-005, HA-006, HA-007, HA-008, HA-012, HA-013, HA-045, HA-044.
- **Changes:** fix `pendingOpen` consumption (HA-005); emit `file.changed` from apply/sync/mkdir producers + refresh-on-apply (HA-006); build the Apply-to-host action on accepted runs (HA-007); per-conversation scope injection (HA-008); accepted-vs-applied labels (HA-012); dirty-buffer preservation on tab switch + background conflict flags (HA-013); absolute-path chips (HA-045); single conversation key (HA-044).
- **Risks:** scope-injection change alters how agent tasks are scoped — keep the user brief's "no permanent project control in composer" while making scope visible (e.g. a chip showing the effective `@project`).
- **Preserve:** Projects→Chat actions and their no-auto-send contract; candidate/review/apply authorization boundaries; `expected_mtime` save guard.
- **Tests:** pendingOpen consumer test (3 link shapes); emission test per producer; apply-label state-machine test; dirty-tab-switch test.
- **Acceptance:** §5 scorecard rows C4–C7 flip to ✅; end-to-end scenario (chat task → apply → explorer/diff update → link opens in Projects) passes.

### Phase 3 — Surface quality (depends on Phase 2 for HA-014's link behavior)
- **Objective:** remove spec-violating chrome and fix composition. **Findings:** HA-010, HA-011, HA-014, HA-017, HA-032, HA-035, HA-036, HA-037, HA-038, HA-039, HA-040, HA-041, HA-042, HA-043.
- **Changes:** `[hidden]` guard (one line); relocate attachment meter; markdown images + artifact chips + artifacts picker; world framing fit; resident inspector kind; name plates; sidebar collapse; attachment provenance/persistence/preview; markdown preview toggle; tree icons; bottom-panel grip; recents.
- **Risks:** CSS/geometry changes can regress pinned layout tests — run `frontend/tests` (currently 400 green) after each.
- **Preserve:** bubble truthfulness contracts, editor dirty/conflict semantics, honest empty states.
- **Tests:** CSS-hidden regression test for split pane; markdown image render test; frameBounds fill assertion.
- **Acceptance:** §5 rows H2, H5, C3, C5, C7 ✅; screenshots show no phantom pane/attachment strip; facility fills the canvas.

### Phase 4 — Bubble correctness and hardening (independent of Phases 0–3)
- **Objective:** fix bubble correlation/redaction and reliability/performance defects. **Findings:** HA-015, HA-016, HA-018, HA-020, HA-021, HA-022, HA-023, HA-024, HA-025, HA-026, HA-027, HA-028, HA-029, HA-033, HA-034, HA-046, HA-030.
- **Changes:** per-ID bubble merge + id preservation; redaction of scheme credentials and multi-word values; gate fail-closed flag, forwarded-IP rate limiting, revocable sessions; ownership-guarded cancel; events indexes + batched commits; single event poller; background sync; extra-roots predicate; pre-decode size checks; PTY reaping; logging baseline; measured bubble clamps; hover details; attention refresh triggers; extraction-validator tuning.
- **Risks:** store/index migration adds small write overhead; token design change logs out sessions again — sequence after Phase 0's rotation.
- **Preserve:** the event schema, watermark/replay semantics, and every pinned bubble test.
- **Tests:** the two headless probes (Basic-auth redaction, two-call correlation) become regression tests; concurrency test for cancel; query-plan assertion for indexed event filters.
- **Acceptance:** probes pass; `/api/events?task_id=` uses an index (EXPLAIN); no zombies after N terminal sessions.

## 16. Resolved and Superseded Findings

Historical record (previous `review.md`, 2026-11-27 earlier revision). **Verified resolved this audit:** D5 (tab/scroll persistence), D7 (draft ledger wired), D9 (Send selection/file reference), D10 (bubble overflow queued), D14/D15/D16 (the three failing frontend tests — suite now 400/0), D17 (single WebSocket).
**Partially resolved (residual re-raised under new IDs):** D1→HA-004/006, D2→HA-004, D4→HA-013, D6→HA-004/037, D8→HA-014, D11→HA-015, D12→HA-004, D13→HA-010/040-043, D18→HA-032.
**Not resolved:** D3→HA-005 (the previous "RESOLVED 2026-11-27" annotation was incorrect — the handler exists but the open path is dead in the common cases).
**Superseded:** the previous review's verification-baseline lines (372/3 frontend; 3/366 backend) — corrected in §4. Its "Bottom line" remediation ordering is superseded by §15.

**Spec judgment (carried forward and updated) — where the doc may be over-specific; recommend relaxing the spec, not building to the letter:**
- **S1 / HA-047 — Nav hierarchy (§2).** "Chat menu with two sibling tabs" vs actual flat "Chat" + "Projects" peers is an intentional documented deviation (`main.v2.ts:84-88` matches the user brief). Functionally equivalent. Update the spec or accept the deviation; don't rebuild nav for grouping alone.
- **S2 — "Three.js world-to-screen projection" (§3.3).** Bubble anchoring uses design-space scaling of renderer head coordinates (`bubbles.ts:1097-1099`) — functionally equivalent. The requirement should say "anchored above the resident's head" and drop the implementation detail.
- **S3 — Bottom-panel tab names (§4.3).** "Changes | Activity | Output" vs actual "Terminal | Changes | Output" — the actual set is arguably better (real PTY; agent activity in Output). Spec already permits terminal "where supported"; it is.
- **S4 — Attach-mode wording (§4.2).** The implementation's reference-vs-upload split is stricter and more honest than the spec's phrasing; upload-without-project has since been delivered (D6) under a hermes-uploads/ policy — clarify in the spec that uploads land under a managed uploads root.

## 17. Verification Results

Commands and results (2026-11-27; this host = application host):

| Check | Command | Result | Method |
|---|---|---|---|
| Frontend build + type-check | `cd frontend && npm run build` | PASS (tsc clean; vite build 2.73s; 1.6MB chunk warning) | executed |
| Frontend tests | `node --import tsx --test tests/*.test.ts` (36 files) | **400 pass / 0 fail** (run twice, incl. by subagents) | executed |
| Backend tests | `env -u HERMES_LIFE_* … ./.venv/bin/python -m pytest tests/ -q` | **159 failed / 231 passed / 13 errors**; 153F+13E = `app.py:99 AttributeError`; residual: entrance_gate 13F (fixture-level — none of the auth logic is currently validated), schema drift 3F, flow004/flow006 (platform venv env issues), worker_migration 1F, startup_safety 1F | executed |
| Event store | read-only sqlite3 `life.db` | 131,737 events; `hermes.text` 116,870 · `tool_use`/`tool_result` 5,554 each · `system` 433 · `result` 389; **zero** `file.*` types; `user_version=41`; hl_* counts as §12 | runtime |
| Live route table | `GET /openapi.json` (ungated) | 137 routes; `/{name}/dir|move|search` and `/api/fs/upload` **absent** from the live process though present in source | runtime |
| Stale-process evidence | `ps -o lstart` vs file mtimes | uvicorn 19:14:19 < app.py 19:22:59 < project_workspaces.py 21:10:19 | runtime |
| Uncommitted-fix provenance | `git diff HEAD -- hermes_life/project_workspaces.py` | `file.changed` emitter + 6 routes are working-tree-only (absent from HEAD) | source |
| HA-001 evidence | `git show 885e6bd:…host.env`, `git merge-base --is-ancestor`, line sha256 compare | hash present in both commits, both on `origin/main`, line hash identical to live keys.env (values never printed) | runtime |
| HA-002 evidence | `sed -n '1520,1541p' app.py` | `fork` + `environ=dict(_os.environ)` + `execve('/bin/bash',…)` | source |
| HA-005/008/010 evidence | targeted greps + CSS block read | single `pendingOpen` consumer at `:1167`; `@project` injection at `:1433-1440`; `#hc415-split{display:flex}` without `[hidden]` guard | source |
| App-host topology | `ps` cloudflared; `curl https://dev.hermeshaplease.com/` | tunnel → vite dev (index shows `/@vite/client`); local probes = host verification | runtime |
| Screenshot inspection | vision analysis ×3 | chat/projects/world states as §6–8 note; phantom pane + attachment strip identified | visual |
| Headless module probes | tsx probes of real bubbles modules | Basic-credential redaction leak; same-tool correlation loss; frameBounds 46.6% width fill | executed |

Not verified (see §18): authenticated end-to-end clicks; passkey/WebAuthn crypto paths; worker-side task execution behavior; Cloudflare-side configuration; the deployed frontend bundle hash vs local build (dev server serves source directly).

## 18. Outstanding Questions and Verification Blockers

1. **Auth wall:** all state-changing runtime verification (login, file ops, applying a candidate, clicking "Files consulted") is blocked without a session; per scope rules no credentials were requested or used. After Phase 0's rotation, a scripted smoke pass behind the gate should confirm HA-004/005/006 acceptance criteria at runtime.
2. **Un-restartable backend (HA-003/004):** live behavior of D1/D2/D6/D12 cannot be exercised until the tree boots and the service is restarted — restart needs authorization (out of audit scope).
3. **`hermes.*` payload executor field:** whether backend payloads carry an explicit executor identity (vs frontend role-mapping) is unverified (the emitter is in the adapter/worker layer); executing-role handling was therefore judged against frontend behavior and spec text.
4. **flow004/flow006 failures** ("Platform environment … interpreter cannot import pytest") look like machine-environment issues on the worker venv; not fully root-caused — flagged, not counted as code regressions.
5. **Spec authority overlap:** `hermesha-life-master-dev-spec.md` (HL-SOT-002) vs `hermesha-ui-ux-obsidian-spec.md` both claim UI/UX + Obsidian territory; this audit used the unified spec as instructed, deferring memory/autonomy/DB questions to the master spec. The overlap remains an open documentation decision.
6. **Rate-limit/proxy header behavior (HA-020)** is inferred from code + topology; the Cloudflare configuration itself was not inspectable.

## 19. Final Assessment

Hermesha's foundation is real and largely spec-shaped: truthful event-driven presentation, one conversation store, one event stream, a genuine IDE with strong path containment, honest operational state, and a green 400-test frontend suite. The previous audit's remediation push landed most of its targets — 8 findings verified fully resolved and 9 more materially advanced.

What keeps this from being a healthy codebase today is concentrated and actionable: two live security exposures (HA-001/HA-002) that must be closed before anything else; a single use-before-init line (HA-003) that makes the backend tree un-bootable and its suite meaningless; the resulting stale deployment (HA-004) that turns several "RESOLVED" claims into source-only truths; and a broken integration seam (HA-005/006/007/008) where the §4.4 promises — links that open, events that flow, candidates that can be applied, conversations that keep their scope — currently fail end-to-end.

None of these are architectural dead ends. The fixes are small in surface area (one constructor reorder, one CSS guard, one handler-consumer reordering, event emission at three call sites, one apply action) and the remediation order in §15 is dependency-correct: credentials first, then bootability/deployment, then the integration chain, then surface quality and hardening. With Phases 0–2 executed, the §5 scorecard should reach full compliance on the "Chat and Projects" and "Operational consistency" groups; the remaining 🟡 items are composition and polish, not capability gaps.

---

*Spec judgment S1–S4 recorded at the end of §16. Audit conducted read-only: no application source, spec, service configuration or database was modified; no services restarted; no credentials accessed or printed. This file (`review.md`) is the only file changed.*
