/**
 * HL-WORK-001 M1 — typed per-workview selection + Context Inspector.
 *
 * Covers the selection model (navigation-state.ts) with an in-memory
 * localStorage stub, plus static-source checks that the inspector panel
 * is owned by context-inspector.ts and that work-workspace no longer
 * writes the global panel directly (the stale-selection bug).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// In-memory localStorage BEFORE importing the module.
const mem = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
};

const here = dirname(fileURLToPath(import.meta.url));
const {
    setSelection, getSelection, getValidSelection, viewAccepts,
    HERMES_SELECTIONS_KEY,
} = await import('../src/navigation-state.ts');
const { KIND_LABEL } = await import('../src/context-inspector.ts');

test('selection is typed per workview and isolated between views', () => {
    setSelection('tasks', { kind: 'task', id: 't-1' });
    assert.deepEqual(getSelection('tasks'), { kind: 'task', id: 't-1' });
    // Other views own their own (empty) selection — no leakage.
    assert.equal(getSelection('build'), null);
    assert.equal(getSelection('projects'), null);
    assert.equal(getValidSelection('build'), null);
});

test('a foreign-kind selection never validates for a view', () => {
    setSelection('tasks', { kind: 'task', id: 't-2' });
    assert.equal(viewAccepts('build', { kind: 'task', id: 't-2' }), false);
    assert.equal(getValidSelection('build'), null);
    assert.equal(viewAccepts('tasks', { kind: 'task', id: 't-2' }), true);
    setSelection('tasks', { kind: 'task', id: 't-2' });
    assert.equal(getValidSelection('tasks')?.id, 't-2');
});

test('selections persist to localStorage and reload', () => {
    setSelection('projects', { kind: 'project', id: 'hl-demo' });
    const raw = JSON.parse(mem.get(HERMES_SELECTIONS_KEY)!) as Record<string, unknown>;
    assert.deepEqual(raw.projects, { kind: 'project', id: 'hl-demo' });
});

test('clearing a selection empties it and persists', () => {
    setSelection('projects', { kind: 'project', id: 'hl-demo' });
    setSelection('projects', null);
    assert.equal(getSelection('projects'), null);
    const raw = JSON.parse(mem.get(HERMES_SELECTIONS_KEY)!) as Record<string, unknown>;
    assert.equal(raw.projects, null);
});

test('selection change listeners fire only on real changes', async () => {
    let calls = 0;
    const nav = await import('../src/navigation-state.ts');
    const off = nav.onSelectionChange(() => { calls += 1; });
    nav.setSelection('goals', { kind: 'goal', id: 'g-1' });
    nav.setSelection('goals', { kind: 'goal', id: 'g-1' }); // same — no notify
    assert.equal(calls, 1);
    off();
});

test('every workview has a domain kind mapping', async () => {
    const { VIEW_SELECTION_KINDS, WORK_VIEWS } = await import('../src/navigation-state.ts');
    for (const v of WORK_VIEWS) assert.ok(VIEW_SELECTION_KINDS[v]?.length === 1, `view ${v} lacks domain kind`);
    assert.deepEqual(VIEW_SELECTION_KINDS.build, ['build']);
});

test('inspector kind labels cover all selection kinds', () => {
    for (const k of ['task', 'discovery', 'goal', 'plan', 'build', 'project'] as const) {
        assert.ok(KIND_LABEL[k]);
    }
});

test('static: the panel is owned by the inspector, not written by work-workspace', () => {
    const inspector = readFileSync(join(here, '../src/context-inspector.ts'), 'utf8');
    const work = readFileSync(join(here, '../src/work-workspace.ts'), 'utf8');
    const main = readFileSync(join(here, '../src/main.v2.ts'), 'utf8');
    const html = readFileSync(join(here, '../index.html'), 'utf8');
    assert.match(html, /id="ctx-inspector"/);
    assert.doesNotMatch(html, /ctx-selection/);
    assert.doesNotMatch(work, /ctx-selection|ctx-inspector/);
    assert.match(work, /setSelection\('tasks'/);
    assert.match(inspector, /ctx-inspector-body/);
    assert.doesNotMatch(main, /ctx-selection/);
    assert.match(main, /initContextInspector\(\)/);
});
