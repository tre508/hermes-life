/**
 * Unified Work workspace. The backing is:
 *  - /api/tasks (every task)                  — task list / metadata
 *  - /api/workflow/status                     — task → discovery/plan/run/verify/review
 *  - /api/conversations/{cid}/turns           — chronological turns for the
 *                                                 active task's conversation
 *  - /api/investigation-plans/{plan_id}/approve (POST)
 *  - /api/implementations/{run_id}/review     via hermes:open-task event
 *
 * Selecting a task renders:
 *   1. an actionable panel whose buttons come from the workflow `next_action`
 *      field (review_investigation / approve_plan / open_review / history…)
 *   2. the conversation thread (user turns on the right, Hermes on the left),
 *      auto-refreshing on hermes:event
 *   3. a persistent composer with draft preservation so a half-typed reply
 *      survives navigation and is wired into the same conversation_id on submit
 *
 * Work subviews (Tasks / Discover / Goals / Planning / Build) are exclusive
 * panels under #workview-outlet. Only one is visible at a time. Switching is
 * driven by navigation-state.ts openWorkView() → onNavigationChange → setWorkView().
 * No scrollIntoView for navigation.
 */
import { type LifeStage, type Chain, type TaskRec } from './task-lifecycle.ts';
import { mountThread, type Turn } from './conv-thread.ts';
import { mountTaskComposer, type TaskComposerHandle } from './task-composer.ts';
import { openWorkView, openTask, openActivityForTask, onNavigationChange, getCurrentWorkView, registerTaskValidator, setSelection, type WorkView } from './navigation-state.ts';
import { registerKindRenderer, registerSummaryProvider } from './context-inspector.ts';
import { FQ, fqLine } from './five-questions.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const node = (tag: string, text = '', cls = ''): HTMLElement => {
    const n = document.createElement(tag); n.textContent = text; if (cls) n.className = cls; return n;
};
const esc = (s: string): string => s.replace(/[&<>\"']/g, c => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": "''" }[c]!));

type ChainMap = Record<string, Chain>;
let tasks: TaskRec[] = [];
let chainByTask: ChainMap = {};
let selectedId: string | null = null;
let currentStages: LifeStage[] = [];

// Thread handle per task selection. Rebuilt when selection changes.
type ConvHandles = {
    thread: ReturnType<typeof mountThread> | null;
    composer: TaskComposerHandle | null;
};
let convHandles: ConvHandles | null = null;

// The conversation bound to the currently rendered task — used by the
// "Open in Chat" hand-off so the floating chat continues THIS thread.
let selectedConversationId: string | null = null;

// Track the currently rendered task's identity to avoid unnecessary rebuilds
let renderedTaskId: string | null = null;
let renderedConversationId: string | null = null;

// Per-workview scroll position restoration
const scrollPositions: Record<string, number> = {};
let currentWorkView = 'tasks';

async function api(path: string): Promise<{ [k: string]: unknown } | unknown[]> {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : {};
}

/** Controlled empty state for a deep-linked task that does not exist
 *  (deleted, or the id was mistyped). Never a silent disappearance: the
 *  user sees what happened and a way back. */
function showTaskNotFound(id: string) {
    renderedTaskId = null;
    renderedConversationId = null;
    selectedConversationId = null;
    if (convHandles) {
        try { convHandles.thread?.dispose(); } catch { /* noop */ }
        try { convHandles.composer?.dispose(); } catch { /* noop */ }
        convHandles = null;
    }
    const host = $('task-detail-container');
    if (host) {
        host.replaceChildren();
        const shell = node('div', '', 'task-detail-shell');
        shell.append(backButton());
        shell.append(node('p',
            `Task ${id.slice(0, 8)} does not exist (it may have been removed, or the link is stale). Pick another task from the list.`,
            'hint'));
        host.append(shell);
        host.hidden = false;
    }
    const list = $('task-list-container'); if (list) list.hidden = true;
    const center = document.getElementById('app'); if (center) center.classList.add('work-detail-open');
    const empty = $('task-center-empty'); if (empty) empty.style.display = 'none';
    renderContext(null);
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
    if (selectedId) {
        // A selected task that vanished between refreshes gets the
        // controlled empty state — never a silent disappearance.
        if (tasks.length && !tasks.some(t => str(t.id) === selectedId)) {
            showTaskNotFound(selectedId);
            return;
        }
        reconcileDetail(selectedId);
    }
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
        const cid = t.conversation_id ? String(t.conversation_id).slice(0, 8) : '';
        const meta = node('span',
            `${new Date(str(t.created_at)).toLocaleString()} · ${str(t.id).slice(0, 8)}`
            + (cid ? ` · conv ${cid}` : ''),
            'task-meta');
        const chain = chainByTask[str(t.id)];
        if (chain?.status) meta.textContent += ` · ${str(chain.status)}`;
        entry.append(stateChip, prompt, meta);
        entry.addEventListener('click', () => selectTask(str(t.id)));
        host.append(entry);
    }
}

function selectTask(id: string) {
    const changed = selectedId !== id;
    selectedId = id;
    renderedTaskId = null; // Force fresh render on selection change
    renderedConversationId = null;
    renderList();
    renderDetail(id);
    renderContext(id);
    const list = $('task-list-container'), detail = $('task-detail-container');
    const center = document.getElementById('app');
    const empty = $('task-center-empty');
    if (list) list.hidden = true;
    if (detail) detail.hidden = false;
    if (center) center.classList.add('work-detail-open');
    if (empty) empty.style.display = 'none';
    // A real selection change is a navigation gesture: it updates the
    // canonical state (and pushes a history entry). Same-task re-selection
    // (background refresh) replaces the URL instead.
    if (changed) openTask(id, { destination: 'work' });
}

function backToList() {
    selectedId = null;
    renderedTaskId = null;
    renderedConversationId = null;
    selectedConversationId = null;
    const list = $('task-list-container'), detail = $('task-detail-container');
    const center = document.getElementById('app');
    const empty = $('task-center-empty');
    if (list) list.hidden = false;
    if (detail) detail.hidden = true;
    if (center) center.classList.remove('work-detail-open');
    if (empty) empty.style.display = '';
    renderList();
    updateSelection(null);
    if (convHandles) {
        try { convHandles.thread?.dispose(); } catch { /* noop */ }
        try { convHandles.composer?.dispose(); } catch { /* noop */ }
        convHandles = null;
    }
    renderContext(null);
    openTask(null, { destination: 'work' });
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
    openTask(id, { destination: 'results' });
}

/** §5: land on the implementation run's card in Builds, which shows the
 *  candidate/baseline test outcome plus the verification verdicts. */
function openBuildRun(runId: string) {
    openWorkView('builds');
    setSelection('builds', { kind: 'build', id: runId });
    // The card mounts on the next render tick; scroll once it exists.
    window.setTimeout(() => {
        document.getElementById(`hl415-run-${runId}`)?.scrollIntoView({ block: 'nearest' });
    }, 0);
}

/** §5: the candidate review owns the revision decision. Deep-link to it rather
 *  than firing the mutation from here — the review holds the snapshot hash,
 *  criteria verdicts and feedback field the request requires. */
function openCandidateReview(runId: string) {
    openWorkView('builds');
    window.dispatchEvent(new CustomEvent('hermes:open-review', { detail: { run_id: runId } }));
}

function jumpTo(stageKey: string) {
    const targets: Record<string, string> = {
        plan: 'plans', build: 'builds', investigate: 'discoveries', review: 'builds',
    };
    const view = targets[stageKey];
    openWorkView(view as WorkView);
}

// Legacy per-stage renderer kept so the Work subnav (Discover / Planning /
// Build) still has a usable card. Not the primary view anymore.
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
        body[0].querySelector('[data-jump="discover"]')?.addEventListener('click', () => { openWorkView('discoveries'); });
        return body;
    }
    if (key === 'plan' || key === 'build' || key === 'test' || key === 'review') {
        const s = currentStages.find(x => x.key === key);
        const label = { plan: 'Plan', build: 'Build', test: 'Test', review: 'Review' }[key];
        const detail = s?.note ? `<p class="stage-reason">${esc(s.note)}</p>` : (c && str(c.reason) ? `<p class="stage-reason">${esc(str(c.reason))}</p>` : '');
        const actionView = key === 'plan' ? 'plans' : key === 'build' || key === 'review' ? 'builds' : 'tasks';
        body.push(card(label!,
            `<p class="stage-status">${esc(s?.state === 'complete' ? 'Complete' : s?.state === 'current' ? 'In progress' : s?.state === 'failed' ? 'Failed' : s?.state === 'blocked' ? 'Blocked' : 'Awaiting the prior stage')}</p>` + detail +
            `<button type="button" class="stage-action" data-open-rel="${actionView}">Manage in Work →</button>`));
        body[0].querySelector('[data-open-rel]')?.addEventListener('click', (e) => {
            const view = (e.currentTarget as HTMLElement).dataset.openRel || 'tasks';
            openWorkView(view as WorkView);
        });
        if (s?.state === 'current') body[0].insertAdjacentHTML('beforeend', `<button type="button" class="stage-action" data-open-live="1">Open this task in Results →</button>`);
        body[0].querySelector('[data-open-live]')?.addEventListener('click', () => openResults(str(t.id)));
        return body;
    }
    const answered = str(t.result);
    body.push(card('Outcome', `<p class="stage-status">${str(t.state) === 'completed' ? 'Completed' : esc(str(t.state))}</p>\n` +
        `<pre style="white-space:pre-wrap;white-space:wrap;font-size:12px;color:#cfddd7">${esc(answered.slice(0, 2000)) || 'No answer text recorded.'}</pre>` +
        (t.error ? `<p class="stage-reason">Error: ${esc(str(t.error))}</p>` : '') +
        `<button type="button" class="stage-action" data-outcome="results">Open full answer in Results →</button>`));
    body[body.length - 1].querySelector('[data-outcome]')?.addEventListener('click', () => openResults(str(t.id)));
    return body;
}

/** Reconcile the task detail in place — only rebuild if task/conversation identity changed. */
function reconcileDetail(id: string) {
    const t = tasks.find(x => x.id === id); if (!t) return;
    const c = chainByTask[id] ?? null;
    const convId = t.conversation_id ? String(t.conversation_id) : '';

    // If same task and same conversation, just update dynamic parts
    if (renderedTaskId === id && renderedConversationId === convId) {
        updateDynamicParts(t, c);
        return;
    }

    // Otherwise full rebuild (task or conversation changed)
    renderDetail(id);
    renderedTaskId = id;
    renderedConversationId = convId;
}

/** Update only dynamic parts of the detail view (action panel, context) without rebuilding the thread. */
function updateDynamicParts(t: TaskRec, c: Chain | null) {
    // Update action panel
    const actionPanelHost = $('task-detail-container')?.querySelector('.task-actions');
    if (actionPanelHost) {
        actionPanelHost.replaceChildren(renderActionPanel(t, c));
    }

    // Update context panel
    renderContext(str(t.id));
}

function renderDetail(id: string) {
    const host = $('task-detail-container'); if (!host) return;
    const t = tasks.find(x => x.id === id); if (!t) return;
    const c = chainByTask[id] ?? null;
    updateSelection(t);

    // Tear down the previous selection's thread/composer (each gets its
    // own DOM and listener set; we want a clean slate on task switch).
    if (convHandles) {
        try { convHandles.thread?.dispose(); } catch { /* noop */ }
        try { convHandles.composer?.dispose(); } catch { /* noop */ }
        convHandles = null;
    }

    host.replaceChildren();
    const shell = node('div', '', 'task-detail-shell');
    shell.append(backButton());

    const head = node('div', '', 'task-detail-head');
    const h = node('h3', str(t.prompt).slice(0, 220));
    const cId = t.conversation_id ? String(t.conversation_id) : '';
    const meta = node('div',
        `${str(t.state).toUpperCase()} · ${new Date(str(t.created_at)).toLocaleString()}`
        + (cId ? ` · conversation ${cId.slice(0, 8)}` : '')
        + (c ? ` · ${str(c.status || c.stage || 'workflow')}` : ''),
        'task-detail-meta');
    head.append(h, meta);
    shell.append(head);

    shell.append(renderActionPanel(t, c));

    const threadHost = node('div', '', 'task-thread-host');
    threadHost.id = `task-thread-host-${id}`;
    shell.append(threadHost);

    const composerHost = node('div', '', 'task-composer-host');
    shell.append(composerHost);

    host.append(shell);

    const convId = cId || null;
    selectedConversationId = convId;

    // convo-redesign.md §6: a persistent, state-adaptive composer in the task
    // workspace. It hands text to Chat (`hermes:open-in-chat` + submit:true) so
    // there is still exactly one conversation and one send path.
    const composer = mountTaskComposer(composerHost, () => ({
        state: t.state,
        nextAction: c ? c.next_action : '',
        taskId: String(t.id),
        conversationId: convId,
    }));

    const thread = convId
        ? mountThread({
            host: threadHost,
            getConversation: async () => ({ conversation_id: convId }),
            getFilterTaskId: () => String(t.id),
            onTaskClick: (otherId) => { void selectTask(otherId); },
        })
        : null;

    convHandles = { thread, composer };

    renderedTaskId = id;
    renderedConversationId = convId;
}

/** Compose the actionable next-action panel from the task's chain.
 *  Each button maps to an existing backend endpoint or to the authoritative
 *  event the rest of the app already emits. We never fabricate an "Apply
 *  Changes" button without an authorized backend route. */
function renderActionPanel(t: TaskRec, c: Chain | null): HTMLElement {
    const panel = node('div', '', 'task-actions');
    const next = c ? String(c.next_action || '') : '';
    const stage = c ? String(c.stage || '') : '';
    const planId = c ? String(c.plan_id || '') : '';
    const runId = c ? String(c.run_id || '') : '';
    const isTerminal = next === 'none' && stage === 'history';
    const isFailed = String(t.state || '').toLowerCase() === 'failed';

    const buttons: Array<{ label: string; action: () => void; kind: string }> = [];

    // Approval workflow integration — fetch the plan content once and
    // surface Approve / Request changes inline (P1). The magic constant is
    // hand-rolled because we can't yet add a follow-on workflow call.
    if (next === 'review_investigation') {
        buttons.push({ label: 'Review plan →', kind: 'primary',
            action: () => openWorkView('plans') });
        if (planId) {
            buttons.push({ label: 'Approve plan', kind: 'success',
                action: () => postPlanApproval(planId) });
        }
    }

    // Cross-view sync — every Work task has three macros: Activity for
    // raw events, Results for the durable answer, and the conversation
    // (already mounted center). Stage them as buttons so the user never
    // has to guess which view holds what.
    buttons.push({ label: 'Follow activity for this task →', kind: 'secondary',
        action: () => openActivityForTask(String(t.id)) });
    buttons.push({ label: 'Open in Results →', kind: 'secondary',
        action: () => openResults(String(t.id)) });
    if (next === 'approve_plan' && planId) {
        buttons.push({ label: 'Approve plan', kind: 'primary',
            action: () => postPlanApproval(planId) });
    }
    if (next === 'open_review' && runId) {
        buttons.push({ label: 'Review outcome', kind: 'primary',
            action: () => openResults(String(t.id)) });
    }
    if (isTerminal) {
        // Spec §4 + §5: actionable investigation results — buttons
        // generated from task type and lifecycle state, never fabricated
        // "Apply Changes" without an authorized backend endpoint.
        buttons.push({ label: 'Open evidence →', kind: 'primary',
            action: () => openResults(String(t.id)) });
        buttons.push({ label: 'Request additional investigation', kind: 'primary',
            action: () => prefillInvestigateCta(String(t.id), c) });
        buttons.push({ label: 'Plan follow-up', kind: 'secondary',
            action: () => openWorkView('plans') });
        buttons.push({ label: 'Discuss findings', kind: 'secondary',
            action: () => prefillComposer('Discuss findings about this task — what should I dig into next?') });
    }
    if (isFailed) {
        buttons.push({ label: 'Inspect failure', kind: 'secondary',
            action: () => openResults(String(t.id)) });
        buttons.push({ label: 'Try a different angle', kind: 'secondary',
            action: () => prefillComposer('Try a different approach — describe what should be tried differently.') });
    }
    if (stage && stage !== 'idle' && stage !== 'history') {
        buttons.push({ label: 'Lifecycle →', kind: 'secondary',
            action: () => openWorkView(stage === 'review' ? 'builds' : stage === 'in_progress' ? 'discoveries' : stage as WorkView) });
    }

    // convo-redesign.md §5 — completed implementation. Three of the doc's four
    // actions already live in the Builds subview: the run card shows the
    // candidate/baseline test outcome and the candidate review owns the
    // revision decision (it needs the snapshot hash, per-criterion verdicts and
    // reviewer feedback, which this panel does not hold). So these DEEP-LINK
    // rather than duplicating a mutation — one owner per backend operation.
    // A submit-for-approval action is deliberately absent: no
    // implementation-approval route exists (the only approve endpoint is
    // plan-scoped).
    if (runId) {
        buttons.push({ label: 'View test results →', kind: 'primary',
            action: () => openBuildRun(runId) });
        if (next === 'open_review' || isTerminal) {
            buttons.push({ label: 'Request revision →', kind: 'secondary',
                action: () => openCandidateReview(runId) });
        }
    }

    if (!buttons.length) {
        panel.append(node('p', c ? `Stage: ${stage || '—'} · Next: ${next || '—'}` : 'No workflow actions yet.', 'task-actions__hint'));
        return panel;
    }

    for (const b of buttons) {
        const btn = node('button', b.label, `task-action task-action--${b.kind}`) as HTMLButtonElement;
        btn.type = 'button';
        btn.addEventListener('click', b.action);
        panel.append(btn);
    }
    return panel;
}



async function postPlanApproval(planId: string) {
    try {
        const res = await fetch(`/api/investigation-plans/${encodeURIComponent(planId)}/approve`, { method: 'POST' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await loadData();
    } catch (err) {
        console.warn('plan approve failed', err);
    }
}

/** Open Activity workspace filtered to this task's events. */
function openActivityFiltered(taskId: string) {
    openActivityForTask(taskId);
}

/** Pre-fill a pre-canned follow-up prompt in Hermes Chat instead of a
 *  local composer (HL-CONV-001): Chat is the single place the user
 *  writes. Opens Chat on this task's conversation with the draft. */
function prefillComposer(prompt: string) {
    const detail: { conversation_id?: string; task_id: string; prefill: string } = {
        task_id: String(selectedId || ''),
        prefill: prompt,
    };
    if (selectedConversationId) detail.conversation_id = selectedConversationId;
    window.dispatchEvent(new CustomEvent('hermes:open-in-chat', { detail }));
}

/** Actionable-investigation-results CTA: build a specific follow-up
 *  instruction derived from the plan's fingerprint and reason, then
 *  submit it as a linked task on the same conversation. */
function prefillInvestigateCta(taskId: string, c: Chain | null) {
    const fingerprint = c?.fingerprint ? String(c.fingerprint).slice(0, 160) : '';
    const reason = c?.reason ? String(c.reason).slice(0, 200) : '';
    const prompt = [
        'Continue this investigation. The previous findings suggest:',
        reason ? `  - ${reason}` : '',
        fingerprint ? `  - Fingerprint: ${fingerprint}` : '',
        'Please dig deeper into the area referenced above. Address what was unresolved.',
    ].filter(Boolean).join('\n');
    prefillComposer(prompt);
}

function updateSelection(t: TaskRec | null) {
    // HL-WORK-001 M1: the panel is owned by context-inspector; this view
    // only declares its (typed) selection. A task selection therefore
    // cannot leak into other workviews.
    setSelection('tasks', t ? { kind: 'task', id: str(t.id) } : null);
}

// Tasks-view inspector card (registered once; reads live module state so
// refreshes keep the card current without re-registering).
registerKindRenderer('task', (sel, body) => {
    const t = tasks.find(x => str(x.id) === sel.id);
    if (!t) {
        body.append(node('p', 'This task is not loaded right now.', 'hint'));
        return;
    }
    const c = chainByTask[sel.id];
    body.append(node('strong', str(t.prompt) || 'Task'));
    // Spec §10: the inspector card answers the SAME questions with the SAME
    // records the task's center context card (buildFactsCard) renders — one
    // selection, one set of answers, no contradiction between surfaces.
    body.append(fqLine(FQ.status, `${str(t.state)} · ${c ? str(c.status) : 'manual task'}`));
    body.append(fqLine(FQ.why, c?.project
        ? `project ${str(c.project)}${c.reason ? ` — ${str(c.reason)}` : ''}`
        : 'user-directed — started from chat or a manual goal, no linked project'));
    body.append(node('p', `Created ${new Date(str(t.created_at)).toLocaleString()}`));
    if (c) {
        body.append(fqLine(FQ.evidence, `chain stage ${str(c.stage) || '—'}` +
            (c.run_id ? ` · implementation run ${str(c.run_id).slice(0, 8)}` : '') +
            (c.path ? ` · ${str(c.path)}` : '')));
        const next = str(c.next_action);
        if (next === 'approve_plan' || next === 'review_investigation')
            body.append(fqLine(FQ.decision, 'your approval is the next permissible step — the approval card is on the task panel'));
    } else {
        body.append(fqLine(FQ.evidence, 'no workflow chain linked yet'));
    }
    const open = node('button', 'Open in Results →', '') as HTMLButtonElement;
    open.type = 'button';
    open.addEventListener('click', () => openResults(sel.id));
    body.append(open);
});

registerSummaryProvider('tasks', () => ({
    line: 'Select a task in the list to see it here.',
    chips: tasks.length ? [{ label: 'tasks', count: tasks.length }] : undefined,
}));

/* =====================================================================
 * Contextual right-column panel (P1: actionable investigation results
 * + approval workflow integration + task-centered context cards).
 *
 * Cards stacked top-to-bottom, additive. The first card is always the
 * chain facts; subsequent cards add (in this order): plan, criteria,
 * recent activity, actionable buttons that don't fit in the center column.
 * ===================================================================== */

function renderContext(id: string | null) {
    const host = $('task-context');
    if (!host) return;
    host.replaceChildren();
    if (!id) {
        host.append(node('p', 'Select a task to see its workflow context.', 'hint'));
        return;
    }
    const t = tasks.find(x => x.id === id);
    if (!t) {
        host.append(node('p', 'Task not loaded yet — refreshing…', 'hint'));
        return;
    }
    const c = chainByTask[str(t.id)] ?? null;

    host.append(buildFactsCard(t, c));

    // Inline approval card on approve_plan / review_investigation (and a
    // graceful degradation when no plan_id is available).
    if (c && (c.next_action === 'approve_plan' || c.next_action === 'review_investigation')) {
        const planId = String(c.plan_id || '');
        if (planId) host.append(buildApprovalCard(planId, t, c));
    }

    // If a live, recently finished implementation has run_id + criteria,
    // surface the criteria card under "Accept / Reject" context.
    if (c && (c.run_id || c.verification)) {
        host.append(buildRunCard(t, c));
    }

    // Recent activity for this specific task — last 5 events.
    void loadRecentActivity(String(t.id || ''), host);
}

function buildFactsCard(t: TaskRec, c: Chain | null): HTMLElement {
    const card = node('section', '', 'ctx-card ctx-card--facts');
    const title = node('h4', 'Task context', 'ctx-card__title');
    card.append(title);

    const pairs: Array<[string, string]> = [
        ['State', str(t.state).toUpperCase()],
        ['Created', new Date(str(t.created_at)).toLocaleString()],
    ];
    if (t.conversation_id) pairs.push(['Conversation', String(t.conversation_id).slice(0, 8)]);
    if (c?.stage) pairs.push(['Stage', String(c.stage)]);
    if (c?.status) pairs.push(['Status', String(c.status)]);
    if (c?.next_action) pairs.push(['Next', String(c.next_action)]);
    if (c?.project) pairs.push(['Project', String(c.project)]);
    if (c?.path) pairs.push(['Path', String(c.path)]);
    for (const [k, v] of pairs) card.append(kvRow(k, v));

    if (c?.reason) {
        const reason = document.createElement('div');
        reason.className = 'kv';
        const label = document.createElement('span');
        label.textContent = 'Reason';
        const val = document.createElement('div');
        val.className = 'ctx-card__hint';
        val.textContent = String(c.reason);
        reason.append(label, val);
        card.append(reason);
    }
    return card;
}

function kvRow(k: string, v: string): HTMLElement {
    const row = node('div', '', 'kv');
    row.append(document.createTextNode(`${k}`));
    const strong = document.createElement('strong'); strong.textContent = ` ${v}`; row.append(strong);
    return row;
}

async function loadRecentActivity(taskId: string, host: HTMLElement) {
    try {
        const url = `/api/events?tail=500&correlation_id=${encodeURIComponent(taskId)}`;
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // Server doesn't filter by task_id — fall back to client filter.
        const all = await res.json() as Array<{ task_id?: string; type?: string; timestamp?: string; sequence?: number }>;
        const own = all.filter(e => String(e.task_id || '') === taskId).slice(0, 5);
        if (!own.length) return;
        const card = node('section', '', 'ctx-card');
        card.append(node('h4', 'Recent activity', 'ctx-card__title'));
        const list = node('ol', '', 'ctx-card__recent');
        list.style.listStyle = 'none';
        list.style.margin = '0';
        list.style.padding = '0';
        list.style.display = 'flex';
        list.style.flexDirection = 'column';
        list.style.gap = '3px';
        for (const e of own) {
            const li = node('li', '', '');
            const ts = e.timestamp ? new Date(e.timestamp).toLocaleString() : '';
            li.style.fontSize = '11px';
            li.style.color = '#a8e7d5';
            li.textContent = `${ts}  ${String(e.type || '')}  #${String(e.sequence || '')}`;
            list.append(li);
        }
        card.append(list);
        host.append(card);
    } catch (err) {
        // Empty card placeholder — the activity feed is optional context.
        console.warn('Could not load recent activity', err);
    }
}

function buildApprovalCard(planId: string, t: TaskRec, c: Chain | null): HTMLElement {
    const card = node('section', '', 'approval-card');
    card.append(node('h4', 'Investigation ready for review', 'approval-card__title'));
    const subtitle = node('p', `Plan ${planId.slice(0, 8)} · ${String(t.prompt).slice(0, 80)}`, 'approval-card__subtitle');
    card.append(subtitle);
    const body = node('p', 'Fetching plan…', 'approval-card__body');
    card.append(body);
    const cList = node('ol', '', 'approval-card__criteria');
    const row = node('div', '', 'approval-card__row');
    const approveBtn = node('button', 'Approve plan', 'approval-card__btn approval-card__btn--approve') as HTMLButtonElement;
    const changesBtn = node('button', 'Request changes', 'approval-card__btn approval-card__btn--changes') as HTMLButtonElement;
    const feedback = node('p', '', 'approval-card__body');
    approveBtn.disabled = true; changesBtn.disabled = true;
    row.append(approveBtn, changesBtn);
    card.append(cList, row, feedback);
    void loadPlanApprovalCard(planId, body, cList, approveBtn, changesBtn, feedback);
    return card;
}

async function loadPlanApprovalCard(
    planId: string,
    body: HTMLElement, list: HTMLElement,
    approveBtn: HTMLButtonElement, changesBtn: HTMLButtonElement,
    feedback: HTMLElement,
) {
    try {
        const res = await fetch(`/api/investigation-plans/${encodeURIComponent(planId)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const plan = await res.json();
        const report = typeof plan.report === 'string' ? plan.report : '';
        body.textContent = report.length > 1200 ? `${report.slice(0, 1200)}…` : report || '(no report body)';
        approveBtn.disabled = false; changesBtn.disabled = false;
        // Best-effort criteria fetch — non-fatal if absent.
        try {
            const cRes = await fetch(`/api/investigation-plans/${encodeURIComponent(planId)}/criteria`);
            if (cRes.ok) {
                const cBody = await cRes.json() as { criteria?: Array<{ criterion_text?: string }> };
                list.replaceChildren();
                for (const c of cBody.criteria ?? []) {
                    const li = node('li', '', '');
                    li.textContent = c.criterion_text || '(empty criterion)';
                    list.append(li);
                }
            }
        } catch { /* criteria optional */ }
        approveBtn.addEventListener('click', () => postApprove(planId, approveBtn, changesBtn, feedback));
        changesBtn.addEventListener('click', () => prefillComposerForPlanChanges(planId, feedback));
    } catch (err) {
        body.textContent = `Plan unavailable: ${String((err as Error)?.message || err)}`;
        feedback.textContent = '';
    }
}

async function postApprove(planId: string, okBtn: HTMLButtonElement, fixBtn: HTMLButtonElement, feedback: HTMLElement) {
    okBtn.disabled = true; fixBtn.disabled = true;
    feedback.textContent = 'Approving…';
    try {
        const res = await fetch(`/api/investigation-plans/${encodeURIComponent(planId)}/approve`, { method: 'POST' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        feedback.textContent = `Plan ${planId.slice(0, 8)} approved — the run will start when Hermes is free.`;
        feedback.dataset.kind = 'ok';
        await loadData();
        void renderContext(selectedId);
    } catch (err) {
        feedback.textContent = String((err as Error)?.message || err);
        okBtn.disabled = false; fixBtn.disabled = false;
    }
}

function prefillComposerForPlanChanges(planId: string, feedback: HTMLElement) {
    feedback.textContent = `Chat opened with caveats for ${planId.slice(0, 8)} — review and press Send.`;
    feedback.dataset.kind = '';
    prefillComposer(`Please revise plan ${planId} before approval. Concerns: `);
}

function buildRunCard(t: TaskRec, c: Chain | null): HTMLElement {
    const card = node('section', '', 'ctx-card');
    card.append(node('h4', 'Implementation link', 'ctx-card__title'));
    const pairs: Array<[string, string]> = [];
    if (c?.plan_id) pairs.push(['Plan', String(c.plan_id).slice(0, 8)]);
    if (c?.run_id) pairs.push(['Run', String(c.run_id).slice(0, 8)]);
    if (c?.verification?.disposition) pairs.push(['Verification', String(c.verification.disposition)]);
    if (c?.fingerprint) pairs.push(['Fingerprint', String(c.fingerprint).slice(0, 80)]);
    for (const [k, v] of pairs) card.append(kvRow(k, v));
    if (c?.reason) {
        const pre = node('pre', '', '');
        pre.textContent = String(c.reason);
        card.append(pre);
    }
    return card;
}

window.addEventListener('hermes:event', ((ev: Event) => {
    const detail = (ev as CustomEvent<{ type?: string; task_id?: string | null }>).detail;
    if (!detail || !selectedId) return;
    const type = detail.type || '';
    if (type.startsWith('task.') || type === 'hermes.result') {
        const delta = type === 'task.queued' || type === 'task.started' || type === 'task.completed' || type === 'task.failed';
        if (delta) { void loadData(); }
    }
}) as EventListener);

/** Save current scroll position for the active workview. */
function saveScrollPosition(view: string) {
    const outlet = $('workview-outlet');
    if (outlet) scrollPositions[view] = outlet.scrollTop;
}

/** Restore scroll position for a workview. */
function restoreScrollPosition(view: string) {
    const outlet = $('workview-outlet');
    if (outlet && scrollPositions[view] !== undefined) {
        outlet.scrollTop = scrollPositions[view];
    }
}

/** Update heading/breadcrumb for the active workview. */
function updateWorkHeading(view: string) {
    const heading = $('work-heading');
    const subheading = $('work-subheading');
    if (!heading || !subheading) return;

    const labels: Record<string, [string, string]> = {
        overview: ['Overview', 'Projects portfolio — autonomous and user projects, milestones, proposals, outcomes'],
        discoveries: ['Discoveries', 'Independent discovery & decisions — scan worker projects, review findings'],
        goals: ['Goals', 'Autonomous goals & scheduler — create goals, manage autonomy'],
        plans: ['Plans', 'Goal formulation & investigation plans — review, approve, convert to plans'],
        tasks: ['Work', 'Task board — pick a task to open its thread, composer, and context'],
        builds: ['Builds', 'Evaluated implementation & review — candidate runs, verification, decisions'],
        reviews: ['Reviews', 'Candidate review queue — runs awaiting a review decision'],
        results: ['Results', 'Response & evidence for the selected task'],
    };
    const [title, desc] = labels[view] || labels.tasks;
    heading.textContent = title;
    subheading.textContent = desc;
}

/** Switch the active Work subview.
 *  - Shows only the target panel, hides others
 *  - Updates subnav button active/aria-pressed state
 *  - Updates heading/breadcrumb
 *  - Saves current panel's scroll position, restores target's
 *  - Does NOT use scrollIntoView for navigation
 *  - Preserves task thread/composer when leaving Tasks (DOM persists) */
function setWorkView(view: string) {
    const validViews = ['overview', 'discoveries', 'goals', 'plans', 'tasks', 'builds', 'reviews', 'results'];
    if (!validViews.includes(view)) view = 'tasks';

    // Save scroll position of current view before switching
    saveScrollPosition(currentWorkView);

    // Hide all workview panels
    document.querySelectorAll<HTMLElement>('#workview-outlet > .workview-panel').forEach(panel => {
        panel.hidden = true;
    });

    // Show target panel
    const targetPanel = $(`workview-${view}`);
    if (targetPanel) targetPanel.hidden = false;

    // Update subnav buttons
    const nav = $('work-subnav');
    if (nav) {
        nav.querySelectorAll<HTMLButtonElement>('button[data-workview]').forEach(btn => {
            const isActive = btn.dataset.workview === view;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-pressed', String(isActive));
        });
    }

    // Update heading/breadcrumb
    updateWorkHeading(view);

    // Restore scroll position for target view
    restoreScrollPosition(view);

    currentWorkView = view;
}

function wireSubnav() {
    const nav = $('work-subnav'); if (!nav) return;
    nav.querySelectorAll<HTMLButtonElement>('button[data-workview]').forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.workview || 'tasks';
            openWorkView(view as WorkView);
        });
    });
}

// Deep-link validation: the Work workspace owns the loaded task list.
// Returning null (list not yet loaded) lets the deep link through
// optimistically; a nonexistent id is caught after loadData lands.
registerTaskValidator(() => (tasks.length ? tasks.map(t => str(t.id)) : null));

// React to canonical workspace/workview/task changes from navigation-state.
// Covers deep links, Back/Forward restores, and cross-module openTask calls.
onNavigationChange((nav) => {
    if (nav.workspace !== 'work') return;
    setWorkView(nav.workView);
    if (nav.selectedTaskId && nav.selectedTaskId !== selectedId) {
        // Deep link / Back-Forward restore: select the task. A missing id
        // gets the controlled empty state instead of silence.
        if (tasks.length && !tasks.some(t => str(t.id) === nav.selectedTaskId)) {
            showTaskNotFound(nav.selectedTaskId);
            return;
        }
        selectTask(nav.selectedTaskId);
    } else if (!nav.selectedTaskId && selectedId) {
        backToList();
    }
});

// Initialize workView from navigation-state (in case it was set before this module loaded)
setWorkView(getCurrentWorkView());

// P2 cross-view sync: a 3D resident click dispatches `hermes:task:focus`
// with the resident's task_id. We open the task in Work (thread/composer)
// via the canonical navigation intent. One event gets every workspace
// onto the same authoritative execution context.
window.addEventListener('hermes:task:focus', ((ev: Event) => {
    const id = (ev as CustomEvent<{ id?: string }>).detail?.id;
    if (!id) return;
    // Canonical intent: open task in Work workspace (Tasks subview)
    openTask(id, { destination: 'work' });
    // The list may not have rendered yet (loadData is async); retry up
    // to a few hundred ms before giving up.
    let attempts = 0;
    const trySelect = () => {
        const entry = document.querySelector<HTMLElement>(`#task-list .task-entry[data-task-id="${CSS.escape(String(id))}"]`);
        if (entry) {
            entry.click();
            entry.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            return;
        }
        if (++attempts < 6) window.setTimeout(trySelect, 80);
    };
    trySelect();
}) as EventListener);

// hermes:workview is now handled by navigation-state's onNavigationChange
// listener above. Kept as no-op for any legacy dispatchers.
window.addEventListener('hermes:workview', ((ev: Event) => {
    // Handled by onNavigationChange → setWorkView
}) as EventListener);

let started = false;
function initialize() {
    if (started) return; started = true;
    wireSubnav();
    // Initialize scroll position tracking for Tasks view
    scrollPositions.tasks = 0;
    void loadData();
    window.setInterval(() => { if (selectedId) void loadData(); }, 15000);
}
initialize();