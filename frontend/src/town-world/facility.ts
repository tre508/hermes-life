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

import { ROSTER } from '../town-model';
import { DAIS, type StationPlan } from './layout';
import { floorDecal } from './labels';
import { buildShipRooms } from './ship-rooms';
import type { Track } from './palette';
import {
  consoleUnit, contactPatch, group, put, wallScreen, type Builders,
} from './props';

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

  // The coordinator's own work surface. Every other resident sits at a desk, but the dais only has
  // consoles on its rim and nothing in front of the person standing at its centre — so a working
  // Hermes had no surface to put his hands on. A standing console closes that gap, at the height his
  // forearms actually fall to (a waist-high desk, not a thigh-high box).
  // The coordinator stands 0.3 forward along `plan.yaw` and the dais itself is built unrotated, so the
  // console has to be placed and turned along that same facing — otherwise it sits a half-metre to his
  // side and only one hand lands on it.
  const lectern = group(0.8 * Math.sin(plan.yaw), 0, 0.8 * Math.cos(plan.yaw));
  lectern.rotation.y = plan.yaw;
  put(lectern, b.g.bevel(1.24, 1.0, 0.5), b.m.housing, 0, DAIS.topHeight + 0.5, 0);
  put(lectern, b.g.bevel(1.3, 0.05, 0.54), b.m.alu, 0, DAIS.topHeight + 1.02, 0);
  put(lectern, b.g.box(0.86, 0.035, 0.2), b.m.wallTrim, 0, DAIS.topHeight + 1.05, -0.12);
  for (let index = 0; index < 5; index += 1) {
    put(lectern, b.g.box(0.72, 0.012, 0.014), b.m.glow(plan.role), 0, DAIS.topHeight + 1.07, -0.18 + index * 0.03);
  }
  node.add(lectern);

  // The primary status display, standing behind the centre on its own frame.
  const frame = group(0, 0, -1.05);
  put(frame, b.g.box(2.6, 0.09, 0.5), b.m.deskFrame, 0, 1.1, 0);
  for (const dx of [-1, 1]) put(frame, b.g.box(0.09, 1.15, 0.12), b.m.deskFrame, dx * 1.25, 0.55, 0);
  const status = wallScreen(b, plan.role, { width: 2.3, height: 1.2 });
  status.position.set(0, 1.72, -1.0);
  node.add(status);
  node.add(frame);

  // A holographic ring used to hover here as the futuristic accent, but every height it could take
  // collided with the name plate or the task readout above the coordinator's head, so it is gone; the
  // console's glowing key strips and the dais rim carry that accent instead.
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
  // Phase 2: fixed eight-room starship floorplan. The previous open deck
  // and two-wall room shell are intentionally no longer composed here.
  void plan;
  return buildShipRooms(b, b.track);
}

function place(node: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D {
  node.position.set(x, y, z);
  return node;
}