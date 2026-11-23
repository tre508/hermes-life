/**
 * HERMESHA §2/§3/§5 — global search field + routing.
 *
 * The module self-wires at import; with no #global-search-input in the stub
 * document, initGlobalSearch() returns early, so the pure helpers are exercised
 * without a real DOM. navigation-state needs window/history/location/localStorage.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const frontend = join(here, '..');
const html = readFileSync(join(frontend, 'index.html'), 'utf8');
const src = readFileSync(join(frontend, 'src', 'global-search.ts'), 'utf8');
const mainV2 = readFileSync(join(frontend, 'src', 'main.v2.ts'), 'utf8');

// ---- minimal globals BEFORE importing the module ----
const g = globalThis as unknown as Record<string, unknown>;
g.document = {
    getElementById: () => null,
    addEventListener: () => { /* noop */ },
    createElement: () => ({
        style: {}, dataset: {}, append() {}, addEventListener() {}, setAttribute() {}, replaceChildren() {},
    }),
};
g.window = {
    addEventListener() { /* noop */ }, removeEventListener() { /* noop */ },
    dispatchEvent() { return true; }, setTimeout: () => 0, clearTimeout: () => { /* noop */ },
};
g.location = { pathname: '/', search: '' };
g.history = { state: null, replaceState() { /* noop */ }, pushState() { /* noop */ } };
g.localStorage = { getItem: () => null, setItem() { /* noop */ }, removeItem() { /* noop */ } };
g.CustomEvent = class { type: string; detail: unknown; constructor(t: string, o?: { detail?: unknown }) { this.type = t; this.detail = o?.detail; } };

const mod = await import('../src/global-search.ts');

// --------------------------------------------------------------------------- shell wiring

test('the top bar declares one aggregate search field', () => {
    assert.ok(html.includes('id="global-search-input"'), 'index.html must declare #global-search-input');
    assert.ok(html.includes('id="global-search-results"'), 'index.html must declare #global-search-results');
    assert.match(mainV2, /import '\.\/global-search'/);
});

test('the module reads the aggregate endpoint, not a per-surface search', () => {
    assert.match(src, /\/api\/search\?q=/);
});

test('the module routes through the canonical navigation intents only', () => {
    for (const fn of ['openTask', 'openWorkView', 'openWorkspace', 'setSelection']) {
        assert.ok(src.includes(fn), `global-search must use ${fn}`);
    }
    // It must not build its own history/URL navigation.
    assert.ok(!/history\.(push|replace)State/.test(src), 'no private history path');
});

// --------------------------------------------------------------------------- pure helpers

const r = (kind: string, id: string, intent: string, args: Record<string, unknown> = {}) => ({
    kind, id, title: id, excerpt: '', source: 'work_graph', score: 1, project_id: null,
    deeplink: { intent, args },
});

test('groupResults buckets by kind, preserving best-first order', () => {
    const groups = mod.groupResults([
        r('task', 't1', 'openTask'), r('note', 'n1', 'openNote'), r('task', 't2', 'openTask'),
    ]);
    const map = new Map(groups);
    assert.equal(map.get('task')!.length, 2);
    assert.deepEqual(map.get('task')!.map(x => x.id), ['t1', 't2']);
    assert.equal(map.get('note')!.length, 1);
});

test('resolveAction maps every backend intent', () => {
    assert.deepEqual(mod.resolveAction(r('task', 't1', 'openTask', { taskId: 't1' })),
        { type: 'task', taskId: 't1' });
    assert.deepEqual(mod.resolveAction(r('goal', 'g1', 'openWorkView', { workView: 'goals', selection: { kind: 'goal', id: 'g1' } })),
        { type: 'workview', workView: 'goals', selection: { kind: 'goal', id: 'g1' } });
    assert.deepEqual(mod.resolveAction(r('memory', 'm1', 'openWorkspace', { workspace: 'knowledge' })),
        { type: 'workspace', workspace: 'knowledge' });
    assert.deepEqual(mod.resolveAction(r('note', 'n1', 'openNote', { noteId: 'n1' })),
        { type: 'note', noteId: 'n1' });
});

test('resolveAction returns null for an unknown intent (never guesses)', () => {
    assert.equal(mod.resolveAction(r('task', 't1', 'launchMissiles')), null);
});
