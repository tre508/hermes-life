/**
 * Phase 3 — chat markdown images (HA-014) + attachment provenance/persistence/
 * preview (HA-037/038/039) + Artifacts picker + mode control (HA-011 contract).
 *
 * safeImageSrc is a pure guard and gets real headless coverage; the DOM work is
 * pinned source-contract style (the repo's established pattern).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

import { safeImageSrc } from '../src/chat-markdown.ts';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src');
const md = readFileSync(join(src, 'chat-markdown.ts'), 'utf8');
const attach = readFileSync(join(src, 'chat-attach.ts'), 'utf8');

// ── HA-014: image source guard (pure) ─────────────────────────────────────

test('safeImageSrc admits only inert image sources', () => {
    assert.equal(safeImageSrc('https://example.com/a.png'), 'https://example.com/a.png');
    assert.equal(safeImageSrc('http://example.com/a.png'), 'http://example.com/a.png');
    assert.equal(safeImageSrc('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
    assert.equal(safeImageSrc('javascript:alert(1)'), null);
    assert.equal(safeImageSrc('data:text/html,<script>'), null);
    assert.equal(safeImageSrc('file:///etc/passwd'), null);
    assert.equal(safeImageSrc('/home/gayzer/x.png'), null);
    assert.equal(safeImageSrc(''), null);
});

test('HA-014: markdown renders images and host-path reference chips', () => {
    // Behavioral proof (escape-proof): extract the real pattern from the
    // source and match actual markdown against it.
    const patLine = md.split('\n').find(l => l.includes('const pattern')) ?? '';
    const extracted = /const pattern = \/(.*)\/g;/.exec(patLine)?.[1] ?? '';
    const re = new RegExp(extracted, 'g');
    re.lastIndex = 0;
    assert.equal('x ![alt](https://a/b.png) y'.match(re)?.[0], '![alt](https://a/b.png)',
        'image syntax is tokenized');
    assert.match(md, /document\.createElement\('img'\)/, 'a real <img> is created for safe sources');
    assert.match(md, /referrerPolicy = 'no-referrer'/, 'images are sandboxed-ish (no referrer)');
    assert.match(md, /hermes:projects:open-file/, 'host paths dispatch the open-in-Projects event');
    assert.match(md, /safeImageSrc/, 'the guard is on the render path');
});

// ── HA-037: uploaded vs host-reference provenance ─────────────────────────

test('HA-037: uploads are marked and distinguished in the send block', () => {
    assert.match(attach, /uploaded\?:boolean/, 'chip type carries provenance');
    assert.match(attach, /uploaded:true/, 'upload path marks its chips');
    assert.match(attach, /\[Uploaded files\]/, 'the send block names uploads separately');
    assert.match(attach, /\[Host references\]/, 'the send block names host references separately');
    assert.ok(attach.includes('dataset.uploaded'), 'the chip shows the provenance badge');
});

// ── HA-038: chips persist per conversation ────────────────────────────────

test('HA-038: chips survive reloads and conversation switches', () => {
    assert.match(attach, /const CHIPS_KEY=/, 'a persistence key exists');
    assert.match(attach, /function persistChips/, 'chips are persisted');
    assert.match(attach, /function restoreChips/, 'chips are restored');
    assert.match(attach, /hc-conversation-changed',\(\)=>restoreChips\(\)/,
        'switching conversations swaps the chips');
});

// ── HA-039: preview popover ───────────────────────────────────────────────

test('HA-039: chips open a preview popover', () => {
    assert.match(attach, /showChipPreview/, 'preview entry point exists');
    assert.match(attach, /hc-chip-preview/, 'popover is rendered');
    assert.match(attach, /Preview unavailable here/, 'honest fallback when no reader applies');
});

// ── HA-014 artifacts source + HA-011 mode-control contract ────────────────

test('Artifacts picker reads the durable file-change records', () => {
    assert.match(attach, /item\('Artifacts…'/, 'menu source exists');
    assert.match(attach, /\/api\/events\?tail=/, 'backed by the event store');
    assert.match(attach, /file\.changed/, 'filtered to file-change records');
});

test('HA-011 contract: composer owns the attach-mode control', () => {
    assert.match(attach, /MODE_KEY='hermes...ode'/,
        'same storage key phase412-project-ui.ts reads');
    assert.match(attach, /hc-attach-mode/, 'mode select lives in the composer');
    assert.match(attach, /export function getAttachMode/, 'readable by the IDE submit path');
});
