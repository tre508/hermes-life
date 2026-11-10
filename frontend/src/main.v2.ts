/**
 * Hermes Life — Unified Workspace controller.
 *
 * Replacements for the old single-page, seven-tab, world-first layout (main.ts + phase44's
 * installWorldFirstLayout). This entry owns:
 *   - the four workspace layouts (Home / Work / Activity / Results + System) + three regions
 *   - one global connection / execution / freshness status system (unified, not per-panel)
 *   - the event stream, the task queue, and the answer+evidence viewer (ported from main.ts)
 *   - the town renderer and every conserved management module (goals, discover, planning,
 *     build/review, memory/profile, projects) mounted under their new workspace homes.
 *
 * The backend / events contract is unchanged; nothing here invents state.
 */

// Order matters: hermes-chat must run before phase412 (which extends its panel).
import './hermes-chat';
import './phase412-project-ui';
import './phase41301-rework';
import './phase41302-workflow';
import './phase41303-memory';
import './phase415-review';
import './work-workspace';
import './command-centre-ui';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

// ============================= version =============================
const versionPill = document.querySelector<HTMLElement>('header .pill');
if (versionPill) versionPill.textContent = 'HERMESHA / 0.4.0';

// ============================= workspace & layout =============================
const app = $('app')!;
const workspaces = ['home', 'work', 'activity', 'results', 'system'];
let currentWorkspace = 'home';

// Distinct, non-contradictory sources of truth:
//   • "Connection"  → the WebSocket and the backend /health surface.
//   • "Backend"     → activity the backend is doing right now: a task is
//                      queued, running, just completed, etc. Hermes may be
//                      processing tool calls with no visible role activity,
//                      so this can be Running while the world summary still
//                      reads "no role working" — both are correct.
//   • "World role"  → town-view's authoritative role projection, painted
//                      into the existing Command Center strip (already
//                      distinct visually).
function setLayout(layout: 'world' | 'workspace' | 'focus') {
    app.classList.remove('layout-home', 'layout-workspace', 'layout-focus');
    app.classList.add(layout === 'world' ? 'layout-home' : `layout-${layout}`);
}
function setWorkspace(id: string) {
    currentWorkspace = id;
    workspaces.forEach(w => {
        const view = $(`workspace-${w}`);
        if (view) view.hidden = w !== id;
    });
    document.querySelectorAll<HTMLButtonElement>('#primary-nav button').forEach(btn => {
        const on = btn.dataset.workspace === id && !btn.hasAttribute('data-hc-room') && !btn.hasAttribute('data-hc-chat') && (!btn.hasAttribute('data-hc-workview') || btn.dataset.hcWorkview === 'tasks');
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', String(on));
    });
    // Auto layout: Home shows the world large, Work keeps a working panel,
    // everything else gives content nearly full width.
    setLayout(id === 'home' ? 'world' : id === 'work' ? 'workspace' : 'focus');
    // Home contextual panel is primary on Home, selection elsewhere.
    const ctxHome = $('ctx-home'), ctxSel = $('ctx-selection');
    if (ctxHome) ctxHome.hidden = id !== 'home';
    if (ctxSel) ctxSel.hidden = id === 'home';
    // P2 cross-view sync: leaving Activity clears any task-filter so the
    // user does not come back later wondering why the timeline is empty.
    if (id !== 'activity') setActivityTaskFilter(null);
}
// P2 sync: Work's "Follow activity for this task" button dispatches
// `hermes:workspace:activity` with the chosen task id; Activity listens
// here so the timeline filter engages and the user lands inside the
// focused stream instead of the global activity dump.
window.addEventListener('hermes:workspace:activity', ((ev: Event) => {
    const detail = (ev as CustomEvent<{ task_id?: string }>).detail;
    if (!detail || !detail.task_id) return;
    setWorkspace('activity');
    setActivityTaskFilter(String(detail.task_id));
    while (($('activity-timeline')?.childElementCount || 0) > 0) {
        $('activity-timeline')?.lastElementChild?.remove();
    }
    // Repaint with the filter in place: refetch a window of events
    // scoped to this task so the user sees context, not just live deltas.
    void refetchActivityForTask(String(detail.task_id));
}) as EventListener);
async function refetchActivityForTask(taskId: string) {
    try {
        const res = await fetch(`/api/events?tail=500&correlation_id=${encodeURIComponent(taskId)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const events = await res.json() as Array<Record<string, unknown>>;
        // Replay in chronological order; the filter regex in
        // appendActivity() will reject events from other tasks even
        // if the correlation_id filter leaks.
        const host = $('activity-timeline');
        if (!host) return;
        for (const e of events) {
            lastSequence = Math.max(lastSequence, Number((e as { sequence?: number }).sequence || 0));
        }
        // Render oldest-first so newest ends at top (matches live order).
        for (const e of [...events].reverse()) {
            const record = e as EventRecord;
            appendActivity(record);
        }
    } catch (err) {
        console.warn('activity refetch failed', err);
    }
}
document.querySelectorAll<HTMLButtonElement>('#primary-nav button').forEach(btn => {
    btn.addEventListener('click', () => setWorkspace(btn.dataset.workspace || 'home'));
});
// Any activation of a Work sub-view (phase deep links included) brings the user to Work.
document.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('#work-subnav button[data-workview]');
    if (target) setWorkspace('work');
}, true);
window.addEventListener('hermes:workview', ((ev: Event) => {
    const view = (ev as CustomEvent<{ view?: string }>).detail?.view;
    if (view) setWorkspace('work');
}) as EventListener);

// Phase 4 left-rail Chat uses the same existing chat control, not another chat instance.
document.querySelector('#primary-nav button[data-hc-chat="open"]')?.addEventListener('click', () => {
    queueMicrotask(() => document.getElementById('header-chat-open')?.click());
});

// Open the floating Hermes conversation from anywhere.
const headerChat = $('header-chat-open');
headerChat?.addEventListener('click', () => {
    const toggle = $<HTMLButtonElement>('hc-toggle');
    if (toggle) toggle.click();
});

// ============================= global status =============================
enum ConState { Connecting = 'connecting', Live = 'live', Reconnecting = 'reconnecting', Offline = 'offline' }
let conState: ConState = ConState.Connecting;
let execState = 'idle';
let lastFreshness = '';

function paintStatus() {
    const con = $('connection-status'), exec = $('execution-status'), fresh = $('data-freshness-status');
    if (!con || !exec) return;
    // "Backend" framing: the indicator reports what the controller is doing
    // (running a task, idle, queued), distinct from Connection (the transport)
    // and from the world's role projection. The same data attribute drives
    // the existing colour tokens so any visual touch-up extends cleanly.
    const conLabel = conState === ConState.Live ? 'Live'
        : conState === ConState.Reconnecting ? 'Reconnecting'
        : conState === ConState.Offline ? 'Offline' : 'Connecting';
    con.textContent = `Connection: ${conLabel}`;
    con.dataset.state = conState;
    exec.textContent = `Backend: ${execState}`;
    exec.dataset.state = execState;
    if (fresh) fresh.textContent = lastFreshness ? `Updated ${lastFreshness}` : '';
}

// ============================= event stream =============================
type EventRecord = { sequence: number; id: string; task_id: string | null; type: string; timestamp: string; payload: Record<string, unknown> };
let lastSequence = 0;
let latestEventTaskId: string | null = null;
let socket: WebSocket | null = null;
let retryDelay = 1000;
const toolEntries = new Map<string, EventRecord[]>();
let followLive = true;
const time = (ts: string) => new Date(ts).toLocaleTimeString();

function updateExecutionFromEvent(evt: EventRecord) {
    const t = evt.type;
    if (t === 'task.queued') { execState = 'queued'; lastFreshness = time(evt.timestamp); homeCurrentWork(evt); }
    else if (t === 'task.started') { execState = 'running'; }
    else if (t === 'task.completed') { execState = 'completed'; homeCurrentWork(evt); }
    else if (t === 'task.failed') { execState = 'failed'; homeCurrentWork(evt); }
    else if (t.startsWith('hermes.tool') || t === 'hermes.text') { execState = 'running'; }
    paintStatus();
}

// Home "current work" readout (kept for the sidebar) and the new Home
// recent-event / current-operation strip in the main column. Both views
// describe the same authoritative backend state — the strip simply gives
// it visible vertical space so the world no longer floats over dead
// dashboard pixels (P0 audit §4).
function homeCurrentWork(evt: EventRecord) {
    if (!evt.task_id) return;
    const taskId = evt.task_id;
    if (evt.type === 'task.started' || evt.type === 'task.queued') {
        const el = $('current-task'); if (el) el.textContent = `${taskId.slice(0, 8)} …`;
        const recent = $('home-current-recent'); if (recent) recent.textContent = `${taskId.slice(0, 8)} — running`;
        const active = $('home-current-active'); if (active) active.textContent = `Task ${taskId.slice(0, 8)}`;
    }
    if (evt.type === 'task.completed') {
        const last = $('last-outcome'); if (last) last.textContent = 'Completed';
        const recent = $('recent-task'); if (recent) recent.textContent = taskId.slice(0, 8);
        const outcome = $('home-current-outcome'); if (outcome) outcome.textContent = 'Completed';
        const recentRecent = $('home-current-recent'); if (recentRecent) recentRecent.textContent = taskId.slice(0, 8);
        const active = $('home-current-active'); if (active) active.textContent = 'No active task';
        const attn = $('requires-attention'); if (attn && attn.textContent === `Task ${taskId.slice(0, 8)}`) attn.textContent = 'None';
        const attnMain = $('home-current-attention'); if (attnMain && attnMain.textContent === `Task ${taskId.slice(0, 8)}`) attnMain.textContent = 'None';
        window.setTimeout(() => {
            const cur = $('current-task'); if (cur) cur.textContent = 'None';
            const active2 = $('home-current-active'); if (active2) active2.textContent = 'No active task';
        }, 8000);
    }
    if (evt.type === 'task.failed') {
        const attn = $('requires-attention'); if (attn) attn.textContent = `Task ${taskId.slice(0, 8)} failed`;
        const last = $('last-outcome'); if (last) last.textContent = 'Failed';
        const attnMain = $('home-current-attention'); if (attnMain) attnMain.textContent = `Task ${taskId.slice(0, 8)} failed`;
        const outcome = $('home-current-outcome'); if (outcome) outcome.textContent = 'Failed';
        const recent = $('home-current-recent'); if (recent) recent.textContent = taskId.slice(0, 8);
        window.setTimeout(() => {
            const cur = $('current-task'); if (cur) cur.textContent = 'None';
            const active = $('home-current-active'); if (active) active.textContent = 'No active task';
        }, 8000);
    }
}

const RECENT_LIMIT = 6;
const recentEvents: EventRecord[] = [];
function renderRecentEvents() {
    const host = $('home-recent-events'); if (!host) return;
    host.replaceChildren();
    if (recentEvents.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'hrs-empty';
        empty.textContent = 'No backend events yet. Hermes is monitoring the lab.';
        host.append(empty);
        return;
    }
    for (const evt of recentEvents.slice(0, RECENT_LIMIT)) {
        const row = document.createElement('div');
        row.className = 'hrs-event';
        const t = document.createElement('span');
        t.className = 'hrs-time';
        t.textContent = time(evt.timestamp);
        const tp = document.createElement('span');
        tp.className = 'hrs-type';
        tp.textContent = evt.type;
        const tail = document.createElement('span');
        tail.textContent = evt.task_id ? `· ${evt.task_id.slice(0, 8)}` : '· system';
        row.append(t, tp, tail);
        host.append(row);
    }
}

function appendActivity(evt: EventRecord) {
    const host = $('activity-timeline'); if (!host) return;
    if (activityTaskFilter && evt.task_id !== activityTaskFilter && !evt.type.startsWith('task.')) return;
    const entry = document.createElement('div'); entry.className = 'activity-entry';
    entry.dataset.taskId = String(evt.task_id || '');
    const top = document.createElement('div'); top.className = 'ae-top';
    const title = document.createElement('span'); title.className = 'ae-title';
    title.textContent = `#${evt.sequence}  ${evt.type}`;
    const meta = document.createElement('span'); meta.className = 'ae-meta';
    meta.textContent = `${time(evt.timestamp)} · ${evt.task_id || 'system'}`;
    const expand = document.createElement('button'); expand.type = 'button'; expand.className = 'ae-expand'; expand.textContent = 'payload ▾';
    expand.addEventListener('click', () => entry.classList.toggle('open'));
    top.append(title, meta, expand);
    const payload = document.createElement('pre'); payload.className = 'ae-payload'; payload.textContent = JSON.stringify(evt.payload ?? {}, null, 2);
    entry.append(top, payload);
    host.prepend(entry);
    while (host.childElementCount > 200) host.lastElementChild?.remove();
}

/** Filter for the Activity workspace. When set, only events for this task
 *  are rendered (task lifecycle events bypass the filter so the user
 *  still sees when the task starts/ends). Cleared on workspace close. */
let activityTaskFilter: string | null = null;
function setActivityTaskFilter(taskId: string | null) {
    activityTaskFilter = taskId;
    if (!taskId) {
        $('activity-filter-label')?.remove();
        return;
    }
    const host = $('activity-timeline');
    if (!host) return;
    let label = $('activity-filter-label');
    if (!label) {
        label = document.createElement('div');
        label.id = 'activity-filter-label';
        label.className = 'activity-filter-label';
        host.parentElement?.insertBefore(label, host);
    }
    label.textContent = `Filtered to task ${taskId.slice(0, 8)}`;
}

/** Append a live websocket event. */
function appendEvent(evt: EventRecord) {
    if (evt.sequence <= lastSequence) return;
    lastSequence = evt.sequence;
    if (evt.task_id) latestEventTaskId = evt.task_id;
    lastFreshness = time(evt.timestamp);
    window.dispatchEvent(new CustomEvent('hermes:event', { detail: evt }));
    if (shouldRenderForBubble(evt)) {
        updateExecutionFromEvent(evt);
        appendActivity(evt);
        recentEvents.unshift(evt);
        if (recentEvents.length > RECENT_LIMIT) recentEvents.length = RECENT_LIMIT;
        renderRecentEvents();
        scheduleTaskRefresh(evt);
    }
}

/** Append a historical event from a /api/events replay (page load).
 *  Historical events flow through the same hermes:event dispatch as live
 *  events so the bubble controller sees them and surfaces context above
 *  the right 3D resident. We keep the most-recent N events in the recent
 *  strip so the dashboard's Recent events box doesn't grow unbounded. */
function appendHistorical(evt: EventRecord) {
    if (evt.sequence <= lastSequence) return;
    lastSequence = evt.sequence;
    if (evt.task_id && evt.type.startsWith('task.')) latestEventTaskId = evt.task_id;
    if (evt.task_id && (evt.type === 'hermes.tool_use' || evt.type === 'hermes.tool_result')) {
        const list = toolEntries.get(evt.task_id) || []; list.push(evt); toolEntries.set(evt.task_id, list);
    }
    // Same dispatch path as live events so the bubble overlay renders
    // historical events in the correct resident lane on page load.
    window.dispatchEvent(new CustomEvent('hermes:event', { detail: evt }));
    if (shouldRenderForBubble(evt)) {
        appendActivity(evt);
        updateExecutionFromEvent(evt);
        // For the dashboard's recent-event strip, keep the most recent N
        // (the live events are already in order; historical events arrive
        // chronologically, so unshift keeps newest at top).
        recentEvents.unshift(evt);
        if (recentEvents.length > RECENT_LIMIT) recentEvents.length = RECENT_LIMIT;
    }
}

/** Cheap filter: events that the bubble controller already understands or
 *  that produce visible dashboard rows. Implementation-specific noise
 *  (autonomy/maintenance/decision) is kept silent so the controller and
 *  the recent strip don't bloat with no-op categories. */
function shouldRenderForBubble(evt: EventRecord): boolean {
    const t = evt.type;
    if (t.startsWith('hermes.')) return true;
    if (t.startsWith('task.')) return true;
    if (t.startsWith('implementation.')) return true;
    if (t.startsWith('verification.')) return true;
    if (t.startsWith('memory.')) return true;
    if (t.startsWith('reflection.')) return true;
    if (t.startsWith('personality.')) return true;
    if (t.startsWith('goal.') || t.startsWith('discovery.') || t.startsWith('curiosity.')) return true;
    if (t.startsWith('formulation.') || t.startsWith('investigation.')) return true;
    return false;
}

function connect() {
    socket?.close();
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${location.host}/ws/events?after=${lastSequence}`); socket = ws;
    ws.onopen = () => { conState = ConState.Live; retryDelay = 1000; paintStatus(); window.dispatchEvent(new CustomEvent('hermes:connection', { detail: { status: 'live' } })); };
    ws.onmessage = e => { try { appendEvent(JSON.parse(e.data) as EventRecord); } catch (err) { console.error('Malformed event', err); } };
    ws.onclose = () => { if (socket !== ws) return; conState = ConState.Reconnecting; paintStatus(); setTimeout(connect, retryDelay); retryDelay = Math.min(retryDelay * 2, 15000); };
    ws.onerror = () => ws.close();
}

async function hydrate() {
    try {
        const health = await fetch('/health');
        if (!health.ok) throw new Error('API offline');
        const history = await fetch('/api/events?tail=500').then(r => r.json() as Promise<EventRecord[]>);
        for (const evt of history) appendHistorical(evt);
        renderRecentEvents();
        await refreshHistory();
        await syncLatestTask();
        connect();
    } catch (e) {
        conState = ConState.Offline; execState = 'unknown'; paintStatus();
        setTimeout(hydrate, 3000);
    }
}

// ============================= task submission =============================
// The Home "New task" form is the same composer scaffold used in the
// Work workspace — one code path, one draft ledger, one set of rules
// (spec §6 "persistent conversation composer"). Bound to whatever
// conversation localStorage remembers; on first submission a new thread
// is created and saved, so subsequent Home submissions become follow-ups
// automatically without the user lifting a finger.
import { mountComposer, type ComposerOptions } from './conv-composer.ts';

const taskForm = $<HTMLFormElement>('task-form');
const taskTextarea = $<HTMLTextAreaElement>('prompt');
const taskSubmit = $<HTMLButtonElement>('task-form-send')
    ?? (taskForm?.querySelector<HTMLButtonElement>('button[type="submit"]') || null);
homeComposerSetup: {
    if (taskForm && taskTextarea && taskSubmit) {
        taskForm.addEventListener('submit', e => e.preventDefault());
        mountComposer({
            textarea: taskTextarea,
            submitButton: taskSubmit,
            getConversationId: () => localStorage.getItem('hermes-life-conversation-id'),
            submit: async (prompt) => {
                const convExisting = localStorage.getItem('hermes-life-conversation-id');
                const payload: { prompt: string; conversation_id?: string } = { prompt };
                if (convExisting) payload.conversation_id = convExisting;
                const res = await fetch('/api/tasks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                if (!res.ok) {
                    let detail = res.statusText;
                    try { detail = String((await res.json()).detail) || detail; } catch { /* keep statusText */ }
                    throw new Error(detail);
                }
                const body = await res.json();
                if (body.conversation_id) localStorage.setItem('hermes-life-conversation-id', String(body.conversation_id));
                setFollowLive(true); void loadTask(String(body.id)); void refreshHistory();
                return { task_id: String(body.id || ''), conversation_id: body.conversation_id ? String(body.conversation_id) : (convExisting || null) };
            },
        });
        break homeComposerSetup;
    }
    // Fallback: preserve the synchronous behaviour if any DOM lookup
    // didn't return what we expected. Never silently fail.
    if (!taskForm) break homeComposerSetup;
    taskForm.addEventListener('submit', async e => {
        e.preventDefault();
        const input = $<HTMLTextAreaElement>('prompt'); if (!input) return;
        const prompt = input.value.trim(); if (!prompt) return;
        const feedback = $('task-feedback'); if (feedback) feedback.textContent = 'Submitting…';
        try {
            const res = await fetch('/api/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, conversation_id: localStorage.getItem('hermes-life-conversation-id') }),
            });
            const body = await res.json();
            if (!res.ok) throw new Error(str(body.detail) || res.statusText);
            if (body.conversation_id) localStorage.setItem('hermes-life-conversation-id', str(body.conversation_id));
            if (feedback) feedback.textContent = `Task accepted: ${str(body.id)}`;
            input.value = '';
            setFollowLive(true); void loadTask(str(body.id)); void refreshHistory();
        } catch (error) { if (feedback) feedback.textContent = String(error); }
    });
}

// ============================= answer / evidence viewer =============================
let currentAnswer = '';
let viewedTaskId: string | null = null;
let requestGeneration = 0;
let pendingRefresh: ReturnType<typeof setTimeout> | undefined;

function setFollowLive(enabled: boolean) {
    followLive = enabled;
    const btn = $('response-follow'); if (btn) { btn.textContent = enabled ? 'Following live' : 'Follow live'; btn.setAttribute('aria-pressed', String(enabled)); }
    const src = $('response-source'); if (src) src.textContent = enabled ? 'Latest agent activity' : 'History selection';
}
$('response-follow')?.addEventListener('click', () => { setFollowLive(true); void syncLatestTask(); });
$('response-raw-toggle')?.addEventListener('change', () => {
    const raw = $<HTMLInputElement>('response-raw-toggle');
    const text = $('response-text'), rich = $('response-rich');
    if (raw && text && rich) { text.hidden = !raw.checked; rich.hidden = raw.checked; }
});
$('response-copy')?.addEventListener('click', () => void navigator.clipboard.writeText(currentAnswer));

function renderAnswer(source: string) {
    currentAnswer = source;
    const text = $('response-text'); if (text) text.textContent = source;
    const root = $('response-rich'); if (!root) return;
    root.replaceChildren();
    const lines = source.replace(/\r\n/g, '\n').split('\n');
    let i = 0;
    const addInline = (el: HTMLElement, value: string) => {
        const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g; let pos = 0; let match: RegExpExecArray | null;
        while ((match = pattern.exec(value)) !== null) {
            if (match.index > pos) el.append(document.createTextNode(value.slice(pos, match.index)));
            const item = document.createElement(match[0].startsWith('`') ? 'code' : 'strong');
            item.textContent = match[0].startsWith('`') ? match[0].slice(1, -1) : match[0].slice(2, -2);
            el.append(item); pos = pattern.lastIndex;
        }
        if (pos < value.length) el.append(document.createTextNode(value.slice(pos)));
    };
    while (i < lines.length) {
        const line = lines[i]; if (!line.trim()) { i++; continue; }
        if (/^\s*```/.test(line)) {
            const code = document.createElement('pre'); code.className = 'answer-code'; i++;
            const block: string[] = []; while (i < lines.length && !/^\s*```/.test(lines[i])) block.push(lines[i++]);
            if (i < lines.length) i++; const inner = document.createElement('code'); inner.textContent = block.join('\n'); code.append(inner); root.append(code); continue;
        }
        const heading = line.match(/^\s{0,3}(#{1,4})\s+(.+)/);
        if (heading) { const el = document.createElement(heading[1].length <= 2 ? 'h3' : 'h4'); addInline(el, heading[2]); root.append(el); i++; continue; }
        if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
            const ordered = /^\s*\d+[.)]\s+/.test(line);
            const list = document.createElement(ordered ? 'ol' : 'ul');
            while (i < lines.length && (ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/).test(lines[i])) {
                const li = document.createElement('li'); addInline(li, lines[i].replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/, '')); list.append(li); i++;
            }
            root.append(list); continue;
        }
        const para = document.createElement('p'); addInline(para, lines[i].trim()); i++;
        while (i < lines.length && lines[i].trim() && !(/^\s*```|^\s{0,3}#{1,4}\s|^\s*[-*]\s+|^\s*\d+[.)]\s+/.test(lines[i]))) { para.append(document.createTextNode(' ' + lines[i].trim())); i++; }
        root.append(para);
    }
    if (!root.children.length) { const p = document.createElement('p'); p.textContent = 'No response available.'; root.append(p); }
}

function renderTools(id: string) {
    const container = $('tool-events'); if (!container) return;
    container.replaceChildren();
    const entries = toolEntries.get(id) || [];
    const count = $('tool-count'); if (count) count.textContent = String(entries.length);
    for (const evt of entries) {
        const div = document.createElement('div'); div.className = 'tool-entry';
        const heading = document.createElement('strong'); heading.textContent = evt.type;
        const em = document.createElement('em'); em.textContent = new Date(evt.timestamp).toLocaleTimeString();
        const value = document.createElement('span'); value.textContent = JSON.stringify(evt.payload, null, 2);
        div.append(heading, em, value); container.append(div);
    }
}

function setResponseTab(tab: string) {
    const ids: Record<string, string> = { answer: 'response-answer-panel', tools: 'response-tools-panel', history: 'response-history-panel' };
    for (const name of ['answer', 'tools', 'history']) {
        const panel = $(ids[name]); if (panel) panel.hidden = tab !== name;
        const btn = document.querySelector<HTMLButtonElement>(`[data-response-tab="${name}"]`);
        if (btn) { btn.classList.toggle('active', tab === name); btn.setAttribute('aria-selected', String(tab === name)); }
    }
}
document.querySelectorAll<HTMLButtonElement>('[data-response-tab]').forEach(b => b.addEventListener('click', () => setResponseTab(b.dataset.responseTab || 'answer')));

type TaskRecord = { id: string; prompt: string; state: string; result: string | null; error: string | null; session_id: string | null; created_at: string };
async function loadTask(id: string) {
    viewedTaskId = id;
    const generation = ++requestGeneration;
    const idEl = $('response-id'); if (idEl) idEl.textContent = id;
    try {
        const response = await fetch(`/api/tasks/${encodeURIComponent(id)}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const task = await response.json() as TaskRecord;
        if (generation !== requestGeneration) return;
        const status = $('response-status'); if (status) status.textContent = task.state;
        renderAnswer(task.result ?? (task.state === 'failed' ? 'Task failed without a response.' : task.state === 'completed' ? 'Task completed without response text.' : 'Hermes is working; awaiting response…'));
        const error = $('response-error'); if (error) { error.hidden = !task.error; error.textContent = task.error || ''; }
        renderTools(id);
        document.querySelectorAll<HTMLButtonElement>('.history-entry').forEach(btn => btn.setAttribute('aria-current', String(btn.dataset.taskId === id)));
    } catch (err) { if (generation === requestGeneration) { const el = $('response-status'); if (el) el.textContent = `Cannot load: ${str(err)}`; } }
}

async function refreshHistory() {
    try {
        const res = await fetch('/api/tasks'); if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const tasks = await res.json() as TaskRecord[];
        const list = $('task-history'); if (!list) return;
        list.replaceChildren();
        if (!tasks.length) { list.textContent = 'No previous tasks.'; return; }
        for (const task of tasks) {
            const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'history-entry'; btn.dataset.taskId = task.id;
            btn.setAttribute('aria-current', String(task.id === viewedTaskId));
            const state = document.createElement('span'); state.className = 'state'; state.textContent = task.state;
            const prompt = document.createElement('span'); prompt.textContent = task.prompt.length > 90 ? task.prompt.slice(0, 90) + '…' : task.prompt;
            const date = document.createElement('small'); date.textContent = new Date(task.created_at).toLocaleString() + ' · ' + task.id.slice(0, 8);
            btn.append(state, prompt, date);
            btn.addEventListener('click', () => { setFollowLive(false); setResponseTab('answer'); void loadTask(task.id); });
            list.append(btn);
        }
    } catch (err) { const list = $('task-history'); if (list) list.textContent = `History unavailable: ${str(err)}`; }
}
$('refresh-history')?.addEventListener('click', () => void refreshHistory());

function scheduleTaskRefresh(evt: EventRecord) {
    if (!evt.task_id) return;
    if (followLive && (evt.type === 'task.queued' || evt.type === 'task.started' || evt.type === 'task.completed' || evt.type === 'task.failed')) {
        if (viewedTaskId !== evt.task_id) { setResponseTab('answer'); void loadTask(evt.task_id); }
    }
    if (evt.type === 'hermes.tool_use' || evt.type === 'hermes.tool_result') {
        const entries = toolEntries.get(evt.task_id) || []; entries.push(evt); toolEntries.set(evt.task_id, entries);
        if (viewedTaskId === evt.task_id) renderTools(evt.task_id);
    }
    if (viewedTaskId === evt.task_id && (evt.type === 'task.started' || evt.type === 'task.completed' || evt.type === 'task.failed')) {
        clearTimeout(pendingRefresh); pendingRefresh = setTimeout(() => void loadTask(evt.task_id!), 100);
    }
}

async function syncLatestTask() {
    if (!followLive) return;
    try {
        const stateRes = await fetch('/api/agent/state');
        if (stateRes.ok) {
            const state = await stateRes.json() as { current_task?: string | null };
            if (state.current_task) { await loadTask(state.current_task); return; }
        }
        if (latestEventTaskId) await loadTask(latestEventTaskId);
    } catch (err) { console.warn('Unable to synchronize latest task', err); }
}

// Opening a task from the town, Work lifecycle, or goals routes to Results and loads it.
window.addEventListener('hermes:open-task', ((ev: Event) => {
    const id = (ev as CustomEvent<{ id: string }>).detail?.id;
    if (!id) return;
    setFollowLive(false);
    setWorkspace('results');
    void loadTask(id);
}) as EventListener);

// ============================= persona =============================
async function loadPersona() {
    try {
        const res = await fetch('/api/personality');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const persona = await res.json() as { name: string; experience_count: number };
        const name = $('persona-display'); if (name) name.textContent = persona.name;
        const exp = $('persona-experience'); if (exp) exp.textContent = `${persona.experience_count} recorded outcomes`;
        const fb = $('persona-feedback'); if (fb) fb.textContent = 'Core identity loaded from host.';
    } catch (e) { const fb = $('persona-feedback'); if (fb) fb.textContent = 'Persona unavailable: ' + String(e); }
}

const homeOpenWork = $('home-open-work');
homeOpenWork?.addEventListener('click', () => setWorkspace('work'));
$('studio-open-activity')?.addEventListener('click', () => setWorkspace('activity'));
// Home recent-strip "Open in Work" — same destination as the sidebar, also kept in
// case the persona block is collapsed; both surfaces route to the unified work
// workspace via the same handler.
$('home-recent-open')?.addEventListener('click', () => setWorkspace('work'));
renderRecentEvents();

// ============================= mount =============================
import { installTown } from './town-view';
installTown();
void hydrate();
void loadPersona();

setWorkspace('home');
paintStatus();
console.log('Hermes Life unified workspace initialized.');
