/** Pure derivation of a task's lifecycle stages from a backend task record and the
 * optional workflow chain (from /api/workflow/status). No DOM, no fetch — unit-tested.
 *
 * Two shapes:
 *  - Manual answer task (no chain): Investigate → Work → Respond, so a task that only
 *    answers a question is never forced through plan/build/test stages that never ran.
 *  - Workflow-chained task (investigation goal): Investigate → Plan → Build → Test →
 *    Review → Complete, following discovery → plan → run → verification → review.
 */

export type TaskRec = Record<string, unknown>; // id, state, prompt, result, error, created_at, ...
export interface ChainVerification { disposition?: unknown; blocker?: unknown }
export interface Chain {
    stage?: string;
    status?: string;
    reason?: string;
    next_action?: string;
    /**
     * Discovery fingerprint projected into the workflow annotation so the
     * client can render "what was this about" without re-querying the
     * discovery record. Kept as opaque string so different discovery
     * schemas (JSON, list, etc.) all render the same. */
    fingerprint?: string;
    /** Same shape, persisted form (post-mirror writeback). */
    stored_fingerprint?: string;
    /** Optional project + path metadata from the discovery record. */
    project?: string;
    path?: string;
    discovery_id?: unknown;
    curiosity_id?: unknown;
    formulation_id?: unknown;
    goal_id?: unknown;
    task_id?: unknown;
    plan_id?: unknown;
    run_id?: unknown;
    verification?: ChainVerification | null;
}
export type StageState = 'pending' | 'current' | 'complete' | 'blocked' | 'failed';
export interface LifeStage { key: string; label: string; state: StageState; note: string }

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const has = (...args: unknown[]): boolean => args.some(v => v != null && String(v) !== '');

const stage = (key: string, label: string, state: StageState, note = ''): LifeStage => ({ key, label, state, note });
const done = (key: string, label: string, note = ''): LifeStage => stage(key, label, 'complete', note);

/** Lifecycle for a task not linked to the workflow chain (ad hoc / answered-only work). */
function plainLifecycle(t: TaskRec): LifeStage[] {
    const st = str(t.state).toLowerCase();
    const err = str(t.error);
    if (st === 'queued' || st === 'pending') {
        return [
            stage('investigate', 'Investigate', 'current', 'Queued — waiting to start'),
            stage('work', 'Work', 'pending'),
            stage('respond', 'Respond', 'pending'),
        ];
    }
    if (st === 'running') {
        return [
            done('investigate', 'Investigate', 'Investigation started'),
            stage('work', 'Work', 'current', 'Hermes is working'),
            stage('respond', 'Respond', 'pending'),
        ];
    }
    if (st === 'completed') {
        return [
            done('investigate', 'Investigate', 'Investigation complete'),
            done('work', 'Work', 'Work finished'),
            done('respond', 'Respond', has(t.result) ? 'Final answer available' : 'No result text recorded'),
        ];
    }
    // failed / cancelled / interrupted / stopped
    return [
        done('investigate', 'Investigate', 'Investigation finished'),
        done('work', 'Work', 'Work stopped'),
        stage('respond', 'Respond', 'failed', err || str(t.state)),
    ];
}

/** Lifecycle for a task that has a real discovery → plan → run → review chain. */
function chainLifecycle(t: TaskRec, c: Chain): LifeStage[] {
    const st = str(t.state).toLowerCase();
    const status = str(c.status);
    const stageName = str(c.stage);
    const next = str(c.next_action);
    const reason = str(c.reason);
    const planned = has(c.plan_id);
    const started = has(c.run_id);
    const ver = c.verification && c.verification.disposition ? str(c.verification.disposition).toLowerCase() : '';
    const reviewed = next === 'none' && stageName === 'history';
    const awaitingReview = next === 'open_review';
    const investigationBroken = /failed|interrupted|cancelled/.test(status) && !planned;

    const buildFailed = /failed|blocked|interrupted/.test(status) && !reviewed;
    let buildState: StageState = reviewed ? 'complete' : buildFailed ? 'failed' : started && !awaitingReview ? 'current' : awaitingReview ? 'complete' : 'pending';
    let buildNote = buildFailed ? reason || status : started && !awaitingReview ? reason || status : '';

    let testState: StageState = reviewed || awaitingReview || ver === 'verified' ? 'complete' : started ? 'current' : 'pending';
    let testNote = ver ? `verification: ${ver}` : testState === 'current' ? 'awaiting verification' : '';

    // For a workflow-chained task, `task.state` is the INVESTIGATION leaving the queue:
    // it finishing does not end the chain (plan → build → review still run). Only the
    // terminal review (stage history / next none) marks the whole Lifecycle Complete.
    let completeState: StageState = reviewed ? 'complete' : st === 'failed' && !planned ? 'failed' : 'pending';
    let completeNote = completeState === 'failed' ? str(t.error) || st : '';

    return [
        stage('investigate', 'Investigate', investigationBroken ? 'blocked' : planned || started || reviewed || ['planning', 'build', 'history'].includes(stageName) ? 'complete' : 'current',
            investigationBroken ? reason : planned || reviewed ? 'Investigation complete' : 'Investigating the finding'),
        stage('plan', 'Plan', started || reviewed ? 'complete' : planned ? 'current' : 'pending',
            planned && !started ? (reason || status) : ''),
        stage('build', 'Build', buildState, buildNote),
        stage('test', 'Test', testState, testNote),
        stage('review', 'Review', reviewed ? 'complete' : awaitingReview ? 'current' : 'pending',
            awaitingReview ? 'Candidate awaiting your review' : ''),
        stage('complete', 'Complete', completeState, completeNote),
    ];
}

/** Derive the lifecycle stages for a task. Returns a stable 3- or 6-item list. */
export function deriveLifecycle(t: TaskRec, c: Chain | null | undefined): LifeStage[] {
    return c ? chainLifecycle(t, c) : plainLifecycle(t);
}
