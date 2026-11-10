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

type Project = {
    id: string; name: string; origin: string; vm_path: string; status: string;
    proposal_id?: string | null; spec_sha256?: string | null;
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
    open.addEventListener('click', () => { selectedProject = project.name; renderDetail(project.name); });
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
        `VM workspace: ${project.vm_path} · spec ${project.spec_sha256 ? project.spec_sha256.slice(0, 12) + '…' : 'n/a'}`,
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

export function installPortfolio(): void {
    const panel = $('workview-projects');
    if (!panel || panel.dataset.portfolioInstalled === '1') return;
    panel.dataset.portfolioInstalled = '1';
    statusEl = $('portfolio-status');
    const refreshBtn = $('portfolio-refresh') as HTMLButtonElement | null;
    refreshBtn?.addEventListener('click', () => void refresh());
    window.addEventListener('hermes:event', ((evt: CustomEvent) => {
        const type = String((evt.detail as { type?: string })?.type ?? '');
        if (portfolioEventRelevant(type)) void refresh();
    }) as EventListener);
    void refresh();
}
