/**
 * The seven stations.
 *
 * The report's central complaint about the workstations was that they were one desk in seven colours
 * (§2): a library that looks like an office desk, an archive with nothing to store, a development
 * studio with no screens. Each builder below composes its own furniture, storage, equipment and
 * lighting so the department is identifiable with every label hidden, while still sharing the prop
 * vocabulary, the palette and the proportional system.
 *
 * Local frame: the group sits at the station's position and is rotated so local **+z faces the command
 * centre**. The resident stands at the local origin; the desk is in front of them, storage is at the
 * rear corners and the permanent sign is to one side — deliberately never directly behind the figure,
 * because for half of the ring that direction is the camera's (§12: furniture must not swallow a
 * resident).
 */
import * as THREE from 'three';

import type { Role } from '../town-model';
import { SCALE, seatTurnFor, type StationPlan } from './layout';
import { floorDecal } from './labels';
import { KIT, type Track } from './palette';
import {
  boardStand, cabinet, chair, contactPatch, consoleUnit, crate, desk, documentTray, drawerUnit,
  equipmentRack, group, holoPanel, monitor, monitorBank, partition, planter, put, serverTower,
  shelfUnit, toolBoard, wallScreen, type Builders,
} from './props';

interface StationOptions { b: Builders; plan: StationPlan; track: Track }

/** The department's floor plate: its own tiling in the area's tone, edged in the role's accent. */
function zonePad({ b, plan }: StationOptions): THREE.Group {
  const node = group();
  const { width, depth, height } = SCALE.pad;
  const kit = KIT[plan.role];
  put(node, b.g.box(width, height, depth), b.m.zonePad, 0, height / 2, 0);
  put(node, b.g.box(width - 0.24, 0.02, depth - 0.24), b.m.floorTone(kit.floor), 0, height + 0.005, 0);
  for (const dz of [-1, 1]) {
    put(node, b.g.box(width, 0.035, 0.06), b.m.glow(plan.role), 0, height + 0.01, dz * (depth / 2 - 0.05));
  }
  for (const dx of [-1, 1]) {
    put(node, b.g.box(0.06, 0.035, depth), b.m.glow(plan.role), dx * (width / 2 - 0.05), height + 0.01, 0);
  }
  // A low acoustic screen in the department's tone: the print of its identity (§6, §8).
  put(node, b.g.bevel(width - 0.5, 1.15, 0.07), b.m.panelTone(kit.panel), 0, 0.65, -depth / 2 + 0.07);
  return node;
}

/** A cabinet in the department's own painted tone: storage that belongs to its area (§6). */
function store(b: Builders, plan: StationPlan, opts: { width?: number; height?: number; depth?: number }): THREE.Group {
  return cabinet(b, { width: opts.width, height: opts.height, depth: opts.depth, body: b.m.paint(KIT[plan.role].body) });
}

/** One glazed side partition, so departments have edges without becoming closed rooms (§8). */
function sideScreen(options: StationOptions, side: 1 | -1): THREE.Group {
  const node = partition(options.b, 2.3, { height: 1.55 });
  node.position.set(side * (SCALE.pad.width / 2 - 0.1), 0.07, -0.35);
  node.rotation.y = Math.PI / 2;
  return node;
}

/** Shared groundwork: pad, glazing, the desk and chair every station needs, and the floor contact. */
function base(options: StationOptions, opts: { deskWidth: number; deskTop?: THREE.Material }): THREE.Group {
  const { b, plan, track } = options;
  const node = group();
  node.add(zonePad(options));
  node.add(sideScreen(options, -1));
  node.add(sideScreen(options, 1));

  const work = desk(b, { width: opts.deskWidth, depth: 0.9, top: opts.deskTop });
  work.position.set(0, 0.07, 0.78);
  node.add(work);

  // The chair stands at the end of the desk, turned to face along it, on the side the camera can see: a
  // resident seated behind its own monitor would be invisible from the isometric eye (§7, §10).
  const seatPlace = seatTurnFor(plan.yaw);
  const seat = chair(b, plan.role, { yaw: seatPlace.turn });
  seat.position.set(seatPlace.x, 0.07, seatPlace.z);
  node.add(seat);

  // Contact shading under the workstation: what connects furniture to the floor (§3).
  const grounding = contactPatch(b, 1.35);
  grounding.position.set(0, 0.085, 0.35);
  node.add(grounding);

  // Department signage painted into the plate's front edge: architectural, never over the equipment.
  const decal = floorDecal(track, plan.label, str(plan), 2.5);
  decal.position.set(0, SCALE.pad.height + 0.02, SCALE.pad.depth / 2 - 0.45);
  node.add(decal);
  return node;
}

/** The accent colour for a station's signage, from the role that owns it. */
function str(plan: StationPlan): string {
  return ACCENTS[plan.role];
}

const ACCENTS: Readonly<Record<Role, string>> = Object.freeze({
  coordinator: '#7fd4c1', researcher: '#6ec6e8', planner: '#b79be0', builder: '#e8a45c',
  tester: '#e8d45c', archivist: '#c9a37a', reviewer: '#8fd48f',
});

// ------------------------------------------------------------------------------------ the stations

/** Research Laboratory: shelves of sources, a reading table, an information display. */
function researchLab(options: StationOptions): THREE.Group {
  const { b, plan } = options;
  const node = base(options, { deskWidth: 1.8 });
  node.add(place(monitor(b, plan.role, { width: 0.7 }), -0.45, 0.07, 0.78));
  node.add(place(shelfUnit(b, { width: 1.3, height: 2.0, rows: 4, role: plan.role }), -1.15, 0.07, -1.0));
  node.add(place(shelfUnit(b, { width: 1.1, height: 1.7, rows: 3, role: plan.role }), 1.15, 0.07, -1.05));
  node.add(place(store(b, plan, { width: 0.8, height: 0.9, depth: 0.42 }), 0, 0.07, -1.1));
  node.add(place(documentTray(b), 0.5, SCALE.desk + 0.05, 0.7));
  node.add(place(planter(b, 0.85), -1.4, 0.07, 0.85));
  const display = wallScreen(b, plan.role, { width: 1.5, height: 0.9 });
  display.position.set(0, 1.85, -1.24);
  node.add(display);
  return node;
}

/** Strategy Room: a planning board covered in work items, and a table to argue around. */
function strategyRoom(options: StationOptions): THREE.Group {
  const { b, plan } = options;
  const node = base(options, { deskWidth: 1.7, deskTop: b.m.wood });
  node.add(place(boardStand(b, plan.role, { width: 1.7, height: 1.05 }), 0, 0.07, -1.05));
  node.add(place(monitor(b, plan.role, { width: 0.66 }), 0.42, 0.07, 0.78));
  node.add(place(consoleUnit(b, plan.role, { width: 0.7 }), -0.55, 0.07, 0.72));
  node.add(place(store(b, plan, { width: 0.7, height: 0.8, depth: 0.4 }), -1.25, 0.07, -0.9));
  node.add(place(planter(b, 0.8), 1.35, 0.07, -0.9));
  return node;
}

/** Development Studio: a multi-screen build bench, a tower, a tool wall and crates. */
function devStudio(options: StationOptions): THREE.Group {
  const { b, plan } = options;
  const node = base(options, { deskWidth: 2.2 });
  node.add(place(monitorBank(b, plan.role, 3), 0, 0.07, 0.8));
  node.add(place(serverTower(b, plan.role, { height: 0.95 }), -1.05, 0.07, -0.95));
  node.add(place(equipmentRack(b, plan.role, { width: 0.7, height: 1.4 }), -1.5, 0.07, -1.0));
  node.add(place(toolBoard(b, plan.role), 0.35, 1.35, -1.26));
  node.add(place(crate(b, 0.44), 1.3, 0.07, -0.9));
  node.add(place(crate(b, 0.36), 1.3, 0.38, -0.9));
  node.add(place(documentTray(b), -0.6, SCALE.desk + 0.05, 0.68));
  node.add(place(holoPanel(b, plan.role, { width: 0.8, height: 0.45 }), 1.05, 1.5, 0.85));
  return node;
}

/** Verification Laboratory: an instrument bench, a unit under test, probes and readouts. */
function verificationLab(options: StationOptions): THREE.Group {
  const { b, plan } = options;
  const node = base(options, { deskWidth: 2.0 });
  node.add(place(monitor(b, plan.role, { width: 0.66 }), -0.55, 0.07, 0.78));
  node.add(place(monitor(b, plan.role, { width: 0.5, height: 0.34 }), 0.45, 0.07, 0.78));
  // A raised test bench with a device under test and a rack of instrumentation.
  const bench = group(0.05, 0.07, -0.75);
  put(bench, b.g.box(1.2, 0.08, 0.7), b.m.deskTop, 0, 0.98, 0);
  for (const dx of [-1, 1]) put(bench, b.g.box(0.08, 0.98, 0.62), b.m.deskFrame, dx * 0.54, 0.49, 0);
  put(bench, b.g.box(0.5, 0.22, 0.36), b.m.housing, -0.2, 1.13, 0);
  put(bench, b.g.box(0.3, 0.14, 0.02), b.m.screen, -0.2, 1.15, 0.19);
  put(bench, b.g.cylinder(0.02, 0.02, 0.36, 8), b.m.glow(plan.role), -0.2, 1.32, 0.1);
  put(bench, b.g.sphere(0.05, 10, 8), b.m.glow(plan.role), -0.2, 1.52, 0.1);
  node.add(bench);
  node.add(place(equipmentRack(b, plan.role, { width: 0.6, height: 1.2 }), 1.15, 0.07, -1.0));
  node.add(place(store(b, plan, { width: 0.7, height: 0.85, depth: 0.42 }), -1.15, 0.07, -1.0));
  node.add(place(documentTray(b), 0.55, SCALE.desk + 0.05, 0.68));
  return node;
}

/** Knowledge Archive: drawer stacks, reference shelving and a catalogue terminal. */
function knowledgeArchive(options: StationOptions): THREE.Group {
  const { b, plan } = options;
  const node = base(options, { deskWidth: 1.6 });
  node.add(place(monitor(b, plan.role, { width: 0.6 }), 0.35, 0.07, 0.78));
  node.add(place(drawerUnit(b, { width: 1.0, height: 1.5, role: plan.role }), -1.2, 0.07, -1.0));
  node.add(place(drawerUnit(b, { width: 0.9, height: 1.2, role: plan.role }), 1.25, 0.07, -1.0));
  node.add(place(shelfUnit(b, { width: 1.2, height: 1.45, rows: 3, role: plan.role }), 0, 0.07, -1.05));
  node.add(place(store(b, plan, { width: 0.75, height: 0.8, depth: 0.4 }), -1.3, 0.07, 0.6));
  // Reference drums, stacked where the archivist works.
  for (const [dx, dz] of [[1.3, 0.55], [1.3, 0.15], [1.42, 0.35]] as const) {
    const drum = new THREE.Group();
    put(drum, b.g.cylinder(0.14, 0.14, 0.36, 12), b.m.tint(0xb08a5e), 0, 0.18, 0);
    put(drum, b.g.cylinder(0.145, 0.145, 0.03, 12), b.m.housing, 0, 0.37, 0);
    put(drum, b.g.box(0.29, 0.06, 0.01), b.m.glow(plan.role), 0, 0.2, 0.14);
    node.add(place(drum, dx, 0.07, dz));
  }
  return node;
}

/** Review & Approval: an inspection desk, a decision display and the records being judged. */
function reviewOffice(options: StationOptions): THREE.Group {
  const { b, plan } = options;
  const node = base(options, { deskWidth: 1.9 });
  node.add(place(monitor(b, plan.role, { width: 0.7 }), 0.5, 0.07, 0.78));
  node.add(place(documentTray(b), -0.5, SCALE.desk + 0.05, 0.7));
  node.add(place(documentTray(b), -0.5, SCALE.desk + 0.12, 0.7));
  // The approval board: a decision display on a stand, with its own lit header.
  const board = boardStand(b, plan.role, { width: 1.4, height: 0.9 });
  board.position.set(0, 0.07, -1.0);
  node.add(board);
  node.add(place(store(b, plan, { width: 0.75, height: 1.0, depth: 0.42 }), 1.25, 0.07, -1.05));
  node.add(place(store(b, plan, { width: 0.7, height: 0.85, depth: 0.4 }), -1.25, 0.07, -1.0));
  node.add(place(planter(b, 0.8), 1.35, 0.07, 0.7));
  node.add(place(holoPanel(b, plan.role, { width: 0.7, height: 0.4 }), -1.0, 1.42, 0.8));
  return node;
}

const BUILDERS: Readonly<Record<Exclude<Role, 'coordinator'>, (options: StationOptions) => THREE.Group>> = Object.freeze({
  researcher: researchLab, planner: strategyRoom, builder: devStudio,
  tester: verificationLab, archivist: knowledgeArchive, reviewer: reviewOffice,
});

/** Build the station for a plan entry. The coordinator's is the command centre (facility.ts). */
export function buildStation(options: StationOptions): THREE.Group {
  const builder = BUILDERS[options.plan.role as Exclude<Role, 'coordinator'>] ?? researchLab;
  const node = builder(options);
  node.position.set(options.plan.x, 0, options.plan.z);
  node.rotation.y = options.plan.yaw;
  return node;
}

/** Place a sub-group in station-local coordinates. */
function place(node: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D {
  node.position.set(x, y, z);
  return node;
}
