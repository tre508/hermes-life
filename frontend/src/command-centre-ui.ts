/** Phase 4 presentation-only interactions for ONE Hermesha Command Centre.
 * Does not fetch/mutate application state or duplicate existing workspace controllers.
 */
const roomToLocation: Record<string, string | null> = {
  'control': 'town_square', 'director': 'planning_house',
  'research': 'library', 'review': 'review_office',
  'dev': 'workshop', 'lab': 'testing_lab', 'archive': 'archive',
  'break': null,
};
const roomTitles: Record<string, string> = {
  control: 'Control Room', director: 'Director Office', research: 'Research Station',
  review: 'Review Station', dev: 'Dev Station', lab: 'Lab', archive: 'Archive', break: 'Break Room',
};

function selectRoom(roomKey: string): void {
  const title = roomTitles[roomKey];
  if (!title) return;
  document.querySelectorAll<HTMLButtonElement>('#primary-nav [data-hc-room]').forEach(button => {
    if (button.dataset.hcRoom === roomKey) button.setAttribute('aria-current', 'location');
    else button.removeAttribute('aria-current');
  });
  const info = document.getElementById('hc-room-info');
  if (info) {
    info.hidden = false;
    const label = info.querySelector<HTMLElement>('[data-hc-room-title]');
    if (label) label.textContent = title;
    const detail = info.querySelector<HTMLElement>('[data-hc-room-detail]');
    if (detail) detail.textContent = roomKey === 'break'
      ? 'Environmental room. No additional agent or workflow is created.'
      : 'Select the room in the world to inspect its existing role and current activity.';
  }
  const location = roomToLocation[roomKey];
  if (location) {
    // The existing town-view owns actual selection/navigation and authoritative records.
    window.dispatchEvent(new CustomEvent('town:building', { detail: { location } }));
  } else {
    // Break Room has no backend LocationId; show truthful presentation-only context.
    const panel = document.getElementById('world-room-panel');
    const panelTitle = document.getElementById('world-room-title');
    const desc = document.getElementById('world-room-description');
    const open = document.getElementById('world-room-open') as HTMLButtonElement | null;
    if (panel && panelTitle && desc) {
      panel.hidden = false;
      panelTitle.textContent = title;
      desc.textContent = 'Non-operational room. No active workflow or additional resident is assigned.';
      if (open) open.hidden = true;
    }
  }
}

// Clicking an architectural room in Three.js uses the same existing
// Phase 4 room inspector; the Break Room has no backend LocationId.
const physicalToKey: Record<string, string> = {
  director_office: 'director', research_station: 'research',
  review_station: 'review', dev_station: 'dev',
  control_room: 'control', lab: 'lab', archive: 'archive',
  break_room: 'break',
};
window.addEventListener('hermesha:room:select', (event: Event) => {
  const key = physicalToKey[(event as CustomEvent<{ room: string }>).detail?.room];
  if (key) selectRoom(key);
});

// Role/room interactions from the renderer update the side-panel indicator.
const locationToKey: Record<string, string> = Object.fromEntries(
  Object.entries(roomToLocation).filter(([, value]) => value !== null)
    .map(([key, value]) => [value!, key]),
);
window.addEventListener('town:building', (event: Event) => {
  const location = (event as CustomEvent<{ location?: string }>).detail?.location;
  if (!location) return;
  const key = locationToKey[location];
  if (!key) return;
  // Do not re-dispatch town:building here (avoids recursive events).
  const title = roomTitles[key];
  document.querySelectorAll('#primary-nav [data-hc-room]').forEach(el => {
    if ((el as HTMLElement).dataset.hcRoom === key) el.setAttribute('aria-current', 'location');
    else el.removeAttribute('aria-current');
  });
  const info = document.getElementById('hc-room-info');
  if (info) {
    info.hidden = false;
    const label = info.querySelector<HTMLElement>('[data-hc-room-title]');
    if (label) label.textContent = title;
    const detail = info.querySelector<HTMLElement>('[data-hc-room-detail]');
    if (detail) detail.textContent = 'Open the selected room for current backend activity and resident details.';
  }
});

document.querySelectorAll<HTMLButtonElement>('#primary-nav button[data-hc-room]').forEach(btn => {
  btn.addEventListener('click', () => {
    const room = btn.dataset.hcRoom;
    if (!room) return;
    // Existing primary-nav click handler switches to Home synchronously.
    queueMicrotask(() => selectRoom(room));
  });
});

document.querySelectorAll<HTMLButtonElement>('#primary-nav button[data-hc-workview]').forEach(btn => {
  btn.addEventListener('click', () => {
    const workview = btn.dataset.hcWorkview;
    // Let main.v2's primary-nav handler show Work, then delegate to its native subnav.
    queueMicrotask(() => {
      const existing = document.querySelector<HTMLButtonElement>(`#work-subnav button[data-workview="${workview}"]`);
      existing?.click();
    });
  });
});

// Header's synchronization control invokes the existing page refresh rather than
// a new API that could produce divergent snapshots.
document.getElementById('hc-sync')?.addEventListener('click', () => window.location.reload());
document.getElementById('hc-room-info-close')?.addEventListener('click', () => {
  const info = document.getElementById('hc-room-info');
  if (info) info.hidden = true;
  document.querySelectorAll('#primary-nav [data-hc-room]').forEach(el => el.removeAttribute('aria-current'));
});
