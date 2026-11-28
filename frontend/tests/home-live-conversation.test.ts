/**
 * uichange.md §2–§3 — Home live conversation panel (fix 4).
 *  - one chat instance: the Home panel hosts the shared root; nothing copies it
 *  - one slot: the thread id lives in home-conversation.ts, Home-initiated sends only
 *  - States: live / minimized / finished, with Minimize, Open in Chat, Finish, Resume
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const frontend = join(here, '..');
const html = readFileSync(join(frontend, 'index.html'), 'utf8');
const css = readFileSync(join(frontend, 'src', 'command-centre.css'), 'utf8');
const chat = readFileSync(join(frontend, 'src', 'hermes-chat.ts'), 'utf8');
const home = readFileSync(join(frontend, 'src', 'home-conversation.ts'), 'utf8');
const slot = readFileSync(join(frontend, 'src', 'home-slot.ts'), 'utf8');
const composer = readFileSync(join(frontend, 'src', 'world-composer.ts'), 'utf8');
const mainV2 = readFileSync(join(frontend, 'src', 'main.v2.ts'), 'utf8');

test('the Home panel is a sibling column and hosts the body the chat root moves into', () => {
    assert.match(html, /<aside id="home-conversation-host"[^>]* hidden>/);
    assert.match(html, /<div id="home-conversation-body"/);
    assert.match(css, /#app\.layout-home\.home-live \{[\s\S]*"conv   main   panel"/);
});

test('one chat instance: the root is moved, never copied', () => {
    assert.match(chat, /export function hostChatRootIn/);
    assert.match(chat, /if \(root\.parentElement !== dest\) dest\.append\(root\);/);
    assert.ok(!/cloneNode\(/.test(chat.slice(chat.indexOf('function hostChatRootIn'))), 'no clone of the chat root');
});

test('one rule decides placement and the panel visibility', () => {
    assert.match(home, /const showPanel = live && !minimized && onHome;/);
    assert.match(home, /hostChatRootIn\(showPanel && body \? body : null\);/);
    assert.match(home, /onNavigationChange\(\(\) => sync\(\)\);/);
});

test('the slot lives in a dependency-free module; the composer imports only that', () => {
    assert.match(slot, /localStorage\.setItem\(SLOT_KEY, id\)/);
    assert.ok(!/import /.test(slot), 'home-slot has no imports');
    assert.match(composer, /import \{ setHomeThread \} from '\.\/home-slot\.ts';/);
    assert.ok(!/home-conversation|hermes-chat/.test(composer.split('\n').filter(l => l.startsWith('import')).join('\n')), 'composer does not import the chat or the panel');
    assert.ok(!/HOME_THREAD_KEY|let homeThread/.test(composer), 'no second copy of the slot');
    assert.match(composer, /hermes:home-session/);
});

test('the host controls exist and are wired', () => {
    for (const id of ['home-conv-minimize', 'home-conv-open-chat', 'home-conv-finish', 'world-composer-resume']) {
        assert.ok(html.includes(`id="${id}"`), id);
    }
    assert.match(home, /'home-conv-finish'\)\?\.addEventListener\('click', \(\) => finish\(\)\)/);
    assert.match(home, /openWorkspace\('conversations'\)/);
});

test('the shell loads the module', () => {
    assert.match(mainV2, /import '\.\/home-conversation';/);
});
