/**
 * World room/resident popovers must be dismissible (user report: the room
 * popup with the description was persistent and would not close).
 *
 * Real rooms now render in the contextual inspector; the floating
 * #world-room-panel is reserved for the presentation-only Break Room.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const frontend = join(here, '..');
const townView = readFileSync(join(frontend, 'src', 'town-view.ts'), 'utf8');
const mainV2 = readFileSync(join(frontend, 'src', 'main.v2.ts'), 'utf8');
const inspector = readFileSync(join(frontend, 'src', 'context-inspector.ts'), 'utf8');

test('the room × closes the panel, clears the selection, and returns the camera', () => {
    assert.match(townView, /hideRoomPanel/);
    assert.match(townView, /closeRoom, 'click', hideRoomPanel/);
    assert.match(townView, /setSelection\('home', null\)/);
    assert.match(townView, /renderer\?\.overview\?\.\(\)/);
    assert.match(townView, /panel\.hidden = true/);
});

test('Escape dismisses whichever World popover is open', () => {
    assert.match(townView, /listen\(document, 'keydown'/);
    assert.match(townView, /key !== 'Escape'/);
    assert.match(townView, /hideResidentCard/);
});

test('the resident card Close actually hides it (not just empties it)', () => {
    assert.match(townView, /ui!\.selection\.hidden = true/);
});

test('a real room pick does NOT open the floating panel (one room surface)', () => {
    // showBuilding hides the panel and drives the inspector instead.
    const show = townView.slice(townView.indexOf('function showBuilding'));
    const body = show.slice(0, show.indexOf('\n}'));
    assert.match(body, /panel\.hidden = true/);
    assert.ok(!/panel\.hidden = false/.test(body), 'showBuilding must not show the floating panel');
    assert.match(body, /setSelection\('home', \{ kind: 'room'/);
    assert.match(body, /renderer\?\.focusRoom\?\.\(location\)/);
});

test('the inspector room card carries the open-workspace action', () => {
    assert.match(townView, /ctx-open-workspace/);
    assert.match(townView, /'Open ' \+ place\.view \+ ' workspace'/);
});

test('leaving the World dismisses the room popover', () => {
    assert.match(mainV2, /world-room-panel/);
    assert.match(mainV2, /id !== 'world'/);
});

test('Home/World shows one contextual surface: a room selection replaces ctx-home', () => {
    assert.match(inspector, /ctxHome\.hidden = !\(onWorld && !roomSel\)/);
});
