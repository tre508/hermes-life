/**
 * The seven residents.
 *
 * The reports went: first the figures were "placeholder geometry" (§3 of v1); then they were still
 * "nearly identical character models with different colors", with oversimplified heads, bodies, hands
 * and feet and clothing that was really a tinted torso (VIS-006 §2, §3, §6). So this is a **character
 * system**, not seven hand-written figures:
 *
 *   - `ANATOMY` is one proportional system — sole, ankle, knee, hip, waist, shoulder, neck, head — from
 *     which every part derives. All seven share a skeleton; none of it is guessed at.
 *   - `CAST` is seven design records: height, build, head shape, hair, skin, garment, shirt, trousers,
 *     shoes and the role's accessory. Differences come from the record, so no two residents can drift
 *     into being recolours of each other.
 *   - limbs are **articulated**: hip → knee → shin → foot and shoulder → elbow → forearm → hand are
 *     nested groups, which is what lets a resident actually sit at a desk (see the seated pose in the
 *     renderer) rather than leaning at it.
 *   - faces come from `faces.ts`, one expression system driven by the same activity table as the body, so
 *     a waiting resident looks patient and never looks busy.
 *
 * Identity is carried by **silhouette first** — hair, headwear, garment shape and build are legible in
 * greyscale with every label hidden, which is the acceptance test the reports set.
 *
 * Geometry and materials are shared through the `palette.ts` caches: seven residents cost one material
 * per garment tone and one geometry per distinct size, not seven private sets.
 */
import * as THREE from 'three';

import type { Role } from '../town-model';
import { createFace, type Face } from './faces';
import type { Builders } from './props';
import { group, put } from './props';

/** The proportional system, in whole-body units. A figure at scale 1 stands 1.75 units tall. */
export const ANATOMY = {
  sole: 0.015,
  ankle: 0.075,
  knee: 0.45,
  hip: 0.88,
  waist: 1.03,
  chest: 1.24,
  shoulder: 1.37,
  neck: 1.46,
  head: 1.58,
  headRadius: 0.205,
} as const;

/** Named parts the renderer animates. Nothing else about a resident is public. */
export interface ResidentParts {
  group: THREE.Group;
  /** Hips and everything above them: the pivot the whole body leans from. */
  upper: THREE.Group;
  head: THREE.Group;
  /** Shoulder pivots: rotating one swings the whole arm. */
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  /** Elbow pivots, so a hand can rest on a keyboard while the shoulder stays relaxed. */
  elbowL: THREE.Object3D;
  elbowR: THREE.Object3D;
  /** Hip pivots, so the figure can sit at its desk. */
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  /** Knee pivots. */
  kneeL: THREE.Object3D;
  kneeR: THREE.Object3D;
  /** The role's hardware: it lights with the station, so one material drives a whole state change. */
  tech: THREE.Object3D;
  face: Face;
  /** Height of the hips, so the renderer can seat a figure on a chair of known height. */
  hipHeight: number;
}

type HeadShape = 'round' | 'oval' | 'square' | 'long' | 'wide';
type HairKind = 'crop' | 'swept' | 'bun' | 'ponytail' | 'curls' | 'longback' | 'tied';
type Garment = 'jacket' | 'labcoat' | 'vest' | 'hoodie' | 'harness' | 'cardigan' | 'blazer';
type Extra = 'watch' | 'tablet' | 'hardhat' | 'goggles' | 'satchel' | 'clipboard' | 'headset';

export interface Character {
  height: number;
  build: number;
  head: HeadShape;
  hair: HairKind;
  skin: number;
  hairTone: number;
  garment: Garment;
  cloth: number;
  shirt: number;
  trouser: number;
  shoe: number;
  extra: Extra;
  glasses: boolean;
}

/**
 * The cast. Every field is a deliberate decision, and no two residents agree on all of them.
 *
 * Heights span 0.95–1.06 and builds 0.88–1.16, so a lineup is readable before a single colour is
 * considered; hair, head shape and garment do the rest.
 */
const CAST: Readonly<Record<Role, Character>> = Object.freeze({
  coordinator: {
    height: 1.0, build: 1.0, head: 'round', hair: 'swept', skin: 0xd8ad86, hairTone: 0x2f2a26,
    garment: 'jacket', cloth: 0x2c4550, shirt: 0x24343c, trouser: 0x2b3540, shoe: 0x232a30,
    extra: 'headset', glasses: false,
  },
  researcher: {
    height: 0.98, build: 0.92, head: 'oval', hair: 'bun', skin: 0xe6c6a4, hairTone: 0x4a3527,
    garment: 'labcoat', cloth: 0xe4e0d6, shirt: 0x33627c, trouser: 0x3a4a58, shoe: 0x2a3238,
    extra: 'tablet', glasses: true,
  },
  planner: {
    height: 0.95, build: 0.88, head: 'round', hair: 'ponytail', skin: 0xc98f66, hairTone: 0x241d19,
    garment: 'vest', cloth: 0x534a75, shirt: 0xc2bdd0, trouser: 0x33343f, shoe: 0x2c2c33,
    extra: 'watch', glasses: false,
  },
  builder: {
    height: 1.06, build: 1.16, head: 'square', hair: 'crop', skin: 0xb07a4e, hairTone: 0x1f1a16,
    garment: 'hoodie', cloth: 0x8a5a30, shirt: 0x3f4a52, trouser: 0x3d4550, shoe: 0x4a3826,
    extra: 'hardhat', glasses: false,
  },
  tester: {
    height: 0.97, build: 1.0, head: 'wide', hair: 'curls', skin: 0x8d5f3d, hairTone: 0x181410,
    garment: 'harness', cloth: 0x4d5340, shirt: 0x2e3630, trouser: 0x39403c, shoe: 0x2f3530,
    extra: 'goggles', glasses: false,
  },
  archivist: {
    height: 1.02, build: 0.9, head: 'long', hair: 'longback', skin: 0xd9b48c, hairTone: 0x6b4a2f,
    garment: 'cardigan', cloth: 0x7a6349, shirt: 0xc4ac8e, trouser: 0x4a4038, shoe: 0x3a2f26,
    extra: 'satchel', glasses: true,
  },
  reviewer: {
    height: 1.01, build: 1.04, head: 'oval', hair: 'tied', skin: 0xe8c9ab, hairTone: 0x7d6a52,
    garment: 'blazer', cloth: 0x2f4a3c, shirt: 0xdcd8cd, trouser: 0x2f3a42, shoe: 0x24282e,
    extra: 'clipboard', glasses: false,
  },
});

/** The role's design record. Exposed so a test can assert the seven really do differ. */
export function characterOf(role: Role): Readonly<Character> {
  return CAST[role];
}

/** A cached material for a skin, hair, cloth or shoe tone. */
function tone(b: Builders, hex: number, roughness: number, metalness = 0) {
  return b.m.tint(hex, roughness, metalness);
}

// ------------------------------------------------------------------------------------- the head

function headGeometry(b: Builders, shape: HeadShape, radius: number): THREE.BufferGeometry {
  return shape === 'square'
    ? b.g.bevel(radius * 1.74, radius * 1.9, radius * 1.72)
    : b.g.sphere(radius, 20, 16);
}

function headScale(shape: HeadShape): [number, number, number] {
  switch (shape) {
    case 'oval': return [0.94, 1.06, 0.96];
    case 'square': return [1, 1, 1];
    case 'long': return [0.88, 1.18, 0.92];
    case 'wide': return [1.12, 0.94, 1];
    default: return [1, 1.02, 1];
  }
}

/** Hair, and the one headwear item that belongs to the hair rather than the role. */
function hair(b: Builders, char: Character, radius: number): THREE.Group {
  const node = group();
  const material = tone(b, char.hairTone, 0.78);
  const r = radius * 1.045;
  const cap = (theta: number) => new THREE.Mesh(b.g.dome(r, theta, 18, 12), material);
  switch (char.hair) {
    case 'crop': {
      node.add(cap(Math.PI * 0.55));
      put(node, b.g.box(radius * 1.9, radius * 0.36, radius * 0.5), material, 0, -0.2 * radius, -0.7 * radius);
      break;
    }
    case 'swept': {
      node.add(cap(Math.PI * 0.54));
      put(node, b.g.bevel(radius * 1.72, radius * 0.34, radius * 0.55), material, 0, 0.54 * radius, 0.58 * radius)
        .rotation.x = 0.32;
      put(node, b.g.box(radius * 1.95, radius * 0.52, radius * 0.42), material, 0, -0.1 * radius, -0.82 * radius);
      break;
    }
    case 'bun': {
      node.add(cap(Math.PI * 0.56));
      put(node, b.g.sphere(radius * 0.46, 14, 12), material, 0, 0.46 * radius, -0.88 * radius);
      put(node, b.g.box(radius * 1.5, radius * 0.3, radius * 0.4), material, 0, -0.26 * radius, -0.68 * radius);
      break;
    }
    case 'ponytail': {
      node.add(cap(Math.PI * 0.58));
      put(node, b.g.bevel(radius * 0.5, radius * 2.4, radius * 0.5), material, 0, -0.66 * radius, -0.95 * radius)
        .rotation.x = -0.22;
      put(node, b.g.box(radius * 1.8, radius * 0.32, radius * 0.45), material, 0, 0.36 * radius, 0.64 * radius);
      break;
    }
    case 'curls': {
      node.add(cap(Math.PI * 0.5));
      for (let index = 0; index < 7; index += 1) {
        const angle = (index / 7) * Math.PI * 2;
        put(node, b.g.sphere(radius * 0.32, 10, 8), material,
          Math.sin(angle) * radius * 0.82, radius * 0.64 + (index % 2) * radius * 0.16, Math.cos(angle) * radius * 0.82);
      }
      break;
    }
    case 'longback': {
      node.add(cap(Math.PI * 0.5));
      put(node, b.g.bevel(radius * 1.9, radius * 3.1, radius * 0.62), material, 0, -1.05 * radius, -0.7 * radius)
        .rotation.x = -0.05;
      for (const side of [-1, 1]) {
        put(node, b.g.bevel(radius * 0.42, radius * 2.2, radius * 0.55), material,
          side * radius * 0.86, -0.5 * radius, -0.28 * radius);
      }
      break;
    }
    default: {
      // tied — a neat knot at the back: the reviewer's signature.
      node.add(cap(Math.PI * 0.58));
      put(node, b.g.sphere(radius * 0.36, 12, 10), material, 0, 0.32 * radius, -0.94 * radius);
      put(node, b.g.bevel(radius * 1.7, radius * 0.42, radius * 0.5), material, 0, 0.04 * radius, -0.78 * radius);
      break;
    }
  }
  return node;
}

// ------------------------------------------------------------------------------------ garments

/**
 * Hip-relative clothing.  All widths are in *world units*, not "percentage of torso".
 * Earlier garment panels were 1.3–1.8 units wide while the shoulders were only 0.42.
 * That made coats, vests and hoodies into large rectangular wings around tiny people.
 * Panels are now fitted to the body, with distinct lapels, collars and hems instead.
 */
function garment(b: Builders, char: Character, upper: THREE.Group, build: number): void {
  const outer = tone(b, char.cloth, 0.84);
  const inner = tone(b, char.shirt, 0.88);
  const trim = tone(b, char.shoe, 0.72);
  const front = (width: number, height: number, y: number, side: -1 | 1, depth = 0.025) =>
    put(upper, b.g.bevel(width * build, height, depth), outer,
      side * (width * 0.52) * build, y, 0.153 * build);
  const lapel = (side: -1 | 1, length = 0.19) => {
    const piece = put(upper, b.g.bevel(0.065 * build, length, 0.034), inner,
      side * 0.065 * build, 0.42, 0.184 * build);
    piece.rotation.z = side * 0.28;
  };
  const collar = () => put(upper, b.g.bevel(0.35 * build, 0.075, 0.29 * build), outer,
    0, 0.49, -0.005);

  switch (char.garment) {
    case 'jacket': {
      front(0.18, 0.4, 0.29, -1);
      front(0.18, 0.4, 0.29, 1);
      lapel(-1); lapel(1); collar();
      put(upper, b.g.box(0.014, 0.29, 0.015), b.m.accent('coordinator'), 0, 0.28, 0.176);
      break;
    }
    case 'labcoat': {
      // Long side tails, clearly narrower than the arms and split at the front.
      for (const side of [-1, 1] as const) {
        front(0.2, 0.53, 0.22, side);
        put(upper, b.g.bevel(0.16 * build, 0.23, 0.035), outer,
          side * 0.12 * build, -0.12, 0.13 * build);
        put(upper, b.g.box(0.075 * build, 0.065, 0.014), inner,
          side * 0.105 * build, 0.17, 0.182 * build);
        lapel(side, 0.23);
      }
      collar();
      break;
    }
    case 'vest': {
      front(0.15, 0.37, 0.29, -1);
      front(0.15, 0.37, 0.29, 1);
      for (let i = 0; i < 3; i++) {
        put(upper, b.g.sphere(0.012, 8, 6), b.m.alu, 0, 0.38 - i * 0.105, 0.18);
      }
      break;
    }
    case 'hoodie': {
      for (const side of [-1, 1] as const) front(0.2, 0.42, 0.29, side, 0.036);
      // Hood behind the head, drawstrings at the front and a small pouch.
      put(upper, b.g.dome(0.235 * build, Math.PI * 0.62, 16, 12), outer,
        0, 0.48, -0.19).rotation.x = -0.48;
      put(upper, b.g.bevel(0.25 * build, 0.115, 0.032), outer, 0, 0.15, 0.18);
      for (const side of [-1, 1])
        put(upper, b.g.box(0.011, 0.17, 0.012), inner, side * 0.06, 0.38, 0.194);
      break;
    }
    case 'harness': {
      for (const side of [-1, 1] as const) {
        const strap = put(upper, b.g.bevel(0.068 * build, 0.39, 0.035), outer,
          side * 0.12 * build, 0.32, 0.177);
        strap.rotation.z = side * -0.13;
      }
      put(upper, b.g.bevel(0.34 * build, 0.08, 0.034), outer, 0, 0.14, 0.177);
      put(upper, b.g.bevel(0.17 * build, 0.13, 0.048), trim, 0, 0.4, 0.195);
      break;
    }
    case 'cardigan': {
      for (const side of [-1, 1] as const) {
        front(0.2, 0.52, 0.25, side);
        lapel(side, 0.24);
      }
      // A soft scarf, not a torso-width rectangular block.
      put(upper, b.g.bevel(0.28 * build, 0.11, 0.31 * build), inner, 0, 0.49, 0.005);
      put(upper, b.g.bevel(0.075 * build, 0.25, 0.035), inner, 0.08, 0.34, 0.192)
        .rotation.z = 0.12;
      break;
    }
    case 'blazer': {
      front(0.175, 0.42, 0.29, -1);
      front(0.175, 0.42, 0.29, 1);
      lapel(-1, 0.25); lapel(1, 0.25); collar();
      put(upper, b.g.box(0.012, 0.1, 0.012), trim, 0, 0.23, 0.191);
      break;
    }
  }
}

// ----------------------------------------------------------------------------------- accessories

/** The one thing that says "archivist, not reviewer" from across the room. */
function extra(b: Builders, char: Character, role: Role, upper: THREE.Group, head: THREE.Group, radius: number): THREE.Object3D {
  const tech = group();
  const accent = b.m.glow(role);
  switch (char.extra) {
    case 'headset': {
      const band = new THREE.Mesh(b.g.torus(radius * 1.16, 0.019, Math.PI * 1.2), b.m.housing);
      band.rotation.set(Math.PI / 2, 0, Math.PI * 0.4);
      head.add(band);
      put(head, b.g.sphere(0.032, 10, 8), accent, radius * 0.95, 0.02, 0.02);
      put(tech, b.g.bevel(0.15 * build1(char), 0.09, 0.11), b.m.housing, -0.2, 0.28, -0.05);
      put(tech, b.g.box(0.1, 0.016, 0.016), accent, -0.2, 0.33, 0.02);
      break;
    }
    case 'tablet': {
      put(tech, b.g.bevel(0.24, 0.32, 0.022), b.m.housing, 0.06, 0.06, 0.2).rotation.x = -0.6;
      put(tech, b.g.box(0.2, 0.26, 0.008), b.m.screen, 0.06, 0.07, 0.213).rotation.x = -0.6;
      break;
    }
    case 'watch': {
      put(tech, b.g.box(0.07, 0.05, 0.05), b.m.housing, -0.25, 0.14, 0.05);
      put(tech, b.g.box(0.045, 0.018, 0.02), accent, -0.25, 0.14, 0.083);
      break;
    }
    case 'hardhat': {
      // A crown, not a bucket: high enough that the face stays readable (§4, §7).
      const shell = new THREE.Mesh(b.g.dome(radius * 1.2, Math.PI * 0.33), tone(b, 0xe0a63a, 0.42, 0.1));
      shell.scale.set(1, 1.08, 1);
      shell.position.y = -0.06 * radius;
      head.add(shell);
      put(head, b.g.box(radius * 2.05, 0.03, 0.11), tone(b, 0xe0a63a, 0.45, 0.1), 0, 0.02 * radius, radius * 0.86);
      // A tool belt: the second half of the builder silhouette.
      const belt = group(0, 0.07, 0);
      put(belt, b.g.box(0.34, 0.08, 0.26), b.m.housing, 0, 0, 0);
      for (const dx of [-0.12, -0.04, 0.04, 0.12]) put(belt, b.g.box(0.055, 0.13, 0.055), b.m.alu, dx, -0.09, 0.11);
      upper.add(belt);
      break;
    }
    case 'goggles': {
      const pair = group(0, 0.16, 0.15);
      put(pair, b.g.bevel(radius * 1.72, 0.06, 0.06), b.m.housing, 0, 0, 0);
      for (const side of [-1, 1]) {
        put(pair, b.g.cylinder(0.055, 0.055, 0.045, 12), accent, side * radius * 0.42, 0, 0.03).rotation.x = Math.PI / 2;
      }
      head.add(pair);
      put(tech, b.g.cylinder(0.06, 0.06, 0.16, 12), b.m.housing, 0.25, 0.06, 0.05);
      put(tech, b.g.box(0.11, 0.022, 0.012), accent, 0.25, 0.08, 0.12);
      break;
    }
    case 'satchel': {
      const bag = group(0.26, -0.08, -0.03);
      put(bag, b.g.bevel(0.26, 0.3, 0.16), tone(b, 0x6b563f, 0.8), 0, 0, 0);
      put(bag, b.g.bevel(0.28, 0.06, 0.18), b.m.housing, 0, 0.17, 0);
      put(bag, b.g.box(0.03, 0.2, 0.02), b.m.alu, 0, 0.02, 0.09);
      upper.add(bag);
      put(tech, b.g.cylinder(0.07, 0.07, 0.18, 12), b.m.housing, -0.26, 0.06, 0.05);
      put(tech, b.g.box(0.12, 0.022, 0.012), accent, -0.26, 0.08, 0.12);
      break;
    }
    default: {
      // clipboard — the reviewer's stamp of authority.
      put(tech, b.g.bevel(0.24, 0.32, 0.025), b.m.housing, 0.2, 0.12, 0.16).rotation.x = -0.5;
      put(tech, b.g.box(0.2, 0.28, 0.008), b.m.paper, 0.2, 0.13, 0.173).rotation.x = -0.5;
      put(tech, b.g.box(0.07, 0.03, 0.02), accent, 0.2, 0.27, 0.15);
      break;
    }
  }
  return tech;
}

const build1 = (char: Character) => char.build;

// ------------------------------------------------------------------------------------ the figure

/**
 * Build one resident, standing on `y = 0`, facing local **+z** — the same forward as its station.
 *
 * Such a figure stands 1.75 world units tall before the cast's own height multiplier.
 */
export function buildResident(b: Builders, role: Role): ResidentParts {
  const char = CAST[role];
  const build = char.build;
  const root = group();
  root.scale.setScalar(char.height);

  const skin = tone(b, char.skin, 0.62, 0.02);
  const trouser = tone(b, char.trouser, 0.86);
  const shoe = tone(b, char.shoe, 0.6, 0.06);
  const shirt = tone(b, char.shirt, 0.88);

  // --- legs: hip → knee → shin → foot. Nested so the figure can sit at a desk (§10) -----------------
  const legs: THREE.Object3D[] = [];
  const knees: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const hip = group(side * 0.105 * build, ANATOMY.hip, 0);
    put(hip, b.g.capsule(0.1 * build, 0.3), trouser, 0, -0.21, 0);
    const knee = group(0, -(ANATOMY.hip - ANATOMY.knee), 0);
    put(knee, b.g.capsule(0.083 * build, 0.28), trouser, 0, -0.19, 0);
    // Shoe: last, upper and sole, so a foot reads as a foot rather than a block.
    put(knee, b.g.bevel(0.135 * build, 0.075, 0.25 * build), shoe, 0, -(ANATOMY.knee - ANATOMY.ankle), 0.055);
    put(knee, b.g.bevel(0.145 * build, 0.05, 0.27 * build), tone(b, 0x1b1e21, 0.85), 0, -(ANATOMY.knee - ANATOMY.sole) - 0.02, 0.055);
    hip.add(knee);
    root.add(hip);
    legs.push(hip);
    knees.push(knee);
  }

  // --- hips and everything above them, in hip-relative coordinates ----------------------------------
  const upper = group(0, ANATOMY.hip, 0);
  put(upper, b.g.bevel(0.31 * build, 0.22, 0.22 * build), trouser, 0, 0.06, 0);
  put(upper, b.g.capsule(0.17 * build, 0.3), shirt, 0, 0.32, 0).scale.set(1.12, 1, 0.9);
  put(upper, b.g.bevel(0.42 * build, 0.11, 0.25 * build), shirt, 0, 0.49, 0);
  put(upper, b.g.cylinder(0.056 * build, 0.056 * build, 0.12, 12), skin, 0, 0.58, 0);

  // --- arms: shoulder → upper arm → elbow → forearm → hand ------------------------------------------
  const arms: THREE.Object3D[] = [];
  const elbows: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const shoulder = group(side * 0.219 * build, 0.47, 0);
    put(shoulder, b.g.capsule(0.072 * build, 0.2), tone(b, char.cloth, 0.84), 0, -0.13, 0);
    const elbow = group(0, -0.26, 0);
    put(elbow, b.g.capsule(0.059 * build, 0.17), tone(b, char.cloth, 0.84), 0, -0.105, 0);
    put(elbow, b.g.cylinder(0.061 * build, 0.056 * build, 0.045, 10), skin, 0, -0.206, 0);
    // Hand: palm, thumb and a slab of fingers — enough shape to hold a tablet or work a keyboard.
    const hand = group(0, -0.235, 0);
    put(hand, b.g.bevel(0.084, 0.095, 0.058), skin, 0, 0, 0);
    put(hand, b.g.bevel(0.055, 0.055, 0.024), skin, side * 0.028, 0.022, 0.03);
    put(hand, b.g.bevel(0.078, 0.05, 0.05), skin, 0, -0.062, 0.012);
    elbow.add(hand);
    shoulder.add(elbow);
    upper.add(shoulder);
    arms.push(shoulder);
    elbows.push(elbow);
  }

  // --- head ----------------------------------------------------------------------------------------
  const radius = ANATOMY.headRadius;
  const head = group(0, 0.7, 0);
  put(head, headGeometry(b, char.head, radius), skin, 0, 0, 0.004).scale.set(...headScale(char.head));
  // A jaw: the difference between a head and a ball.
  if (char.head !== 'square') {
    put(head, b.g.bevel(radius * 1.26, radius * 0.6, radius * 1.22), skin, 0, -0.58 * radius, 0.02);
  }
  head.add(hair(b, char, radius));
  const face = createFace(b.track, b.g, head, radius, char.skin);
  if (char.glasses) {
    // Thin metal frames in front of the eyes: the scholar's tell.
    const frames = group(0, 0.03, radius * 0.9);
    for (const side of [-1, 1]) {
      const lens = new THREE.Mesh(b.g.torus(radius * 0.3, 0.011, Math.PI * 2), b.m.alu);
      lens.position.set(side * radius * 0.42, 0, 0);
      frames.add(lens);
    }
    put(frames, b.g.box(radius * 0.34, 0.014, 0.014), b.m.alu, 0, 0, 0);
    head.add(frames);
  }
  upper.add(head);

  const tech = extra(b, char, role, upper, head, radius);
  upper.add(tech);
  garment(b, char, upper, build);
  root.add(upper);

  return {
    group: root, upper, head,
    armL: arms[0], armR: arms[1],
    elbowL: elbows[0], elbowR: elbows[1],
    legL: legs[0], legR: legs[1],
    kneeL: knees[0], kneeR: knees[1],
    tech,
    face,
    hipHeight: ANATOMY.hip * char.height,
  };
}
