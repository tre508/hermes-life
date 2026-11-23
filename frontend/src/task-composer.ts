/**
 * Task composer (convo-redesign.md §6) — the persistent, state-adaptive input
 * in the Work task workspace.
 *
 * This deliberately reverses HL-CONV-001's removal of the Task Board composer,
 * while keeping the invariant that decision existed to protect: there is ONE
 * conversation and ONE send path. This module never POSTs /api/tasks itself.
 * It hands the text to the chat via `hermes:open-in-chat` with `submit:true`,
 * so the message travels the chat's own send path and lands in the same
 * thread. It is a second *entry point*, not a second write path.
 *
 * The copy adapts to the task's interaction state (§4 / §6):
 *
 *   new        no conversation yet   start an independent request
 *   followup   running / queued      linked follow-up — see the honesty note
 *   approval   awaiting_approval / blocked, or the chain wants a plan decision
 *   failed     failed / cancelled    describe what to try differently
 *   completed  completed             ask about the result / request more work
 *
 * Honesty note (§6): the backend cannot steer a run in flight — the agent is
 * single-flight (`active.acquire(blocking=False)` → HTTP 409 "Agent is busy")
 * and no endpoint accepts input for a running task. The followup copy says so
 * rather than pretending the message interrupts the active run.
 */
import { readDraft, writeDraft, clearDraft, composerConstants } from './conv-composer.ts';

export type ComposerMode = 'new' | 'followup' | 'approval' | 'failed' | 'completed';

export interface ComposerCopy {
    mode: ComposerMode;
    /** `.task-composer__label-text` — the state-adaptive heading. */
    label: string;
    /** `.task-composer__label-hint` — what this input will actually do. */
    hint: string;
    placeholder: string;
}

const APPROVAL_ACTIONS = new Set(['approve_plan', 'review_investigation']);
const DECISION_STATES = new Set(['awaiting_approval', 'blocked']);
const FAILED_STATES = new Set(['failed', 'cancelled']);
const ACTIVE_STATES = new Set(['running', 'queued']);

const MAX_LEN = composerConstants.MAX_LEN;

function norm(v: unknown): string {
    return String(v ?? '').trim().toLowerCase();
}

/** Pure: derive the composer's state-adaptive copy from task + chain records.
 *  Never invents a mode the lifecycle does not support. */
export function composerCopyFor(input: {
    state?: unknown;
    nextAction?: unknown;
    hasConversation?: boolean;
}): ComposerCopy {
    const state = norm(input.state);
    const next = norm(input.nextAction);
    const hasConversation = Boolean(input.hasConversation);

    if (APPROVAL_ACTIONS.has(next) || DECISION_STATES.has(state)) {
        return {
            mode: 'approval',
            label: 'Approval required',
            hint: 'Authorize from the actions above; add context or ask about the decision here.',
            placeholder: 'Add an explanation, or ask about this decision…',
        };
    }
    if (FAILED_STATES.has(state)) {
        return {
            mode: 'failed',
            label: 'Inspect failure and retry',
            hint: 'Describe what should be tried differently — this continues the same conversation.',
            placeholder: 'Describe what should be tried differently…',
        };
    }
    if (ACTIVE_STATES.has(state)) {
        return {
            mode: 'followup',
            label: 'Send a follow-up instruction',
            hint: 'Hermes is still executing. This is recorded as a linked follow-up — it cannot steer the running run.',
            placeholder: 'Add an instruction or a note for this conversation…',
        };
    }
    if (state === 'completed') {
        return {
            mode: 'completed',
            label: 'Ask about this result or request additional work',
            hint: 'Continues this conversation — the original request and outcome are preserved.',
            placeholder: 'Ask about this result or request more work…',
        };
    }
    if (!hasConversation) {
        return {
            mode: 'new',
            label: 'Start a new task',
            hint: 'This creates an independent request.',
            placeholder: 'Describe the task…',
        };
    }
    return {
        mode: 'followup',
        label: 'Reply in this conversation',
        hint: 'Continues this conversation.',
        placeholder: 'Reply…',
    };
}

export interface TaskComposerInput {
    state?: unknown;
    nextAction?: unknown;
    taskId?: string | null;
    conversationId?: string | null;
}

export interface TaskComposerHandle {
    /** Re-derive mode + copy + draft for the currently rendered task. */
    update(input: TaskComposerInput): void;
    dispose(): void;
}

/**
 * Mount the composer into `host`. `getInput()` is read on every send so the
 * caller can swap the selected task without rebuilding the DOM.
 */
export function mountTaskComposer(
    host: HTMLElement,
    getInput: () => TaskComposerInput,
): TaskComposerHandle {
    const box = document.createElement('div');
    box.className = 'task-composer';

    const label = document.createElement('div');
    label.className = 'task-composer__label';
    const labelText = document.createElement('span');
    labelText.className = 'task-composer__label-text';
    const labelHint = document.createElement('span');
    labelHint.className = 'task-composer__label-hint';
    label.append(labelText, labelHint);

    const textarea = document.createElement('textarea');
    textarea.id = 'task-detail-composer-text';
    textarea.rows = 3;

    const row = document.createElement('div');
    row.className = 'task-composer__row';
    const count = document.createElement('span');
    count.className = 'task-composer__count';

    const actions = document.createElement('div');
    actions.className = 'task-composer__actions';
    const openChat = document.createElement('button');
    openChat.type = 'button';
    openChat.className = 'task-chat-handoff__btn';
    openChat.textContent = 'Open in Chat →';
    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'task-composer__submit';
    actions.append(openChat, submit);
    row.append(count, actions);

    const feedback = document.createElement('p');
    feedback.className = 'task-composer__feedback';

    box.append(label, textarea, row, feedback);
    host.append(box);

    let boundConv: string | null = null;

    const paint = () => {
        const input = getInput();
        const conv = input.conversationId ? String(input.conversationId) : null;
        const copy = composerCopyFor({
            state: input.state,
            nextAction: input.nextAction,
            hasConversation: Boolean(conv),
        });
        box.dataset.mode = copy.mode;
        labelText.textContent = copy.label;
        labelHint.textContent = copy.hint;
        textarea.placeholder = copy.placeholder;
        count.textContent = `${textarea.value.length}${textarea.value.length >= MAX_LEN ? ` / ${MAX_LEN}` : ''}`;
        submit.disabled = textarea.value.trim().length === 0;
        submit.textContent = copy.mode === 'new' ? 'Start task' : 'Send';
    };

    const restoreDraft = () => {
        const input = getInput();
        const conv = input.conversationId ? String(input.conversationId) : null;
        if (conv === boundConv) return;
        boundConv = conv;
        textarea.value = readDraft(conv);
        paint();
    };

    textarea.addEventListener('input', () => {
        if (textarea.value.length > MAX_LEN) textarea.value = textarea.value.slice(0, MAX_LEN);
        const input = getInput();
        writeDraft(input.conversationId ? String(input.conversationId) : null, textarea.value);
        paint();
    });

    openChat.addEventListener('click', () => {
        const input = getInput();
        const detail: Record<string, string> = {};
        if (input.conversationId) detail.conversation_id = String(input.conversationId);
        if (input.taskId) detail.task_id = String(input.taskId);
        if (textarea.value.trim()) detail.prefill = textarea.value;
        window.dispatchEvent(new CustomEvent('hermes:open-in-chat', { detail }));
        feedback.dataset.kind = 'ok';
        feedback.textContent = 'Opened in Chat — review there before sending.';
    });

    submit.addEventListener('click', () => {
        const text = textarea.value.trim();
        if (!text) return;
        const input = getInput();
        // ONE send path: the chat performs the POST. We only hand it the text.
        const detail: Record<string, unknown> = { prefill: text, submit: true };
        if (input.conversationId) detail.conversation_id = String(input.conversationId);
        if (input.taskId) detail.task_id = String(input.taskId);
        window.dispatchEvent(new CustomEvent('hermes:open-in-chat', { detail }));
        clearDraft(input.conversationId ? String(input.conversationId) : null);
        textarea.value = '';
        paint();
        // Never a silent no-op: say where the message went.
        feedback.dataset.kind = 'ok';
        feedback.textContent = 'Sent to Hermes — it is in this conversation; the reply appears in Chat.';
    });

    restoreDraft();
    paint();

    return {
        update(input: TaskComposerInput) {
            const conv = input.conversationId ? String(input.conversationId) : null;
            if (conv !== boundConv) {
                boundConv = conv;
                textarea.value = readDraft(conv);
            }
            feedback.textContent = '';
            paint();
        },
        dispose() { box.remove(); },
    };
}
