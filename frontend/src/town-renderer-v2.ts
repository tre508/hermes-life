/**
 * Hermesha Command Centre — from-scratch three.js renderer.
 *
 * Designed against the target mock, not against the inherited town package:
 * a near top-down honeycomb floor plan, dark gunmetal plates, warm-orange
 * trim outlining every wall and corridor, cyan screens, flat label plates at
 * the bottom edge of each room, and a circular command hub with a glowing
 * holo stage and the HERMES wordmark. One file — layout, props and labels are
 * all defined here; the only shared piece is the residents' screen-space name
 * plate (HA-035), which belongs to the character system in town-world/residents.ts.
 *
 * It satisfies the TownRenderer seam (town-renderer.ts), so picking, deep
 * links, popovers and tests keep working unchanged. Events emitted:
 * town:select (role), town:building (location), hermesha:room:select (room).
 */
import * as THREE from 'three';

import { ROLES, ROSTER, type Activity, type LocationId, type Role, type TownState } from './town-model';
import type { RendererPoint, TownRenderer } from './town-renderer';
import { DESIGN, mountInto, stateWordFor } from './town-renderer';
import { locationLabel } from './town-vocabulary';
import {
  frameBounds, roomBounds, lerpPose,
  OVERVIEW_ELEVATION, GRID_AZIMUTH, FOCUS_ELEVATION, FOCUS_AZIMUTH,
  OVERVIEW_MARGIN, DEFAULT_FOV,
  type Bounds, type CameraPose,
} from './town-camera';
import { namePlate } from './town-world/residents';

// --------------------------------------------------------------------- layout

/** A room in straight screen-aligned coordinates: x right, z down, y up. */
interface Room {
  id: string;
  label: string;
  location: LocationId | null; // null = presentation-only room
  role: Role | null;
  x: number;
  z: number;
  w: number;
  d: number;
  tall: number;  // far (top) wall height
  low: number;   // near (bottom) wall height
}

const ROOM_TALL = 1.5;
const ROOM_LOW = 0.55;
const WALL_T = 0.18;

/** Eight rooms in the mock's honeycomb, screen-aligned (z grows downward). */
export const ROOMS: readonly Room[] = [
  { id: 'director_office', label: 'DIRECTOR OFFICE', location: null, role: 'planner', x: 0, z: -9.5, w: 10.5, d: 7, tall: ROOM_TALL, low: ROOM_LOW },
  { id: 'research_station', label: 'RESEARCH STATION', location: null, role: 'researcher', x: -16.5, z: -5.5, w: 10, d: 7, tall: ROOM_TALL, low: ROOM_LOW },
  { id: 'review_station', label: 'REVIEW STATION', location: null, role: 'reviewer', x: 16.5, z: -5.5, w: 10, d: 7, tall: ROOM_TALL, low: ROOM_LOW },
  { id: 'dev_station', label: 'DEV STATION', location: null, role: 'builder', x: -16.5, z: 2, w: 10, d: 8, tall: ROOM_TALL, low: ROOM_LOW },
  { id: 'control_room', label: 'CONTROL ROOM', location: null, role: 'coordinator', x: 0, z: 0, w: 10.5, d: 9.5, tall: ROOM_TALL, low: ROOM_LOW },
  { id: 'lab', label: 'LAB', location: null, role: 'tester', x: 16.5, z: 2, w: 10, d: 8, tall: ROOM_TALL, low: ROOM_LOW },
  { id: 'archive', label: 'ARCHIVE', location: null, role: 'archivist', x: -16.5, z: 9.5, w: 10, d: 7, tall: ROOM_TALL, low: ROOM_LOW },
  { id: 'break_room', label: 'BREAK ROOM', location: null, role: null, x: 16.5, z: 9.5, w: 10, d: 7, tall: ROOM_TALL, low: ROOM_LOW },
] as const;

/**
 * The whole facility's world box — what the overview camera frames and what the
 * HA-017 fill probe (tests/world-framing.test.ts) measures. The padding is real
 * visual extent, not air: side reach of the floor label plates, their z headroom,
 * and the residents above their heads (figure, badge, name plate).
 */
export function facilityBounds(rooms: readonly { x: number; z: number; w: number; d: number }[]): Bounds {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const room of rooms) {
    minX = Math.min(minX, room.x - room.w / 2 - 1.2);
    maxX = Math.max(maxX, room.x + room.w / 2 + 1.2);
    minZ = Math.min(minZ, room.z - room.d / 2 - 0.8);
    maxZ = Math.max(maxZ, room.z + room.d / 2 + 2.6); // headroom for label plates
  }
  // maxY covers the residents: a 1.7-unit figure at 2x scale (≈3.4 world), its
  // state badge at y=1.9 local (≈3.8) and the HA-035 name plate above it (≈4.7)
  // — the old 2.4 clipped heads, and 3.9 would clip the plates.
  return { minX, maxX, minY: 0, maxY: 4.9, minZ, maxZ };
}

/**
 * Corridor graph between rooms. Only pairs whose room edges actually face each
 * other get a corridor: straight vertical or horizontal passages between the
 * facing edges, like the mock's pass-through junctions. Diagonal pairs stay
 * connected through the side links (dev↔archive, lab↔break), so the graph
 * never needs a corridor that crosses another room.
 */
const LINKS: Array<[string, string]> = [
  ['control_room', 'director_office'],
  ['control_room', 'research_station'],
  ['control_room', 'review_station'],
  ['control_room', 'dev_station'],
  ['control_room', 'lab'],
  ['research_station', 'dev_station'],
  ['dev_station', 'archive'],
  ['review_station', 'lab'],
  ['lab', 'break_room'],
];

const CORRIDOR_W = 3.4;

// ------------------------------------------------------------------- materials

type Track = <T extends { dispose(): void }>(resource: T) => T;

/** Warm orange emissive trim — the mock's dominant accent. */
const TRIM = { color: 0xff7a3c, emissive: 0xff5a1e };
/** Cyan emissive for screens and the holo stage. */
const CYAN = { color: 0x5ad2f0, emissive: 0x1fa8e8 };

function makeMaterials(track: Track) {
  const std = (params: THREE.MeshStandardMaterialParameters) => track(new THREE.MeshStandardMaterial(params));

  return {
    // Architecture
    deck: std({ color: 0x2a313a, roughness: 0.85, metalness: 0.25 }),
    floor: std({ color: 0x434c58, roughness: 0.8, metalness: 0.2 }),
    roomFloor: std({ color: 0x4d5764, roughness: 0.72, metalness: 0.2 }),
    wall: std({ color: 0x3a434e, roughness: 0.7, metalness: 0.35 }),
    wallCap: std({ color: 0x20272e, roughness: 0.6, metalness: 0.4 }),
    // Emissive trim and screens
    trim: std({ color: TRIM.color, emissive: TRIM.emissive, emissiveIntensity: 2.2, roughness: 0.4 }),
    trimDim: std({ color: TRIM.color, emissive: TRIM.emissive, emissiveIntensity: 0.9, roughness: 0.4 }),
    screen: std({ color: CYAN.color, emissive: CYAN.emissive, emissiveIntensity: 1.5, roughness: 0.25 }),
    holo: track(new THREE.MeshBasicMaterial({
      color: 0x7fd4ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false,
    })),
    // Furniture
    furniture: std({ color: 0x161c22, roughness: 0.55, metalness: 0.45 }),
    deskTop: std({ color: 0x2a323b, roughness: 0.5, metalness: 0.5 }),
    shelf: std({ color: 0x3d3327, roughness: 0.8, metalness: 0.1 }),
    plant: std({ color: 0x2e6b3e, roughness: 0.9, metalness: 0 }),
    sofa: std({ color: 0x8a5a34, roughness: 0.85, metalness: 0.05 }),
    glass: std({ color: 0x0a3244, roughness: 0.2, metalness: 0.6, transparent: true, opacity: 0.7 }),
    person: std({ color: 0xcfd6dd, roughness: 0.7, metalness: 0.1 }),
    personAlt: std({ color: 0x54646f, roughness: 0.7, metalness: 0.1 }),
  };
}

type Materials = ReturnType<typeof makeMaterials>;

/** Deterministic PRNG so every reload and every screenshot is identical. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// --------------------------------------------------------------------- builders

function box(scene: THREE.Group, m: THREE.Material,
             w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  scene.add(mesh);
  return mesh;
}

/** A row of workstations with cyan screens, reading as the mock's desk clusters. */
function deskRow(scene: THREE.Group, m: Materials, x: number, z: number, count: number, facing = 0): void {
  for (let i = 0; i < count; i++) {
    const dx = (i - (count - 1) / 2) * 1.7;
    const s = Math.sin(facing), c = Math.cos(facing);
    const px = x + dx * c, pz = z + dx * s;
    box(scene, m.deskTop, 1.45, 0.09, 0.8, px, 0.72, pz);
    box(scene, m.furniture, 0.1, 0.72, 0.7, px - 0.6, 0.36, pz);
    box(scene, m.furniture, 0.1, 0.72, 0.7, px + 0.6, 0.36, pz);
    box(scene, m.furniture, 0.66, 0.44, 0.08, px, 0.98, pz - 0.28);
    box(scene, m.screen, 0.58, 0.36, 0.02, px, 0.99, pz - 0.24);
    box(scene, m.furniture, 0.5, 0.44, 0.5, px, 0.23, pz + 0.75); // chair
  }
}

function shelfWall(scene: THREE.Group, m: Materials, x: number, z: number, count: number, alongX = true): void {
  for (let i = 0; i < count; i++) {
    const off = (i - (count - 1) / 2) * 1.3;
    const px = alongX ? x + off : x;
    const pz = alongX ? z : z + off;
    box(scene, m.shelf, alongX ? 1.15 : 0.5, 1.7, alongX ? 0.5 : 1.15, px, 0.85, pz);
  }
}

function plant(scene: THREE.Group, m: Materials, x: number, z: number): void {
  box(scene, m.furniture, 0.42, 0.4, 0.42, x, 0.2, z);
  box(scene, m.plant, 0.6, 0.7, 0.6, x, 0.75, z);
}

/** One room: dark floor plate, wall outline with orange trim, interior props, flat label plate. */
function buildRoom(scene: THREE.Group, m: Materials, room: Room,
                   canvasTextures: Map<string, THREE.Texture>, track: Track): THREE.Group {
  const node = new THREE.Group();
  node.name = `room-${room.id}`;
  node.position.set(room.x, 0, room.z);
  const hw = room.w / 2, hd = room.d / 2;

  box(node, m.roomFloor, room.w, 0.08, room.d, 0, 0.04, 0);
  // Wall outline: far wall tall, side walls taper to the low near wall.
  box(node, m.wall, room.w, room.tall, WALL_T, 0, room.tall / 2, -hd);
  box(node, m.wallCap, room.w + 0.08, 0.1, WALL_T + 0.06, 0, room.tall + 0.05, -hd);
  // Left/right walls run tall at the far edge and taper to low at the near edge:
  // two slabs per side meeting at mid-depth, each with its own cap.
  for (const side of [-1, 1]) {
    const midH = (room.tall + room.low) / 2;
    box(node, m.wall, WALL_T, room.tall, room.d / 2, side * hw, room.tall / 2, -hd + room.d / 4);
    box(node, m.wall, WALL_T, midH, room.d / 2, side * hw, midH / 2, hd - room.d / 4);
    box(node, m.wallCap, WALL_T + 0.06, 0.08, room.d / 2, side * hw, room.tall + 0.04, -hd + room.d / 4);
    box(node, m.wallCap, WALL_T + 0.06, 0.08, room.d / 2, side * hw, midH + 0.04, hd - room.d / 4);
  }
  // Near wall: two short segments flanking the doorway.
  const opening = 1.9;
  const seg = (room.w - opening) / 2;
  for (const side of [-1, 1]) {
    box(node, m.wall, seg, room.low, WALL_T, side * (opening / 2 + seg / 2), room.low / 2, hd);
    box(node, m.trimDim, seg, 0.05, WALL_T + 0.04, side * (opening / 2 + seg / 2), room.low + 0.03, hd);
  }

  // Orange trim along every wall top: the mock's outline glow.
  box(node, m.trim, room.w - 0.1, 0.06, WALL_T + 0.05, 0, room.tall + 0.09, -hd);
  for (const side of [-1, 1]) {
    box(node, m.trim, WALL_T + 0.05, 0.06, room.d - 0.2, side * hw, room.tall + 0.09, -hd + (room.d) / 2);
    box(node, m.trim, WALL_T + 0.05, 0.06, room.d - 0.2, side * hw, room.low + 0.09, hd - (room.d) / 2);
  }
  // Trim also across the doorway threshold.
  box(node, m.trim, opening + 0.3, 0.06, WALL_T + 0.05, 0, room.low + 0.09, hd);

  // Space-facing window on the rear wall: a framed pane showing the starfield
  // the backdrop uses, per the amendment's "visible space views" requirement.
  const windowTexture = canvasTextures.get('window');
  if (windowTexture) {
    const winW = Math.min(room.w - 2.6, 3.2);
    const winY = 0.95;
    box(node, m.wallCap, winW + 0.3, 1.16, 0.1, 0, winY, -hd + 0.07);
    const paneMat = track(new THREE.MeshBasicMaterial({
      map: windowTexture, toneMapped: false,
    }));
    const pane = new THREE.Mesh(track(new THREE.PlaneGeometry(winW, 0.92)), paneMat);
    pane.position.set(0, winY, -hd + 0.13);
    node.add(pane);
    box(node, m.trim, winW + 0.3, 0.05, 0.12, 0, winY - 0.58, -hd + 0.07);
  }

  // Room-specific interiors. Central desk clusters + peripheral storage.
  switch (room.id) {
    case 'director_office':
      // Executive suite: central desk with guest chairs, side credenza,
      // bookcase walls and corner greenery.
      box(node, m.deskTop, 2.8, 0.1, 1.2, 0, 0.74, -0.6);
      box(node, m.furniture, 1.0, 0.9, 0.6, 0, 1.1, -1.35);
      box(node, m.screen, 2.2, 0.85, 0.04, 0, 1.75, -hd + 0.5);
      for (const side of [-1, 1]) {
        box(node, m.furniture, 0.55, 0.5, 0.55, side * 1.0, 0.25, 0.7);
        box(node, m.sofa, 0.5, 0.5, 0.55, side * 1.0, 0.25, 0.7);
      }
      box(node, m.deskTop, 2.6, 0.55, 0.6, 3.4, 0.28, 0.8);
      shelfWall(node, m, -4.2, 0.8, 3);
      shelfWall(node, m, 4.4, 1.4, 2);
      plant(node, m, -4.5, -2.6);
      plant(node, m, 4.5, -2.6);
      break;
    case 'research_station':
      // Three rows of two workstations fill the bay, mirroring the mock's dense
      // research floor.
      deskRow(node, m, -0.5, -1.5, 3);
      deskRow(node, m, -0.5, 1.2, 3);
      box(node, m.screen, 2.6, 1.0, 0.04, 0, 1.8, -hd + 0.5);
      box(node, m.holo, 2.0, 0.62, 0.02, 0, 1.82, -hd + 0.52);
      shelfWall(node, m, -4.5, 1.0, 2);
      plant(node, m, 4.4, -2.5);
      plant(node, m, -4.4, -2.5);
      break;
    case 'review_station':
      deskRow(node, m, 0.5, -1.5, 3);
      deskRow(node, m, 0.5, 1.2, 3);
      box(node, m.screen, 2.6, 1.0, 0.04, 0, 1.8, -hd + 0.5);
      shelfWall(node, m, 4.5, 1.0, 2);
      plant(node, m, -4.4, -2.5);
      plant(node, m, 4.4, -2.5);
      break;
    case 'dev_station': {
      // Development floor: six workstations in two rows plus server racks
      // along the outer wall.
      deskRow(node, m, 0, -1.8, 3);
      deskRow(node, m, 0, 1.2, 3);
      box(node, m.screen, 3.4, 1.1, 0.04, 0, 1.8, -hd + 0.5);
      for (let i = 0; i < 3; i++) {
        box(node, m.furniture, 0.9, 1.9, 0.6, -hw + 0.7, 0.95, -1.6 + i * 1.5);
        box(node, m.screen, 0.6, 0.06, 0.5, -hw + 0.72, 1.3, -1.6 + i * 1.5);
      }
      shelfWall(node, m, hw - 1.4, 2.6, 2);
      plant(node, m, hw - 1.0, -hd + 1.4);
      break;
    }
    case 'lab': {
      // Testing bay: workstation row, a fume hood along the outer wall, a
      // long bench with a vial rack, and the diagnostic centrifuge.
      deskRow(node, m, 0, -1.8, 2);
      box(node, m.furniture, 1.1, 1.8, 0.6, hw - 1.1, 0.9, -hd + 1.2);
      box(node, m.screen, 0.7, 0.4, 0.03, hw - 1.1, 1.5, -hd + 1.48);
      box(node, m.furniture, 1.4, 2.0, 0.7, -hw + 0.9, 1.0, 0.2);
      box(node, m.glass, 1.1, 1.3, 0.05, -hw + 0.9, 1.0, 0.56);
      box(node, m.deskTop, 2.8, 0.08, 0.9, 0, 0.5, 1.9);
      box(node, m.furniture, 0.15, 0.5, 0.7, -1.1, 0.25, 1.9);
      box(node, m.furniture, 0.15, 0.5, 0.7, 1.1, 0.25, 1.9);
      for (let i = 0; i < 5; i++) {
        box(node, m.glass, 0.14, 0.34, 0.14, -0.9 + i * 0.45, 0.72, 1.9);
      }
      plant(node, m, hw - 1.0, -hd + 1.4);
      break;
    }
    case 'archive':
      // Three full shelf rows cross the room; a reading desk with a holo
      // catalogue sits in the near corner.
      shelfWall(node, m, 0, -2.2, 5);
      shelfWall(node, m, 0, 0.1, 5);
      shelfWall(node, m, 0, 2.3, 5);
      box(node, m.deskTop, 1.6, 0.08, 0.8, hw - 1.6, 0.72, -hd + 1.6);
      box(node, m.holo, 1.1, 0.75, 0.02, hw - 1.6, 1.35, -hd + 1.6);
      plant(node, m, -hw + 1.0, -hd + 1.2);
      break;
    case 'break_room': {
      // Lounge: sofa group and coffee table, two seating tables with chairs,
      // coffee bar along the far wall and vending machines on the outer wall.
      box(node, m.sofa, 3.2, 0.5, 1.1, 1.5, 0.3, -hd + 1.4);
      box(node, m.sofa, 1.0, 0.55, 0.25, 0.4, 0.55, -hd + 1.0);
      box(node, m.deskTop, 2.2, 0.08, 1.2, 1.5, 0.5, -hd + 2.4);
      box(node, m.furniture, 0.15, 0.5, 0.15, 0.8, 0.25, -hd + 2.4);
      box(node, m.furniture, 0.15, 0.5, 0.15, 2.2, 0.25, -hd + 2.4);
      // Two small tables with chairs mid-floor.
      for (const [tx, tz] of [[-2.6, 0.2], [3.0, 1.2]] as const) {
        box(node, m.deskTop, 1.2, 0.07, 1.2, tx, 0.52, tz);
        box(node, m.furniture, 0.14, 0.52, 0.14, tx, 0.26, tz);
        for (const [cx, cz] of [[tx - 0.95, tz], [tx + 0.95, tz], [tx, tz - 0.95]] as const) {
          box(node, m.furniture, 0.42, 0.45, 0.42, cx, 0.22, cz);
        }
      }
      // Coffee bar along the far wall: counter, machine, cups.
      box(node, m.deskTop, 2.6, 0.08, 0.7, -2.4, 0.5, -hd + 0.7);
      box(node, m.furniture, 2.6, 0.5, 0.66, -2.4, 0.25, -hd + 0.7);
      box(node, m.furniture, 0.7, 0.55, 0.5, -3.2, 0.78, -hd + 0.7);
      // Vending machines on the outer wall.
      for (let i = 0; i < 2; i++) {
        box(node, m.furniture, 1.0, 1.9, 0.6, hw - 0.9, 0.95, -1.4 + i * 1.2);
        box(node, m.screen, 0.6, 0.9, 0.04, hw - 0.9, 1.15, -1.4 + i * 1.2 + 0.31);
      }
      plant(node, m, hw - 1.0, hd - 1.2);
      break;
    }
    case 'control_room':
      buildHubInterior(node, m);
      break;
  }

  // Flat label plate at the bottom edge — the mock's pill plates on the floor.
  const label = flatLabel(track, canvasTextures, room.label, Math.min(room.w * 0.62, 5.4));
  label.position.set(0, 0.1, hd + 0.9);
  node.add(label);

  scene.add(node);
  return node;
}

/** The command hub: circular stage, glowing ring, console arc, HERMES wordmark. */
function buildHubInterior(node: THREE.Group, m: Materials): void {
  const stage = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.9, 0.42, 32), m.deskTop);
  stage.position.set(0, 0.21, 0);
  node.add(stage);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.09, 8, 48), m.trim);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  node.add(ring);

  const holoCone = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 1.15, 1.5, 24, 1, true), m.holo);
  holoCone.position.set(0, 1.45, 0);
  node.add(holoCone);
  const holoFigure = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.75, 4, 12), m.holo);
  holoFigure.position.set(0, 1.6, 0);
  node.add(holoFigure);

  // Console arc facing the stage (gap at the near side so Hermes is never hidden).
  for (const angle of [150, 190, 230, 270, 310, 30]) {
    const rad = (angle * Math.PI) / 180;
    const cx = Math.cos(rad) * 4.0, cz = Math.sin(rad) * 4.0;
    const console_ = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.85, 0.6), m.furniture);
    body.position.y = 0.42;
    console_.add(body);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.55, 0.05), m.screen);
    panel.position.set(0, 0.85, 0.2);
    panel.rotation.x = -0.5;
    console_.add(panel);
    console_.position.set(cx, 0, cz);
    console_.rotation.y = Math.atan2(-cx, -cz);
    node.add(console_);
  }
}

/** A straight pass-through between two facing room edges, with glowing rails. */
function buildCorridor(scene: THREE.Group, m: Materials, a: Room, b: Room): void {
  const aL = a.x - a.w / 2, aR = a.x + a.w / 2, aT = a.z - a.d / 2, aB = a.z + a.d / 2;
  const bL = b.x - b.w / 2, bR = b.x + b.w / 2, bT = b.z - b.d / 2, bB = b.z + b.d / 2;
  // Vertical corridor: the rooms share an x interval and the passage spans the
  // gap between the lower room's bottom edge and the upper room's top edge.
  const xOverlapLo = Math.max(aL, bL), xOverlapHi = Math.min(aR, bR);
  const zOverlapLo = Math.max(aT, bT), zOverlapHi = Math.min(aB, bB);
  let cx: number, cz: number, length: number, vertical: boolean;
  if (xOverlapHi > xOverlapLo) {
    vertical = true;
    cx = (xOverlapLo + xOverlapHi) / 2;
    const from = Math.min(aB, bB), to = Math.max(aT, bT);
    if (to <= from) return;
    cz = (from + to) / 2;
    length = to - from;
  } else if (zOverlapHi > zOverlapLo) {
    vertical = false;
    cz = (zOverlapLo + zOverlapHi) / 2;
    const from = Math.min(aR, bR), to = Math.max(aL, bL);
    if (to <= from) return;
    cx = (from + to) / 2;
    length = to - from;
  } else {
    // Diagonal pair: no facing edges. The graph stays connected through the
    // side links, so no corridor is drawn rather than one crossing a room.
    return;
  }

  const node = new THREE.Group();
  node.position.set(cx, 0, cz);
  const w = vertical ? CORRIDOR_W : length;
  const d = vertical ? length : CORRIDOR_W;
  box(node, m.deck, w + 0.6, 0.06, d + 0.6, 0, -0.02, 0);
  box(node, m.floor, w, 0.05, d, 0, 0.03, 0);
  for (const side of [-1, 1]) {
    if (vertical) {
      box(node, m.wall, 0.2, 0.32, length, side * (CORRIDOR_W / 2 + 0.1), 0.16, 0);
      box(node, m.trim, 0.1, 0.07, length, side * (CORRIDOR_W / 2 + 0.1), 0.4, 0);
    } else {
      box(node, m.wall, length, 0.32, 0.2, 0, 0.16, side * (CORRIDOR_W / 2 + 0.1));
      box(node, m.trim, length, 0.07, 0.1, 0, 0.4, side * (CORRIDOR_W / 2 + 0.1));
    }
  }
  scene.add(node);
}

// ------------------------------------------------------------------- residents

/** Per-role visual identity, per VIS-006: silhouette, hair, clothing, accessory. */
interface CharacterDesign {
  /** Hair silhouette. */
  hair: 'swept' | 'bun' | 'ponytail' | 'cap' | 'short' | 'long' | 'slick';
  hairColor: number;
  /** Main clothing tone (the garment over the body). */
  cloth: number;
  /** A light garment panel (lab coat, cardigan, blazer) over the torso. */
  coat?: number;
  /** The role's signature accessory. */
  accessory: 'watch' | 'glasses' | 'tablet' | 'hood' | 'headset' | 'book' | 'brooch';
}

const CHARACTERS: Readonly<Record<Role, CharacterDesign>> = Object.freeze({
  // Hermes — coordinator: smart-casual jacket, teal trim, wrist tech, swept hair.
  coordinator: { hair: 'swept', hairColor: 0x3a2e26, cloth: 0x2e4a52, accessory: 'watch' },
  // Sage — researcher: long lab coat, glasses, hair bun, cyan palette.
  researcher: { hair: 'bun', hairColor: 0x5a4436, cloth: 0x3e5661, coat: 0xdfe6e8, accessory: 'glasses' },
  // Piper — planner: purple palette, high collar, planning tablet, ponytail.
  planner: { hair: 'ponytail', hairColor: 0x2c2430, cloth: 0x4a3f66, accessory: 'tablet' },
  // Forge — builder: orange hoodie with the hood down, cap.
  builder: { hair: 'cap', hairColor: 0x241c16, cloth: 0x6e4a2a, accessory: 'hood' },
  // Patch — tester: yellow technical vest, headset, short hair.
  tester: { hair: 'short', hairColor: 0x443626, cloth: 0x5e5a2e, accessory: 'headset' },
  // Echo — archivist: bronze cardigan, long hair, archive book.
  archivist: { hair: 'long', hairColor: 0x6b4a2a, cloth: 0x54412f, accessory: 'book' },
  // Vale — reviewer: green blazer, brooch, slicked hair.
  reviewer: { hair: 'slick', hairColor: 0x2e2a24, cloth: 0x2f4a3a, coat: 0x3c5c48, accessory: 'brooch' },
});

/** Skin tones shared across the roster — a small range, applied per figure. */
const SKIN = [0xe0c3a0, 0xc9a37a, 0xa87e5c, 0x8a6244] as const;
/** Assign a stable skin tone per role so a figure never changes between frames. */
const SKIN_FOR: Readonly<Record<Role, number>> = Object.freeze({
  coordinator: SKIN[0], researcher: SKIN[1], planner: SKIN[0], builder: SKIN[2],
  tester: SKIN[0], archivist: SKIN[3], reviewer: SKIN[1],
});

interface ResidentParts {
  /** Pivot groups so poses animate by rotation, not per-vertex work. */
  torso: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  /** Expression meshes, moved by state. */
  browL: THREE.Mesh;
  browR: THREE.Mesh;
  mouth: THREE.Mesh;
}

interface Figure {
  role: Role;
  group: THREE.Group;
  parts: ResidentParts;
  from: { x: number; z: number; yaw: number };
  to: { x: number; z: number; yaw: number };
  t: number;
  badges: Record<BadgeKind, THREE.Mesh>;
  /** HA-035: the screen-space name plate above the figure, toggled from the HUD. */
  plate: THREE.Sprite;
  /** One-shot completion acknowledgement, keyed by clock time. */
  flashUntil: number;
  /** True while working at the home room's own desk: takes the seated pose. */
  seated: boolean;
}

type BadgeKind = 'queued' | 'waiting' | 'alert' | 'unknown';

/** A stylized resident with anatomy, clothing, hair and a role accessory (VIS-006). */
function buildResident(group: THREE.Group, m: Materials, role: Role): ResidentParts {
  const design = CHARACTERS[role];
  const accent = new THREE.Color(ROSTER[role].accent);
  const skinMat = m.person.clone() as THREE.MeshStandardMaterial;
  skinMat.color.set(SKIN_FOR[role]);
  const clothMat = m.personAlt.clone() as THREE.MeshStandardMaterial;
  clothMat.color.set(design.cloth);
  const trimMat = m.personAlt.clone() as THREE.MeshStandardMaterial;
  trimMat.color.copy(accent);
  const hairMat = m.personAlt.clone() as THREE.MeshStandardMaterial;
  hairMat.color.set(design.hairColor);

  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh =>
    new THREE.Mesh(geo, mat);

  // --- legs (pivot at the hip so walking reads as a stride) -----------------------
  const legGeo = new THREE.CapsuleGeometry(0.095, 0.5, 4, 10);
  const shoeGeo = new THREE.BoxGeometry(0.2, 0.1, 0.32);
  const shoeMat = m.furniture;
  const legL = new THREE.Group();
  legL.position.set(-0.13, 0.62, 0);
  const legLMesh = mesh(legGeo, clothMat);
  legLMesh.position.y = -0.31;
  legL.add(legLMesh);
  const shoeL = mesh(shoeGeo, shoeMat);
  shoeL.position.set(0, -0.57, 0.04);
  legL.add(shoeL);
  const legR = new THREE.Group();
  legR.position.set(0.13, 0.62, 0);
  const legRMesh = mesh(legGeo, clothMat);
  legRMesh.position.y = -0.31;
  legR.add(legRMesh);
  const shoeR = mesh(shoeGeo, shoeMat);
  shoeR.position.set(0, -0.57, 0.04);
  legR.add(shoeR);
  group.add(legL, legR);

  // --- torso (pivot at the hip, so a working lean bends naturally) ---------------
  const torso = new THREE.Group();
  torso.position.set(0, 0.62, 0);
  const torsoMesh = mesh(new THREE.CapsuleGeometry(0.24, 0.46, 4, 12), clothMat);
  torsoMesh.position.y = 0.42;
  torso.add(torsoMesh);
  // Shoulders widen the silhouette above the waist.
  const shoulders = mesh(new THREE.CapsuleGeometry(0.2, 0.34, 4, 12), clothMat);
  shoulders.rotation.z = Math.PI / 2;
  shoulders.position.y = 0.66;
  torso.add(shoulders);
  if (design.coat) {
    // A light overgarment panel down the front — lab coat, cardigan or blazer.
    const coatMat = m.personAlt.clone() as THREE.MeshStandardMaterial;
    coatMat.color.set(design.coat);
    const coat = mesh(new THREE.BoxGeometry(0.5, 0.62, 0.34), coatMat);
    coat.position.set(0, 0.4, 0.06);
    torso.add(coat);
    const lapelL = mesh(new THREE.BoxGeometry(0.06, 0.3, 0.04), coatMat);
    lapelL.position.set(-0.14, 0.66, 0.21);
    lapelL.rotation.z = 0.25;
    torso.add(lapelL);
    const lapelR = lapelL.clone();
    lapelR.position.x = 0.14;
    lapelR.rotation.z = -0.25;
    torso.add(lapelR);
  } else {
    // Trim stripe keeps the role's accent on the garment itself.
    const stripe = mesh(new THREE.BoxGeometry(0.5, 0.06, 0.36), trimMat);
    stripe.position.set(0, 0.3, 0.02);
    torso.add(stripe);
  }
  group.add(torso);

  // --- arms (pivot at the shoulder) -----------------------------------------------
  const armGeo = new THREE.CapsuleGeometry(0.075, 0.42, 4, 10);
  const handGeo = new THREE.SphereGeometry(0.075, 10, 8);
  const makeArm = (side: -1 | 1): THREE.Group => {
    const arm = new THREE.Group();
    arm.position.set(side * 0.32, 0.62, 0);
    const upper = mesh(armGeo, clothMat);
    upper.position.y = -0.28;
    arm.add(upper);
    const hand = mesh(handGeo, skinMat);
    hand.position.y = -0.56;
    arm.add(hand);
    return arm;
  };
  const armL = makeArm(-1);
  const armR = makeArm(1);
  torso.add(armL, armR);

  // --- head (pivot at the neck) ---------------------------------------------------
  const head = new THREE.Group();
  head.position.set(0, 1.26, 0);
  const skull = mesh(new THREE.SphereGeometry(0.21, 16, 12), skinMat);
  skull.scale.set(1, 1.08, 0.96);
  head.add(skull);
  // Hair cap: a slightly larger hemisphere shell over the skull's top.
  const hairCap = mesh(new THREE.SphereGeometry(0.225, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
  hairCap.scale.set(1.02, 1.1, 1.0);
  head.add(hairCap);
  // Role hairstyle shapes on the cap.
  if (design.hair === 'bun') {
    const bun = mesh(new THREE.SphereGeometry(0.09, 10, 8), hairMat);
    bun.position.set(0, 0.16, -0.18);
    head.add(bun);
  } else if (design.hair === 'ponytail') {
    const tail = mesh(new THREE.CapsuleGeometry(0.06, 0.3, 4, 8), hairMat);
    tail.position.set(0, 0.02, -0.24);
    tail.rotation.x = 0.5;
    head.add(tail);
  } else if (design.hair === 'cap') {
    const brim = mesh(new THREE.BoxGeometry(0.3, 0.03, 0.16), hairMat);
    brim.position.set(0, 0.06, 0.24);
    head.add(brim);
  } else if (design.hair === 'long') {
    const fall = mesh(new THREE.BoxGeometry(0.3, 0.4, 0.12), hairMat);
    fall.position.set(0, -0.14, -0.14);
    head.add(fall);
  } else if (design.hair === 'swept') {
    const quiff = mesh(new THREE.BoxGeometry(0.2, 0.08, 0.18), hairMat);
    quiff.position.set(0.04, 0.2, 0.1);
    quiff.rotation.x = -0.4;
    head.add(quiff);
  } else if (design.hair === 'slick') {
    const side = mesh(new THREE.BoxGeometry(0.4, 0.14, 0.3), hairMat);
    side.position.set(0, 0.12, -0.02);
    head.add(side);
  }
  // Face: eyes, brows, mouth — small dark meshes on the skull's front.
  const eyeMat = m.furniture;
  for (const side of [-1, 1]) {
    const eye = mesh(new THREE.SphereGeometry(0.028, 8, 6), eyeMat);
    eye.position.set(side * 0.075, 0.02, 0.19);
    head.add(eye);
  }
  const browGeo = new THREE.BoxGeometry(0.06, 0.016, 0.014);
  const browL = mesh(browGeo, hairMat);
  browL.position.set(-0.075, 0.08, 0.2);
  head.add(browL);
  const browR = mesh(browGeo, hairMat);
  browR.position.set(0.075, 0.08, 0.2);
  head.add(browR);
  const mouth = mesh(new THREE.BoxGeometry(0.07, 0.018, 0.014), eyeMat);
  mouth.position.set(0, -0.08, 0.2);
  head.add(mouth);
  // Role accessory.
  if (design.accessory === 'glasses') {
    for (const side of [-1, 1]) {
      const lens = mesh(new THREE.TorusGeometry(0.045, 0.012, 6, 14), trimMat);
      lens.position.set(side * 0.075, 0.02, 0.2);
      head.add(lens);
    }
    const bridge = mesh(new THREE.BoxGeometry(0.06, 0.014, 0.014), trimMat);
    bridge.position.set(0, 0.02, 0.2);
    head.add(bridge);
  } else if (design.accessory === 'headset') {
    const band = mesh(new THREE.TorusGeometry(0.22, 0.02, 6, 18, Math.PI), trimMat);
    band.rotation.y = Math.PI / 2;
    band.rotation.z = 0;
    band.position.y = 0.03;
    head.add(band);
    for (const side of [-1, 1]) {
      const cup = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 10), trimMat);
      cup.rotation.z = Math.PI / 2;
      cup.position.set(side * 0.21, 0.0, 0);
      head.add(cup);
    }
  } else if (design.accessory === 'hood') {
    const hood = mesh(new THREE.TorusGeometry(0.2, 0.045, 6, 16), clothMat);
    hood.position.set(0, 0.1, -0.16);
    hood.rotation.x = Math.PI / 2.6;
    torso.add(hood); // hood rests around the neck, not on the head
  }
  group.add(head);

  // Held or worn items on the torso.
  if (design.accessory === 'watch') {
    const watch = mesh(new THREE.TorusGeometry(0.05, 0.016, 6, 10), trimMat);
    watch.rotation.x = Math.PI / 2;
    watch.position.set(0.32, 0.6, 0.08);
    torso.add(watch);
  } else if (design.accessory === 'tablet') {
    const tablet = mesh(new THREE.BoxGeometry(0.24, 0.32, 0.02), m.furniture);
    tablet.position.set(-0.2, 0.52, 0.28);
    tablet.rotation.y = 0.4;
    torso.add(tablet);
    const tabletScreen = mesh(new THREE.BoxGeometry(0.2, 0.27, 0.005), m.screen);
    tabletScreen.position.set(-0.2, 0.52, 0.293);
    tabletScreen.rotation.y = 0.4;
    torso.add(tabletScreen);
  } else if (design.accessory === 'book') {
    const book = mesh(new THREE.BoxGeometry(0.2, 0.26, 0.06), m.shelf);
    book.position.set(0.26, 0.5, 0.16);
    book.rotation.y = -0.5;
    torso.add(book);
  } else if (design.accessory === 'brooch') {
    const brooch = mesh(new THREE.SphereGeometry(0.035, 8, 6), trimMat);
    brooch.position.set(0.12, 0.6, 0.22);
    torso.add(brooch);
  }

  return { torso, head, armL, armR, legL, legR, browL, browR, mouth };
}

// ---------------------------------------------------------------------- labels

/** Draw a text plate onto a shared canvas texture cache. */
function canvasTexture(cache: Map<string, THREE.Texture>, track: Track, key: string,
                       w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.Texture {
  let texture = cache.get(key);
  if (!texture) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext('2d');
    if (context) draw(context);
    texture = track(new THREE.CanvasTexture(canvas));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    cache.set(key, texture);
  }
  return texture;
}

/** A flat pill-shaped label plate lying on the floor (the mock's room labels). */
function flatLabel(track: Track, cache: Map<string, THREE.Texture>,
                   text: string, width: number): THREE.Mesh {
  const texture = canvasTexture(cache, track, `label:${text}`, 512, 128, (c) => {
    c.clearRect(0, 0, 512, 128);
    c.beginPath();
    c.roundRect(10, 14, 492, 100, 50);
    c.fillStyle = 'rgba(10,14,18,0.92)';
    c.fill();
    c.lineWidth = 6;
    c.strokeStyle = '#ff7a3c';
    c.stroke();
    c.font = '700 54px system-ui, "Segoe UI", Inter, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineWidth = 8;
    c.strokeStyle = 'rgba(6,10,14,0.9)';
    c.strokeText(text, 256, 66);
    c.fillStyle = '#f3ead8';
    c.fillText(text, 256, 66);
  });
  const material = track(new THREE.MeshBasicMaterial({
    map: texture, transparent: true, depthWrite: false, toneMapped: false,
  }));
  const plane = new THREE.Mesh(track(new THREE.PlaneGeometry(width, width * 0.25)), material);
  plane.rotation.x = -Math.PI / 2;
  plane.renderOrder = 2;
  return plane;
}

/** A small name pill beside a figure ("Researcher", "Coder", ...). */
function namePill(track: Track, cache: Map<string, THREE.Texture>, text: string): THREE.Mesh {
  const texture = canvasTexture(cache, track, `name:${text}`, 256, 96, (c) => {
    c.clearRect(0, 0, 256, 96);
    c.beginPath();
    c.roundRect(8, 14, 240, 68, 34);
    c.fillStyle = 'rgba(10,14,18,0.9)';
    c.fill();
    c.lineWidth = 4;
    c.strokeStyle = '#ff9a5c';
    c.stroke();
    c.font = '600 34px system-ui, "Segoe UI", Inter, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#ffffff';
    c.fillText(text, 128, 50);
  });
  const material = track(new THREE.MeshBasicMaterial({
    map: texture, transparent: true, depthWrite: false, toneMapped: false,
  }));
  const plane = new THREE.Mesh(track(new THREE.PlaneGeometry(1.5, 1.5 * 96 / 256)), material);
  plane.rotation.x = -Math.PI / 2;
  plane.renderOrder = 2;
  return plane;
}

/** The facility name, flat on the hub's floor like the mock's wordmark. */
function hubWordmark(track: Track, cache: Map<string, THREE.Texture>): THREE.Mesh {
  const texture = canvasTexture(cache, track, 'wordmark', 512, 160, (c) => {
    c.clearRect(0, 0, 512, 160);
    c.font = '700 64px system-ui, "Segoe UI", Inter, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#eef4f8';
    c.fillText('HERMES', 256, 62);
    c.font = '500 26px system-ui, "Segoe UI", Inter, sans-serif';
    c.fillStyle = '#9adff0';
    c.fillText('L I F E   A G E N A', 256, 118);
  });
  const material = track(new THREE.MeshBasicMaterial({
    map: texture, transparent: true, depthWrite: false, toneMapped: false,
  }));
  const plane = new THREE.Mesh(track(new THREE.PlaneGeometry(4.4, 4.4 * 160 / 512)), material);
  plane.rotation.x = -Math.PI / 2;
  plane.renderOrder = 2;
  return plane;
}

/** Deep-space backdrop: nebula gradients plus a deterministic starfield. */
function starfield(track: Track): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 576;
  const c = canvas.getContext('2d')!;
  const g = c.createLinearGradient(0, 0, 1024, 576);
  g.addColorStop(0, '#050e23');
  g.addColorStop(0.45, '#122442');
  g.addColorStop(0.75, '#1e1633');
  g.addColorStop(1, '#030a18');
  c.fillStyle = g;
  c.fillRect(0, 0, 1024, 576);
  for (const [x, y, r, rgba] of [
    [820, 160, 260, 'rgba(140,60,140,0.28)'],
    [150, 90, 200, 'rgba(60,100,190,0.30)'],
    [430, 460, 300, 'rgba(20,40,90,0.25)'],
  ] as const) {
    const cloud = c.createRadialGradient(x, y, 8, x, y, r);
    cloud.addColorStop(0, rgba);
    cloud.addColorStop(1, 'rgba(10,16,40,0)');
    c.fillStyle = cloud;
    c.fillRect(0, 0, 1024, 576);
  }
  const random = seeded(20771);
  for (let i = 0; i < 420; i++) {
    const x = random() * 1024, y = random() * 576;
    const r = random() < 0.08 ? 1.5 : 0.3 + random() * 0.7;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fillStyle = `rgba(215,235,255,${0.25 + random() * 0.7})`;
    c.fill();
  }
  const texture = track(new THREE.CanvasTexture(canvas));
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// ------------------------------------------------------------------- renderer

/** Rooms by their model location, for state → spot mapping. */
function roomForRole(role: Role): Room {
  const room = ROOMS.find(r => r.role === role);
  if (!room) throw new Error(`No room for role ${role}`);
  return room;
}

/** Where a role stands inside its room (its own desk or the hub stage). */
function spotIn(room: Room, role: Role): { x: number; z: number; yaw: number } {
  if (room.id === 'control_room') return { x: room.x, z: room.z + 1.6, yaw: Math.PI };
  // Stand beside the room's main desk row.
  return { x: room.x - 1.2, z: room.z + 0.2, yaw: Math.PI };
}

const WALK_SECONDS = 0.8;
const MAX_DT = 0.05;

export function createV2Renderer(host: HTMLElement, opts: { motion: boolean }): TownRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  const disposables: Array<{ dispose(): void }> = [];
  const track: Track = resource => { disposables.push(resource); return resource; };
  const textureCache = new Map<string, THREE.Texture>();
  scene.background = starfield(track);
  scene.fog = new THREE.Fog(0x0a1220, 120, 320);

  // Perspective "operations-centre" eye (spec §11, decided 2026-11-23): a raised
  // view of the facility, not the old top-down floor plan. Framing is a
  // corner fit (town-camera.ts) so the facility fills the stage and nothing is
  // cropped; the pose is driven by mode (overview | focus).
  const camera = new THREE.PerspectiveCamera(DEFAULT_FOV, 1, 0.1, 600);

  const FACILITY = facilityBounds(ROOMS);

  type CamMode = 'overview' | 'focus';
  let camMode: CamMode = 'overview';
  let focusedRoomId: string | null = null;
  let pose: CameraPose | null = null;
  let poseFrom: CameraPose | null = null;
  let poseTo: CameraPose | null = null;
  let poseT = 1;
  const CAM_SECONDS = 0.55;

  const applyPose = (p: CameraPose) => {
    camera.position.set(p.position.x, p.position.y, p.position.z);
    camera.lookAt(p.target.x, p.target.y, p.target.z);
    camera.fov = p.fov;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  };

  const desiredPose = (aspect: number): CameraPose => {
    if (camMode === 'focus' && focusedRoomId) {
      const room = ROOMS.find(r => r.id === focusedRoomId);
      if (room) {
        return frameBounds(roomBounds(room), {
          aspect, margin: 1.5, elevationDeg: FOCUS_ELEVATION, azimuthDeg: FOCUS_AZIMUTH,
        });
      }
    }
    return frameBounds(FACILITY, {
      aspect, margin: OVERVIEW_MARGIN, elevationDeg: OVERVIEW_ELEVATION, azimuthDeg: GRID_AZIMUTH,
    });
  };

  /** Move the camera to the pose for the current mode. Animates when motion is on. */
  const setPoseForMode = (animate: boolean) => {
    const rect = host.getBoundingClientRect();
    const aspect = rect.height > 0 ? Math.max(0.2, rect.width / rect.height) : 1.5;
    const next = desiredPose(aspect);
    if (pose && animate && motion) {
      poseFrom = pose; poseTo = next; poseT = 0;
    } else {
      pose = next; applyPose(next);
    }
  };

  // Lighting: soft sky base, one white key from the top, warm bounce. Floors are
  // lit generously so interiors read at the top-down eye (the mock's rooms are
  // clearly lit, not silhouetted).
  scene.add(new THREE.HemisphereLight(0xd8e6f0, 0x35291c, 1.25));
  const key = new THREE.DirectionalLight(0xfff2e2, 2.3);
  key.position.set(6, 24, 4);
  scene.add(key);
  const warm = new THREE.DirectionalLight(0xff9a5c, 0.7);
  warm.position.set(-8, 10, 8);
  scene.add(warm);
  // Soft fill from the operator's side so the raised perspective view keeps near
  // walls and furniture legible instead of silhouetted.
  const fill = new THREE.DirectionalLight(0xbfd8e6, 0.5);
  fill.position.set(-10, 8, 16);
  scene.add(fill);

  const m = makeMaterials(track);

  const world = new THREE.Group();
  scene.add(world);

  // Corridors first (under rooms), then rooms.
  for (const [aId, bId] of LINKS) {
    const a = ROOMS.find(r => r.id === aId)!;
    const b = ROOMS.find(r => r.id === bId)!;
    buildCorridor(world, m, a, b);
  }
  for (const room of ROOMS) {
    buildRoom(world, m, room, textureCache, track);
  }

  // Central deck slab under everything, sized to the honeycomb — and kept
  // inside facilityBounds (z −13.6…15.0) so the slab edge is never cropped
  // by the tight HA-017 framing.
  box(world, m.deck, 43, 0.12, 28.6, 0, -0.08, 0.7);

  // The hub wordmark lies on the hub floor, above the stage ring.
  const wordmark = hubWordmark(track, textureCache);
  wordmark.position.set(0, 0.1, -3.9);
  world.add(wordmark);

  // A shared window texture: every room's rear window shows the same
  // starfield/nebula view the backdrop uses (the amendment's space-facing windows).
  textureCache.set('window', starfield(track));

  // Focus affordance (spec §11): a soft ring under the selected room.
  const focusRing = new THREE.Mesh(
    new THREE.RingGeometry(0.86, 1.0, 56),
    new THREE.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }));
  focusRing.rotation.x = -Math.PI / 2;
  focusRing.position.y = 0.22;
  focusRing.visible = false;
  scene.add(focusRing);
  track(focusRing.geometry);
  track(focusRing.material as THREE.Material);

  // --- residents ----------------------------------------------------------------
  // 2x: at the perspective operations-centre eye a 1.7-unit figure still reads
  // small on a wide stage; scaling the whole figure (body, pill, badges) keeps
  // proportions and keeps residents legible without a floor-plan zoom.
  const FIGURE_SCALE = 2.0;
  const figures: Figure[] = ROLES.map(role => {
    const room = roomForRole(role);
    const pill = namePill(track, textureCache, ROSTER[role].name);
    pill.position.set(0.85, 0.06, 0.35);
    const group = new THREE.Group();
    group.add(pill);
    scene.add(group);
    const parts = buildResident(group, m, role);
    // HA-035: the screen-space name plate above the figure — constant size at
    // any zoom, so identity stays legible from the overview framing.
    const plate = namePlate(track, ROSTER[role].name, FIGURE_SCALE);
    plate.position.set(0, 2.35, 0);
    group.add(plate);
    // Shape-distinct state badges (UI-VIS-003 milestone 3): shape alone tells
    // queued / waiting / alert / unknown apart, colour is never the only cue.
    const badgeMaterials = {
      queued: new THREE.MeshStandardMaterial({ color: 0xe8c45c, emissive: 0xe8c45c, emissiveIntensity: 0.45 }),
      waiting: new THREE.MeshStandardMaterial({ color: 0xf0a45c, emissive: 0xf0a45c, emissiveIntensity: 0.5 }),
      alert: new THREE.MeshStandardMaterial({ color: 0xe86a6a, emissive: 0xe86a6a, emissiveIntensity: 0.95 }),
      unknown: new THREE.MeshStandardMaterial({ color: 0x93a1ad, emissive: 0x93a1ad, emissiveIntensity: 0.15 }),
    };
    const badgeGeometries = {
      queued: new THREE.ConeGeometry(0.15, 0.28, 4),
      waiting: new THREE.TorusGeometry(0.18, 0.045, 8, 20),
      alert: new THREE.OctahedronGeometry(0.16),
      unknown: new THREE.IcosahedronGeometry(0.15),
    };
    const badges = {} as Record<BadgeKind, THREE.Mesh>;
    for (const kind of ['queued', 'waiting', 'alert', 'unknown'] as const) {
      const marker = new THREE.Mesh(badgeGeometries[kind], badgeMaterials[kind]);
      marker.position.y = 1.9;
      if (kind === 'waiting') marker.rotation.x = Math.PI / 2;
      marker.visible = false;
      group.add(marker);
      badges[kind] = marker;
      track(badgeGeometries[kind]);
      track(badgeMaterials[kind]);
    }
    const figure: Figure = {
      role, group, parts, badges, plate,
      from: { x: 0, z: 0, yaw: 0 }, to: { x: 0, z: 0, yaw: 0 }, t: 1, flashUntil: 0, seated: false,
    };
    const spot = spotIn(room, role);
    figure.from = { ...spot };
    figure.to = { ...spot };
    figure.group.position.set(spot.x, 0, spot.z);
    figure.group.rotation.y = spot.yaw;
    figure.group.scale.setScalar(FIGURE_SCALE);
    return figure;
  });

  // --- name plates (HA-035) -----------------------------------------------------
  // Toggled from the HUD the town view already owns, next to its Motion button.
  // That HUD's stylesheet lives elsewhere, so the button borrows the motion
  // button's metrics inline and the choice persists the same way.
  const LABELS_KEY = 'hermes-life-town-labels';
  let platesVisible = window.localStorage.getItem(LABELS_KEY) !== 'off';
  let labelsButton: HTMLButtonElement | null = null;
  const applyPlates = () => {
    for (const figure of figures) figure.plate.visible = platesVisible;
    if (labelsButton) {
      labelsButton.textContent = `Labels: ${platesVisible ? 'on' : 'off'}`;
      labelsButton.setAttribute('aria-pressed', String(platesVisible));
    }
  };
  const hud = document.querySelector<HTMLElement>('.town-hud');
  if (hud) {
    labelsButton = document.createElement('button');
    labelsButton.id = 'town-labels';
    labelsButton.type = 'button';
    labelsButton.style.cssText = 'margin:0;font-size:10.5px;padding:4px 9px;background:#22424b;'
      + 'color:#d6ece5;border:1px solid #436672;border-radius:6px;white-space:nowrap;flex:0 0 auto';
    labelsButton.addEventListener('click', () => {
      platesVisible = !platesVisible;
      window.localStorage.setItem(LABELS_KEY, platesVisible ? 'on' : 'off');
      applyPlates();
      if (!motion) draw();
    });
    hud.append(labelsButton);
  }
  applyPlates();

  // --- picking ------------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pickTargets: THREE.Object3D[] = [];
  for (const room of ROOMS) {
    const hit = new THREE.Mesh(
      new THREE.PlaneGeometry(room.w, room.d),
      new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(room.x, 0.2, room.z);
    hit.rotation.x = -Math.PI / 2;
    hit.userData.roomId = room.id;
    scene.add(hit);
    pickTargets.push(hit);
    track(hit.geometry);
  }

  const roomAt = (clientX: number, clientY: number): Room | null => {
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(pickTargets, false)[0];
    if (!hit) return null;
    return ROOMS.find(r => r.id === hit.object.userData.roomId) ?? null;
  };

  const canvas = renderer.domElement;
  canvas.setAttribute('aria-label', 'Hermes Life operations lab');
  canvas.setAttribute('role', 'img');

  const tooltip = document.createElement('div');
  tooltip.id = 'town-tooltip-v2';
  tooltip.className = 'town-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;

  let activities = new Map<Role, { state: Activity; location: LocationId; label: string }>();

  const textFor = (room: Room): string => {
    if (room.id === 'break_room') return 'Break Room · Non-operational environment';
    const present = ROLES.find(role => activities.get(role)?.location === ROSTER[role].location
      && roomForRole(role).id === room.id);
    const info = present ? activities.get(present!) : undefined;
    return info
      ? `${room.label} · ${ROSTER[present!].name} · ${stateWordFor(info.state)} — ${info.label}`
      : `${room.label} · ${locationLabel(ROSTER[room.role!].location)}`;
  };

  const onPointerMove = (event: PointerEvent) => {
    const room = roomAt(event.clientX, event.clientY);
    canvas.style.cursor = room ? 'pointer' : 'default';
    if (!room) { tooltip.hidden = true; return; }
    tooltip.textContent = textFor(room);
    tooltip.hidden = false;
    const rect = host.getBoundingClientRect();
    tooltip.style.left = `${event.clientX - rect.left}px`;
    tooltip.style.top = `${event.clientY - rect.top}px`;
  };
  const onPointerLeave = () => { tooltip.hidden = true; canvas.style.cursor = 'default'; };
  const onClick = (event: MouseEvent) => {
    const room = roomAt(event.clientX, event.clientY);
    if (!room) return;
    if (room.id === 'break_room') {
      window.dispatchEvent(new CustomEvent('hermesha:room:select', { detail: { room: room.id } }));
    } else if (room.role) {
      window.dispatchEvent(new CustomEvent('town:select', { detail: { role: room.role } }));
      window.dispatchEvent(new CustomEvent('town:building', { detail: { location: ROSTER[room.role].location } }));
    }
  };
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('click', onClick);

  mountInto(host, canvas, 'data-town-canvas');
  mountInto(host, tooltip, 'data-town-tooltip');

  // Keyboard access to the same two pick paths: rooms and residents are real
  // buttons, in the accessibility tree at all times and visually expanded only
  // while the group holds focus (CSS :focus-within on .town-access).
  const access = document.createElement('div');
  access.className = 'town-access';
  const groupOf = (label: string, entries: Array<{ text: string; run: () => void }>) => {
    const row = document.createElement('div');
    row.className = 'town-access-row';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', label);
    for (const entry of entries) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = entry.text;
      button.addEventListener('click', entry.run);
      row.append(button);
    }
    access.append(row);
  };
  groupOf('Rooms', ROOMS.map(room => ({
    text: room.label,
    run: () => {
      if (room.id === 'break_room') {
        window.dispatchEvent(new CustomEvent('hermesha:room:select', { detail: { room: room.id } }));
      } else if (room.role) {
        window.dispatchEvent(new CustomEvent('town:building', { detail: { location: ROSTER[room.role].location } }));
      }
    },
  })));
  groupOf('Residents', ROLES.map(role => ({
    text: ROSTER[role].name,
    run: () => window.dispatchEvent(new CustomEvent('town:select', { detail: { role } })),
  })));
  mountInto(host, access, 'data-town-access');

  // --- framing: fill the host box with the world (perspective) --------------------
  const resize = () => {
    const rect = host.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (width < 2 || height < 2) return;
    // HA-017: the world fills the whole host box. The old MAX_ASPECT=2.6
    // draw-width cap letterboxed wide viewports — half of why the facility sat
    // small in a dark void — so the canvas now takes every pixel it is offered.
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const aspect = width / height;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    // Re-fit the CURRENT mode for the new aspect, immediately: a panel opening is
    // a re-frame, not a crop.
    const next = desiredPose(aspect);
    pose = next;
    poseFrom = null; poseTo = null; poseT = 1;
    applyPose(next);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(width, height, true);
    if (!motion) draw();
  };

  // --- state and animation -------------------------------------------------------
  let motion = opts.motion;
  let handle = 0;
  let frames = 0;
  let clockMs = 0;
  let previous: number | null = null;
  const draw = () => { renderer.render(scene, camera); frames += 1; };

  const walkEase = (t: number) => {
    const clamped = Math.max(0, Math.min(1, t));
    return clamped * clamped * (3 - 2 * clamped);
  };

  const advance = (dt: number) => {
    for (const figure of figures) {
      if (figure.t < 1) figure.t = motion ? Math.min(1, figure.t + dt / WALK_SECONDS) : 1;
      const eased = walkEase(figure.t);
      const x = figure.from.x + (figure.to.x - figure.from.x) * eased;
      const z = figure.from.z + (figure.to.z - figure.from.z) * eased;
      figure.group.position.set(x, 0, z);
      figure.group.rotation.y = figure.to.yaw;

      const state = activities.get(figure.role)?.state ?? 'unknown';
      const seconds = clockMs / 1000;
      // Exactly one badge shows, chosen by shape (queued cone, waiting ring,
      // alert octahedron, unknown icosahedron). The waiting ring breathes.
      const badgeKind: BadgeKind | null =
        state === 'queued' ? 'queued'
        : state === 'waiting_approval' ? 'waiting'
        : state === 'failed' || state === 'blocked' ? 'alert'
        : state === 'unknown' ? 'unknown'
        : null;
      for (const kind of ['queued', 'waiting', 'alert', 'unknown'] as const) {
        figure.badges[kind].visible = kind === badgeKind;
        if (kind === 'waiting' && badgeKind) {
          figure.badges.waiting.scale.setScalar(motion ? 1 + Math.sin(seconds * 2.6) * 0.14 : 1);
        }
      }

      // Poses per VIS-006 §15: only `working` looks like work; waiting is still;
      // completed gets a short one-shot acknowledgement on a real transition.
      const p = figure.parts;
      const walking = figure.t < 1;
      if (walking) {
        const stride = Math.sin(figure.t * Math.PI * 5);
        p.legL.rotation.x = stride * 0.5;
        p.legR.rotation.x = -stride * 0.5;
        p.armL.rotation.x = -stride * 0.35;
        p.armR.rotation.x = stride * 0.35;
        p.torso.rotation.x = 0.04;
        figure.group.position.y = Math.abs(Math.sin(figure.t * Math.PI * 5)) * 0.03;
        p.head.rotation.x = 0;
        p.browL.rotation.z = 0;
        p.browR.rotation.z = 0;
      } else if (figure.seated) {
        // Working at the home desk: seated on the chair, hips at seat height,
        // thighs forward onto the chair, lean and forearms toward the screen.
        p.legL.rotation.x = -1.35;
        p.legR.rotation.x = -1.35;
        p.torso.rotation.x = 0.18;
        p.armL.rotation.x = -0.8;
        p.armR.rotation.x = -0.8;
        p.armL.rotation.z = -0.06;
        p.armR.rotation.z = 0.06;
        p.head.rotation.x = 0.14;
        p.browL.rotation.z = -0.12;
        p.browR.rotation.z = 0.12;
        figure.group.position.y = -0.12;
      } else if (state === 'working') {
        // Working without a seat in reach: stand and lean into the surface.
        p.legL.rotation.x = 0;
        p.legR.rotation.x = 0;
        p.torso.rotation.x = 0.14;
        p.armL.rotation.x = -0.72;
        p.armR.rotation.x = -0.72;
        p.armL.rotation.z = -0.06;
        p.armR.rotation.z = 0.06;
        p.head.rotation.x = 0.14;
        p.browL.rotation.z = -0.12;
        p.browR.rotation.z = 0.12;
        figure.group.position.y = motion ? Math.abs(Math.sin(seconds * 2)) * 0.015 : 0;
      } else if (state === 'failed' || state === 'blocked') {
        // Alert: stationary, brows angled, arms down.
        p.torso.rotation.x = 0;
        p.armL.rotation.x = 0;
        p.armR.rotation.x = 0;
        p.armL.rotation.z = 0;
        p.armR.rotation.z = 0;
        p.head.rotation.x = -0.04;
        p.browL.rotation.z = 0.3;
        p.browR.rotation.z = -0.3;
        figure.group.position.y = 0;
      } else if (state === 'queued' || state === 'waiting_approval' || state === 'unknown') {
        // Waiting: arms folded, deliberately still — never mistaken for work.
        p.torso.rotation.x = 0;
        p.armL.rotation.x = -1.05;
        p.armR.rotation.x = -1.05;
        p.armL.rotation.z = 0.45;
        p.armR.rotation.z = -0.45;
        p.head.rotation.x = 0;
        p.browL.rotation.z = 0;
        p.browR.rotation.z = 0;
        figure.group.position.y = 0;
      } else {
        // Idle and completed-resting: natural stance, subtle breathing.
        p.torso.rotation.x = 0;
        const flashing = figure.flashUntil > clockMs;
        p.armL.rotation.x = flashing ? -1.9 : motion ? Math.sin(seconds * 1.2) * 0.06 : 0;
        p.armR.rotation.x = flashing ? -1.9 : motion ? Math.sin(seconds * 1.2 + 0.6) * 0.06 : 0;
        p.armL.rotation.z = 0;
        p.armR.rotation.z = 0;
        p.legL.rotation.x = 0;
        p.legR.rotation.x = 0;
        p.head.rotation.x = 0;
        p.browL.rotation.z = 0;
        p.browR.rotation.z = 0;
        p.torso.position.y = 0.62 + (motion ? Math.sin(seconds * 1.6) * 0.008 : 0);
        figure.group.position.y = 0;
      }
    }
  };

  const stepCamera = (dt: number) => {
    if (poseT >= 1 || !poseFrom || !poseTo) return;
    poseT = Math.min(1, poseT + dt / CAM_SECONDS);
    pose = lerpPose(poseFrom, poseTo, poseT);
    applyPose(pose);
    if (poseT >= 1) { poseFrom = null; poseTo = null; }
  };

  const loop = (timestamp: number) => {
    handle = window.requestAnimationFrame(loop);
    if (document.hidden) { previous = null; return; }
    const dt = previous === null ? 0 : Math.min(MAX_DT, (timestamp - previous) / 1000);
    previous = timestamp;
    clockMs += dt * 1000;
    advance(dt);
    stepCamera(dt);
    draw();
  };
  if (motion) handle = window.requestAnimationFrame(loop);
  else draw();

  resize();

  const resolveRoom = (key: string): Room | null => {
    const direct = ROOMS.find(r => r.id === key);
    if (direct) return direct;
    // Accept a LocationId too (town:building passes one): resolve via the role
    // whose roster location matches.
    const role = ROLES.find(r => ROSTER[r].location === key);
    if (role) return ROOMS.find(r => r.role === role) ?? null;
    return null;
  };

  /** Zoom to a room (spec §2/§11 focus mode). */
  const focusRoom = (key: string) => {
    const room = resolveRoom(key);
    if (!room) return;
    camMode = 'focus';
    focusedRoomId = room.id;
    focusRing.visible = true;
    focusRing.position.set(room.x, 0.22, room.z);
    focusRing.scale.setScalar(Math.max(room.w, room.d) * 0.62);
    setPoseForMode(true);
    if (!motion) draw();
  };

  /** Return to the whole-facility framing. */
  const overview = () => {
    camMode = 'overview';
    focusedRoomId = null;
    focusRing.visible = false;
    setPoseForMode(true);
    if (!motion) draw();
  };

  return {
    kind: '3d',
    applyState(next: TownState) {
      const previousStates = new Map(activities);
      activities = new Map();
      for (const role of ROLES) {
        const resident = next.residents[role];
        activities.set(role, { state: resident.state, location: resident.location, label: resident.label });
      }
      for (const figure of figures) {
        const info = activities.get(figure.role);
        // A brief acknowledgement only when completed is genuinely entered —
        // a reload opening on a stale completed record stays still.
        const was = previousStates.get(figure.role)?.state;
        if (info?.state === 'completed' && was && was !== 'completed') {
          figure.flashUntil = clockMs + 900;
        }
        // A resident may be working in someone else's room: the model's location
        // decides which room they stand in, home included. At the home desk,
        // `working` takes the seated pose on the desk's own chair.
        const wanted = info?.location ?? ROSTER[figure.role].location;
        const room = ROOMS.find(r => r.role !== null && ROSTER[r.role].location === wanted)
          ?? roomForRole(figure.role);
        const spot = spotIn(room, figure.role);
        figure.seated = info?.state === 'working'
          && wanted === ROSTER[figure.role].location
          && room.id !== 'control_room';
        const target = figure.seated
          ? { x: spot.x, z: spot.z + 0.75, yaw: Math.PI }
          : spot;
        if (Math.abs(target.x - figure.to.x) > 1e-4 || Math.abs(target.z - figure.to.z) > 1e-4) {
          figure.from = { x: figure.group.position.x, z: figure.group.position.z, yaw: figure.to.yaw };
          figure.to = { ...target };
          figure.t = 0;
        } else {
          figure.to = { ...target };
        }
      }
      advance(0);
      draw();
    },
    setMotion(on: boolean) {
      motion = on;
      if (on) {
        if (!handle) { previous = null; handle = window.requestAnimationFrame(loop); }
      } else if (handle) {
        window.cancelAnimationFrame(handle);
        handle = 0;
        previous = null;
        advance(0);
        draw();
      }
    },
    resize,
    focusRoom,
    overview,
    positions(): RendererPoint[] {
      return figures.map(figure => {
        const projected = new THREE.Vector3(figure.group.position.x, 0.8, figure.group.position.z)
          .project(camera);
        const head = new THREE.Vector3(figure.group.position.x, 1.5, figure.group.position.z)
          .project(camera);
        return {
          role: figure.role,
          x: Math.round((projected.x + 1) / 2 * DESIGN.width),
          y: Math.round((1 - projected.y) / 2 * DESIGN.height),
          headX: Math.round((head.x + 1) / 2 * DESIGN.width),
          headY: Math.round((1 - head.y) / 2 * DESIGN.height),
          state: activities.get(figure.role)?.state ?? 'unknown',
          location: ROSTER[figure.role].location,
        };
      });
    },
    frames() { return frames; },
    destroy() {
      if (handle) window.cancelAnimationFrame(handle);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('click', onClick);
      tooltip.remove();
      access.remove();
      labelsButton?.remove();
      for (const resource of disposables) resource.dispose();
      textureCache.clear();
      pickTargets.length = 0;
      figures.length = 0;
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
