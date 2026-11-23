/**
 * Work → Reviews (HERMESHA spec §4) — the candidate review queue.
 *
 * Lists runs whose independent tests passed or failed and that still need a
 * review decision. Opening one jumps to Builds with that run selected — the same
 * record and the same action path the Attention Center uses, never a second
 * queue. Read-only: it fetches, it does not mutate.
 */
import { openWorkView, setSelection } from './navigation-state.ts';

const $ = (id: string): HTMLElement | null => document.getElementById(id);
const s = (x: unknown): string => (typeof x === 'string' ? x : x == null ? '' : String(x));

export interface Run { id?: unknown; project?: unknown; state?: unknown; created_at?: unknown }

const REVIEWABLE = new Set(['candidate_passed', 'candidate_failed', 'evaluation_error']);

/** Pure: newest-first runs that need a review decision. */
export function selectReviewable(runs: Run[]): Run[] {
    return runs
        .filter(r => REVIEWABLE.has(s(r.state)))
        .sort((a, b) => s(b.created_at).localeCompare(s(a.created_at)));
}

async function read<T>(path: string): Promise<T | null> {
    try { const r = await fetch('/api' + path); return r.ok ? await r.json() as T : null; }
    catch { return null; }
}

function render(runs: Run[]): void {
    const list = $('reviews-list');
    const status = $('reviews-status');
    if (!list) return;
    list.replaceChildren();
    const items = selectReviewable(runs);
    if (status) status.textContent = items.length ? `${items.length} run(s) awaiting a review decision.` : 'No candidate runs are awaiting a review.';
    for (const run of items) {
        const id = s(run.id);
        const card = document.createElement('article');
        card.className = 'review-card';
        const h = document.createElement('h3');
        h.textContent = `Run ${id.slice(0, 8)} · ${s(run.project) || 'unassigned project'}`;
        const p = document.createElement('p');
        p.className = 'hint';
        p.textContent = `State: ${s(run.state)}. Open the Builds review for the full diff, criteria verdicts and evidence.`;
        const open = document.createElement('button');
        open.type = 'button';
        open.textContent = 'Open in Builds review';
        open.addEventListener('click', () => {
            openWorkView('builds');
            setSelection('builds', { kind: 'build', id });
        });
        card.append(h, p, open);
        list.append(card);
    }
}

export async function loadReviews(): Promise<void> {
    const runs = await read<Run[]>('/implementations');
    render(runs || []);
}

let wired = false;
export function initReviews(): void {
    if (wired) return;
    wired = true;
    $('reviews-refresh')?.addEventListener('click', () => { void loadReviews(); });
    void loadReviews();
    window.addEventListener('hermes:event', () => { void loadReviews(); });
}

initReviews();
