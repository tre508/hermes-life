/**
 * Faces and expressions.
 *
 * Audit §4: the residents' faces were "extremely simplified", so it was "difficult to interpret what
 * each character is looking at or how they are reacting". They need eyebrows, eyes and a mouth that
 * change with state — but §4 also says not to introduce an expensive facial rig, and the hard rule from
 * the whole redesign stands: **an expression may never imply work that is not happening**. A resident
 * who is waiting must look patient, not busy; one that failed must look concerned, and then stay still.
 *
 * So this is six poses of a handful of small meshes, driven by the same activity table as the body.
 * Everything is built once per resident and reused; switching expression only writes rotations.
 */
import * as THREE from 'three';

import type { Track } from './palette';

export type Expression = 'neutral' | 'focused' | 'patient' | 'pleased' | 'concerned' | 'confused';

export interface Face {
  /** Apply an expression immediately. Cheap: it writes rotations on existing meshes. */
  set(expression: Expression): void;
  /** The expression currently shown, so a caller can skip redundant work. */
  readonly current: Expression;
}

/** How one expression poses the features. */
interface Pose {
  /** Brow rotation in radians; positive lifts the inner end (concern), negative lowers it (focus). */
  brow: number;
  /** Brow height offset, in head radii. */
  browY: number;
  /** `confused` lifts one brow on its own — the cheapest universally readable "huh?". */
  browAsymmetry: number;
  /** Mouth width multiplier: narrow for concentration, wide for a smile. */
  mouth: number;
  /** Mouth curvature: positive turns the ends up, negative down. */
  curve: number;
  /** Pupil scale: a focused resident's pupils sit slightly smaller and steadier. */
  pupil: number;
  /** Head pitch in radians: positive tips the face down towards a desk. */
  pitch: number;
}

const POSES: Readonly<Record<Expression, Pose>> = Object.freeze({
  neutral: { brow: 0, browY: 0, browAsymmetry: 0, mouth: 1, curve: 0, pupil: 1, pitch: 0 },
  focused: { brow: -0.22, browY: -0.02, browAsymmetry: 0, mouth: 0.78, curve: -0.08, pupil: 0.9, pitch: 0.16 },
  patient: { brow: 0.08, browY: 0.015, browAsymmetry: 0, mouth: 0.9, curve: 0.06, pupil: 1, pitch: 0 },
  pleased: { brow: 0.16, browY: 0.02, browAsymmetry: 0, mouth: 1.16, curve: 0.5, pupil: 1.05, pitch: 0 },
  concerned: { brow: 0.34, browY: 0.01, browAsymmetry: 0, mouth: 0.86, curve: -0.42, pupil: 0.85, pitch: 0.04 },
  confused: { brow: 0.1, browY: 0, browAsymmetry: 0.34, mouth: 0.92, curve: -0.16, pupil: 1, pitch: 0.02 },
});

/**
 * Build a face onto a head group.
 *
 * `radius` is the head's radius, so the features scale with whatever head the resident has — a big
 * square head and a narrow one both get a correctly proportioned face.
 */
export function createFace(
  track: Track,
  geometry: {
    sphere: (r: number, w?: number, h?: number) => THREE.BufferGeometry;
    box: (w: number, h: number, d: number) => THREE.BufferGeometry;
  },
  head: THREE.Group,
  radius: number,
  skinTone = 0xe0c3a0,
): Face {
  // Every feature is a fraction of the head's own radius. Getting this wrong once made the eyes larger
  // than the skull, which read on screen as giant spheres floating beside the residents' heads.
  const unit = radius;

  const eyeWhiteMaterial = track(new THREE.MeshStandardMaterial({ color: 0xf3efe6, roughness: 0.35, metalness: 0 }));
  const pupilMaterial = track(new THREE.MeshStandardMaterial({ color: 0x1d2329, roughness: 0.28, metalness: 0.05 }));
  const browMaterial = track(new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 0.72, metalness: 0 }));
  const lipMaterial = track(new THREE.MeshStandardMaterial({ color: 0x9b5f57, roughness: 0.6, metalness: 0 }));

  const face = new THREE.Group();
  head.add(face);

  const eyes: THREE.Object3D[] = [];
  const pupils: THREE.Object3D[] = [];
  // Whites proud of the skull, with a dark pupil just in front: two spheres read as an eye at any size.
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(geometry.sphere(0.21 * unit, 12, 10), eyeWhiteMaterial);
    eye.position.set(side * 0.38 * unit, 0.06 * unit, 0.94 * unit);
    eye.scale.set(1, 0.84, 0.62);
    face.add(eye);
    eyes.push(eye);
    const pupil = new THREE.Mesh(geometry.sphere(0.1 * unit, 10, 8), pupilMaterial);
    pupil.position.set(side * 0.38 * unit, 0.06 * unit, 1.055 * unit);
    face.add(pupil);
    pupils.push(pupil);
  }

  const brows: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const brow = new THREE.Mesh(geometry.box(0.44 * unit, 0.075 * unit, 0.07 * unit), browMaterial);
    brow.position.set(side * 0.38 * unit, 0.34 * unit, 0.98 * unit);
    face.add(brow);
    brows.push(brow);
  }

  // The mouth is two halves so a smile is a rotation rather than a second mesh.
  const lips: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const lip = new THREE.Mesh(geometry.box(0.3 * unit, 0.09 * unit, 0.07 * unit), lipMaterial);
    lip.position.set(side * 0.15 * unit, -0.38 * unit, 0.97 * unit);
    face.add(lip);
    lips.push(lip);
  }

  // Small nose and ear landmarks make a head read as a face even in three-quarter isometric view.
  // These are static geometry: expressions still update the existing brow/mouth meshes only.
  const skinDetail = track(new THREE.MeshStandardMaterial({ color: skinTone, roughness: 0.77 }));
  const nose = new THREE.Mesh(geometry.sphere(0.12 * unit, 10, 8), skinDetail);
  nose.scale.set(0.85, 1.15, 1.1);
  nose.position.set(0, -0.17 * unit, 1.04 * unit);
  face.add(nose);
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(geometry.sphere(0.2 * unit, 10, 8), skinDetail);
    ear.scale.set(0.4, 0.9, 0.52);
    ear.position.set(side * 1.02 * unit, -0.08 * unit, 0);
    head.add(ear);
  }

  let current: Expression | null = null;

  /** Write one expression onto the features. Cheap: rotations and scales on existing meshes. */
  const apply = (expression: Expression) => {
    const pose = POSES[expression] ?? POSES.neutral;
    face.rotation.x = -pose.pitch;
    brows.forEach((brow, index) => {
      const side = index === 0 ? -1 : 1;
      const extra = side === 1 ? pose.browAsymmetry : 0;
      brow.rotation.z = side * (pose.brow + extra);
      brow.position.y = (0.34 + pose.browY + (side === 1 ? pose.browAsymmetry * 0.5 : 0)) * unit;
    });
    lips.forEach((lip, index) => {
      const side = index === 0 ? -1 : 1;
      lip.rotation.z = side * pose.curve;
      lip.position.x = side * 0.14 * pose.mouth * unit;
      lip.scale.x = pose.mouth;
      lip.position.y = (-0.38 + Math.abs(pose.curve) * 0.1) * unit;
    });
    pupils.forEach(pupil => pupil.scale.setScalar(pose.pupil));
    current = expression;
  };

  const api: Face = {
    get current() { return current ?? 'neutral'; },
    set(expression: Expression) {
      if (expression === current) return;
      apply(expression);
    },
  };
  apply('neutral');
  return api;
}
