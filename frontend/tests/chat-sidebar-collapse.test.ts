/**
 * Spec §4.1 — the conversation-history sidebar is collapsible.
 *
 * The Conversations aside (the thread list with its search field and New chat
 * button) had no collapse control, while the nav rail and the inspector both
 * had one. These checks pin the sidebar's collapse contract: the toggle lives
 * in the thread-list header, the aside is collapsed by ONE class on the chat
 * root so the conversation column takes the space, a reopen control keeps the
 * collapsed state from being a dead end, and search text / list scroll / the
 * collapsed flag itself survive the round trip.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src');
const chat = readFileSync(join(src, 'hermes-chat.ts'), 'utf8');
const chatCss = readFileSync(join(src, 'hermes-chat.css'), 'utf8');
const layout = readFileSync(join(src, 'unified-layout.css'), 'utf8');

test('the collapse toggle sits in the thread-list header (the title area)', () => {
    // Inside .hc-thread-head, next to the "Conversations" title — the header of
    // the list it collapses, not the chat header or the composer.
    assert.match(chat, /<div class="hc-thread-head"><strong>Conversations<\/strong><button id="hc-sidebar-collapse" type="button" title="Collapse the conversation history"/);
    assert.match(chat, /id="hc-sidebar-collapse"[^>]*aria-pressed="false"/,
        'the toggle reports its state like the nav-rail and inspector toggles');
    // The rest of the column is untouched: search field and New chat stay.
    assert.match(chat, /id="hc-thread-filter"/);
    assert.match(chat, /id="hc-new"/);
    assert.ok(chat.indexOf('id="hc-sidebar-collapse"') < chat.indexOf('id="hc-new"'),
        'the collapse toggle belongs to the title area, before the actions');
});

test('collapse is one class on the chat root; the conversation column takes the space', () => {
    assert.match(chat, /root\.classList\.toggle\('hc-sidebar-collapsed',collapsed\)/,
        'the state is a class on the chat root, not a rewritten template');
    // display:none takes the aside OUT of the panel's flex row, so .hc-main's
    // existing flex:1 1 auto claim reclaims the width — no second width machine.
    assert.match(chatCss, /#hermes-chat-root\.hc-sidebar-collapsed #hc-thread-sidebar\{display:none\}/);
    assert.match(layout, /\.hc-main\s*\{[^}]*flex:\s*1 1 auto/,
        'the conversation column already stretches; hiding the aside frees the row');
    // The pinned column contract is not restated or overridden by the collapse.
    assert.match(layout, /#hc-thread-sidebar\s*\{[^}]*flex:\s*0 0 280px/);
    assert.ok(!/#hc-thread-sidebar\s*\{[^}]*width:\s*0/.test(chatCss),
        'a zero-width rail would keep the aside in the flow and clip its contents');
});

test('a collapsed sidebar is never a dead end: the header reopens it', () => {
    assert.match(chat, /id="hc-sidebar-expand" type="button" title="Show the conversation history"/,
        'the chat header carries the reopen control while the aside is hidden');
    assert.match(chatCss, /#hc-sidebar-expand\{display:none/,
        'it is hidden while the sidebar is open');
    assert.match(chatCss, /#hermes-chat-root\.hc-sidebar-collapsed #hc-sidebar-expand\{display:inline-flex\}/,
        'and shown only while the sidebar is collapsed');
    // Class-driven visibility, deliberately: a [hidden] attribute here would be
    // beaten by the author display rule above (the workspace-tabs trap).
    assert.ok(!/#hc-sidebar-expand\[hidden\]/.test(chatCss), 'no [hidden] to lose the cascade');
});

test('both controls route through ONE state applier', () => {
    assert.equal((chat.match(/function applySidebarCollapsed\(/g) || []).length, 1,
        'one applier owns the class, the aria state and the persistence');
    assert.match(chat, /function applySidebarCollapsed\(collapsed:boolean,persist=true\)\{/);
    assert.match(chat, /el\('hc-sidebar-collapse'\)\.onclick=\(\)=>applySidebarCollapsed\(!root\.classList\.contains\('hc-sidebar-collapsed'\)\);/);
    assert.match(chat, /el\('hc-sidebar-expand'\)\.onclick=\(\)=>applySidebarCollapsed\(false\);/);
    // The applier reports state on the toggle, like applyNavCollapse/applyInspectorCollapsed.
    assert.match(chat, /collapseBtn\.setAttribute\('aria-pressed',String\(collapsed\)\)/);
    assert.match(chat, /collapseBtn\.title=collapsed\?'Show the conversation history':'Collapse the conversation history'/);
});

test('the collapsed state persists next to the thread-selection key', () => {
    assert.match(chat, /const stored='hermes-life-chat-conversation'/,
        'the existing thread-selection key is untouched');
    assert.match(chat, /const sidebarCollapsedKey='hermes-life-chat-sidebar-collapsed'/,
        'a dedicated sibling key in the same region');
    // Read on load, written on toggle — and guarded, like the other persisters.
    assert.match(chat, /applySidebarCollapsed\(localStorage\.getItem\(sidebarCollapsedKey\)==='1',false\);/,
        'a reload reopens exactly where the user left it (and never re-persists)');
    assert.match(chat, /try\{localStorage\.setItem\(sidebarCollapsedKey,collapsed\?'1':'0'\)\}catch\{\/\* storage unavailable \*\/\}/);
});

test('the search text and list scroll survive the collapse round trip', () => {
    // The DOM survives — no rebuild, no refetch — so the input keeps its value;
    // it is still captured and restored explicitly so the applier can never
    // clear it as a side effect.
    assert.match(chat, /const keepQuery=filter\.value;/);
    assert.match(chat, /filter\.value=keepQuery;/);
    // display:none drops the list's scrollTop, so the offset is held in a
    // variable (captured only while the list is actually laid out) and put back
    // on expand.
    assert.match(chat, /let sidebarScroll=0;/);
    assert.match(chat, /if\(!root\.classList\.contains\('hc-sidebar-collapsed'\)\)sidebarScroll=threads\.scrollTop;/,
        'the offset is captured while the list is visible, never read back from a hidden element');
    assert.match(chat, /if\(!collapsed\)threads\.scrollTop=sidebarScroll;/,
        'restored on expand only');
});

test('the pinned sidebar contracts still hold around the new controls', () => {
    // chat-audit-layout.test.ts pins the column itself; the collapse must not
    // disturb the wiring those checks read.
    assert.match(chat, /id="hc-thread-sidebar"/);
    assert.match(chat, /hc-thread-filter'\)\.addEventListener\('input',renderThreadList\)/,
        'search still filters the cached list locally');
    assert.match(chat, /id="hc-thread-title"/);
    // The collapse path touches layout state only — never the thread cache.
    assert.ok(!/hc-sidebar-collapse'\)\.onclick=\(\)=>[^\n]*(refreshThreads|renderThreadList|localStorage\.removeItem)/.test(chat),
        'toggling must not refetch, re-render or clear selection');
});