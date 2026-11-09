import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deriveLifecycle, type Chain, type TaskRec, type LifeStage } from '../src/task-lifecycle.ts';

const task = (p: Partial<TaskRec>): TaskRec => ({ id: 't1', state: 'completed', prompt: 'p', result: 'ok', error: null, created_at: '2026-11-09T00:00:00Z', ...p });
const state = (stages: LifeStage[]) => stages.map(s => s.key + ':' + s.state);
const chain = (p: Partial<Chain>): Chain => ({ next_action: 'none', ...p });

describe('deriveLifecycle — manual tasks (no workflow chain)', () => {
    test('queued task: investigating is current, nothing else started', () => {
        const s = state(deriveLifecycle(task({ state: 'queued' }), null));
        assert.deepEqual(s, ['investigate:current', 'work:pending', 'respond:pending']);
    });
    test('running task: investigation done, work is current', () => {
        const s = state(deriveLifecycle(task({ state: 'running' }), null));
        assert.deepEqual(s, ['investigate:complete', 'work:current', 'respond:pending']);
    });
    test('completed task with a result: all three reach complete', () => {
        const s = state(deriveLifecycle(task({ state: 'completed', result: 'done' }), null));
        assert.deepEqual(s, ['investigate:complete', 'work:complete', 'respond:complete']);
    });
    test('failed task: respond is failed with the error surfaced', () => {
        const stages = deriveLifecycle(task({ state: 'failed', error: 'boom', result: null }), null);
        assert.equal(stages[2].state, 'failed');
        assert.match(stages[2].note, /boom/);
    });
    test('a plain task is never forced through coding stages', () => {
        const stages = deriveLifecycle(task({ state: 'running' }), null);
        assert.ok(!stages.some(s => s.label === 'Build' || s.label === 'Test'));
    });
});

describe('deriveLifecycle — workflow-chained task', () => {
    test('investigation produced a plan: investigate complete, plan current', () => {
        const stages = deriveLifecycle(task({ state: 'running' }), chain({ plan_id: 'pl', next_action: 'approve_plan', stage: 'planning' }));
        const s = state(stages);
        assert.equal(s[0], 'investigate:complete');
        assert.equal(s[1], 'plan:current');
    });
    test('a candidate run is awaiting review: build+test complete, review current', () => {
        const stages = deriveLifecycle(task({ state: 'running' }), chain({ plan_id: 'pl', run_id: 'r1', next_action: 'open_review', stage: 'build', status: 'Awaiting review' }));
        const s = state(stages);
        assert.equal(s[2], 'build:complete');
        assert.equal(s[3], 'test:complete');
        assert.equal(s[4], 'review:current');
        assert.equal(s[5], 'complete:pending');
    });
    test('review accepted and task completed with a result: everything complete', () => {
        const stages = deriveLifecycle(task({ state: 'completed', result: 'accepted' }), chain({ plan_id: 'pl', run_id: 'r1', next_action: 'none', stage: 'history', status: 'Completed' }));
        const s = state(stages);
        assert.ok(s.every(v => v.endsWith(':complete')));
    });
    test('an interrupted investigation with no plan is blocked at investigate', () => {
        const stages = deriveLifecycle(task({ state: 'interrupted', result: null }), chain({ stage: 'in_progress', status: 'Investigation interrupted', next_action: 'review_investigation' }));
        assert.equal(stages[0].state, 'blocked');
        assert.equal(stages[1].state, 'pending');
    });
    test('investigation task completed but the chain is still drafting its plan: Complete stays pending', () => {
        // The investigation finishing must NOT light the terminal Complete stage — the
        // chain continues through plan → build → review.
        const stages = deriveLifecycle(task({ state: 'completed', result: 'root cause found' }), chain({ plan_id: 'pl', stage: 'planning', status: 'Drafting the plan', next_action: 'await' }));
        const s = state(stages);
        assert.equal(s[1], 'plan:current');   // plan still drafting
        assert.equal(s[5], 'complete:pending'); // NOT complete
    });
    test('verification disposition is surfaced on the test stage', () => {
        const stages = deriveLifecycle(task({ state: 'running' }), chain({ plan_id: 'pl', run_id: 'r1', stage: 'build', next_action: 'open_review', verification: { disposition: 'verified' } }));
        assert.equal(stages[3].state, 'complete');
        assert.match(stages[3].note, /verified/);
    });
});
