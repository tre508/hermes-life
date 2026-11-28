/**
 * HL-UI-PLAN-001 §4.3.2 — world camera controls overlaid on the Home viewport.
 *
 * This module only emits intents (`hermes:world-camera`). town-view owns the
 * renderer and performs the camera move, so the camera logic stays in one place.
 * Focus follows the most recently selected room (hermesha:room:select). Zoom,
 * follow-activity and an on-canvas bubble toggle have no renderer support yet and
 * are deliberately not offered.
 */
const byId = (id: string) => document.getElementById(id);

let lastRoom: string | null = null;
const overviewBtn = byId('world-overview') as HTMLButtonElement | null;
const focusBtn = byId('world-focus') as HTMLButtonElement | null;
const fullscreenBtn = byId('world-fullscreen') as HTMLButtonElement | null;
const homeView = byId('workspace-home');

function emit(detail: { action: 'overview' | 'focus'; room?: string }) {
    window.dispatchEvent(new CustomEvent('hermes:world-camera', { detail }));
}

window.addEventListener('hermesha:room:select', (event: Event) => {
    const room = (event as CustomEvent<{ room?: string }>).detail?.room;
    if (!room) return;
    lastRoom = room;
    if (focusBtn) {
        focusBtn.disabled = false;
        focusBtn.title = `Focus the ${room} room`;
    }
});

overviewBtn?.addEventListener('click', () => emit({ action: 'overview' }));
focusBtn?.addEventListener('click', () => {
    if (lastRoom) emit({ action: 'focus', room: lastRoom });
});

fullscreenBtn?.addEventListener('click', () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void homeView?.requestFullscreen?.().catch(() => { /* not permitted here */ });
});
// The renderer re-fits through its ResizeObserver when the host box changes size,
// so no camera call is needed on fullscreen transitions.
document.addEventListener('fullscreenchange', () => {
    if (!fullscreenBtn) return;
    const on = document.fullscreenElement !== null;
    fullscreenBtn.textContent = on ? 'Exit fullscreen' : 'Fullscreen';
    fullscreenBtn.setAttribute('aria-pressed', String(on));
});
