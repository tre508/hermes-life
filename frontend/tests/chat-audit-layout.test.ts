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

test('§2 the provider/context/usage block is collapsed, not permanent chrome', () => {
    assert.match(chat, /createElement\('details'\);\s*modelDetails\.id='hc-model-details'/);
    assert.match(chat, /modelDetails\.append\(modelSummary,modelBar\)/);
    assert.match(chat, /\.hc-head'\)\?\.after\(modelDetails\)/);
    assert.match(chatCss, /#hc-model-details>summary/);
    // It must not be open by default.
    assert.ok(!/modelDetails\.open\s*=\s*true/.test(chat), 'the model block must start collapsed');
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

test('§7 account actions are not chat-frequency actions', () => {
    assert.match(chat, /<details class="hc-account">/);
    // Logout and Passkey live inside it.
    const menu = chat.slice(chat.indexOf('<details class="hc-account">'), chat.indexOf('</details>'));
    assert.match(menu, /id="hc-logout"/);
    assert.match(menu, /id="hc-passkey"/);
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

test('§9 the composer is a box with a tool row and a footer', () => {
    assert.match(chat, /class="hc-composer-box"/);
    assert.match(chat, /class="hc-composer-tools"/);
    assert.match(chat, /class="hc-composer-foot"/);
    assert.match(chatCss, /\.hc-composer-box\s*\{[^}]*flex-direction:\s*column/);
});

test('§9A/§9B the input grows with the prompt and is capped', () => {
    assert.match(chat, /function autogrow\(\)/);
    assert.match(chat, /addEventListener\('input',autogrow\)/);
    // Capped so a long prompt cannot swallow the conversation.
    assert.match(chat, /Math\.min\(box\.scrollHeight,\s*cap\)/);
    // Multiline must be discoverable, and Enter must keep sending.
    assert.match(chat, /Enter to send · Shift\+Enter for a new line/);
    assert.match(chat, /e\.key==='Enter'&&!e\.shiftKey/);
});

test('§9F Send becomes Stop while a task runs, and Stop is clickable', () => {
    const at = chat.indexOf('function setRunning(');
    const fn = chat.slice(at, chat.indexOf('\n}', at));
    assert.match(fn, /dataset\.mode=running\?'stop':'send'/);
    assert.match(fn, /send\.disabled=false/, 'Stop must not be disabled');
    assert.match(chat, /dataset\.mode==='stop'[\s\S]{0,80}hc-stop'\)\.click\(\)/);
});

test('§9D/§9E the composer names context and model without duplicating controls', () => {
    // The chips delegate to the controls that own those values.
    assert.match(chat, /hc-composer-context'\)\.onclick[\s\S]{0,90}hc415-ws-selector/);
    assert.match(chat, /hc-attach'\)\.onclick[\s\S]{0,90}hc415-files-button/);
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
    assert.match(layout, /#hc-thread-sidebar\s*\{[^}]*flex:\s*0 0 238px/);
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

test('§6 the file inspector is the third column, not a layout mode', () => {
    assert.match(layout, /#hc415-file-sidebar\s*\{[^}]*flex:\s*0 0 300px/);
    assert.ok(!/hc-side-open/.test(readFileSync(join(src, 'phase412-project-ui.ts'), 'utf8')),
        'the sidebar is shown by its own hidden attribute');
});

/* ---------------------------------------- §6 cascade + host-rule landmines */

test('§6 the history column is protected at the SOURCE, not by defensive resets', () => {
    // This used to be neutralised per-component (height / min-height /
    // max-height / overflow / padding-right / gap / align-self resets on both
    // asides). Those resets are gone: src/style.css's aside rule now carries the
    // guard, so no new <aside> can be clamped again.
    assert.match(layout, /#hc-thread-sidebar \{[^}]*flex: 0 0 238px/);
    const at = layout.indexOf('#hc-thread-sidebar {');
    const col = layout.slice(at, layout.indexOf('.hc-thread-head', at));
    assert.ok(!/max-height: none/.test(col), 'the 520px clamp is fixed at the source now');

    const style = readFileSync(join(src, 'style.css'), 'utf8');
    assert.match(style, /aside:where\(:not\(#hermes-chat-root \*\)\)\{height:calc\(100vh - 112px\);min-height:520px/,
        'the prototype aside sizing must be scoped away from the chat');
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

    // No bare element selector may remain (that is the landmine).
    const bare = style.match(/(?:^|[}{;,])\s*(aside|section|button|textarea|h1|h2|p|main|header)\s*[{,]/m);
    assert.equal(bare, null, `bare-element selector still present: ${bare && bare[0]}`);

    // The guard must be `:where()`, which contributes ZERO specificity. A plain
    // `:not(#hermes-chat-root *)` adds an id and would outrank the shell's own
    // class rules — measured: .home-recent-strip / .world-room-panel /
    // #response-workspace regained the prototype's card look when I tried it.
    assert.ok(!/:not\(#hermes-chat-root \*\)/.test(style.replace(/:where\(:not\(#hermes-chat-root \*\)\)/g, '')),
        'the guard must never be used outside :where()');
    // Spot-check a scoped rule keeps its original declarations.
    assert.match(style, /button:where\(:not\(#hermes-chat-root \*\)\)\{background:#65cbaa/);
});

test('§10 the context is named a workspace, not a working directory', () => {
    const project = readFileSync(join(src, 'phase412-project-ui.ts'), 'utf8');
    assert.match(project, /'Workspace: General chat'/);
    assert.ok(!/'Working Directory: General chat'/.test(project),
        'a working directory is a filesystem path; "General chat" is not one');
});
