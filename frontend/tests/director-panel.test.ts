/**
 * HERMESHA §7/§8 — Director identity panel + visible work origin.
 *
 * The panel self-wires at import; with a null-returning stub document the
 * wiring is inert, so the pure summariser is exercised directly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const frontend = join(here, '..');
const html = readFileSync(join(frontend, 'index.html'), 'utf8');
const mainV2 = readFileSync(join(frontend, 'src', 'main.v2.ts'), 'utf8');
const townView = readFileSync(join(frontend, 'src', 'town-view.ts'), 'utf8');

const g = globalThis as unknown as Record<string, unknown>;
g.document = { getElementById: () => null, addEventListener: () => { /* noop */ } };
g.window = {
    addEventListener() { /* noop */ }, removeEventListener() { /* noop */ },
    dispatchEvent() { return true; }, setTimeout: () => 0, clearTimeout: () => { /* noop */ },
    setInterval: () => 0, clearInterval: () => { /* noop */ },
};
g.location = { pathname: '/', search: '' };
g.history = { state: null, replaceState() { /* noop */ }, pushState() { /* noop */ } };
g.localStorage = { getItem: () => null, setItem() { /* noop */ }, removeItem() { /* noop */ } };
g.CustomEvent = class { type: string; detail: unknown; constructor(t: string, o?: { detail?: unknown }) { this.type = t; this.detail = o?.detail; } };

const mod = await import('../src/director-panel.ts');

// --------------------------------------------------------------------------- pure

const base = { goals: [], runs: [], projects: [], experiences: [], pending: 0 };

test('focus is the newest non-terminal goal', () => {
    const view = mod.summarizeDirector({
        ...base,
        goals: [
            { title: 'Old goal', state: 'completed', created_at: '2026-01-01' },
            { title: 'Current goal', state: 'running', created_at: '2026-02-01' },
            { title: 'Newer done', state: 'failed', created_at: '2026-03-01' },
        ],
    });
    assert.equal(view.focus, 'Current goal');
});

test('focus is empty (not a repeated Idle) with no active goal', () => {
    assert.equal(mod.summarizeDirector(base).focus, '—');
});

test('project prefers the newest run, else the active autonomy project', () => {
    const fromRun = mod.summarizeDirector({
        ...base,
        runs: [{ project: 'alpha', created_at: '2026-02-01' }, { project: 'beta', created_at: '2026-01-01' }],
        projects: [{ name: 'gamma', status: 'active', updated_at: '2026-03-01' }],
    });
    assert.equal(fromRun.project, 'alpha');

    const fromProject = mod.summarizeDirector({
        ...base, runs: [], projects: [{ name: 'gamma', status: 'active', updated_at: '2026-03-01' }],
    });
    assert.equal(fromProject.project, 'gamma');

    assert.equal(mod.summarizeDirector(base).project, '—');
});

test('recent counts recorded outcomes and names the latest', () => {
    const view = mod.summarizeDirector({
        ...base,
        experiences: [{ summary: 'Shipped the ledger fix' }, { task_id: 't2' }],
    });
    assert.match(view.recent, /2 outcome/);
    assert.match(view.recent, /Shipped the ledger fix/);
    assert.equal(mod.summarizeDirector(base).recent, '—');
});

test('pending reflects the live attention count', () => {
    assert.equal(mod.summarizeDirector({ ...base, pending: 0 }).pending, 'None');
    assert.equal(mod.summarizeDirector({ ...base, pending: 3 }).pending, '3 awaiting you');
});

test('current state is Active while work is live, Idle otherwise', () => {
    assert.equal(mod.summarizeDirector(base).state, 'Idle');
    assert.equal(mod.summarizeDirector({ ...base, goals: [{ title: 'g', state: 'running', created_at: 'x' }] }).state, 'Active');
    assert.equal(mod.summarizeDirector({ ...base, runs: [{ project: 'p', state: 'candidate_passed', created_at: 'x' }] }).state, 'Active');
    assert.equal(mod.summarizeDirector({ ...base, runs: [{ project: 'p', state: 'completed', created_at: 'x' }] }).state, 'Idle');
});

test('the duplicate "Current work" block is gone; the identity block owns those facts', () => {
    assert.ok(!/Workspace status · Current work/.test(html), 'the duplicate block must be removed');
    assert.ok(!html.includes('id="current-task"'), 'its ids are dead');
    const id = html.slice(html.indexOf('id="director-identity"'));
    for (const field of ['director-state', 'director-focus', 'director-project', 'director-recent', 'director-pending']) {
        assert.ok(id.includes(field), `the identity block must carry #${field}`);
    }
});

// --------------------------------------------------------------------------- wiring

test('index.html declares the Director identity fields and actions', () => {
    for (const id of ['director-identity', 'director-focus', 'director-project',
        'director-recent', 'director-pending', 'director-open-conversation',
        'director-inspect-work', 'director-view-activity']) {
        assert.ok(html.includes(`id="${id}"`), `index.html must declare #${id}`);
    }
    assert.match(mainV2, /import '\.\/director-panel'/);
});

test('the World surfaces work origin (autonomous vs user-directed)', () => {
    // §10 consistency pass (2026-11-25): the origin answers use the uniform
    // "Why" label on both World cards, and the resident's why names its cause
    // (the owning goal's title), not just the classification.
    assert.match(townView, /fqLine\(FQ\.why, here\.length/);
    assert.match(townView, /\['Why', isAutonomousTask\(resident\.taskId\)/);
    assert.match(townView, /goalTitles\.get\(resident\.taskId\)/);
});
