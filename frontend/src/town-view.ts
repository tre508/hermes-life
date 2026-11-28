/**
 * UI-VIS-002: mounts the town and keeps it tied to the backend.
 *
 * Responsibilities, all of them read-only:
 *  - one bounded snapshot poll of existing endpoints (records are the authority for the baseline)
 *  - one subscription to the app's existing event stream (the live overlay)
 *  - a connection banner, a bounded summary and a static fallback
 *  (the resident card renders in the contextual inspector — HA-032)
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
import { FQ, fqLine } from './five-questions.ts';
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
/** task_id -> goal title, for the resident card's "Why" answer (spec §8/§10). */
const goalTitles = new Map<string, string>();
let ui: Ui | null = null;
let bubbleController: BubbleController | null = null;

interface Ui {
  connection: HTMLElement;
  summary: HTMLElement;
  counts: HTMLElement;
  board: HTMLDetailsElement;
  rows: HTMLElement;
  motion: HTMLButtonElement;
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

  // P2: the contextual inspector's 'room' card — populated from the stable
  // room_id and the linked active work the authoritative records carry.
  registerKindRenderer('room', (sel, body) => {
    const loc = sel.id as LocationId;
    const here = ROLES.map(r => town.residents[r]).filter(res => res.location === loc);
    const head = document.createElement('strong');
    head.textContent = KIND_LABEL.room;
    const title = document.createElement('h3');
    title.textContent = locationLabel(loc);
    title.style.margin = '6px 0 2px';
    const purpose = document.createElement('p');
    purpose.textContent = locationPurpose(loc);
    body.append(head, title, purpose);
    // Spec §8/§10: how much of this room's work is autonomous vs user-directed,
    // under the same "Why" label every other selection card uses.
    const autonomous = here.filter(res => isAutonomousTask(res.taskId)).length;
    body.append(fqLine(FQ.why, here.length
      ? `work origin: ${autonomous} autonomous · ${here.length - autonomous} user-directed`
      : 'no residents assigned here'));
    // Spec §4: the room card carries the room's own workspace action.
    const place = TOWN_LOCATIONS[loc];
    if (place) {
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'ctx-open-workspace';
      openBtn.textContent = 'Open ' + place.view + ' workspace';
      openBtn.addEventListener('click', () => openView(place.view));
      body.append(openBtn);
    }
    const activity = here.filter(res => res.state === 'working' || res.state === 'queued');
    const workHead = document.createElement('p');
    workHead.innerHTML = '<em>Linked active work</em>';
    body.append(workHead);
    if (activity.length) {
      const list = document.createElement('ul');
      list.style.margin = '4px 0 8px';
      list.style.paddingLeft = '18px';
      for (const res of activity) {
        const item = document.createElement('li');
        // Spec §10 "what actually happened": the resident's own last event rides
        // with the linked work instead of requiring a trip to Activity.
        item.textContent = `${res.name}: ${res.label}` +
          (res.eventType ? ` · last event ${res.eventType}` : '');
        list.append(item);
        if (res.taskId) {
          const open = document.createElement('button');
          open.type = 'button';
          open.textContent = `Open task ${res.taskId.slice(0, 8)}`;
          open.addEventListener('click', () => { openTask(res.taskId!, { destination: 'work' }); });
          const wrap = document.createElement('li');
          wrap.append(open);
          list.append(wrap);
        } else if (res.workflowId) {
          const item2 = document.createElement('li');
          item2.textContent = `Workflow ${res.workflowId.slice(0, 8)} — no task yet`;
          list.append(item2);
        }
      }
      body.append(list);
    } else {
      const none = document.createElement('p');
      none.textContent = 'No active workflow here.';
      body.append(none);
    }
  });
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
  // Room/resident cards are dismissible: the ×, Escape, and leaving the room
  // all close them. Real rooms and residents render in the contextual inspector
  // (HA-032 retired the floating #town-selection popover); the floating
  // #world-room-panel is the presentation-only Break Room surface.
  const hideResidentCard = () => setInspectorSelection(null);
  const hideRoomPanel = () => {
    const panel = document.getElementById('world-room-panel');
    if (panel) panel.hidden = true;
    setSelection('home', null);
    renderer?.overview?.();
    hideResidentCard();
  };
  const closeRoom = document.getElementById('world-room-close');
  if (closeRoom) listen(closeRoom, 'click', hideRoomPanel);
  listen(document, 'keydown', (e) => {
    if ((e as KeyboardEvent).key !== 'Escape') return;
    const panel = document.getElementById('world-room-panel');
    if (panel && !panel.hidden) hideRoomPanel();
    else hideResidentCard();
  });

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
  // The world panel changes size without a window resize event — a wrapped HUD line, a layout switch,
  // the scroll container settling after hydration. A stale frame is exactly what let the world drift
  // out of its box, so watch the canvas host itself and coalesce bursts into one re-measure.
  if (typeof ResizeObserver !== 'undefined') {
    let pending = 0;
    const observer = new ResizeObserver(() => {
      if (pending) return;
      pending = window.requestAnimationFrame(() => { pending = 0; remeasure(); });
    });
    observer.observe(host);
    undo.push(() => { observer.disconnect(); if (pending) window.cancelAnimationFrame(pending); });
  }
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
  // The World's operational status belongs in the ONE global status strip
  // (spec §5) — not a block wedged between the canvas and the composer. All ids
  // are unchanged, so renderUi() keeps updating the same elements.
  const stage = document.getElementById('status-world')
    || host.closest('.world-wrap') || host.parentElement || host;
  const wrap = document.createElement('div');
  wrap.className = 'town-hud';
  wrap.innerHTML = [
    '<span id="town-connection" class="town-conn">Connecting…</span>',
    '<span id="town-counts" class="town-counts"></span>',
    '<span id="town-summary" class="town-summary" role="status" aria-live="polite">Reading backend records…</span>',
    '<details id="town-board" class="town-board town-more"><summary>Roles</summary>',
    '<div id="town-rows" class="town-rows"></div></details>',
    '<details id="town-bubble-history" class="town-bubble-history town-more"><summary>Bubbles</summary>',
    '<div id="town-bubble-history-list" class="town-bubble-history__list"></div>',
    '</details>',
    '<button id="town-motion" type="button" aria-pressed="false">Motion: on</button>',
  ].join('');
  // The phase-4.6 live status banner was absolutely positioned inside #game, where it covered the
  // top of the town (the Archive and its neighbours). It keeps its element and behaviour but now
  // sits with the town status block, outside the art.
  const banner = document.querySelector<HTMLElement>('.hermes-live-status');
  const bannerHome = banner?.parentElement ?? null;
  if (banner) wrap.prepend(banner);
  stage.append(wrap);
  return {
    connection: wrap.querySelector('#town-connection')!,
    summary: wrap.querySelector('#town-summary')!,
    counts: wrap.querySelector('#town-counts')!,
    board: wrap.querySelector('#town-board')!,
    rows: wrap.querySelector('#town-rows')!,
    motion: wrap.querySelector('#town-motion')!,
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
      goalTitles.clear();
      for (const goal of signals.goals || []) {
        if (typeof goal.task_id === 'string') {
          goalTasks.add(goal.task_id);
          if (typeof goal.title === 'string' && goal.title) goalTitles.set(goal.task_id, goal.title);
        }
      }
      town = setConnection(town, lostAt ? 'reconnecting' : 'live');
      town = withBaseline({ ...town }, signals);
      noteRecentEvents(null);
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

/** Event bursts from a run arrive many times a second. Rebuilding the activity rows and
 *  the inspector body on each one churns the DOM under the cursor (the constant flicker).
 *  Coalesce them into one update per frame; the data is unchanged, only the rebuilds drop. */
let uiFrame = 0;
function scheduleRenderUi(): void {
  if (uiFrame) return;
  uiFrame = window.requestAnimationFrame(() => {
    uiFrame = 0;
    renderUi();
  });
}

function onEvent(event: BackendEvent | undefined): void {
  if (!event || typeof event.type !== 'string') return;
  const autonomous = isAutonomousTask(event.task_id);
  town = applyEvent(town, event as never, autonomous);
  // HA-032: the resident card's "relevant events" — note the change with the
  // wire timestamp when the event carried one.
  noteRecentEvents(typeof event.timestamp === 'string' ? event.timestamp : null);
  renderer?.applyState(town);
  scheduleRenderUi();

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
  // P2: keep the room card in the contextual inspector honest while the
  // snapshot/event data changes under a persisted home selection. HA-032: a
  // resident selection re-reads its record so the card cannot go stale.
  const sel = getInspectorSelection();
  if (sel?.kind === 'resident') setInspectorSelection({ ...sel, record: residentRecord(sel.id as Role) });
  else rerenderInspector();
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

import { openWorkspace, openWorkView, openTask, setSelection, type WorkView, type Workspace } from './navigation-state.ts';
import { registerKindRenderer, rerenderInspector, setInspectorSelection, getInspectorSelection, KIND_LABEL, type ResidentRecord, type ResidentEventLine } from './context-inspector';

/** Where an existing dashboard view opens — no new destination is invented. */
function resolveView(view: string): { workspace?: Workspace; workView?: WorkView } {
  // Regroup: memory lives in Knowledge now; overview is the Home workspace.
  const direct: Record<string, Workspace> = {
    overview: 'home', activity: 'activity', evidence: 'results',
    results: 'results', memory: 'knowledge',
  };
  const root = direct[view];
  if (root) return { workspace: root };
  const workview: Record<string, WorkView> = {
    discovery: 'discoveries', planning: 'plans', build: 'builds',
    goals: 'goals', tasks: 'tasks',
  };
  const subview = workview[view];
  return subview ? { workView: subview } : {};
}

function openView(view: string): void {
  // Canonical navigation intents replace synthetic .click() chains.
  const dest = resolveView(view);
  if (dest.workspace) openWorkspace(dest.workspace);
  else if (dest.workView) openWorkView(dest.workView);
}

function showBuilding(location: LocationId): void {
  const place = TOWN_LOCATIONS[location];
  if (!place) return;
  // Spec §4: a room pick is a canonical typed selection in the home scope, so the
  // SAME contextual inspector Work uses renders the room card (location, purpose,
  // work origin, linked work, open-workspace action). The floating
  // #world-room-panel is reserved for the presentation-only Break Room.
  const panel = document.getElementById('world-room-panel');
  if (panel) panel.hidden = true;
  setSelection('home', { kind: 'room', id: location });
  const info = document.getElementById('room-info');
  if (info) info.textContent = `${locationLabel(location)}: ${locationPurpose(location)}`;
  renderer?.focusRoom?.(location);  // spec §2/§11: zoom to the selected room
  // HA-032: a room pick replaces any resident card in the inspector.
  setInspectorSelection(null);
}

/** HA-032: recent events per role (newest first) for the inspector's resident card. */
const recentEvents = new Map<Role, ResidentEventLine[]>();
const RECENT_EVENT_LIMIT = 5;

function noteRecentEvents(timestamp: string | null): void {
  for (const role of ROLES) {
    const res = town.residents[role];
    if (!res.eventType) continue;
    const list = recentEvents.get(role) ?? [];
    const head = list[0];
    if (head && head.type === res.eventType && head.sequence === res.sequence) continue;
    list.unshift({ type: res.eventType, sequence: res.sequence,
      timestamp: timestamp ?? (res.observedAt ? clock(res.observedAt) : null) });
    if (list.length > RECENT_EVENT_LIMIT) list.length = RECENT_EVENT_LIMIT;
    recentEvents.set(role, list);
  }
}

function recentEventsFor(role: Role): ResidentEventLine[] {
  if (!recentEvents.has(role)) noteRecentEvents(null);  // seed with the resident's last event
  return recentEvents.get(role) ?? [];
}

/** HA-032: the resident record a 'resident' selection carries (spec §3.2). */
function residentRecord(role: Role): ResidentRecord {
  const resident = town.residents[role];
  const place = TOWN_LOCATIONS[resident.location];
  // Spec §8/§10: the three kinds of work must be distinguishable AND the "why"
  // must name its cause — a task named by a goal shows the goal's title, not
  // just the classification. A task belongs to an investigation when a goal
  // names it; otherwise it was user-directed.
  const goalTitle = resident.taskId ? goalTitles.get(resident.taskId) : undefined;
  const rows: Array<[string, string]> = [
    ['Place', roomForRole(role).label],
    ['Why', isAutonomousTask(resident.taskId)
      ? `Autonomous — investigation goal${goalTitle ? ` “${goalTitle}”` : ''}`
      : 'User-directed — chat or manual goal'],
    ['Project/task', resident.project || resident.taskId || '—'],
    ['Workflow id', resident.workflowId || '—'],
    ['Observed', `records ${clock(resident.observedAt)} · ${resident.source}`],
    ['Backend read', town.observedAt ? clock(town.observedAt) : '—'],
  ];
  return {
    name: resident.name, title: ROSTER[role].title, state: resident.state,
    operation: `${ACTIVITY_WORDS[resident.state]} · ${resident.label}`,
    rows, taskId: resident.taskId, events: recentEventsFor(role),
    view: place.view, ...resolveView(place.view),
  };
}

function showResident(role: Role): void {
  if (!ROLES.includes(role)) return;
  const resident = town.residents[role];
  // P2: resident picks select their current room (one ring, room_id keyed).
  setSelection('home', { kind: 'room', id: resident.location });
  // HA-032: the contextual inspector renders the resident card from a typed
  // 'resident' selection carrying the record; the floating #town-selection
  // popover is retired in favor of the inspector.
  setInspectorSelection({ kind: 'resident', id: role, record: residentRecord(role) });
}

// A resident whose overlay expired while the tab was hidden is corrected on return.
window.addEventListener('focus', () => { town = expireOverlays(town); renderUi(); });

// HL-UI-PLAN-001 §4.3.2: camera intents from the world controls. Only renderers
// that implement the optional methods act; the rest ignore the request.
window.addEventListener('hermes:world-camera', (event: Event) => {
    const detail = (event as CustomEvent<{ action?: string; room?: string }>).detail;
    if (detail?.action === 'overview') renderer?.overview?.();
    else if (detail?.action === 'focus' && detail.room) renderer?.focusRoom?.(detail.room);
});

