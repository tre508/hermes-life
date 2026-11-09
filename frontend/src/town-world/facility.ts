/**
 * The facility: the room, its architecture, its environmental detail, and the command centre.
 *
 * Composition rule for this file (audit v2 §2, §3, §5): **nothing here may end inside the camera
 * frame.** The deck is 30×23 against a frame that covers roughly 19×10 of world, and the two visible
 * walls are 5 units tall and 38–52 long, so their tops and ends are cropped. The viewer looks into a
 * building whose floor and walls continue out of sight, rather than at a platform on a plinth.
 *
 * Everything else is dressed architecture: a paved deck, a marked operations area with circulation, a
 * panelled wall with base trim, trim bands, lit fixtures, displays and storage, planters and benches —
 * so the facility still reads as a working building when every resident is idle (§12).
 *
 * The command centre is built here too (§8): a two-tier platform, an arc of consoles, a status display
 * and status lighting. None of it animates on its own — the renderer drives the emissive material from
 * real state and nothing else.
 */
import * as THREE from 'three';

import type { Role } from '../town-model';
import { ROSTER } from '../town-model';
import { DAIS, DECK, ROOM, SCALE, SHELL, type StationPlan } from './layout';
import { floorDecal } from './labels';
import type { Track } from './palette';
import {
  bench, cabinet, consoleUnit, contactPatch, crate, equipmentRack, group, holoPanel, lightBar,
  planter, put, wallSconce, wallScreen, type Builders,
} from './props';

/** The floor: one continuous deck that runs past the frame, with the operations area marked on it. */
function floorDeck(b: Builders, plan: StationPlan[]): THREE.Group {
  const node = group();
  put(node, b.g.box(DECK.width, DECK.height, DECK.depth), b.m.floor, 0, -DECK.height / 2, 0);

  // Paving seams. A floor with joints reads as a building; a blank plane reads as a display base.
  for (let x = -DECK.width / 2 + 2.4; x < DECK.width / 2 - 1.2; x += 2.4) {
    put(node, b.g.box(0.045, 0.014, DECK.depth - 1.2), b.m.floorSeam, x, 0.004, 0);
  }
  for (let z = -DECK.depth / 2 + 2.4; z < DECK.depth / 2 - 1.2; z += 2.4) {
    put(node, b.g.box(DECK.width - 1.2, 0.014, 0.045), b.m.floorSeam, 0, 0.004, z);
  }

  // The operations area, a shade lighter, so the departments sit inside a defined zone.
  put(node, b.g.box(ROOM.width, 0.03, ROOM.depth), b.m.zonePad, 0, 0.012, 0);

  // The plaza: a raised disc under the command centre, with a lit rim.
  put(node, b.g.cylinder(3.5, 3.6, 0.07, 48), b.m.plaza, 0, 0.035, 0);
  const rim = new THREE.Mesh(b.g.ring(3.42, 3.6, 56), b.m.floorLine);
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.075;
  node.add(rim);
  const inner = new THREE.Mesh(b.g.ring(2.62, 2.72, 48), b.m.floorLine);
  inner.rotation.x = -Math.PI / 2;
  inner.position.y = 0.075;
  node.add(inner);

  // Circulation: a walkway from the plaza to each department, and cross-hall lines.
  for (const entry of plan) {
    if (entry.role === 'coordinator') continue;
    const length = Math.hypot(entry.x, entry.z) - 2.4;
    const walk = new THREE.Mesh(b.g.box(0.5, 0.03, length), b.m.floor);
    walk.position.set(entry.x * 0.5, 0.055, entry.z * 0.5);
    walk.rotation.y = -Math.atan2(entry.z, entry.x) + Math.PI / 2;
    node.add(walk);
  }
  for (const x of [-7.2, -3.6, 3.6, 7.2]) put(node, b.g.box(0.05, 0.025, ROOM.depth - 1.4), b.m.floor, x, 0.045, 0);
  for (const z of [-3.6, 3.6]) put(node, b.g.box(ROOM.width - 1.4, 0.025, 0.05), b.m.floor, 0, 0.045, z);
  return node;
}

/**
 * One dressed wall: panel seams, base trim, two trim bands, a lit cornice, displays and storage.
 *
 * The wall is taller than the frame and longer than the room, so it reads as the back of a building
 * rather than as scenery with an end (§3, §5). Its visible stretch carries the detail; the rest is
 * cropped, which is exactly the point.
 */
function wallShell(b: Builders, plan: StationPlan[]): THREE.Group {
  const node = group();
  const thickness = 0.28;

  const build = (along: number, height: number, yaw: number, at: THREE.Vector3) => {
    const wall = group(at.x, 0, at.z, yaw);
    put(wall, b.g.box(thickness, height, along), b.m.wall, 0, height / 2, 0);
    // Base trim, a mid band and an upper band: three horizontals give the wall a storey line.
    put(wall, b.g.box(thickness + 0.07, 0.24, along), b.m.wallDetail, 0, 0.12, 0);
    for (const bandY of [2.42, height - 1.1]) {
      put(wall, b.g.box(thickness + 0.05, 0.07, along), b.m.wallTrim, 0, bandY, 0);
    }
    // Panel seams, so the surface has scale.
    const seams = Math.floor(along / 2.1);
    for (let index = 1; index < seams; index += 1) {
      const z = -along / 2 + (along / seams) * index;
      put(wall, b.g.box(thickness + 0.012, height - 0.6, 0.05), b.m.wallPanel, 0, height / 2 + 0.24, z);
    }
    // Lit fixtures along the wall, low and high, placed where the frame will see them.
    for (const z of [-6.4, 0, 6.4]) {
      for (const barY of [2.82, height - 0.62]) {
        const bar = lightBar(b, 2.4);
        bar.rotation.y = Math.PI / 2;
        bar.position.set(-thickness / 2 - 0.12, barY, z);
        wall.add(bar);
      }
      const sconce = wallSconce(b);
      sconce.rotation.y = -Math.PI / 2;
      sconce.position.set(-thickness / 2 - 0.1, 2.3, z + 3.2);
      wall.add(sconce);
    }
    return wall;
  };

  node.add(build(SHELL.depth, SHELL.wall, 0, new THREE.Vector3(-ROOM.width / 2, 0, 0)));
  const side = group(0, 0, -ROOM.depth / 2, Math.PI / 2);
  side.add(build(SHELL.width, SHELL.wall, 0, new THREE.Vector3(0, 0, 0)));
  node.add(side);

  // Displays and storage against the walls, clear of every station.
  const backX = -ROOM.width / 2 + 0.5;
  const displays: Array<[Role, number, number]> = [
    ['researcher', -4.2, 2.1], ['planner', -0.4, 2.1], ['builder', 3.4, 2.1],
    ['tester', -6.6, 3.65], ['archivist', 1.9, 3.65],
  ];
  for (const [role, z, y] of displays) {
    const screen = wallScreen(b, role, { width: 2.0, height: 1.15 });
    screen.position.set(backX, y, z);
    screen.rotation.y = -Math.PI / 2;
    node.add(screen);
  }
  const sideZ = -ROOM.depth / 2 + 0.5;
  for (const [role, x] of [['tester', -5.2], ['archivist', -1.4], ['reviewer', 2.6], ['planner', 6.2]] as const) {
    const screen = wallScreen(b, role, { width: 1.9, height: 1.1 });
    screen.position.set(x, 2.1, sideZ);
    node.add(screen);
  }
  for (const z of [-5.2, 5.0]) {
    const store = cabinet(b, { width: 0.6, height: 1.6, depth: 1.1 });
    store.rotation.y = Math.PI / 2;
    store.position.set(backX, 0, z);
    node.add(store);
  }
  for (const x of [-6.6, 5.6]) {
    const locker = cabinet(b, { width: 1.2, height: 1.4, depth: 0.5 });
    locker.position.set(x, 0, sideZ);
    node.add(locker);
  }
  const rack = equipmentRack(b, 'builder', { width: 0.8, height: 1.7 });
  rack.position.set(backX + 0.45, 0, -4.4);
  node.add(rack);
  const tray = group(-ROOM.width / 2 + 0.3, 3.9, 0);
  put(tray, b.g.box(0.24, 0.14, SHELL.depth - 0.6), b.m.housingLight, 0, 0, 0);
  node.add(tray);

  // A quiet corner away from the ring: somewhere the "idle" story is believable.
  node.add(place(planter(b, 1.15), 7.6, 0, 4.6));
  node.add(place(planter(b, 1.0), 7.9, 0, -4.4));
  node.add(place(planter(b, 0.95), -7.9, 0, 4.8));
  node.add(place(bench(b, 1.8), 6.2, 0, 4.9));
  node.add(place(crate(b, 0.46), 7.9, 0, 0.6));
  node.add(place(crate(b, 0.38), 7.9, 0.32, 0.6));
  // Storage out on the open floor, so the near foreground is not an empty plane. These sit inside the
  // band the camera actually sees (roughly 3 < x+z < 11 in front of the plaza), and stay low so they
  // never hide a resident behind them.
  node.add(place(cabinet(b, { width: 1.0, height: 1.15, depth: 0.55 }), 6.0, 0, 4.4));
  node.add(place(crate(b, 0.5), 7.1, 0, 3.6));
  node.add(place(bench(b, 1.6), 4.2, 0, 5.6));
  node.add(place(planter(b, 1.05), 8.2, 0, 2.2));
  node.add(place(planter(b, 0.95), -6.6, 0, 4.6));
  node.add(place(bench(b, 1.5), -7.4, 0, 2.4));
  node.add(place(crate(b, 0.44), -5.6, 0, 6.2));
  node.add(place(cabinet(b, { width: 0.9, height: 1.1, depth: 0.5 }), -4.4, 0, 7.2));
  return node;
}

/**
 * The command centre: the facility's focal point (§8).
 *
 * Two tiers, an arc of operator consoles, a status display and a ring of status lights. The emissive
 * parts use the coordinator's glow material, so the renderer brightens them when — and only when —
 * Hermes is genuinely working.
 */
export function buildCommandCentre(b: Builders, plan: StationPlan, track: Track): THREE.Group {
  const node = group();
  put(node, b.g.cylinder(DAIS.upper, DAIS.lower, DAIS.lowerHeight, 48), b.m.wallDetail, 0, DAIS.lowerHeight / 2, 0);
  put(node, b.g.cylinder(DAIS.upper - 0.45, DAIS.upper, DAIS.topHeight - DAIS.lowerHeight, 48), b.m.plaza, 0, DAIS.lowerHeight + (DAIS.topHeight - DAIS.lowerHeight) / 2, 0);
  const rim = new THREE.Mesh(b.g.ring(DAIS.upper - 0.16, DAIS.upper, 56), b.m.glow(plan.role));
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = DAIS.topHeight + 0.005;
  node.add(rim);
  const outerRim = new THREE.Mesh(b.g.ring(DAIS.lower - 0.1, DAIS.lower, 56), b.m.wallTrim);
  outerRim.rotation.x = -Math.PI / 2;
  outerRim.position.y = DAIS.lowerHeight + 0.005;
  node.add(outerRim);

  // An arc of consoles facing the room, with a gap at the front so Hermes is never hidden.
  for (const angle of [200, 250, 290, 340]) {
    const radians = (angle * Math.PI) / 180;
    const console_ = consoleUnit(b, plan.role, { width: 1.0, depth: 0.62 });
    console_.position.set(Math.cos(radians) * 1.62, DAIS.topHeight - 0.04, Math.sin(radians) * 1.62);
    console_.rotation.y = -radians + Math.PI / 2;
    node.add(console_);
  }

  // The primary status display, standing behind the centre on its own frame.
  const frame = group(0, 0, -1.05);
  put(frame, b.g.box(2.6, 0.09, 0.5), b.m.deskFrame, 0, 1.1, 0);
  for (const dx of [-1, 1]) put(frame, b.g.box(0.09, 1.15, 0.12), b.m.deskFrame, dx * 1.25, 0.55, 0);
  const status = wallScreen(b, plan.role, { width: 2.3, height: 1.2 });
  status.position.set(0, 1.72, -1.0);
  node.add(status);
  node.add(frame);

  // A holographic ring and a ring of status lights: the futuristic accent, nothing more.
  const holo = new THREE.Mesh(b.g.torus(0.95, 0.018, Math.PI * 2), b.m.glow(plan.role));
  holo.rotation.x = Math.PI / 2;
  holo.position.y = DAIS.topHeight + 1.32;
  node.add(holo);
  const holoPanelNode = holoPanel(b, plan.role, { width: 1.3, height: 0.7 });
  holoPanelNode.position.set(0, DAIS.topHeight + 0.72, 0.9);
  holoPanelNode.rotation.y = Math.PI * 0.25;
  node.add(holoPanelNode);
  for (let index = 0; index < 12; index += 1) {
    const radians = (index / 12) * Math.PI * 2;
    put(node, b.g.cylinder(0.035, 0.035, 0.03, 8), b.m.led,
      Math.cos(radians) * (DAIS.upper - 0.3), DAIS.topHeight + 0.012, Math.sin(radians) * (DAIS.upper - 0.3));
  }

  // Command Center, painted on the plaza apron rather than floating above the dais (§9).
  const decal = floorDecal(track, plan.label, ROSTER.coordinator.accent, 2.2);
  decal.position.set(0, 0.078, 2.9);
  node.add(decal);

  // Contact shading: the platform is lit from above, so the floor around it needs to receive it (§3).
  const grounding = contactPatch(b, DAIS.lower + 0.5);
  grounding.position.y = 0.02;
  node.add(grounding);

  return node;
}

/** Everything that is architecture rather than a person or a state indicator. */
export function buildFacility(b: Builders, plan: StationPlan[]): THREE.Group {
  const node = group();
  node.add(floorDeck(b, plan));
  node.add(wallShell(b, plan));
  return node;
}

function place(node: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D {
  node.position.set(x, y, z);
  return node;
}