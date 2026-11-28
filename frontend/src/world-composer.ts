import { setHomeThread } from './home-slot.ts';

/** Ask the Home panel to change session state (it owns the panel, not the composer). */
function homeSession(action: 'enter' | 'finish'): void {
    window.dispatchEvent(new CustomEvent('hermes:home-session', { detail: { action } }));
}
/**
 * World composer (HERMESHA spec §5/§6) — the conversation as part of the World.
 *
 * ONE composer bar bound to the canonical thread: Send hands the text to the
 * chat via `hermes:open-in-chat` with `submit:true`, so the message travels the
 * chat's own send path (no second chat instance, no second thread). Attach and
 * Workspace open the conversation panel, where the real file/workspace controls
 * live — this module never forks that logic.
 */
const $ = (id: string): HTMLElement | null => document.getElementById(id);

function handoff(detail: { prefill?: string; submit?: boolean; conversation_id?: string; new_conversation?: boolean }): void {
    window.dispatchEvent(new CustomEvent('hermes:open-in-chat', { detail }));
}

function setStatus(text: string): void {
    const el = $('world-composer-status');
    if (el) el.textContent = text;
}

export function initWorldComposer(): void {
    const form = $('world-composer') as HTMLFormElement | null;
    if (!form) return;
    const input = $('world-composer-input') as HTMLInputElement | null;

    const sendBtn = $('world-composer-send') as HTMLButtonElement | null;
    const stopBtn = $('world-composer-stop') as HTMLButtonElement | null;
    let chatRunning = false;

    // Home's conversation slot lives in home-conversation.ts. Only Home-initiated
    // sends set it, so a Chat-tab send never moves it.
    let homeSendPending = false;
    let lastHomeText = '';
    // The chat refused the send (for example HTTP 409 "Agent is busy"). Say so, and
    // give the text back so nothing typed on Home is lost.
    window.addEventListener('hermes:chat-submit-failed', (ev: Event) => {
        if (!homeSendPending) return;
        homeSendPending = false;
        const message = (ev as CustomEvent<{ message?: string }>).detail?.message ?? 'unknown error';
        if (input && !input.value) input.value = lastHomeText;
        setStatus(`Not sent: ${message}. Your text is back in the box — send it again when Hermes is free.`);
    });
    const newButton = $('world-composer-new') as HTMLButtonElement | null;
    window.addEventListener('hermes:chat-conversation', (ev: Event) => {
        const id = (ev as CustomEvent<{ conversation_id?: string }>).detail?.conversation_id;
        if (!homeSendPending || !id) return;
        setHomeThread(id);
        homeSession('enter');
        homeSendPending = false;
    });
    newButton?.addEventListener('click', () => {
        if (chatRunning) {
            setStatus('Hermes is still working — stop the task first, then start a new conversation.');
            return;
        }
        homeSession('finish');
        setStatus('Next message starts a new conversation.');
    });

    // Chat owns the task. Home mirrors its running state: Send becomes Stop.
    window.addEventListener('hermes:chat-running', (ev: Event) => {
        chatRunning = !!(ev as CustomEvent<{ running?: boolean }>).detail?.running;
        if (!chatRunning) homeSendPending = false;
        if (sendBtn) sendBtn.hidden = chatRunning;
        if (stopBtn) stopBtn.hidden = !chatRunning;
    });
    stopBtn?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('hermes:chat-stop')));

    form.addEventListener('submit', ev => {
        ev.preventDefault();
        const text = (input?.value || '').trim();
        if (!text) return;
        // Chat ignores a submit while a task runs, so refuse here instead of saying "Sent".
        if (chatRunning) {
            setStatus('Hermes is still working — stop the task first, or wait for it to finish.');
            return;
        }
        // Continue Home's conversation, or start a new one when Home has none.
        homeSendPending = true;
        lastHomeText = text;
        // Decision 2026-11-28: every Home send starts a new conversation. The previous
        // Home thread stays in Chat history; Chat's Conversations and Resume reach it.
        setHomeThread('');
        handoff({ prefill: text, submit: true, new_conversation: true });
        homeSession('enter');
        if (input) input.value = '';
        // The World composer has no transcript of its own: say plainly where the
        // message went, so a send is never a silent no-op.
        setStatus('Sent — the reply streams into the live conversation on the left.');
    });

    // Attach / Workspace delegate to the chat panel's own controls.
    $('world-composer-attach')?.addEventListener('click', () => {
        handoff({});
        setStatus('Opening the conversation panel — attach files there.');
        window.setTimeout(() => ($('hc415-files-button') as HTMLElement | null)?.click(), 60);
    });
    $('world-composer-workspace')?.addEventListener('click', () => {
        handoff({});
        setStatus('Opening the conversation panel — choose the working directory there.');
        window.setTimeout(() => ($('hc415-ws-selector') as HTMLElement | null)?.click(), 60);
    });
}

initWorldComposer();
