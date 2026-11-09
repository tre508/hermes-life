/**
 * UI-VIS-002 / convo-redesign — Conversation composer + thread tests.
 *
 * The conv-composer is a DOM module, so node:test runs it against
 * jsdom-style DOM via the bare node:test harness. node:test's `test` runs
 * against the Node environment by default, not jsdom; we therefore
 * exercise the composer's pure helpers (draftKey, readDraft, clearDraft,
 * the conversation-id routing contract) via localStorage shim rather
 * than instantiating the full mount. The actual DOM wiring is verified
 * in the browser harness via dispatched events (see verify step).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { readDraft, clearDraft, composerConstants } from '../src/conv-composer.ts';

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number { return this.store.size; }
  clear() { this.store.clear(); }
  key(i: number): string | null { return Array.from(this.store.keys())[i] ?? null; }
  getItem(k: string): string | null { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) { this.store.set(String(k), String(v)); }
  removeItem(k: string) { this.store.delete(k); }
}

let originalStorage: Storage | undefined;

before(() => {
  originalStorage = globalThis.localStorage;
  (globalThis as { localStorage?: Storage }).localStorage = new MemoryStorage();
});
after(() => {
  if (originalStorage !== undefined) {
    (globalThis as { localStorage?: Storage }).localStorage = originalStorage;
  }
});

describe('Conversation composer — draft ledger', () => {
  test('readDraft returns empty string for an unknown conversation', () => {
    clearDraft(null);
    clearDraft('11111111-2222-3333-4444-555555555555');
    assert.strictEqual(readDraft(null), '');
    assert.strictEqual(readDraft('11111111-2222-3333-4444-555555555555'), '');
  });

  test('readDraft returns the value that was previously set via localStorage', () => {
    const key = composerConstants.DRAFT_KEY_PREFIX + 'conv-A';
    localStorage.setItem(key, 'half-typed reply');
    assert.strictEqual(readDraft('conv-A'), 'half-typed reply');
  });

  test('clearDraft removes the value (no orphan leftover after submit)', () => {
    localStorage.setItem(composerConstants.DRAFT_KEY_PREFIX + 'conv-B', 'draft');
    assert.strictEqual(readDraft('conv-B'), 'draft');
    clearDraft('conv-B');
    assert.strictEqual(readDraft('conv-B'), '');
  });

  test('distinct conversation ids do not collide in storage', () => {
    const convA = '11111111-aaaa-bbbb-cccc-111111111111';
    const convB = '22222222-aaaa-bbbb-cccc-222222222222';
    localStorage.setItem(composerConstants.DRAFT_KEY_PREFIX + convA, 'A draft');
    localStorage.setItem(composerConstants.DRAFT_KEY_PREFIX + convB, 'B draft');
    assert.strictEqual(readDraft(convA), 'A draft');
    assert.strictEqual(readDraft(convB), 'B draft');
    clearDraft(convA);
    assert.strictEqual(readDraft(convA), '');
    assert.strictEqual(readDraft(convB), 'B draft');
  });

  test('null-conversation sentinel uses a separate key from real ids', () => {
    localStorage.setItem(composerConstants.DRAFT_KEY_NIL, 'orphan draft');
    localStorage.setItem(composerConstants.DRAFT_KEY_PREFIX + 'real-id', 'real draft');
    assert.strictEqual(readDraft(null), 'orphan draft');
    assert.strictEqual(readDraft('real-id'), 'real draft');
  });
});
