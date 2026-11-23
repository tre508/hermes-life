/**
 * Chat presentation contract (HERMESHA §6, chat audit §8).
 *
 * The floating assistant is RETIRED. There is exactly ONE chat presentation:
 * the full-page Conversations workspace. These checks pin that end state so the
 * two-presentation model cannot creep back in.
 *
 * History worth keeping: the floating panel used to be reparented between
 * <body> and #chat-focus-host, and focus sizing had to be absolute because a
 * percentage height against a stretched flex item resolves in Chromium but
 * falls back to content height in Firefox. Both were consequences of a
 * fixed-position widget reused as a page; with the widget gone, so are they.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src');
const main = readFileSync(join(src, 'main.v2.ts'), 'utf8');
const chat = readFileSync(join(src, 'hermes-chat.ts'), 'utf8');
const layout = readFileSync(join(src, 'unified-layout.css'), 'utf8');
const LAUNCHER = 'hc-' + 'toggle'; // split so this file cannot match itself

test('the single chat root mounts into the focus host and never moves', () => {
    assert.match(chat, /root\.classList\.add\('in-focus-host'\)/);
    assert.match(chat, /getElementById\('chat-focus-host'\)\s*\|\|\s*document\.body\)\.append\(root\)/,
        'the root must mount into the workspace host, falling back to body only if absent');
    // No reparenting logic may survive anywhere.
    assert.ok(!/document\.body\.append\(chatRoot\)/.test(main), 'no hand-back to <body>');
    assert.ok(!/host\.contains\(chatRoot\)/.test(main), 'no reparent guard');
    assert.ok(!/classList\.toggle\('in-focus-host'/.test(main), 'the host class is set once, at load');
});

test('the chat is never hidden behind a launcher', () => {
    assert.ok(!new RegExp(LAUNCHER).test(chat), 'no launcher pill in the module');
    assert.ok(!new RegExp(LAUNCHER).test(layout), 'no launcher styling in the shell');
    // The panel must not start hidden: nothing exists to reveal it again.
    assert.ok(!/<section id="hc-panel"[^>]*\shidden/.test(chat),
        'the panel must not carry a hidden attribute');
    assert.ok(!/panel\.hidden\s*=\s*true/.test(chat), 'nothing may hide the panel');
});

test('entering the workspace asks the chat module to open, keeping state ownership', () => {
    const fn = main.slice(main.indexOf('function setChatFocus'), main.indexOf('function setChatFocus') + 700);
    assert.match(fn, /dispatchEvent\(new CustomEvent\('hermes:chat-open'\)\)/,
        'main.v2 announces intent; it must not drive the panel itself');
    assert.match(chat, /addEventListener\('hermes:chat-open',\(\)=>openChat\(\)\)/,
        'the chat module owns what opening means');
    assert.match(chat, /function openChat\(\)\{void render\(true\);void refreshThreads\(\)/);
});

test('the header Chat button navigates, it does not toggle a panel', () => {
    const at = main.indexOf("const headerChat = $('header-chat-open');");
    const handler = main.slice(at, main.indexOf('});', at));
    assert.match(handler, /openWorkspace\('conversations'\)/,
        'the header button must take you to the one chat presentation');
    assert.ok(!/toggle/.test(handler) && !/hc-panel/.test(handler),
        'it must not toggle a floating panel');
});

test('the root is a flow child of the flex host, not a fixed-position widget', () => {
    const at = layout.indexOf('#hermes-chat-root.in-focus-host {');
    assert.ok(at > 0, 'the in-host root rule must exist');
    const rule = layout.slice(at, layout.indexOf('}', at));
    assert.match(rule, /position:\s*relative/);
    assert.match(rule, /flex:\s*1 1 auto/, 'the root fills the host in flow');
    assert.match(rule, /inset:\s*auto/, 'no viewport offsets may leak in');
    assert.ok(!/position:\s*absolute/.test(rule), 'the floating widget is gone');

    const panelAt = layout.indexOf('#hermes-chat-root.in-focus-host #hc-panel {');
    const panel = layout.slice(panelAt, layout.indexOf('}', panelAt));
    assert.match(panel, /position:\s*relative/);
    assert.ok(!/height:\s*100%/.test(panel), 'no percentage height on the panel');
});

test('the floating overlay stylesheet is gone', () => {
    assert.ok(!existsSync(join(src, 'chat-overlay.css')), 'chat-overlay.css must be deleted');
    assert.ok(!/chat-overlay\.css/.test(main), 'and must not be imported');
});
