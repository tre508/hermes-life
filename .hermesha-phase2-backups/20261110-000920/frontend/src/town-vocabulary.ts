/**
 * The facility's presentation vocabulary.
 *
 * The redesign changes the metaphor from a pixel-art town to an AI operations lab, so the words the
 * operator reads have to change with it (discrepancy report §10). The persisted model identifiers do
 * **not** change — `town_square`, `library` and the rest remain the contract, and every workflow mapping
 * still keys off them — only the wording on screen.
 *
 * Every visible surface reads its wording from here: the 3D signage, the no-WebGL list, the HUD, the room
 * panel and the page title. One file, one vocabulary, so they cannot drift apart.
 *
 * Deliberately free of Three.js and of the DOM, so the controller can import it without pulling the
 * renderer into the view.
 */
import { ROSTER, type LocationId, type Role } from './town-model';

/** What the facility is called, wherever a title is shown. */
export const LAB_NAME = 'AI Operations Lab';

/** Presentation labels. Keys are the model's stable location ids; only the wording is new. */
export const LOCATION_LABEL: Readonly<Record<LocationId, string>> = Object.freeze({
  town_square: 'Command Center',
  library: 'Research Laboratory',
  planning_house: 'Strategy Room',
  workshop: 'Development Studio',
  testing_lab: 'Verification Laboratory',
  archive: 'Knowledge Archive',
  review_office: 'Review & Approval',
});

/** What happens in each area, in the facility's language rather than the old town's. */
export const LOCATION_PURPOSE: Readonly<Record<LocationId, string>> = Object.freeze({
  town_square: 'Coordination and dispatch: what the system is doing right now.',
  library: 'Discovery scans, curiosity questions and investigation research.',
  planning_house: 'Formulation and approved investigation plans.',
  workshop: 'Isolated candidate implementation and revisions.',
  testing_lab: 'Baseline and candidate test runs, acceptance verification.',
  archive: 'Memory extraction, reflection and recorded outcomes.',
  review_office: 'Candidate adjudication, revision requests and host application.',
});

/** The facility label for a model location id. Falls back to the id if one is ever added. */
export function locationLabel(location: LocationId): string {
  return LOCATION_LABEL[location] ?? location;
}

/** The facility description of a model location id. */
export function locationPurpose(location: LocationId): string {
  return LOCATION_PURPOSE[location] ?? '';
}

/** The model's location for a role — the one presentation mapping both directions need. */
export function locationFor(role: Role): LocationId {
  return ROSTER[role].location;
}

/** One line describing what a role is for, used by the HUD and the room panel. */
export function roleFunction(role: Role): string {
  return locationPurpose(locationFor(role));
}
