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

function handoff(detail: { prefill?: string; submit?: boolean }): void {
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

    form.addEventListener('submit', ev => {
        ev.preventDefault();
        const text = (input?.value || '').trim();
        if (!text) return;
        handoff({ prefill: text, submit: true });
        if (input) input.value = '';
        // The World composer has no transcript of its own: say plainly where the
        // message went, so a send is never a silent no-op.
        setStatus('Sent to Hermes — the conversation panel is open; the reply appears there.');
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
