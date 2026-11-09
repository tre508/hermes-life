/**
 * Conversation thread view.
 *
 * Reads `/api/conversations/{id}/turns` and renders a chronological
 * thread: user turns on the right, assistant turns on the left, each
 * with a timestamp and (when present) the linked task id.
 *
 * ALSO fetches `/api/events?correlation_id={task_id}` so the same view
 * can render **grouped** tool activity between assistant turns (UI-VIS-007
 * §8). A conversation with 178 raw `hermes.text` events on the wire
 * otherwise drowns both turns and tool calls; grouping by category keeps
 * the timeline readable while preserving every individual call behind an
 * expand affordance.
 *
 * Tool execution flows live on the same bus as the rest of the UI
 * (`hermes:event`); the controller debounces (250 ms) and refreshes both
 * the user/assistant turns and the grouped tool panel so a single
 * handler covers both views.
 */

import { groupToolActivity, renderToolGroups, type ToolGroup } from './tool-group.ts';

export interface Turn {
  id: number | string;
  role: 'user' | 'assistant' | string;
  content: string;
  created_at?: string;
  task_id?: string | null;
}

export interface ThreadOptions {
  host: HTMLElement;
  /** Returns the conversation to render. Called every refresh. */
  getConversation(): Promise<{ title?: string; conversation_id: string } | null>;
  /** Filter turns by task_id; if null, render whole conversation. */
  getFilterTaskId(): string | null;
  /** Click on a linked task id inside a turn (e.g. open that task in Work). */
  onTaskClick?: (taskId: string) => void;
  /** Click on a tool run inside a grouped tool card. */
  onRunClick?: (toolCallId: string) => void;
  /** Optional: open the Activity workspace with a task filter. */
  onActivityClick?: (taskId: string) => void;
  /** Refresh debounce window in ms. */
  debounceMs?: number;
  /** Initial "no conversation yet" message. */
  emptyText?: string;
}

const DEBOUNCE_DEFAULT = 250;

export function mountThread(opts: ThreadOptions) {
  const host = opts.host;
  let lastRefresh = 0;
  let pendingTimer: number | null = null;
  let lastConvId: string | null = null;

  const debounce = (fn: () => void) => {
    if (pendingTimer !== null) window.clearTimeout(pendingTimer);
    pendingTimer = window.setTimeout(fn, opts.debounceMs ?? DEBOUNCE_DEFAULT);
  };

  async function refresh() {
    try {
      const conv = await opts.getConversation();
      if (!conv) {
        host.replaceChildren();
        host.append(makeHint(opts.emptyText || 'Select a task to see its conversation.'));
        return;
      }
      const res = await fetch(`/api/conversations/${encodeURIComponent(conv.conversation_id)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const turnsRaw: Turn[] = Array.isArray(data?.turns) ? data.turns : [];
      const filterId = opts.getFilterTaskId();
      const turns = filterId ? turnsRaw.filter(t => String(t.task_id || '') === String(filterId)) : turnsRaw;

      // Tool activity (UI-VIS-007 §8): grouped, not raw. Fetch the
      // /api/events stream once per task and collapse adjacent categorised
      // tool calls into one card. We only fetch when a filterTaskId is
      // available — broad conversations degrade to the turn-only view
      // rather than pulling the entire global event log.
      let groups: ToolGroup[] = [];
      if (filterId) {
        try {
          const er = await fetch(`/api/events?tail=500&correlation_id=${encodeURIComponent(filterId)}`);
          if (er.ok) {
            const raw = await er.json() as Array<Record<string, unknown>>;
            groups = groupToolActivity(raw, filterId);
          }
        } catch { /* events optional */ }
      }
      render(conv, turns, groups);
      lastConvId = conv.conversation_id;
    } catch (err) {
      host.replaceChildren();
      host.append(makeHint(`Conversation unavailable: ${(err as Error)?.message || err}`));
    }
  }

  function render(conv: { conversation_id: string; title?: string }, turns: Turn[], groups: ToolGroup[]) {
    host.replaceChildren();
    const head = document.createElement('header');
    head.className = 'conv-thread-head';
    const title = document.createElement('h3');
    title.textContent = conv.title && conv.title !== conv.conversation_id ? conv.title : `Conversation ${conv.conversation_id.slice(0, 8)}`;
    head.append(title);
    const idPill = document.createElement('small');
    idPill.textContent = `${conv.conversation_id.slice(0, 8)} · ${turns.length} turn${turns.length === 1 ? '' : 's'} · ${groups.reduce((n, g) => n + g.callCount, 0)} tool call${groups.reduce((n, g) => n + g.callCount, 0) === 1 ? '' : 's'}`;
    head.append(idPill);
    host.append(head);

    if (!turns.length && !groups.length) {
      host.append(makeHint('No turns yet. Use the composer below to start this thread.'));
      return;
    }

    // Grouped tool activity at the top — the user gets an immediate
    // summary of what Hermes already did before pouring over the
    // user/assistant turns.
    if (groups.length) {
      const toolsHost = document.createElement('section');
      toolsHost.className = 'conv-thread__tools';
      renderToolGroups({
        host: toolsHost,
        groups,
        expandFirst: true,
        onRunClick: opts.onRunClick
          ? (toolCallId) => opts.onRunClick?.(toolCallId)
          : undefined,
      });
      host.append(toolsHost);
    }

    const list = document.createElement('ol');
    list.className = 'conv-thread';
    for (const t of turns) list.append(renderTurn(t));
    host.append(list);
  }

  function renderTurn(t: Turn) {
    const li = document.createElement('li');
    li.className = `conv-turn conv-turn--${t.role}`;
    li.dataset.turnId = String(t.id);
    if (t.task_id) li.dataset.taskId = String(t.task_id);

    const header = document.createElement('div');
    header.className = 'conv-turn__head';
    const role = document.createElement('span');
    role.className = `conv-turn__role`;
    role.textContent = t.role === 'user' ? 'You' : (t.role === 'assistant' ? 'Hermes' : (t.role || 'system'));
    header.append(role);
    if (t.created_at) {
      const ts = document.createElement('time');
      const iso = t.created_at;
      const d = new Date(iso);
      ts.dateTime = iso;
      ts.title = iso;
      ts.textContent = isNaN(d.getTime()) ? iso : d.toLocaleString();
      header.append(ts);
    }
    if (t.task_id) {
      const taskLink = document.createElement('button');
      taskLink.type = 'button';
      taskLink.className = 'conv-turn__task';
      taskLink.textContent = `task ${t.task_id.slice(0, 8)}`;
      taskLink.title = `Open task ${t.task_id}`;
      taskLink.addEventListener('click', () => opts.onTaskClick?.(String(t.task_id)));
      header.append(taskLink);
    }
    li.append(header);

    const body = document.createElement('div');
    body.className = 'conv-turn__body';
    const text = String(t.content || '');
    const SHORT = 280;
    if (text.length > SHORT) {
      const head = document.createElement('span');
      head.textContent = text.slice(0, SHORT).replace(/\s+/g, ' ').trim() + '…';
      body.append(head);
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'conv-turn__more';
      more.textContent = 'expand';
      const full = document.createElement('span');
      full.className = 'conv-turn__full';
      full.hidden = true;
      full.textContent = text;
      body.append(more, full);
      more.addEventListener('click', () => {
        const open = full.hidden;
        full.hidden = !open;
        more.textContent = open ? 'collapse' : 'expand';
      });
    } else {
      body.textContent = text;
    }
    li.append(body);
    return li;
  }

  function makeHint(text: string): HTMLElement {
    const p = document.createElement('p');
    p.className = 'conv-thread__empty';
    p.textContent = text;
    return p;
  }

  function onEvent(evt: Event) {
    const detail = (evt as CustomEvent).detail;
    if (!detail || detail.task_id === undefined) return;
    // Hermes just acknowledged a user turn or advanced state. Refresh
    // throttled so a stream of events during execution yields a single
    // repaint.
    debounce(() => {
      if (Date.now() - lastRefresh < (opts.debounceMs ?? DEBOUNCE_DEFAULT)) {
        // Skip if already throttling.
        return;
      }
      lastRefresh = Date.now();
      void refresh();
    });
  }

  window.addEventListener('hermes:event', onEvent);
  // Also re-render whenever the active conversation changes (caller
  // signals via setConversation / focus).
  void refresh();
  return {
    refresh: () => refresh(),
    dispose() {
      window.removeEventListener('hermes:event', onEvent);
      if (pendingTimer !== null) window.clearTimeout(pendingTimer);
    },
    lastConversationId: () => lastConvId,
  };
}
