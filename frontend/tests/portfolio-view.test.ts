/** HL-AUTO-001 Phase 6: portfolio view pure helpers (state assembly, labels, event filter). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    assemblePortfolio, projectSummary, nextProjectAction, portfolioEventRelevant,
} from '../src/portfolio-view.ts';

const project = (over: Partial<Parameters<typeof projectSummary>[0]> = {}) => ({
    id: 'p1', name: 'alpha', origin: 'autonomous', vm_path: '/vm/alpha', status: 'active',
    ...over,
}) as Parameters<typeof projectSummary>[0];

test('assemblePortfolio filters broken rows, keeps only awaiting proposals, ranks opportunities', () => {
    const state = assemblePortfolio(
        [project(), { id: '', name: '', origin: '', vm_path: '', status: '' }],
        { alpha: [] },
        [
            { id: 'pr1', opportunity_id: 'o1', version: 1, title: 'T', status: 'awaiting_approval', specification: 's' },
            { id: 'pr2', opportunity_id: 'o1', version: 2, title: 'T', status: 'approved', specification: 's' },
        ],
        [],
        [
            { id: 'o-low', title: 'Low', status: 'candidate', confidence: 0.2, score: 0.3 },
            { id: 'o-high', title: 'High', status: 'candidate', confidence: 0.8, score: 0.9 },
        ],
        'suggest');
    assert.equal(state.projects.length, 1);
    assert.equal(state.proposals.length, 1);
    assert.equal(state.proposals[0].id, 'pr1');
    assert.equal(state.opportunities[0].id, 'o-high');
    assert.equal(state.mode, 'suggest');
});

test('projectSummary reports real milestone progress and blockers', () => {
    const summary = projectSummary(project(), [
        { id: 'm1', project_name: 'alpha', title: 'A', state: 'completed' },
        { id: 'm2', project_name: 'alpha', title: 'B', state: 'completed' },
        { id: 'm3', project_name: 'alpha', title: 'C', state: 'blocked', blocker: 'waiting' },
    ] as never);
    assert.match(summary, /milestones 2\/3 completed/);
    assert.match(summary, /1 blocked/);
    assert.match(summary, /^autonomous · active/);
});

test('nextProjectAction comes from backend state only', () => {
    assert.equal(nextProjectAction(project({ status: 'active' })), 'pause');
    assert.equal(nextProjectAction(project({ status: 'paused' })), 'resume');
    assert.equal(nextProjectAction(project({ status: 'cancelled' })), null);
    assert.equal(nextProjectAction(project({ status: 'failed' })), null);
});

test('portfolio reacts to project-family events, not scheduler internals', () => {
    for (const type of ['project.bootstrap_completed', 'milestone.completed', 'milestone.started',
        'experience.recorded', 'opportunity.recorded', 'proposal.created']) {
        assert.ok(portfolioEventRelevant(type), type);
    }
    for (const type of ['autonomy.tick', 'autonomy.resumed', 'decision.selected',
        'task.started', 'goal.created']) {
        assert.ok(!portfolioEventRelevant(type), type);
    }
});
