/**
 * UI-VIS-002: mounts the town and keeps it tied to the backend.
 *
 * Responsibilities, all of them read-only:
 *  - one bounded snapshot poll of existing endpoints (records are the authority for the baseline)
 *  - one subscription to the app's existing event stream (the live overlay)
 *  - a connection banner, a bounded summary, a resident popover and a static fallback
 *
 * It never writes to the backend, never persists avatar positions, and never invents activity:
 * a role is drawn as working only while an authoritative record or event says so.
 */
import './town.css';
import { createTownRenderer, prefersReducedMotion, type TownRenderer } from './town-renderer';
import {
  type Activity, type Connection, type LocationId, type Role, type Signals, type TownState,
  ACTIVITY_WORDS, ROLES, ROSTER, TOWN_LOCATIONS, applyEvent, emptyTown, expireOverlays,
  projectServerState, setConnection, summarize, withBaseline,
} from './town-model';
import { locationLabel, locationPurpose } from './town-vocabulary';
import { BubbleController } from './town-world/bubbles';
import { roomForRole } from './town-world/ship-rooms';
import './town-world/bubbles.css';

const REFRESH_MS = 20_000;
const MOTION_KEY = 'hermes-life-town-motion';

let renderer: TownRenderer | null = null;
let town: TownState = emptyTown();
let motion = true;
let lostAt: number | null = null;
let refreshing = false;
let refreshQueued: ReturnType<typeof setTimeout> | undefined;
/** Task ids owned by an investigation goal, from the last authoritative snapshot. */
const goalTasks = new Set<string>();
let ui: Ui | null = null;
let bubbleController: BubbleController | null = null;

interface Ui {
  connection: HTMLElement;
  summary: HTMLElement;
  counts: HTMLElement;
  board: HTMLDetailsElement;
  rows: HTMLElement;
  motion: HTMLButtonElement;
  selection: HTMLElement;
  /** §11: recent bubble activity viewer (presentation cache). */
  bubbleHistory: HTMLDetailsElement;
  bubbleHistoryList: HTMLElement;
  /** The HUD block this module owns, and the third-party banner it borrows while mounted. */
  wrap: HTMLElement;
  banner: HTMLElement | null;
  bannerHome: Element | null;
}

/**
 * Undo for the current mount. A second `installTown()` (a remount, a hot reload, a re-mount after a
 * container swap) runs this first, so no listener, timer, RAF handle or WebGL context is ever
 * stacked twice (acceptance criterion 16).
 */
let unmount: (() => void) | null = null;

// --------------------------------------------------------------------------- mounting

export function installTown(): void {
  const host = document.getElementById('game');
  if (!host) return;
  // A remount replaces the previous mount rather than layering on top of it.
  unmount?.();
  const undo: Array<() => void> = [];
  const listen = (target: EventTarget, type: string, handler: EventListener) => {
    target.addEventListener(type, handler);
    undo.push(() => target.removeEventListener(type, handler));
  };
  const every = (ms: number, handler: () => void) => {
    const id = window.setInterval(handler, ms);
    undo.push(() => window.clearInterval(id));
  };
  const after = (ms: number, handler: () => void) => {
    const id = window.setTimeout(handler, ms);
    undo.push(() => window.clearTimeout(id));
  };

  motion = storedMotion();
  ui = buildUi(host);
  host.classList.add('town');
  // One factory call: the 3D facility when the client can run it, the static label view otherwise.
  renderer = createTownRenderer(host, { motion });
  // Honour the initial preference explicitly: a frozen camera, no movement, labels intact.
  if (!motion) {
    host.classList.add('town-still');
    renderer.setMotion(false);
  }

  // Initialize bubble controller (UI-VIS-007)
  bubbleController = new BubbleController();
  bubbleController.initialize(host, renderer);
  // §11: populate the recent-bubble history when the fold is opened.
  const hud = ui;
  listen(hud.bubbleHistory, 'toggle', () => {
    if (hud.bubbleHistory.open) bubbleController?.renderHistoryInto(hud.bubbleHistoryList);
  });

  listen(window, 'hermes:event', event => onEvent((event as CustomEvent).detail));
  listen(window, 'hermes:connection', event => {
    const status = (event as CustomEvent<{ status: Connection }>).detail?.status || 'disconnected';
    if (status !== 'live' && town.connection === 'live') lostAt = Date.now();
    if (status === 'live') lostAt = null;
    town = setConnection(town, status);
    if (status === 'live') void refresh();
    renderUi();
  });
  listen(window, 'town:select', event => showResident((event as CustomEvent<{ role: Role }>).detail?.role));
  listen(window, 'town:building', event => showBuilding((event as CustomEvent<{ location: LocationId }>).detail?.location));

  listen(ui.motion, 'click', () => {
    motion = !motion;
    window.localStorage.setItem(MOTION_KEY, motion ? 'on' : 'off');
    renderer?.setMotion(motion);
    document.getElementById('game')?.classList.toggle('town-still', !motion);
    renderUi();
  });
  // An element this module does not own: its listener must come off again on a remount.
  const closeRoom = document.getElementById('world-room-close');
  if (closeRoom) listen(closeRoom, 'click', () => ui?.selection.replaceChildren());

  // A visible tab polls; a hidden one keeps its last authoritative picture instead.
  every(REFRESH_MS, () => { if (!document.hidden) void refresh(); });
  // Flash expiry runs on its own short tick, so an acknowledgement cannot outlive its window.
  every(1000, () => {
    const expired = expireOverlays(town);
    if (expired !== town) { town = expired; renderer?.applyState(town); renderUi(); }
  });
  listen(document, 'visibilitychange', () => { if (!document.hidden) void refresh(); });
  // Layout CSS settles after the renderer is constructed, and the container resizes without a window
  // resize event: re-measure a few times so the viewport matches the real box.
  const remeasure = () => renderer?.resize();
  listen(window, 'resize', remeasure);
  const raf = window.requestAnimationFrame(remeasure);
  undo.push(() => window.cancelAnimationFrame(raf));
  after(150, remeasure);
  after(600, remeasure);
  (window as unknown as { __hermesTown?: unknown }).__hermesTown = {
    state: () => town,
    refresh: () => refresh(true),
    setMotion: (value: boolean) => {
      renderer?.setMotion(value);
      motion = value;
      // Same effect as the motion button, so the verification setter cannot leave a half-applied state.
      document.getElementById('game')?.classList.toggle('town-still', !value);
      renderUi();
    },
    motion: () => motion,
    summarize: () => summarize(town),
    /** Renders drawn: proves the world is alive without reading pixels. */
    frames: () => renderer?.frames() ?? -1,
    positions: () => renderer?.positions() ?? [],
    /** Which renderer is active: '3d', or 'static' where WebGL is unavailable. */
    renderer: () => renderer?.kind ?? null,
    /** Introspection for verification only: the live renderer, never used by the UI. */
    _renderer: () => renderer,
    /** Mount bookkeeping for verification: a remount must not stack subscriptions. */
    _listeners: () => undo.length,
  };

  unmount = () => {
    clearTimeout(refreshQueued);
    for (const off of undo) off();
    undo.length = 0;
    renderer?.destroy();
    renderer = null;
    // Destroy bubble controller (UI-VIS-007)
    bubbleController?.destroy();
    bubbleController = null;
    // The live-status banner belongs to another phase: put it back before dropping the HUD block.
    if (ui?.banner && ui.bannerHome) ui.bannerHome.append(ui.banner);
    ui?.wrap.remove();
    ui?.selection.remove();
    ui = null;
    document.getElementById('game')?.classList.remove('town', 'town-still');
    delete (window as unknown as { __hermesTown?: unknown }).__hermesTown;
  };

  void refresh();
}

function storedMotion(): boolean {
  const stored = window.localStorage.getItem(MOTION_KEY);
  if (stored === 'on') return true;
  if (stored === 'off') return false;
  return !prefersReducedMotion();
}

function buildUi(host: HTMLElement): Ui {
  // The status block goes under the canvas (sibling of #game); only the resident popover overlays
  // the art, because it is anchored to a click and is dismissible.
  const stage = host.closest('.world-wrap') || host.parentElement || host;
  const wrap = document.createElement('div');
  wrap.className = 'town-hud';
  wrap.innerHTML = [
    '<div class="town-hud-left">',
    '<p class="town-line"><span id="town-connection" class="town-conn">Connecting…</span>',
    ' <span id="town-counts" class="town-counts"></span></p>',
    '<p id="town-summary" class="town-summary" role="status" aria-live="polite">Reading backend records…</p>',
    '<details id="town-board" class="town-board"><summary>All roles (text view)</summary>',
    '<div id="town-rows" class="town-rows"></div></details>',
    '<details id="town-bubble-history" class="town-bubble-history"><summary>Recent bubble activity</summary>',
    '<div id="town-bubble-history-list" class="town-bubble-history__list"></div>',
    '</details>',
    '</div>',
    '<div class="town-hud-right"><button id="town-motion" type="button" aria-pressed="false">Motion: on</button></div>',
  ].join('');
  // The phase-4.6 live status banner was absolutely positioned inside #game, where it covered the
  // top of the town (the Archive and its neighbours). It keeps its element and behaviour but now
  // sits with the town status block, outside the art.
  const banner = document.querySelector<HTMLElement>('.hermes-live-status');
  const bannerHome = banner?.parentElement ?? null;
  if (banner) wrap.querySelector('.town-hud-left')?.prepend(banner);
  stage.append(wrap);
  const selection = document.createElement('aside');
  selection.id = 'town-selection';
  selection.className = 'town-selection';
  selection.hidden = true;
  selection.setAttribute('role', 'dialog');
  selection.setAttribute('aria-label', 'Role detail');
  host.append(selection);
  return {
    connection: wrap.querySelector('#town-connection')!,
    summary: wrap.querySelector('#town-summary')!,
    counts: wrap.querySelector('#town-counts')!,
    board: wrap.querySelector('#town-board')!,
    rows: wrap.querySelector('#town-rows')!,
    motion: wrap.querySelector('#town-motion')!,
    selection,
    bubbleHistory: wrap.querySelector('#town-bubble-history')!,
    bubbleHistoryList: wrap.querySelector('#town-bubble-history-list')!,
    wrap, banner, bannerHome,
  };
}

// --------------------------------------------------------------------------- backend reads

function byNewest(rows: Array<Record<string, any>>): Array<Record<string, any>> {
  return [...rows].sort((a, b) => String(b.created_at || b.started_at || '').localeCompare(String(a.created_at || a.started_at || '')));
}

async function read<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json() as T;
  } catch (error) {
    console.warn('town: cannot read', path, error);
    return null;
  }
}

/** One bounded snapshot: the endpoints the town actually needs, including the newest run's gate. */
async function fetchSignals(): Promise<Signals | null> {
  const [tasks, agent, goals, plans, runs, reviews] = await Promise.all([
    read<Array<Record<string, any>>>('/api/tasks'),
    read<Record<string, any>>('/api/agent/state'),
    read<Array<Record<string, any>>>('/api/goals'),
    read<Array<Record<string, any>>>('/api/investigation-plans'),
    read<Array<Record<string, any>>>('/api/implementations'),
    read<{ reviews?: Array<Record<string, any>> } | Array<Record<string, any>>>('/api/memory-reviews'),
  ]);
  if (tasks === null && goals === null && runs === null) return null;   // backend unreachable
  const signals: Signals = {
    tasks, agent, goals, plans, runs,
    memoryReviews: Array.isArray(reviews) ? reviews : (reviews?.reviews || []),
  };
  const newest = byNewest(runs || [])[0];
  if (newest) {
    const revisions = await read<{ attempts?: Array<Record<string, any>> } | Array<Record<string, any>>>(
      `/api/implementations/${encodeURIComponent(newest.id)}/revisions`);
    const attempts = Array.isArray(revisions) ? revisions : (revisions?.attempts || []);
    signals.runs = (runs || []).map(run => run.id === newest.id ? { ...run, revisions: attempts } : run);
    const reviewable = ['candidate_passed', 'candidate_failed', 'evaluation_error'].includes(String(newest.state))
      || attempts.some(a => ['queued', 'running'].includes(String(a.state)));
    if (reviewable) {
      signals.latestReview = await read<Record<string, any>>(
        `/api/implementations/${encodeURIComponent(newest.id)}/review-state`);
      const report = await read<Record<string, any>>(
        `/api/implementations/${encodeURIComponent(newest.id)}/verification`);
      signals.latestVerification = report && typeof report === 'object' && report.state ? report : null;
    }
  }
  return signals;
}

export async function refresh(force = false): Promise<TownState> {
  if (refreshing && !force) return town;
  refreshing = true;
  try {
    const signals = await fetchSignals();
    if (signals) {
      goalTasks.clear();
      for (const goal of signals.goals || []) if (typeof goal.task_id === 'string') goalTasks.add(goal.task_id);
      town = setConnection(town, lostAt ? 'reconnecting' : 'live');
      town = withBaseline({ ...town }, signals);
    } else if (town.connection === 'live') {
      lostAt = Date.now();
      town = setConnection(town, 'reconnecting');
    }
  } finally {
    refreshing = false;
  }
  renderer?.applyState(town);
  renderUi();
  return town;
}

// --------------------------------------------------------------------------- live events

interface BackendEvent {
  sequence?: number;
  type?: string;
  task_id?: string | null;
  payload?: Record<string, unknown>;
  timestamp?: string;
  /** Tagged by the shell for page-load /api/events replays. */
  historical?: boolean;
}

function onEvent(event: BackendEvent | undefined): void {
  if (!event || typeof event.type !== 'string') return;
  const autonomous = isAutonomousTask(event.task_id);
  town = applyEvent(town, event as never, autonomous);
  renderer?.applyState(town);
  renderUi();

  // Process event through bubble controller (UI-VIS-007). Historic replays
  // carry the flag so the controller advances its watermark without
  // rendering — historic events never replay as new execution (§14).
  if (event.type) {
    bubbleController?.processEvent({
      type: event.type,
      payload: event.payload,
      task_id: event.task_id,
      sequence: event.sequence,
      timestamp: event.timestamp,
      historical: event.historical,
    });
    // §11: keep the recent-bubble history viewer fresh while it is open.
    if (ui?.bubbleHistory.open) bubbleController?.renderHistoryInto(ui.bubbleHistoryList);
  }

  // Terminal events change records too: re-read soon, but not per event (bounded, debounced).
  if (/(completed|failed|decided|applied|approved|pruned|error)$/.test(event.type)) {
    clearTimeout(refreshQueued);
    refreshQueued = setTimeout(() => void refresh(), 1500);
  }
}

/** A task belongs to an investigation when a goal names it: that work is the researcher's. */
function isAutonomousTask(taskId: string | null | undefined): boolean {
  return !!taskId && goalTasks.has(taskId);
}

// --------------------------------------------------------------------------- rendering

function renderUi(): void {
  if (!ui) return;
  const connectionText: Record<Connection, string> = {
    live: '● Live', reconnecting: '● Reconnecting', disconnected: '● Disconnected',
  };
  ui.connection.textContent = connectionText[town.connection]
    + (lostAt && town.connection !== 'live' ? ` since ${clock(lostAt)}` : '');
  ui.connection.dataset.state = town.connection;
  ui.counts.textContent = [
    `${town.counts.working} working`, `${town.counts.waiting} waiting`,
    `${town.counts.finished} goals complete`, `${town.counts.failed} failed`,
  ].join(' · ');
  ui.summary.textContent = summarize(town)
    + (town.observedAt ? ` — read ${clock(town.observedAt)}${town.connection === 'live' ? '' : ' (last known)'}` : '');

  const motionLabel = `Motion: ${motion ? 'on' : 'off'}`;
  if (ui.motion.textContent !== motionLabel) ui.motion.textContent = motionLabel;
  ui.motion.setAttribute('aria-pressed', String(!motion));

  ui.rows.replaceChildren();
  for (const role of ROLES) {
    const resident = town.residents[role];
    const row = document.createElement('p');
    row.className = 'town-row';
    row.dataset.state = resident.state;
    const name = document.createElement('strong');
    name.textContent = `${resident.name} · ${ROSTER[role].title}`;
    const detail = document.createElement('span');
    detail.textContent = `${ACTIVITY_WORDS[resident.state]} — ${resident.label}`;
    row.append(name, detail);
    ui.rows.append(row);
  }
  if (town.unknownEvents.length) {
    const note = document.createElement('p');
    note.className = 'town-row town-row-unknown';
    note.textContent = `Unmapped events (no area is animated for these): ${town.unknownEvents.join(', ')}`;
    ui.rows.append(note);
  }
  if (!motion) ui.board.open = true;

  // Existing Overview fields stay truthful: they now describe the town rather than a stored sprite.
  const busy = ROLES.map(r => town.residents[r]).find(r => r.state === 'working' || r.state === 'queued');
  const room = document.getElementById('room');
  const activity = document.getElementById('activity');
  if (room) room.textContent = busy ? locationLabel(busy.location) : locationLabel('town_square');
  if (activity) activity.textContent = busy ? ACTIVITY_WORDS[busy.state] + ': ' + busy.label : 'idle';

  if (busy) {
    const strip = document.getElementById('studio-status');
    const detail = document.getElementById('studio-detail');
    if (strip) strip.textContent = `${busy.name} · ${locationLabel(busy.location)}`;
    if (detail) detail.textContent = busy.label;
    const mood = document.getElementById('persona-mood');
    if (mood) mood.textContent = moodFor(busy.state);
  } else {
    const strip = document.getElementById('studio-status');
    const detail = document.getElementById('studio-detail');
    const waiting = ROLES.map(r => town.residents[r]).filter(r => r.state === 'waiting_approval');
    if (strip) strip.textContent = 'Command center · no role working';
    if (detail) detail.textContent = waiting.length
      ? `Waiting for you: ${waiting.map(r => ROSTER[r.role].title).join(', ')}`
      : 'Nothing waiting';
  }
  const narrative = document.getElementById('persona-narrative');
  if (narrative) {
    const name = document.getElementById('persona-display')?.textContent || 'Hermes';
    narrative.textContent = busy
      ? `${name} is coordinating: ${busy.name} is ${busy.label.toLowerCase()}.`
      : `${name} is monitoring the lab: no role is working right now.`;
  }
}

function moodFor(state: Activity): string {
  return ({ working: 'Focused', queued: 'Waiting', waiting_approval: 'Attentive', failed: 'Concerned',
    blocked: 'Concerned', completed: 'Pleased', idle: 'Relaxed', unknown: 'Observant' } as Record<Activity, string>)[state];
}

function clock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

// --------------------------------------------------------------------------- interaction

import { openWorkspace, openWorkView, openTask } from './navigation-state.ts';

function openView(view: string): void {
  // Canonical navigation intents replace synthetic .click() chains
  const direct: Record<string, string> = {
    overview: 'home', activity: 'activity', evidence: 'results',
    results: 'results', memory: 'system',
  };
  const root = direct[view];
  if (root) {
    openWorkspace(root as 'home' | 'activity' | 'results' | 'system');
    return;
  }
  const workview: Record<string, string> = {
    discovery: 'discover', planning: 'planning', build: 'build',
    goals: 'goals', tasks: 'tasks',
  };
  const subview = workview[view];
  if (subview) {
    openWorkView(subview as 'tasks' | 'discover' | 'goals' | 'planning' | 'build');
  }
}

function showBuilding(location: LocationId): void {
  const place = TOWN_LOCATIONS[location];
  if (!place || !ui) return;
  const role = ROLES.find(r => ROSTER[r].location === location);
  const resident = role ? town.residents[role] : null;
  const title = document.getElementById('world-room-title');
  const description = document.getElementById('world-room-description');
  const info = document.getElementById('room-info');
  const open = document.getElementById('world-room-open') as HTMLButtonElement | null;
  const panel = document.getElementById('world-room-panel');
  if (title) title.textContent = locationLabel(location);
  if (description) {
    description.textContent = locationPurpose(location) + (resident ? ` Now: ${resident.label} (${ACTIVITY_WORDS[resident.state]}).` : '');
  }
  if (info) info.textContent = `${locationLabel(location)}: ${locationPurpose(location)}`;
  if (open) {
    open.textContent = 'Open ' + place.view + ' workspace';
    open.onclick = () => openView(place.view);
  }
  if (panel) panel.hidden = false;
  ui.selection.replaceChildren();
}

function showResident(role: Role): void {
  if (!ui || !ROLES.includes(role)) return;
  const resident = town.residents[role];
  const place = TOWN_LOCATIONS[resident.location];
  const card = document.createElement('div');
  card.className = 'town-card';
  card.dataset.state = resident.state;
  const heading = document.createElement('strong');
  heading.textContent = `${resident.name} — ${ROSTER[role].title}`;
  const state = document.createElement('p');
  state.textContent = `${ACTIVITY_WORDS[resident.state]} · ${resident.label}`;
  const facts = document.createElement('ul');
  const rows: Array<[string, string]> = [
    ['Place', roomForRole(role).label],
    ['Project/task', resident.project || resident.taskId || '—'],
    ['Workflow id', resident.workflowId || '—'],
    ['Last event', resident.eventType ? `${resident.eventType} (#${resident.sequence})` : '—'],
    ['Observed', `records ${clock(resident.observedAt)} · ${resident.source}`],
    ['Backend read', town.observedAt ? clock(town.observedAt) : '—'],
  ];
  for (const [key, value] of rows) {
    const item = document.createElement('li');
    item.textContent = `${key}: ${value}`;
    facts.append(item);
  }
  const actions = document.createElement('div');
  actions.className = 'town-card-actions';
  const view = document.createElement('button');
  view.type = 'button';
  view.textContent = 'Open ' + place.view;
  view.addEventListener('click', () => openView(place.view));
  actions.append(view);
  if (resident.taskId) {
    const task = document.createElement('button');
    task.type = 'button';
    task.textContent = 'Open task ' + resident.taskId.slice(0, 8);
    // Canonical intent: open task in Work workspace (Tasks subview)
    // Single action, single destination — no dual event dispatch
    task.addEventListener('click', () => {
      openTask(resident.taskId!, { destination: 'work' });
    });
    actions.append(task);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  close.addEventListener('click', () => ui!.selection.replaceChildren());
  actions.append(close);
  card.append(heading, state, facts, actions);
  ui.selection.replaceChildren(card);
  ui.selection.hidden = false;
}

// A resident whose overlay expired while the tab was hidden is corrected on return.
window.addEventListener('focus', () => { town = expireOverlays(town); renderUi(); });
