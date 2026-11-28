/**
 * Director identity panel (HERMESHA spec §7).
 *
 * Answers, in the operator's own panel: what Hermes is doing now, for which
 * project, what recently finished, what needs a decision, and what the operator
 * can do next. Every value comes from a record another view already reads — no
 * second truth; an unavailable source degrades to '—' rather than a guess.
 */
import { openWorkspace } from './navigation-state.ts';

const $ = (id: string): HTMLElement | null => document.getElementById(id);
const s = (x: unknown): string => (typeof x === 'string' ? x : x == null ? '' : String(x));

interface Goal { title?: unknown; state?: unknown; created_at?: unknown }
interface Run { project?: unknown; state?: unknown; created_at?: unknown }
interface Project { name?: unknown; status?: unknown; updated_at?: unknown; created_at?: unknown }
interface Experience { summary?: unknown; title?: unknown; prompt?: unknown; note?: unknown; task_id?: unknown }

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

export interface DirectorView { state: string; focus: string; project: string; recent: string; pending: string }

/** Pure: derive the panel text from records + the live attention count. */
export function summarizeDirector(input: {
    goals: Goal[]; runs: Run[]; projects: Project[]; experiences: Experience[]; pending: number;
}): DirectorView {
    const activeGoal = [...input.goals]
        .filter(g => !TERMINAL.has(s(g.state)))
        .sort((a, b) => s(b.created_at).localeCompare(s(a.created_at)))[0];
    // "Current state" already carries Idle/Active; the focus field stays empty
    // rather than repeating it.
    const focus = activeGoal ? (s(activeGoal.title) || 'Active goal') : '—';

    const activeRun = input.runs.some(r => !TERMINAL.has(s(r.state)));
    const state = activeGoal || activeRun ? 'Active' : 'Idle';

    const newestRun = [...input.runs]
        .sort((a, b) => s(b.created_at).localeCompare(s(a.created_at)))[0];
    const activeProject = [...input.projects]
        .filter(p => s(p.status) === 'active')
        .sort((a, b) => s(b.updated_at || b.created_at).localeCompare(s(a.updated_at || a.created_at)))[0];
    const project = newestRun?.project ? s(newestRun.project)
        : activeProject ? s(activeProject.name) : '—';

    const first = input.experiences[0];
    const recent = input.experiences.length
        ? `${input.experiences.length} outcome(s) · latest: ${s(first?.summary || first?.title || first?.note || first?.prompt || first?.task_id) || 'recorded'}`
        : '—';

    return { state, focus, project, recent, pending: input.pending > 0 ? `${input.pending} awaiting you` : 'None' };
}

async function read<T>(path: string): Promise<T | null> {
    try {
        const r = await fetch('/api' + path);
        return r.ok ? await r.json() as T : null;
    } catch { return null; }
}

let wired = false;
let lastLoad = 0;

export async function loadDirector(): Promise<void> {
    lastLoad = Date.now();
    const [goals, runs, projects, experiences] = await Promise.all([
        read<Goal[]>('/goals'), read<Run[]>('/implementations'),
        // /autonomy/projects wraps its list as {projects: [...]}; the others are bare arrays.
        read<{ projects?: Project[] }>('/autonomy/projects').then(r => r?.projects ?? null),
        read<Experience[]>('/personality/experiences'),
    ]);
    const badge = $('attention-badge');
    const pending = badge && !badge.hasAttribute('hidden') ? (Number(badge.textContent || '0') || 0) : 0;
    const view = summarizeDirector({
        goals: goals || [], runs: runs || [], projects: projects || [],
        experiences: experiences || [], pending,
    });
    const set = (id: string, text: string) => { const el = $(id); if (el) el.textContent = text; };
    set('director-state', view.state);
    set('director-focus', view.focus);
    set('director-project', view.project);
    set('director-recent', view.recent);
    set('director-pending', view.pending);
}

export function initDirectorPanel(): void {
    if (wired) return;
    wired = true;
    $('director-open-conversation')?.addEventListener('click', () => openWorkspace('conversations'));
    $('director-inspect-work')?.addEventListener('click', () => openWorkspace('work'));
    $('director-view-activity')?.addEventListener('click', () => openWorkspace('activity'));
    void loadDirector();
    window.addEventListener('hermes:event', () => {
        if (Date.now() - lastLoad < 3000) return; // throttle: events are chatty
        void loadDirector();
    });
    window.setInterval(() => { void loadDirector(); }, 30000);
}

initDirectorPanel();
