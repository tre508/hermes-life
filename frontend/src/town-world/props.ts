/**
 * Reusable furniture and equipment.
 *
 * The audit's sequence here is: first the report found the facility had no environmental detail and one
 * desk in seven colours (§1, §2 of v1); then it found the props still exposed "the simplicity of their
 * construction" (§4 of v3). So this module is the vocabulary of props, and everything in it is built to
 * three rules:
 *
 *   - **construction, not slabs.** Desks have aprons, a modesty panel and a foot rail; chairs have a
 *     five-star base and a gas column; cabinets have a plinth, door seams, recessed panels and
 *     handles; monitors have a bezel, a neck and a weighted foot.
 *   - **material honesty.** Walnut work surfaces, brushed aluminium frames, painted metal bodies,
 *     fabric seating, blue-green glazing, near-black technology. Every one comes from `palette.ts`, so
 *     the scene cannot drift into unrelated tones.
 *   - **one proportional system.** Everything is sized against `SCALE` in `layout.ts`, so desks, chairs,
 *     consoles and people keep a consistent relationship.
 *
 * Props are always built at their own origin, standing on `y = 0`, and positioned by the caller.
 */
import * as THREE from 'three';

import type { Role } from '../town-model';
import { SCALE } from './layout';
import { PALETTE, type Geometry, type Materials, type Track } from './palette';

export interface Builders { g: Geometry; m: Materials; track: Track }

/** Add a positioned mesh to a group. The one primitive every prop is made from. */
function put(
  group: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material,
  x = 0, y = 0, z = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  group.add(mesh);
  return mesh;
}

const group = (x = 0, y = 0, z = 0, yaw = 0) => {
  const node = new THREE.Group();
  node.position.set(x, y, z);
  node.rotation.y = yaw;
  return node;
};

/**
 * A soft contact shadow, laid flat on the floor.
 *
 * Audit v3 §3 asks for "inexpensive ambient-occlusion-like shading or baked contact shading" to connect
 * characters and furniture to the surface they stand on. One shared transparent material means every
 * patch in the scene merges into a single draw call.
 */
export function contactPatch(b: Builders, radius: number, opacity = 1): THREE.Mesh {
  const patch = new THREE.Mesh(b.g.plane(radius * 2, radius * 2), b.m.contact);
  patch.rotation.x = -Math.PI / 2;
  patch.position.y = 0.012;
  patch.renderOrder = 0;
  if (opacity !== 1) patch.scale.setScalar(opacity);
  return patch;
}

// --------------------------------------------------------------------------------------- furniture

/** A working desk: chamfered hardwood top, apron, aluminium legs, a foot rail and a modesty panel. */
export function desk(b: Builders, opts: { width?: number; depth?: number; height?: number; top?: THREE.Material } = {}): THREE.Group {
  const width = opts.width ?? 2.0;
  const depth = opts.depth ?? 0.85;
  const height = opts.height ?? SCALE.desk;
  const node = group();
  put(node, b.g.bevel(width, 0.075, depth), opts.top ?? b.m.deskTop, 0, height - 0.038, 0);
  put(node, b.g.box(width - 0.14, 0.055, depth - 0.2), b.m.woodDark, 0, height - 0.1, 0);
  for (const side of [-1, 1]) {
    for (const face of [-1, 1]) {
      put(node, b.g.bevel(0.075, height - 0.12, 0.075), b.m.deskFrame,
        side * (width / 2 - 0.07), (height - 0.12) / 2, face * (depth / 2 - 0.09));
    }
    put(node, b.g.box(0.06, 0.05, depth - 0.2), b.m.deskFrame, side * (width / 2 - 0.07), 0.12, 0);
  }
  put(node, b.g.box(width - 0.7, 0.05, 0.05), b.m.deskFrame, 0, 0.14, -depth / 2 + 0.2);
  put(node, b.g.bevel(width - 0.22, height - 0.3, 0.045), b.m.woodDark, 0, (height - 0.3) / 2 + 0.1, -depth / 2 + 0.08);
  put(node, b.g.box(width - 0.4, 0.09, 0.18), b.m.housing, 0, height - 0.2, -depth / 2 + 0.22);
  return node;
}

/** An office chair: fabric seat and back, a gas column, a five-star base and a pair of armrests. */
export function chair(b: Builders, role: Role, opts: { yaw?: number } = {}): THREE.Group {
  const node = group(0, 0, 0, opts.yaw ?? 0);
  const seat = SCALE.chair;
  put(node, b.g.bevel(0.47, 0.1, 0.45), b.m.seat, 0, seat, 0);
  const back = put(node, b.g.bevel(0.45, 0.5, 0.09), b.m.seat, 0, seat + 0.3, -0.21);
  back.rotation.x = -0.09;
  put(node, b.g.bevel(0.34, 0.3, 0.05), b.m.accent(role), 0, seat + 0.3, -0.25).rotation.x = -0.09;
  put(node, b.g.cylinder(0.05, 0.06, seat - 0.06, 12), b.m.alu, 0, (seat - 0.06) / 2, 0);
  for (let index = 0; index < 5; index += 1) {
    const radians = (index / 5) * Math.PI * 2 + 0.4;
    const spoke = put(node, b.g.box(0.045, 0.035, 0.36), b.m.housing, Math.sin(radians) * 0.18, 0.05, Math.cos(radians) * 0.18);
    spoke.rotation.y = radians;
    put(node, b.g.cylinder(0.03, 0.03, 0.025, 8), b.m.dark, Math.sin(radians) * 0.34, 0.025, Math.cos(radians) * 0.34)
      .rotation.x = Math.PI / 2;
  }
  for (const dx of [-1, 1]) {
    put(node, b.g.box(0.055, 0.05, 0.3), b.m.deskFrame, dx * 0.27, seat + 0.2, 0.03);
    put(node, b.g.box(0.05, 0.22, 0.05), b.m.deskFrame, dx * 0.27, seat + 0.1, 0.16);
  }
  return node;
}

// -------------------------------------------------------------------------------------- technology

/**
 * A workstation screen: bezel, neck, weighted foot, and a real interface on the panel.
 *
 * The panel is the role's own material for the lit strip, so lighting a station for real work is one
 * material change for the whole station rather than a special case per monitor.
 */
export function monitor(b: Builders, role: Role, opts: { width?: number; height?: number; standHeight?: number } = {}): THREE.Group {
  const width = opts.width ?? SCALE.monitor.width;
  const height = opts.height ?? SCALE.monitor.height;
  const standHeight = opts.standHeight ?? SCALE.desk;
  const node = group(0, 0, 0);
  put(node, b.g.bevel(0.3, 0.035, 0.19), b.m.housing, 0, standHeight + 0.018, 0);
  put(node, b.g.box(0.055, 0.26, 0.055), b.m.housingLight, 0, standHeight + 0.15, 0);
  const panel = group(0, standHeight + 0.28 + height / 2, 0);
  put(panel, b.g.bevel(width, height, 0.05), b.m.housing, 0, 0, 0);
  put(panel, b.g.box(width - 0.05, height - 0.05, 0.014), b.m.screen, 0, 0, 0.03);
  // A lit accent along the bottom bezel: the department's colour, kept off the screen content.
  put(panel, b.g.box(width - 0.16, 0.018, 0.014), b.m.glow(role), 0, -height / 2 + 0.035, 0.032);
  node.add(panel);
  return node;
}

/** Two or three screens on one gantry: an unmistakable developer or operator station. */
export function monitorBank(b: Builders, role: Role, count = 2): THREE.Group {
  const node = group();
  const width = 0.62;
  for (let index = 0; index < count; index += 1) {
    const offset = (index - (count - 1) / 2) * (width + 0.1);
    const boom = monitor(b, role, { width, height: 0.42, standHeight: SCALE.desk + 0.06 });
    boom.translateX(offset);
    node.add(boom);
  }
  put(node, b.g.box(count * (width + 0.1) + 0.12, 0.045, 0.16), b.m.alu, 0, SCALE.desk - 0.05, -0.02);
  for (const dx of [-1, 1]) put(node, b.g.box(0.05, 0.16, 0.05), b.m.alu, dx * (count * (width + 0.1)) / 2, SCALE.desk + 0.03, -0.02);
  return node;
}

/** A sloped operator console with a lit panel, a keybed and a row of controls. */
export function consoleUnit(b: Builders, role: Role, opts: { width?: number; depth?: number } = {}): THREE.Group {
  const width = opts.width ?? 0.95;
  const depth = opts.depth ?? 0.6;
  const node = group();
  put(node, b.g.bevel(width, 0.16, depth), b.m.alu, 0, 0.62, 0);
  const face = put(node, b.g.box(width - 0.07, 0.44, 0.05), b.m.screen, 0, 0.87, 0.05);
  face.rotation.x = -0.62;
  const trim = put(node, b.g.box(width - 0.14, 0.045, 0.02), b.m.glow(role), 0, 0.72, depth / 2 - 0.05);
  trim.rotation.x = -0.62;
  put(node, b.g.box(width - 0.12, 0.03, 0.16), b.m.housing, 0, 0.705, depth / 2 - 0.16);
  for (let index = 0; index < 4; index += 1) {
    put(node, b.g.cylinder(0.03, 0.03, 0.022, 10), b.m.glow(role), -width / 2 + 0.18 + index * 0.16, 0.715, depth / 2 - 0.16);
  }
  for (const dx of [-1, 1]) {
    put(node, b.g.bevel(0.075, 0.62, depth - 0.1), b.m.housing, dx * (width / 2 - 0.045), 0.31, 0);
    put(node, b.g.box(width - 0.2, 0.03, 0.05), b.m.housingLight, 0, 0.16, depth / 2 - 0.05);
  }
  return node;
}

/** An equipment rack: vented housing, an access door, and a column of status lights. */
export function equipmentRack(b: Builders, role: Role, opts: { width?: number; height?: number } = {}): THREE.Group {
  const width = opts.width ?? 0.72;
  const height = opts.height ?? 1.5;
  const node = group();
  put(node, b.g.bevel(width, height, 0.6), b.m.housing, 0, height / 2, 0);
  // Vents and an access door, so the box reads as machinery.
  for (let index = 0; index < 6; index += 1) {
    put(node, b.g.box(width - 0.16, 0.022, 0.02), b.m.housingLight, 0, height - 0.3 - index * 0.055, 0.302);
  }
  put(node, b.g.box(width - 0.1, height * 0.42, 0.02), b.m.housingLight, 0, height * 0.32, 0.302);
  for (const dx of [-1, 1]) put(node, b.g.box(0.03, 0.12, 0.03), b.m.alu, dx * (width / 2 - 0.09), height * 0.32, 0.318);
  for (let index = 0; index < 4; index += 1) {
    put(node, b.g.cylinder(0.028, 0.028, 0.022, 10), b.m.glow(role), -width / 2 + 0.16, height - 0.2 - index * 0.11, 0.308);
  }
  put(node, b.g.box(width, 0.04, 0.6), b.m.alu, 0, 0.02, 0);
  return node;
}

/** A wall-mounted display: dark glass, a lit edge and a bar of interface detail. */
export function wallScreen(b: Builders, role: Role, opts: { width?: number; height?: number; bars?: boolean } = {}): THREE.Group {
  const width = opts.width ?? 1.7;
  const height = opts.height ?? 1.0;
  const node = group();
  put(node, b.g.bevel(width, height, 0.07), b.m.housing, 0, 0, 0);
  put(node, b.g.box(width - 0.09, height - 0.09, 0.02), b.m.screen, 0, 0, 0.05);
  put(node, b.g.box(width, 0.035, 0.025), b.m.glow(role), 0, -height / 2 + 0.05, 0.055);
  if (opts.bars !== false) {
    for (let index = 0; index < 3; index += 1) {
      put(node, b.g.box((width - 0.34) * (1 - index * 0.22), 0.045, 0.012), b.m.housingLight, -0.1, height / 2 - 0.28 - index * 0.15, 0.064);
    }
    put(node, b.g.box(0.09, height - 0.4, 0.012), b.m.glow(role), width / 2 - 0.3, 0.02, 0.064);
  }
  return node;
}

/** A free-standing holographic panel: the futuristic accent, without pretending to be a solid object. */
export function holoPanel(b: Builders, role: Role, opts: { width?: number; height?: number } = {}): THREE.Group {
  const width = opts.width ?? 1.1;
  const height = opts.height ?? 0.62;
  const node = group();
  const panel = new THREE.Mesh(b.g.plane(width, height), b.m.holo.clone());
  panel.material.color = new THREE.Color(b.m.accent(role).color);
  node.add(panel);
  put(node, b.g.box(width, 0.03, 0.03), b.m.glow(role), 0, height / 2, 0);
  put(node, b.g.box(width, 0.03, 0.03), b.m.glow(role), 0, -height / 2, 0);
  return node;
}

/** A document tray with a shallow stack of paper. */
export function documentTray(b: Builders): THREE.Group {
  const node = group();
  put(node, b.g.bevel(0.42, 0.07, 0.32), b.m.alu, 0, 0.035, 0);
  put(node, b.g.box(0.34, 0.05, 0.26), b.m.paper, 0, 0.09, 0);
  return node;
}

/** A workstation tower: tall, vented, one lit strip, standing on a plinth. */
export function serverTower(b: Builders, role: Role, opts: { height?: number } = {}): THREE.Group {
  const height = opts.height ?? 0.9;
  const node = group();
  put(node, b.g.bevel(0.44, height, 0.52), b.m.housing, 0, height / 2 + 0.02, 0);
  put(node, b.g.box(0.48, 0.04, 0.56), b.m.alu, 0, 0.02, 0);
  for (let index = 0; index < 4; index += 1) {
    put(node, b.g.box(0.34, 0.02, 0.012), b.m.housingLight, 0, 0.26 + index * 0.15, 0.266);
  }
  put(node, b.g.box(0.035, height - 0.24, 0.012), b.m.glow(role), 0.16, height / 2 + 0.02, 0.266);
  return node;
}

// ----------------------------------------------------------------------------- storage and fittings

/** A cabinet: painted body, plinth, recessed doors, handles and an overhanging hardwood top. */
export function cabinet(b: Builders, opts: { width?: number; height?: number; depth?: number; body?: THREE.Material } = {}): THREE.Group {
  const width = opts.width ?? 0.9;
  const height = opts.height ?? 1.05;
  const depth = opts.depth ?? 0.45;
  const node = group();
  const body = opts.body ?? b.m.paint(PALETTE.slate);
  put(node, b.g.box(width - 0.08, 0.06, depth - 0.06), b.m.housing, 0, 0.03, 0);
  put(node, b.g.bevel(width, height - 0.11, depth), body, 0, (height - 0.11) / 2 + 0.06, 0);
  put(node, b.g.bevel(width + 0.07, 0.055, depth + 0.06), b.m.deskTop, 0, height, 0);
  for (const dx of [-1, 1]) {
    put(node, b.g.box(width / 2 - 0.045, height - 0.26, 0.016), b.m.housingLight, dx * (width / 4), height / 2 + 0.05, depth / 2 + 0.008);
  }
  put(node, b.g.box(0.018, height - 0.22, 0.014), b.m.housing, 0, height / 2 + 0.05, depth / 2 + 0.014);
  for (const dx of [-1, 1]) {
    put(node, b.g.box(0.032, 0.15, 0.032), b.m.alu, dx * 0.055, height / 2 + 0.05, depth / 2 + 0.026);
  }
  return node;
}

/**
 * Shelving with real contents: framed uprights, shelves, and rows of spines.
 *
 * This is what makes a research laboratory and a knowledge archive read as such from across the room
 * with every label hidden (audit v1 §2, audit v3 §6).
 */
export function shelfUnit(b: Builders, opts: { width?: number; height?: number; depth?: number; rows?: number; role?: Role } = {}): THREE.Group {
  const width = opts.width ?? 1.5;
  const height = opts.height ?? 2.0;
  const depth = opts.depth ?? 0.42;
  const rows = opts.rows ?? 4;
  const node = group();
  for (const dx of [-1, 1]) put(node, b.g.bevel(0.07, height, depth), b.m.shelf, dx * (width / 2 - 0.035), height / 2, 0);
  put(node, b.g.bevel(width, 0.06, depth), b.m.shelf, 0, height, 0);
  put(node, b.g.box(width, height * 0.86, 0.03), b.m.woodDark, 0, height / 2, -depth / 2 + 0.015);
  const spines = [0xb4574f, 0x4f7fb4, 0xc9a35a, 0x5fa37a, 0x8a6fb0, 0xd0d4d8];
  for (let row = 0; row < rows; row += 1) {
    const y = 0.22 + row * ((height - 0.3) / rows);
    put(node, b.g.box(width - 0.12, 0.05, depth - 0.02), b.m.shelf, 0, y, 0);
    let x = -width / 2 + 0.14;
    let index = row;
    while (x < width / 2 - 0.22) {
      const bookWidth = 0.05 + ((index * 37) % 4) * 0.012;
      const bookHeight = 0.24 + ((index * 17) % 3) * 0.02;
      put(node, b.g.box(bookWidth, bookHeight, depth - 0.14), b.m.tint(spines[index % spines.length]), x, y + 0.025 + bookHeight / 2, 0);
      x += bookWidth + 0.012;
      index += 1;
    }
  }
  return node;
}

/** Archive drawers: what a records store looks like from the outside. */
export function drawerUnit(b: Builders, opts: { width?: number; height?: number; depth?: number; role?: Role } = {}): THREE.Group {
  const width = opts.width ?? 1.0;
  const height = opts.height ?? 1.35;
  const depth = opts.depth ?? 0.5;
  const node = group();
  put(node, b.g.bevel(width, height, depth), b.m.paint(0x6b5a44), 0, height / 2, 0);
  put(node, b.g.bevel(width + 0.05, 0.05, depth + 0.04), b.m.deskTop, 0, height + 0.02, 0);
  const rows = 4;
  for (let row = 0; row < rows; row += 1) {
    const y = 0.18 + row * ((height - 0.26) / rows);
    put(node, b.g.box(width - 0.07, (height - 0.3) / rows - 0.05, 0.02), b.m.housingLight, 0, y, depth / 2 + 0.008);
    put(node, b.g.box(0.17, 0.032, 0.035), opts.role ? b.m.glow(opts.role) : b.m.alu, 0, y, depth / 2 + 0.024);
    put(node, b.g.box(width - 0.24, 0.02, 0.03), b.m.paper, 0, y + 0.05, depth / 2 + 0.02);
  }
  return node;
}

/** A crate: cheap volume that makes a work area look used. */
export function crate(b: Builders, size = 0.42): THREE.Group {
  const node = group();
  put(node, b.g.bevel(size, size * 0.7, size), b.m.tint(0x8a7250), 0, size * 0.35, 0);
  for (const dy of [0.16, 0.55]) {
    put(node, b.g.box(size + 0.025, 0.045, size + 0.025), b.m.tint(0x634d34), 0, size * 0.7 * dy + size * 0.05, 0);
  }
  return node;
}

/** A planter: the "comfortable office" half of the brief. */
export function planter(b: Builders, scale = 1): THREE.Group {
  const node = group();
  put(node, b.g.cylinder(0.23 * scale, 0.19 * scale, 0.36 * scale, 16), b.m.tint(0x8c8377, 0.8, 0.08), 0, 0.18 * scale, 0);
  put(node, b.g.cylinder(0.245 * scale, 0.245 * scale, 0.035 * scale, 16), b.m.alu, 0, 0.355 * scale, 0);
  put(node, b.g.cylinder(0.055 * scale, 0.055 * scale, 0.5 * scale, 8), b.m.tint(0x5c4a38), 0, 0.56 * scale, 0);
  put(node, b.g.sphere(0.27 * scale, 10, 8), b.m.tint(0x4f7a55, 0.9, 0), 0, 0.95 * scale, 0).scale.set(1, 0.72, 1);
  put(node, b.g.sphere(0.2 * scale, 10, 8), b.m.tint(0x3d6b48, 0.9, 0), 0.17 * scale, 0.8 * scale, 0.08 * scale);
  put(node, b.g.sphere(0.18 * scale, 10, 8), b.m.tint(0x5c9062, 0.9, 0), -0.16 * scale, 0.87 * scale, -0.06 * scale);
  return node;
}

/** A bench: hardwood slats on aluminium legs. Somewhere the idle story feels plausible. */
export function bench(b: Builders, length = 1.5): THREE.Group {
  const node = group();
  for (const dz of [-0.14, 0.14]) put(node, b.g.bevel(length, 0.06, 0.24), b.m.deskTop, 0, 0.45, dz);
  for (const dx of [-1, 1]) {
    put(node, b.g.box(0.07, 0.42, 0.38), b.m.alu, dx * (length / 2 - 0.14), 0.21, 0);
    put(node, b.g.box(0.12, 0.03, 0.44), b.m.housing, dx * (length / 2 - 0.14), 0.015, 0);
  }
  return node;
}

// ------------------------------------------------------------------------------------ architecture

/** A lit wall or ceiling light bar. The facility's own illumination, as geometry. */
export function lightBar(b: Builders, length = 2.2, opts: { vertical?: boolean } = {}): THREE.Group {
  const node = group();
  const housing = opts.vertical ? b.g.box(0.12, length, 0.12) : b.g.box(length, 0.12, 0.12);
  const tube = opts.vertical ? b.g.box(0.07, length - 0.14, 0.04) : b.g.box(length - 0.14, 0.07, 0.04);
  put(node, housing, b.m.alu, 0, 0, 0);
  put(node, tube, b.m.lightBar, 0, 0, 0.07);
  return node;
}

/** A glazed partition: aluminium frame, mullions, a handrail and a tinted panel (§10). */
export function partition(b: Builders, length: number, opts: { height?: number } = {}): THREE.Group {
  const height = opts.height ?? SCALE.partition.height;
  const node = group();
  put(node, b.g.box(length, height - 0.22, SCALE.partition.thickness), b.m.glass, 0, height / 2 - 0.02, 0);
  put(node, b.g.bevel(length, 0.08, 0.1), b.m.alu, 0, 0.09, 0);
  put(node, b.g.bevel(length, 0.07, 0.1), b.m.alu, 0, height - 0.08, 0);
  for (let index = 0; index <= 2; index += 1) {
    const x = -length / 2 + (length / 2) * index;
    put(node, b.g.box(0.07, height, 0.1), b.m.alu, x, height / 2, 0);
  }
  put(node, b.g.box(length * 0.62, 0.035, 0.035), b.m.wallTrim, 0, height - 0.18, 0.055);
  return node;
}

/** A wall-mounted light fixture, aimed down the wall. */
export function wallSconce(b: Builders): THREE.Group {
  const node = group();
  put(node, b.g.bevel(0.52, 0.1, 0.19), b.m.alu, 0, 0, 0);
  put(node, b.g.box(0.44, 0.05, 0.06), b.m.lightBar, 0, -0.05, 0.085);
  return node;
}

/** A pegboard of tools: instantly reads as a build or repair bay. */
export function toolBoard(b: Builders, role: Role): THREE.Group {
  const node = group();
  put(node, b.g.bevel(1.0, 0.7, 0.05), b.m.paint(0x4a5b66), 0, 0, 0);
  put(node, b.g.box(0.94, 0.64, 0.012), b.m.paint(0x39474f), 0, 0, 0.032);
  for (const [dx, height] of [[-0.3, 0.3], [-0.04, 0.4], [0.26, 0.22]] as const) {
    put(node, b.g.box(0.07, height, 0.03), b.m.alu, dx, 0.28 - height / 2, 0.05);
    put(node, b.g.box(0.11, 0.05, 0.035), b.m.tint(0xc4a15a, 0.5, 0.5), dx, 0.28 - height - 0.02, 0.055);
  }
  put(node, b.g.box(0.3, 0.045, 0.03), b.m.glow(role), 0, -0.2, 0.05);
  return node;
}

/** A planning or white board on a stand. */
export function boardStand(b: Builders, role: Role, opts: { width?: number; height?: number } = {}): THREE.Group {
  const width = opts.width ?? 1.5;
  const height = opts.height ?? 0.95;
  const node = group();
  put(node, b.g.bevel(width, height, 0.06), b.m.alu, 0, 1.35, 0);
  put(node, b.g.box(width - 0.07, height - 0.07, 0.012), b.m.tint(0x2b3b45, 0.92, 0), 0, 1.35, 0.036);
  const notes = [0xb4574f, 0xc9a35a, 0x5fa37a, 0x4f7fb4, 0x8a6fb0, 0xd0d4d8];
  for (let index = 0; index < 6; index += 1) {
    const column = index % 3;
    const row = Math.floor(index / 3);
    put(node, b.g.box(0.26, 0.18, 0.012), b.m.tint(notes[(index + 2) % notes.length], 0.9, 0),
      -width / 2 + 0.28 + column * 0.42, 1.35 + 0.2 - row * 0.32, 0.045);
  }
  put(node, b.g.box(width, 0.045, 0.05), b.m.glow(role), 0, 1.35 - height / 2 - 0.04, 0.045);
  for (const dx of [-1, 1]) {
    put(node, b.g.box(0.07, 1.35, 0.07), b.m.alu, dx * (width / 2 - 0.1), 0.66, 0);
    put(node, b.g.box(0.22, 0.05, 0.36), b.m.alu, dx * (width / 2 - 0.1), 0.03, 0);
  }
  return node;
}

/** A free-standing nameplate on a post: physical signage with a lit edge. */
export function signPost(b: Builders, role: Role, opts: { height?: number } = {}): THREE.Group {
  const height = opts.height ?? SCALE.sign.post;
  const node = group();
  put(node, b.g.box(0.07, height, 0.07), b.m.alu, 0, height / 2, 0);
  put(node, b.g.bevel(0.9, 0.42, 0.06), b.m.paint(0x3d4a55), 0, height + 0.16, 0);
  put(node, b.g.box(0.82, 0.34, 0.012), b.m.screen, 0, height + 0.16, 0.036);
  put(node, b.g.box(0.9, 0.035, 0.02), b.m.glow(role), 0, height - 0.05, 0.045);
  return node;
}

export { put, group };
export { PALETTE };
