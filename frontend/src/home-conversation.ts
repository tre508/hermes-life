/**
 * HL-UI-PLAN-001 uichange.md §2–§3 — Home's live conversation panel.
 *
 * One conversation slot (home-slot.ts) and one chat instance. While Home is live the
 * shared chat root is hosted in the Home panel; everywhere else it stays in the Chat
 * workspace host. The panel is never a second chat.
 *
 * States: none (no slot, composer only) -> live (panel open) <-> minimized
 *         live -> finish() releases the slot; the conversation stays in Chat history.
 * The composer requests session changes with `hermes:home-session` events, so it
 * never imports this module (and therefore never the chat).
 */
import { hostChatRootIn } from './hermes-chat.ts';
import { getCurrentWorkspace, onNavigationChange, openWorkspace } from './navigation-state.ts';
import { getHomeThread, setHomeThread } from './home-slot.ts';

const MIN_KEY = 'hl-home-minimized';
const $ = (id: string) => document.getElementById(id);

let minimized = localStorage.getItem(MIN_KEY) === '1';
/** A session is assigned to Home (slot set, or a Home send is in flight). */
let live = getHomeThread() !== '';

function setMinimized(value: boolean): void {
    minimized = value;
    if (value) localStorage.setItem(MIN_KEY, '1');
    else localStorage.removeItem(MIN_KEY);
}

/** Start the Home session. The composer's send opens the chat, so no open call here. */
function enterLive(): void {
    live = true;
    setMinimized(false);
    sync();
}

/** Bring back a minimized session; reopens the chat on the slot's conversation. */
function resume(): void {
    setMinimized(false);
    const slot = getHomeThread();
    if (slot) window.dispatchEvent(new CustomEvent('hermes:open-in-chat', { detail: { conversation_id: slot } }));
    sync();
}

function minimize(): void {
    setMinimized(true);
    sync();
}

/** Release the Home slot. The conversation itself stays in Chat history. */
function finish(): void {
    live = false;
    setMinimized(false);
    setHomeThread('');
    sync();
}

/** One rule decides where the chat lives and whether the Home panel shows. */
function sync(): void {
    const onHome = getCurrentWorkspace() === 'home';
    const showPanel = live && !minimized && onHome;
    document.getElementById('app')?.classList.toggle('home-live', showPanel);
    const host = $('home-conversation-host');
    if (host) host.hidden = !showPanel;
    const body = $('home-conversation-body');
    hostChatRootIn(showPanel && body ? body : null);
    const state = $('home-conversation-state');
    if (state) state.textContent = minimized ? 'Minimized' : 'Live';
    const resumeBtn = $('world-composer-resume');
    if (resumeBtn) resumeBtn.hidden = !(live && minimized && onHome);
}

function wire(): void {
    window.addEventListener('hermes:home-session', (ev: Event) => {
        const action = (ev as CustomEvent<{ action?: string }>).detail?.action;
        if (action === 'enter') enterLive();
        else if (action === 'finish') finish();
    });
    $('home-conv-minimize')?.addEventListener('click', () => minimize());
    $('home-conv-finish')?.addEventListener('click', () => finish());
    $('home-conv-open-chat')?.addEventListener('click', () => openWorkspace('conversations'));
    $('world-composer-resume')?.addEventListener('click', () => resume());
    onNavigationChange(() => sync());
    sync();
}

wire();
