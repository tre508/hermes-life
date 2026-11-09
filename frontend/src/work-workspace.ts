/**
 * Unified Work workspace. The backing is /api/tasks (every task) plus
 * /api/workflow/status (the one read-only resolver that links a task to its
 * discovery → plan → run → verification → review chain). Selecting a task renders:
 *   - a header (objective, status, elapsed time)
 *   - a lifecycle progress strip (Investigate → Plan → Build → Test → Review → Complete
 *     for chained work, or Investigate → Work → Respond for answered-only tasks)
 *   - per-stage detail, always fed by real backend fields.
 */
import { deriveLifecycle, type LifeStage, type Chain, type TaskRec } from './task-lifecycle.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const node = (tag: string, text = '', cls = ''): HTMLElement => {
    const n = document.createElement(tag); n.textContent = text; if (cls) n.className = cls; return n;
};
const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

type ChainMap = Record<string, Chain>;
let tasks: TaskRec[] = [];
let chainByTask: ChainMap = {};
let selectedId: string | null = null;
let currentStages: LifeStage[] = [];

async function api(path: string): Promise<{ [k: string]: unknown } | unknown[]> {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : {};
}

async function loadData() {
    const [taskRows, snapshot] = await Promise.all([
        api('/api/tasks'),
        api('/api/workflow/status'),
    ]);
    tasks = Array.isArray(taskRows) ? taskRows as TaskRec[] : [];
    chainByTask = {};
    const discoveries = snapshot && typeof snapshot === 'object' ? (snapshot as { discoveries?: Record<string, Chain> }).discoveries : {};
    if (discoveries) {
        for (const id of Object.keys(discoveries)) {
            const ann = discoveries[id];
            if (ann && ann.task_id) chainByTask[str(ann.task_id)] = { ...ann, discovery_id: ann.discovery_id ?? id };
        }
    }
    renderList();
    if (selectedId) renderDetail(selectedId);
}

function stateClass(s: string): string {
    const st = s.toLowerCase();
    if (['queued', 'pending'].includes(st)) return 'queued';
    if (['running'].includes(st)) return 'running';
    if (st === 'completed') return 'completed';
    return 'failed';
}

function renderList() {
    const host = $('task-list'); if (!host) return;
    host.replaceChildren();
    const count = $('work-task-count'); if (count) count.textContent = `${tasks.length} total`;
    if (!tasks.length) { host.append(node('p', 'No tasks yet. Submit one from Home.', 'hint')); return; }
    const sorted = [...tasks].sort((a, b) => Date.parse(str(b.created_at)) - Date.parse(str(a.created_at)));
    for (const t of sorted) {
        const entry = node('div', '', 'task-entry'); entry.dataset.taskId = str(t.id);
        if (selectedId === t.id) entry.classList.add('task-selected');
        const stateChip = node('span', stateClass(str(t.state)), `task-state ${stateClass(str(t.state))}`);
        const prompt = node('span', str(t.prompt), 'task-prompt');
        const meta = node('span', `${new Date(str(t.created_at)).toLocaleString()} · ${str(t.id).slice(0, 8)}`, 'task-meta');
        const chain = chainByTask[str(t.id)];
        if (chain?.status) meta.textContent += ` · ${str(chain.status)}`;
        entry.append(stateChip, prompt, meta);
        entry.addEventListener('click', () => selectTask(str(t.id)));
        host.append(entry);
    }
}

function selectTask(id: string) {
    selectedId = id;
    renderList();
    renderDetail(id);
    const list = $('task-list-container'), detail = $('task-detail-container');
    if (list) list.hidden = true;
    if (detail) detail.hidden = false;
}

function backToList() {
    selectedId = null;
    const list = $('task-list-container'), detail = $('task-detail-container');
    if (list) list.hidden = false;
    if (detail) detail.hidden = true;
    renderList();
    updateSelection(null);
}

const STAGE_ORDER = ['overview', 'investigate', 'plan', 'build', 'test', 'review', 'outcome'];
function lifecycleStages(stages: LifeStage[]): string {
    const ol = node('ol', '', 'lifecycle');
    for (const s of stages) {
        const li = document.createElement('li');
        li.textContent = s.label;
        li.className = s.state; // pending / current / complete / blocked / failed map to CSS classes
        ol.append(li);
    }
    return ol.outerHTML;
}

function backButton(): HTMLElement {
    const b = node('button', '← All tasks', '') as HTMLButtonElement; b.type = 'button';
    b.addEventListener('click', backToList);
    return b;
}

function openResults(id: string) {
    window.dispatchEvent(new CustomEvent('hermes:open-task', { detail: { id } }));
}

function jumpTo(stageKey: string) {
    const targets: Record<string, string> = {
        plan: 'planning', build: 'build', investigate: 'discover', review: 'build',
    };
    const view = targets[stageKey];
    window.dispatchEvent(new CustomEvent('hermes:workview', { detail: { view } }));
}

function renderStage(key: string, t: TaskRec, c: Chain | null) {
    const body: HTMLElement[] = [];
    const card = (title: string, bodyHTML: string) => {
        const c = node('div', '', 'stage-card');
        const h = document.createElement('h4'); h.textContent = title;
        c.append(h); c.insertAdjacentHTML('beforeend', bodyHTML); return c;
    };
    if (key === 'overview') {
        const chainVal = c;
        const chainDesc = chainVal ? `${str(chainVal.status || '')} · ${str(chainVal.reason || '')}` : 'No discovery chain — answered-only work';
        body.push(card('Objective & status', `<p class="stage-status">${esc(str(t.prompt))}</p>` +
            `<p class="stage-reason">State: <strong>${esc(str(t.state))}</strong> · Created ${new Date(str(t.created_at)).toLocaleString()} · ${esc(str(t.id))}</p>` +
            `<p class="stage-reason">${esc(chainDesc)}</p>`));
        return body;
    }
    if (key === 'investigate') {
        const note = c && str(c.status) !== '' ? `Discovery · ${esc(str(c.status))}` : 'No investigation chain for this task.';
        const reason = c ? esc(str(c.reason || '')) : '';
        body.push(card('Investigation', `<p class="stage-status">${note}</p>${reason ? `<p class="stage-reason">${reason}</p>` : ''}`));
        if (c) body[0].insertAdjacentHTML('beforeend', `<button type="button" class="stage-action" data-jump="discover">Open Discover →</button>`);
        body[0].querySelector('[data-jump="discover"]')?.addEventListener('click', () => { window.dispatchEvent(new CustomEvent('hermes:workview', { detail: { view: 'discover' } })); });
        return body;
    }
    if (key === 'plan' || key === 'build' || key === 'test' || key === 'review') {
        const s = currentStages.find(x => x.key === key);
        const label = { plan: 'Plan', build: 'Build', test: 'Test', review: 'Review' }[key];
        const detail = s?.note ? `<p class="stage-reason">${esc(s.note)}</p>` : (c && str(c.reason) ? `<p class="stage-reason">${esc(str(c.reason))}</p>` : '');
        const actionView = key === 'plan' || key === 'build' ? key : key === 'review' ? 'build' : 'work';
        body.push(card(label!,
            `<p class="stage-status">${esc(s?.state === 'complete' ? 'Complete' : s?.state === 'current' ? 'In progress' : s?.state === 'failed' ? 'Failed' : s?.state === 'blocked' ? 'Blocked' : 'Awaiting the prior stage')}</p>` + detail +
            `<button type="button" class="stage-action" data-open-rel="${actionView}">Manage in Work →</button>`));
        body[0].querySelector('[data-open-rel]')?.addEventListener('click', (e) => {
            const view = (e.currentTarget as HTMLElement).dataset.openRel || 'work';
            window.dispatchEvent(new CustomEvent('hermes:workview', { detail: { view } }));
        });
        if (s?.state === 'current') body[0].insertAdjacentHTML('beforeend', `<button type="button" class="stage-action" data-open-live="1">Open this task in Results →</button>`);
        body[0].querySelector('[data-open-live]')?.addEventListener('click', () => openResults(str(t.id)));
        return body;
    }
    // outcome
    const answered = str(t.result);
    body.push(card('Outcome', `<p class="stage-status">${str(t.state) === 'completed' ? 'Completed' : esc(str(t.state))}</p>\n` +
        `<pre style="white-space:pre-wrap;white-space:wrap;font-size:12px;color:#cfddd7">${esc(answered.slice(0, 2000)) || 'No answer text recorded.'}</pre>` +
        (t.error ? `<p class="stage-reason">Error: ${esc(str(t.error))}</p>` : '') +
        `<button type="button" class="stage-action" data-outcome="results">Open full answer in Results →</button>`));
    body[body.length - 1].querySelector('[data-outcome]')?.addEventListener('click', () => openResults(str(t.id)));
    return body;
}

function renderDetail(id: string) {
    const host = $('task-detail-container'); if (!host) return;
    const t = tasks.find(x => x.id === id); if (!t) return;
    const c = chainByTask[id] ?? null;
    currentStages = deriveLifecycle(t, c);
    updateSelection(t);

    host.replaceChildren();
    const shell = node('div', '', 'task-detail-shell');
    shell.append(backButton());

    const head = node('div', '', 'task-detail-head');
    const h = node('h3', str(t.prompt));
    const meta = node('div', `${str(t.state)} · ${new Date(str(t.created_at)).toLocaleString()} · ${c ? 'workflow-linked' : 'manual task'}`, 'task-detail-meta');
    head.append(h, meta);
    shell.append(head);

    shell.insertAdjacentHTML('beforeend', lifecycleStages(currentStages));

    const stageNav = node('div', '', 'task-stage-nav');
    let activeStage = STAGE_ORDER[0];
    const navLabels: Record<string, string> = { overview: 'Overview', investigate: 'Investigation', plan: 'Plan', build: 'Implementation', test: 'Verification', review: 'Review', outcome: 'Outcome' };
    const navButtons = new Map<string, HTMLButtonElement>();
    for (const key of STAGE_ORDER) {
        const b = node('button', navLabels[key]) as HTMLButtonElement; b.type = 'button'; b.dataset.stage = key;
        if (key === activeStage) b.classList.add('active');
        b.addEventListener('click', () => { activeStage = key; stageNav.querySelectorAll('button').forEach(x => x.classList.remove('active')); b.classList.add('active'); paintStage(); });
        navButtons.set(key, b); stageNav.append(b);
    }
    shell.append(stageNav);

    const content = node('div', '', 'task-stage-content');
    shell.append(content);

    function paintStage() {
        const fresh = tasks.find(x => x.id === id);
        const current = (fresh ?? t) as TaskRec;
        const chainNow = fresh ? (chainByTask[str(fresh.id)] ?? null) : c;
        currentStages = deriveLifecycle(current, chainNow);
        const cards = renderStage(activeStage, current, chainNow);
        content.replaceChildren(); cards.forEach(cd => content.append(cd));
    }
    paintStage();
    host.append(shell);
}

function updateSelection(t: TaskRec | null) {
    const ctx = $('ctx-selection'), body = $('ctx-selection-body');
    if (!ctx || !body) return;
    if (!t) { ctx.hidden = true; body.textContent = ''; return; }
    ctx.hidden = false;
    const c = chainByTask[str(t.id)];
    body.replaceChildren();
    const h = node('strong', str(t.prompt) || 'Task'); body.append(h);
    body.append(node('p', `${str(t.state)} · ${c ? str(c.status) : 'manual task'}`));
    body.append(node('p', `Created ${new Date(str(t.created_at)).toLocaleString()}`));
    const open = node('button', 'Open in Results →', '') as HTMLButtonElement; open.type = 'button';
    open.addEventListener('click', () => openResults(str(t.id))); body.append(open);
}

// Refresh the open task when its lifecycle events arrive (started/completed/failed).
window.addEventListener('hermes:event', ((ev: Event) => {
    const detail = (ev as CustomEvent<{ type?: string; task_id?: string | null }>).detail;
    if (!detail || !selectedId) return;
    const type = detail.type || '';
    if (type.startsWith('task.') || type === 'hermes.result') {
        const delta = type === 'task.queued' || type === 'task.started' || type === 'task.completed' || type === 'task.failed';
        if (delta) { void loadData(); if (detail.task_id !== selectedId) { /* keep selection */ } }
    }
}) as EventListener);

// Work sub-navigation: scroll to the matching management section and highlight.
function wireSubnav() {
    const nav = $('work-subnav'); if (!nav) return;
    const anchors: Record<string, string> = {
        tasks: 'task-list-container',
        discover: 'discovery-section',
        goals: 'autonomy-section',
        planning: 'plans-list',
        build: 'implementations-list',
    };
    nav.querySelectorAll<HTMLButtonElement>('button[data-workview]').forEach(btn => {
        btn.addEventListener('click', () => {
            nav.querySelectorAll('button[data-workview]').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
            btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true');
            const targetId = anchors[btn.dataset.workview || 'tasks'];
            const target = targetId ? document.getElementById(targetId) : null;
            if (target) (target.closest('details') || target).scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });
}

// Deep-link from the phase modules and lifecycle cards: route to a Work sub-view.
window.addEventListener('hermes:workview', ((ev: Event) => {
    const view = (ev as CustomEvent<{ view?: string }>).detail?.view;
    if (!view) return;
    const nav = $('work-subnav');
    const btn = nav?.querySelector<HTMLButtonElement>(`button[data-workview="${view}"]`);
    if (btn) btn.click();
}) as EventListener);

let started = false;
function initialize() {
    if (started) return; started = true;
    wireSubnav();
    void loadData();
    // Light auto-refresh while a task is running.
    window.setInterval(() => { if (selectedId) void loadData(); }, 15000);
}
initialize();
