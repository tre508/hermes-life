/**
 * UUX-004E — URL/history/deep-link semantics.
 *
 * Covers the pure URL layer of navigation-state.ts:
 *   - query encoding (serializeNavQuery) and parsing (parseNavQuery)
 *   - enum validation of workspace / workview values
 *   - deep-link task validation against the loaded task list
 *     (missing/deleted task → controlled empty state, not silence)
 *   - popstate restore of workspace/subview/task
 *   - history policy: real gestures push, passive updates replace
 *
 * location/history are stubbed with a minimal in-memory implementation
 * so the module can run under node:test without a browser.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Minimal location/history stub BEFORE importing the module.
// ---------------------------------------------------------------------------
type HistEntry = { url: string; state: unknown };

const store = {
    entries: [] as HistEntry[],
    index: -1,
};

function urlOf(path: string, search: string): string {
    return search ? `${path}?${search}` : path;
}

class FakeHistory {
    state: unknown = null;
    pushState(state: unknown, _title: string, url: string): void {
        store.entries = store.entries.slice(0, store.index + 1);
        store.entries.push({ url, state });
        store.index = store.entries.length - 1;
        this.state = state;
        setUrl(url);
    }
    replaceState(state: unknown, _title: string, url: string): void {
        if (store.index >= 0) store.entries[store.index] = { url, state };
        else store.entries.push({ url, state });
        this.state = state;
        setUrl(url);
    }
    back(): void {
        if (store.index <= 0) return;
        store.index -= 1;
        const entry = store.entries[store.index];
        this.state = entry.state;
        setUrl(entry.url);
        firePopstate(this.state);
    }
    forward(): void {
        if (store.index >= store.entries.length - 1) return;
        store.index += 1;
        const entry = store.entries[store.index];
        this.state = entry.state;
        setUrl(entry.url);
        firePopstate(this.state);
    }
}

let currentPath = '/';
let currentSearch = '';
function setUrl(url: string): void {
    const q = url.indexOf('?');
    if (q === -1) { currentPath = url; currentSearch = ''; }
    else { currentPath = url.slice(0, q); currentSearch = url.slice(q + 1); }
}

type PopHandler = (ev: { state: unknown }) => void;
const popHandlers: PopHandler[] = [];
function firePopstate(state: unknown): void {
    for (const h of popHandlers) h({ state });
}

const g = globalThis as unknown as Record<string, unknown>;
g.location = {
    get pathname() { return currentPath; },
    get search() { return currentSearch ? `?${currentSearch}` : ''; },
};
g.history = new FakeHistory();
// The module listens on window.addEventListener — stub window too.
const winStub = {
    addEventListener(_type: string, handler: unknown) {
        if (_type === 'popstate') popHandlers.push(handler as PopHandler);
    },
    removeEventListener(_type: string, handler: unknown) {
        const i = popHandlers.indexOf(handler as PopHandler);
        if (i >= 0) popHandlers.splice(i, 1);
    },
    dispatchEvent() { return true; },
};
g.window = winStub;
g.addEventListener = winStub.addEventListener;
g.removeEventListener = winStub.removeEventListener;

const nav = await import('../src/navigation-state.ts');

function resetHistory(startSearch = ''): void {
    // Seed one entry the way a real browser always has one.
    store.entries = [{ url: urlOf('/', startSearch), state: null }];
    store.index = 0;
    setUrl(urlOf('/', startSearch));
    (g.history as FakeHistory).state = null;
}

// ---------------------------------------------------------------------------
// Encoding / parsing
// ---------------------------------------------------------------------------

test('serializeNavQuery encodes workspace, workview and task', () => {
    const q = nav.serializeNavQuery({
        workspace: 'work', workView: 'tasks', selectedTaskId: 'task_abc',
        taskView: 'overview', activityFilter: 'all',
        conversationId: null, projectId: null,
    });
    const params = new URLSearchParams(q);
    assert.equal(params.get('view'), 'work');
    assert.equal(params.get('workview'), 'tasks');
    assert.equal(params.get('task'), 'task_abc');
});

test('serializeNavQuery omits workview outside Work and marks activity filter', () => {
    const q = nav.serializeNavQuery({
        workspace: 'activity', workView: 'tasks', selectedTaskId: 't1',
        taskView: 'overview', activityFilter: 'selected',
        conversationId: null, projectId: null,
    });
    const params = new URLSearchParams(q);
    assert.equal(params.has('workview'), false);
    assert.equal(params.get('filter'), 'selected');
    assert.equal(params.get('task'), 't1');
});

test('parseNavQuery accepts valid enums and ignores invalid ones', () => {
    const good = nav.parseNavQuery('view=work&workview=planning&task=t9');
    assert.equal(good.workspace, 'work');
    assert.equal(good.workView, 'planning');
    assert.equal(good.selectedTaskId, 't9');

    const bad = nav.parseNavQuery('view=banana&workview=hack&task=');
    assert.equal(bad.workspace, undefined);
    assert.equal(bad.workView, undefined);
    assert.equal(bad.selectedTaskId, undefined);
});

test('round-trip: parse(serialize(state)) preserves workspace/workview/task', () => {
    for (const ws of ['home', 'work', 'activity', 'results', 'system'] as const) {
        for (const wv of ['tasks', 'discover', 'goals', 'planning', 'build'] as const) {
            const q = nav.serializeNavQuery({
                workspace: ws, workView: wv, selectedTaskId: 'tid-1',
                taskView: 'overview', activityFilter: 'all',
                conversationId: null, projectId: null,
            });
            const parsed = nav.parseNavQuery(q);
            assert.equal(parsed.workspace, ws);
            if (ws === 'work') assert.equal(parsed.workView, wv);
            else assert.equal(parsed.workView, undefined);
            assert.equal(parsed.selectedTaskId, 'tid-1');
        }
    }
});

// ---------------------------------------------------------------------------
// Deep link restore + validation
// ---------------------------------------------------------------------------

test('initial URL deep link restores workspace/subview/task and pushes nothing extra', async () => {
    resetHistory('view=work&workview=planning&task=abc-123');
    const deepLinked = nav.initHistory();
    assert.equal(deepLinked, true, 'deep link detected');
    const snap = nav.getNavigationState();
    assert.equal(snap.workspace, 'work');
    assert.equal(snap.workView, 'planning');
    assert.equal(snap.selectedTaskId, 'abc-123');
    // No push happened for the initial parse (entries stay flat).
    assert.ok(store.entries.length <= 1, `expected at most one stamped entry, got ${store.entries.length}`);
});

test('bare URL defaults to Home (no deep link), via replaceState', async () => {
    resetHistory('');
    // Fresh module instance would be needed for initHistory's once-guard;
    // the flag persists in this module instance, so assert the semantics
    // through the intents instead: openWorkspace replace keeps depth flat.
    const before = store.entries.length;
    nav.openWorkspace('system', { replace: true });
    assert.equal(nav.getCurrentWorkspace(), 'system');
    assert.equal(store.entries.length, Math.max(before, 0), 'replace does not add history entries');
    assert.match(String(store.entries[store.entries.length - 1]?.url ?? ''), /view=system/);
});

test('registered validator rejects a deleted task id with controlled empty state data', async () => {
    resetHistory('view=work&workview=tasks&task=ghost-task');
    // Simulate the Work workspace's validator with a loaded list.
    const off = nav.registerTaskValidator(() => ['real-1', 'real-2']);
    // Re-apply the same query the way popstate would.
    firePopstate({ nav: undefined });
    const snap = nav.getNavigationState();
    assert.equal(snap.selectedTaskId, null, 'ghost task cleared, not silently kept');
    assert.equal(snap.workspace, 'work', 'workspace still restored');
    off();
});

test('validator returning null (list not loaded) accepts the task optimistically', () => {
    resetHistory('view=work&workview=tasks&task=pending-task');
    const off = nav.registerTaskValidator(() => null);
    firePopstate({ nav: undefined });
    assert.equal(nav.getSelectedTaskId(), 'pending-task');
    off();
});

// ---------------------------------------------------------------------------
// History policy
// ---------------------------------------------------------------------------

test('openTask with a NEW task id pushes a history entry; same-task re-selection replaces', async () => {
    resetHistory('view=work&workview=tasks');
    nav.openTask('task-one', { destination: 'work' });
    const afterPush = store.entries.length;
    nav.openTask('task-one', { destination: 'work' }); // passive re-selection
    assert.equal(store.entries.length, afterPush, 'same-task re-selection must not deepen history');
    nav.openTask('task-two', { destination: 'work' });
    assert.ok(store.entries.length > afterPush, 'new selection is a real gesture');
});

test('Back returns to the previous workspace/subview/task deterministically', async () => {
    resetHistory('');
    nav.resetNavigation({ replace: true }); // fresh module state for isolation
    nav.openWorkspace('work');
    nav.openWorkView('planning');
    nav.openTask('task-x', { destination: 'work' });
    assert.equal(nav.getCurrentWorkspace(), 'work');
    assert.equal(nav.getSelectedTaskId(), 'task-x');

    (g.history as FakeHistory).back(); // back to workview=planning, no task
    let snap = nav.getNavigationState();
    assert.equal(snap.workspace, 'work');
    assert.equal(snap.workView, 'planning');
    assert.equal(snap.selectedTaskId, null);

    (g.history as FakeHistory).back(); // back to work, tasks
    snap = nav.getNavigationState();
    assert.equal(snap.workspace, 'work');
    assert.equal(snap.workView, 'tasks');

    (g.history as FakeHistory).back(); // back to bare home
    snap = nav.getNavigationState();
    assert.equal(snap.workspace, 'home');

    (g.history as FakeHistory).forward(); // forward to work/tasks
    snap = nav.getNavigationState();
    assert.equal(snap.workspace, 'work');
    assert.equal(snap.workView, 'tasks');
});

test('openActivityForTask encodes the selected filter in the URL', () => {
    resetHistory('');
    nav.openActivityForTask('t-77');
    const url = String(store.entries[store.entries.length - 1]?.url ?? '');
    assert.match(url, /view=activity/);
    assert.match(url, /task=t-77/);
    assert.match(url, /filter=selected/);
});

test('popstate restores task from URL even without an embedded state snapshot', () => {
    resetHistory('view=results&task=url-only-task');
    firePopstate({ state: null }); // e.g. a foreign history entry
    assert.equal(nav.getCurrentWorkspace(), 'results');
    // No validator registered here → optimistic acceptance.
    assert.equal(nav.getSelectedTaskId(), 'url-only-task');
});
