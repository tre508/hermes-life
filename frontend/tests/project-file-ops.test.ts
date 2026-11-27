/**
 * D1–D5 (build spec d1-d5-build-spec.md): file-change subscription, explorer
 * create/rename/move, dirty tracking, open-doc persistence, chat file links.
 * Source-contract style like chat-attach-fs.test.ts — pins the behaviors the
 * spec requires so a refactor can't silently drop them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src');
const ui = readFileSync(join(src, 'phase412-project-ui.ts'), 'utf8');
const lib = readFileSync(join(src, 'project-editor-lib.ts'), 'utf8');
const css = readFileSync(join(src, 'phase415-workspace.css'), 'utf8');

// --- D1: live file-change events --------------------------------------------

test('the workspace subscribes to the existing hermes:event fan-out for file.changed', () => {
    assert.match(ui, /addEventListener\('hermes:event'/, 'reuses the main event stream');
    assert.match(ui, /evt\.type!=='file\.changed'/, 'filters to file.changed');
    assert.match(ui, /evt\.historical\)return/, 'replayed history never triggers refreshes');
    assert.match(ui, /void loadTree\(\)\},300\)/, 'tree refresh is debounced');
});

test('an external change never pulls a file out from under unsaved edits', () => {
    // The conflict branch must come BEFORE the reload branch and never reload.
    const dirty = ui.indexOf('if(dirtyDocs.has(st.path)){');
    const reload = ui.indexOf('void openFile(st.path)');
    assert.ok(dirty >= 0 && reload >= 0, 'both branches exist');
    assert.ok(dirty < reload, 'the dirty check guards the reload');
    assert.match(ui, /conflictDocs\.add\(st\.path\)/, 'the conflict is marked');
    assert.match(css, /hc415-tab\[data-conflict="true"\]/, 'the conflict is visible on the tab');
});

test('file.changed with change=deleted closes the tab honestly', () => {
    assert.match(ui, /p\.change==='deleted'/, 'deletions are handled distinctly');
});

// --- D2: create / rename / move ----------------------------------------------

test('the context menu offers create and rename/move on files and folders', () => {
    assert.match(ui, /'New file here…'/, 'dir rows create files inside');
    assert.match(ui, /'New folder here…'/, 'dir rows create folders inside');
    assert.match(ui, /'New file…'/, 'file rows create siblings');
    assert.match(ui, /'Rename \/ Move…'/, 'rename/move is offered');
});

test('create and move go through the workspace-scoped server routes', () => {
    assert.match(ui, /\/api\/projects\/\$\{encodeURIComponent\(choice\(\)\)\}\/dir/, 'mkdir endpoint');
    assert.match(ui, /\/api\/projects\/\$\{encodeURIComponent\(choice\(\)\)\}\/move/, 'move endpoint');
    assert.match(ui, /\{source:path,target:to\}/, 'source→target payload');
});

test('a rename/move prunes every client state pointing at the old path', () => {
    assert.match(ui, /function pruneUnder\(prefix:string\)/, 'the prune helper exists');
    assert.match(ui, /saveAttached\(\);persistOpenDocs\(\)/, 'attachments and tabs are pruned together');
});

test('the create/rename prompt is a dialog, not a browser prompt', () => {
    assert.match(ui, /function promptDialog\(title:string,value:string\)/, 'a dialog-based prompt');
    assert.match(css, /\.hc415-prompt\{/, 'it has its own surface');
    assert.ok(!/window\.prompt\(/.test(ui), 'no window.prompt');
});

// --- D4: dirty tracking -------------------------------------------------------

test('user edits mark the doc dirty; programmatic set() does not', () => {
    assert.match(lib, /updateListener\.of\(\(u\)=>\{\s*if\(u\.docChanged&&!programmatic\)userChange\?\.\(\)/,
        'the lib distinguishes user edits from set()');
    assert.match(lib, /programmatic=true;/, 'set() suppresses the dirty signal');
    assert.match(ui, /dirtyDocs=new Set<string>\(\)/, 'per-doc dirty set');
    assert.match(ui, /label\.textContent=mark\+name/, 'the tab shows the marker');
    assert.match(css, /hc415-tab\[data-dirty="true"\]/, 'dirty is styled');
});

test('closing a dirty tab asks; saving or cancelling clears the mark', () => {
    assert.match(ui, /has unsaved changes — discard them\?'/, 'close confirms');
    assert.match(ui, /dirtyDocs\.delete\(state\.path\);conflictDocs\.delete\(state\.path\)/, 'save clears dirty+conflict');
});

// --- D5: open-doc persistence -------------------------------------------------

test('open tabs and the active doc persist across reloads', () => {
    assert.match(ui, /OPEN_DOCS_KEY='hermes-life-project-open-docs'/, 'the storage key');
    assert.match(ui, /function persistOpenDocs\(\)/, 'writes on change');
    assert.match(ui, /function restoreOpenDocs\(\)/, 'restores on mount/select');
    assert.match(ui, /saved\.project!==choice\(\)\|\|!saved\.docs\.length\)return/, 'restores only for the same workspace');
    assert.match(ui, /captureScroll\(\)/, 'scroll is captured before a switch');
});

// --- D3: chat file links open Projects ----------------------------------------

test('consulted files are buttons that request a Projects open', () => {
    assert.match(ui, /hermes:projects:open-file/, 'the event contract');
    assert.match(ui, /hc415-consulted-link/, 'the footer renders links');
});

test('the open-file handler resolves absolute paths by registered project prefix', () => {
    assert.match(ui, /path\.startsWith\(root\+'\/'\)/, 'prefix resolution');
    assert.match(ui, /is not inside a registered workspace/, 'unresolvable paths say so honestly');
    assert.match(ui, /pendingOpen=path/, 'the request outranks tab restore');
});
