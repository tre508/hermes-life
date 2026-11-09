/**
 * UI-VIS-007 / spec §8 — Tool activity grouping.
 *
 * Live payloads show tens or hundreds of `hermes.tool_use` + `hermes.tool_result`
 * events per task (recent diagnostic: 178 `hermes.text` alone on a single
 * chain). Rendering each as an individual entry would flood the conversation
 * thread and override the more meaningful user / Hermes turns.
 *
 * This module collapses adjacent same-category tool calls into a single
 * summary card so the timeline reads like:
 *
 *   ┌──────────────────────────────────────────────────┐
 *   │  Reading files — 4 operations          expand ▾ │
 *   └──────────────────────────────────────────────────┘
 *
 * Clicking expand reveals each call:
 *
 *   ┌──────────────────────────────────────────────────┐
 *   │  ▸ read_file          src/main.ts       ✓ done    │
 *   │  ▸ grep               "navigation.*"   ✓ done    │
 *   │  ▸ read_file          src/types.ts      ✓ done    │
 *   │  ▸ ls                 component-tests  ✓ done    │
 *   └──────────────────────────────────────────────────┘
 *
 * Grouping rules (deliberately conservative — never invent structure):
 *  - A `tool_use` and its matching `tool_result` (same `tool_call_id`)
 *    pair into one "run".
 *  - Runs group by category (`READ`, `EDIT`, `SHELL`, `TEST`, `WEB`,
 *    `MEMORY`, `OTHER`) — see `categoriseTool` below.
 *  - Currently-running runs (no matching `tool_result` in the feed) stay
 *    in their own group with status `running`.
 *  - Groups never cross task boundaries.
 *  - The output remains the real events; the card is a presentation.
 */

export type ToolStatus = 'pending' | 'completed' | 'failed';

export interface ToolRun {
  /** Stable anchor shared between the use and the result. */
  toolCallId: string;
  toolName: string;
  /** First argument the parser could surface — file path, command, query, etc. */
  target: string;
  status: ToolStatus;
  /** Server sequence number of the tool_use event. */
  sequence: number;
  startTime: string;
  /** Set when a matching `tool_result` event lands. */
  endTime?: string;
  /** Result summary surfaced from the tool_result payload. */
  summary?: string;
}

export interface ToolGroup {
  /** Group key — drives the human-readable label. */
  category: 'read' | 'edit' | 'shell' | 'test' | 'web' | 'memory' | 'other';
  callCount: number;
  runs: ToolRun[];
  startTime: string;
  endTime?: string;
  /** Worst-case status across the runs (running > failed > completed). */
  status: ToolStatus;
}

/* ===== categorisation ===== */

const READ_KIND = /^(read_file|read|_?cat|head|grep|^search$|^find$|^list$|^glob$|^ls$|browse|^fetch$|retrieve)$/i;
const EDIT_KIND = /^(write_file|create_file|patch_apply|^write$|edit_file|^edit$|^patch$|^apply$)$/i;
const SHELL_KIND = /^(terminal|^exec$|^run$|^shell$|^cmd$|^bash$|^sh$)$/i;
const TEST_KIND  = /^(test|pytest|^pytest_run$|verify|^verify_criteria$|^lint$|^check$|^evaluate$)$/i;
const MEMORY_KIND = /^(memory|recall|store_memory|^note$|^vault$|archive|^reflect$|^lesson$)$/i;
const WEB_KIND   = /^(web_search|web_fetch|^browse$|^arxiv$|^fetch_url$|^search_api$|^http$)$/i;

export function categoriseTool(name: string): ToolGroup['category'] {
  const n = (name || '').toLowerCase();
  if (!n) return 'other';
  if (READ_KIND.test(n)) return 'read';
  if (EDIT_KIND.test(n)) return 'edit';
  if (SHELL_KIND.test(n)) return 'shell';
  if (TEST_KIND.test(n)) return 'test';
  if (WEB_KIND.test(n)) return 'web';
  if (MEMORY_KIND.test(n)) return 'memory';
  return 'other';
}

export const CATEGORY_LABEL: Record<ToolGroup['category'], string> = {
  read: 'Reading files',
  edit: 'Editing code',
  shell: 'Running commands',
  test: 'Running tests',
  web: 'Fetching from the web',
  memory: 'Recording memory',
  other: 'Other tools',
};

const STATUS_BADGE: Record<ToolStatus, string> = {
  pending: '⋯ in progress',
  completed: '✓ done',
  failed: '✗ failed',
};

/* ===== grouping ===== */

interface RawEvent {
  sequence?: number;
  type?: string;
  payload?: Record<string, unknown>;
  task_id?: string | null;
  timestamp?: string;
}

interface MutableRun {
  toolCallId: string;
  toolName: string;
  target: string;
  status: ToolStatus;
  sequence: number;
  startTime: string;
  endTime?: string;
  summary?: string;
}

/**
 * Group hermes.tool_use + hermes.tool_result events into ToolGroup[].
 * Skips events that aren't from a recognised tool channel; never produces
 * content for synthetic reasons.
 */
export function groupToolActivity(events: ReadonlyArray<RawEvent>, taskId?: string): ToolGroup[] {
  // 1. Filter to events for the requested task (or accept all if no filter).
  const own: RawEvent[] = [];
  for (const e of events) {
    if (taskId && String(e.task_id || '') !== String(taskId)) continue;
    if (e.type !== 'hermes.tool_use' && e.type !== 'hermes.tool_result') continue;
    own.push(e);
  }
  // 2. Pair tool_use with tool_result by tool_call_id, then bucket by category.
  const runsByCallId = new Map<string, MutableRun>();
  // Tool_uses sorted earliest-first so the running status aligns. Result events
  // may arrive out of order on the wire (a fast pair of tool_use/tool_result)
  // so we keep a separate `pending` map for runs awaiting a result.
  for (const e of own) {
    const payload = e.payload || {};
    const type = e.type || '';
    const toolName = toolNameFrom(payload);
    const id = toolCallIdFrom(payload);
    const ts = e.timestamp || new Date().toISOString();
    if (!id) continue; // a tool call without an id cannot be paired; skip
    if (type === 'hermes.tool_use') {
      runsByCallId.set(id, {
        toolCallId: id,
        toolName,
        target: toolTargetFrom(payload),
        status: 'pending',
        sequence: Number(e.sequence || 0),
        startTime: ts,
      });
    } else if (type === 'hermes.tool_result') {
      const isError = payload.is_error === true || payload.error || payload.failed === true;
      const exists = runsByCallId.get(id);
      const summary = isError
        ? `Error: ${String(payload.error ?? payload.message ?? 'tool failed').slice(0, 120)}`
        : resultSummaryFrom(payload);
      if (exists) {
        exists.status = isError ? 'failed' : 'completed';
        exists.endTime = ts;
        exists.summary = summary;
      } else {
        // The use predates our buffer (e.g. very long task) — record this anyway.
        runsByCallId.set(id, {
          toolCallId: id,
          toolName,
          target: toolTargetFrom(payload),
          status: isError ? 'failed' : 'completed',
          sequence: 0,
          startTime: ts,
          endTime: ts,
          summary,
        });
      }
    }
  }
  // 3. Bucket the runs by category.
  const buckets = new Map<ToolGroup['category'], MutableRun[]>();
  for (const r of runsByCallId.values()) {
    const cat = categoriseTool(r.toolName);
    let arr = buckets.get(cat);
    if (!arr) { arr = []; buckets.set(cat, arr); }
    arr.push(r);
  }
  // 4. Convert buckets to ToolGroup[], stable order: read → shell → edit →
  // test → web → memory → other (the order categories tend to occur in a
  // real investigation). Within each bucket, runs are sorted by sequence
  // so the user reads them chronologically inside the card.
  const order: ToolGroup['category'][] = ['read', 'shell', 'edit', 'test', 'web', 'memory', 'other'];
  const groups: ToolGroup[] = [];
  for (const cat of order) {
    const arr = buckets.get(cat);
    if (!arr || !arr.length) continue;
    arr.sort((a, b) => a.sequence - b.sequence);
    const status = arr.reduce<ToolStatus>(
      (worst, r) => r.status === 'pending' ? 'pending'
                : r.status === 'failed' ? (worst === 'pending' ? worst : 'failed')
                : worst,
      'completed',
    );
    const startTime = arr[0].startTime;
    const last = arr[arr.length - 1];
    const endTime = last.endTime;
    groups.push({
      category: cat,
      callCount: arr.length,
      runs: arr.map(r => ({ ...r })),
      startTime,
      endTime,
      status,
    });
  }
  return groups;
}

/* ===== payload readers (kept local so they stay aligned with the wire) ===== */

function toolNameFrom(p: Record<string, unknown>): string {
  const v = (p.name as string) ?? (p.tool_name as string) ?? (p.tool as string);
  return v ? String(v) : 'tool';
}

function toolCallIdFrom(p: Record<string, unknown>): string | null {
  const id = p.tool_call_id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function toolTargetFrom(p: Record<string, unknown>): string {
  const inputs = p.input ?? p.arguments ?? p.parameters ?? p.args;
  if (typeof inputs === 'string') return inputs.slice(0, 140);
  if (inputs && typeof inputs === 'object') {
    try {
      const s = JSON.stringify(inputs);
      return s.length > 140 ? s.slice(0, 137) + '…' : s;
    } catch { /* fallthrough */ }
  }
  const alt = (p.command as string) ?? (p.path as string) ?? (p.prompt as string);
  return alt ? String(alt).slice(0, 140) : '';
}

function resultSummaryFrom(p: Record<string, unknown>): string {
  const out = p.output ?? p.result ?? p.content;
  if (typeof out === 'string') return out.length > 160 ? out.slice(0, 157) + '…' : out;
  if (out && typeof out === 'object') {
    try {
      const s = JSON.stringify(out);
      return s.length > 160 ? s.slice(0, 157) + '…' : s;
    } catch { return ''; }
  }
  return '';
}

/* ===== DOM rendering ===== */

export interface RenderOptions {
  host: HTMLElement;
  groups: ToolGroup[];
  /** When true (default), expand the first group so users can see depth. */
  expandFirst?: boolean;
  /** Click handler when a run is expanded; receives the tool_call_id. */
  onRunClick?: (toolCallId: string) => void;
}

export function renderToolGroups(opts: RenderOptions) {
  const { host, groups } = opts;
  host.replaceChildren();
  if (!groups.length) {
    const p = document.createElement('p');
    p.className = 'tool-group__empty hint';
    p.textContent = 'No tool activity yet.';
    host.append(p);
    return;
  }
  for (const [i, g] of groups.entries()) {
    host.append(renderGroup(g, { expanded: !!opts.expandFirst && i === 0, onRunClick: opts.onRunClick }));
  }
}

function renderGroup(g: ToolGroup, opts: { expanded: boolean; onRunClick?: (id: string) => void }): HTMLElement {
  const card = document.createElement('section');
  card.className = `tool-group tool-group--${g.category}`;
  card.dataset.category = g.category;

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'tool-group__head';
  head.setAttribute('aria-expanded', String(opts.expanded));

  const label = document.createElement('span');
  label.className = 'tool-group__label';
  label.textContent = `${CATEGORY_LABEL[g.category]} — ${g.callCount} operation${g.callCount === 1 ? '' : 's'}`;
  head.append(label);

  const status = document.createElement('span');
  status.className = `tool-group__status tool-group__status--${g.status}`;
  status.textContent = STATUS_BADGE[g.status];
  head.append(status);

  const chevron = document.createElement('span');
  chevron.className = 'tool-group__chevron';
  chevron.textContent = '▾';
  head.append(chevron);

  head.addEventListener('click', () => {
    const open = card.classList.toggle('tool-group--open');
    head.setAttribute('aria-expanded', String(open));
    chevron.textContent = open ? '▴' : '▾';
  });
  card.append(head);

  const list = document.createElement('ol');
  list.className = 'tool-group__list';
  list.hidden = !opts.expanded;
  for (const r of g.runs) list.append(renderRun(r, opts.onRunClick));
  card.append(list);

  return card;
}

function renderRun(r: ToolRun, onRunClick?: (id: string) => void): HTMLElement {
  const li = document.createElement('li');
  li.className = `tool-run tool-run--${r.status}`;
  li.dataset.toolCallId = r.toolCallId;
  const status = document.createElement('span');
  status.className = 'tool-run__status';
  status.textContent = STATUS_BADGE[r.status];
  li.append(status);
  const name = document.createElement('code');
  name.className = 'tool-run__name';
  name.textContent = r.toolName;
  li.append(name);
  if (r.target) {
    const target = document.createElement('code');
    target.className = 'tool-run__target';
    target.textContent = r.target.length > 80 ? r.target.slice(0, 77) + '…' : r.target;
    li.append(target);
  }
  if (r.summary) {
    const summary = document.createElement('div');
    summary.className = 'tool-run__summary';
    summary.textContent = r.summary.length > 200 ? r.summary.slice(0, 197) + '…' : r.summary;
    li.append(summary);
  }
  if (onRunClick) {
    li.style.cursor = 'pointer';
    li.addEventListener('click', () => onRunClick(r.toolCallId));
  }
  return li;
}

export const toolGroupConstants = { CATEGORY_LABEL, STATUS_BADGE };
