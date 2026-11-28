/**
 * HERMESHA §5/§6 — the conversation inside the World (one composer, one thread).
 *
 * The module self-wires at import; a null-returning stub document makes the
 * wiring inert, so importing it verifies it loads without a DOM.
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
const src = readFileSync(join(frontend, 'src', 'world-composer.ts'), 'utf8');
const chat = readFileSync(join(frontend, 'src', 'hermes-chat.ts'), 'utf8');

const g = globalThis as unknown as Record<string, unknown>;
g.document = { getElementById: () => null, addEventListener: () => { /* noop */ } };
g.window = { addEventListener() { /* noop */ }, dispatchEvent() { return true; }, setTimeout: () => 0 };
g.CustomEvent = class { type: string; detail: unknown; constructor(t: string, o?: { detail?: unknown }) { this.type = t; this.detail = o?.detail; } };

const mod = await import('../src/world-composer.ts');

test('the module loads and exposes its initialiser', () => {
    assert.equal(typeof mod.initWorldComposer, 'function');
});

test('index.html declares the World composer bar', () => {
    for (const id of ['world-composer', 'world-composer-input', 'world-composer-attach',
        'world-composer-workspace', 'world-composer-send']) {
        assert.ok(html.includes(`id="${id}"`), `index.html must declare #${id}`);
    }
    assert.match(mainV2, /import '\.\/world-composer'/);
});

test('Send hands off to the ONE chat with submit:true (no second send path)', () => {
    assert.match(src, /hermes:open-in-chat/);
    assert.match(src, /submit: true/);
    // It must not POST /api/tasks itself — the chat owns the send path.
    assert.ok(!/api\/tasks/.test(src), 'the World composer must not create its own task');
});

test('the World composer reports what happened (a send is never a silent no-op)', () => {
    assert.ok(html.includes('id="world-composer-status"'), 'index.html must declare #world-composer-status');
    assert.match(html, /id="world-composer-status"[^>]*role="status"|role="status"[^>]*id="world-composer-status"/);
    assert.match(src, /world-composer-status/);
    assert.match(src, /Sent — the reply streams into the live conversation/);
});

test('the chat honours the submit flag through its own form', () => {
    assert.match(chat, /submit\?:boolean/);
    assert.match(chat, /if\(d\.submit\)\{/);
});
