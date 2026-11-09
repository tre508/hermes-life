/**
 * Conversation composer — a single input handler shared by the Home
 * "New task" form and the Work workspace's persistent follow-up composer.
 *
 * Both surfaces do the same three things:
 *   1. Hold an unsent draft in localStorage, keyed by conversation id
 *      (or by a sentinel for "no conversation yet — create one"). The
 *      draft survives navigation between Home / Work / Activity / Results
 *      so a half-typed message is never lost without a visible record.
 *   2. POST /api/tasks with the prompt. When a conversationId is supplied
 *      the request is wired into the existing thread as a follow-up
 *      turn; otherwise Hermes starts a new conversation.
 *   3. Mark the draft as "submitted" but only clear it after the backend
 *      acknowledges the request — that tie-in is what prevents a draft
 *      from vanishing on a flaky submit, which the prior UI did
 *      indiscriminately.
 *
 * The composer does NOT call the backend itself; it returns the payload
 * via submit() and lets the caller decide how to route (sidebar "New
 * task" vs. Work follow-up vs. any future entry point). One code path,
 * one draft ledger, one set of rules — the doc's P0-4.
 */

const DRAFT_KEY_PREFIX = 'hermes.conv.draft.';
const DRAFT_KEY_NIL = 'hermes.conv.draft.__new';
const SUBMITTED_KEY = 'hermes.conv.draft.submitted.';
const MAX_LEN = 8000;

export interface ComposerOptions {
  /** Where the textarea lives. We don't reach into the DOM by id; the
   *  caller hands the textarea in. */
  textarea: HTMLTextAreaElement;
  submitButton: HTMLButtonElement;
  /** Visible label that flips with context — "Send to Hermes" vs. "Reply in conversation" vs. "Send a follow-up". */
  submitLabel?: string;
  /** Live "x / max" indicator. */
  counter?: HTMLElement;
  /** Where to render feedback (error text). */
  feedback?: HTMLElement;
  /** The conversation this composer is currently bound to. `null` means
   *  "send a brand-new task". */
  getConversationId(): string | null;
  /** Submit hook. The composer does not POST itself — it returns the
   *  payload. The caller POSTs to /api/tasks (or any future route) and
   *  resolves a Promise so the composer can clear the draft only on
   *  success. */
  submit(prompt: string): Promise<{ task_id: string; conversation_id?: string | null }>;
  /** Called whenever the textarea content changes (for live character
   *  count and to keep external UI in sync). */
  onChange?(value: string, opts: { draftRestored: boolean }): void;
}

const PENDING = new Map<string, Promise<unknown>>();

function draftKey(conv: string | null): string {
  return conv ? `${DRAFT_KEY_PREFIX}${conv}` : DRAFT_KEY_NIL;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function lockText(text: string): { value: string; atMax: boolean } {
  if (text.length > MAX_LEN) text = text.slice(0, MAX_LEN);
  return { value: text, atMax: text.length >= MAX_LEN };
}

/**
 * Wire the composer. Returns a small API for callers to update the bound
 * conversation (e.g. when the user picks a different task), and to
 * programmatically clear / restore the draft on navigation.
 */
export function mountComposer(opts: ComposerOptions) {
  const ta = opts.textarea;
  const btn = opts.submitButton;
  const counter = opts.counter || null;
  const fb = opts.feedback || null;
  const DEFAULT_LABEL = opts.submitLabel || 'Send to Hermes';

  let draftRestored = false;
  let lastConv = opts.getConversationId();

  const restoreDraft = () => {
    const conv = opts.getConversationId();
    const key = draftKey(conv);
    const stored = asString(localStorage.getItem(key));
    if (stored && stored !== ta.value) {
      ta.value = stored;
      draftRestored = true;
    } else {
      draftRestored = false;
    }
    if (conv && conv !== lastConv) {
      // The conversation changed: clear any pending "submitted" marker
      // because the new conversation shouldn't inherit a stale ack
      // from the previous one. Older drafts keep their slot.
      localStorage.removeItem(SUBMITTED_KEY + lastConv);
      lastConv = conv;
    }
    paint();
    opts.onChange?.(ta.value, { draftRestored });
  };

  const persistDraft = () => {
    const conv = opts.getConversationId();
    const key = draftKey(conv);
    if (ta.value) localStorage.setItem(key, ta.value);
    else localStorage.removeItem(key);
  };

  const paint = () => {
    const cur = ta.value;
    counter && (counter.textContent = cur.length >= MAX_LEN ? `${cur.length} / ${MAX_LEN}` : `${cur.length}`);
    btn.disabled = cur.trim().length === 0;
    const connLabel = (() => {
      const cid = opts.getConversationId();
      if (!cid) return 'New conversation';
      const rid = cid.slice(0, 8);
      return `Continuing ${rid}`;
    })();
    btn.textContent = connLabel === 'New conversation' ? 'Send to Hermes' : 'Reply in conversation';
    btn.title = connLabel;
  };

  const showFeedback = (msg: string, kind: 'error' | 'ok') => {
    if (!fb) return;
    fb.textContent = msg;
    fb.dataset.kind = kind;
  };

  ta.addEventListener('input', () => {
    const locked = lockText(ta.value);
    if (locked.value !== ta.value) ta.value = locked.value;
    persistDraft();
    paint();
    opts.onChange?.(ta.value, { draftRestored: false });
  });

  btn.addEventListener('click', async () => {
    const prompt = ta.value.trim();
    if (!prompt) return;
    const conv = opts.getConversationId();
    fb && (fb.textContent = '');
    btn.disabled = true;
    const pendingKey = (conv || '__new') + ':' + Date.now();
    PENDING.set(pendingKey, opts.submit(prompt).catch(async (err: unknown) => {
      showFeedback(`Could not send: ${asString((err as Error)?.message) || 'unknown error'}`, 'error');
      throw err;
    }));
    try {
      const result = (await PENDING.get(pendingKey)) as { task_id?: string; conversation_id?: string | null } | undefined;
      // Backend acknowledged the new task: clear this draft and mark
      // the conversation as "submitted" so a refresh knows not to
      // resurrect an old draft.
      const key = draftKey(conv);
      localStorage.removeItem(key);
      if (result && result.conversation_id) {
        localStorage.setItem(SUBMITTED_KEY + result.conversation_id, String(result.task_id || ''));
      }
      ta.value = '';
      paint();
      showFeedback(`Task accepted: ${String(result?.task_id || '').slice(0, 8)}`, 'ok');
      opts.onChange?.('', { draftRestored: false });
    } catch {
      // Submit hook already wrote the error; nothing else to do.
    } finally {
      PENDING.delete(pendingKey);
      paint();
    }
  });

  // Re-bind when the active task / conversation changes (e.g. user
  // clicks a different task in the Work list).
  return {
    rebind(): void { restoreDraft(); },
    clear(): void {
      const conv = opts.getConversationId();
      localStorage.removeItem(draftKey(conv));
      localStorage.removeItem(SUBMITTED_KEY + conv);
      ta.value = ''; paint();
    },
    setConversationId(conv: string | null): void {
      lastConv = conv;
      restoreDraft();
    },
    /** True when the textarea currently holds a draft restored from localStorage. */
    wasDraftRestored(): boolean { return draftRestored; },
  };
}

/** Read a draft by conversation id without instantiating a composer.
 *  Useful for "resume this draft elsewhere" UI. */
export function readDraft(conv: string | null): string {
  return asString(localStorage.getItem(draftKey(conv)));
}

/** Manually wipe a draft (e.g. user explicitly cancels). */
export function clearDraft(conv: string | null): void {
  localStorage.removeItem(draftKey(conv));
  localStorage.removeItem(SUBMITTED_KEY + conv);
}

export const composerConstants = { DRAFT_KEY_PREFIX, DRAFT_KEY_NIL, SUBMITTED_KEY, MAX_LEN };
