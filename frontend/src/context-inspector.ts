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
 */

import { getValidSelection, getCurrentWorkspace, getCurrentWorkView, onNavigationChange, onSelectionChange, setSelection, viewAccepts } from './navigation-state.ts';
import type { Selection, SelectionKind, WorkView } from './navigation-state';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

export const KIND_LABEL: Record<SelectionKind, string> = {
    task: 'Task',
    discovery: 'Discovery',
    goal: 'Goal',
    plan: 'Plan',
    build: 'Implementation run',
    project: 'Project',
    room: 'Location',
};

/** Per-view short summary shown when the inspector is empty. */
export interface WorkspaceSummary {
    line: string;
    /** Optional count chips, e.g. [{ label: 'open tasks', count: 3 }] */
    chips?: Array<{ label: string; count: number }>;
}

type KindRenderer = (sel: Selection, body: HTMLElement) => void;
type SummaryProvider = () => WorkspaceSummary | null;

const kindRenderers = new Map<SelectionKind, KindRenderer>();
const summaryProviders = new Map<WorkView, SummaryProvider>();

/** Register the card renderer for a selection kind (one per kind). */
export function registerKindRenderer(kind: SelectionKind, fn: KindRenderer) {
    kindRenderers.set(kind, fn);
}

/** Register the empty-state summary for a Work view. */
export function registerSummaryProvider(view: WorkView, fn: SummaryProvider) {
    summaryProviders.set(view, fn);
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
    const ws = getCurrentWorkspace();
    // The inspector serves Work views and, since P2, Home/World room picks.
    if (ws !== 'work' && ws !== 'home' && ws !== 'world') {
        panel.hidden = true;
        return;
    }
    if (ws === 'home' || ws === 'world') {
        // Home/World: the inspector only appears once a room is selected — the
        // ctx-home block owns the empty state (persona, new task, current work).
        // Room selections persist under the home scope key.
        const roomSel = getValidSelection('home');
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

let wired = false;

/** Force a re-render of the inspector (views call this after their data
 *  refresh lands so a persisted selection picks up fresh record data). */
export function rerenderInspector() {
    if (wired) render();
}

/** Wire the inspector to navigation + selection changes. Safe to call once. */
export function initContextInspector() {
    if (wired) return;
    wired = true;
    onNavigationChange(() => render());
    onSelectionChange(() => render());
    // Re-render when a re-selected kind's renderer wants fresh data —
    // views call setSelection on their own data refreshes, which notifies.
    render();
}

export { viewAccepts };
