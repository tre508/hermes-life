/**
 * convo-redesign.md §4/§6 — the task composer's state machine.
 *
 * The composer's behaviour is driven by ONE pure function so the mapping from
 * task/chain records to composer mode is testable without a DOM, and so the
 * five modes can never drift from the five the stylesheet styles.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const mod = await import('../src/task-composer.ts');
const css = readFileSync(join(here, '../src/unified-layout.css'), 'utf8');

const copy = mod.composerCopyFor as (i: Record<string, unknown>) => {
    mode: string; label: string; hint: string; placeholder: string;
};

test('no conversation yet → start an independent request', () => {
    const c = copy({ hasConversation: false });
    assert.equal(c.mode, 'new');
    assert.match(c.label, /start a new task/i);
});

test('running / queued → follow-up, and it does NOT pretend to steer the run', () => {
    for (const state of ['running', 'queued']) {
        const c = copy({ state, hasConversation: true });
        assert.equal(c.mode, 'followup');
        assert.match(c.label, /follow-up/i);
        // The backend is single-flight and has no endpoint for input to a
        // running task, so the copy must say the follow-up is linked, not live.
        assert.match(c.hint, /cannot steer/i);
    }
});

test('completed → ask about the result / request more work', () => {
    const c = copy({ state: 'completed', hasConversation: true });
    assert.equal(c.mode, 'completed');
    assert.match(c.label, /result/i);
    assert.match(c.hint, /conversation/i);
});

test('failed and cancelled → inspect failure', () => {
    for (const state of ['failed', 'cancelled']) {
        assert.equal(copy({ state, hasConversation: true }).mode, 'failed');
    }
});

test('awaiting_approval / blocked → approval', () => {
    for (const state of ['awaiting_approval', 'blocked']) {
        assert.equal(copy({ state, hasConversation: true }).mode, 'approval');
    }
});

test('a chain wanting a plan decision is approval even while running', () => {
    for (const next of ['approve_plan', 'review_investigation']) {
        assert.equal(copy({ state: 'running', nextAction: next, hasConversation: true }).mode, 'approval');
    }
});

test('state matching is case/whitespace insensitive (records are strings)', () => {
    assert.equal(copy({ state: ' COMPLETED ', hasConversation: true }).mode, 'completed');
});

test('every emitted mode is one the stylesheet actually styles', () => {
    const styled = new Set(
        [...css.matchAll(/\.task-composer\[data-mode="([a-z]+)"\]/g)].map(m => m[1]),
    );
    assert.deepStrictEqual(
        [...styled].sort(),
        ['approval', 'completed', 'failed', 'followup', 'new'],
        'the stylesheet must style exactly the five modes',
    );
    for (const input of [
        { hasConversation: false },
        { state: 'running', hasConversation: true },
        { state: 'completed', hasConversation: true },
        { state: 'failed', hasConversation: true },
        { state: 'awaiting_approval', hasConversation: true },
    ]) {
        assert.ok(styled.has(copy(input).mode), `${copy(input).mode} must be styled`);
    }
});

test('the composer never writes to /api/tasks itself (one send path)', () => {
    const src = readFileSync(join(here, '../src/task-composer.ts'), 'utf8');
    assert.doesNotMatch(src, /fetch\(\s*[`'"]\/api\/tasks/);
    assert.match(src, /hermes:open-in-chat/);
});

test('drafts share the one ledger in conv-composer', () => {
    const src = readFileSync(join(here, '../src/task-composer.ts'), 'utf8');
    assert.match(src, /from '\.\/conv-composer\.ts'/);
    for (const fn of ['readDraft', 'writeDraft', 'clearDraft']) {
        assert.ok(src.includes(fn), `the composer must use ${fn}`);
    }
});
