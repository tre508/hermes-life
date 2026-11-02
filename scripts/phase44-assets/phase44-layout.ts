/** Phase 4.4: relocate the existing live response workspace into an operations tab.
 * Moving the node preserves all listeners, streaming updates and response state.
 */
export function installWorldFirstLayout(): void {
  const nav = document.getElementById('ops-nav');
  const views = document.getElementById('ops-views');
  const evidence = document.getElementById('response-workspace');
  if (!nav || !views || !evidence) {
    console.warn('Phase 4.4: required layout elements missing; leaving layout unchanged.');
    return;
  }
  if (document.getElementById('ops-evidence')) return;

  const tab = document.createElement('button');
  tab.type = 'button';
  tab.dataset.opsTab = 'evidence';
  tab.textContent = 'Evidence';
  tab.title = 'Inspect full Hermes answers, tool activity and task history';
  tab.setAttribute('aria-controls', 'ops-evidence');
  tab.setAttribute('aria-pressed', 'false');
  nav.appendChild(tab);

  const pane = document.createElement('div');
  pane.id = 'ops-evidence';
  pane.className = 'ops-view';
  pane.dataset.view = 'evidence';
  pane.setAttribute('aria-label', 'Response and evidence');
  views.appendChild(pane);
  pane.appendChild(evidence);

  // Existing main.ts attaches tab listeners before this patch executes;
  // only this newly created tab needs a listener.
  tab.addEventListener('click', () => {
    document.querySelectorAll<HTMLElement>('.ops-view').forEach(view =>
      view.classList.toggle('active', view.dataset.view === 'evidence'));
    document.querySelectorAll<HTMLButtonElement>('[data-ops-tab]').forEach(button => {
      const active = button.dataset.opsTab === 'evidence';
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  });
}
