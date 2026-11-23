/** HL-WORK-001 M3 — build-typed inspector + implementation-centric Build view.
 *
 * Unit tests for the pure stage derivation (build-lifecycle.ts) and static
 * checks that the Build panel sets a typed build selection and registers the
 * 'build' inspector renderer (the stale-task fix).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// In-memory localStorage BEFORE importing modules that touch it.
const mem = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
};

const here = dirname(fileURLToPath(import.meta.url));
const { deriveBuildStages, testOutcome, decisionLabel } = await import('../src/build-lifecycle.ts');

const run = (state: string, extra: Record<string, unknown> = {}) => ({ id: 'run-1234-abcd', state, ...extra });

test('busy run states put exactly one stage current and prior stages complete', () => {
    for (const [st, idx] of [['preparing', 0], ['testing_baseline', 1], ['implementing', 2], ['evaluating', 3]] as const) {
        const stages = deriveBuildStages(run(st), null, null);
        assert.equal(stages.length, 7, 'seven stages always');
        const current = stages.filter(s => s.state === 'current');
        assert.equal(current.length, 1, `${st}: exactly one current`);
        assert.equal(current[0].key, ({ preparing: 'prepare', testing_baseline: 'baseline', implementing: 'implement', evaluating: 'evaluate' } as Record<string, string>)[st], `${st}: correct stage current`);
        assert.ok(stages.slice(0, stages.indexOf(current[0])).every(s => s.state === 'complete'), `${st}: prior stages complete`);
        assert.ok(stages.slice(stages.indexOf(current[0]) + 1).every(s => s.state === 'pending'), `${st}: later stages pending`);
    }
});

test('candidate_passed: evaluate complete, review current, apply pending with application note', () => {
    const stages = deriveBuildStages(run('candidate_passed'), null, null);
    assert.equal(stages.find(s => s.key === 'evaluate')!.state, 'complete');
    assert.equal(stages.find(s => s.key === 'review')!.state, 'current');
    assert.match(stages.find(s => s.key === 'review')!.note, /awaiting your review/i);
    const apply = stages.find(s => s.key === 'apply')!;
    assert.equal(apply.state, 'pending');
    assert.match(apply.note, /separate application/i);
});

test('candidate_failed / evaluation_error fail the evaluate stage, review stays pending', () => {
    for (const st of ['candidate_failed', 'evaluation_error']) {
        const stages = deriveBuildStages(run(st), null, null);
        assert.equal(stages.find(s => s.key === 'evaluate')!.state, 'failed');
        assert.equal(stages.find(s => s.key === 'review')!.state, 'pending');
    }
});

test('failed run: implement stage failed with the run error as note', () => {
    const stages = deriveBuildStages(run('failed', { error: 'workspace prepare exploded' }), null, null);
    const impl = stages.find(s => s.key === 'implement')!;
    assert.equal(impl.state, 'failed');
    assert.match(impl.note, /workspace prepare exploded/);
    assert.match(impl.note ?? '', /./);
});

test('a recorded review decision completes Review and gates Apply', () => {
    const accepted = deriveBuildStages(run('candidate_passed'), { decision: 'accepted', decided_at: '2026-01-01T00:00:00Z' }, null);
    assert.equal(accepted.find(s => s.key === 'review')!.state, 'complete');
    assert.equal(accepted.find(s => s.key === 'apply')!.note, 'Awaiting separate application');

    const rejected = deriveBuildStages(run('candidate_passed'), { decision: 'rejected' }, null);
    assert.equal(rejected.find(s => s.key === 'apply')!.state, 'blocked');
    assert.match(rejected.find(s => s.key === 'apply')!.note, /nothing to apply/i);
});

test('verification disposition annotates the evaluate stage with its backing record', () => {
    const stages = deriveBuildStages(run('candidate_passed'), null, { disposition: 'verified' });
    const ev = stages.find(s => s.key === 'evaluate')!;
    assert.match(ev.note, /verification: verified/);
    assert.equal(ev.record, 'verification record');
});

test('testOutcome parses stored test JSON and never throws on garbage', () => {
    assert.deepEqual(testOutcome({ baseline_json: '{"status":"passed"}', candidate_json: '{"status":"failed"}' }),
        { baseline: 'passed', candidate: 'failed' });
    assert.deepEqual(testOutcome({}), { baseline: 'not evaluated', candidate: 'not evaluated' });
    assert.deepEqual(testOutcome({ baseline_json: 'not json' }), { baseline: 'not evaluated', candidate: 'not evaluated' });
});

test('decisionLabel mirrors the review surface wording', () => {
    assert.equal(decisionLabel({ decision: 'accepted' }), 'Accepted for separate application');
    assert.equal(decisionLabel({ decision: 'rejected' }), 'Rejected');
    assert.equal(decisionLabel(null), '');
});

test('static: Build panel sets a typed build selection and registers the build inspector renderer', () => {
    const src = readFileSync(join(here, '../src/phase415-review.ts'), 'utf8');
    assert.match(src, /setSelection\('builds',\s*\{kind:'build'/);
    assert.match(src, /registerKindRenderer\('build'/);
    assert.match(src, /registerSummaryProvider\('builds'/);
    assert.match(src, /from '\.\/build-lifecycle\.ts'/);
    const css = readFileSync(join(here, '../src/phase415-review.css'), 'utf8');
    assert.match(css, /\.hl415-card-selected/);
    assert.match(css, /\.hl415-stage-current/);
});
