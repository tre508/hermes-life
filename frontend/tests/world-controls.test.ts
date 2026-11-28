/**
 * HL-UI-PLAN-001 §4.3.2 — world camera controls contract.
 * Controls are overlaid in Home; intents flow through hermes:world-camera;
 * town-view owns the renderer. Unsupported controls (zoom, follow, bubbles) are absent.
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
const controls = readFileSync(join(frontend, 'src', 'world-controls.ts'), 'utf8');
const townView = readFileSync(join(frontend, 'src', 'town-view.ts'), 'utf8');
const mainV2 = readFileSync(join(frontend, 'src', 'main.v2.ts'), 'utf8');

test('the three supported controls are overlaid inside the Home world box', () => {
    const box = html.slice(html.indexOf('id="world-controls"'), html.indexOf('id="world-room-panel"'));
    for (const id of ['world-overview', 'world-focus', 'world-fullscreen']) assert.ok(box.includes(`id="${id}"`), id);
    assert.match(css, /#app\.layout-home #workspace-home \.world-controls \{[^}]*position: absolute;/);
});

test('controls emit intents and do not touch the renderer directly', () => {
    assert.match(controls, /hermes:world-camera/);
    const code = controls.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/renderer|focusRoom\(|overview\(/.test(code), 'controls own no camera logic');
    assert.match(controls, /hermesha:room:select/, 'Focus follows the last selected room');
});

test('town-view executes overview and focus intents; the module is loaded by the shell', () => {
    assert.match(townView, /hermes:world-camera/);
    assert.match(townView, /renderer\?\.overview\?\.\(\)/);
    assert.match(townView, /renderer\?\.focusRoom\?\.\(detail\.room\)/);
    assert.match(mainV2, /import '\.\/world-controls';/);
});

test('zoom, follow-activity and bubble toggles are not offered without renderer support', () => {
    assert.ok(!/id="world-(zoom|follow|bubbles)/.test(html));
});
