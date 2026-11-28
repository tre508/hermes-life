/**
 * HERMESHA §2/§9 — navigation contract after the top-bar restructure
 * (HL-UI-PLAN-001 §4.1). The left rail and its narrow-screen drawer are retired:
 * primary navigation is one horizontal row that scrolls on narrow screens, so no
 * destination is hidden behind a toggle. Also keeps the honest attention deferral.
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

test('the drawer toggle and scrim are retired with the rail', () => {
    assert.ok(!/id="nav-drawer-toggle"/.test(html), 'no drawer toggle in the shell');
    assert.ok(!/id="nav-scrim"/.test(html), 'no drawer scrim in the shell');
    assert.ok(!/setNavDrawer|nav-drawer-open/.test(mainV2), 'no drawer wiring left in main.v2');
    assert.ok(!/nav-drawer/.test(css), 'no drawer CSS left');
});

test('primary navigation is a single horizontal row that scrolls on narrow screens', () => {
    assert.match(css, /#app #primary-nav \{[^}]*display: flex;[^}]*overflow-x: auto;/);
    assert.ok(!/translateX\(-100%\)/.test(css), 'no off-canvas rail transform');
});

test('permission requests are documented as deferred, never faked', () => {
    assert.match(attention, /permission requests/i);
    assert.match(attention, /omitted rather than faked/);
});
