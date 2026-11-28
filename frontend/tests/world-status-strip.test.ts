/**
 * HERMESHA §5 — the World's operational status lives in the ONE bottom strip.
 *
 * Before: the World stacked a header, a "home-status-strip", the canvas, a town
 * HUD block, the composer and a status line — the HUD block sat between the
 * canvas and the composer, which reads as an unfinished page. The status now
 * renders into #status-world inside the global #status-strip.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const frontend = join(here, '..');
const html = readFileSync(join(frontend, 'index.html'), 'utf8');
const townView = readFileSync(join(frontend, 'src', 'town-view.ts'), 'utf8');
const townCss = readFileSync(join(frontend, 'src', 'town.css'), 'utf8');
const layout = readFileSync(join(frontend, 'src', 'unified-layout.css'), 'utf8');

test('the status strip carries a dedicated world-status region', () => {
    const strip = html.slice(html.indexOf('id="status-strip"'), html.indexOf('</footer>'));
    assert.match(strip, /id="status-world"/, '#status-world must live inside #status-strip');
});

test('the World no longer stacks its own status bar or trailing hint', () => {
    const world = html.slice(html.indexOf('id="workspace-home"'), html.indexOf('id="workspace-work"'));
    assert.ok(!/home-status-strip/.test(world), 'the in-World status bar is gone');
    assert.ok(!/id="studio-status"/.test(world), 'studio-status moved out of the World');
    assert.ok(!/Movement follows real backend records/.test(world), 'the trailing hint is gone');
    // The canvas and the composer are now adjacent.
    const canvasAt = world.indexOf('id="game"');
    const composerAt = world.indexOf('id="world-composer"');
    assert.ok(canvasAt > 0 && composerAt > canvasAt, 'composer follows the canvas');
    assert.ok(!/town-hud/.test(world), 'the HUD is not authored in the World markup');
});

test('the renderer mounts the HUD into #status-world, keeping every id', () => {
    assert.match(townView, /document\.getElementById\('status-world'\)/);
    for (const id of ['town-connection', 'town-counts', 'town-summary', 'town-board',
        'town-rows', 'town-bubble-history', 'town-bubble-history-list', 'town-motion']) {
        assert.ok(townView.includes(`id="${id}"`), `town-view must still build #${id}`);
    }
});

test('the HUD is a single inline row whose disclosures open upward', () => {
    assert.match(townCss, /\.town-hud\s*\{[^}]*display:\s*flex/);
    assert.match(townCss, /\.town-more\s*>\s*div\s*\{[^}]*bottom:\s*calc\(100% \+ 8px\)/);
});

test('the strip region is laid out and hidden when empty', () => {
    assert.match(layout, /#status-world\s*\{[^}]*flex:\s*1 1 auto/);
    assert.match(layout, /#status-world:empty\s*\{\s*display:\s*none/);
});
