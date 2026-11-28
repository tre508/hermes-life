/**
 * HL-UI-PLAN-001 uichange.md §8 — Home's conversation slot: the canonical thread id.
 * Pure storage with no DOM and no side effects, so the composer can depend on it
 * without loading the chat (home-conversation.ts owns the panel).
 */
const SLOT_KEY = 'hl-home-conversation';

export function getHomeThread(): string {
    return localStorage.getItem(SLOT_KEY) || '';
}

export function setHomeThread(id: string): void {
    if (id) localStorage.setItem(SLOT_KEY, id);
    else localStorage.removeItem(SLOT_KEY);
}
