/**
 * HL-AUTO-001 Phase 6: Projects portfolio (§26.9).
 *
 * A Work subview (Projects) showing the autonomous portfolio: projects with
 * origin badges and real milestone progress, proposals awaiting approval,
 * ranked opportunities, decision/experience history and budgets. Every state
 * shown comes from backend records — no fabricated progress.
 *
 * Controls hit the real endpoints: proposal approve/reject, project
 * pause/resume/cancel, bounded milestone retry. Live updates arrive through
 * the standard `hermes:event` window event (project./milestone./experience./
 * opportunity./proposal. families).
 */

import { registerKindRenderer, registerSummaryProvider } from './context-inspector.ts';
import { setSelection } from './navigation-state.ts';

type Project = {
    id: string; name: string; origin: string; remote_path: string; status: string;
    proposal_id?: string | null; spec_sha256?: string | null;
};
/** Row of the project registry (hl_projects via GET /api/projects). */
export type RegisteredProject = {
    name: string; host_path: string; spec_path?: string | null;
    remote_path?: string | null; commit_hash?: string | null; synced_at?: string | null;
};
/** GET /api/projects/{name}/changes response (read-only work-machine workspace diff). */
export type RegisteredChangeSet = {
    project: string; base_commit?: string | null; workspace?: string | null; output: string;
};
type Milestone = {
    id: string; project_name: string; title: string; state: string;
    blocker?: string | null; goal_id?: string | null; acceptance_criteria?: string | null;
    checkpoint?: { attempts?: number } | null;
};
type Proposal = {
    id: string; opportunity_id: string; version: number; title: string;
    status: string; specification: string; estimated_cost?: string | null;
};
type Experience = {
    id: string; project_name: string; classification: string; lesson?: string | null;
    measured_result: string;
};
type Opportunity = {
    id: string; title: string; status: string; confidence: number;
    evidence_refs?: string[]; score?: number;
};

export type PortfolioState = {
    projects: Project[];
    milestonesByProject: Record<string, Milestone[]>;
    proposals: Proposal[];
    experiences: Experience[];
    opportunities: Opportunity[];
    mode: string;
};

/** Pure state assembly — unit-tested. */
export function assemblePortfolio(
    projects: Project[],
    milestonesByProject: Record<string, Milestone[]>,
    proposals: Proposal[],
    experiences: Experience[],
    opportunities: Opportunity[],
    mode: string,
): PortfolioState {
    return {
        projects: projects.filter(p => p && p.name),
        milestonesByProject,
        proposals: proposals.filter(p => p.status === 'awaiting_approval'),
        experiences,
        opportunities: [...opportunities].sort(
            (a, b) => (b.score ?? b.confidence) - (a.score ?? a.confidence)),
        mode,
    };
}

/** Human-readable project summary for a card. Pure — unit-tested. */
export function projectSummary(project: Project, milestones: Milestone[]): string {
    const total = milestones.length;
    const done = milestones.filter(m => m.state === 'completed').length;
    const blocked = milestones.filter(m => m.state === 'blocked').length;
    const parts = [`${project.origin} · ${project.status}`];
    if (total) parts.push(`milestones ${done}/${total} completed`);
    if (blocked) parts.push(`${blocked} blocked`);
    return parts.join(' · ');
}

/** Which single control the card should offer first, from backend state. Pure. */
export function nextProjectAction(project: Project): 'pause' | 'resume' | null {
    if (project.status === 'active') return 'pause';
    if (project.status === 'paused') return 'resume';
    return null;
}

/** WebSocket event families this panel reacts to (live refresh trigger). Pure.
 * autonomy.* scheduler internals are deliberately excluded (no user-visible meaning). */
export function portfolioEventRelevant(type: string): boolean {
    return /^(project\.|milestone\.|experience\.|opportunity\.|proposal\.)/.test(type);
}

/* =====================================================================
 * HL-WORK-001 M2: registered projects (the project registry, not the
 * autonomous portfolio). All display state derives from GET /api/projects
 * rows; actions POST to the real registry endpoints.
 * ===================================================================== */

/** Sync state strictly from the registry row (never guessed client-side). Pure. */
export function registeredSyncState(p: RegisteredProject): 'synced' | 'not-synchronized' {
    return p.remote_path ? 'synced' : 'not-synchronized';
}

/** One-line card summary: repository, workspace state, autonomous overlap. Pure. */
export function registeredSummary(p: RegisteredProject, autonomousNames: ReadonlySet<string>): string {
    const parts = [p.host_path, registeredSyncState(p) === 'synced' ? 'synced to work machine' : 'not synchronized'];
    if (p.spec_path) parts.push(`spec: ${p.spec_path}`);
    if (autonomousNames.has(p.name)) parts.push('in autonomous portfolio');
    return parts.join(' · ');
}

/** Client-side mirror of the backend register rules (WorkspaceError causes). Pure. */
export function validateRegisterInput(input: { name: string; hostPath: string; specPath?: string }):
    { ok: true; payload: { name: string; host_path: string; spec_path?: string } } | { ok: false; error: string } {
    const name = input.name.trim();
    const hostPath = input.hostPath.trim();
    const specPath = (input.specPath ?? '').trim();
    if (!/^[a-z][a-z0-9-]{1,47}$/.test(name)) {
        return { ok: false, error: 'Name must be lowercase letters, digits or hyphens (2-48 chars, starting with a letter).' };
    }
    if (!hostPath.startsWith('/') || hostPath.length < 2) {
        return { ok: false, error: 'Host path must be an absolute directory path.' };
    }
    if (specPath.startsWith('/')) {
        return { ok: false, error: 'Spec path must be relative to the repository root.' };
    }
    return { ok: true, payload: { name, host_path: hostPath, ...(specPath ? { spec_path: specPath } : {}) } };
}

/** Split the registry's marked `git status`/`git diff` output for display. Pure. */
export function parseChangeOutput(output: string): { statusLines: string[]; diff: string } {
    const STATUS = '---GIT-STATUS---';
    const DIFF = '---GIT-DIFF---';
    const END = '---END-DIFF---';
    const startStatus = output.indexOf(STATUS);
    const startDiff = output.indexOf(DIFF);
    const endDiff = output.indexOf(END);
    if (startStatus < 0 || startDiff < 0) {
        return { statusLines: [], diff: output.trim() || '(no changes reported)' };
    }
    const statusLines = output.slice(startStatus + STATUS.length, startDiff).trim()
        .split('\n').filter(line => line.trim().length > 0);
    const diff = (endDiff > startDiff ? output.slice(startDiff + DIFF.length, endDiff) : '').trim();
    return { statusLines, diff: diff || '(no changes reported)' };
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
    document.getElementById(id) as T | null;
const node = (tag: string, text = '', cls = ''): HTMLElement => {
    const n = document.createElement(tag); n.textContent = text; if (cls) n.className = cls; return n;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const r = await fetch(path, init);
    if (!r.ok) {
        let detail = '';
        try { detail = JSON.stringify(await r.json()); } catch { /* no body */ }
        throw new Error(`HTTP ${r.status}: ${detail}`);
    }
    return await r.json() as T;
}
const post = <T>(path: string, data?: unknown): Promise<T> =>
    api<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }) });

let state: PortfolioState = {
    projects: [], milestonesByProject: {}, proposals: [], experiences: [],
    opportunities: [], mode: 'observe',
};
let selectedProject: string | null = null;
// HL-WORK-001 M2: project-registry state (independent of the autonomy fetch).
let registered: RegisteredProject[] = [];
let registeredError: string | null = null;
let registeredChanges: Record<string, RegisteredChangeSet> = {};
let openChangeSet: string | null = null;
let statusEl: HTMLElement | null = null;
let refreshing = false;

function setStatus(text: string): void {
    if (statusEl) statusEl.textContent = text;
}

async function refresh(): Promise<void> {
    if (refreshing) return;
    refreshing = true;
    try {
        const [projectsRes, proposalsRes, experiencesRes, rankedRes, configRes] =
            await Promise.all([
                api<{ projects: Project[] }>('/api/autonomy/projects'),
                api<{ proposals: Proposal[] }>('/api/proposals'),
                api<{ experiences: Experience[] }>('/api/autonomy/experiences'),
                api<{ opportunities: Opportunity[] }>('/api/opportunities/ranked'),
                api<{ mode: string }>('/api/autonomy/config'),
            ]);
        const milestonesByProject: Record<string, Milestone[]> = {};
        await Promise.all(projectsRes.projects.map(async p => {
            try {
                const res = await api<{ milestones: Milestone[] }>(
                    `/api/autonomy/projects/${encodeURIComponent(p.name)}/milestones`);
                milestonesByProject[p.name] = res.milestones;
            } catch { milestonesByProject[p.name] = []; }
        }));
        state = assemblePortfolio(projectsRes.projects, milestonesByProject,
            proposalsRes.proposals, experiencesRes.experiences,
            rankedRes.opportunities, configRes.mode);
        render();
        setStatus(`Last refreshed ${new Date().toLocaleTimeString()} · mode: ${state.mode}`);
    } catch (e) {
        setStatus('Portfolio unavailable: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
        refreshing = false;
    }
    // The registry has its own error surface: a failed registry call must
    // never blank the autonomy portfolio below (or the other way around).
    await refreshRegistered();
}

/** Names in the autonomous portfolio, for the registered-card overlap badge. */
function autonomousNames(): Set<string> {
    return new Set(state.projects.map(p => p.name));
}

async function refreshRegistered(): Promise<void> {
    try {
        const res = await api<{ projects: RegisteredProject[] }>('/api/projects');
        registered = res.projects.filter(p => p && p.name);
        registeredError = null;
        // Drop change sets for projects that disappeared from the registry.
        const known = new Set(registered.map(p => p.name));
        for (const name of Object.keys(registeredChanges)) {
            if (!known.has(name)) delete registeredChanges[name];
        }
    } catch (e) {
        registeredError = e instanceof Error ? e.message : String(e);
    }
    renderRegistered();
}

function renderRegistered(): void {
    const host = $('registered-list');
    if (!host) return;
    host.replaceChildren();
    if (registeredError) {
        host.append(node('p', 'Project registry unavailable: ' + registeredError, 'hint'));
        return;
    }
    if (!registered.length) {
        host.append(node('p', 'No projects registered yet. Register a Git repository below (it must live under the allowed project root).', 'hint'));
        return;
    }
    for (const project of registered) {
        host.append(registeredCard(project));
    }
}

function registeredCard(project: RegisteredProject): HTMLElement {
    const card = node('article', '', 'portfolio-card registered-card');
    const title = node('h3', project.name, 'portfolio-card__title');
    card.append(title);
    card.append(node('p', registeredSummary(project, autonomousNames())));
    const meta: string[] = [];
    if (project.remote_path) meta.push(`workspace: ${project.remote_path}`);
    if (project.commit_hash) meta.push(`commit ${project.commit_hash.slice(0, 12)}…`);
    if (project.synced_at) meta.push(`synced ${project.synced_at}`);
    if (meta.length) card.append(node('p', meta.join(' · '), 'hint'));

    const controls = node('div', '', 'portfolio-controls');
    const inspect = node('button', 'Inspect', 'portfolio-open') as HTMLButtonElement;
    inspect.type = 'button';
    inspect.addEventListener('click', () => {
        // Typed selection: the Context Inspector renders this registry row.
        setSelection('projects', { kind: 'project', id: project.name });
    });
    controls.append(inspect);

    const syncBtn = node('button', 'Sync to work machine') as HTMLButtonElement;
    syncBtn.type = 'button';
    syncBtn.addEventListener('click', async () => {
        syncBtn.disabled = true;
        try {
            await post(`/api/projects/${encodeURIComponent(project.name)}/sync`);
            await refresh();
        } catch (e) {
            setStatus('Sync failed: ' + (e instanceof Error ? e.message : String(e)));
            syncBtn.disabled = false;
        }
    });
    controls.append(syncBtn);

    const reviewBtn = node('button', 'Review changes') as HTMLButtonElement;
    reviewBtn.type = 'button';
    if (registeredSyncState(project) !== 'synced') {
        reviewBtn.disabled = true;
        reviewBtn.title = 'Synchronize the workspace first — changes are diffs inside the work-machine workspace.';
    }
    reviewBtn.addEventListener('click', async () => {
        reviewBtn.disabled = true;
        try {
            const res = await api<RegisteredChangeSet>(
                `/api/projects/${encodeURIComponent(project.name)}/changes`);
            registeredChanges[project.name] = res;
            openChangeSet = openChangeSet === project.name ? null : project.name;
            renderRegistered();
        } catch (e) {
            setStatus('Change review failed: ' + (e instanceof Error ? e.message : String(e)));
        } finally {
            reviewBtn.disabled = false;
        }
    });
    controls.append(reviewBtn);
    card.append(controls);

    if (openChangeSet === project.name) {
        const changes = registeredChanges[project.name];
        const panel = node('div', '', 'registered-changes');
        if (!changes) {
            panel.append(node('p', 'Change set not loaded.', 'hint'));
        } else {
            const parsed = parseChangeOutput(changes.output);
            panel.append(node('p',
                `Workspace ${changes.workspace ?? 'unknown'} against ${changes.base_commit ?? 'unknown commit'}`,
                'hint'));
            if (parsed.statusLines.length) {
                panel.append(node('p', `Changed files: ${parsed.statusLines.join('; ')}`, 'hint'));
            }
            const pre = node('pre', parsed.diff, 'registered-diff');
            pre.tabIndex = 0;
            panel.append(pre);
        }
        card.append(panel);
    }
    return card;
}

function render(): void {
    const list = $('portfolio-list');
    if (!list) return;
    list.replaceChildren();
    if (!state.projects.length) {
        list.append(node('p',
            'No autonomous projects yet. Projects appear here when an approved proposal is bootstrapped, or when a user registers one through the project manager.',
            'hint'));
    }
    for (const project of state.projects) {
        list.append(projectCard(project));
    }
    renderProposals();
    renderOpportunities();
    renderExperiences();
    if (selectedProject) renderDetail(selectedProject);
}

function projectCard(project: Project): HTMLElement {
    const card = node('article', '', 'portfolio-card');
    card.append(node('h3', project.name, 'portfolio-card__title'));
    card.append(node('p',
        projectSummary(project, state.milestonesByProject[project.name] ?? [])));
    const action = nextProjectAction(project);
    const controls = node('div', '', 'portfolio-controls');
    const open = node('button', 'Inspect', 'portfolio-open') as HTMLButtonElement;
    open.type = 'button';
    open.addEventListener('click', () => {
        selectedProject = project.name;
        renderDetail(project.name);
        // Sidebar shows the project too (registry facts + portfolio summary).
        setSelection('projects', { kind: 'project', id: project.name });
    });
    controls.append(open);
    if (action) {
        const btn = node('button', action === 'pause' ? 'Pause' : 'Resume') as HTMLButtonElement;
        btn.type = 'button';
        btn.addEventListener('click', async () => {
            try {
                await post(`/api/autonomy/projects/${encodeURIComponent(project.name)}/${action}`);
                await refresh();
            } catch (e) { setStatus(String(e)); }
        });
        controls.append(btn);
    }
    if (project.status === 'active' || project.status === 'paused') {
        const cancel = node('button', 'Cancel…') as HTMLButtonElement;
        cancel.type = 'button';
        cancel.addEventListener('click', async () => {
            if (!window.confirm(`Cancel project ${project.name}? Its open milestones will be cancelled.`)) return;
            try {
                await post(`/api/autonomy/projects/${encodeURIComponent(project.name)}/cancel`);
                await refresh();
            } catch (e) { setStatus(String(e)); }
        });
        controls.append(cancel);
    }
    card.append(controls);
    return card;
}

function renderDetail(name: string): void {
    const detail = $('portfolio-detail');
    if (!detail) return;
    detail.replaceChildren();
    const project = state.projects.find(p => p.name === name);
    if (!project) { selectedProject = null; return; }
    detail.append(node('h3', `Project: ${project.name}`));
    detail.append(node('p',
        `work-machine workspace: ${project.remote_path} · spec ${project.spec_sha256 ? project.spec_sha256.slice(0, 12) + '…' : 'n/a'}`,
        'hint'));
    const milestones = state.milestonesByProject[project.name] ?? [];
    if (!milestones.length) {
        detail.append(node('p', 'No milestones recorded for this project yet.', 'hint'));
    }
    for (const m of milestones) {
        const row = node('div', '', 'portfolio-milestone');
        row.append(node('strong', m.title));
        row.append(node('span', ` — ${m.state}`, `milestone-state milestone-${m.state}`));
        if (m.blocker) row.append(node('p', `Blocked: ${m.blocker}`, 'hint'));
        if (m.acceptance_criteria) row.append(node('p', `Acceptance: ${m.acceptance_criteria}`, 'hint'));
        if (m.state === 'blocked' && m.goal_id == null) {
            const retry = node('button', 'Retry (bounded)') as HTMLButtonElement;
            retry.type = 'button';
            retry.addEventListener('click', async () => {
                try {
                    await post(`/api/autonomy/milestones/${encodeURIComponent(m.id)}/retry`);
                    await refresh();
                } catch (e) { setStatus(String(e)); }
            });
            row.append(retry);
        }
        if (m.goal_id) {
            const link = node('button', 'View task →') as HTMLButtonElement;
            link.type = 'button';
            link.addEventListener('click', () => {
                window.dispatchEvent(new CustomEvent('hermes:open-task', { detail: { taskId: m.goal_id } }));
            });
            row.append(link);
        }
        detail.append(row);
    }
    const projectExperiences = state.experiences.filter(e => e.project_name === project.name);
    if (projectExperiences.length) {
        detail.append(node('h4', 'Outcome records'));
        for (const exp of projectExperiences.slice(0, 5)) {
            detail.append(node('p', `[${exp.classification}] ${exp.lesson ?? exp.measured_result}`));
        }
    }
}

function renderProposals(): void {
    const host = $('portfolio-proposals');
    if (!host) return;
    host.replaceChildren();
    if (!state.proposals.length) {
        host.append(node('p', 'No proposals awaiting your decision.', 'hint'));
        return;
    }
    for (const proposal of state.proposals) {
        const card = node('article', '', 'portfolio-proposal');
        card.append(node('h4', `${proposal.title} (v${proposal.version})`));
        card.append(node('p', proposal.specification));
        const approve = node('button', 'Approve') as HTMLButtonElement;
        approve.type = 'button';
        approve.addEventListener('click', async () => {
            try {
                await post(`/api/proposals/${encodeURIComponent(proposal.id)}/decision`,
                    { approve: true, rationale: 'Approved from the Projects portfolio' });
                await refresh();
            } catch (e) { setStatus(String(e)); }
        });
        const reject = node('button', 'Reject') as HTMLButtonElement;
        reject.type = 'button';
        reject.addEventListener('click', async () => {
            const reason = window.prompt('Why is this proposal rejected?');
            if (!reason) return;
            try {
                await post(`/api/proposals/${encodeURIComponent(proposal.id)}/decision`,
                    { approve: false, rationale: reason });
                await refresh();
            } catch (e) { setStatus(String(e)); }
        });
        card.append(approve, reject);
        host.append(card);
    }
}

function renderOpportunities(): void {
    const host = $('portfolio-opportunities');
    if (!host) return;
    host.replaceChildren();
    if (!state.opportunities.length) {
        host.append(node('p', 'No candidate opportunities yet. Run an opportunity scan from Discover.', 'hint'));
        return;
    }
    for (const opportunity of state.opportunities.slice(0, 8)) {
        const score = opportunity.score ?? opportunity.confidence;
        host.append(node('p',
            `${opportunity.title} — confidence ${opportunity.confidence.toFixed(2)}, score ${Number(score).toFixed(2)} [${opportunity.status}]`));
    }
}

function renderExperiences(): void {
    const host = $('portfolio-experiences');
    if (!host) return;
    host.replaceChildren();
    if (!state.experiences.length) {
        host.append(node('p', 'No outcome records yet.', 'hint'));
        return;
    }
    for (const exp of state.experiences.slice(0, 8)) {
        host.append(node('p', `[${exp.classification}] ${exp.project_name}: ${exp.lesson ?? exp.measured_result}`));
    }
}

// Projects-view inspector card (registered once; reads live registry state).
registerKindRenderer('project', (sel, body) => {
    const p = registered.find(r => r.name === sel.id);
    const auto = state.projects.find(a => a.name === sel.id);
    if (!p && !auto) {
        body.append(node('p', 'This project is not loaded right now.', 'hint'));
        return;
    }
    body.append(node('strong', sel.id));
    if (p) {
        body.append(node('p', registeredSummary(p, autonomousNames())));
        body.append(node('p', p.remote_path ? `work-machine workspace: ${p.remote_path}` : 'No work-machine workspace synchronized yet.', 'hint'));
        if (p.commit_hash) {
            body.append(node('p', `Base commit ${p.commit_hash.slice(0, 12)}…` +
                (p.synced_at ? ` · synced ${p.synced_at}` : ''), 'hint'));
        }
    }
    if (auto) {
        body.append(node('p', projectSummary(auto, state.milestonesByProject[auto.name] ?? [])));
    }
    body.append(node('p', 'Sync and change-review actions are on the project card.', 'hint'));
});

registerSummaryProvider('projects', () => ({
    line: 'Select a project card to see it here.',
    chips: registered.length ? [{ label: 'registered', count: registered.length }] : undefined,
}));

function wireRegisterForm(): void {
    const form = $('registered-form') as HTMLFormElement | null;
    const submit = $('registered-submit') as HTMLButtonElement | null;
    const errEl = $('registered-error');
    if (!form || !submit) return;
    form.addEventListener('submit', async ev => {
        ev.preventDefault();
        const read = (id: string): string =>
            ((document.getElementById(id) as HTMLInputElement | null)?.value ?? '');
        const parsed = validateRegisterInput({
            name: read('registered-name'),
            hostPath: read('registered-host-path'),
            specPath: read('registered-spec-path'),
        });
        if (!parsed.ok) {
            if (errEl) { errEl.hidden = false; errEl.textContent = parsed.error; }
            return;
        }
        submit.disabled = true;
        try {
            await post('/api/projects', parsed.payload);
            if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
            for (const input of Array.from(form.querySelectorAll<HTMLInputElement>('input'))) input.value = '';
            $('registered-register')?.removeAttribute('open');
            await refresh();
        } catch (e) {
            if (errEl) { errEl.hidden = false; errEl.textContent = e instanceof Error ? e.message : String(e); }
        } finally {
            submit.disabled = false;
        }
    });
}

export function installPortfolio(): void {
    const panel = $('workview-projects');
    if (!panel || panel.dataset.portfolioInstalled === '1') return;
    panel.dataset.portfolioInstalled = '1';
    statusEl = $('portfolio-status');
    const refreshBtn = $('portfolio-refresh') as HTMLButtonElement | null;
    refreshBtn?.addEventListener('click', () => void refresh());
    wireRegisterForm();
    window.addEventListener('hermes:event', ((evt: CustomEvent) => {
        const type = String((evt.detail as { type?: string })?.type ?? '');
        if (portfolioEventRelevant(type)) void refresh();
    }) as EventListener);
    void refresh();
}
