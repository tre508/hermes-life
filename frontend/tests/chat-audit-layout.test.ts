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
    assert.match(chat, /id="hc-project-slot"/, 'the single project control mounts here');
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
    assert.match(chat, /addEventListener\('input',autogrow\)/);
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
    // V2 audit #19/#41: the project pill is gone — phase412 mounts its selector into
    // the composer's tools slot; Attach delegates to the files workflow.
    assert.match(chat, /hc-attach'\)\.onclick[\s\S]{0,90}hc415-files-button/);
    assert.ok(!/hc-composer-context'/.test(chat), 'the delegating pill is gone');
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
    // User redesign (2026-11-25): the Conversations workspace has Chat | Project
    // tabs; the Project tab mirrors the chat's two-column anatomy (file rail in
    // the thread-list slot, file stage in the conversation slot) instead of the
    // old 300px sidebar wedged into the chat panel row.
    const html = readFileSync(join(src, '..', 'index.html'), 'utf8');
    assert.match(html, /id="conv-tab-chat"/);
    assert.match(html, /id="conv-tab-project"/);
    assert.match(html, /id="project-focus-host"/);
    const ui = readFileSync(join(src, 'phase412-project-ui.ts'), 'utf8');
    assert.match(ui, /view\.append\(sidebar,stage\)/, 'rail | stage — the chat anatomy');
    assert.match(ui, /function showProjectTab\(on:boolean\)/);
    assert.match(ui, /getElementById\('conv-tab-project'\)\?\.addEventListener\('click',\(\)=>showProjectTab\(true\)/);
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
