/**
 * Single canonical navigation state for the Hermes Life workspace.
 *
 * This module owns the in-memory navigation snapshot. URL serialization
 * (pushState/replaceState, deep-link restoration) is handled in UUX-004E.
 * All modules route navigation through the named intents here rather than
 * synthetic .click() chains or ad-hoc event dispatches.
 */

export type Workspace = 'home' | 'work' | 'activity' | 'results' | 'system';
export type WorkView = 'tasks' | 'discover' | 'goals' | 'planning' | 'build';
export type TaskView = 'overview' | 'investigation' | 'plan' | 'changes' | 'tests' | 'evidence';
export type ActivityFilter = 'selected' | 'all';

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

// Internal mutable state
let state: NavigationState = {
    workspace: 'home',
    workView: 'tasks',
    selectedTaskId: null,
    taskView: 'overview',
    activityFilter: 'all',
    conversationId: null,
    projectId: null,
};

const listeners = new Set<(state: NavigationState) => void>();

function notify() {
    // Create a frozen snapshot for listeners
    const snapshot = { ...state, selectedTaskId: state.selectedTaskId };
    for (const fn of listeners) fn(snapshot);
}

/** Subscribe to navigation state changes. Returns unsubscribe function. */
export function onNavigationChange(fn: (state: NavigationState) => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** Get current navigation snapshot (read-only). */
export function getNavigationState(): Readonly<NavigationState> {
    return { ...state };
}

/** Low-level state mutation — prefer the named intents below. */
function setState(partial: Partial<NavigationState>) {
    state = { ...state, ...partial };
    notify();
}

/* =====================================================================
 * Named Navigation Intents — single entry points for all navigation.
 * Each intent produces exactly ONE workspace/task change.
 * ===================================================================== */

/** Switch top-level workspace (Home / Work / Activity / Results / System). */
export function openWorkspace(workspace: Workspace) {
    setState({ workspace });
    // When leaving Work, preserve selectedTaskId but reset workView to default
    if (workspace !== 'work') {
        setState({ workView: 'tasks' });
    }
}

/** Switch Work subview (Tasks / Discover / Goals / Planning / Build). */
export function openWorkView(workView: WorkView) {
    if (state.workspace !== 'work') {
        // If not in Work, switch to Work first
        setState({ workspace: 'work', workView });
    } else {
        setState({ workView });
    }
}

/** Select a task — updates selectedTaskId and optionally opens Work/Results. */
export function openTask(taskId: string | null, options?: {
    /** Destination workspace (default: 'work' for thread/composer, 'results' for answer) */
    destination?: 'work' | 'results';
    /** Conversation ID for composer binding */
    conversationId?: string | null;
    /** Project ID for context */
    projectId?: string | null;
}) {
    const dest = options?.destination ?? 'work';
    setState({
        selectedTaskId: taskId,
        conversationId: options?.conversationId ?? null,
        projectId: options?.projectId ?? null,
    });
    if (dest === 'results') {
        setState({ workspace: 'results' });
    } else if (state.workspace !== 'work') {
        setState({ workspace: 'work', workView: 'tasks' });
    }
}

/** Open Results workspace for a task (answer + evidence). */
export function openResult(taskId: string) {
    openTask(taskId, { destination: 'results' });
}

/** Open Activity workspace filtered to a task. */
export function openActivityForTask(taskId: string) {
    setState({
        workspace: 'activity',
        selectedTaskId: taskId,
        activityFilter: 'selected',
    });
}

/** Open Activity workspace with no filter (all events). */
export function openActivityAll() {
    setState({
        workspace: 'activity',
        activityFilter: 'all',
    });
}

/** Select a room in the Home/World view. */
export function selectRoom(roomKey: string) {
    // Room selection is a presentation concern in Home workspace;
    // it does not change selectedTaskId or Work subview.
    if (state.workspace === 'home') {
        // Could dispatch to town-view for camera movement
        window.dispatchEvent(new CustomEvent('hermesha:room:select', { detail: { room: roomKey } }));
    }
}

/** Set the task detail sub-view (overview/investigation/plan/changes/tests/evidence). */
export function setTaskView(taskView: TaskView) {
    setState({ taskView });
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
    const validViews: WorkView[] = ['tasks', 'discover', 'goals', 'planning', 'build'];
    if (validViews.includes(view as WorkView)) openWorkView(view as WorkView);
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
export function resetNavigation() {
    state = {
        workspace: 'home',
        workView: 'tasks',
        selectedTaskId: null,
        taskView: 'overview',
        activityFilter: 'all',
        conversationId: null,
        projectId: null,
    };
    notify();
}