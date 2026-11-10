/**
 * The 3D facility — orchestrator, not artwork.
 *
 * The art direction lives in `town-world/`:
 *   palette.ts       the palette, one shared geometry per size, and the material set
 *   layout.ts        the pure model → floor-plan mapping, and the proportional system
 *   labels.ts        presentation vocabulary and billboarded text
 *   props.ts         reusable furniture and equipment
 *   workstations.ts  the seven stations, each composed differently
 *   residents.ts     the seven stylized characters
 *   facility.ts      the room, its architecture and the command centre
 *
 * What belongs here: the camera, the lights, the state → visual mapping, the animation, picking, and the
 * lifecycle. Movement and pose are driven by exactly two model fields and nothing else:
 *   - `Resident.location` decides WHERE a figure stands (`spotFor`), so the coordinator visibly relocates
 *     to the building whose tool is running and walks home when it ends;
 *   - `Resident.state` decides WHAT it looks like (`activityVisual`), through one table.
 *
 * The table is deliberately blunt about the difference that matters most: only `working` may look like
 * work. `waiting_approval` and `queued` get a badge and a still figure; `failed` and `blocked` get a
 * stationary alert; `unknown` gets an unknown marker and no invented motion; `completed` gets a short
 * one-shot acknowledgement and nothing more.
 *
 * Nothing here infers activity. A `completed` is only acknowledged on a real transition — a reload that
 * opens on a stale completed record draws a still figure (acceptance criterion 8).
 *
 * Budget (§8): devicePixelRatio capped at 1.5, no shadows, no post-processing, two lights plus emissive
 * accents, one shared geometry per distinct size, no per-frame allocation, rendering paused while the
 * tab is hidden.
 */
import * as THREE from 'three';

import { ROLES, ROSTER, type Activity, type LocationId, type Role, type TownState } from './town-model';
import type { RendererPoint, TownRenderer } from './town-renderer';
import { DESIGN, mountInto, stateWordFor } from './town-renderer';
import { CONTENT, DAIS_HEIGHT, ROOM, facilityPlan, seatTurnFor, spotFor, walkEase } from './town-world/layout';
import { createGeometryCache, createMaterials, PALETTE, type Materials, type Track } from './town-world/palette';
import { residentName, taskPanel, type TaskPanel } from './town-world/labels';
import { locationLabel } from './town-vocabulary';
import { buildCommandCentre, buildFacility } from './town-world/facility';
import { buildResident, type ResidentParts } from './town-world/residents';
import type { Expression } from './town-world/faces';
import { mergeStaticGeometry } from './town-world/optimize';
import { buildStation } from './town-world/workstations';
import { contactPatch } from './town-world/props';
import { PHYSICAL_ROOMS, roomToWorld, type PhysicalRoomId } from './town-world/ship-rooms';

/** A 45° azimuth with a low 27° eye: the projection then matches the wide panel, and the viewer looks
 * into the room rather than down onto a model (audit v2 §4, §5). */
const ISO = { azimuthDeg: 45, elevationDeg: 27, distance: 70 } as const;

/** Compute the facility center from the actual room geometry so the camera tracks the real layout. */
function computeFacilityCenter(): THREE.Vector3 {
  let sumX = 0, sumZ = 0;
  for (const room of PHYSICAL_ROOMS) {
    const p = roomToWorld(room.u, room.v);
    sumX += p.x;
    sumZ += p.z;
  }
  return new THREE.Vector3(sumX / PHYSICAL_ROOMS.length, CONTENT.y / 2, sumZ / PHYSICAL_ROOMS.length);
}

/** One walk, and one completion acknowledgement. Both are short on purpose. */
const WALK_SECONDS = 0.75;
const FLASH_MS = 900;
const MAX_FRAME_SECONDS = 0.05;

/** Emissive levels for a role's hardware: a whole station lights from one shared material. */
const GLOW = { resting: 0.5, working: 1.7, attention: 0.9 } as const;

/** How high a chair's seat is, matching `workstations.ts`. */
const CHAIR = { seat: 0.46, pad: 0.07 };

/** Seated and standing poses, in radians. Named so the intent survives the numbers. */
const POSE = {
  sitThigh: -1.36,
  sitKnee: 1.3,
  sitLean: 0.1,
  sitShoulder: -0.95,
  sitElbow: -0.55,
  foldShoulder: -0.72,
  foldElbow: -1.45,
  alertLean: -0.05,
} as const;

// --------------------------------------------------------------------------- the activity table

/** What the figure does. Only `working` is allowed to look like work. */
export type Pose = 'idle' | 'working' | 'waiting' | 'alert' | 'unknown';

/** The floating marker above the figure. Each kind has its own shape, so shape alone tells them apart. */
export type Badge = 'none' | 'queued' | 'waiting' | 'alert' | 'unknown';

export interface ActivityVisual {
  pose: Pose;
  badge: Badge;
  /** `task` puts the resident's real label on the station readout; `dim` leaves it unlit. */
  screen: 'task' | 'dim';
  /** A short one-shot acknowledgement, played only as this state is *entered*. */
  flash: boolean;
  /** The face this state wears (§4). It may never suggest work that is not happening. */
  face: Expression;
  /** Whether this state works *at a desk*, so a resident at its own station can sit down (§10). */
  seat: boolean;
}

/**
 * `Activity` → how it looks. This is the master spec §6 mapping contract, in one place.
 *
 * The two rules that carry the most weight:
 *   - only `working` gets `pose: 'working'` (and therefore the seated work pose, the lit station and
 *     the focused face), so a waiting or queued resident can never be mistaken for one that is executing;
 *   - `failed` and `blocked` are `alert` — a marker and a concerned face, no motion — never a work
 *     animation.
 */
const VISUALS: Readonly<Record<Activity, ActivityVisual>> = Object.freeze({
  idle: { pose: 'idle', badge: 'none', screen: 'dim', flash: false, face: 'neutral', seat: false },
  queued: { pose: 'waiting', badge: 'queued', screen: 'dim', flash: false, face: 'patient', seat: false },
  working: { pose: 'working', badge: 'none', screen: 'task', flash: false, face: 'focused', seat: true },
  waiting_approval: { pose: 'waiting', badge: 'waiting', screen: 'dim', flash: false, face: 'patient', seat: false },
  completed: { pose: 'idle', badge: 'none', screen: 'dim', flash: true, face: 'pleased', seat: false },
  failed: { pose: 'alert', badge: 'alert', screen: 'dim', flash: false, face: 'concerned', seat: false },
  blocked: { pose: 'alert', badge: 'alert', screen: 'dim', flash: false, face: 'concerned', seat: false },
  unknown: { pose: 'unknown', badge: 'unknown', screen: 'dim', flash: false, face: 'neutral', seat: false },
});

/** Never guesses: an unrecognised activity reads as unknown, exactly like the model's own default. */
export function activityVisual(activity: Activity): ActivityVisual {
  return VISUALS[activity] ?? VISUALS.unknown;
}

// --------------------------------------------------------------------------- runtime structures

const BADGE_KINDS = ['queued', 'waiting', 'alert', 'unknown'] as const;
type BadgeKind = typeof BADGE_KINDS[number];

interface Figure {
  role: Role;
  parts: ResidentParts;
  visual: ActivityVisual;
  phase: number;
  /** True when this resident is working at *its own* station, so it takes the seated pose. */
  seated: boolean;
  /** Working at the command dais: there is no chair or desk there, only consoles and a hologram. */
  console: boolean;
  /** Working in someone else's department: stand at the end of that desk, facing it. */
  atDesk: boolean;
  /** The walk, in world units. `from`/`to` carry the base height; the bob is added per frame. */
  from: { x: number; y: number; z: number; yaw: number };
  to: { x: number; y: number; z: number; yaw: number };
  t: number;
  badges: Record<BadgeKind, THREE.Object3D>;
  flash: THREE.Mesh;
  flashMaterial: THREE.MeshStandardMaterial;
  flashUntil: number;
}

interface Station {
  location: LocationId;
  owner: Role;
  panel: TaskPanel;
}

/** A soft vertical gradient instead of a flat void: cheap depth behind the room (§5). */
function backgroundGradient(): THREE.Texture {
  const hex = (value: number) => `#${value.toString(16).padStart(6, '0')}`;
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, hex(PALETTE.backgroundTop));
    gradient.addColorStop(0.55, '#141c22');
    gradient.addColorStop(1, hex(PALETTE.background));
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function create3DRenderer(host: HTMLElement, opts: { motion: boolean }): TownRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  // A filmic curve, not a post pass: it rolls the emissive accents off instead of letting them clip to
  // white, which is most of the difference between "flat" and "lit" at this exposure (audit v3 §3).
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  const scene = new THREE.Scene();
  const backdrop = backgroundGradient();
  scene.background = backdrop;
  // Aerial perspective: the deck and the walls run out of the frame, and the distance softens into the
  // backdrop rather than ending at a visible edge (audit v2 §3, §11).
  scene.fog = new THREE.Fog(0x1b242c, 100, 155);

  const target = computeFacilityCenter();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  {
    const rad = Math.PI / 180;
    const azimuth = ISO.azimuthDeg * rad;
    const elevation = ISO.elevationDeg * rad;
    const direction = new THREE.Vector3(
      Math.cos(elevation) * Math.sin(azimuth),
      Math.sin(elevation),
      Math.cos(elevation) * Math.cos(azimuth));
    camera.position.copy(direction.multiplyScalar(ISO.distance).add(target));
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
  }

  // --- resources: one geometry per size, one material per surface, all disposed in destroy() --------
  const disposables: Array<{ dispose(): void }> = [];
  const track: Track = resource => { disposables.push(resource); return resource; };
  const geometry = createGeometryCache(track);
  const materials: Materials = createMaterials(track);

  // --- lighting: hemisphere base, one warm key, one cool fill. No shadow maps (§8, §13) ------------
  // Three layers, per audit v3 §3: a broad base so nothing is black, a strong directional to give every
  // surface a lit side and a shaded side, and a weak cool fill so the shaded side still shows form.
  // Depth under objects comes from the contact patches, not from shadows.
  scene.add(new THREE.HemisphereLight(0xdfe7ec, 0x3d3a30, 0.6));
  const key = new THREE.DirectionalLight(0xfff0d8, 2.75);
  key.position.set(15, 22, 11);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xa9c8e0, 0.34);
  fill.position.set(-14, 12, -11);
  scene.add(fill);
  // A low cool rim from the viewer's side: it separates silhouettes from what is behind them, which is
  // the separation the audit asks for (§11) and costs one more light, not a shadow rig.
  const rim = new THREE.DirectionalLight(0xbcd8ee, 0.42);
  rim.position.set(-8, 6, -14);
  scene.add(rim);

  // --- the facility, the command centre and the six working stations ---------------------------------
  const plan = facilityPlan();
  const builders = { g: geometry, m: materials, track };
  const centre = plan.find(entry => entry.role === 'coordinator') ?? plan[0];

  const facility = buildFacility(builders, plan);
  scene.add(facility);
  let builtMeshes = 0;
  let mergedAway = 0;
  const mergeIn = (root: THREE.Object3D) => {
    const result = mergeStaticGeometry(root, track);
    builtMeshes += result.built;
    mergedAway += result.removed;
  };
  mergeIn(facility);

  const pickable: THREE.Object3D[] = [];
  const stations: Station[] = [];

  // Invisible selection surfaces for all EIGHT physical rooms (including the
  // Break Room). These are presentation-only; backend LocationIds are intact.
  // colorWrite=false prevents an overlay from darkening the scene; the meshes
  // remain raycastable and are tracked for disposal alongside other resources.
  const roomPickMaterial = track(new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0, colorWrite: false, depthWrite: false,
    side: THREE.DoubleSide,
  }));
  const roomPickables: THREE.Mesh[] = [];
  for (const room of PHYSICAL_ROOMS) {
    const mesh = new THREE.Mesh(geometry.plane(room.width - 0.34, room.depth - 0.34), roomPickMaterial);
    const p = roomToWorld(room.u, room.v);
    mesh.rotation.set(-Math.PI / 2, Math.PI / 4, 0, 'YXZ');
    mesh.position.set(p.x, 0.067, p.z);
    mesh.name = `Hermesha room hit area: ${room.label}`;
    mesh.userData.physicalRoom = room.id;
    scene.add(mesh);
    roomPickables.push(mesh);
    pickable.push(mesh);
  }
  // A separate target list keeps the physical-room floor from intercepting
  // resident and workstation hits: actors/stations always have priority.
  const detailedPickables: THREE.Object3D[] = [];

  const dais = buildCommandCentre(builders, centre, track);
  const centrePanel = taskPanel(track, 2.4);
  // Panels live in world space and are positioned over the resident each frame: anchoring them to the
  // station meant the readout stayed behind over the desk once a resident sat down or stepped aside.
  scene.add(centrePanel.sprite);
  dais.userData.location = centre.location;
  scene.add(dais);
  mergeIn(dais);
  pickable.push(dais);
  detailedPickables.push(dais);
  stations.push({ location: centre.location, owner: 'coordinator', panel: centrePanel });

  for (const entry of plan) {
    if (entry.role === 'coordinator') continue;
    const station = buildStation({ b: builders, plan: entry, track });
    // What a raycast on this station means: the model's own id, so the popover it opens is the same one
    // the tab navigation and the deep links already use.
    station.userData.location = entry.location;
    const panel = taskPanel(track, 2.0);
    scene.add(panel.sprite);
    scene.add(station);
    mergeIn(station);
    pickable.push(station);
    detailedPickables.push(station);
    stations.push({ location: entry.location, owner: entry.role, panel });
  }

  // --- badges: shared per kind, so seven residents cost four markers, not twenty-eight ---------------
  const badgeGeometry: Record<BadgeKind, THREE.BufferGeometry> = {
    queued: geometry.cone(0.15, 0.28, 4),
    waiting: geometry.torus(0.18, 0.045),
    alert: geometry.sphere(0.15, 4, 2),
    unknown: geometry.sphere(0.14, 6, 5),
  };
  const badgeMaterial: Record<BadgeKind, THREE.MeshStandardMaterial> = {
    queued: track(new THREE.MeshStandardMaterial({ color: 0xe8c45c, emissive: 0xe8c45c, emissiveIntensity: 0.45, roughness: 0.4 })),
    waiting: track(new THREE.MeshStandardMaterial({ color: 0xf0a45c, emissive: 0xf0a45c, emissiveIntensity: 0.5, roughness: 0.4 })),
    alert: track(new THREE.MeshStandardMaterial({ color: 0xe86a6a, emissive: 0xe86a6a, emissiveIntensity: 0.95, roughness: 0.4 })),
    unknown: track(new THREE.MeshStandardMaterial({ color: 0x93a1ad, emissive: 0x93a1ad, emissiveIntensity: 0.15, roughness: 0.5 })),
  };

  // --- residents ------------------------------------------------------------------------------------
  const figures: Figure[] = plan.map((entry, index) => {
    const parts = buildResident(builders, entry.role);
    const home = spotFor(entry.role, entry.location);
    parts.group.position.set(home.x, home.y, home.z);
    parts.group.rotation.y = home.yaw;
    parts.group.userData.role = entry.role;

    const name = residentName(track, entry.role);
    // Raised above the head so the larger nameplate does not intersect hair or headwear.
    name.position.set(0, 2.22, 0);
    parts.group.add(name);
    // A soft contact shadow that walks with the figure: what stops a resident looking pasted onto the
    // floor (audit v3 §3). It is parented to the figure, so it never has to be updated separately.
    const grounding = contactPatch(builders, 0.42);
    grounding.position.y = 0.016;
    parts.group.add(grounding);

    const badges = {} as Record<BadgeKind, THREE.Object3D>;
    for (const kind of BADGE_KINDS) {
      const marker = new THREE.Mesh(badgeGeometry[kind], badgeMaterial[kind]);
      marker.position.set(0, 2.38, 0);
      if (kind === 'waiting') marker.rotation.x = Math.PI / 2;
      marker.visible = false;
      parts.group.add(marker);
      badges[kind] = marker;
    }

    const flashMaterial = track(new THREE.MeshStandardMaterial({
      color: new THREE.Color(ROSTER[entry.role].accent), emissive: new THREE.Color(ROSTER[entry.role].accent),
      emissiveIntensity: 1, transparent: true, opacity: 0, depthWrite: false,
    }));
    const flash = new THREE.Mesh(geometry.torus(0.34, 0.05), flashMaterial);
    flash.rotation.x = Math.PI / 2;
    flash.position.set(0, 2.18, 0);
    flash.visible = false;
    parts.group.add(flash);

    scene.add(parts.group);
    pickable.push(parts.group);
    detailedPickables.push(parts.group);
    return {
      role: entry.role, parts, visual: activityVisual('unknown'), phase: index * 0.9, seated: false,
      console: false, atDesk: false,
      from: { x: home.x, y: home.y, z: home.z, yaw: home.yaw },
      to: { x: home.x, y: home.y, z: home.z, yaw: home.yaw },
      t: 1, badges, flash, flashMaterial, flashUntil: 0,
    };
  });

  // --- framing --------------------------------------------------------------------------------------
  /**
   * Fit the facility to the canvas: all eight rooms, their walls, labels, and resident head height.
   * Target ~95% width utilization (2.5% margin each side) so the facility fills the box naturally.
   * The camera target is the actual facility center (computed from room geometry), so framing
   * centers on real content, not a fixed point.
   */
  // VIS-010: responsive fit using actual facility bounds and 95% width target
  const frameContent = (aspect: number) => {
    camera.updateMatrixWorld(true);
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    const world = new THREE.Vector3();

    for (const room of PHYSICAL_ROOMS) {
      const halfW = room.width / 2;
      const halfD = room.depth / 2;
      // Room floor corners (with small padding for wall thickness)
      const floorPadding = 0.2;
      // Heights to include: floor, wall tops (1.65), label height (0.045), resident head (4.6)
      const heights = [-0.2, 0.045, 1.65, 4.6];
      // Depth extension to include front label (at halfD - 0.68) and rear wall
      const labelOffset = 0.68;
      const depthExtents = [-halfD - floorPadding, halfD - labelOffset + 1.8]; // label width ~3.6, half ~1.8

      for (const du of [-halfW - floorPadding, halfW + floorPadding]) {
        for (const dv of depthExtents) {
          for (const h of heights) {
            const pos = roomToWorld(room.u + du, room.v + dv);
            world.set(pos.x, h, pos.z).sub(target);
            const x = world.dot(right), y = world.dot(up);
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          }
        }
      }
    }

    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const width = maxX - minX;
    const height = maxY - minY;

    // 95% utilization = 2.5% margin each side. Use the limiting dimension.
    const FIT = 0.95;
    const halfHeight = Math.max(height / (2 * FIT), width / (2 * aspect * FIT));

    camera.left = midX - halfHeight * aspect;
    camera.right = midX + halfHeight * aspect;
    camera.top = midY + halfHeight;
    camera.bottom = midY - halfHeight;
    camera.updateProjectionMatrix();
  };
  // The true aspect ratio is set by resize() when the host has layout.


  // --- lifecycle ------------------------------------------------------------------------------------
  let frames = 0;
  let state: TownState | null = null;
  let motion = opts.motion;
  let handle = 0;
  let clock = 0;
  let previousFrameTime: number | null = null;

  const projected = new THREE.Vector3();
  const headWorld = new THREE.Vector3();
  const activities = new Map<Role, { state: Activity; location: LocationId; label: string }>();

  const draw = () => { renderer.render(scene, camera); frames++; };

  /** Everyone exactly at home, still, unmarked. What is drawn before any snapshot has resolved. */
  const restAll = () => {
    for (const figure of figures) {
      const parts = figure.parts;
      parts.group.position.set(figure.to.x, figure.to.y, figure.to.z);
      parts.group.rotation.set(0, figure.to.yaw, 0);
      parts.upper.rotation.set(0, 0, 0);
      parts.head.rotation.set(0, 0, 0);
      for (const arm of [parts.armL, parts.armR]) arm.rotation.set(0, 0, 0);
      for (const elbow of [parts.elbowL, parts.elbowR]) elbow.rotation.set(0, 0, 0);
      for (const leg of [parts.legL, parts.legR]) leg.rotation.set(0, 0, 0);
      for (const knee of [parts.kneeL, parts.kneeR]) knee.rotation.set(0, 0, 0);
      figure.seated = false;
      parts.face.set('neutral');
      for (const kind of BADGE_KINDS) figure.badges[kind].visible = false;
      figure.flash.visible = false;
    }
  };

  /** Where a seated resident actually sits, and which way round (§10). */
  const chairFor = (target: { x: number; y: number; z: number }, yaw: number) => {
    const place = seatTurnFor(yaw);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    return {
      x: target.x + (place.x * cos + place.z * sin),
      y: target.y + CHAIR.pad,
      z: target.z + (-place.x * sin + place.z * cos),
      turn: place.turn,
    };
  };

  /**
   * Advance the walk, the poses and the markers. `dt` is seconds; the same function serves the still
   * frame, where every transition is applied at once instead of animated.
   */
  const advance = (dt: number) => {
    const animate = motion;
    const now = clock / 1000;
    for (const figure of figures) {
      if (figure.t < 1) figure.t = animate ? Math.min(1, figure.t + dt / WALK_SECONDS) : 1;
      const eased = walkEase(figure.t);
      const x = figure.from.x + (figure.to.x - figure.from.x) * eased;
      const z = figure.from.z + (figure.to.z - figure.from.z) * eased;
      let y = figure.from.y + (figure.to.y - figure.from.y) * eased;
      let yaw = figure.to.yaw;
      const walking = figure.t < 1;
      // Seated only when the model says this role is working at its own station — never while walking.
      const seated = figure.seated && !walking;
      let lean = 0;
      let arms = 0;
      let elbows = 0;
      let stride = 0;
      let headPitch = 0;
      let headYaw = 0;
      let shift = 0;

      if (figure.t < 1) {
        // Mid-walk: face the way the figure is going, with a light step and a swinging arm.
        yaw = Math.atan2(figure.to.x - figure.from.x, figure.to.z - figure.from.z);
        if (animate) {
          y += Math.abs(Math.sin(figure.t * Math.PI * 3)) * 0.06;
          stride = Math.sin(figure.t * Math.PI * 6) * 0.5;
        }
      } else if (seated) {
        // Working at its own desk: hips on the chair, knees under the desk, hands on the keyboard and
        // eyes on the screen. Only `working` ever reaches this, and only at the resident's own station.
        lean = POSE.sitLean;
        arms = POSE.sitShoulder;
        elbows = POSE.sitElbow;
        headPitch = 0.17;
        // The model reports only that the role is working; gestures are interpretation of that
        // same state, not additional activities. Avoid seven identical "typing" mannequins.
        if (figure.role === 'builder') {
          if (animate) elbows += Math.sin(now * 8 + figure.phase) * 0.075;
        } else if (figure.role === 'researcher' || figure.role === 'archivist') {
          arms = -0.82;
          elbows = -0.72;
          headPitch = 0.24;
          if (animate) headPitch += Math.sin(now * 1.3 + figure.phase) * 0.045;
        } else if (figure.role === 'planner' || figure.role === 'reviewer') {
          arms = -0.72;
          elbows = -0.64;
          headPitch = 0.13;
          if (animate) elbows += Math.sin(now * 2.1 + figure.phase) * 0.035;
        } else if (figure.role === 'tester') {
          arms = -0.81;
          elbows = -0.48;
          if (animate) headPitch += Math.sin(now * 1.7 + figure.phase) * 0.035;
        } else if (animate) {
          elbows += Math.sin(now * 3 + figure.phase) * 0.045;
        }
      } else if (figure.atDesk && !walking) {
        // Reaching onto the visited desk: he stands at its end, turned to face along it, close enough
        // that his forearms land on the surface instead of beside it.
        lean = 0.2;
        arms = -0.9;
        elbows = -0.62;
        headPitch = 0.12;
        if (animate) elbows += Math.sin(now * 6 + figure.phase) * 0.05;
      } else if (figure.console && !walking) {
        // Working the command console: upper arms hanging, forearms forward onto the keyboard, eyes on
        // the readout panel above — the posture of someone standing at a desk rather than reaching out.
        lean = 0.06;
        arms = -0.55;
        elbows = -0.75;
        headPitch = -0.06;
        if (animate) elbows += Math.sin(now * 7 + figure.phase) * 0.04;
      } else if (figure.visual.pose === 'working') {
        // A worker with no surface within reach gets a restrained gesture, never a typing motion.
        lean = 0.06;
        arms = -0.2;
        elbows = -0.2;
      } else if (figure.visual.pose === 'waiting') {
        // Waiting: arms folded, no equipment touched, and deliberately still (§9).
        arms = POSE.foldShoulder;
        elbows = POSE.foldElbow;
      } else if (figure.visual.pose === 'alert') {
        lean = POSE.alertLean;
        arms = 0.06;
      } else if (figure.visual.pose === 'idle' && animate) {
        // Idle has to be *visible*: a breath you can see, a slow weight shift, and a head that looks
        // around. The old amplitudes were under a pixel at panel size, so the residents read as statues.
        y += 0.03 + Math.sin(now * 1.4 + figure.phase) * 0.035;
        arms = Math.sin(now * 0.7 + figure.phase) * 0.1;
        elbows = -0.08 + Math.sin(now * 0.7 + figure.phase + 1) * 0.06;
        shift = Math.sin(now * 0.42 + figure.phase) * 0.022;
        headYaw = Math.sin(now * 0.33 + figure.phase) * 0.3;
        headPitch = Math.sin(now * 0.27 + figure.phase) * 0.06;
      }

      const parts = figure.parts;
      let seatTurn = 0;
      if (seated) {
        // On the chair, not standing beside it: hips at seat height, feet on the floor under the desk.
        const chair = chairFor(figure.to, figure.to.yaw);
        seatTurn = chair.turn;
        parts.group.position.set(chair.x, chair.y - parts.hipHeight + CHAIR.seat, chair.z);
      } else if (figure.atDesk && !walking) {
        // Visiting another department: stand at the end of *that* desk and face into it, so the hands
        // that are about to reach forward land on a work surface rather than in mid-air.
        const place = seatTurnFor(figure.to.yaw);
        const cos = Math.cos(figure.to.yaw);
        const sin = Math.sin(figure.to.yaw);
        parts.group.position.set(
          figure.to.x + (place.x * 0.92 * cos + place.z * sin),
          figure.to.y,
          figure.to.z + (-place.x * 0.92 * sin + place.z * cos));
        seatTurn = place.turn;
      } else if (figure.console && !walking) {
        // At the command dais: stand at his own console with his forearms on its keyboard, eyes on the
        // holographic readout above it.
        const cos = Math.cos(figure.to.yaw);
        const sin = Math.sin(figure.to.yaw);
        parts.group.position.set(figure.to.x + 0.3 * sin, figure.to.y, figure.to.z + 0.3 * cos);
      } else {
        parts.group.position.set(x + shift, y, z);
      }
      parts.upper.rotation.x = lean;
      parts.upper.rotation.z = shift * 1.6;
      parts.armL.rotation.set(arms - stride * 0.7, 0, 0.06);
      parts.armR.rotation.set(arms + stride * 0.7, 0, -0.06);
      parts.elbowL.rotation.x = elbows;
      parts.elbowR.rotation.x = elbows;
      parts.head.rotation.y = headYaw + (figure.visual.pose === 'working' || seated ? 0.12 : 0);
      parts.head.rotation.x = headPitch;
      parts.face.set(figure.visual.flash && figure.flashUntil <= clock ? 'neutral' : figure.visual.face);

      // Legs: a stride while walking, bent while seated, a relaxed asymmetric stance otherwise.
      if (walking) {
        parts.legL.rotation.x = stride;
        parts.legR.rotation.x = -stride;
        parts.kneeL.rotation.x = Math.max(0, stride) * 0.6;
        parts.kneeR.rotation.x = Math.max(0, -stride) * 0.6;
      } else if (seated) {
        for (const leg of [parts.legL, parts.legR]) leg.rotation.x = POSE.sitThigh;
        for (const knee of [parts.kneeL, parts.kneeR]) knee.rotation.x = POSE.sitKnee;
      } else {
        parts.legL.rotation.x = 0.07;
        parts.legR.rotation.x = -0.05;
        parts.kneeL.rotation.x = 0.03;
        parts.kneeR.rotation.x = 0;
      }
      if (animate) {
        const wanted = figure.to.yaw + seatTurn;
        const delta = Math.atan2(Math.sin(wanted - parts.group.rotation.y), Math.cos(wanted - parts.group.rotation.y));
        parts.group.rotation.y += delta * Math.min(1, dt * 9);
      } else {
        parts.group.rotation.y = figure.to.yaw + seatTurn;
      }

      // The readout belongs to the resident it describes, so it sits over their head — not over the
      // station they happen to be sitting at, which is where it was stranded before.
      const here = activities.get(figure.role);
      if (here && figure.visual.screen === 'task') {
        const owner = stations.find(candidate => candidate.location === here.location);
        if (owner) {
          owner.panel.sprite.position.set(
            parts.group.position.x,
            parts.group.position.y + 2.9,
            parts.group.position.z);
        }
      }

      for (const kind of BADGE_KINDS) {
        const marker = figure.badges[kind];
        const shown = figure.visual.badge === kind;
        marker.visible = shown;
        // A waiting badge breathes; a queued or alert badge is deliberately still.
        const pulse = shown && animate && kind === 'waiting' ? 1 + Math.sin(now * 2.6 + figure.phase) * 0.14 : 1;
        marker.scale.setScalar(pulse);
      }

      if (animate && figure.flashUntil > clock) {
        const progress = 1 - (figure.flashUntil - clock) / FLASH_MS;
        figure.flash.visible = true;
        figure.flash.scale.setScalar(0.7 + progress * 1.7);
        figure.flashMaterial.opacity = 0.8 * (1 - progress);
      } else {
        figure.flash.visible = false;
      }
    }
  };

  /**
   * Stations react through their owner's glow material and their readout.
   *
   * The readout follows the *location*: whoever the model says is standing there is the one whose words
   * appear, which is how the coordinator's own task shows up in the research laboratory when he is
   * working there rather than on his own platform.
   */
  const paintStations = () => {
    for (const station of stations) {
      const present = ROLES.find(role => activities.get(role)?.location === station.location);
      const info = present ? activities.get(present) : undefined;
      const visual = info ? activityVisual(info.state) : null;
      const showTask = !!visual && visual.screen === 'task' && !!info?.label;
      station.panel.paint(showTask ? info!.label : null, ROSTER[station.owner].accent);
    }
    for (const role of ROLES) {
      const visual = activityVisual(activities.get(role)?.state ?? 'unknown');
      materials.glow(role).emissiveIntensity = visual.pose === 'working'
        ? GLOW.working
        : visual.pose === 'waiting' || visual.pose === 'alert' ? GLOW.attention : GLOW.resting;
    }
  };

  const loop = (timestamp: number) => {
    handle = window.requestAnimationFrame(loop);
    if (document.hidden) { previousFrameTime = null; return; }
    // Real elapsed time makes walk duration independent of screen refresh rate. After a hidden tab
    // resumes we clamp a large gap rather than teleporting residents across the laboratory.
    const elapsed = previousFrameTime === null ? 0 : Math.max(0, (timestamp - previousFrameTime) / 1000);
    previousFrameTime = timestamp;
    const dt = Math.min(MAX_FRAME_SECONDS, elapsed);
    clock += dt * 1000;
    if (state) advance(dt); else restAll();
    draw();
  };

  const start = () => { if (!handle) { previousFrameTime = null; handle = window.requestAnimationFrame(loop); } };
  const stop = () => {
    if (handle) { window.cancelAnimationFrame(handle); handle = 0; }
    previousFrameTime = null;
  };

  const resize = () => {
    const rect = host.getBoundingClientRect();
    const width = Math.round(rect.width);
    if (width < 2) return;            // layout has not settled yet
    // VIS-008: CSS may limit the world to a shorter, wider rectangle. Use
    // actual visible container height, not the legacy 800:425 design ratio.
    const parent = host.parentElement;
    const visibleHeight = parent?.clientHeight || 0;
    const fallbackHeight = Math.round(width * DESIGN.height / DESIGN.width);
    const height = Math.max(1, Math.round(visibleHeight > 2 ? visibleHeight : (rect.height > 2 ? rect.height : fallbackHeight)));
    frameContent(width / height);
    renderer.setSize(width, height, true);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    if (!motion) draw();
  };

  // --- interaction: raycast picking, hover tooltip, keyboard access ----------------------------------
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-label', 'Hermes Life operations lab');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-describedby', 'town-tooltip');

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  /**
   * What is under the pointer. Resolves through `userData`, so a hit is always a model id.
   *
   * Picking is raycasting against the real geometry with the pointer mapped through the canvas box,
   * which is why it cannot drift the way an old screen-space transform did.
   */
  const hitAt = (clientX: number, clientY: number): { role?: Role; location?: LocationId; physicalRoom?: PhysicalRoomId } | null => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    let station: LocationId | null = null;
    // First pick actual residents/workstations, then the room floor. A large
    // transparent room hit area must never steal a resident's click.
    for (const hit of raycaster.intersectObjects(detailedPickables, true)) {
      let node: THREE.Object3D | null = hit.object;
      while (node) {
        // A resident always wins over the desk they are standing at.
        if (typeof node.userData?.role === 'string') return { role: node.userData.role as Role };
        if (!station && typeof node.userData?.location === 'string') station = node.userData.location as LocationId;
        node = node.parent;
      }
    }
    if (station) return { location: station };
    const roomHit = raycaster.intersectObjects(roomPickables, false)[0];
    if (roomHit) {
      const roomId = roomHit.object.userData.physicalRoom as PhysicalRoomId;
      const room = PHYSICAL_ROOMS.find(r => r.id === roomId);
      if (room?.owner) return { location: ROSTER[room.owner].location };
      if (roomId === 'break_room') return { physicalRoom: roomId };
    }
    return null;
  };

  /** The tooltip's one line: the model's own words, never an invented status. */
  const textFor = (hit: { role?: Role; location?: LocationId; physicalRoom?: PhysicalRoomId }): string => {
    if (hit.role) {
      const info = activities.get(hit.role);
      return `${ROSTER[hit.role].name} · ${ROSTER[hit.role].title} · ${stateWordFor(info?.state ?? 'unknown')}`
        + (info?.label ? ` — ${info.label}` : '');
    }
    if (hit.physicalRoom === 'break_room') return 'Break Room · Non-operational environment';
    const name = locationLabel(hit.location!);
    const present = ROLES.find(role => activities.get(role)?.location === hit.location);
    const info = present ? activities.get(present) : undefined;
    return info
      ? `${name} · ${ROSTER[present!].name} · ${stateWordFor(info.state)} — ${info.label}`
      : `${name} · ${stateWordFor('unknown')}`;
  };

  const tooltip = document.createElement('div');
  tooltip.id = 'town-tooltip';
  tooltip.className = 'town-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;

  const onPointerMove = (event: PointerEvent) => {
    const hit = hitAt(event.clientX, event.clientY);
    canvas.style.cursor = hit ? 'pointer' : 'default';
    if (!hit) { tooltip.hidden = true; return; }
    tooltip.textContent = textFor(hit);
    tooltip.hidden = false;
    const rect = host.getBoundingClientRect();
    tooltip.style.left = `${event.clientX - rect.left}px`;
    tooltip.style.top = `${event.clientY - rect.top}px`;
  };
  const onPointerLeave = () => { tooltip.hidden = true; canvas.style.cursor = 'default'; };
  const onCanvasClick = (event: MouseEvent) => {
    const hit = hitAt(event.clientX, event.clientY);
    if (!hit) return;
    // The events the app already listens for: the popovers, deep links and tabs are unchanged.
    if (hit.role) window.dispatchEvent(new CustomEvent('town:select', { detail: { role: hit.role } }));
    else if (hit.location) window.dispatchEvent(new CustomEvent('town:building', { detail: { location: hit.location } }));
    else if (hit.physicalRoom) window.dispatchEvent(new CustomEvent('hermesha:room:select', { detail: { room: hit.physicalRoom } }));
  };
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('click', onCanvasClick);

  /**
   * Keyboard access to the same two events. A canvas cannot be tabbed through, so the stations (and the
   * residents standing at them) are real buttons; the group is present for assistive tech at all times
   * and drawn only while it holds focus, so it never covers the art.
   */
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
  groupOf('Stations', plan.map(entry => ({
    text: locationLabel(entry.location),
    run: () => window.dispatchEvent(new CustomEvent('town:building', { detail: { location: entry.location } })),
  })));
  groupOf('Residents', ROLES.map(role => ({
    text: ROSTER[role].name,
    run: () => window.dispatchEvent(new CustomEvent('town:select', { detail: { role } })),
  })));

  mountInto(host, canvas, 'data-town-canvas');
  mountInto(host, tooltip, 'data-town-tooltip');
  mountInto(host, access, 'data-town-access');
  // One draw call per material instead of one per prop: measured, not assumed (§8).
  console.info(`town: ${builtMeshes} static meshes -> ${builtMeshes - mergedAway} after merging`);
  resize();
  restAll();
  if (motion) start(); else draw();

  return {
    kind: '3d',
    applyState(next: TownState) {
      const previous = new Map(activities);
      state = next;
      activities.clear();
      for (const role of ROLES) {
        const resident = next.residents[role];
        activities.set(role, { state: resident.state, location: resident.location, label: resident.label });
      }

      for (const figure of figures) {
        const info = activities.get(figure.role);
        if (!info) continue;
        const visual = activityVisual(info.state);
        figure.visual = visual;
        // Sitting is a privilege of working at your own desk: the six specialists have chairs, the
        // command dais has consoles and no chair, and a resident working in someone else's department
        // stands at that desk. Nothing here may put a resident's hands where no surface exists.
        const own = info.location === ROSTER[figure.role].location;
        const hasDesk = info.location !== ROSTER.coordinator.location;
        figure.seated = visual.seat && own && hasDesk;
        figure.console = visual.pose === 'working' && own && !hasDesk;
        figure.atDesk = visual.pose === 'working' && !own;

        // Where the model says this resident is now. A change starts a walk; the pose follows the
        // state. Positioning reads only `location`, so no rule here can invent a destination.
        const spot = spotFor(figure.role, info.location);
        if (Math.abs(spot.x - figure.to.x) > 1e-4 || Math.abs(spot.z - figure.to.z) > 1e-4) {
          figure.from = { x: figure.parts.group.position.x, y: figure.to.y, z: figure.parts.group.position.z, yaw: figure.to.yaw };
          figure.to = { x: spot.x, y: spot.y, z: spot.z, yaw: spot.yaw };
          figure.t = 0;
        }

        // Acknowledge a completion only on a real transition. A reload opening on a stale `completed`
        // record shows a still figure — history never re-animates (acceptance criterion 8).
        const was = previous.get(figure.role)?.state;
        if (visual.flash && was && was !== 'completed') figure.flashUntil = clock + FLASH_MS;
        if (was && was !== 'completed' && info.state !== 'completed') figure.flashUntil = 0;
      }

      paintStations();
      if (motion) advance(0); else { restAll(); advance(0); }
      draw();
    },
    setMotion(on: boolean) {
      motion = on;
      if (on) start(); else { stop(); advance(0); draw(); }
    },
    resize,
    /** World position projected into design space, per resident. */
    positions(): RendererPoint[] {
      return figures.map(figure => {
        projected.copy(figure.parts.group.position).project(camera);
        const footX = Math.round((projected.x + 1) / 2 * DESIGN.width);
        const footY = Math.round((1 - projected.y) / 2 * DESIGN.height);
        // The animated head is the true anchor, including seat/walk offsets;
        // fixed screen-pixel lifts were incorrect after the Phase 2 camera fit.
        figure.parts.head.getWorldPosition(headWorld);
        projected.copy(headWorld).project(camera);
        return {
          role: figure.role,
          x: footX,
          y: footY,
          headX: Math.round((projected.x + 1) / 2 * DESIGN.width),
          headY: Math.round((1 - projected.y) / 2 * DESIGN.height),
          state: activities.get(figure.role)?.state ?? 'unknown',
          location: activities.get(figure.role)?.location ?? ROSTER[figure.role].location,
        };
      });
    },
    frames() { return frames; },
    destroy() {
      stop();
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('click', onCanvasClick);
      tooltip.remove();
      access.remove();
      for (const resource of disposables) resource.dispose();
      geometry.dispose();
      backdrop.dispose();
      scene.clear();
      pickable.length = 0;
      detailedPickables.length = 0;
      roomPickables.length = 0;
      stations.length = 0;
      figures.length = 0;
      activities.clear();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      state = null;
    },
  };
}

export { CONTENT, ROOM, DAIS_HEIGHT, facilityPlan, spotFor, walkEase };
