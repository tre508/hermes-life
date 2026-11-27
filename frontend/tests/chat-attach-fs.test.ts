/**
 * §5 attachment architecture: attaching a hosted file or directory must NOT
 * require registering it as a project, and the picker must browse through the
 * server-side containment check rather than trusting the client.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src');
const attach = readFileSync(join(src, 'chat-attach.ts'), 'utf8');
const css = readFileSync(join(src, 'hermes-chat.css'), 'utf8');

test('the composer offers a hosted-filesystem picker, not a path prompt', () => {
    assert.match(attach, /function openHostPicker\(\)/, 'there is a real browser, not just a text prompt');
    assert.match(attach, /item\('Browse the host…'/, 'the menu exposes it');
    // The old flow asked the user to TYPE a path for files and folders.
    assert.ok(!/addChip\('file'\)|addChip\('folder'\)/.test(attach),
        'file/folder attach no longer routes through the type-a-path prompt');
});

test('the picker browses through the server containment check', () => {
    assert.match(attach, /fetch\('\/api\/fs\/list'/, 'listings come from the server');
    assert.match(attach, /function fsList\(path\?:string\)/, 'one level per request');
    // A refusal reason (outside the permitted roots / not a directory) is surfaced
    // to the user instead of failing silently.
    assert.match(attach, /Cannot list that folder — /, 'refusals are shown, not swallowed');
});

test('registered projects are a shortcut, never a requirement', () => {
    // The roots are offered first, and the projects list is fetched separately.
    assert.match(attach, /data\.roots/, 'permitted roots drive the shortcuts');
    assert.match(attach, /fetch\('\/api\/projects'\)/, 'registered projects are a shortcut');
    assert.match(attach, /shortcuts are optional/, 'the browser still works without the projects list');
});

test('the picker supports directories and files, multi-select, and up-navigation', () => {
    assert.match(attach, /type==='dir'\?'folder':'file'/, 'dirs and files both attach');
    assert.match(attach, /aria-multiselectable="true"/, 'multi-select is declared');
    assert.match(attach, /upEl\.dataset\.parent/, 'up is driven by the server-provided parent');
    assert.match(css, /\.hc-fs-picker\{/, 'the picker has its own surface');
    assert.match(css, /\.hc-fs-row\[data-type="dir"\]/, 'directories read differently from files');
});

test('attachment stays a REFERENCE, not inlined contents', () => {
    // §5: attaching a directory must not inject every file into the conversation.
    assert.match(attach, /Their contents are NOT included/, 'the block states contents are not inlined');
    assert.match(attach, /read them with your file tools as needed/, 'the worker reads on demand');
});

// --- D6: uploads are project-free (policy decision 2026-11-27) ----------------

test('image uploads go through the project-free endpoint, never the project route', () => {
    assert.match(attach, /fetch\('\/api\/fs\/upload'/, 'uploads land via the fs router');
    assert.ok(!/\/api\/projects\/\$\{encodeURIComponent\(project\)\}\/file/.test(attach),
        'the old project-coupled upload path is gone');
});

test('no upload item is gated behind a registered project', () => {
    assert.ok(!/data-needs-project/.test(attach), 'the needs-project gate is gone');
    assert.ok(!/refreshImageItems/.test(attach), 'no gating pass runs when the menu opens');
    assert.ok(!/conversationProject/.test(attach), 'no conversation→project lookup remains');
});
