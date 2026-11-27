/**
 * Chat interface audit — layout contracts.
 *
 * The audit's core finding: on the dedicated Conversations page the chat was
 * presented as a floating window (capped width, permanently expanded provider
 * metadata, duplicated controls) instead of as the workspace. These checks pin
 * the fixes so the layout cannot silently regress to the reviewed state.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src');
const layout = readFileSync(join(src, 'unified-layout.css'), 'utf8');
const chat = readFileSync(join(src, 'hermes-chat.ts'), 'utf8');
const chatCss = readFileSync(join(src, 'hermes-chat.css'), 'utf8');
const clarity = readFileSync(join(src, 'chat-clarity.css'), 'utf8');

const focusRoot = () => {
    const at = layout.indexOf('#hermes-chat-root.in-focus-host {');
    return layout.slice(at, layout.indexOf('}', at));
};

test('§1 the Conversations page is the workspace, not a capped floating window', () => {
    assert.match(focusRoot(), /max-width:\s*none/, 'the focus surface must not be width-capped');
    assert.ok(!/max-width:\s*960px/.test(focusRoot()), 'the 960px floating-window cap must be gone');
});

test('§1 prose keeps a reading measure while technical output breaks out', () => {
    // The reading measure belongs on the body, not on the whole surface.
    assert.match(clarity, /\.hc-body[^{]*\{[^}]*max-width:\s*76ch/);
    // Code / diffs / tables must be allowed past it.
    assert.match(clarity, /:has\(pre\)[^{]*\{[^}]*max-width:\s*min\(100%,\s*1180px\)/);
    assert.match(clarity, /\.hc-body pre\s*\{[^}]*overflow-x:\s*auto/);
});

test('§2 the composer is three areas: text entry / tools row / action row (V2 audit §3)', () => {
    // The user's V2 audit (chatuireview.md §3/#13/#14) superseded the in-composer
    // telemetry strip: model configuration and usage detail live behind compact
    // controls on the action row, and the dashboard rows are gone.
    assert.match(chat, /class="hc-composer-actions"/);
    assert.match(chat, /id="hc-model-button"/);
    assert.match(chat, /id="hc-usage-chip"/);
    // User redesign 2026-11-25: the composer carries NO project control — the
    // attach chips row replaced the project slot.
    assert.match(chat, /id="hc-attach-chips"/);
    assert.ok(!/hc-project-slot/.test(chat), 'the project slot is gone from the chat');
    // The dashboard rows and their duplicates are gone.
    assert.ok(!/hc-composer-foot/.test(chat), 'the foot is replaced by the action row');
    assert.ok(!/hc-composer-hint/.test(chat), 'the keyboard hint moved to the Send tooltip');
    assert.ok(!/hc-composer-context/.test(chat), 'the project pill is replaced by the Project selector');
    assert.ok(!/hc-model-row/.test(chat) && !/hc-context-row/.test(chat), 'no dashboard rows');
    // The selects survive as hidden state holders — one set, still wired.
    assert.match(chat, /modelBar\.hidden=true/);
    assert.equal((chat.match(/id="hc-provider"/g) || []).length, 1);
    // Popovers toggle via the hidden attribute WITH an explicit display override —
    // the author-display-beats-[hidden] trap that broke the workspace tabs.
    assert.match(chatCss, /#hc-model-popover\[hidden\],#hc-usage-popover\[hidden\]\{display:none!important\}/);
    // The attach menu and chips carry the same guard (their own display rules).
    assert.match(chatCss, /#hc-attach-menu\[hidden\]\{display:none!important\}/);
    assert.match(chatCss, /#hc-attach-chips\[hidden\]\{display:none!important\}/);
});

test('§3 the scroll region has a floor and the event log can shrink', () => {
    assert.match(chatCss, /#hc-messages\s*\{[^}]*min-height:\s*140px/);
    assert.match(chatCss, /#hc-events\s*\{[^}]*flex:\s*0 1 auto/);
});

test('§4/§5 the head names the thread and paints it when the thread changes', () => {
    assert.match(chat, /id="hc-thread-title"/);
    assert.match(chat, /function paintThreadTitle\(\)/);
    // Painted on both entry paths: a thread click and every render.
    assert.match(chat, /restoreChatSelection\(\);paintThreadTitle\(\)/);
    assert.match(chat, /const thread=conversationId;\s*paintThreadTitle\(\)/);
    // The product name must not be the heading any more.
    assert.ok(!/<strong>Hermes<\/strong>/.test(chat), 'the head must not lead with the product name');
});

test('§7 account actions live in the global topbar (V2 audit #11)', () => {
    assert.ok(!/hc-account/.test(chat), 'the chat header Account menu is gone');
    const html = readFileSync(join(dirname(src), 'index.html'), 'utf8');
    assert.match(html, /id="topbar-logout"/, 'Logout is topbar furniture');
    assert.match(html, /id="topbar-passkey"/, 'Passkey enrolment moved to the topbar too');
    // …and the chat module wires the enrolment to the topbar button.
    assert.match(chat, /getElementById\('topbar-passkey'\)/);
});

test('§7/§8 Close and Expand are gone, not merely hidden', () => {
    // Chat audit §8: the floating assistant is retired, so these controls do not
    // exist at all. A rule that hides them would reintroduce the two-presentation
    // model the retirement removed.
    assert.ok(!/id="hc-close"/.test(chat), 'the Close control must not exist');
    assert.ok(!/id="hc415-expand"/.test(chat), 'the Expand control must not exist');
    assert.ok(!/hc415-expand/.test(readFileSync(join(src, 'phase412-project-ui.ts'), 'utf8')),
        'the Expand control must not be created either');
    assert.ok(!/hc-close/.test(layout) && !/hc415-expand/.test(layout),
        'no rule may mention the retired controls');
    assert.ok(!/hc415-fullscreen/.test(readFileSync(join(src, 'phase415-workspace.css'), 'utf8')),
        'the fullscreen presentation must be gone');
});

/* ---------------------------------------------------------------- §9 composer */

test('§9 the composer is a box with a tools row and an action row', () => {
    assert.match(chat, /class="hc-composer-box"/);
    assert.match(chat, /class="hc-composer-tools"/);
    assert.match(chat, /class="hc-composer-actions"/);
    assert.match(chatCss, /\.hc-composer-box\s*\{[^}]*flex-direction:\s*column/);
});

test('§9A/§9B the input grows with the prompt and is capped', () => {
    assert.match(chat, /function autogrow\(\)/);
    assert.match(chat, /addEventListener\('input',\(\)=>\{saveChatDraft\(\);autogrow\(\)\}\)|addEventListener\('input',autogrow\)/);
    // Capped so a long prompt cannot swallow the conversation.
    assert.match(chat, /Math\.min\(box\.scrollHeight,\s*cap\)/);
    // Multiline stays discoverable — the convention moved to the Send tooltip
    // (V2 audit #32) — and Enter must keep sending.
    assert.match(chat, /Shift\+Enter adds a new line/);
    assert.match(chat, /e\.key==='Enter'&&!e\.shiftKey/);
});

test('§9F Send becomes Stop while a task runs, and Stop is clickable', () => {
    const at = chat.indexOf('function setRunning(');
    const fn = chat.slice(at, chat.indexOf('\n}', at));
    assert.match(fn, /dataset\.mode=running\?'stop':'send'/);
    assert.match(fn, /send\.disabled=false/, 'Stop must not be disabled');
    assert.match(chat, /dataset\.mode==='stop'[\s\S]{0,80}hc-stop'\)\.click\(\)/);
});

test('§9D/§9E one project control, one model selector, one usage chip', () => {
    // User redesign 2026-11-25: the chat is NOT pre-attached to a project — the
    // composer's Attach is a self-contained menu (chat-attach.ts), not a handoff
    // to the project surface, and the project selector lives in the Project tab.
    assert.match(chat, /import \{ initChatAttach, chatAttachmentBlock, clearChatAttachments \} from '\.\/chat-attach'/);
    assert.match(chat, /initChatAttach\(\)/);
    assert.match(chat, /chatAttachmentBlock\(\)/, 'the send path prepends the attachment references');
    assert.match(chat, /clearChatAttachments\(\)/, 'attachments clear after a successful send');
    assert.ok(!/hc-attach'\)\.onclick[\s\S]{0,90}hc415-files-button/.test(chat), 'no Attach→project-tab handoff');
    assert.ok(!/hc-composer-context'/.test(chat), 'the delegating pill is gone');
    const project = readFileSync(join(src, 'phase412-project-ui.ts'), 'utf8');
    assert.ok(!/hc-project-slot/.test(project), 'phase412 no longer mounts into the chat composer');
    // ...and only one set of selects exists.
    assert.equal((chat.match(/id="hc-model"/g) || []).length, 1);
});

test('§9 the composer offers no control for a capability that does not exist', () => {
    // There is no custom-command feature in the web UI, so / Commands is absent.
    assert.ok(!/\/ Commands/.test(chat), 'do not expose a non-existent command menu');
    assert.ok(!/id="hc-commands"/.test(chat));
});

test('§9D the composer chips resolve class-only controls', () => {
    // phase412's button(label, className) helper sets a CLASS, not an id, so an
    // id-only lookup made the Attach and Workspace chips silently inert.
    assert.match(chat, /document\.querySelector<HTMLElement>\('\.'\+id\)/);
    const project = readFileSync(join(src, 'phase412-project-ui.ts'), 'utf8');
    assert.match(project, /b\.className=className/, 'the helper assigns className');
    assert.match(project, /button\('🗂 Files','hc415-files-button'\)/);
});

/* ---------------------------------------------------- §6 thread sidebar */

test('§6 conversation history is a column, not a button', () => {
    assert.ok(!/id="hc-history"/.test(chat), 'the history toggle must be gone');
    assert.ok(!/hc-history/.test(chat), 'and its handler with it');
    assert.match(chat, /id="hc-thread-sidebar"/);
    assert.match(chat, /id="hc-thread-filter"/);
    assert.match(chat, /id="hc-new"/, 'New chat moves into the column that owns history');
    // the panel is a row: history | conversation | (optional) file inspector
    const at = layout.indexOf('#hermes-chat-root.in-focus-host #hc-panel {');
    const rule = layout.slice(at, layout.indexOf('}', at));
    assert.match(rule, /flex-direction:\s*row/);
    assert.match(layout, /#hc-thread-sidebar\s*\{[^}]*flex:\s*0 0 280px/);
    assert.match(layout, /\.hc-main\s*\{[^}]*flex-direction:\s*column/);
});

test('§6 threads are grouped by day, marked when current, and filtered locally', () => {
    // The derivation lives in a pure module so the harness can drive the same
    // functions the sidebar renders through.
    const groupsSrc = readFileSync(join(src, 'thread-groups.ts'), 'utf8');
    assert.match(groupsSrc, /function dayBucket\(/);
    assert.match(groupsSrc, /return 'Today'/);
    assert.match(groupsSrc, /return 'Yesterday'/);
    assert.match(chat, /groupThreads\(threadCache,/);
    assert.match(chat, /hc-thread-group/);
    assert.match(chat, /setAttribute\('aria-current','true'\)/);
    // Search must filter the cache, not re-hit the API per keystroke.
    assert.match(chat, /hc-thread-filter'\)\.addEventListener\('input',renderThreadList\)/);
});

test('§6 project files are the Project tab, not a cramped chat sidebar', () => {
    // Phase 1 redesign (2026-11-26): the Conversations workspace heading and
    // Chat/Project tabs are removed. The IDE is the primary layout — the project
    // host is a direct child of the workspace section with no enclosing header
    // or tab bar. Registration and directory discovery must live in the dialog,
    // never permanently in the rail.
    const html = readFileSync(join(src, '..', 'index.html'), 'utf8');
    assert.ok(!/id="conv-tab-chat"/.test(html), 'Chat tab button removed — Chat/Project tab bar gone');
    assert.ok(!/id="conv-tab-project"/.test(html), 'Project tab button removed — IDE is the primary layout');
    assert.match(html, /id="project-focus-host"/);
    const ui = readFileSync(join(src, 'phase412-project-ui.ts'), 'utf8');
    assert.match(ui, /view\.append\(activity,sidebar,mainCol\)/, 'activity bar | rail | editor');
    // Spec phase 2 §9: ONE application-wide status bar. The workspace row is
    // reparented into the app status strip instead of being a second bar inside
    // the IDE grid — workspace, repo, sync and agent state report from one place.
    assert.match(ui, /getElementById\('status-ide-slot'\)\?\.append\(ideStatus\)/,
      'the workspace row reports from the single app status strip');
    assert.ok(!/grid-template-rows:minmax\(0,1fr\) 22px/.test(
      readFileSync(join(src, 'phase415-workspace.css'), 'utf8')),
      'the IDE grid no longer reserves a second status row');
    for (const id of ['hc415-activity','hc415-views','hc415-view-explorer','hc415-view-search','hc415-view-scm',
                      'hc415-view-settings','hc415-main','hc415-tabs','hc415-bottom','hc415-ide-status',
                      'hc415-breadcrumb','hc415-rowmenu']) {
      assert.match(ui, new RegExp(`id='${id}'`), `${id} is a region of the IDE shell`);
    }
    // Multi-file editing: the open-document LIST is the model, the strip is its view.
    assert.match(ui, /let openDocs:string\[\]=\[\]/, 'the editor keeps an open-document list');
    assert.match(ui, /function closeDoc\(path:string\)/, 'a single tab can be closed');
    assert.match(ui, /function renderBreadcrumb\(\)/, 'the active document has a breadcrumb');
    // The row menu is DELEGATED off the row's own title, so it can never act on a
    // different file than the row it was opened from — and it is a context menu,
    // not another row of permanent buttons.
    assert.match(ui, /sbTree\.addEventListener\('contextmenu'/, 'rows carry a context menu');
    assert.match(ui, /wsSelect\.append\(wsHead,wsList,wsInfo,registerPanel,projectList,wsActions\)/,
      'the workspace dialog owns registration, not the permanent rail');
    assert.match(ui, /function showProjectTab\(on:boolean\)/);
    assert.ok(!/getElementById\('conv-tab-project'\)/.test(ui),
      'Phase 1: tab button event listeners removed — no conv-tab-project reference in JS');
    assert.match(ui, /filesBtn\.onclick=\(\)=>showProjectTab\(true\)/);
    assert.ok(!/panel\.append\(sidebar\)/.test(ui), 'the sidebar no longer wedges into the chat panel');
    assert.ok(!/panel\.append\(drawer\)/.test(ui), 'the drawer overlay is retired');
    assert.ok(!/hc-side-open/.test(ui), 'no layout-mode class machine');
});

/* ---------------------------------------- §6 cascade + host-rule landmines */

test('§6 the history column is protected at the SOURCE, not by defensive resets', () => {
    // This used to be neutralised per-component (height / min-height /
    // max-height / overflow / padding-right / gap / align-self resets on both
    // asides). Those resets are gone: src/style.css's aside rule now carries the
    // guard, so no new <aside> can be clamped again.
    assert.match(layout, /#hc-thread-sidebar \{[^}]*flex: 0 0 280px/);
    const at = layout.indexOf('#hc-thread-sidebar {');
    const col = layout.slice(at, layout.indexOf('.hc-thread-head', at));
    assert.ok(!/max-height: none/.test(col), 'the 520px clamp is fixed at the source now');

    const style = readFileSync(join(src, 'style.css'), 'utf8');
    assert.match(style, /aside:where\(:not\(#hermes-chat-root \*\):not\(#project-focus-host \*\)\)\{height:calc\(100vh - 112px\);min-height:520px/,
        'the prototype aside sizing must be scoped away from the chat AND the project rail');
});

test('§6 the list rule outranks the runtime-injected stylesheet', () => {
    // index.html <link>s unified-layout.css; hermes-chat.css is injected by the
    // TS module at RUNTIME, so at EQUAL specificity it always wins and its
    // max-height:195px would clip the list mid-item. Hence the descendant scope.
    assert.match(layout, /#hc-thread-sidebar #hc-threads\s*\{/);
    assert.ok(!/^#hc-threads\s*\{/m.test(layout), 'a bare rule would lose the cascade');
    const chatCss = readFileSync(join(src, 'hermes-chat.css'), 'utf8');
    assert.match(chatCss, /#hc-threads\{[^}]*max-height:195px/, 'the rule being outranked');
});

test('§6 the panel columns stretch to a common height', () => {
    const at = layout.indexOf('#hermes-chat-root.in-focus-host #hc-panel {');
    const rule = layout.slice(at, layout.indexOf('}', at));
    assert.match(rule, /align-items:\s*stretch/);
});

test('§5/§7 the header Chat button cannot wrap, and marks itself current', () => {
    const at = layout.indexOf('#app .header-chat-btn {');
    const rule = layout.slice(at, layout.indexOf('}', at));
    // The top bar flexes it to min-content width otherwise: measured 51x50px
    // with "Chat ✦" on two lines.
    assert.match(rule, /white-space:\s*nowrap/);
    assert.match(rule, /flex:\s*0 0 auto/);
    assert.match(layout, /\.header-chat-btn\[aria-current="page"\]/);
    const main = readFileSync(join(src, 'main.v2.ts'), 'utf8');
    assert.match(main, /chatBtn\.setAttribute\('aria-current', 'page'\)/,
        'it must mark the workspace it points at, or it reads as inert');
});

test('§6 the prototype stylesheet cannot leak into the chat', () => {
    // src/style.css is the pre-unification prototype. Its BARE element selectors
    // (aside/section/button/p/h1/h2/textarea/main/header) applied app-wide and
    // silently sized new components — a `<aside>` column clamped to 520px, chat
    // buttons inheriting margin-top:8px, the panel gaining a 14px frame.
    const style = readFileSync(join(src, 'style.css'), 'utf8');
    const guard = ':where(:not(#hermes-chat-root *))';
    assert.ok(style.includes(guard), 'bare prototype rules must carry the guard');
    // The project rail lives OUTSIDE the chat root (it is the Project tab's own
    // aside), so every aside rule also excludes #project-focus-host — three of them.
    const doubleGuard = style.match(/:where\(:not\(#hermes-chat-root \*\):not\(#project-focus-host \*\)\)/g) || [];
    assert.ok(doubleGuard.length >= 3, 'every aside rule must also exclude the project host');

    // No bare element selector may remain (that is the landmine).
    const bare = style.match(/(?:^|[}{;,])\s*(aside|section|button|textarea|h1|h2|p|main|header)\s*[{,]/m);
    assert.equal(bare, null, `bare-element selector still present: ${bare && bare[0]}`);

    // The guard must be `:where()`, which contributes ZERO specificity. A plain
    // `:not(#hermes-chat-root *)` adds an id and would outrank the shell's own
    // class rules — measured: .home-recent-strip / .world-room-panel /
    // #response-workspace regained the prototype's card look when I tried it.
    assert.ok(!/:not\(#hermes-chat-root \*\)/.test(
        style.replace(/:where\(:not\(#hermes-chat-root \*\):not\(#project-focus-host \*\)\)/g, '')
             .replace(/:where\(:not\(#hermes-chat-root \*\)\)/g, '')),
        'the guard must never be used outside :where()');
    // Spot-check a scoped rule keeps its original declarations.
    assert.match(style, /button:where\(:not\(#hermes-chat-root \*\)\)\{background:#65cbaa/);
});

test('§15 tool activity renders as statements, never as the wire payload', () => {
    // The transcript showed `{"command":"cd /home/…","output":"state: failed…"}`
    // as a JSON blob. Arguments are now kept structured and turned into a
    // statement at render time by trace-format.toolAction.
    assert.ok(!/hc-tool-detail/.test(chat), 'the raw-payload <pre> must be gone');
    assert.ok(!/hc-tool-detail/.test(chatCss), 'and its rule with it');
    assert.ok(!/toolDetail\(/.test(chat), 'no argument serialisation in the transcript');
    assert.match(chat, /toolAction\(step\.label,step\.args\)/);
    assert.match(chat, /className='hc-tool-cmd'/);
    assert.match(chat, /className='hc-tool-out'/);
    // The result is summarised, with the full text behind a disclosure.
    assert.match(chat, /resultSummary\(step\.result\)/);
    assert.match(chat, /hasMoreDetail\(step\.result\)/);
    // The trace headline names the action, not the bare tool name.
    assert.match(chat, /Working — \$\{last\}/);
    assert.match(chat, /worked|· \$\{n\} steps/);
});

test('§15a failed tool steps announce themselves in red', () => {
    // The CLI renders failures as alarm-red; the web trace must match, not just
    // keep the failure indistinguishable from a successful teal result line.
    // The class is applied only when resultSummary reports a failure — never
    // unconditionally, or every result would read as an error.
    assert.match(chat, /className='hc-tool-out'\+\(summary\.startsWith\('failed · '\)\?' hc-tool-failed':''\)/);
    assert.match(chatCss, /\.hc-tool-failed\{color:#f28b82;border-left:2px solid #b3261e;padding-left:8px\}/);
    // The harness fixture mirrors the renderer so the styling is visible
    // without triggering a real failure.
    const harness = readFileSync(join(here, '..', 'harness', 'trace-display.html'), 'utf8');
    assert.match(harness, /hc-tool-failed/);
});

test('opening a thread refreshes its usage metrics', () => {
    // These ran only on submit and on task completion, so opening an existing
    // thread left the meters on their "unavailable" default even for a task whose
    // usage row did hold tokens. The turns carry task_id; render() must use it.
    const renderFn = chat.slice(chat.indexOf('async function render('));
    assert.match(renderFn, /refreshChatUsage\(activeTask\|\|newestTask\|\|''\)/);
    assert.match(renderFn, /find\(t=>t\.task_id\)/);
    assert.match(renderFn, /void refreshChatUsage\(''\)/,
        'a new conversation must reset the meters rather than keep the last thread\'s');
});

test('§10 the composer names the working context as the Project (V2 audit #41)', () => {
    const project = readFileSync(join(src, 'phase412-project-ui.ts'), 'utf8');
    assert.match(project, /'Project: General chat'/);
    assert.match(project, /selectorBtn\.textContent='Project: '\+\(p\?p\.name:'General chat'\)/);
    assert.ok(!/'Working Directory: /.test(project),
        'a working directory is a filesystem path; "General chat" is not one');
});

test('§13 the stream stays reachable: jump-to-latest + contained code blocks', () => {
    // V2 audit #30: scrolling up unpins the follow; the chip brings you back.
    assert.match(chat, /id="hc-jump-latest"/);
    assert.match(chat, /messages\.addEventListener\('scroll'/);
    assert.match(chatCss, /#hc-jump-latest\[hidden\]\{display:none!important\}/);
    // V2 audit #28: assistant code blocks scroll horizontally inside the bubble.
    const clarity = readFileSync(join(src, 'chat-clarity.css'), 'utf8');
    assert.match(clarity, /\.hc-body pre \{ max-width:100%; overflow-x:auto; \}/);
});


/* --------------------------------------------- resource toolbar + model prices */

test('the persistent resource toolbar shares the action row with the model selector', () => {
    // #hc-usage-chip IS the toolbar: inline metrics, not a second outlined pill.
    assert.match(chat, /id="hc-usage-chip" type="button" class="hc-metrics-toolbar"/);
    for (const id of ['hc-metric-context', 'hc-metric-tokens', 'hc-metric-cost', 'hc-metric-balance']) {
        assert.match(chat, new RegExp(`id="${id}"`), `${id} is part of the inline toolbar`);
    }
    // It renders as inline text: no border, no pill background, no padding box.
    assert.match(chatCss, /#hc-usage-chip\{display:inline-flex;align-items:center;max-width:none;padding:0;border:none;background:none/);
    assert.match(chatCss, /\.hc-metric-sep\{/);
    // Clicking it still opens the detail inspector.
    assert.match(chat, /usageChip\.onclick=/);
});

test('the model popover shows CLI-style price columns and never throws on a null price', () => {
    // Column headers exist (USD per million tokens, like the CLI's $/Mtok).
    assert.match(chat, /In \$\/M/);
    assert.match(chat, /Out \$\/M/);
    assert.match(chat, /Cache \$\/M/);
    assert.match(chat, /class="hc-col hc-col-in"/);
    assert.match(chat, /class="hc-col hc-col-cache"/);
    // Provider per-TOKEN rates are scaled to per-million.
    assert.match(chat, /n\*1e6\)\.toFixed\(2\)/);
    // A null cache_read must not reach toFixed — that threw inside the click
    // handler and the popover never opened (regression 2026-11-26).
    assert.match(chat, /typeof pricing\.cache_read==='number'/);
    // Open-before-render so a catalogue build error can never leave it closed.
    assert.match(chat, /modelPopover\.hidden=false;\s*modelButton\.setAttribute\('aria-expanded','true'\);\s*try\{renderModelPopover\(\)\}/);
});

test('balance resolves for the active provider and never fakes a zero', () => {
    // Falls back to the provider behind the resolved worker default.
    assert.match(chat, /chatProvider\(\)\.value\|\|defaultChatModel\.provider/);
    // Unavailable states are named, not rendered as $0.00.
    assert.match(chat, /Balance not supported/);
    assert.match(chat, /Balance temporarily unavailable/);
    // Refreshed on completion and on a bounded interval / tab focus.
    assert.match(chat, /void refreshChatBalance\(\);\}\}catch\(err\)/);
    assert.match(chat, /setInterval\(\(\)=>\{if\(!document\.hidden\)void refreshChatBalance\(\)\},60000\)/);
});



/* --------------------------- §1/§7 IDE reachability + contextual empty state */

test('Chat and Projects are two equal, top-level workspaces — not nested', () => {
    const html = readFileSync(join(src, '..', 'index.html'), 'utf8');
    const convAt = html.indexOf('id="workspace-conversations"');
    const projAt = html.indexOf('id="workspace-projects"');
    assert.ok(convAt > 0 && projAt > convAt, 'Projects is its own workspace section');
    // The chat workspace's closing tag comes BEFORE the projects section → siblings,
    // not parent/child. This is the core requirement (user brief §2/§3).
    assert.ok(html.indexOf('</section>', convAt) < projAt,
        'Projects must NOT be nested inside the chat workspace');
    assert.match(html, /id="chat-focus-host"/, 'the chat host lives in the chat workspace');
    assert.match(html, /id="project-focus-host"/, 'the project host lives in its own workspace');
    const ns = readFileSync(join(src, 'navigation-state.ts'), 'utf8');
    assert.match(ns, /'conversations' \| 'projects'/, 'projects is a first-class workspace id');
    const main = readFileSync(join(src, 'main.v2.ts'), 'utf8');
    assert.match(main, /'conversations', 'projects'/, 'main.v2 routes the new workspace');
});

test('Projects is reachable from the shared navigation and owns its own state', () => {
    const html = readFileSync(join(src, '..', 'index.html'), 'utf8');
    assert.match(html, /data-workspace="projects"/, 'the nav rail carries Projects');
    assert.match(html, /id="header-project-open"/, 'the header carries a Projects shortcut');
    const ui = readFileSync(join(src, 'phase412-project-ui.ts'), 'utf8');
    // The project UI ASKS to navigate instead of hiding a sibling host — the
    // chat and the IDE are no longer two panes of one container.
    assert.match(ui, /hermes:open-projects/, 'the project UI delegates navigation');
    assert.ok(!/chatHost\.hidden=/.test(ui), 'the IDE no longer hides a sibling chat host');
    const main = readFileSync(join(src, 'main.v2.ts'), 'utf8');
    assert.match(main, /addEventListener\('hermes:open-projects'/, 'navigation has exactly one owner');
    // The workspace status row reports only while Projects is on screen.
    assert.match(ui, /hermes:workspace-shown/, 'the status row follows the active workspace');
    const projStart = html.indexOf('<section id="workspace-projects"');
    const projBody = html.slice(projStart, html.indexOf('</section>', projStart));
    assert.ok(!/workspace-heading|<h2/.test(projBody),
        'the Projects workspace carries no enclosing heading (brief §4)');
});

test('§7 the editor empty state is contextual, not one instruction line', () => {
    const ui = readFileSync(join(src, 'phase412-project-ui.ts'), 'utf8');
    assert.match(ui, /function renderStageEmpty\(\)/, 'the stage empty state is state-driven');
    assert.match(ui, /if\(!hasWorkspace\)/, 'no-workspace is distinguished from workspace-loaded');
    assert.match(ui, /'No workspace selected'/, 'the no-workspace state is named');
    assert.match(ui, /'No file open'/, 'the workspace-loaded state is named');
    assert.match(ui, /id='hc415-empty-open'/, 'the no-workspace state offers a door, not a dead end');
    // The old behaviour: one static paragraph telling everyone to select a file.
    assert.ok(!/stageEmpty\.textContent=/.test(ui),
        'the static paragraph is gone — the state is rendered, not hard-coded');
    assert.match(ui, /renderStageEmpty\(\);/, 'the state is rendered on selection change');
  });

test('mid-turn trace re-reads rebuild ONCE, then update in place', () => {
  // The 15s transcript re-read used to call replaceChildren() every time,
  // destroying and re-rendering the entire trace — 148 steps on a real turn —
  // which the user reads as the chat glitching and dumping a page of content.
  // The rebuild is only correct for the FIRST read (the transcript's step list
  // is interleaved, unlike the live capture); after that it is pure churn.
  assert.match(chat, /flowSource/, 'the renderer tracks what the step list came from');
  assert.match(chat, /if\(redraw&&flowSource!=='read'\)/,
      'the rebuild is conditional on the list not already being a transcript read');
  assert.ok(!/if\(redraw\)\{box\.replaceChildren/.test(chat),
      'the unconditional rebuild is gone');
});

test('the live bubble does not repeat reasoning the trace already shows', () => {
  // The worker labels no reasoning, so every text delta — extended thinking
  // included — streams into the answer bubble. Once the transcript read renders
  // that reasoning as trace thought blocks, the bubble must show only the part
  // the trace does not cover, or the user sees the same reasoning twice.
  assert.match(chat, /function liveBubbleText/);
  assert.match(chat, /function paintLiveBubble/);
  assert.match(chat, /liveText\+=delta;paintLiveBubble\(taskId\)/,
      'every delta repaints through the trimming path');
  assert.match(chat, /paintLiveBubble\(taskId\);?\}/,
      'a landed transcript read repaints the bubble immediately');
});

test('the chat reuses the ONE event stream and never replays history as live', () => {
  // D17 (review.md): the chat no longer owns a second WebSocket with its own
  // cursor. main.v2 owns the socket, the watermark seed (same rule as before:
  // newest-event seed, retry, never zero) and the reconnect backoff, and fans
  // events out tagged `historical`. The chat subscribes and IGNORES the
  // historical tag — the replay problem the old seed solved is solved
  // upstream, in the one connection.
  assert.match(chat, /addEventListener\('hermes:event'/, 'the chat subscribes to the shared fan-out');
  assert.match(chat, /if\(!e\|\|e\.historical\)return/, 'replayed history is never rendered as live');
  assert.ok(!/new WebSocket\(/.test(chat), 'the chat opens no socket of its own');
  // The remaining replay guard lives in eventItem's sequence watermark.
  assert.match(chat, /e\.sequence<=lastSeq\)return/, 'duplicate/replayed sequences are dropped');
});

test('finishing a turn must not force the scroll position', () => {
  // Forcing the bottom ignored where the reader was, so every completed turn
  // yanked the view; combined with the old double render it landed at the very
  // TOP of the thread (the first pass emptied the container, so the second
  // captured topBefore=0 and read followBottom() as false). Unforced, render
  // follows the bottom only when the reader was already there.
  const start = chat.indexOf('async function renderFinished');
  assert.ok(start > -1, 'renderFinished exists');
  const body = chat.slice(start, chat.indexOf('\n}', start));
  assert.ok(!/render\(true\)/.test(body),
      'renderFinished must not force the bottom — it yanks the reader');
  assert.match(body, /await render\(\)/);
  // The preserve-or-follow rule itself must stay in render(): follow only when
  // the reader was already at the bottom, otherwise re-find their content (see
  // the anchor test below — a pixel offset is the wrong unit after a rebuild).
  assert.match(chat, /const topBefore=messages\.scrollTop/);
  assert.match(chat, /if\(follow\)\{messages\.scrollTop=messages\.scrollHeight;return;\}/);
});

test('the message list scrolls instantly; only "jump to latest" animates', () => {
  // scroll-behavior:smooth turned EVERY programmatic scrollTop assignment into
  // a CSS animation, and this container is assigned to many times a second while
  // a turn streams (per token, per trace refresh, per appended bubble). Measured
  // in the live page: with smooth, `scrollTop = 400` reads back 0; with auto it
  // reads back 400. That made the view crawl during a run and, at the end of a
  // turn, animate it to whatever topBefore happened to be.
  const start = chatCss.indexOf('#hc-messages{');
  assert.ok(start > -1, 'the #hc-messages rule exists');
  const body = chatCss.slice(start, chatCss.indexOf('}', start));
  assert.match(body, /scroll-behavior:auto/, 'the message list must scroll instantly');
  assert.ok(!/scroll-behavior:smooth/.test(body),
      'no smooth scrolling on the message list — it is scrolled programmatically');
  assert.match(chat, /scrollTo\(\{top:messages\.scrollHeight,behavior:'smooth'\}\)/,
      'the explicit jump to latest keeps its smooth animation');
});

test('a thread rebuild must not let each bubble scroll the reader down', () => {
  // Between replaceChildren() and the last bubble the container is EMPTY, so
  // followBottom() reads `0 - 0 - clientHeight < 110` = "at the bottom" for every
  // bubble, and each one scrolls down — which dumped the reader at the bottom
  // however far back they had scrolled. The rebuild's restore() owns the final
  // position; the per-bubble follow must be suppressed while it runs.
  assert.match(chat, /let rebuildingThread=false/);
  assert.match(chat, /const stick=!rebuildingThread&&followBottom\(\)/);
  assert.match(chat, /rebuildingThread=true;[\s\S]{0,140}finally\{rebuildingThread=false;\}/,
      'the flag is set around the rebuild loop and always cleared');
});

test('a rebuild re-finds the reader\'s content instead of restoring a pixel offset', () => {
  // The rebuild rehydrates the traces ABOVE the reader — and since the live
  // stream labels no reasoning at all, every thought block comes from that read,
  // so the content above changes height by tens of thousands of px on a long
  // thread. Restoring the old scrollTop therefore lands near the top, worse the
  // longer the thread. Anchor on the bubble instead.
  assert.match(chat, /function scrollAnchor\(\):ScrollAnchor\|null/);
  assert.match(chat, /function applyAnchor\(a:ScrollAnchor\|null\):boolean/);
  assert.match(chat, /const anchor=scrollAnchor\(\)/);
  assert.match(chat, /if\(!applyAnchor\(anchor\)\)messages\.scrollTop=topBefore/);
  assert.ok(!/messages\.scrollTop=follow\?messages\.scrollHeight:topBefore/.test(chat),
      'the raw pixel-offset restore must be gone');
});

test('reasoning is re-read promptly, because the live stream never labels it', () => {
  // Measured: 241 of 241 hermes.text events arrived with channel=None,
  // content_type=None, message_type=None — so hasExplicitThoughtMarker() is
  // always false and EVERY thought block comes from the transcript read. A
  // 15000ms gate made reasoning appear in 15-second lumps while tool rows
  // streamed instantly.
  assert.match(chat, /if\(now-traceReadAt<3000\)return/);
  assert.ok(!/now-traceReadAt<15000/.test(chat), 'the 15s reasoning gate must be gone');
});

test('a trace re-read must never empty its box', () => {
  // Emptying the box collapses the content above the reader, and the browser
  // cannot scroll-anchor across destroyed nodes — so the view is thrown, worse
  // the longer the thread (more content above to collapse). Measured in the live
  // page: the trace re-read inserted +172 nodes and the scroll moved by 18,285px.
  // Reconcile in place and drop only the surplus rows.
  assert.ok(!/box\.replaceChildren\(\)/.test(chat), 'the trace box must never be emptied');
  assert.match(chat, /flowEls\.forEach\(\(el,i\)=>\{if\(i>=t\.steps\.length\)/,
      'surplus trace rows are removed individually instead');
  assert.match(chat, /if\(redraw&&flowSource!=='read'\)flowSource='read'/);
});

test('re-asserting the chat must not force the reader to the bottom', () => {
  // `hermes:chat-open` fires whenever the chat workspace is announced as focused
  // (main.v2.ts) and calls openChat() -> render(true). During a live turn that
  // pulled the reader to the bottom of what they were reading, and with the old
  // end-of-turn double render it landed them at the very TOP. A forced bottom is
  // only legitimate when the THREAD actually changes.
  assert.match(chat, /let hcRenderedThread=''/);
  assert.match(chat, /const threadChanged=thread!==hcRenderedThread/);
  assert.match(chat, /const follow=\(forceBottom&&threadChanged\)\|\|followBottom\(\)/);
  assert.match(chat, /messages\.replaceChildren\(\);[\s\S]{0,200}hcRenderedThread=thread;/);
});

test('a trace update puts a scrolled-up reader back on their own content', () => {
  // Nothing in the app ASSIGNS the bottom during a trace update — measured, the
  // only large scrollTop set was the reader's own — yet the view jumped 20,000px
  // to the bottom when the trace grew. That is the browser's scroll anchoring:
  // when content above the anchor changes size the scroll moves, and a rehydrated
  // trace adds thousands of px above. So capture the reader's content first and
  // restore it afterwards, unless they were already at the bottom.
  assert.match(chat, /const keepAnchor=followBottom\(\)\?null:scrollAnchor\(\)/);
  assert.match(chat, /if\(keepAnchor\)applyAnchor\(keepAnchor\);else messages\.scrollTop=messages\.scrollHeight;/);
});

test('the message list must opt OUT of the browser\'s scroll anchoring', () => {
  // ROOT CAUSE. With overflow-anchor:auto the browser drags the scroll position
  // to keep its own anchor stable whenever content above the reader changes
  // height — and the trace re-read rehydrates reasoning into turns ABOVE the
  // reader (measured +21,500px for one turn). Measured on a 27,748px thread the
  // scroll moved 16,000 -> 26,279 BY ITSELF: wrapping the scrollTop setter,
  // scrollTo, scrollBy, scrollIntoView and focus all fired ZERO times. With
  // overflow-anchor:none the same scroll stayed exactly where the reader left it.
  const start = chatCss.indexOf('#hc-messages{');
  const body = chatCss.slice(start, chatCss.indexOf('}', start));
  assert.match(body, /overflow-anchor:none/,
      'the app owns the scroll position; the browser must not drag it');
});

test('a rebuild must set the scroll position synchronously, not only in a rAF', () => {
  // A rebuild empties the container for a moment; a scrollTop left unset across
  // that gap is CLAMPED against the shortened content and never recovers — the
  // reader ends up far above where they were, further the longer the thread.
  // Measured after the overflow-anchor fix: scrollTop 16000 -> 5952 (upward).
  const s = chat.indexOf('async function render(');
  const body = chat.slice(s, chat.indexOf('const threadTitles', s));
  assert.match(body, /if\(follow\)messages\.scrollTop=messages\.scrollHeight;\s*\n\s*else if\(!applyAnchor\(anchor\)\)messages\.scrollTop=topBefore;/,
      'the position is applied synchronously after the rebuild');
  assert.match(body, /restore\(\);/);
});

