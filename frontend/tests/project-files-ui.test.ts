/** Static contract for the project-files panel: registration, upload, open/edit.
 *
 * The gate blanks data-dependent UI headlessly, so these assert the shipped WIRING
 * (ids, endpoints, handlers) in src/phase412-project-ui.ts; behaviour lives with the
 * user's own browser pass plus the state fixture harness/composer-telemetry.html's
 * sibling to be added if states need fixtures.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const src = join(import.meta.dirname, '..', 'src');
const ui = readFileSync(join(src, 'phase412-project-ui.ts'), 'utf8');
const css = readFileSync(join(src, 'phase415-workspace.css'), 'utf8');

test('the workspace drawer lists registered projects and can select one', () => {
    assert.match(ui, /projectList\.id='hc415-project-list'/);
    assert.match(ui, /renderProjectList\(\)/);
    assert.match(ui, /hc415-project-select/);
    assert.match(css, /#hc415-project-list/);
});

test('registration: candidate directories from /api/projects/roots, one click to register', () => {
    assert.match(ui, /'\/api\/projects\/roots'/);
    assert.match(ui, /regList\.id='hc415-register-list'/);
    assert.match(ui, /regName\.id='hc415-register-name'/);
    // A pasted path wins over the chosen chip; the server still validates the
    // path against the allowed roots.
    assert.match(ui, /const root=pasted\|\|chosenRoot/);
    assert.match(ui, /await post\('\/api\/projects',\{name,host_path:root\}\)/);
    // The slug is derived, so an uppercase directory name (Vid-Gayzer) still registers.
    assert.match(ui, /slugify/);
    assert.match(css, /#hc415-register-list/);
    // Directories outside the default project folder: a paste field plus the
    // backend's extra allowed roots.
    assert.match(ui, /hc415-register-path/);
    assert.match(css, /#hc415-register-path/);
});

test('create: a brand-new project is one name away (directory + README; git optional)', () => {
    assert.match(ui, /'＋ Create'/);
    // Git is optional (VS Code-style): a plain folder is the default; the
    // checkbox opts into a repository (needed for sync/review).
    assert.match(ui, /hc415-create-git/);
    assert.match(ui, /await post\('\/api\/projects\/create',\{name,git:createGit\.checked\}\)/);
    assert.match(ui, /Created '\+name\+' — directory and README are ready/);
});

test('upload: local files land IN the project workspace via the write endpoint', () => {
    assert.match(ui, /sbInput\.type='file';sbInput\.multiple=true/);
    assert.match(ui, /sbInput\.click\(\)/);
    assert.match(ui, /await putFile\(f\.name,new TextDecoder\(\)\.decode\(buf\)\)/);
    assert.match(ui, /MAX_UPLOAD_BYTES=1_000_000/, 'mirrors the server cap');
    assert.match(ui, /looks binary/, 'binary uploads are refused client-side');
    assert.match(ui, /window\.confirm\(f\.name\+' already exists/, 'overwrite is confirmed');
});

test('open/edit/save: the preview has an editor and saves via PUT with a staleness guard', () => {
    assert.match(ui, /sbEditor\.id='hc415-file-editor'/);
    assert.match(ui, /sbEditBtn\.onclick=/);
    assert.match(ui, /sbSaveBtn\.onclick=/);
    assert.match(ui, /method:'PUT'/);
    assert.match(ui, /expected_mtime/);
    assert.match(ui, /Saved '\+state\.path\+' — uncommitted/);
    assert.match(css, /#hc415-file-editor/);
    assert.match(css, /\.hc415-preview-head/);
});

test('clicking a file OPENS it; attaching is an explicit control on the row', () => {
    assert.match(ui, /row\.onclick=\(\)=>\{void openFile\(node\.path\)\}/);
    assert.match(ui, /attach\.onclick=\(ev\)=>\{ev\.stopPropagation\(\);void toggleFile\(node\.path\)\}/);
    // Tree rows must not be <button> elements: they now contain their own buttons.
    assert.doesNotMatch(ui, /const row=document\.createElement\('button'\);row\.type='button';/);
    assert.match(ui, /row\.setAttribute\('role','button'\)/);
    // The old coupling — attach AND preview in one handler — is gone.
    assert.doesNotMatch(ui, /sbPreview\.textContent=f\.content;sbPreview\.setAttribute\('aria-label'/);
});
