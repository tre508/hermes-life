/**
 * HL-UI-PLAN-001 §4.1 — the top-bar shell contract.
 *  - primary navigation is one top row, not a left rail
 *  - Chat and Projects are PEERS in one segmented group (not nested)
 *  - the eight physical rooms fold into a menu, all still deep-linkable
 *  - Settings is a top-level destination with its own workspace section
 *  - the workspace grid is header / nav row / main+inspector / status
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const frontend = join(here, '..');
const html = readFileSync(join(frontend, 'index.html'), 'utf8');
const css = readFileSync(join(frontend, 'src', 'unified-layout.css'), 'utf8');
const nav = readFileSync(join(frontend, 'src', 'navigation-state.ts'), 'utf8');

const navBlock = html.slice(html.indexOf('<nav id="primary-nav"'), html.indexOf('</nav>', html.indexOf('<nav id="primary-nav"')));

test('grid is header / nav row / main+inspector / status', () => {
    assert.match(css, /grid-template-rows: 54px 44px minmax\(0, 1fr\) 36px;/);
    assert.match(css, /"nav    nav"/);
    assert.ok(!/grid-template-columns: 220px/.test(css), 'no 220px rail column remains');
});

test('Chat and Projects are peers in one segmented group, neither nested', () => {
    const seg = navBlock.slice(navBlock.indexOf('class="hc-segment"'), navBlock.indexOf('</div>', navBlock.indexOf('class="hc-segment"')));
    assert.match(seg, /data-workspace="conversations"/);
    assert.match(seg, /data-workspace="projects"/);
    assert.ok(!/data-workspace="conversations"[\s\S]*data-workspace="projects"[\s\S]*hc-segment/.test(seg), 'segment holds both peers flat');
});

test('the eight rooms fold into a details menu and are all still present', () => {
    assert.match(navBlock, /<details class="hc-rooms-menu">/);
    assert.equal((navBlock.match(/data-hc-room="/g) ?? []).length, 8, 'eight room shortcuts');
});

test('Settings is a top-level destination with its own section', () => {
    assert.match(navBlock, /data-workspace="settings"/);
    assert.match(html, /<section id="workspace-settings" class="workspace-view"/);
    assert.match(nav, /'settings'/, 'settings declared in the Workspace union');
});

test('the inspector grip and overlay sit below the header plus the nav row', () => {
    assert.match(css, /#app #inspector-grip \{[^}]*top: 98px;/);
    assert.match(css, /#app #ctx-collapse \{[^}]*top: 108px;/);
});

test('G5: World and Home are one destination; World survives only as a deep-link alias', () => {
    assert.ok(!/WORKSPACES[^\n]*'world'/.test(nav), "'world' is not a workspace");
    assert.ok(!/Workspace =[^\n]*'world'/.test(nav), "'world' is not in the Workspace union");
    assert.match(nav, /rawView === 'world' \? 'home' : rawView/, 'old ?view=world links land on Home');
    assert.ok(!navBlock.includes('◈ World'), 'no separate World nav destination');
    assert.match(html, /<section id="workspace-home" class="workspace-view" data-layout="world">/, 'Home hero is the world canvas');
    assert.match(html, /<div id="ctx-overview" class="ctx-block" hidden>/, 'overview lives in its own inspector block');
});

