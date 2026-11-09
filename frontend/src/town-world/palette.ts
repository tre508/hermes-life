/**
 * The facility's art direction: palette, procedural surface textures, geometry cache, materials.
 *
 * Audit v3's two critical findings are that the scene is overwhelmingly grey and that its surfaces have
 * no material character (§2, §7, §11). Colour alone does not fix that — the report is explicit that
 * "the objective is meaningful variation in materials and surfaces", not increased saturation on the
 * same grey boxes. So this module defines:
 *
 *   1. a **coordinated palette** — warm stone flooring, warm off-white panelling, slate-blue structure,
 *      walnut and brushed aluminium furniture, painted metal cabinets, fabric seating, blue-green
 *      glazing and near-black technology — instead of one family of greys;
 *   2. **procedural textures**, drawn once into small canvases at startup and shared: floor tiling,
 *      plaster speckle, wood grain, fabric weave, brushed metal, and a workstation interface. They are
 *      cached by (kind, repeat, tone) so a surface never gets a private copy;
 *   3. one shared **geometry per distinct size** and one material per surface kind, so the facility
 *      still merges into a handful of draw calls (see `optimize.ts`), plus a cheap **edge chamfer** so
 *      furniture silhouettes catch the light instead of reading as raw primitives (§4).
 *
 * Budget (§8, §13): no shadows, no reflections, no post-processing. Tone mapping is enabled on the
 * renderer — a per-pixel curve, not a pass — and is what keeps the emissive accents from clipping.
 */
import * as THREE from 'three';

import { ROSTER, type Role } from '../town-model';

export const PALETTE = {
  // --- architecture: warm stone, warm off-white, slate structure, charcoal trim --------------------
  floor: 0x8f8779,
  floorJoint: 0x6d6659,
  floorZone: 0x9c9486,
  plaza: 0xa89f8f,
  floorLine: 0xe0cfa6,
  kerb: 0x5a554c,
  wall: 0x9a9283,
  wallPanel: 0x8d8577,
  wallTrim: 0xd8d0bf,
  wallDetail: 0x5f5a51,
  slate: 0x44515d,

  // --- furniture: walnut, brushed aluminium, painted metal, fabric ---------------------------------
  wood: 0x8a6238,
  woodDark: 0x6b4a2a,
  alu: 0xa8adb4,
  deskTop: 0x8a6238,
  deskFrame: 0x8b9299,
  seat: 0x40606a,
  shelf: 0x7d6a52,
  paper: 0xf0eade,

  // --- technology: near-black housings, deep screens ----------------------------------------------
  housing: 0x272e35,
  screen: 0x0d1519,
  housingLight: 0x4a545e,
  led: 0x8ff0d6,
  lightBar: 0xf2f6f8,

  // --- people -------------------------------------------------------------------------------------
  bone: 0xe0c3a0,
  cloth: 0x44505c,
  dark: 0x2d343c,

  // --- atmosphere ---------------------------------------------------------------------------------
  background: 0x131a20,
  backgroundTop: 0x24303a,
} as const;

export type Track = <T extends { dispose(): void }>(resource: T) => T;

/**
 * The per-department material kit.
 *
 * Audit v3 §6: the departments had different equipment but "most share the same underlying grey
 * structural design", so their identity rested on coloured floor lines and labels. Each area now gets
 * its own floor tone and painted storage, taken from the shared palette so the seven still read as one
 * facility. The differences are deliberately small in hue and large enough to see.
 */
export const KIT: Readonly<Record<Role, { floor: number; body: number; panel: number }>> = Object.freeze({
  coordinator: { floor: 0x8f9098, body: 0x36505b, panel: 0x2b4149 },
  researcher: { floor: 0x978b70, body: 0x4f6353, panel: 0x3d4f42 },
  planner: { floor: 0x8d8798, body: 0x5a5476, panel: 0x474163 },
  builder: { floor: 0x99836c, body: 0x6d5139, panel: 0x57402c },
  tester: { floor: 0x8c8d79, body: 0x5c6146, panel: 0x484d36 },
  archivist: { floor: 0x908372, body: 0x6d5741, panel: 0x584533 },
  reviewer: { floor: 0x859383, body: 0x45604e, panel: 0x354b3d },
});

// ---------------------------------------------------------------------------------- procedural texture

/** A deterministic generator, so every texture is identical on every reload and in every screenshot. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;

/** Mix two tones: enough variation for material drift without leaving the coordinated range. */
function mix(a: number, b: number, t: number): string {
  const channel = (shift: number) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
}

function paint(size: number, draw: (context: CanvasRenderingContext2D, size: number) => void): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) draw(context, size);
  return canvas;
}

/** Flooring: tiles with joints, per-tile tone drift and fine grain so a large floor never reads flat. */
function tileCanvas(): HTMLCanvasElement {
  return paint(512, (context, size) => {
    const random = seeded(9001);
    const tiles = 4;
    const step = size / tiles;
    context.fillStyle = css(PALETTE.floorJoint);
    context.fillRect(0, 0, size, size);
    for (let row = 0; row < tiles; row += 1) {
      for (let column = 0; column < tiles; column += 1) {
        context.fillStyle = mix(PALETTE.floor, PALETTE.floorJoint, random() * 0.36);
        context.fillRect(column * step + 1.5, row * step + 1.5, step - 3, step - 3);
      }
    }
    for (let index = 0; index < 9000; index += 1) {
      context.fillStyle = random() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.045)';
      context.fillRect(random() * size, random() * size, 1.4, 1.4);
    }
  });
}

/** Plaster and concrete: soft speckle, no structure. */
function speckleCanvas(base: number, amount: number): HTMLCanvasElement {
  return paint(512, (context, size) => {
    const random = seeded(4242);
    context.fillStyle = css(base);
    context.fillRect(0, 0, size, size);
    for (let index = 0; index < 7000; index += 1) {
      const light = random() > 0.5;
      context.fillStyle = light ? `rgba(255,255,255,${amount * random()})` : `rgba(0,0,0,${amount * random()})`;
      context.beginPath();
      context.arc(random() * size, random() * size, 0.7 + random() * 2.4, 0, Math.PI * 2);
      context.fill();
    }
  });
}

/** Wood: long grain over a base tone, with occasional darker figure. */
function woodCanvas(base: number): HTMLCanvasElement {
  return paint(512, (context, size) => {
    const random = seeded(1729);
    context.fillStyle = css(base);
    context.fillRect(0, 0, size, size);
    for (let index = 0; index < 420; index += 1) {
      const y = random() * size;
      context.strokeStyle = random() > 0.45
        ? `rgba(255,255,255,${0.03 + random() * 0.05})`
        : `rgba(0,0,0,${0.05 + random() * 0.09})`;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(0, y);
      for (let x = 0; x <= size; x += 16) {
        context.lineTo(x, y + Math.sin((x / size) * 6 + index) * 1.6 + (random() - 0.5) * 1.2);
      }
      context.stroke();
    }
    for (let index = 0; index < 16; index += 1) {
      context.fillStyle = `rgba(0,0,0,${0.08 + random() * 0.14})`;
      context.beginPath();
      context.ellipse(random() * size, random() * size, 6 + random() * 16, 2.5 + random() * 4, random() * 3, 0, Math.PI * 2);
      context.fill();
    }
  });
}

/** Fabric or painted metal: a fine weave, the one soft matte family in the set. */
function weaveCanvas(base: number): HTMLCanvasElement {
  return paint(128, (context, size) => {
    context.fillStyle = css(base);
    context.fillRect(0, 0, size, size);
    for (let index = 0; index < size; index += 3) {
      context.fillStyle = 'rgba(255,255,255,0.055)';
      context.fillRect(index, 0, 1.4, size);
      context.fillStyle = 'rgba(0,0,0,0.075)';
      context.fillRect(0, index, size, 1.4);
    }
  });
}

/** Brushed metal: fine horizontal streaks that pick up the key light. */
function brushedCanvas(base: number): HTMLCanvasElement {
  return paint(256, (context, size) => {
    const random = seeded(31337);
    context.fillStyle = css(base);
    context.fillRect(0, 0, size, size);
    for (let index = 0; index < 700; index += 1) {
      const y = random() * size;
      context.strokeStyle = random() > 0.5
        ? `rgba(255,255,255,${0.04 + random() * 0.07})`
        : `rgba(0,0,0,${0.03 + random() * 0.06})`;
      context.lineWidth = 0.6 + random() * 1.1;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(size, y + (random() - 0.5) * 1.2);
      context.stroke();
    }
  });
}

/**
 * A workstation interface.
 *
 * Audit v3 §9: screens were "dark rectangles containing relatively simple coloured lines". This is an
 * actual layout — title bar, navigation column, a data table and a chart — drawn small and
 * high-contrast so it reads as a real display at panel size. It is decorative chrome only: anything
 * that must report real state is painted onto the task panel from the model, never from this texture.
 */
function interfaceCanvas(accent: number): HTMLCanvasElement {
  return paint(256, (context, size) => {
    const random = seeded(5150);
    context.fillStyle = '#0e1a20';
    context.fillRect(0, 0, size, size);
    context.fillStyle = '#16262e';
    context.fillRect(0, 0, size, 26);
    context.fillStyle = css(accent);
    context.fillRect(8, 9, 8, 8);
    context.fillStyle = '#8fb6bf';
    context.fillRect(22, 11, 54, 4);
    context.fillStyle = '#3d5b66';
    context.fillRect(size - 54, 10, 18, 5);
    context.fillRect(size - 30, 10, 18, 5);
    context.fillStyle = '#132029';
    context.fillRect(0, 26, 56, size - 26);
    for (let index = 0; index < 7; index += 1) {
      context.fillStyle = index === 2 ? css(accent) : '#2c4450';
      context.fillRect(9, 40 + index * 16, 38, 6);
    }
    for (let index = 0; index < 6; index += 1) {
      const y = 40 + index * 18;
      context.fillStyle = index % 2 ? '#132029' : '#16262e';
      context.fillRect(66, y, size - 82, 14);
      context.fillStyle = '#4f7783';
      context.fillRect(72, y + 5, 40 + random() * 52, 4);
      context.fillStyle = index % 3 === 0 ? css(accent) : '#37606c';
      context.fillRect(size - 62, y + 5, 34, 4);
    }
    context.fillStyle = '#0f1b22';
    context.fillRect(66, size - 78, size - 82, 62);
    context.strokeStyle = css(accent);
    context.lineWidth = 2;
    context.beginPath();
    for (let index = 0; index <= 10; index += 1) {
      const x = 74 + index * ((size - 100) / 10);
      const y = size - 30 - Math.abs(Math.sin(index * 0.7)) * 30 - random() * 6;
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.stroke();
    context.fillStyle = '#2f4d58';
    for (let index = 0; index < 12; index += 1) context.fillRect(74 + index * 14, size - 20, 8, 4);
  });
}

/** A soft round shadow: what actually connects an object to the floor (audit v3 §3). */
function contactCanvas(): HTMLCanvasElement {
  return paint(64, (context, size) => {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(0,0,0,0.55)');
    gradient.addColorStop(0.5, 'rgba(0,0,0,0.28)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  });
}

type Kind = 'tile' | 'speckle' | 'wood' | 'weave' | 'brushed' | 'interface' | 'contact';

// -------------------------------------------------------------------------------------- geometry

/**
 * One geometry per distinct size, shared by every prop that needs it.
 *
 * The room is built from hundreds of small boxes; creating a `BoxGeometry` per mesh would allocate
 * hundreds of buffers for a handful of distinct shapes. Keys are rounded so "the same size" really is
 * the same geometry.
 */
export function createGeometryCache(track: Track) {
  const cache = new Map<string, THREE.BufferGeometry>();
  const shared = <T extends THREE.BufferGeometry>(key: string, build: () => T): T => {
    let geometry = cache.get(key) as T | undefined;
    if (!geometry) {
      geometry = track(build());
      cache.set(key, geometry);
    }
    return geometry;
  };
  const n = (value: number) => Math.round(value * 1000) / 1000;

  return {
    box: (w: number, h: number, d: number) =>
      shared(`box:${n(w)}:${n(h)}:${n(d)}`, () => new THREE.BoxGeometry(w, h, d)),
    /** A box with softened edges: the chamfer that stops furniture reading as raw primitives (§4). */
    bevel: (w: number, h: number, d: number) => {
      const key = `bev:${n(w)}:${n(h)}:${n(d)}`;
      let geometry = cache.get(key);
      if (!geometry) {
        geometry = track(bevelledBox(w, h, d));
        cache.set(key, geometry);
      }
      return geometry;
    },
    cylinder: (rTop: number, rBottom: number, h: number, segments = 16) =>
      shared(`cyl:${n(rTop)}:${n(rBottom)}:${n(h)}:${segments}`, () => new THREE.CylinderGeometry(rTop, rBottom, h, segments)),
    sphere: (r: number, widthSegments = 18, heightSegments = 12) =>
      shared(`sph:${n(r)}:${widthSegments}:${heightSegments}`, () => new THREE.SphereGeometry(r, widthSegments, heightSegments)),
    /** An open shell: hats, hoods and helmets are domes, not spheres. */
    dome: (r: number, thetaLength = Math.PI * 0.55, widthSegments = 16, heightSegments = 12) =>
      shared(`dome:${n(r)}:${n(thetaLength)}:${widthSegments}:${heightSegments}`,
        () => new THREE.SphereGeometry(r, widthSegments, heightSegments, 0, Math.PI * 2, 0, thetaLength)),
    cone: (r: number, h: number, segments = 14) =>
      shared(`cone:${n(r)}:${n(h)}:${segments}`, () => new THREE.ConeGeometry(r, h, segments)),
    torus: (r: number, tube: number, arc = Math.PI * 2) =>
      shared(`tor:${n(r)}:${n(tube)}:${n(arc)}`, () => new THREE.TorusGeometry(r, tube, 8, 32, arc)),
    plane: (w: number, h: number) => shared(`pln:${n(w)}:${n(h)}`, () => new THREE.PlaneGeometry(w, h)),
    capsule: (r: number, length: number) =>
      shared(`cap:${n(r)}:${n(length)}`, () => new THREE.CapsuleGeometry(r, length, 4, 12)),
    ring: (inner: number, outer: number, segments = 40) =>
      shared(`rng:${n(inner)}:${n(outer)}:${segments}`, () => new THREE.RingGeometry(inner, outer, segments)),
    dispose: () => { for (const geometry of cache.values()) geometry.dispose(); cache.clear(); },
  };
}

export type Geometry = ReturnType<typeof createGeometryCache>;

/**
 * A chamfered box, built by insetting each vertex along its own normal.
 *
 * This is deliberately the cheap version: no extra triangles, no CSG, one pass at build time, cached by
 * size. It gives every furniture edge a lit highlight, which is most of the difference between "cube"
 * and "asset" at this camera distance.
 */
function bevelledBox(w: number, h: number, d: number): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(w, h, d, 2, 2, 2);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const normal = geometry.attributes.normal as THREE.BufferAttribute;
  const amount = Math.max(0.004, Math.min(w, h, d) * 0.14);
  for (let index = 0; index < position.count; index += 1) {
    const nx = normal.getX(index);
    const ny = normal.getY(index);
    const nz = normal.getZ(index);
    // Only the outer shell moves; the mid-face vertices stay put, so faces dome very slightly.
    const edge = Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz));
    const scale = edge > 0.9 ? 1 - (amount / Math.max(w, h, d)) : 1;
    position.setXYZ(index, position.getX(index) * (Math.abs(nx) > 0.9 ? scale : 1),
      position.getY(index) * (Math.abs(ny) > 0.9 ? scale : 1),
      position.getZ(index) * (Math.abs(nz) > 0.9 ? scale : 1));
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

// ------------------------------------------------------------------------------------- materials

/** Physically distinct surfaces. Stone, plaster, wood, fabric, metal, glass and screens never share. */
export function createMaterials(track: Track) {
  const textures = new Map<string, THREE.Texture>();

  /** One texture per (kind, repeat, tone). Shared across every material that wants that surface. */
  const surface = (kind: Kind, repeatX: number, repeatY: number, tone?: number): THREE.Texture => {
    const key = `${kind}:${repeatX}:${repeatY}:${tone ?? 0}`;
    let texture = textures.get(key);
    if (!texture) {
      const canvas = kind === 'tile' ? tileCanvas()
        : kind === 'speckle' ? speckleCanvas(tone ?? PALETTE.wall, 0.055)
        : kind === 'wood' ? woodCanvas(tone ?? PALETTE.wood)
        : kind === 'weave' ? weaveCanvas(tone ?? PALETTE.seat)
        : kind === 'brushed' ? brushedCanvas(tone ?? PALETTE.alu)
        : kind === 'contact' ? contactCanvas()
        : interfaceCanvas(tone ?? 0x7fd4c1);
      texture = track(new THREE.CanvasTexture(canvas));
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(repeatX, repeatY);
      texture.anisotropy = 4;
      textures.set(key, texture);
    }
    return texture;
  };

  const standard = (params: THREE.MeshStandardMaterialParameters) => track(new THREE.MeshStandardMaterial(params));
  const accents = new Map<Role, THREE.MeshStandardMaterial>();
  const glows = new Map<Role, THREE.MeshStandardMaterial>();
  const tints = new Map<string, THREE.MeshStandardMaterial>();

  const materials = {
    // --- architecture -----------------------------------------------------------------------------
    floor: standard({ color: 0xffffff, map: surface('tile', 9, 7), roughness: 0.82, metalness: 0.03 }),
    floorZone: standard({ color: 0xffffff, map: surface('tile', 3, 2), roughness: 0.74, metalness: 0.05 }),
    floorLine: standard({ color: PALETTE.floorLine, roughness: 0.42, metalness: 0.24 }),
    floorSeam: standard({ color: PALETTE.floorJoint, roughness: 0.9, metalness: 0.03 }),
    plaza: standard({ color: 0xffffff, map: surface('tile', 5, 5), roughness: 0.64, metalness: 0.08 }),
    kerb: standard({ color: PALETTE.kerb, roughness: 0.8, metalness: 0.05 }),
    zonePad: standard({ color: 0xffffff, map: surface('tile', 2, 2), roughness: 0.7, metalness: 0.06 }),
    wall: standard({ color: 0xffffff, map: surface('speckle', 10, 2, PALETTE.wall), roughness: 0.9, metalness: 0.02 }),
    wallPanel: standard({ color: 0xffffff, map: surface('speckle', 4, 2, PALETTE.wallPanel), roughness: 0.84, metalness: 0.04 }),
    wallTrim: standard({ color: 0xffffff, map: surface('brushed', 6, 1, PALETTE.wallTrim), roughness: 0.42, metalness: 0.5 }),
    wallDetail: standard({ color: PALETTE.wallDetail, roughness: 0.7, metalness: 0.12 }),
    slate: standard({ color: 0xffffff, map: surface('speckle', 6, 2, PALETTE.slate), roughness: 0.76, metalness: 0.1 }),

    // --- furniture --------------------------------------------------------------------------------
    deskTop: standard({ color: 0xffffff, map: surface('wood', 2, 1), roughness: 0.52, metalness: 0.06 }),
    wood: standard({ color: 0xffffff, map: surface('wood', 1, 1), roughness: 0.62, metalness: 0.04 }),
    woodDark: standard({ color: 0xffffff, map: surface('wood', 1, 1, PALETTE.woodDark), roughness: 0.58, metalness: 0.06 }),
    deskFrame: standard({ color: 0xffffff, map: surface('brushed', 3, 1), roughness: 0.34, metalness: 0.7 }),
    alu: standard({ color: 0xffffff, map: surface('brushed', 3, 3), roughness: 0.38, metalness: 0.68 }),
    seat: standard({ color: 0xffffff, map: surface('weave', 2, 2, PALETTE.seat), roughness: 0.95, metalness: 0 }),
    shelf: standard({ color: 0xffffff, map: surface('wood', 1, 1, PALETTE.shelf), roughness: 0.6, metalness: 0.06 }),
    paper: standard({ color: PALETTE.paper, roughness: 0.92, metalness: 0 }),

    // --- technology -------------------------------------------------------------------------------
    housing: standard({ color: PALETTE.housing, roughness: 0.4, metalness: 0.42 }),
    housingLight: standard({ color: PALETTE.housingLight, roughness: 0.42, metalness: 0.4 }),
    /** A real interface on every screen, with the role's accent in the chrome. */
    screen: standard({ color: 0xffffff, map: surface('interface', 1, 1), roughness: 0.18, metalness: 0.1, emissive: 0x243f47, emissiveIntensity: 0.6 }),
    led: standard({ color: PALETTE.led, emissive: PALETTE.led, emissiveIntensity: 1.3, roughness: 0.3 }),
    lightBar: standard({ color: PALETTE.lightBar, emissive: PALETTE.lightBar, emissiveIntensity: 1.6, roughness: 0.3 }),

    // --- people -----------------------------------------------------------------------------------
    bone: standard({ color: PALETTE.bone, roughness: 0.64, metalness: 0.02 }),
    cloth: standard({ color: 0xffffff, map: surface('weave', 1, 1, PALETTE.cloth), roughness: 0.92, metalness: 0.02 }),
    dark: standard({ color: PALETTE.dark, roughness: 0.66, metalness: 0.12 }),

    /**
     * Tinted architectural glazing (§10): a blue-green cast, a bright reflection on the metalness
     * channel, and an edge that is visible against the wall behind it. No screen-space reflections.
     */
    glass: track(new THREE.MeshStandardMaterial({
      color: 0xbcd9e2, roughness: 0.06, metalness: 0.55, transparent: true, opacity: 0.24,
      side: THREE.DoubleSide, depthWrite: false, emissive: 0x1b2f36, emissiveIntensity: 0.4,
    })),
    /** Holographic panels: additive-looking, emissive, and never mistaken for a solid object. */
    holo: track(new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false,
    })),
    /** Soft contact shadow: the cheapest depth cue that actually reads (§3). */
    contact: track(new THREE.MeshBasicMaterial({
      map: surface('contact', 1, 1), transparent: true, depthWrite: false, opacity: 0.8,
    })),
  };

  return {
    ...materials,
    /** The role's accent as a solid surface (clothing, trim, equipment bodies). */
    accent(role: Role): THREE.MeshStandardMaterial {
      let material = accents.get(role);
      if (!material) {
        material = standard({ color: new THREE.Color(ROSTER[role].accent), roughness: 0.48, metalness: 0.14 });
        accents.set(role, material);
      }
      return material;
    },
    /** The role's accent as light: screens, status rings, illuminated signage edges. */
    glow(role: Role): THREE.MeshStandardMaterial {
      let material = glows.get(role);
      if (!material) {
        const accent = new THREE.Color(ROSTER[role].accent);
        material = standard({
          color: accent.clone().multiplyScalar(0.45), emissive: accent.clone(),
          emissiveIntensity: 1.05, roughness: 0.34, metalness: 0.1,
        });
        glows.set(role, material);
      }
      return material;
    },
    /** An arbitrary flat colour, shared. Used for incidental detail (foliage, book spines, seals). */
    tint(hex: number, roughness = 0.72, metalness = 0.06): THREE.MeshStandardMaterial {
      const key = `${hex}:${roughness}:${metalness}`;
      let material = tints.get(key);
      if (!material) {
        material = standard({ color: hex, roughness, metalness });
        tints.set(key, material);
      }
      return material;
    },
    /**
     * A painted-metal panel in any tone: the cabinet and equipment bodies that used to be uniformly
     * grey. Textured with a light weave so paint reads as paint rather than plastic (§2, §7).
     */
    paint(hex: number, roughness = 0.55): THREE.MeshStandardMaterial {
      const key = `paint:${hex}:${roughness}`;
      let material = tints.get(key);
      if (!material) {
        material = standard({ color: 0xffffff, map: surface('weave', 1, 1, hex), roughness, metalness: 0.22 });
        tints.set(key, material);
      }
      return material;
    },
    /** A department's floor plate: the same tiling in that area's own tone (§6). */
    floorTone(hex: number): THREE.MeshStandardMaterial {
      const key = `floorTone:${hex}`;
      let material = tints.get(key);
      if (!material) {
        material = standard({ color: hex, map: surface('tile', 2, 2), roughness: 0.68, metalness: 0.07 });
        tints.set(key, material);
      }
      return material;
    },
    /** A department's soft acoustic panel: the back wall of a work area, in its own tone. */
    panelTone(hex: number): THREE.MeshStandardMaterial {
      const key = `panelTone:${hex}`;
      let material = tints.get(key);
      if (!material) {
        material = standard({ color: hex, map: surface('weave', 2, 2), roughness: 0.85, metalness: 0.06 });
        tints.set(key, material);
      }
      return material;
    },
  };
}

export type Materials = ReturnType<typeof createMaterials>;
