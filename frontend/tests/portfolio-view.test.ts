/** HL-AUTO-001 Phase 6: portfolio view pure helpers (state assembly, labels, event filter). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    assemblePortfolio, projectSummary, nextProjectAction, portfolioEventRelevant,
    registeredSyncState, registeredSummary, validateRegisterInput, parseChangeOutput,
    type RegisteredProject,
} from '../src/portfolio-view.ts';

const project = (over: Partial<Parameters<typeof projectSummary>[0]> = {}) => ({
    id: 'p1', name: 'alpha', origin: 'autonomous', remote_path: '/work-machine/alpha', status: 'active',
    ...over,
}) as Parameters<typeof projectSummary>[0];

test('assemblePortfolio filters broken rows, keeps only awaiting proposals, ranks opportunities', () => {
    const state = assemblePortfolio(
        [project(), { id: '', name: '', origin: '', remote_path: '', status: '' }],
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

/* ===== HL-WORK-001 M2: registered projects ===== */

const registered = (over: Partial<RegisteredProject> = {}): RegisteredProject => ({
    name: 'alpha', host_path: '/home/glenn/Apps/alpha', spec_path: null,
    remote_path: null, commit_hash: null, synced_at: null,
    ...over,
});

test('registeredSyncState comes from the registry row only', () => {
    assert.equal(registeredSyncState(registered()), 'not-synchronized');
    assert.equal(registeredSyncState(registered({ remote_path: '/work-machine/alpha/abc123' })), 'synced');
    assert.equal(registeredSyncState(registered({ remote_path: '' })), 'not-synchronized');
});

test('registeredSummary reports repo, sync state, spec and autonomous overlap', () => {
    assert.equal(registeredSummary(registered(), new Set()),
        '/home/glenn/Apps/alpha · not synchronized');
    assert.equal(registeredSummary(registered({ spec_path: 'SPEC.md' }), new Set()),
        '/home/glenn/Apps/alpha · not synchronized · spec: SPEC.md');
    assert.equal(registeredSummary(registered({ remote_path: '/work-machine/x' }), new Set(['alpha'])),
        '/home/glenn/Apps/alpha · synced to work machine · in autonomous portfolio');
});

test('validateRegisterInput mirrors the backend register rules', () => {
    assert.deepEqual(
        validateRegisterInput({ name: ' my-proj ', hostPath: '/home/glenn/Apps/my-proj' }),
        { ok: true, payload: { name: 'my-proj', host_path: '/home/glenn/Apps/my-proj' } });
    const badName = validateRegisterInput({ name: 'x', hostPath: '/p', specPath: 'docs/SPEC.md' });
    assert.equal(badName.ok, false);
    if (!badName.ok) assert.match(badName.error, /lowercase/);
    assert.ok(!validateRegisterInput({ name: 'ok-name', hostPath: 'relative/path' }).ok);
    assert.ok(!validateRegisterInput({ name: 'Bad_Name', hostPath: '/p' }).ok);
    assert.ok(!validateRegisterInput({ name: 'ok', hostPath: '/p', specPath: '/absolute' }).ok);
    assert.deepEqual(
        validateRegisterInput({ name: 'ok', hostPath: '/p', specPath: 'SPEC.md' }),
        { ok: true, payload: { name: 'ok', host_path: '/p', spec_path: 'SPEC.md' } });
});

test('parseChangeOutput splits the marked git status/diff payload', () => {
    const parsed = parseChangeOutput(
        '---GIT-STATUS---\n M src/a.ts\n?? new.txt\n---GIT-DIFF---\n diff --git a/src/a.ts\n---END-DIFF---');
    assert.deepEqual(parsed.statusLines, ['M src/a.ts', '?? new.txt']);
    assert.match(parsed.diff, /diff --git a\/src\/a\.ts/);
    assert.deepEqual(parseChangeOutput('---GIT-STATUS---\n\n---GIT-DIFF---\n\n---END-DIFF---'),
        { statusLines: [], diff: '(no changes reported)' });
    assert.deepEqual(parseChangeOutput(''), { statusLines: [], diff: '(no changes reported)' });
});

test('static: the Projects tab hosts a registry section wired by portfolio-view', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const html = readFileSync(join(here, '../index.html'), 'utf8');
    const src = readFileSync(join(here, '../src/portfolio-view.ts'), 'utf8');
    const htmlIds = ['registered-projects', 'registered-list', 'registered-form',
        'registered-error', 'registered-submit'];
    for (const id of htmlIds) {
        assert.match(html, new RegExp(`id="${id}"`), id);
    }
    for (const id of ['registered-list', 'registered-form', 'registered-error', 'registered-submit']) {
        assert.match(src, new RegExp(`'${id}'`), `portfolio-view must use #${id}`);
    }
    assert.match(src, /GET \/api\/projects|'\/api\/projects'/);
    assert.match(src, /registerKindRenderer\('project'/);
    assert.match(src, /registerSummaryProvider\('overview'/);
});
