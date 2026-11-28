/**
 * Context Inspector (HL-WORK-001 M1).
 *
 * One typed inspector for the contextual side panel. Each Work subview
 * owns a selection ({kind, id}) in navigation-state's per-view selection
 * store; a view renders ONLY selections whose kind is in its domain, so
 * a task selected in Tasks can never occupy the Build/Discover/Projects
 * sidebar (the stale-selection bug this replaces).
 *
 * Render contract:
 *   - selection in domain  -> the kind's registered renderer draws the card
 *   - selection out of domain / none -> the view's workspace summary
 *
 * Views register renderers; this module owns the panel shell, the
 * visibility rules (Work workspace only) and the re-render wiring.
 *
 * HA-032 (spec §3.2): a resident pick is a real 'resident' selection that
 * carries the resident record. navigation-state's SelectionKind and the
 * Home scope's acceptance list are not ours to extend, so 'resident'
 * selections live in this module's own selection store (setInspectorSelection)
 * while the room pick underneath keeps the ring in navigation-state.
 */

import { getValidSelection, getCurrentWorkspace, getCurrentWorkView, onNavigationChange, onSelectionChange, setSelection, viewAccepts, openTask, openActivityForTask, openWorkspace, openWorkView } from './navigation-state.ts';
import type { Selection, SelectionKind, WorkView, Workspace } from './navigation-state';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

/** 'resident' is the World's HA-032 kind: kept here, not in navigation-state. */
export type InspectorKind = SelectionKind | 'resident' | 'bubble';

export const KIND_LABEL: Record<InspectorKind, string> = {
    task: 'Task',
    discovery: 'Discovery',
    goal: 'Goal',
    plan: 'Plan',
    build: 'Implementation run',
    project: 'Project',
    room: 'Location',
    resident: 'Resident',
    bubble: 'Execution event',
};

/** One recent event line on the resident card (newest first). */
export interface ResidentEventLine {
    type: string;
    sequence: number | null;
    /** The wire timestamp when the event carried one, else the observed clock. */
    timestamp: string | null;
}

/** The record a 'resident' selection carries, built from the authoritative town records. */
export interface ResidentRecord {
    name: string;
    title: string;
    state: string;
    /** Active operation, e.g. "Working — Implementing hermes-life". */
    operation: string;
    /** Fact rows: Place, Why (work origin / owning goal), Project/task, … */
    rows: Array<[string, string]>;
    taskId: string | null;
    /** Last N relevant events, newest first (N≈5). */
    events: ResidentEventLine[];
    /** The room's own existing dashboard view (spec §4) — no new destination. */
    view: string;
    workspace?: Workspace;
    workView?: WorkView;
}

/** HA-032: a resident selection carries its record; the id is the Role. */
export interface ResidentSelection { kind: 'resident'; id: string; record: ResidentRecord; }

/** HL-UI-PLAN-001 §4.3.3: a real runtime event selected from a World bubble. */
export interface BubbleRecord {
    id: string;
    role: string;
    category: string;
    createdAt: number;
    headline: string;
    details: string | null;
    toolName: string | null;
    toolTarget: string | null;
    status: string | null;
    taskId: string | null;
    sequence: number | null;
    startTime: number | null;
    endTime: number | null;
}
export interface BubbleSelection { kind: 'bubble'; id: string; record: BubbleRecord; }

export type InspectorSelection = Selection | ResidentSelection | BubbleSelection;

/** Per-view short summary shown when the inspector is empty. */
export interface WorkspaceSummary {
    line: string;
    /** Optional count chips, e.g. [{ label: 'open tasks', count: 3 }] */
    chips?: Array<{ label: string; count: number }>;
}

type KindRenderer = (sel: InspectorSelection, body: HTMLElement) => void;
type SummaryProvider = () => WorkspaceSummary | null;

const kindRenderers = new Map<InspectorKind, KindRenderer>();
const summaryProviders = new Map<WorkView, SummaryProvider>();

/** Register the card renderer for a selection kind (one per kind). */
export function registerKindRenderer(kind: InspectorKind, fn: KindRenderer) {
    kindRenderers.set(kind, fn);
}

/** Register the empty-state summary for a Work view. */
export function registerSummaryProvider(view: WorkView, fn: SummaryProvider) {
    summaryProviders.set(view, fn);
}

/**
 * The inspector-owned selection (HA-032). navigation-state's Home scope accepts
 * only 'room' and is not ours to extend, so a 'resident' selection is kept here:
 * town-view selects kind 'resident' with the resident record, and the room pick
 * underneath (navigation-state, kind 'room') keeps the highlight ring.
 */
let inspectorSelection: InspectorSelection | null = null;

/** Select (or clear) the inspector-owned selection and repaint. */
export function setInspectorSelection(sel: InspectorSelection | null): void {
    inspectorSelection = sel;
    render();
}

export function getInspectorSelection(): InspectorSelection | null {
    return inspectorSelection;
}

function panelElements(): { panel: HTMLElement | null; body: HTMLElement | null } {
    return { panel: $('ctx-inspector'), body: $('ctx-inspector-body') };
}

/** Clear the selection owned by a view (convenience passthrough). */
export function clearSelection(view: WorkView) {
    setSelection(view, null);
}

function render() {
    const { panel, body } = panelElements();
    if (!panel || !body) return;
    const ctxHome = $('ctx-home');
    const ws = getCurrentWorkspace();
    const onWorld = ws === 'home';
    // One contextual surface at a time: on Home/World a room selection REPLACES
    // the home block (persona / new task / current work) rather than stacking
    // under it; elsewhere the home block is hidden entirely. HA-032: a resident
    // selection is the active card; the room pick underneath keeps the ring and
    // resumes the room card once the resident card is dismissed.
    const roomSel = onWorld ? inspectorSelection ?? getValidSelection('home') : null;
    if (ctxHome) ctxHome.hidden = !(onWorld && !roomSel);
    // The overview strip belongs to Home itself, so a room pick never hides it.
    const ctxOverview = $('ctx-overview');
    if (ctxOverview) ctxOverview.hidden = !onWorld;

    // The inspector serves Work views and, since P2, Home/World room picks.
    if (!onWorld && ws !== 'work') {
        panel.hidden = true;
        return;
    }
    if (onWorld) {
        // Home/World: the inspector only appears once a room or resident is
        // selected. Room selections persist under the home scope key.
        if (!roomSel) {
            panel.hidden = true;
            return;
        }
        panel.hidden = false;
        body.replaceChildren();
        const renderer = kindRenderers.get(roomSel.kind);
        if (renderer) renderer(roomSel, body);
        return;
    }
    const view = getCurrentWorkView();
    const sel = getValidSelection(view);
    if (sel) {
        panel.hidden = false;
        body.replaceChildren();
        const renderer = kindRenderers.get(sel.kind);
        if (renderer) {
            renderer(sel, body);
        } else {
            // No rich renderer yet for this kind (later milestones):
            // still render a typed card so a foreign record never appears.
            const h = document.createElement('strong');
            h.textContent = KIND_LABEL[sel.kind];
            const p = document.createElement('p');
            p.textContent = `Selected ${sel.kind}: ${sel.id}`;
            body.append(h, p);
        }
        return;
    }
    // No selection: show a real summary only when the view provides one.
    // A bare "select something" placeholder is not useful — collapse instead
    // (regroup feedback §2: the inspector never holds the screen idle).
    const summary = summaryProviders.get(view)?.() ?? null;
    if (summary) {
        panel.hidden = false;
        body.replaceChildren();
        const h = document.createElement('strong');
        h.textContent = view.charAt(0).toUpperCase() + view.slice(1);
        body.append(h);
        const p = document.createElement('p');
        p.textContent = summary.line;
        body.append(p);
        if (summary.chips?.length) {
            const chips = document.createElement('p');
            chips.className = 'ctx-summary-chips';
            chips.textContent = summary.chips.map(c => `${c.count} ${c.label}`).join(' · ');
            body.append(chips);
        }
        return;
    }
    panel.hidden = true;
}

// HA-032 (spec §3.2): the resident card — role/title, active operation, the
// owning project/task/goal rows, the last N events and the actions. It replaces
// the floating #town-selection popover, which is retired.
registerKindRenderer('bubble', (sel, body) => {
    if (sel.kind !== 'bubble') return;
    const r = sel.record;
    const card = document.createElement('div');
    card.className = 'town-card';
    if (r.status) card.dataset.state = r.status;
    const heading = document.createElement('strong');
    heading.textContent = r.headline;
    const facts = document.createElement('ul');
    const rows: Array<[string, string]> = [['Category', r.category], ['Shown for', r.role]];
    if (r.toolName) rows.push(['Tool', r.toolName]);
    if (r.toolTarget) rows.push(['Target', r.toolTarget]);
    if (r.status) rows.push(['Status', r.status]);
    if (r.sequence !== null) rows.push(['Sequence', `#${r.sequence}`]);
    const started = r.startTime ?? r.createdAt;
    rows.push(['Started', new Date(started).toLocaleTimeString()]);
    if (r.endTime !== null) rows.push(['Ended', new Date(r.endTime).toLocaleTimeString()]);
    for (const [key, value] of rows) {
        const item = document.createElement('li');
        item.textContent = `${key}: ${value}`;
        facts.append(item);
    }
    card.append(heading, facts);
    if (r.details) {
        const detail = document.createElement('p');
        detail.textContent = r.details;
        card.append(detail);
    }
    const actions = document.createElement('div');
    actions.className = 'town-card-actions';
    if (r.taskId) {
        const open = document.createElement('button');
        open.type = 'button';
        open.textContent = 'Open task';
        open.addEventListener('click', () => { openTask(r.taskId, { destination: 'work' }); });
        actions.append(open);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Dismiss';
    close.addEventListener('click', () => setInspectorSelection(null));
    actions.append(close);
    card.append(actions);
    body.append(card);
});

registerKindRenderer('resident', (sel, body) => {
    if (sel.kind !== 'resident') return;
    const r = sel.record;
    const card = document.createElement('div');
    card.className = 'town-card';
    card.dataset.state = r.state;
    const heading = document.createElement('strong');
    heading.textContent = `${r.name} — ${r.title}`;
    const state = document.createElement('p');
    state.textContent = r.operation;
    const facts = document.createElement('ul');
    for (const [key, value] of r.rows) {
        const item = document.createElement('li');
        item.textContent = `${key}: ${value}`;
        facts.append(item);
    }
    // Spec §3.2 "relevant events": the last N events ride with the card, each
    // with its timestamp when one is available (D18: evidence one click away).
    const eventsHead = document.createElement('p');
    eventsHead.innerHTML = '<em>Recent events</em>';
    const events = document.createElement('ul');
    for (const ev of r.events) {
        const item = document.createElement('li');
        item.textContent = `${ev.type}${ev.sequence !== null ? ` (#${ev.sequence})` : ''}${ev.timestamp ? ` · ${ev.timestamp}` : ''}`;
        events.append(item);
    }
    const actions = document.createElement('div');
    actions.className = 'town-card-actions';
    const view = document.createElement('button');
    view.type = 'button';
    view.textContent = 'Open ' + r.view;
    view.addEventListener('click', () => {
        if (r.workspace) openWorkspace(r.workspace);
        else if (r.workView) openWorkView(r.workView);
    });
    actions.append(view);
    if (r.taskId) {
        const task = document.createElement('button');
        task.type = 'button';
        task.textContent = 'Open task ' + r.taskId.slice(0, 8);
        // Canonical intent: open task in Work workspace (Tasks subview)
        // Single action, single destination — no dual event dispatch
        task.addEventListener('click', () => {
            openTask(r.taskId!, { destination: 'work' });
        });
        // D18 (review.md): the spec's resident focus shows "relevant events,
        // evidence" — the task's Activity timeline is the durable record, one
        // filtered click away instead of a manual hunt.
        const evidence = document.createElement('button');
        evidence.type = 'button';
        evidence.textContent = 'Activity / evidence';
        evidence.addEventListener('click', () => {
            openActivityForTask(r.taskId!);
        });
        actions.append(task, evidence);
    }
    card.append(heading, state, facts, eventsHead, events, actions);
    body.append(card);
});

let wired = false;

/** Force a re-render of the inspector (views call this after their data
 *  refresh lands so a persisted selection picks up fresh record data). */
export function rerenderInspector() {
    if (wired) render();
}

/** Wire the inspector to navigation + selection changes. Safe to call once. */
export function initContextInspector() {
    // World bubble clicks select the real event (bubbles.ts dispatches it).
    window.addEventListener('hermes:bubble-select', (event: Event) => {
        const d = (event as CustomEvent<{ id?: string; role?: string; category?: string; createdAt?: number; content?: Record<string, unknown> }>).detail;
        if (!d?.id || !d.content) return;
        const c = d.content as Record<string, unknown>;
        const num = (v: unknown) => (typeof v === 'number' ? v : null);
        const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
        setInspectorSelection({
            kind: 'bubble',
            id: d.id,
            record: {
                id: d.id,
                role: String(d.role ?? ''),
                category: String(d.category ?? ''),
                createdAt: d.createdAt ?? Date.now(),
                headline: str(c.headline) ?? 'Event',
                details: str(c.details),
                toolName: str(c.toolName),
                toolTarget: str(c.toolTarget),
                status: str(c.status),
                taskId: str(c.taskId),
                sequence: num(c.sequence),
                startTime: num(c.startTime),
                endTime: num(c.endTime),
            },
        });
    });
    if (wired) return;
    wired = true;
    onNavigationChange(() => render());
    onSelectionChange(() => render());
    // Re-render when a re-selected kind's renderer wants fresh data —
    // views call setSelection on their own data refreshes, which notifies.
    render();
}

export { viewAccepts };
