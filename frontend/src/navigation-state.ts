/**
 * Single canonical navigation state for the Hermes Life workspace.
 *
 * This module owns the in-memory navigation snapshot AND its URL
 * serialization (History API, deep-link restoration, popstate handling).
 * All modules route navigation through the named intents here rather than
 * synthetic .click() chains or ad-hoc event dispatches.
 *
 * URL encoding (query params):
 *   ?view=work&workview=tasks&task=<id>
 *   ?view=results&task=<id>
 *   ?view=activity&task=<id>&filter=selected
 *   ?view=home   /   ?view=system
 *
 * History policy:
 *   - pushState for explicit user navigation intents (workspace switches,
 *     workview switches, task selections that change the view)
 *   - replaceState for passive updates (background task completion,
 *     same-URL navigation) so back/forward stay deterministic
 */

export type Workspace = 'home' | 'work' | 'activity' | 'results' | 'system';
export type WorkView = 'tasks' | 'discover' | 'goals' | 'planning' | 'build' | 'projects';
export type TaskView = 'overview' | 'investigation' | 'plan' | 'changes' | 'tests' | 'evidence';
export type ActivityFilter = 'selected' | 'all';

export const WORKSPACES: readonly Workspace[] = ['home', 'work', 'activity', 'results', 'system'] as const;
export const WORK_VIEWS: readonly WorkView[] = ['tasks', 'discover', 'goals', 'planning', 'build', 'projects'] as const;
export const TASK_VIEWS: readonly TaskView[] = ['overview', 'investigation', 'plan', 'changes', 'tests', 'evidence'] as const;

export interface NavigationState {
    workspace: Workspace;
    workView: WorkView;
    selectedTaskId: string | null;
    taskView: TaskView;
    activityFilter: ActivityFilter;
    // Extended only when existing storage/contracts require it
    conversationId: string | null;
    projectId: string | null;
}

const DEFAULT_NAV: NavigationState = {
    workspace: 'home',
    workView: 'tasks',
    selectedTaskId: null,
    taskView: 'overview',
    activityFilter: 'all',
    conversationId: null,
    projectId: null,
};

// Internal mutable state
let state: NavigationState = { ...DEFAULT_NAV };

const listeners = new Set<(state: NavigationState) => void>();
const taskValidators = new Set<() => string[] | null>();

function notify() {
    const snapshot = { ...state };
    for (const fn of listeners) fn(snapshot);
}

/** Subscribe to navigation state changes. Returns unsubscribe function. */
export function onNavigationChange(fn: (state: NavigationState) => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** Register a validator that returns the set of currently-loaded task ids.
 *  Used to reject deep-links to deleted/missing tasks. Returns an
 *  unsubscribe function. */
export function registerTaskValidator(fn: () => string[] | null): () => void {
    taskValidators.add(fn);
    return () => taskValidators.delete(fn);
}

/** Get current navigation snapshot (read-only). */
export function getNavigationState(): Readonly<NavigationState> {
    return { ...state };
}

/** Low-level state mutation — prefer the named intents below. */
function setState(partial: Partial<NavigationState>) {
    state = { ...state, ...partial };
}

/* =====================================================================
 * URL serialization
 * ===================================================================== */

function isWorkspace(v: string | null): v is Workspace {
    return v !== null && (WORKSPACES as readonly string[]).includes(v);
}
function isWorkView(v: string | null): v is WorkView {
    return v !== null && (WORK_VIEWS as readonly string[]).includes(v);
}

/** Encode navigation state to query params (no leading '?'). */
export function serializeNavQuery(s: NavigationState): string {
    const params = new URLSearchParams();
    params.set('view', s.workspace);
    if (s.workspace === 'work') params.set('workview', s.workView);
    if (s.selectedTaskId) params.set('task', s.selectedTaskId);
    if (s.workspace === 'activity' && s.activityFilter === 'selected') params.set('filter', 'selected');
    return params.toString();
}

/** Parse query params into a partial navigation state. Invalid values are ignored. */
export function parseNavQuery(query: string): Partial<NavigationState> {
    const params = new URLSearchParams(query);
    const partial: Partial<NavigationState> = {};

    const view = params.get('view');
    if (isWorkspace(view)) partial.workspace = view;

    const workview = params.get('workview');
    if (isWorkView(workview)) partial.workView = workview;

    const task = params.get('task');
    if (task) partial.selectedTaskId = task;

    const filter = params.get('filter');
    if (filter === 'selected') partial.activityFilter = 'selected';
    else if (filter === 'all') partial.activityFilter = 'all';

    return partial;
}

/** Update the address bar without creating a history entry. */
function replaceUrl(s: NavigationState) {
    const query = serializeNavQuery(s);
    const url = query ? `${location.pathname}?${query}` : location.pathname;
    if (url !== location.pathname + location.search) {
        history.replaceState({ nav: { ...s } }, '', url);
    }
}

/** Push a new history entry for an explicit navigation gesture. */
function pushUrl(s: NavigationState) {
    const query = serializeNavQuery(s);
    const url = query ? `${location.pathname}?${query}` : location.pathname;
    if (url !== location.pathname + location.search) {
        history.pushState({ nav: { ...s } }, '', url);
    } else {
        // Same URL — keep depth flat, still record state for popstate restore
        history.replaceState({ nav: { ...s } }, '', url);
    }
}

/* =====================================================================
 * History wiring (popstate + initial parse)
 * ===================================================================== */

let historyWired = false;

/**
 * Wire history listeners and parse the initial URL. Safe to call once.
 * Returns true when a deep link was present in the initial URL (so the
 * shell must not override it with a default workspace).
 */
export function initHistory(): boolean {
    if (historyWired) return deepLinked;
    historyWired = true;

    window.addEventListener('popstate', (ev: PopStateEvent) => {
        // Prefer the serialized state snapshot; fall back to parsing the URL.
        const fromEvent = (ev.state as { nav?: Partial<NavigationState> } | null)?.nav;
        const parsed = fromEvent ? { ...parseNavQuery(location.search), ...fromEvent } : parseNavQuery(location.search);
        applyParsed(parsed, { source: 'popstate' });
    });

    // Initial deep-link restore
    const parsed = parseNavQuery(location.search);
    if (Object.keys(parsed).length) {
        deepLinked = true;
        applyParsed(parsed, { source: 'initial' });
    }
    // Stamp the starting history entry so the first Back has a snapshot.
    history.replaceState({ nav: { ...state } }, '', location.pathname + location.search);
    return deepLinked;
}

let deepLinked = false;

/** Whether the initial URL carried a deep link. */
export function wasDeepLinked(): boolean {
    return deepLinked;
}

/** Result of a deep-link application. */
export interface DeepLinkResult {
    applied: boolean;
    /** The requested task was not found in loaded task lists. */
    taskMissing?: boolean;
    /** Notes for the controller: e.g. show the controlled empty state. */
    missingTaskId?: string | null;
}

/**
 * Apply parsed query params to the in-memory state.
 * Task ids are validated against registered validators (loaded task lists).
 * A missing/deleted task is cleared to null (controlled empty state),
 * never silently dropped.
 *
 * On popstate, an entry that carries no nav information at all (bare URL,
 * foreign state) restores the default view — Back to a bare entry means
 * Home, not "whatever was on screen".
 */
function applyParsed(parsed: Partial<NavigationState>, opts: { source: 'initial' | 'popstate' }): DeepLinkResult {
    let taskMissing = false;
    let missingTaskId: string | null = null;

    const carriesNavInfo = Boolean(
        parsed.workspace || parsed.workView
        || parsed.selectedTaskId !== undefined || parsed.activityFilter,
    );
    if (!carriesNavInfo && opts.source === 'popstate') {
        state = { ...DEFAULT_NAV };
        notify();
        return { applied: true };
    }

    let task = parsed.selectedTaskId ?? null;
    if (task) {
        let loaded: string[] | null = null;
        for (const validate of taskValidators) {
            loaded = validate();
            if (loaded && loaded.length) break;
        }
        if (loaded && !loaded.includes(task)) {
            taskMissing = true;
            missingTaskId = task;
            task = null; // controlled empty state — do not select a ghost
        }
    }

    state = {
        ...state,
        ...(parsed.workspace ? { workspace: parsed.workspace } : {}),
        ...(parsed.workView ? { workView: parsed.workView } : {}),
        ...(parsed.activityFilter ? { activityFilter: parsed.activityFilter } : {}),
        selectedTaskId: task,
    };
    notify();
    return { applied: true, taskMissing, missingTaskId };
}

/* =====================================================================
 * Named Navigation Intents — single entry points for all navigation.
 * Each intent produces exactly ONE workspace/task change and ONE history
 * entry (or replaceState for passive updates).
 * ===================================================================== */

/** Switch top-level workspace (Home / Work / Activity / Results / System). */
export function openWorkspace(workspace: Workspace, opts?: { replace?: boolean }) {
    setState({ workspace });
    if (workspace !== 'work') setState({ workView: 'tasks' });
    notify();
    if (opts?.replace) replaceUrl(state); else pushUrl(state);
}

/** Switch Work subview (Tasks / Discover / Goals / Planning / Build). */
export function openWorkView(workView: WorkView, opts?: { replace?: boolean }) {
    if (state.workspace !== 'work') setState({ workspace: 'work', workView });
    else setState({ workView });
    notify();
    if (opts?.replace) replaceUrl(state); else pushUrl(state);
}

/**
 * Select a task — updates selectedTaskId and optionally opens Work/Results.
 * History policy: a task selection that CHANGES THE VIEW is a real
 * navigation gesture (pushState). Selecting the same task again, or a
 * passive re-selection on data refresh, replaces the URL so Back does not
 * replay every click.
 */
export function openTask(taskId: string | null, options?: {
    destination?: 'work' | 'results';
    conversationId?: string | null;
    projectId?: string | null;
    /** Passive update: replace instead of push a history entry. */
    replace?: boolean;
}) {
    const dest = options?.destination ?? 'work';
    const prev = state.selectedTaskId;
    setState({
        selectedTaskId: taskId,
        conversationId: options?.conversationId ?? null,
        projectId: options?.projectId ?? null,
    });
    if (dest === 'results') setState({ workspace: 'results' });
    else if (state.workspace !== 'work') setState({ workspace: 'work', workView: 'tasks' });

    // A selection change is meaningful navigation only when the task
    // actually changed; same-task re-selections (refreshes) replace.
    const isRealChange = taskId !== prev;
    notify();
    if (options?.replace || !isRealChange) replaceUrl(state);
    else pushUrl(state);
}

/** Open Results workspace for a task (answer + evidence). */
export function openResult(taskId: string, opts?: { replace?: boolean }) {
    openTask(taskId, { destination: 'results', ...opts });
}

/** Open Activity workspace filtered to a task. */
export function openActivityForTask(taskId: string, opts?: { replace?: boolean }) {
    setState({
        workspace: 'activity',
        selectedTaskId: taskId,
        activityFilter: 'selected',
    });
    notify();
    if (opts?.replace) replaceUrl(state); else pushUrl(state);
}

/** Open Activity workspace with no filter (all events). */
export function openActivityAll(opts?: { replace?: boolean }) {
    setState({ workspace: 'activity', activityFilter: 'all' });
    notify();
    if (opts?.replace) replaceUrl(state); else pushUrl(state);
}

/**
 * Select a room in the Home/World view.
 * Room selection is recorded ONLY when it represents a meaningful
 * navigable selection (an operational room), not for transient hover/
 * highlight states. It never opens a second scope.
 */
export function selectRoom(roomKey: string, opts?: { push?: boolean }) {
    window.dispatchEvent(new CustomEvent('hermesha:room:select', { detail: { room: roomKey } }));
    if (opts?.push && state.workspace === 'home') {
        // Rooms are part of the Home view, encoded as a room param.
        const params = new URLSearchParams(serializeNavQuery(state));
        params.set('room', roomKey);
        const url = `${location.pathname}?${params.toString()}`;
        const snapshot: NavigationState & { roomId?: string } = { ...state, roomId: roomKey };
        history.pushState({ nav: snapshot }, '', url);
    }
}

/** Set the task detail sub-view. Passive: replaceState (no history spam). */
export function setTaskView(taskView: TaskView) {
    setState({ taskView });
    notify();
    replaceUrl(state);
}

/* =====================================================================
 * Compatibility adapters for legacy events.
 * These will be removed once all callers migrate to named intents.
 * ===================================================================== */

/** @deprecated Use openWorkspace/openWorkView/openTask instead. */
export function handleLegacyOpenTask(taskId: string) {
    openTask(taskId, { destination: 'results' });
}

/** @deprecated Use openWorkView instead. */
export function handleLegacyWorkView(view: string) {
    if (isWorkView(view)) openWorkView(view);
}

/** @deprecated Use openActivityForTask instead. */
export function handleLegacyWorkspaceActivity(taskId: string) {
    openActivityForTask(taskId);
}

/** @deprecated Use openTask with destination 'work' instead. */
export function handleLegacyTaskFocus(taskId: string) {
    openTask(taskId, { destination: 'work' });
}

/* =====================================================================
 * Selectors for UI binding
 * ===================================================================== */

export function getSelectedTaskId(): string | null {
    return state.selectedTaskId;
}

export function getCurrentWorkspace(): Workspace {
    return state.workspace;
}

export function getCurrentWorkView(): WorkView {
    return state.workView;
}

export function getActivityFilter(): ActivityFilter {
    return state.activityFilter;
}

export function getConversationId(): string | null {
    return state.conversationId;
}

/** Reset navigation to initial state (used on full reload). */
export function resetNavigation(opts?: { replace?: boolean }) {
    state = { ...DEFAULT_NAV };
    notify();
    if (opts?.replace) replaceUrl(state); else pushUrl(state);
}