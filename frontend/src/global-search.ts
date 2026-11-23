/**
 * Global search (HERMESHA spec §2/§3/§5) — one aggregate field in the top bar.
 *
 * Reads GET /api/search and routes every hit through the canonical
 * navigation-state intents. It invents no navigation path of its own: the
 * backend result's `deeplink` names the intent and this module executes it.
 * A degraded source (e.g. an unreachable vault) is surfaced, never hidden.
 */
import { openTask, openWorkView, openWorkspace, setSelection } from './navigation-state.ts';
import type { WorkView } from './navigation-state.ts';

const $ = (id: string): HTMLElement | null => document.getElementById(id);

export interface SearchResult {
    kind: string;
    id: string;
    title: string;
    excerpt: string;
    source: string;
    score: number;
    project_id: string | null;
    deeplink: { intent: string; args: Record<string, unknown> };
}

export const GROUP_LABEL: Record<string, string> = {
    task: 'Tasks', goal: 'Goals', discovery: 'Discoveries', plan: 'Plans',
    run: 'Runs', project: 'Projects', conversation: 'Conversations',
    memory: 'Memory', note: 'Vault notes', library: 'Library',
};

/** Group results by kind, preserving each group's best-first order. */
export function groupResults(results: SearchResult[]): Array<[string, SearchResult[]]> {
    const groups = new Map<string, SearchResult[]>();
    for (const r of results) {
        const bucket = groups.get(r.kind) ?? [];
        bucket.push(r);
        groups.set(r.kind, bucket);
    }
    return [...groups.entries()];
}

export type NavAction =
    | { type: 'task'; taskId: string }
    | { type: 'workview'; workView: string; selection?: { kind: string; id: string } }
    | { type: 'workspace'; workspace: string }
    | { type: 'note'; noteId: string };

/** Normalize a result's deeplink into a navigation action (null if unknown). */
export function resolveAction(r: SearchResult): NavAction | null {
    const { intent, args } = r.deeplink ?? { intent: '', args: {} };
    switch (intent) {
        case 'openTask':
            return { type: 'task', taskId: String(args.taskId ?? '') };
        case 'openWorkView':
            return {
                type: 'workview', workView: String(args.workView ?? ''),
                selection: args.selection as { kind: string; id: string } | undefined,
            };
        case 'openWorkspace':
            return { type: 'workspace', workspace: String(args.workspace ?? '') };
        case 'openNote':
            return { type: 'note', noteId: String(args.noteId ?? '') };
        default:
            return null;
    }
}

function perform(action: NavAction): void {
    switch (action.type) {
        case 'task':
            openTask(action.taskId, { destination: 'work' });
            break;
        case 'workview':
            openWorkView(action.workView as WorkView);
            if (action.selection) setSelection(action.workView as WorkView, action.selection as never);
            break;
        case 'workspace':
            openWorkspace(action.workspace as never);
            break;
        case 'note':
            openWorkspace('knowledge');
            window.dispatchEvent(new CustomEvent('hermes:open-note', { detail: { note_id: action.noteId } }));
            break;
    }
}

// --------------------------------------------------------------------------- DOM

let input: HTMLInputElement | null = null;
let panel: HTMLElement | null = null;
let results: SearchResult[] = [];
let degraded: string[] = [];
let timer: number | undefined;
let wired = false;

function closePanel(): void {
    if (panel) panel.hidden = true;
    input?.setAttribute('aria-expanded', 'false');
}

function renderPanel(): void {
    if (!panel || !input) return;
    panel.replaceChildren();
    const query = input.value.trim();
    if (query.length < 2) { closePanel(); return; }

    if (degraded.length) {
        const note = document.createElement('p');
        note.className = 'global-search-degraded';
        note.textContent = `Some sources are unavailable: ${degraded.join('; ')}`;
        panel.append(note);
    }
    if (!results.length) {
        const empty = document.createElement('p');
        empty.className = 'global-search-empty';
        empty.textContent = `No matches for “${query}”.`;
        panel.append(empty);
        panel.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        return;
    }

    for (const [kind, items] of groupResults(results)) {
        const head = document.createElement('h3');
        head.textContent = `${GROUP_LABEL[kind] ?? kind} (${items.length})`;
        panel.append(head);
        for (const item of items) {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'global-search-item';
            row.dataset.kind = kind;
            const title = document.createElement('span');
            title.className = 'global-search-item__title';
            title.textContent = item.title || item.id;
            row.append(title);
            if (item.excerpt) {
                const ex = document.createElement('span');
                ex.className = 'global-search-item__excerpt';
                ex.textContent = item.excerpt;
                row.append(ex);
            }
            row.addEventListener('click', () => {
                const action = resolveAction(item);
                if (action) perform(action);
                closePanel();
                input?.blur();
            });
            panel.append(row);
        }
    }
    panel.hidden = false;
    input.setAttribute('aria-expanded', 'true');
}

async function run(query: string): Promise<void> {
    try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=20`);
        const body = res.ok ? await res.json() : null;
        results = Array.isArray(body?.results) ? body.results : [];
        degraded = Array.isArray(body?.degraded) ? body.degraded : [];
    } catch {
        results = [];
        degraded = ['search service unreachable'];
    }
    if (input && input.value.trim() === query) renderPanel();
}

function onInput(): void {
    if (!input) return;
    window.clearTimeout(timer);
    const query = input.value.trim();
    if (query.length < 2) { results = []; degraded = []; closePanel(); return; }
    timer = window.setTimeout(() => { void run(query); }, 200);
}

export function initGlobalSearch(): void {
    if (wired) return;
    input = $('global-search-input') as HTMLInputElement | null;
    panel = $('global-search-results');
    if (!input || !panel) return;
    wired = true;

    input.addEventListener('input', onInput);
    input.addEventListener('focus', () => { if (input!.value.trim().length >= 2) renderPanel(); });
    input.addEventListener('keydown', ev => {
        if (ev.key === 'Escape') { closePanel(); input?.blur(); return; }
        if (ev.key === 'Enter' && results.length) {
            ev.preventDefault();
            const action = resolveAction(results[0]);
            if (action) perform(action);
            closePanel();
        }
    });
    // Click-away closes the panel.
    document.addEventListener('click', ev => {
        if (panel && !panel.hidden && !panel.contains(ev.target as Node) && ev.target !== input) closePanel();
    });
    // `/` focuses search unless the user is already typing in a field.
    document.addEventListener('keydown', ev => {
        if (ev.key !== '/' || ev.metaKey || ev.ctrlKey) return;
        const el = ev.target as HTMLElement | null;
        const tag = el?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || el?.isContentEditable) return;
        ev.preventDefault();
        input?.focus();
    });
}

initGlobalSearch();
