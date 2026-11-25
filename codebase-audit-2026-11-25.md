# Hermes Life — codebase audit: redundancies, deprecated files, contradicting logic

**Type:** AUDIT — point-in-time codebase assessment; findings are inputs, not requirements

**Date:** 2026-11-25 · **Revision audited:** `main @ da77725` (57 commits, 366 tracked files)
**Scope:** everything in `/home/gayzer/Apps/hermes-life` except `.venv/`, `frontend/node_modules/`, `.git/` internals.
**Status:** REPORT ONLY — nothing was deleted, moved, renamed or edited except this file.

---

## How this was done (so every claim can be re-run)

| check | method |
|---|---|
| What exists | three-source inventory: `git ls-files` vs `git ls-files --others --exclude-standard` vs `find` on disk |
| What is reached | **import-graph BFS** from the real entry points — frontend: `frontend/index.html` links + `src/main.v2.ts`; backend: `hermes_life/app.py` (+ any importer outside the package) |
| Who imports what | resolved every specifier form (`from '…'`, bare `import '…'`, dynamic `import()`, `@import`, relative `.foo`, `/src/…`) |
| Doc authority | each document's own header, Document ID and Status line |
| Commits | `git log --format` scanned for template/empty messages |

Two earlier passes in this session produced **wrong** orphan lists. Both bugs are noted because they are the kind of error that turns an audit into a demolition order:

1. A regex that only matched `import … from '…'` missed bare side-effect imports (`import './hermes-chat'`) → 43 false orphans (it flagged the live chat module).
2. A Python matcher that required `hermes_life.` prefixes missed relative imports (`.autonomy`) → 12 false "dead" backend modules.

Both were caught by cross-checking against a second method before reporting. The numbers below are from the corrected passes.

---

## Verdict

The **code is in much better shape than the tree around it.** The live surfaces are coherent:

- Backend: **40 of 41** modules reachable from `app.py`. **Zero** dead modules. 113 routes.
- Frontend: **66 of 75** modules reachable from the live entry. The 9 that are not are all either the retired v1 app, orphaned CSS, or literal backup files.
- Tests: 351 frontend, 366 backend passing (3 known pre-existing failures; see §5).

The actual problem is **accumulated debris and duplicated surfaces**, not broken logic: 12 backup trees, 3 dead virtualenvs (447 MB), a fully retired duplicate frontend entry, two chat stylesheets fighting over the same selectors, two launcher scripts, two live memory subsystems, and a documentation set where three documents claim the same territory.

Debris is ~**29 MB of tracked junk** (34.8 MB of tracked blobs total) plus ~**450 MB** of untracked local weight, and **18 of 57 commits carry the git template as their message**, which is why the history no longer explains the tree.

---

## 1. Dead code and orphaned files

### 1.1 The retired v1 frontend — a complete, self-contained dead app

`frontend/index.v1.html` + `frontend/src/main.ts` (357 lines) is the pre-`v2` application. It is reachable from **nothing**, and it is the *only* importer of four more files:

```
frontend/index.v1.html                       12 K   (nothing links to it anywhere)
frontend/src/main.ts                         20 K   (the v1 entry)
frontend/src/phase44-layout.ts              1.7 K   imported only by main.ts
frontend/src/phase44-layout.css             2.8 K   imported only by main.ts
frontend/src/phase45-world-layout.css       4.3 K   imported only by main.ts
frontend/src/phase46-world-status.css       1.2 K   imported only by main.ts
```

This is **not a discovery** — the repo's own `UUX-004A-INVENTORY.md` (2026-11-10) already labels `main.ts` *"Legacy (old main.ts, not in v2)"*. It was catalogued seven weeks of development ago and then left in place; every later "main.ts" reference in the docs is describing a file that has been dead since v2 landed.

**Risk of keeping it:** it is load-bearing for nothing, but it *looks* load-bearing — `liveagent.md` cites `frontend/src/main.ts` as if current, and the v1/v2 pair makes every grep for `main.` ambiguous.

### 1.2 Orphaned stylesheets and pages (loaded by nothing)

```
frontend/src/work-workspace.css              0.3 K   imported by NOTHING at all
frontend/src/phase46-world-status.css        1.2 K   (see 1.1)
frontend/src/task-detail.html                1.0 K   no referrer
```

`work-workspace.css` is the sharpest one: `work-workspace.ts` (42.8 K, very much alive) imports no stylesheet — so this file is either a forgotten import or a stale copy of styling that now lives in `unified-layout.css` / `phase415-workspace.css`.

### 1.3 Backup files committed *inside* `src/` and the frontend root

```
frontend/src/command-centre.css.backup-world-height-20261111-020709-075637   8.0 K
frontend/src/unified-layout.css.before-scroll-fix-20261110-180931            40 K
frontend/index.html.pre-hermesha-ux-20261123.bak                             40 K
```

All three are **tracked** (so recoverable from history), all three shadow a live file, and the `.before-scroll-fix` one is 40 KB of obsolete layout rules sitting one directory away from the real `unified-layout.css`. A `find` for CSS will surface them forever.

### 1.4 A dead Vite config

```
frontend/vite.config.ts     (Oct 29, 222 bytes)  ← DEAD, wins nothing
frontend/vite.config.js     (Nov 21, 354 bytes)  ← the one actually used
```

Vite resolves `vite.config.js` before `vite.config.ts`. Two configs with the same purpose means any tweak to the `.ts` one silently does nothing.

### 1.5 Backend: none

Worth stating plainly because it is the reassuring half of this audit: **every one of the 41 backend modules is imported**, directly or transitively, from `app.py` or an external consumer. The `phrase` modules that *look* like a previous generation (`formulation.py`, `investigation.py`, `discovery.py`, `reflection.py`, `decision.py`) are all live parts of the autonomy loop, imported by `app.py` and driven by routes.

---

## 2. Redundancies — two of everything

### 2.1 Two launcher scripts with different behaviour

| | `start.sh` (2.4 K, Nov 25) | `hermes-life.sh` (8.5 K, Nov 21) |
|---|---|---|
| starts | backend only | backend **and** frontend |
| venv | creates `.venv` if missing; refuses to start if the app can't import | expects it to exist |
| pid handling | none (blocks the shell) | `.run/*.pid` + `start/stop/restart/status` |
| logs | stdout | `.run/logs/{backend,frontend}.log` |

Both are documented, both are used. `hermes-life.sh` is the better tool and the one the docs describe; `start.sh` is what the running backend was actually started from. Two entry points that differ in *whether the frontend comes up* is exactly the drift that costs an hour the next time someone "just restarts it".

### 2.2 Two chat stylesheets fighting, at equal specificity

`hermes-chat.ts` imports them in this order:

```ts
import './hermes-chat.css';    // 1
import './chat-upgrade.css';   // 2   (HL-CHAT-002)
import './chat-clarity.css';   // 3   (HL-CHAT-002B)
```

and both of the last two declare the **same selector with identical specificity**:

```
chat-upgrade.css  : #hc-panel .hc-bubble.assistant .hc-body { background: transparent; border-color: transparent; padding: 10px 3px; font-size: 15px; line-height: 1.66 }
chat-clarity.css  : #hc-panel .hc-bubble.assistant .hc-body { background: rgba(16,39,53,.54); border: 1px solid rgba(115,173,190,.20); padding: 12px 16px; font-size: 17px; line-height: 1.76 }
```

Because `chat-clarity.css` is imported last it wins — so **`chat-upgrade.css`'s declarations for that selector are dead letters**, while its other rules (`#hc-panel .hc-bubble.user .hc-body { font-size: 15px }`, `max-width: 97%` on the bubble) partially survive because nothing overrides them. The result is a stylesheet that *reads* as authoritative, is silently ~80 % overridden, and whose remaining 20 % still applies.

This is the **same failure mode** as the fresh `#hc-threads button { width: 100% }` trap hit earlier today: two rules, equal specificity, order decides. There is no comment in either file saying which is current.

### 2.3 Two conversation renderers, two tool-activity formatters

| module | lines | what it is |
|---|---|---|
| `hermes-chat.ts` | 774 | the canonical chat (invariant: chat state lives here) |
| `conv-thread.ts` | 246 | a **second** chronological conversation view, reading `/api/conversations/{id}/turns` **and** `/api/events?correlation_id=` |
| `trace-format.ts` | 155 | tool call → one-line statement ("the Hermes CLI shape") |
| `tool-group.ts` | 356 | tool_use/tool_result **grouping** (UI-VIS-007 §8) |

`conv-thread.ts` renders the same underlying data as the chat through a completely separate code path (it is used by the Work workspace). The `SKILL` invariant for this repo says *"chat state lives only in hermes-chat.ts… never fork a second chat instance"* — `conv-thread.ts` is a second renderer of conversations, not a reparent of the canonical one. That may be a deliberate Work-tab decision, but it is a second source of truth for "what a conversation looks like" and it duplicates the tool-grouping concern that `tool-group.ts` also owns.

### 2.4 Two live memory subsystems, both writing the Obsidian vault

| | `vault_memory.py` (328 lines, `PHASE49_VAULT_MEMORY`) | `memory_service.py` (445 lines, `P4_OBSIDIAN_ADAPTER`) |
|---|---|---|
| writes to | `<vault>/Hermes-Life/Memory/Auto/<kind>/<id>.md` | `<vault>/<caller folder>/<slug>.md` |
| backing tables | `hl_memory_extraction_runs`, `hl_memory_reviews` | its own note index |
| model | extract from completed tasks → review queue → mirror + retire superseded | generic read/write/list/watch with revisions + conflict detection |
| routes | `/api/memory*` | `/memory/*` |
| live? | **yes** — `app.py` calls `extract_completed` on task completion, `retrieve_notes` during recall | **yes** — `add_memory_routes` |

Both are current, both are wired, and they overlap in concept while diverging in path convention, table design and API prefix. Note the layout asymmetry: `vault_memory` and `conversation_memory` write **under `Hermes-Life/`**, while `memory_service.create_note()` builds `vault_root()/<folder>/<slug>.md` — i.e. relative to the **vault root**, which can land a note outside the `Hermes-Life/` tree the spec says to build on. Whether that happens depends entirely on what folder the caller passes.

### 2.5 One and a half spec documents too many

| file | self-declared identity |
|---|---|
| `hermesha-life-master-dev-spec.md` (112 K, Nov 23) | **Document ID HL-SOT-002**, Status: *"Normative product specification and development roadmap"*; §27 claims to be *"The complete UI/UX and Obsidian wiring contract"*; explicitly supersedes HL-SOT-001's stale claims |
| `hermesha-ui-ux-obsidian-spec.md` (20 K, Nov 24) | Status: *"Proposed design specification; implementation and existing Obsidian integration are not verified"* — **the document the recent UI work was implemented against** |
| `hermesha.md` (24 K, Nov 23) | narrative vision doc ("A Living Autonomous AI Environment"); overlaps the master spec's §1 |
| `chatuireview.md` (60 K, Nov 25) | "UI/UX AUDIT V2" — supersedes `convo-redesign.md` (20 K, Nov 9) |

So the **newest** UI/UX document is *Proposed*, while the *Normative* one claims the same territory in §27. Nobody has said which wins — and my own project notes still claimed a third file (`HERMES_LIFE_DEV_SPEC.md`, HL-SOT-001) was authoritative, which is now doubly wrong (wrong status *and* wrong filename).

Also unresolvable from the tree: whether `convo-redesign.md`, `liveagent.md`, `autonomy.md`, `hermes-personality.md`, `UI-VIS-002…md`, `UUX-004A-INVENTORY.md` are **records** (keep) or **active specs** (now superseded). `UUX-004A-INVENTORY.md` in particular is a Nov-10 audit whose subject matter (the `main.ts` navigation) has since been deleted.

---

## 3. Contradicting logic

### 3.1 The renderer seam documents a world that no longer exists (code vs. its own docstring)

`frontend/src/town-renderer.ts` — the module every town consumer talks to — opens with:

> *"Two implementations satisfy the interface… `town-renderer-3d.ts` (the 3D facility) and `town-renderer-static.ts` (a static label view)… D1 retired the pixel-art renderer, so **there is only ever one 3D implementation**."*

The file then imports **three** renderers and selects between them:

```ts
export function createTownRenderer(host, opts) {
  if (supportsWebGL2()) {
    try { return createV2Renderer(host, opts); } catch (e) { console.warn('v2 unavailable', e); }
    try { return create3DRenderer(host, opts); } catch (e) { console.warn('3D unavailable', e); }
  }
  return createStaticRenderer(host, opts);
}
```

So the shipped behaviour is: **v2 (1437 lines, the from-scratch scene) → 3D (950 lines) → static (105 lines)**, while the header comment describes a two-way choice that was true at some earlier revision. Two further consequences:

- **`RendererKind = '3d' | 'static'` is now a lie in one direction.** v2 must report one of those two kinds, so *nothing can tell v2 and the legacy 3D renderer apart* — including the acceptance tests and any future telemetry.
- **950 lines (`town-renderer-3d.ts`) are reachable only if v2 *throws*.** That is a legitimate crash fallback, but it is also a full second 3D implementation of the same feature, maintained in parallel, exercised by `tests/town-renderer.test.ts` and never by users. That is the single biggest redundancy in the frontend and it needs a decision, not a cleanup: keep it as a deliberate fallback (and say so in the header), or retire it and let the static view be the only fallback.

### 3.2 Equal-specificity CSS pairs (see §2.2)

`chat-upgrade.css` vs `chat-clarity.css` — the loser is still half-applied. Same class of bug as the `#hc-threads button` incident.

### 3.3 Documentation that contradicts the code it describes

- `liveagent.md` cites `frontend/src/main.ts` as a live module — dead since v2.
- `UI-VIS-002…md` and `UUX-004A-INVENTORY.md` describe the v1 hash-tab navigation that no longer exists.
- `hermesha-ui-ux-obsidian-spec.md` is headed *"implementation … not verified"* while most of it now **is** implemented (P1–P4 landed) — so a reader cannot tell from the doc what is done.
- My own note that HL-SOT-001 / `HERMES_LIFE_DEV_SPEC.md` is authoritative: **wrong on both counts.**

### 3.4 `.gitignore` does not actually cover the things it looks like it covers

```gitignore
.venv/        # matches exactly ".venv" — NOT .venv-broken, .venv-broken-gayzer, .venv-lenovo-backup
node_modules/ # matches the root skeleton, not frontend/node_modules (that works only because
              # frontend/node_modules/.package-lock.json is itself ignored)
```

The three dead virtualenvs (447 MB) are invisible to `git status` only because **a virtualenv ships its own `.gitignore` containing `*`** — not because this repo ignores them. That is luck, not hygiene: any tool that writes into them differently, or any `git add -f`, and 447 MB walks into history.

Conversely the backup trees *are* tracked (§4.1), so `.gitignore` is simultaneously too permissive and too strict depending on the directory.

### 3.5 The vault has no single writer convention

Four modules write into the vault: `vault_memory` (`Hermes-Life/Memory/Auto/<kind>/`), `conversation_memory` (`Hermes-Life/Conversations/`), `memory_service` (`<vault_root>/<folder>/`), `project_knowledge` (reads a **hardcoded** `CURRENT_ISSUES_01.md` for the project named `hermes-life`). Three path conventions and one hardcoded project name. The vault is the user's own Obsidian library — 301 notes under `Hermes-Life/` — so this is the highest-consequence inconsistency in the backend.

---

## 4. Repo hygiene: what is committed that should not be

### 4.1 Twelve backup trees are tracked, not ignored

```
.hermesha-phase2-backups/  .hermesha-phase3-backups/  .hermesha-phase4-backups/
.hermesha-phase5-backups/  .hermesha-knowledge-stage-a-backups/
.hermesha-vis007-backups/  .hermesha-vis008-backups/  .hermesha-vis009-backups/
.hl-chat-002-backups/      .hl-chat-002-clarity-backups/  .hl-chat-002-rescue-20261121-084450/
Hermes_Life_HL-CHAT-002_Patch_Packet/
```

**47 files on disk, 39 of them tracked**, dated Nov 9–21. They are copies of `frontend/src/*`, `hermes_life/*.py` etc. taken before risky edits. Because they are tracked they are recoverable from history — none of this is at risk of loss. `.git/info/exclude` already half-attempts this job (`*.before-phase411-*`) but the directories themselves are not covered.

Also: `Hermes_Life_HL-CHAT-002_Patch_Packet/` (80 K, a shipped patch packet with its own `install.py` and `tests/`), `.hermesha-phase5-installed` (a 48-byte marker).

### 4.2 Runtime state and screenshots are committed

```
.run/            6 files, 7.2 MB TRACKED   ← backend.pid, frontend.pid, logs/*.log
screenshots/    40 files,  12 MB TRACKED   ← 40 PNGs incl. screenshots/uipics/*
study/TLCL-25.12A.pdf           6.3 MB TRACKED  (the Linux Command Line manual — the study corpus)
Hermetic Celestial Alchemy Doors-2.png  3.8 MB TRACKED  (the entrance-gate image — LIVE, referenced by config)
image.png / "image copy.png" / "image copy 2.png"   1.0 MB TRACKED  (session screenshots)
phase6-reports/         5 files, 1.6 MB TRACKED  (PNG evidence + report)
scripts/ one-shot probes: m1_install_check.py, m1_real_model_check.py, m2_real_model_check.py,
  flow003-remote-scan.py, _vm_extract_handbook.py
```

Committing `.run/logs/backend.log` and `*.pid` means every single commit carries a diff of rotating runtime noise — visible in the history: **every one of the last 15 commits modifies `.run/`.** It trains everyone (and every agent) to ignore the most meaningful repository signal there is, `git status`.

### 4.3 Local-only weight (untracked, safe, but 450 MB)

```
.venv-broken          288 MB  (devshare-owned, Nov 21)  — dead
.venv-broken-gayzer    83 MB  (Oct 29)                  — dead
.venv-lenovo-backup    76 MB  (Nov 21)                  — dead
node_modules/ (root)  444 KB  — empty skeleton; the real tree is frontend/node_modules (113 MB, live)
.venv                 100 MB  — LIVE (the backend runs from ./.venv/bin/python)
frontend/dist/        1.1 MB  — build output
.pytest_cache/, __pycache__/, hermes_life.egg-info/  — regenerated
```

### 4.4 Commit messages carry no information

**18 of 57 commits have the git template as their subject line**, including the two most recent:

```
da77725 2026-11-25  #     # Changes to be committed:     #    modified:   .run/backend.pid  ...
aaabb6e 2026-11-24  # Please enter the commit message for your changes. ...
21da757 2026-11-24  # Please enter the commit message for your changes. ...
```

This is what makes the "a lot of old stuff still lingers" feeling structural rather than cosmetic: the history cannot answer *why* anything changed, so nothing can be safely assumed dead on the strength of its own record.

---

## 5. Verified healthy — do NOT "clean" these

Stated so that a future cleanup pass does not over-reach:

- **The whole Python package** — 40/41 modules live, zero orphans, 113 routes.
- **`hermes_life/world.py`** (42 lines) — tiny but imported and live; not a stub.
- **`frontend/src/style.css`** (190 lines) — looks like a prototype leftover, and *is*, but it is still linked by `index.html` and its bare-element rules are load-bearing (they are now guarded with `:where(:not(#hermes-chat-root *))`). Removing it without reading it will change the shell.
- **`frontend/harness/*.html`** (60 K) and **`frontend/fixtures/`** (16 K) — these are the user's own verification fixtures, deliberately kept. The harness pages are how UI states get inspected without the gate.
- **`Hermetic Celestial Alchemy Doors-2.png`** — referenced by `HERMES_LIFE_GATE_IMAGE`; it is the live gate artwork, not an orphan image.
- **`study/TLCL-25.12A.pdf`** — the reference-library corpus the Study feature serves.
- **`config/*.env`, `.venv/`, `frontend/node_modules/`** — live or regenerable, never in scope.
- **The 3 backend test failures** — pre-existing and environmental, not regressions: `test_entrance_gate::test_gate_blocks_api_and_unlocks_with_password`, `test_flow004_evaluator::test_guest_uses_candidate_virtualenv`, `test_flow006_revision_guest::test_revision_guest_test_step_runs_against_the_platform_environment`. Note when re-running: the suite must have the ambient `HERMES_LIFE_*` variables stripped or 11 extra `test_worker_migration` tests fail spuriously (`HERMES_LIFE_GUEST_HOME=/home/glenn` vs the asserted `/home/hermes` default).

---

## 6. Suggested order of operations

Nothing here needs to be done in one pass, and none of it touches behaviour except where noted.

**Tier 1 — dead, tracked, zero behaviour change (≈ 100 KB, 8 files)**
1. Delete the retired v1 app cluster: `index.v1.html`, `src/main.ts`, `src/phase44-layout.ts`, `src/phase44-layout.css`, `src/phase45-world-layout.css`, `src/phase46-world-status.css`.
2. Delete the three in-src backup files (§1.3) and `src/work-workspace.css`.
3. Delete `frontend/vite.config.ts`.
4. Add ignore rules for `*.backup-*`, `*.before-*`, `*.bak`, `.run/`, `screenshots/` so the pattern cannot come back.

**Tier 2 — hygiene that needs a decision (no code risk, big repo win)**
5. `git rm -r --cached .run screenshots` (keep on disk) — stops 19 MB of pid/log/PNG churn polluting every commit. **Do `.run/` first: it is the one poisoning `git status`.**
6. Remove the 12 backup trees from tracking (or from disk — they are in history either way).
7. Delete the three dead virtualenvs (447 MB, untracked, local-only) and the empty root `node_modules/`.
8. Start writing commit messages (`git commit -m`); the last 18 commits are anonymous.

**Tier 3 — judgement calls that should be *decided*, not tidied**

9. **The specs (§2.5).** Which document governs — HL-SOT-002 (Normative) or `hermesha-ui-ux-obsidian-spec.md` (Proposed, newer)? Then merge or mark the loser; and mark `convo-redesign.md` / `UUX-004A-INVENTORY.md` / `UI-VIS-002…md` as historical records rather than plans.
10. **Two launchers (§2.1).** Pick one (I'd keep `hermes-life.sh`) and make the other a thin alias, or delete it.
11. **The two chat stylesheets (§2.2).** Merge into one file, or keep whichever is current and delete the overridden declarations from the other — leaving both is what produces the next invisible CSS bug.
12. **The legacy 3D renderer (§3.1).** Decide: deliberate crash fallback (then fix the docstring and give v2 its own `RendererKind`), or retire the 950 lines.
13. **The two memory subsystems (§2.4).** Not urgent, but they will keep diverging; decide whether `memory_service` is the future (and `vault_memory` becomes its extraction pipeline), and fix `memory_service`'s write root so all vault writes stay under `Hermes-Life/`.
14. **`conv-thread.ts` vs `hermes-chat.ts` (§2.3).** Decide whether the Work tab's thread view is a sanctioned second presentation or should be folded into the canonical chat.

---

## Appendix — evidence commands

```bash
# reachability (frontend): BFS from index.html links + main.v2.ts
# (resolve '…', bare import, dynamic import(), @import, relative, /src/…)

# reachability (backend)
grep -rE '^\s*from\s+(\.*)([\w\.]*)\s+import|^\s*import\s+([\w\.]+)' hermes_life/app.py

# three-source inventory + recoverability
git ls-files | wc -l ; git ls-files --others --exclude-standard | wc -l
git check-ignore -v .venv-broken ; cat .git/info/exclude

# what is tracked that should not be
git ls-files screenshots .run | wc -l
git ls-files | grep -cE 'backups?/|\.bak$|\.before|\.backup|pre-hermesha'   # → 39

# commit-message hygiene
git log --format="%s" | grep -c "Please enter the commit message"           # → 18

# the CSS collision
grep -n "hc-bubble.assistant .hc-body" frontend/src/chat-upgrade.css frontend/src/chat-clarity.css

# the renderer seam vs its docstring
sed -n '1,20p;100,122p' frontend/src/town-renderer.ts
```
