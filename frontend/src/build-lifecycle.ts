/** Pure derivation of the Build implementation-run lifecycle (HL-WORK-001 M3).
 *
 * Stages Prepare → Baseline → Implement → Test → Evaluate → Review → Apply are
 * derived ONLY from existing backend records — the implementation run row
 * (/api/implementations), its review decision (/review-state), and its
 * verification (/verification). No second state machine: the run's own
 * `state` field and the workflow resolver's `workflow` annotation stay
 * authoritative; this module only lays them onto the stage rail and
 * annotates each stage with its backing record when one exists.
 *
 * No DOM, no fetch — unit-tested.
 */

export type StageState = 'pending' | 'current' | 'complete' | 'blocked' | 'failed';

export interface BuildStage {
    key: string;
    label: string;
    state: StageState;
    /** Human note; names the backing record when one exists. */
    note: string;
    /** The backing record that produced this stage's state, when present. */
    record?: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const stage = (key: string, label: string, state: StageState, note = '', record?: string): BuildStage =>
    ({ key, label, state, note, ...(record ? { record } : {}) });
const done = (key: string, label: string, note = '', record?: string): BuildStage =>
    stage(key, label, 'complete', note, record);

/** Decision text exactly as the review surface renders it. */
export function decisionLabel(decision: Record<string, unknown> | null | undefined): string {
    if (!decision) return '';
    const d = str(decision.decision);
    if (d === 'accepted') return 'Accepted for separate application';
    if (d === 'rejected') return 'Rejected';
    if (d === 'revision_requested') return 'Revision requested';
    return d;
}

/** Test outcome text parsed from the run's stored baseline/candidate JSON. */
export function testOutcome(run: Record<string, unknown>): { baseline: string; candidate: string } {
    const parse = (key: string): string => {
        try {
            const v = JSON.parse(str(run[key] || '{}')) as Record<string, unknown>;
            return str(v.status) || 'not evaluated';
        } catch { return 'not evaluated'; }
    };
    return { baseline: parse('baseline_json'), candidate: parse('candidate_json') };
}

/** Derive the 7-stage rail for one implementation run. Always returns 7 items. */
export function deriveBuildStages(
    run: Record<string, unknown>,
    decision: Record<string, unknown> | null | undefined,
    verification: Record<string, unknown> | null | undefined,
): BuildStage[] {
    const st = str(run.state).toLowerCase();
    const runId = str(run.id);
    const attempt = (record: unknown): string | undefined =>
        (record && typeof record === 'object' && record !== null && 'attempt' in record)
            ? `revision #${str((record as Record<string, unknown>).attempt)}` : undefined;

    // Stage indices: 0 Prepare, 1 Baseline, 2 Implement, 3 Test, 4 Evaluate, 5 Review, 6 Apply
    const idx: Record<string, number> = {
        preparing: 0, testing_baseline: 1, implementing: 2, evaluating: 4,
        candidate_passed: 4, candidate_failed: 4, evaluation_error: 4, failed: 2,
    };
    const busy = ['preparing', 'testing_baseline', 'implementing', 'evaluating'].includes(st);
    const currentIdx = busy ? (idx[st] ?? 0) : -1;
    const finishedIdx = busy ? -1 : (idx[st] ?? 4);

    const at = (i: number): StageState =>
        currentIdx === i ? 'current'
        : finishedIdx === -1 ? (i < currentIdx ? 'complete' : 'pending')
        : i < finishedIdx ? 'complete'
        : i === finishedIdx ? stageStateFor(st)
        : 'pending';
    // When a stage is "current", prior stages are complete.
    const state = (i: number): StageState => (currentIdx === i ? 'current' : currentIdx !== -1 ? (i < currentIdx ? 'complete' : 'pending') : at(i));

    const stages: BuildStage[] = [
        stage('prepare', 'Prepare', state(0),
            currentIdx === 0 ? 'Preparing isolated workspace' : '', runId ? `run ${runId.slice(0, 8)}` : undefined),
        stage('baseline', 'Baseline', state(1),
            currentIdx === 1 ? 'Testing original baseline' : ''),
        stage('implement', 'Implement', state(2),
            st === 'failed' ? (str(run.error) || 'Implementation failed') : currentIdx === 2 ? 'Hermes is editing the candidate' : '',
            st === 'failed' ? `run ${runId.slice(0, 8)}` : undefined),
        stage('test', 'Test', st === 'candidate_passed' || st === 'candidate_failed' || str(verification?.disposition) ? 'complete' : state(3),
            st === 'candidate_failed' ? 'candidate tests failed' : ''),
        stage('evaluate', 'Evaluate', st === 'candidate_passed' ? 'complete' : ['candidate_failed', 'evaluation_error'].includes(st) ? 'failed' : state(4),
            str(verification?.disposition) ? `verification: ${str(verification?.disposition)}` : '',
            verification && verification.disposition ? 'verification record' : undefined),
    ];

    // Review: complete once a decision is recorded; current when the
    // candidate is verified/passed and waiting for a human; failed never
    // (a rejection is a completed review, not a failure).
    let reviewState: StageState = 'pending';
    let reviewNote = '';
    if (decision) { reviewState = 'complete'; reviewNote = decisionLabel(decision); }
    else if (st === 'candidate_passed') { reviewState = 'current'; reviewNote = 'Candidate awaiting your review'; }
    stages.push(stage('review', 'Review', reviewState, reviewNote, decision ? 'review decision' : undefined));

    // Apply is a separate, human-authorized step. We never claim it ran:
    // accepted → pending ("awaiting separate application"); rejected →
    // blocked ("nothing to apply"); otherwise pending.
    const dl = decisionLabel(decision);
    stages.push(stage('apply', 'Apply',
        dl === 'Rejected' ? 'blocked' : 'pending',
        dl === 'Accepted for separate application' ? 'Awaiting separate application' : dl === 'Rejected' ? 'Rejected — nothing to apply' : 'Host changes require separate application'));

    return stages;
}

function stageStateFor(st: string): StageState {
    if (st === 'candidate_passed') return 'complete';
    if (st === 'candidate_failed' || st === 'evaluation_error' || st === 'failed') return 'failed';
    return 'complete';
}
