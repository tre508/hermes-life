/**
 * UI-VIS-003 D4: the static fallback.
 *
 * Used when the client cannot run the 3D renderer (no WebGL2). It is a plain, keyboard-reachable list
 * of the seven residents and their real state — no canvas, no clock, nothing inferred. It is also the
 * honest text view of the same model, which is why its content is a pure function that a test can
 * assert without a DOM.
 */
import {
  ROLES, ROSTER, TOWN_LOCATIONS, emptyTown,
  type Activity, type LocationId, type Role, type TownState,
} from './town-model';
import type { RendererPoint, TownRenderer } from './town-renderer';
import { mountInto, stateWordFor } from './town-renderer';
import { locationLabel } from './town-vocabulary';

export interface StaticRow {
  role: Role;
  name: string;
  title: string;
  state: Activity;
  /** The semantic state word. `unknown` reads as "Status unknown", never as an invented action. */
  stateWord: string;
  location: LocationId;
  locationName: string;
}

/** Pure: exactly what the fallback shows, in `ROLES` order. */
export function staticRows(state: TownState): StaticRow[] {
  return ROLES.map(role => {
    const resident = state.residents[role];
    return {
      role,
      name: resident.name,
      title: ROSTER[role].title,
      state: resident.state,
      stateWord: stateWordFor(resident.state),
      location: resident.location,
      locationName: locationLabel(resident.location),
    };
  });
}

/** The one line under a resident's name: what the backend says, plus where they are. */
export function staticRowDetail(row: StaticRow, label: string): string {
  return `${row.stateWord} — ${label} · ${row.locationName}`;
}

export function createStaticRenderer(host: HTMLElement, _opts: { motion: boolean }): TownRenderer {
  const list = document.createElement('ul');
  list.className = 'town-static';
  list.setAttribute('aria-label', 'Residents and their current state');
  mountInto(host, list, 'data-town-static');

  let state: TownState = emptyTown();
  let buttons = new Map<Role, HTMLButtonElement>();

  const select = (role: Role) => window.dispatchEvent(new CustomEvent('town:select', { detail: { role } }));

  const paint = () => {
    buttons = new Map();
    list.replaceChildren();
    for (const row of staticRows(state)) {
      const item = document.createElement('li');
      item.dataset.state = row.state;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.role = row.role;
      button.textContent = `${row.name} · ${row.title}`;
      button.addEventListener('click', () => select(row.role));
      const detail = document.createElement('span');
      detail.textContent = staticRowDetail(row, state.residents[row.role].label);
      item.append(button, detail);
      list.append(item);
      buttons.set(row.role, button);
    }
  };

  // One station heading per place, so a click can still reach the building detail.
  const places = document.createElement('div');
  places.className = 'town-static-places';
  for (const location of Object.keys(TOWN_LOCATIONS) as LocationId[]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = locationLabel(location);
    button.addEventListener('click', () => window.dispatchEvent(new CustomEvent('town:building', { detail: { location } })));
    places.append(button);
  }
  mountInto(host, places, 'data-town-static-places');

  paint();

  return {
    kind: 'static',
    applyState(next: TownState) { state = next; paint(); },
    setMotion() { /* motionless by construction */ },
    resize() { /* no canvas to measure */ },
    positions(): RendererPoint[] {
      // No geometry to report; the rows are DOM, and their order is `ROLES` (see `staticRows`).
      return [];
    },
    frames() { return 0; },
    destroy() { list.remove(); places.remove(); buttons.clear(); },
  };
}
