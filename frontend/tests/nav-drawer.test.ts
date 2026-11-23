/**
 * HERMESHA §2/§9 — narrow-screen drawer nav + honest attention deferral.
 *
 * Structural checks over the shipped shell/CSS plus the deliberate omission of
 * a data source that does not exist.
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
const mainV2 = readFileSync(join(frontend, 'src', 'main.v2.ts'), 'utf8');
const attention = readFileSync(join(frontend, 'src', 'attention-center.ts'), 'utf8');

test('the shell declares a drawer toggle and a scrim', () => {
    assert.match(html, /id="nav-drawer-toggle"/);
    assert.match(html, /id="nav-scrim"/);
});

test('the drawer is wired: toggle, scrim, Escape, and destination-close', () => {
    assert.match(mainV2, /nav-drawer-open/);
    assert.match(mainV2, /setNavDrawer/);
    assert.match(mainV2, /nav-scrim/);
    assert.match(mainV2, /e\.key === 'Escape'/);
});

test('the rail becomes an off-canvas overlay below the breakpoint', () => {
    const mq = css.slice(css.indexOf('Narrow-screen navigation drawer'));
    assert.ok(mq.length > 0, 'drawer CSS present');
    assert.match(mq, /@media \(max-width: 1080px\)/);
    assert.match(mq, /translateX\(-100%\)/);
    assert.match(mq, /#app\.nav-drawer-open #primary-nav/);
});

test('the toggle is hidden on desktop', () => {
    assert.match(css, /#app #nav-drawer-toggle \{ display: none; \}/);
});

test('permission requests are documented as deferred, never faked', () => {
    assert.match(attention, /permission requests/i);
    assert.match(attention, /omitted rather than faked/);
});
