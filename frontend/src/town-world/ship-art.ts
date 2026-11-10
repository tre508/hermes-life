/**
 * Hermesha Command Centre — Phase 3 environment art.
 *
 * Purely visual detail for the eight Phase-2 physical rooms. There are no
 * backend calls, agent state updates, invented task events or extra roles.
 * Build once; all meshes are static and may be merged by town-renderer-3d.
 */
import * as THREE from 'three';
import type { Builders } from './props';
import type { Track } from './palette';
import type { PhysicalRoom } from './ship-rooms';

export interface ShipArtKit {
  hull: THREE.MeshStandardMaterial;
  inset: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  warm: THREE.MeshStandardMaterial;
  cyan: THREE.MeshStandardMaterial;
  amber: THREE.MeshStandardMaterial;
  moss: THREE.MeshStandardMaterial;
  upholstery: THREE.MeshStandardMaterial;
  screen: THREE.MeshBasicMaterial;
}

/** Deterministic, shared exterior texture. No network image requests. */
function exteriorTexture(track: Track): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to create starfield canvas');
  const g = ctx.createLinearGradient(0, 0, 512, 256);
  g.addColorStop(0, '#050e23');
  g.addColorStop(0.43, '#142746');
  g.addColorStop(0.76, '#211737');
  g.addColorStop(1, '#030a18');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 256);
  const cloud = ctx.createRadialGradient(370, 115, 12, 370, 115, 180);
  cloud.addColorStop(0, 'rgba(67,102,170,.35)');
  cloud.addColorStop(0.45, 'rgba(67,37,99,.18)');
  cloud.addColorStop(1, 'rgba(16,28,60,0)');
  ctx.fillStyle = cloud;
  ctx.fillRect(0, 0, 512, 256);
  let seed = 1729;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 185; i++) {
    const x = random() * 512;
    const y = random() * 256;
    const r = random() < 0.11 ? 1.3 : 0.35 + random() * 0.55;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fillStyle = `rgba(212,236,255,${0.3 + random() * 0.7})`;
    ctx.fill();
  }
  const texture = track(new THREE.CanvasTexture(canvas));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  return texture;
}

export function createShipArtKit(track: Track): ShipArtKit {
  const surface = (color: number, metalness: number, roughness: number, emissive = 0, intensity = 0) =>
    track(new THREE.MeshStandardMaterial({ color, metalness, roughness, emissive, emissiveIntensity: intensity }));
  return {
    hull: surface(0x182333, 0.62, 0.43),
    inset: surface(0x0b1523, 0.36, 0.7),
    steel: surface(0x475563, 0.68, 0.34),
    glass: surface(0x092e41, 0.42, 0.25, 0x063746, 0.38),
    warm: surface(0xff9e61, 0.2, 0.4, 0xff6a38, 1.7),
    cyan: surface(0x62dff1, 0.05, 0.36, 0x25caff, 1.65),
    amber: surface(0xffb466, 0.1, 0.48, 0xf68a35, 0.85),
    moss: surface(0x33685b, 0.12, 0.74),
    upholstery: surface(0x75614e, 0.08, 0.86),
    screen: track(new THREE.MeshBasicMaterial({ map: exteriorTexture(track), toneMapped: false })),
  };
}

function box(b: Builders, host: THREE.Object3D, m: THREE.Material,
             w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(b.g.box(w, h, d), m);
  mesh.position.set(x, y, z);
  host.add(mesh);
  return mesh;
}

function column(b: Builders, host: THREE.Object3D, kit: ShipArtKit,
                x: number, z: number, height: number): void {
  box(b, host, kit.hull, 0.3, height, 0.3, x, height / 2, z);
  box(b, host, kit.steel, 0.4, 0.09, 0.4, x, 0.1, z);
  box(b, host, kit.cyan, 0.055, height * 0.62, 0.03, x + 0.16, height * 0.58, z);
}

function windowPanel(b: Builders, host: THREE.Object3D, kit: ShipArtKit,
                     width: number, z: number): void {
  // Rear wall in Phase 2 is at -depth/2. Face the camera into the room.
  const y = 1.25;
  const height = 0.92;
  box(b, host, kit.hull, width + 0.3, height + 0.24, 0.07, 0, y, z - 0.035);
  const pane = new THREE.Mesh(b.g.plane(width, height), kit.screen);
  pane.position.set(0, y, z + 0.02);
  host.add(pane);
  for (const edge of [-1, 1]) {
    box(b, host, kit.steel, 0.085, height + 0.24, 0.10, edge * width / 2, y, z + 0.045);
  }
  box(b, host, kit.warm, width + 0.2, 0.035, 0.08, 0, y + height / 2 + 0.11, z + 0.055);
  box(b, host, kit.cyan, width - 0.05, 0.022, 0.04, 0, y - height / 2 - 0.04, z + 0.055);
}

function monitorCluster(b: Builders, host: THREE.Object3D, kit: ShipArtKit,
                        x: number, z: number, screens: number): void {
  box(b, host, kit.hull, 1.5, 0.63, 0.75, x, 0.36, z);
  box(b, host, kit.steel, 1.6, 0.065, 0.83, x, 0.71, z);
  for (let i = 0; i < screens; i++) {
    const sx = x + (i - (screens - 1) / 2) * 0.48;
    box(b, host, kit.hull, 0.42, 0.43, 0.08, sx, 1.04, z - 0.19);
    box(b, host, kit.glass, 0.34, 0.33, 0.02, sx, 1.04, z - 0.13);
    for (let j = 0; j < 3; j++) box(b, host, kit.cyan, 0.24 - j * 0.045, 0.012, 0.023,
      sx - 0.035, 1.13 - j * 0.075, z - 0.11);
  }
}

function bookshelf(b: Builders, host: THREE.Object3D, kit: ShipArtKit, x: number, z: number): void {
  box(b, host, kit.hull, 1.4, 1.62, 0.5, x, 0.81, z);
  for (const y of [0.35, 0.77, 1.19]) {
    box(b, host, kit.steel, 1.4, 0.055, 0.55, x, y, z);
    for (let i = 0; i < 6; i++) {
      box(b, host, i % 2 ? kit.moss : kit.amber, 0.13, 0.27 + (i % 3) * 0.02, 0.22,
        x - 0.56 + i * 0.21, y + 0.17, z);
    }
  }
}

function lounge(b: Builders, host: THREE.Object3D, kit: ShipArtKit, x: number, z: number): void {
  box(b, host, kit.hull, 1.6, 0.20, 0.78, x, 0.27, z);
  box(b, host, kit.upholstery, 1.55, 0.22, 0.70, x, 0.43, z);
  box(b, host, kit.upholstery, 1.55, 0.75, 0.22, x, 0.76, z - 0.32);
  for (const side of [-1, 1]) box(b, host, kit.hull, 0.18, 0.46, 0.78,
    x + side * 0.8, 0.44, z);
}

function equipment(b: Builders, host: THREE.Object3D, kit: ShipArtKit,
                   x: number, z: number, warm = false): void {
  box(b, host, kit.hull, 0.95, 1.72, 0.66, x, 0.86, z);
  box(b, host, kit.steel, 0.81, 1.42, 0.055, x, 0.91, z + 0.35);
  for (let i = 0; i < 6; i++) box(b, host, i === 0 ? kit.cyan : kit.inset,
    0.56, 0.055, 0.066, x, 0.34 + i * 0.19, z + 0.392);
  box(b, host, warm ? kit.warm : kit.cyan, 0.52, 0.07, 0.05, x, 1.49, z + 0.4);
}

function roomDetails(b: Builders, host: THREE.Object3D, room: PhysicalRoom, kit: ShipArtKit): void {
  // All extra furniture stays against peripheral walls; existing, backend-
  // driven workstations and residents retain their own central footprints.
  const w = room.width / 2, d = room.depth / 2;
  const rearZ = -d + 0.84;
  const leftX = -w + 0.95, rightX = w - 0.95;
  switch (room.id) {
    case 'director_office':
      bookshelf(b, host, kit, leftX + 0.05, rearZ + 0.24);
      lounge(b, host, kit, rightX - 0.2, 0.1);
      break;
    case 'research_station':
      monitorCluster(b, host, kit, leftX + 0.15, rearZ + 0.2, 2);
      bookshelf(b, host, kit, rightX - 0.3, rearZ + 0.1);
      break;
    case 'review_station':
      monitorCluster(b, host, kit, rightX - 0.1, rearZ + 0.2, 2);
      equipment(b, host, kit, leftX + 0.1, rearZ + 0.2);
      break;
    case 'dev_station':
      monitorCluster(b, host, kit, leftX + 0.1, rearZ + 0.2, 3);
      equipment(b, host, kit, rightX - 0.1, rearZ + 0.2);
      break;
    case 'control_room': {
      for (const sign of [-1, 1]) {
        equipment(b, host, kit, sign * (w - 0.8), rearZ + 0.2);
        box(b, host, kit.cyan, 0.4, 0.04, 0.4, sign * 1.0, 0.12, d - 0.8);
      }
      // Low luminous ring around the central dais, not another podium.
      const ring = new THREE.Mesh(b.g.torus(2.75, 0.035), kit.cyan);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.065;
      host.add(ring);
      break;
    }
    case 'lab':
      equipment(b, host, kit, leftX + 0.05, rearZ + 0.2, true);
      equipment(b, host, kit, rightX - 0.05, rearZ + 0.2);
      break;
    case 'archive':
      bookshelf(b, host, kit, leftX + 0.15, rearZ + 0.2);
      bookshelf(b, host, kit, rightX - 0.15, rearZ + 0.2);
      break;
    case 'break_room':
      lounge(b, host, kit, leftX + 0.12, rearZ + 0.45);
      lounge(b, host, kit, rightX - 0.18, rearZ + 0.45);
      box(b, host, kit.hull, 1.0, 0.42, 0.72, 0, 0.21, 0);
      box(b, host, kit.steel, 1.1, 0.055, 0.78, 0, 0.45, 0);
      break;
  }
}

/** Add decorative architectural material and room-appropriate static props. */
export function buildRoomArt(b: Builders, room: PhysicalRoom, kit: ShipArtKit): THREE.Group {
  const node = new THREE.Group();
  node.name = `art-${room.id}`;
  const w = room.width / 2, d = room.depth / 2;
  // Dark deck inset and metallic surface bands reinforce room identity.
  box(b, node, kit.inset, room.width - 0.48, 0.012, 0.12, 0, 0.032, -d + 0.18);
  box(b, node, kit.hull, room.width - 0.4, 0.085, 0.32, 0, 0.045, d - 0.22);
  for (const sign of [-1, 1]) {
    column(b, node, kit, sign * (w - 0.25), -d + 0.22, 1.62);
    box(b, node, kit.warm, 0.09, 0.62, 0.08,
      sign * (0.94), 0.62, d - 0.025);
    box(b, node, kit.steel, 0.14, 0.24, room.depth - 0.45,
      sign * (w - 0.13), 1.58, 0);
  }
  // Facade: a real (texture-backed) window instead of a blank glowing strip.
  windowPanel(b, node, kit, Math.min(room.width - 2.1, room.id === 'control_room' ? 3.0 : 2.4), -d + 0.3);
  roomDetails(b, node, room, kit);
  return node;
}

/** Low-cost corridor surface detailing; does not obstruct openings. */
export function decorateShipCorridor(b: Builders, node: THREE.Group, distance: number,
                                     kit: ShipArtKit): void {
  const n = Math.max(1, Math.floor(distance / 1.6));
  for (let i = 0; i < n; i++) {
    const z = -distance / 2 + ((i + 0.5) / n) * distance;
    box(b, node, kit.steel, 2.37, 0.015, 0.09, 0, 0.018, z);
    for (const side of [-1, 1])
      box(b, node, i % 2 ? kit.amber : kit.warm, 0.085, 0.018, 0.5,
        side * 1.13, 0.065, z);
  }
}
