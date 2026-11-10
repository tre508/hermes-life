/**
 * Hermesha Command Centre — Phase 2 physical architecture.
 *
 * This is PRESENTATION ONLY. Eight physical rooms share seven existing backend
 * roles and model LocationIds. The Break Room does not introduce a role or API.
 * Coordinates are in camera-aligned U/V axes, transformed to the renderer's
 * X/Z axes by a 45 degree rotation.
 */
import * as THREE from 'three';
import type { Role } from '../town-model';
import type { Builders } from './props';
import type { Track } from './palette';
import { floorDecal } from './labels';
import { buildRoomArt, createShipArtKit, decorateShipCorridor, type ShipArtKit } from './ship-art';

export type PhysicalRoomId =
  | 'director_office' | 'research_station' | 'review_station'
  | 'dev_station' | 'control_room' | 'lab' | 'archive' | 'break_room';

export interface PhysicalRoom {
  id: PhysicalRoomId;
  label: string;
  u: number;
  v: number;
  width: number;
  depth: number;
  owner: Role | null;
}

// VIS-008: horizontal spread and tighter vertical room positions, without role changes.
// VIS-007: Wider room footprints create a continuous visual hull, rather
// than small isolated office modules; backend role anchors stay unchanged.
// U increases right on screen, V increases toward the camera / bottom of image.
// VIS-010: Facility widened and vertically compressed to fill a wide canvas
// without clipping — ~23u horizontal span, ~11v vertical span.
export const PHYSICAL_ROOMS: readonly PhysicalRoom[] = [
  { id: 'director_office', label: 'DIRECTOR OFFICE', u: 0, v: -5.5, width: 8.1, depth: 6.4, owner: 'planner' },
  { id: 'research_station', label: 'RESEARCH STATION', u: -11.5, v: -3.5, width: 7.8, depth: 6.5, owner: 'researcher' },
  { id: 'review_station', label: 'REVIEW STATION', u: 11.5, v: -3.5, width: 7.8, depth: 6.5, owner: 'reviewer' },
  { id: 'dev_station', label: 'DEV STATION', u: -11.5, v: 2.0, width: 8.0, depth: 6.6, owner: 'builder' },
  { id: 'control_room', label: 'CONTROL ROOM', u: 0, v: 0, width: 8.5, depth: 8.0, owner: 'coordinator' },
  { id: 'lab', label: 'LAB', u: 11.5, v: 2.0, width: 8.0, depth: 6.6, owner: 'tester' },
  { id: 'archive', label: 'ARCHIVE', u: -11.5, v: 5.5, width: 8.0, depth: 6.3, owner: 'archivist' },
  { id: 'break_room', label: 'BREAK ROOM', u: 11.5, v: 5.5, width: 8.0, depth: 6.3, owner: null },
] as const;

export function roomToWorld(u: number, v: number): { x: number; z: number } {
  const k = Math.SQRT1_2;
  return { x: (u + v) * k, z: (v - u) * k };
}

export function roomForRole(role: Role): PhysicalRoom {
  const room = PHYSICAL_ROOMS.find(item => item.owner === role);
  if (!room) throw new Error(`No physical room assigned to role ${role}`);
  return room;
}

function addBox(
  b: Builders, parent: THREE.Group, material: THREE.Material,
  width: number, height: number, depth: number, x: number, y: number, z: number,
): void {
  const mesh = new THREE.Mesh(b.g.box(width, height, depth), material);
  mesh.position.set(x, y, z);
  parent.add(mesh);
}

function roomArchitecture(b: Builders, room: PhysicalRoom, track: Track, art: ShipArtKit): THREE.Group {
  const node = new THREE.Group();
  node.name = `room-${room.id}`;
  const p = roomToWorld(room.u, room.v);
  node.position.set(p.x, 0, p.z);
  node.rotation.y = Math.PI / 4;

  const halfW = room.width / 2;
  const halfD = room.depth / 2;
  // Raised room floor. Furniture is above it; the backend-controlled station
  // geometry remains intact and is still located at its own logical anchor.
  addBox(b, node, b.m.slate, room.width + 0.14, 0.11, room.depth + 0.14, 0, -0.055, 0);
  addBox(b, node, b.m.zonePad, room.width - 0.22, 0.017, room.depth - 0.22, 0, 0.016, 0);
  for (let u = -halfW + 0.65; u < halfW - 0.35; u += 1.1) {
    addBox(b, node, b.m.floorSeam, 0.018, 0.012, room.depth - 0.44, u, 0.03, 0);
  }

  // Segmented rear and side walls with a central doorway on the front wall.
  // Camera-facing outer edges are deliberately low, keeping resident
  // visibility while retaining enclosed, recognizable room footprints.
  const tall = 1.65;
  const low = 0.68;
  const thickness = 0.15;
  const opening = 1.65;
  addBox(b, node, b.m.wall, room.width, tall, thickness, 0, tall / 2, -halfD);
  addBox(b, node, b.m.wallDetail, room.width, 0.12, thickness + 0.05, 0, tall - 0.06, -halfD);
  for (const side of [-1, 1]) {
    const x = side * halfW;
    const h = side < 0 ? tall : low;
    addBox(b, node, b.m.wall, thickness, h, room.depth, x, h / 2, 0);
    addBox(b, node, b.m.wallDetail, thickness + 0.04, 0.10, room.depth, x, h - 0.05, 0);
  }
  const sideLength = (room.width - opening) / 2;
  for (const sign of [-1, 1]) {
    const x = sign * (opening / 2 + sideLength / 2);
    addBox(b, node, b.m.wall, sideLength, low, thickness, x, low / 2, halfD);
    addBox(b, node, b.m.wallTrim, sideLength, 0.085, thickness + 0.08, x, low, halfD);
    // Warm corridor lighting around the doorway; emissive material keeps
    // lighting cheap on integrated graphics.
    addBox(b, node, b.m.led, 0.12, 0.22, thickness + 0.09, sign * (opening / 2 + 0.05), 0.16, halfD);
  }
  // Entry threshold visibly connects room to corridor.
  addBox(b, node, b.m.wallTrim, opening, 0.035, 0.48, 0, 0.035, halfD + 0.12);

  // Unambiguous room identity independent of the seven backend station signs.
  const label = floorDecal(track, room.label, '#9adff0', Math.min(room.width - 0.9, 3.6));
  label.position.set(0, 0.045, halfD - 0.68);
  node.add(label);

  // Exterior window / sci-fi visor on the far wall. This is a static
  // material treatment, not a fake operational/status screen.
  addBox(b, node, b.m.housing, Math.min(2.6, room.width - 1), 0.55, 0.035, 0, 1.14, -halfD + 0.13);
  addBox(b, node, b.m.glow(room.owner ?? 'coordinator'), Math.min(2.25, room.width - 1.3), 0.035, 0.05, 0, 1.42, -halfD + 0.18);
  node.add(buildRoomArt(b, room, art));
  return node;
}

function corridor(b: Builders, from: PhysicalRoom, to: PhysicalRoom, art: ShipArtKit): THREE.Group {
  const node = new THREE.Group();
  const a = roomToWorld(from.u, from.v);
  const z = roomToWorld(to.u, to.v);
  const dx = z.x - a.x, dz = z.z - a.z;
  const distance = Math.hypot(dx, dz);
  // VIS-007: substantial corridor decks and illuminated containment rails.
  const width = 2.35;
  const yaw = Math.atan2(dx, dz);
  node.position.set((a.x + z.x) / 2, 0, (a.z + z.z) / 2);
  node.rotation.y = yaw;
  addBox(b, node, art.hull, width + 0.72, 0.11, distance, 0, -0.09, 0);
  addBox(b, node, b.m.floor, width, 0.018, distance, 0, -0.018, 0);
  for (const sign of [-1, 1]) {
    addBox(b, node, art.steel, 0.18, 0.16, distance, sign * (width / 2 + 0.14), -0.014, 0);
    addBox(b, node, art.warm, 0.09, 0.045, Math.max(0.1, distance - 0.4),
      sign * (width / 2 + 0.14), 0.082, 0);
  }
  decorateShipCorridor(b, node, distance, art);
  return node;
}

/** Eight visual rooms, seven existing roles. This does not change backend state. */
export function buildShipRooms(b: Builders, track: Track): THREE.Group {
  const root = new THREE.Group();
  root.name = 'Hermesha Command Centre';
  const art = createShipArtKit(track);
  const center = PHYSICAL_ROOMS.find(room => room.id === 'control_room')!;
  // Corridors are built before room floors so door thresholds remain legible.
  const links: [PhysicalRoomId, PhysicalRoomId][] = [
    ['control_room', 'director_office'],
    ['control_room', 'research_station'],
    ['control_room', 'review_station'],
    ['control_room', 'dev_station'],
    ['control_room', 'lab'],
    ['control_room', 'archive'],
    ['control_room', 'break_room'],
    ['research_station', 'dev_station'],
    ['dev_station', 'archive'],
    ['review_station', 'lab'],
    ['lab', 'break_room'],
  ];
  for (const [fromId, toId] of links) {
    const from = PHYSICAL_ROOMS.find(r => r.id === fromId) ?? center;
    const to = PHYSICAL_ROOMS.find(r => r.id === toId)!;
    root.add(corridor(b, from, to, art));
  }
  for (const room of PHYSICAL_ROOMS) root.add(roomArchitecture(b, room, track, art));
  return root;
}
