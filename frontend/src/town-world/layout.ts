/**
 * The floor plan, as pure functions of the model.
 *
 * Kept free of Three.js on purpose: "the world matches the model" is then a unit test rather than
 * something only a screenshot can check — one station per role, one per `TOWN_LOCATIONS` entry, no
 * hand-written coordinate table that could drift out of step with the roster.
 *
 * Proportions here are the reference for the whole scene (report §12): the character height, the desk
 * height, the station pad and the partition height are defined once, and every prop is built against
 * them so people, furniture and architecture stay in a consistent relationship.
 */
import { ROLES, ROSTER, TOWN_LOCATIONS, type LocationId, type Role } from '../town-model';
import { locationLabel } from '../town-vocabulary';
import { roomForRole, roomToWorld } from './ship-rooms';

/** The room shell, in world units. The department ring is sized against it; the camera is not. */
export const ROOM = { width: 30, depth: 30, wall: 2.9 } as const;

/**
 * The floor and the backdrop, both deliberately larger than the camera frame.
 *
 * Audit v2 §2, §3 and §5: the room read as a platform floating in a void because its perimeter — kerb,
 * deck edge and wall ends — was inside the frame. So the deck runs past the frame in every direction
 * and the two visible walls are taller than the frame and longer than the room. The frame is then
 * filled by architecture and floor that simply continue out of sight, and no perimeter is ever drawn.
 */
export const DECK = { width: 30, depth: 23, height: 0.5 } as const;
export const SHELL = { width: 52, depth: 38, wall: 5.0 } as const;

/**
 * What the camera must show: every department plate, every figure, and every name — and nothing else.
 *
 * Framing to this instead of to `ROOM` is what makes the world fill the panel (audit v2 §4, §13). The
 * old fit included the wall tops at the far corners, and on a wide panel that pushed the camera back
 * until the facility was a diamond with empty margins either side of it.
 */
export const CONTENT = { x: 17.5, z: 17.5, y: 3.1 } as const;

/** Where the six working stations sit. An ellipse, so the ring fits the room's proportions. */
export const RING = { x: 6.4, z: 3.6, startDeg: 30 } as const;

/** The command centre: a two-tier platform with a ring of consoles. */
export const DAIS = { lower: 2.55, upper: 2.1, lowerHeight: 0.16, topHeight: 0.34 } as const;
export const DAIS_HEIGHT = DAIS.topHeight;

/** How far a visitor stands from a desk that belongs to someone else, in world units. */
export const VISIT_OFFSET = 1.5;

/** A consistent proportional system: everything in the scene is sized against these. */
export const SCALE = {
  /** Character height, head included. */
  person: 1.75,
  /** Working surface height. */
  desk: 0.76,
  /** Seat height, so a chair tucks under a desk correctly. */
  chair: 0.46,
  /** Station floor plate: the visible "department" footprint. */
  pad: { width: 3.3, depth: 2.8, height: 0.07 },
  /** Low glazed partition. */
  partition: { height: 1.95, thickness: 0.07 },
  /** Permanent signage post. */
  sign: { post: 1.9, plate: 0.5 },
  /** Monitor/terminal screen. */
  monitor: { width: 0.72, height: 0.42 },
} as const;

/** One station. Everything but the coordinates comes from the model. */
export interface StationPlan {
  role: Role;
  location: LocationId;
  /** Signage text: the facility's presentation label for the location. */
  label: string;
  /** The dashboard view this station opens — no new destination is invented. */
  view: string;
  x: number;
  z: number;
  /** Yaw that turns the station to face the command centre. */
  yaw: number;
}

/**
 * The floor plan: seven stations for the seven `TOWN_LOCATIONS`, one per `ROLES` entry. The coordinator
 * takes the centre; the six working roles sit evenly on the ring, their position coming from their
 * index in `ROLES` rather than a hand-written coordinate table.
 */
/** Fixed positions anchored to the screenshot's eight physical rooms.
 * Physical rooms do not introduce new persisted backend location IDs.
 */
export function facilityPlan(): StationPlan[] {
  return ROLES.map((role): StationPlan => {
    const room = roomForRole(role);
    const { x, z } = roomToWorld(room.u, room.v);
    const location = ROSTER[role].location;
    return {
      role, location, x, z,
      yaw: role === 'coordinator' ? Math.PI * 0.25 : Math.atan2(-x, -z),
      label: locationLabel(location),
      view: TOWN_LOCATIONS[location].view,
    };
  });
}

/** Where a figure stands. */
export interface ResidentSpot { x: number; y: number; z: number; yaw: number }

/**
 * The spot for a role at a model location.
 *
 * A resident at its own station stands at its desk. A resident visiting someone else's station stands
 * *beside* that desk, offset to one side, so a visiting coordinator never occupies the same position as
 * the resident who works there (report §7, §12).
 */
export function spotFor(role: Role, location: LocationId): ResidentSpot {
  const plan = facilityPlan();
  const spot = plan.find(entry => entry.location === location)
    ?? plan.find(entry => entry.location === ROSTER[role].location)
    ?? plan[0];
  const onDais = spot.role === 'coordinator';
  const height = onDais ? DAIS_HEIGHT : 0;
  if (spot.role === role) return { x: spot.x, y: height, z: spot.z, yaw: spot.yaw };
  const side = (ROLES.indexOf(role) % 2 === 0 ? 1 : -1) * VISIT_OFFSET;
  return {
    x: spot.x + side * Math.cos(spot.yaw),
    y: height,
    z: spot.z - side * Math.sin(spot.yaw),
    yaw: spot.yaw,
  };
}

/** Sets off and arrives gently, so a figure never snaps between stations. */
export function walkEase(t: number): number {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return clamped * clamped * (3 - 2 * clamped);
}

/** The camera's ground azimuth. Matches `ISO` in the renderer: the direction the viewer looks from. */
export const CAMERA_AZIMUTH = Math.PI / 4;

/**
 * How a seated resident sits at its desk: which end of the desk, and which way round.
 *
 * A resident facing its monitor straight on shows the camera the back of its head — and the audit needs
 * faces, clothing and posture readable (§7). So a sitter takes the *end* of the desk and faces along
 * it, on whichever side the camera can actually see. Both options face the desk; only one is visible.
 * This is the one place the composition informs the pose, and it is a pure function so it can be tested.
 */
export function seatTurnFor(yaw: number): { turn: number; x: number; z: number } {
  const options = [
    { turn: -Math.PI / 2, x: 1.28, z: 0.78 },
    { turn: Math.PI / 2, x: -1.28, z: 0.78 },
  ];
  let best = options[0];
  let bestScore = -Infinity;
  for (const option of options) {
    // cos(facing − azimuth) is the dot product of the figure's facing with the direction to the camera.
    const score = Math.cos(yaw + option.turn - CAMERA_AZIMUTH);
    if (score > bestScore) { bestScore = score; best = option; }
  }
  return best;
}
