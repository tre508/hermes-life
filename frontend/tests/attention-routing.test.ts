/**
 * WS1 / audit D3 — Attention "Resolve in Memory" must route to Knowledge.
 *
 * The nav regroup folded Memory into Knowledge; the `system` workspace no
 * longer has a section in the shell, so `openWorkspace('system')` blanks the
 * main pane — `openWorkspace` does NOT run the `parseNavQuery` system→knowledge
 * redirect (see navigation-url.test.ts, which relies on that being a no-op).
 *
 * attention-center.ts is a DOM module that self-wires at import time, so it is
 * asserted at the source level; navigation-state.ts is exercised behaviourally
 * against a minimal browser-global stub.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const frontend = join(here, '..');
const html = readFileSync(join(frontend, 'index.html'), 'utf8');
const attention = readFileSync(join(frontend, 'src', 'attention-center.ts'), 'utf8');

// ---------------------------------------------------------------------------
// Minimal browser-global stub BEFORE importing navigation-state.
// ---------------------------------------------------------------------------
type HistEntry = { url: string; state: unknown };
const store = { entries: [] as HistEntry[], index: -1 };
let currentPath = '/';
let currentSearch = '';
function setUrl(url: string): void {
    const q = url.indexOf('?');
    if (q === -1) { currentPath = url; currentSearch = ''; }
    else { currentPath = url.slice(0, q); currentSearch = url.slice(q + 1); }
}
class FakeHistory {
    state: unknown = null;
    pushState(state: unknown, _title: string, url: string): void {
        store.entries = store.entries.slice(0, store.index + 1);
        store.entries.push({ url, state });
        store.index = store.entries.length - 1;
        this.state = state; setUrl(url);
    }
    replaceState(state: unknown, _title: string, url: string): void {
        if (store.index >= 0) store.entries[store.index] = { url, state };
        else store.entries.push({ url, state });
        this.state = state; setUrl(url);
    }
}
const g = globalThis as unknown as Record<string, unknown>;
g.location = {
    get pathname() { return currentPath; },
    get search() { return currentSearch ? `?${currentSearch}` : ''; },
};
g.history = new FakeHistory();
const winStub = {
    addEventListener() { /* noop */ },
    removeEventListener() { /* noop */ },
    dispatchEvent() { return true; },
};
g.window = winStub;
g.addEventListener = winStub.addEventListener;
g.removeEventListener = winStub.removeEventListener;
class FakeCustomEvent { type: string; detail: unknown; constructor(type: string, opts?: { detail?: unknown }) { this.type = type; this.detail = opts?.detail; } }
g.CustomEvent = FakeCustomEvent;
const memStore = new Map<string, string>();
g.localStorage = {
    getItem: (k: string) => (memStore.has(k) ? memStore.get(k)! : null),
    setItem: (k: string, v: string) => { memStore.set(String(k), String(v)); },
    removeItem: (k: string) => { memStore.delete(k); },
    clear: () => memStore.clear(),
    key: (i: number) => Array.from(memStore.keys())[i] ?? null,
    get length() { return memStore.size; },
};

const nav = await import('../src/navigation-state.ts');

// ---------------------------------------------------------------------------

test('memory attention item routes to Knowledge, never the removed system workspace', () => {
    assert.match(attention, /openWorkspace\('knowledge'\)/,
        'memory attention item must open the Knowledge workspace');
    assert.ok(!attention.includes("openWorkspace('system')"),
        "attention must not route to the removed 'system' workspace");
});

test("'system' has no workspace section; 'knowledge' does (and holds Memory)", () => {
    assert.ok(!html.includes('id="workspace-system"'), 'system workspace section is gone');
    assert.ok(html.includes('id="workspace-knowledge"'), 'knowledge workspace section exists');
    const knowledgeSection = html.slice(html.indexOf('id="workspace-knowledge"'));
    assert.ok(knowledgeSection.includes('id="memory-section"'),
        'memory reviews are folded into the Knowledge workspace');
});

test("openWorkspace('knowledge') lands on a workspace that actually renders", () => {
    nav.openWorkspace('knowledge');
    assert.equal(nav.getCurrentWorkspace(), 'knowledge');
});

test("openWorkspace('system') lands on a workspace with no section (the old bug)", () => {
    nav.openWorkspace('system');
    // No redirect happens inside openWorkspace — this is why the old code blanked.
    assert.equal(nav.getCurrentWorkspace(), 'system');
    assert.ok(!html.includes('id="workspace-system"'));
});
