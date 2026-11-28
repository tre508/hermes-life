/**
 * Attention Center (P3, spec §4).
 *
 * ONE aggregate surface for items awaiting a human decision:
 *   - proposed investigation plans   (same predicate and same approve
 *     endpoint as Work/Planning: state === 'proposed')
 *   - candidates awaiting review     (same predicate as Work/Build:
 *     state === 'candidate_passed' with no persisted review decision)
 *   - blocked / failed candidates    (candidate_failed, evaluation_error)
 *   - pending memory reviews         (unresolved candidate-vs-existing conflicts)
 *
 * Every item carries Why / Evidence / Authority needed / Next action
 * (spec §4). Actions hit the SAME work records and endpoints Work uses —
 * this module creates nothing, authorizes nothing the Work view cannot,
 * and never treats a queued intent as a success.
 *
 * Data boundaries (spec §5): all four sources are the Hermes work graph /
 * database, not the vault, not derived animation state.
 *
 * Deliberately NOT implemented: a "permission requests" attention category
 * (spec §9). No pending-request surface exists — /api/approvals is a grants
 * ledger, not a request queue — so the category is omitted rather than faked.
 */
import { openWorkView, openWorkspace, setSelection } from './navigation-state.ts';

type Rec = Record<string, unknown>;
const $ = (id: string): HTMLElement | null => document.getElementById(id);
const s = (x: unknown): string => (typeof x === 'string' ? x : String(x ?? ''));
const list = (x: unknown): Rec[] =>
    Array.isArray(x) ? x as Rec[] : (x && typeof x === 'object' ? (((x as Rec).items as Rec[]) || []) : []);

type Group = 'plan' | 'review' | 'blocked' | 'memory' | 'vault' | 'initiative';
interface AttentionItem {
    key: string;
    group: Group;
    title: string;
    why: string;
    evidence: string;
    authority: string;
    actionLabel: string;
    run: () => void;
}

async function api(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    const res = await fetch('/api' + path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
    });
    const raw = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { parsed = raw; }
    if (!res.ok) {
        let detail: unknown = parsed;
        if (parsed && typeof parsed === 'object' && 'detail' in parsed) detail = (parsed as Rec).detail;
        throw new Error(`${res.status}: ${s(detail).slice(0, 300)}`);
    }
    return parsed;
}

let items: AttentionItem[] = [];
let lastFetch = 0;
let inFlight: Promise<void> | null = null;
let loadError = '';
let wired = false;

function planReport(p: Rec): Rec {
    try {
        const v = typeof p.report === 'string' ? JSON.parse(p.report) : p.report;
        return v && typeof v === 'object' && !Array.isArray(v) ? v as Rec : {};
    } catch { return {}; }
}

function planEvidence(p: Rec): string {
    const r = planReport(p);
    const steps = Array.isArray(r.steps) ? r.steps.map(s) : [];
    const summary = Array.isArray(r.acceptance_criteria) ? r.acceptance_criteria.map(s) : steps;
    return summary.length ? `${summary.length} planned step(s): ${summary.slice(0, 3).join('; ')}${summary.length > 3 ? '; …' : ''}` : 'Plan proposal has no compiled steps yet.';
}

function planItem(p: Rec): AttentionItem {
    const id = s(p.id);
    return {
        key: `plan:${id}`,
        group: 'plan',
        title: `Proposed plan — ${s(p.project || 'unassigned project')}`,
        why: 'Hermes drafted and proposed this investigation plan. Nothing runs until you approve it.',
        evidence: planEvidence(p),
        authority: 'Plan approval authorizes isolated implementation only; it does not modify host source.',
        actionLabel: 'Approve plan',
        run: () => {
            if (!confirm('Approve this plan? Approval authorizes isolated implementation only; it does not modify host source.')) return;
            void api(`/investigation-plans/${encodeURIComponent(id)}/approve`, 'POST')
                .then(() => refreshAttention(true))
                .catch(e => { loadError = s(e); renderList(); });
        },
    };
}

function reviewItem(run_: Rec): AttentionItem {
    const id = s(run_.id);
    return {
        key: `review:${id}`,
        group: 'review',
        title: `Candidate changes — run ${id.slice(0, 8)}`,
        why: 'Independent candidate tests passed; the diff is not applied until you review and accept it.',
        evidence: `Isolated run ${id.slice(0, 8)} passed evaluation. Full diff, criteria verdicts and verification evidence live in the Build review.`,
        authority: 'Review decision (accept applies the candidate separately; reject or request revision keeps host source untouched).',
        actionLabel: 'Open in Build review',
        run: () => {
            openWorkView('builds');
            setSelection('builds', { kind: 'build', id });
        },
    };
}

function blockedItem(run_: Rec): AttentionItem {
    const id = s(run_.id);
    const state = s(run_.state);
    return {
        key: `blocked:${id}`,
        group: 'blocked',
        title: `Blocked work — run ${id.slice(0, 8)}`,
        why: state === 'evaluation_error'
            ? 'Independent evaluation could not complete; the run needs your attention before work continues.'
            : 'Candidate tests failed; the change cannot proceed without revision or explicit reevaluation.',
        evidence: `Run state: ${state}. Inspect the run's evidence and revision attempts in the Build review.`,
        authority: 'Your call: reevaluate, request a revision, or accept the blockage.',
        actionLabel: 'Open in Build review',
        run: () => {
            openWorkView('builds');
            setSelection('builds', { kind: 'build', id });
        },
    };
}

function memoryItem(rev: Rec): AttentionItem {
    const id = s(rev.id);
    return {
        key: `memory:${id}`,
        group: 'memory',
        title: `Conflicting memory evidence — review #${id}`,
        why: s(rev.reason) || 'A candidate memory conflicts with an existing record; the conflict needs your resolution.',
        evidence: s(rev.evidence_excerpt) || 'No evidence excerpt was stored with this review.',
        authority: 'Memory resolution decides what the agent may keep treating as true.',
        actionLabel: 'Resolve in Memory',
        // Memory folded into Knowledge in the nav regroup; the review list lives
        // in Knowledge's #memory-section. 'system' no longer has a workspace
        // section, so routing there would blank the main pane.
        run: () => { void openWorkspace('knowledge'); },
    };
}

function vaultHealthItem(health: Rec): AttentionItem {
    return {
        key: 'vault:unreachable',
        group: 'vault',
        title: 'Obsidian vault unreachable',
        why: 'The memory service cannot reach the configured vault, so memory writes and vault-backed context are degraded.',
        evidence: `Vault path: ${s(health.vault)} — ${(health.errors as string[] || []).join('; ') || 'not mounted'}`,
        authority: 'Remount the vault disk or fix HERMES_LIFE_OBSIDIAN_VAULT; nothing can be auto-repaired here.',
        actionLabel: 'Open Knowledge sync state',
        run: () => { void openWorkspace('knowledge'); },
    };
}

function initiativeItem(p: Rec): AttentionItem {
    const id = s(p.id);
    const title = s(p.title || 'Untitled initiative');
    return {
        key: `initiative:${id}`,
        group: 'initiative',
        title: `Proposed autonomous project — ${title}`,
        why: 'The autonomy pipeline proposed a new development initiative. Nothing executes until you decide, and the decision is recorded with your rationale.',
        evidence: `Proposal ${id.slice(0, 8)} · status ${s(p.status)}. Policy and opportunity context in Projects.`,
        authority: 'Approve authorizes the bootstrap pipeline; reject records the refusal with your rationale.',
        actionLabel: 'Decide',
        run: () => {
            const choice = confirm(`Approve initiative "${title}"?\nOK = approve · Cancel = reject`);
            const rationale = prompt(choice ? 'Why are you authorizing this initiative?' : 'Why are you rejecting this initiative?');
            if (rationale === null) return; // a decision without a recorded why is not a decision
            void api(`/proposals/${encodeURIComponent(id)}/decision`, 'POST',
                { approve: choice, actor: 'user', rationale })
                .then(() => refreshAttention(true))
                .catch(e => { loadError = s(e); renderList(); });
        },
    };
}

function renderBadge(): void {
    const badge = $('attention-badge');
    if (!badge) return;
    badge.hidden = items.length === 0;
    badge.textContent = String(items.length);
    badge.title = `${items.length} item(s) awaiting your decision`;
}

function itemCard(item: AttentionItem): HTMLElement {
    const card = document.createElement('article');
    card.className = 'attention-item';
    card.dataset.group = item.group;
    const h = document.createElement('h3');
    h.textContent = item.title;
    const fields = document.createElement('dl');
    for (const [k, v] of [
        ['Why', item.why], ['Evidence', item.evidence],
        ['Authority needed', item.authority], ['Next action', item.actionLabel],
    ]) {
        const dt = document.createElement('dt');
        dt.textContent = k;
        const dd = document.createElement('dd');
        dd.textContent = v;
        fields.append(dt, dd);
    }
    const actions = document.createElement('div');
    actions.className = 'attention-actions';
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = item.actionLabel;
    b.addEventListener('click', item.run);
    actions.append(b);
    card.append(h, fields, actions);
    return card;
}

function renderList(): void {
    const root = $('attention-list');
    if (!root) return;
    root.replaceChildren();
    if (loadError) {
        const e = document.createElement('p');
        e.className = 'attention-error';
        e.textContent = `Could not load attention items: ${loadError} — showing nothing rather than guessing.`;
        root.append(e);
    }
    if (!items.length && !loadError) {
        const e = document.createElement('p');
        e.className = 'attention-empty';
        e.textContent = 'Nothing is awaiting your decision. Work runs on its own authority until something genuinely needs you.';
        root.append(e);
        return;
    }
    const groupLabels: Record<Group, string> = {
        plan: 'Proposed plans', review: 'Candidates awaiting review',
        blocked: 'Blocked / failed work', memory: 'Conflicting memory evidence',
        vault: 'Memory service / vault', initiative: 'Proposed initiatives',
    };
    for (const group of ['plan', 'review', 'blocked', 'memory', 'initiative', 'vault'] as Group[]) {
        const groupItems = items.filter(i => i.group === group);
        if (!groupItems.length) continue;
        const h = document.createElement('h2');
        h.textContent = `${groupLabels[group]} (${groupItems.length})`;
        root.append(h);
        for (const item of groupItems) root.append(itemCard(item));
    }
}

/** Refresh the aggregate. Bounded: review-state only checked for the first
 *  20 candidate_passed runs; failures keep the last honest item list. */
export async function refreshAttention(force = false): Promise<void> {
    if (inFlight) return inFlight;
    if (!force && Date.now() - lastFetch < 15000) return;
    inFlight = (async () => {
        try {
            const [plans, runs, reviews, proposals, vaultHealth] = await Promise.all([
                api('/investigation-plans'), api('/implementations'), api('/memory-reviews'),
                api('/proposals'), api('/memory/health').catch(() => null),
            ]);
            const next: AttentionItem[] = [];
            for (const p of list(plans)) if (s(p.state) === 'proposed') next.push(planItem(p));
            const candidates = list(runs).filter(r => s(r.state) === 'candidate_passed');
            const states = await Promise.all(candidates.slice(0, 20).map(r =>
                api(`/implementations/${encodeURIComponent(s(r.id))}/review-state`).catch(() => null)));
            candidates.forEach((r, i) => {
                const d = states[i] as Rec | null;
                if (!d || !d.decision) next.push(reviewItem(r));
            });
            for (const r of list(runs)) {
                if (['candidate_failed', 'evaluation_error'].includes(s(r.state))) next.push(blockedItem(r));
            }
            for (const rev of list((reviews as Rec).reviews)) if (s(rev.status) === 'pending') next.push(memoryItem(rev));
            for (const pr of list((proposals as Rec).proposals)) if (s(pr.status) === 'awaiting_approval') next.push(initiativeItem(pr));
            if (vaultHealth && typeof vaultHealth === 'object' && (vaultHealth as Rec).reachable === false) {
                next.push(vaultHealthItem(vaultHealth as Rec));
            }
            items = next;
            loadError = '';
            lastFetch = Date.now();
        } catch (e) {
            loadError = s(e);
        }
        renderBadge();
        renderList();
    })().finally(() => { inFlight = null; });
    return inFlight;
}

/** Self-wiring: badge always live (events + slow poll); the list re-renders
 *  when its workspace opens or an event lands while it is visible. */
function init(): void {
    if (wired) return;
    wired = true;
    void refreshAttention(true);
    // HA-046: decision/resolution events clear the badge IMMEDIATELY — the
    // 15s throttle would otherwise show already-resolved items as pending.
    const RESOLUTION_EVENTS = new Set([
        'implementation.review_decided', 'investigation.plan_approved',
        'memory.review_resolved', 'proposal.approved', 'proposal.created',
        'discovery.approved',
    ]);
    window.addEventListener('hermes:event', (ev) => {
        const type = (ev as CustomEvent<{ type?: string }>).detail?.type;
        const force = !!type && RESOLUTION_EVENTS.has(type);
        void refreshAttention(force).then(() => { if ($('workspace-attention')?.hidden === false) renderList(); });
    });
    window.setInterval(() => { void refreshAttention(); }, 60000);
    document.getElementById('attention-badge')?.addEventListener('click', () => { void refreshAttention(true); });
}

init();
