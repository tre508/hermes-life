/**
 * UI-VIS-002: one logical system, seven visible roles.
 *
 * This module is the whole presentation mapping and it is deliberately pure: no DOM, no Phaser,
 * no network. The town is a *projection* of backend records and backend events — the backend
 * stays the source of truth, avatars carry no permissions, prompts, queues or authority, and a
 * role is only ever shown as working when an authoritative record or event says so.
 *
 * Rules that keep the picture honest:
 *  - Server records decide the baseline. Terminal records (completed / failed / superseded work)
 *    never animate: a resident with no in-flight operation is idle.
 *  - Live events are an overlay with an explicit, hand-written event table. An event that is not
 *    in the table marks the area "unknown" instead of guessing.
 *  - The overlay expires (working TTL) and terminal acknowledgements are short flashes, so a
 *    lost completion cannot leave a resident pretending to work forever.
 */

export type Role = 'coordinator' | 'researcher' | 'planner' | 'builder' | 'tester' | 'archivist' | 'reviewer';

export type Activity =
  | 'idle' | 'queued' | 'working' | 'waiting_approval' | 'completed' | 'failed' | 'blocked' | 'unknown';

export type LocationId =
  | 'town_square' | 'library' | 'planning_house' | 'workshop' | 'testing_lab' | 'archive' | 'review_office';

export type Connection = 'live' | 'reconnecting' | 'disconnected';

export interface TownLocation {
  id: LocationId;
  name: string;
  purpose: string;
  /** Existing dashboard view this building opens — no new destination is invented. */
  view: string;
}

/** One location per role, stable ids, drawn once and reused by the scene and the static fallback. */
export const TOWN_LOCATIONS: Readonly<Record<LocationId, TownLocation>> = Object.freeze({
  town_square: { id: 'town_square', name: 'Town Square', purpose: 'Coordination and dispatch: what Hermes is doing right now.', view: 'overview' },
  library: { id: 'library', name: 'Library', purpose: 'Discovery scans, curiosity questions and investigation research.', view: 'discovery' },
  planning_house: { id: 'planning_house', name: 'Planning House', purpose: 'Formulation and approved investigation plans.', view: 'planning' },
  workshop: { id: 'workshop', name: 'Workshop', purpose: 'Isolated candidate implementation and revisions.', view: 'build' },
  testing_lab: { id: 'testing_lab', name: 'Testing Lab', purpose: 'Baseline and candidate test runs, acceptance verification.', view: 'build' },
  archive: { id: 'archive', name: 'Archive', purpose: 'Memory extraction, reflection and recorded outcomes.', view: 'activity' },
  review_office: { id: 'review_office', name: 'Review Office', purpose: 'Candidate adjudication, revision requests and host application.', view: 'build' },
});

export interface ResidentBlueprint {
  role: Role;
  /** Display name only. Names identify an *area of the same system*, never a separate agent. */
  name: string;
  title: string;
  location: LocationId;
  accent: string;
}

export const ROSTER: Readonly<Record<Role, ResidentBlueprint>> = Object.freeze({
  coordinator: { role: 'coordinator', name: 'Hermes', title: 'Coordinator', location: 'town_square', accent: '#7fd4c1' },
  researcher: { role: 'researcher', name: 'Sage', title: 'Researcher', location: 'library', accent: '#6ec6e8' },
  planner: { role: 'planner', name: 'Piper', title: 'Planner', location: 'planning_house', accent: '#b79be0' },
  builder: { role: 'builder', name: 'Forge', title: 'Builder', location: 'workshop', accent: '#e8a45c' },
  tester: { role: 'tester', name: 'Patch', title: 'Tester', location: 'testing_lab', accent: '#e8d45c' },
  archivist: { role: 'archivist', name: 'Echo', title: 'Archivist', location: 'archive', accent: '#c9a37a' },
  reviewer: { role: 'reviewer', name: 'Vale', title: 'Reviewer', location: 'review_office', accent: '#8fd48f' },
});

export const ROLES: readonly Role[] = Object.freeze(
  ['coordinator', 'researcher', 'planner', 'builder', 'tester', 'archivist', 'reviewer'] as Role[]);

export interface Resident {
  role: Role;
  name: string;
  state: Activity;
  /** Short factual phrase, e.g. "Implementing hermes-life". Never a claim about unseen work. */
  label: string;
  location: LocationId;
  project: string | null;
  workflowId: string | null;
  taskId: string | null;
  eventType: string | null;
  sequence: number | null;
  observedAt: number;
  source: 'records' | 'event';
}

export interface TownState {
  connection: Connection;
  /** True while a chat task is executing: the only time tool events may animate the coordinator. */
  taskRunning: boolean;
  residents: Record<Role, Resident>;
  counts: { working: number; waiting: number; finished: number; failed: number };
  /** Event types the table does not know about: shown, never guessed at. */
  unknownEvents: string[];
  observedAt: number | null;
  serverAt: string | null;
  lastSequence: number | null;
  /** Record-derived rows kept alongside the live overlay so an expiring claim has a fallback. */
  baseline?: Record<Role, Resident>;
}

export interface BackendEvent {
  sequence: number;
  type: string;
  task_id?: string | null;
  timestamp?: string;
  payload?: Record<string, unknown>;
}

/** Raw read-only rows. Loose typing on purpose: the backend shapes are broader than the town needs. */
export interface Row { [key: string]: any }

export interface Signals {
  tasks?: Row[] | null;
  agent?: Row | null;
  goals?: Row[] | null;
  plans?: Row[] | null;
  runs?: Row[] | null;
  memoryReviews?: Row[] | null;
  /** review-state of the most recent run (authoritative adjudication status). */
  latestReview?: Row | null;
  /** verification row of the most recent run, when one exists. */
  latestVerification?: Row | null;
}

/** How long an event-derived "working" claim may stand without a newer authoritative signal. */
export const WORKING_TTL_MS = 180_000;
/** Terminal outcomes are acknowledged briefly, then the record-derived state returns. */
export const TERMINAL_FLASH_MS = 9_000;
/**
 * A reconnect re-streams the event log from the last cursor. Events older than the snapshot the
 * town just read are history, not activity: they may advance the cursor but must never animate.
 */
export const REPLAY_GRACE_MS = 5_000;
export const UNKNOWN_LIMIT = 4;

// --------------------------------------------------------------------------- event table

/**
 * Event-name → area of the system. Written from the real emitted vocabulary
 * (grep 'emit(' over hermes_life/*.py), not from a generic guess.
 */
const EVENT_RULES: ReadonlyArray<[RegExp, Role]> = [
  [/^task\./, 'coordinator'],
  [/^(autonomy|decision|maintenance)\./, 'coordinator'],
  [/^goal\./, 'researcher'],
  [/^(discovery|curiosity|study)\./, 'researcher'],
  [/^(formulation|investigation)\./, 'planner'],
  [/^implementation\.(started|revision_|environment_)/, 'builder'],
  [/^implementation\.(evaluated|reevaluation_)/, 'tester'],
  [/^implementation\.(applied|apply_|review_)/, 'reviewer'],
  [/^implementation\./, 'builder'],
  [/^verification\.(auto_revision_queued|auto_revision_failed)/, 'builder'],
  [/^verification\./, 'tester'],
  [/^(memory|reflection|personality)\./, 'archivist'],
];

/**
 * Agent-runtime stream events. They describe the tool/text output of a running task and are
 * consumed by the existing status strip (main.ts eventStatus). They belong to no workflow stage,
 * so they are deliberately excluded rather than reported as "unmapped".
 */
const RUNTIME_EVENTS = /^hermes\.(text|system|tool_use|tool_result|result)$/;

/**
 * Which building the coordinator is working in, from the tool that is running right now. Only the
 * tool NAME is read (never the payload contents), and an unrecognised tool keeps him where he is
 * rather than inventing a destination. This is what makes the town move while a task executes:
 * a real tool call is a real activity, so it is shown at the building that activity belongs to.
 */
const TOOL_LOCATIONS: ReadonlyArray<[RegExp, LocationId]> = [
  [/read_file|read|grep|glob|search|docs|doc|web|browse|fetch|arxiv|source|study|cat$|ls$|find/i, 'library'],
  [/write_file|edit|patch|apply|git|compile|build|make|npm|cargo|revision|write/i, 'workshop'],
  [/pytest|test|verify|evaluate|benchmark|ctest|check|lint/i, 'testing_lab'],
  [/memory|recall|vault|reflect|personality|lesson|archive|note/i, 'archive'],
  [/plan|goal|formulate|criteria|approve|review/i, 'review_office'],
];

export function toolLocation(payload: Record<string, unknown> = {}): LocationId | null {
  const name = [payload.tool_name, payload.tool, payload.name].find(value => typeof value === 'string');
  if (typeof name !== 'string' || !name) return null;
  for (const [pattern, location] of TOOL_LOCATIONS) if (pattern.test(name)) return location;
  return null;
}

export function toolName(payload: Record<string, unknown> = {}): string | null {
  const name = [payload.tool_name, payload.tool, payload.name].find(value => typeof value === 'string');
  return typeof name === 'string' && name ? name : null;
}

const WORKING_SUFFIX = /(started|running)$/;
const QUEUED_SUFFIX = /(queued|requested|created|proposed|selected|enabled|reopened|retry|pending)$/;
const FAILED_SUFFIX = /(failed|error|blocked|interrupted|recovery_required|rolled_back|stopped)$/;
const COMPLETED_SUFFIX = /(completed|summary|recorded|decided|applied|compiled|ready|passed|corrected|pruned|deleted|resumed|hydrated)$/;

/** Suffix → activity. Unknown suffixes are 'unknown': the town does not invent activity. */
export function stateForEventType(type: string): Activity {
  const tail = type.split('.').pop() || '';
  if (WORKING_SUFFIX.test(tail)) return 'working';
  if (FAILED_SUFFIX.test(tail)) return 'failed';
  if (QUEUED_SUFFIX.test(tail)) return 'queued';
  if (COMPLETED_SUFFIX.test(tail)) return 'completed';
  return 'unknown';
}

/** Which area acts on this event. `autonomousTask` is true when the event's task belongs to a goal. */
export function roleForEvent(type: string, payload: Record<string, unknown> = {}, autonomousTask = false): Role | null {
  if (type.startsWith('task.')) {
    // A read-only task is an investigation (the Researcher's work); an interactive task is the
    // user's chat task (the Coordinator's work). Both are emitted as task.*.
    const scope = typeof payload.scope === 'string' ? payload.scope : '';
    if (scope === 'read_only' || (scope === '' && autonomousTask)) return 'researcher';
    return 'coordinator';
  }
  for (const [pattern, role] of EVENT_RULES) if (pattern.test(type)) return role;
  return null;
}

const EVENT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'task.queued': 'Task queued', 'task.started': 'Running the requested task', 'task.completed': 'Task finished',
  'task.failed': 'Task failed', 'task.cancelled': 'Task cancelled',
  'goal.queued': 'Investigation queued', 'goal.selected': 'Chose the next goal', 'goal.created': 'Goal recorded',
  'discovery.scan_completed': 'Project scan finished', 'discovery.proposed': 'Finding proposed',
  'curiosity.investigation_requested': 'Curiosity question promoted',
  'formulation.started': 'Formulating a proposal', 'formulation.proposed': 'Proposal drafted',
  'investigation.plan_started': 'Writing the investigation plan', 'investigation.plan_completed': 'Plan drafted',
  'investigation.plan_approved': 'Plan approved',
  'implementation.started': 'Implementing in the isolated workspace',
  'implementation.environment_ready': 'Workspace prepared', 'implementation.evaluated': 'Candidate evaluated',
  'implementation.failed': 'Build failed', 'implementation.review_decided': 'Review decision recorded',
  'implementation.revision_queued': 'Revision queued', 'implementation.revision_started': 'Revising the candidate',
  'implementation.revision_completed': 'Revision finished', 'implementation.revision_failed': 'Revision failed',
  'implementation.applied': 'Applied to the host project', 'implementation.apply_blocked': 'Host apply blocked',
  'verification.started': 'Verifying acceptance criteria', 'verification.completed': 'Verification finished',
  'verification.failed': 'Verification failed', 'verification.criteria_compiled': 'Criteria compiled',
  'verification.auto_revision_queued': 'Automatic revision queued',
  'memory.extraction_summary': 'Memory extracted', 'memory.extraction_failed': 'Memory extraction failed',
  'reflection.recorded': 'Reflection recorded', 'personality.profile_corrected': 'Profile corrected',
});

export function labelForEvent(type: string): string {
  return EVENT_LABELS[type] || type.split('.').pop()!.replace(/_/g, ' ');
}

function id8(value: unknown): string | null {
  return typeof value === 'string' && value ? value.slice(0, 8) : null;
}

function truncate(value: unknown, limit = 46): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}

// --------------------------------------------------------------------------- construction

function resident(role: Role, state: Activity, label: string, now: number,
                 extra: Partial<Resident> = {}): Resident {
  const blueprint = ROSTER[role];
  return {
    role, name: blueprint.name, state, label, location: extra.location || blueprint.location,
    project: extra.project ?? null, workflowId: extra.workflowId ?? null, taskId: extra.taskId ?? null,
    eventType: extra.eventType ?? null, sequence: extra.sequence ?? null,
    observedAt: extra.observedAt ?? now, source: extra.source || 'records',
  };
}

export function emptyTown(now = Date.now()): TownState {
  const residents = {} as Record<Role, Resident>;
  for (const role of ROLES) residents[role] = resident(role, 'idle', 'Waiting', now);
  return {
    connection: 'disconnected', taskRunning: false, residents,
    counts: { working: 0, waiting: 0, finished: 0, failed: 0 },
    unknownEvents: [], observedAt: null, serverAt: null, lastSequence: null,
  };
}

function byNewest(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => String(b.created_at || b.started_at || '').localeCompare(String(a.created_at || a.started_at || '')));
}

const IN_FLIGHT = ['queued', 'running', 'pending', 'retry', 'preparing', 'testing_baseline', 'implementing', 'evaluating'];

/**
 * Baseline from persisted records only. Every in-flight state here is backed by a row that says
 * so; everything else is idle. Completed history produces no motion.
 */
export function deriveFromRecords(signals: Signals, now = Date.now()): Record<Role, Resident> {
  const tasks = signals.tasks || [];
  const goals = signals.goals || [];
  const plans = signals.plans || [];
  const runs = byNewest(signals.runs || []);
  const reviews = signals.memoryReviews || [];
  const out = {} as Record<Role, Resident>;

  // Coordinator — the user's own task, i.e. anything that is not an investigation goal's task.
  const agent = signals.agent || {};
  const currentId = typeof agent.current_task === 'string' ? agent.current_task : null;
  const current = currentId ? tasks.find(t => t.id === currentId) || null : null;
  const owns = (task: Row | null) => !!task && goals.some(g => g.task_id === task.id);
  const queued = tasks.filter(t => t.state === 'queued');
  if (current && agent.state === 'executing' && !owns(current)) {
    out.coordinator = resident('coordinator', 'working', 'Running your task ' + (id8(current.id) || ''), now,
      { taskId: current.id, workflowId: current.id });
  } else if (queued.length) {
    const task = queued[queued.length - 1];
    out.coordinator = resident('coordinator', 'queued', queued.length === 1 ? 'Task queued' : queued.length + ' tasks queued', now,
      { taskId: task.id });
  } else {
    out.coordinator = resident('coordinator', 'idle', 'No task running', now,
      { taskId: current && owns(current) ? current.id : null });
  }

  // Researcher — autonomous goals and their investigations.
  const open = goals.filter(g => IN_FLIGHT.includes(String(g.state)));
  const running = open.find(g => g.state === 'running');
  if (running) {
    out.researcher = resident('researcher', 'working',
      'Investigating: ' + (truncate(running.title) || (id8(running.id) || 'goal')), now,
      { project: running.project || null, workflowId: running.id, taskId: running.task_id || null });
  } else if (open.length) {
    out.researcher = resident('researcher', 'queued', open.length === 1 ? 'Investigation queued' : open.length + ' investigations queued', now,
      { workflowId: open[open.length - 1].id });
  } else {
    out.researcher = resident('researcher', 'idle', 'No open investigation', now);
  }

  // Planner — a drafted plan is a human gate, not activity.
  const proposed = plans.filter(p => p.state === 'proposed');
  const drafting = plans.find(p => IN_FLIGHT.includes(String(p.state)) && p.state !== 'proposed');
  if (drafting) {
    out.planner = resident('planner', 'working', 'Drafting the investigation plan', now, { workflowId: drafting.id, project: drafting.project || null });
  } else if (proposed.length) {
    out.planner = resident('planner', 'waiting_approval',
      (proposed.length === 1 ? 'Plan awaiting your approval' : proposed.length + ' plans awaiting your approval'), now,
      { workflowId: proposed[proposed.length - 1].id, project: proposed[proposed.length - 1].project || null });
  } else {
    out.planner = resident('planner', 'idle', 'No plan in progress', now);
  }

  // Builder / Tester / Reviewer all read the same most-recent implementation run.
  const run = runs[0] || null;
  if (!run) {
    out.builder = resident('builder', 'idle', 'No candidate build', now);
    out.tester = resident('tester', 'idle', 'No run to test', now);
    out.reviewer = resident('reviewer', 'idle', 'Nothing awaiting review', now);
  } else {
    const project = run.project || null;
    const where = project ? ' in ' + project : '';
    const runState = String(run.state);
    const revision = (run.revisions || [])[0] || null;
    const revisionState = revision ? String(revision.state) : '';
    if (revisionState === 'running') {
      out.builder = resident('builder', 'working', 'Revising the candidate' + where, now, { project, workflowId: run.id });
    } else if (revisionState === 'queued') {
      out.builder = resident('builder', 'queued', 'Revision queued', now, { project, workflowId: run.id });
    } else if (runState === 'preparing' || runState === 'implementing') {
      out.builder = resident('builder', 'working', 'Implementing' + where, now, { project, workflowId: run.id });
    } else if (runState === 'failed') {
      out.builder = resident('builder', 'failed', 'Build failed' + where, now, { project, workflowId: run.id });
    } else if (runState === 'interrupted') {
      out.builder = resident('builder', 'blocked', 'Build interrupted', now, { project, workflowId: run.id });
    } else if (revisionState === 'failed') {
      out.builder = resident('builder', 'failed', 'Revision failed' + where, now, { project, workflowId: run.id });
    } else {
      out.builder = resident('builder', 'idle', 'No candidate being written', now, { project, workflowId: run.id });
    }

    const verification = signals.latestVerification || null;
    const verificationState = verification ? String(verification.state || verification.status || '') : '';
    if (runState === 'testing_baseline') {
      out.tester = resident('tester', 'working', 'Testing the baseline' + where, now, { project, workflowId: run.id });
    } else if (runState === 'evaluating') {
      out.tester = resident('tester', 'working', 'Testing the candidate' + where, now, { project, workflowId: run.id });
    } else if (verificationState === 'running') {
      out.tester = resident('tester', 'working', 'Verifying acceptance criteria', now, { project, workflowId: run.id });
    } else if (runState === 'candidate_passed') {
      out.tester = resident('tester', 'completed', 'Candidate tests passed', now, { project, workflowId: run.id });
    } else if (runState === 'candidate_failed') {
      out.tester = resident('tester', 'failed', 'Candidate tests failed', now, { project, workflowId: run.id });
    } else if (runState === 'evaluation_error') {
      out.tester = resident('tester', 'blocked', 'Evaluation error', now, { project, workflowId: run.id });
    } else {
      out.tester = resident('tester', 'idle', 'No test running', now, { project, workflowId: run.id });
    }

    const decision = signals.latestReview && typeof signals.latestReview.decision === 'string'
      ? signals.latestReview.decision : null;
    const reviewable = ['candidate_passed', 'candidate_failed', 'evaluation_error'].includes(runState);
    if (decision === 'accepted') {
      out.reviewer = resident('reviewer', 'completed', 'Candidate accepted' + where, now, { project, workflowId: run.id });
    } else if (decision === 'rejected') {
      out.reviewer = resident('reviewer', 'completed', 'Candidate rejected', now, { project, workflowId: run.id });
    } else if (decision === 'revision_requested') {
      out.reviewer = resident('reviewer', 'idle', 'Revision requested', now, { project, workflowId: run.id });
    } else if (reviewable) {
      out.reviewer = resident('reviewer', 'waiting_approval', 'Candidate awaiting your review', now, { project, workflowId: run.id });
    } else {
      out.reviewer = resident('reviewer', 'idle', 'Nothing awaiting review', now, { project, workflowId: run.id });
    }
  }

  // Archivist — pending memory reviews are a gate; extraction itself is only observable by event.
  const pending = reviews.filter(r => ['pending', 'open', 'proposed'].includes(String(r.state || r.status || '')));
  out.archivist = pending.length
    ? resident('archivist', 'waiting_approval', pending.length + ' memory review(s) pending', now)
    : resident('archivist', 'idle', 'Memory up to date', now);

  return out;
}

/** A chat task is executing: the coordinator is the resident on duty for it. */
export function chatTaskRunning(signals: Signals): boolean {
  const agent = signals.agent || {};
  if (agent.state !== 'executing') return false;
  const currentId = typeof agent.current_task === 'string' ? agent.current_task : null;
  if (!currentId) return false;
  const goals = signals.goals || [];
  return !goals.some(goal => goal.task_id === currentId);
}

export function countsFor(signals: Signals, residents: Record<Role, Resident>,
                          now = Date.now()): TownState['counts'] {
  const goals = signals.goals || [];
  const runs = signals.runs || [];
  const values = Object.values(residents);
  return {
    working: values.filter(r => r.state === 'working').length,
    waiting: values.filter(r => r.state === 'waiting_approval').length,
    finished: goals.filter(g => g.state === 'completed').length,
    failed: goals.filter(g => g.state === 'failed' || g.state === 'interrupted').length
      + runs.filter(r => ['failed', 'candidate_failed', 'evaluation_error'].includes(String(r.state))).length,
  };
}

export interface SignalsAndMeta { signals: Signals; serverAt?: string | null }

/** Full baseline from the server. `previous` keeps the connection banner and unknown-event list. */
export function projectServerState(signals: Signals, now = Date.now(), previous?: TownState | null,
                                   connection: Connection = previous?.connection || 'live'): TownState {
  const residents = deriveFromRecords(signals, now);
  return {
    connection,
    taskRunning: chatTaskRunning(signals),
    residents,
    counts: countsFor(signals, residents, now),
    unknownEvents: (previous?.unknownEvents || []).slice(0, UNKNOWN_LIMIT),
    observedAt: now,
    serverAt: signals.agent?.updated_at || signals.agent?.timestamp || null,
    lastSequence: previous?.lastSequence ?? null,
  };
}

// --------------------------------------------------------------------------- event overlay

function flashUntil(state: Activity): number {
  return state === 'working' ? WORKING_TTL_MS : TERMINAL_FLASH_MS;
}

/**
 * Apply one authoritative event. Out-of-order and duplicate events are ignored; terminal
 * acknowledgements expire on their own so the record-derived baseline comes back.
 */
export function applyEvent(state: TownState, event: BackendEvent, autonomousTask = false,
                           now = Date.now()): TownState {
  if (typeof event?.sequence !== 'number' || !event.type) return state;
  if (state.lastSequence !== null && event.sequence <= state.lastSequence) return state;

  const payload = event.payload || {};
  const role = roleForEvent(event.type, payload, autonomousTask);
  const activity = stateForEventType(event.type);
  const next: TownState = { ...state, residents: { ...state.residents }, lastSequence: event.sequence };

  // History, not activity: the event log replays on every reconnect, and a stale
  // `task.started` must not put the coordinator to work hours later.
  const at = event.timestamp ? Date.parse(event.timestamp) : Number.NaN;
  if (state.observedAt && Number.isFinite(at) && at < state.observedAt - REPLAY_GRACE_MS) return next;

  if (RUNTIME_EVENTS.test(event.type)) {
    // Tool output only means something while a task is genuinely executing; the record baseline
    // already covers an executing chat task, and tool events move him to the building he is in.
    if (!next.taskRunning) return next;
    if (event.type === 'hermes.tool_use' || event.type === 'hermes.tool_result') {
      const name = toolName(payload);
      const location = toolLocation(payload) || state.residents.coordinator.location;
      next.residents.coordinator = {
        ...state.residents.coordinator,
        state: 'working',
        label: name ? `Using ${name}` : 'Running a tool',
        location,
        eventType: event.type, sequence: event.sequence, observedAt: now, source: 'event',
        taskId: event.task_id ?? state.residents.coordinator.taskId,
      };
      next.counts = { ...state.counts, ...recount(next.residents) };
      next.observedAt = now;
    }
    return next;
  }
  // Task lifecycle decides whether tool traffic is allowed to animate the coordinator.
  if (event.type === 'task.queued' || event.type === 'task.started') next.taskRunning = true;
  if (event.type === 'task.completed' || event.type === 'task.failed' || event.type === 'task.cancelled') {
    next.taskRunning = false;
  }

  if (!role || activity === 'unknown') {
    const unknownEvents = [event.type, ...state.unknownEvents.filter(t => t !== event.type)].slice(0, UNKNOWN_LIMIT);
    return { ...next, unknownEvents };
  }

  const label = labelForEvent(event.type)
    + (typeof payload.project === 'string' && payload.project ? ' · ' + payload.project : '');
  next.residents[role] = {
    ...state.residents[role],
    state: activity, label, eventType: event.type, sequence: event.sequence, observedAt: now, source: 'event',
    taskId: event.task_id ?? state.residents[role].taskId,
    workflowId: id8(payload.run_id || payload.plan_id || payload.goal_id || payload.discovery_id) || state.residents[role].workflowId,
    project: typeof payload.project === 'string' ? payload.project : state.residents[role].project,
  };
  next.observedAt = now;
  next.counts = { ...state.counts, ...recount(next.residents) };
  return next;
}

/** The overlay decays: a working claim expires, then the server baseline shows through again. */
export function expireOverlays(state: TownState, now = Date.now()): TownState {
  let changed = false;
  const residents = { ...state.residents };
  for (const role of ROLES) {
    const current = residents[role];
    if (current.source !== 'event') continue;
    if (now - current.observedAt < flashUntil(current.state)) continue;
    const baseline = state.baseline?.[role];
    residents[role] = baseline ? { ...baseline } : { ...current, state: 'idle', source: 'records', label: 'Waiting for a backend signal' };
    changed = true;
  }
  if (!changed) return state;
  return { ...state, residents, counts: { ...state.counts, ...recount(residents) } };
}

function recount(residents: Record<Role, Resident>): Pick<TownState['counts'], 'working' | 'waiting'> {
  const values = Object.values(residents);
  return {
    working: values.filter(r => r.state === 'working').length,
    waiting: values.filter(r => r.state === 'waiting_approval').length,
  };
}

export function withBaseline(state: TownState, signals: Signals, now = Date.now()): TownState {
  const baseline = deriveFromRecords(signals, now);
  const residents = { ...baseline } as Record<Role, Resident>;
  // Records decide the baseline, but a refresh must not wipe live detail they do not carry: while
  // a chat task runs, only the event stream knows which building the current tool belongs to.
  for (const role of ROLES) {
    const live = state.residents[role];
    if (!live || live.source !== 'event') continue;
    if (now - live.observedAt >= flashUntil(live.state)) continue;              // overlay expired
    const records = baseline[role];
    // Only an actively working role keeps its live detail: once the records go quiet, the record
    // state (home station, idle) is the truth and the overlay is dropped.
    if (records.state !== 'working') continue;
    residents[role] = {
      ...records,
      state: live.state === 'working' ? 'working' : live.state,
      label: live.label, location: live.location, eventType: live.eventType,
      sequence: live.sequence, observedAt: live.observedAt, source: 'event',
    };
  }
  return {
    ...state, baseline, residents, counts: countsFor(signals, residents, now),
    taskRunning: chatTaskRunning(signals), observedAt: now,
  };
}

/** True when this event type is handled by design and must not be reported as unmapped. */
export function isRuntimeEvent(type: string): boolean { return RUNTIME_EVENTS.test(type); }

export function setConnection(state: TownState, connection: Connection): TownState {
  return state.connection === connection ? state : { ...state, connection };
}

// --------------------------------------------------------------------------- presentation text

export const ACTIVITY_WORDS: Readonly<Record<Activity, string>> = Object.freeze({
  idle: 'idle', queued: 'queued', working: 'working', waiting_approval: 'waiting for you',
  completed: 'finished', failed: 'failed', blocked: 'blocked', unknown: 'unknown',
});

/** One bounded sentence for the status strip: what Hermes is doing, and what waits on a human. */
export function summarize(state: TownState): string {
  const busy = ROLES.map(r => state.residents[r]).filter(r => r.state === 'working' || r.state === 'queued');
  const waiting = ROLES.map(r => state.residents[r]).filter(r => r.state === 'waiting_approval');
  const parts: string[] = [];
  if (busy.length) parts.push(busy.map(r => r.name + ' ' + r.label.toLowerCase()).join(' · '));
  else parts.push('No role is working');
  if (waiting.length) parts.push('waiting on you: ' + waiting.map(r => ROSTER[r.role].title.toLowerCase()).join(', '));
  if (state.unknownEvents.length) parts.push('unmapped events: ' + state.unknownEvents.join(', '));
  return parts.join(' | ');
}

export function busyResident(state: TownState): Resident | null {
  for (const role of ROLES) {
    const r = state.residents[role];
    if (r.state === 'working' || r.state === 'queued') return r;
  }
  return null;
}

/** Where a resident walks to: its own building, plus the square when it has nothing to do. */
export function idleLocation(role: Role): LocationId {
  return role === 'coordinator' ? 'town_square' : ROSTER[role].location;
}
