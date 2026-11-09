/**
 * Static-geometry merging.
 *
 * The detailed facility is built from roughly a thousand small meshes. Drawing them separately costs a
 * draw call each, which is what pushed the frame rate below the documented floor on this host — and §8
 * asks for merged or instanced repeated geometry rather than one draw per brick.
 *
 * This collapses a group's static meshes into one mesh per material: hundreds of draws become a dozen,
 * the triangle count is unchanged, and — because the materials are the shared instances from
 * `palette.ts` — a per-role emissive material still lights a whole station when its state changes.
 *
 * Deliberately conservative:
 *  - sprites are billboards and are never merged;
 *  - meshes with material arrays or mismatched attribute layouts are left exactly where they are;
 *  - a material used only once is left alone, because merging one mesh is a copy with no saving.
 */
import * as THREE from 'three';

import type { Track } from './palette';

/** Attribute sets must match exactly for geometries to be mergeable. */
function signature(geometry: THREE.BufferGeometry): string {
  const names = Object.keys(geometry.attributes).sort();
  const shape = names.map(name => `${name}:${geometry.attributes[name].itemSize}`).join(',');
  return `${shape}|${geometry.index ? 'indexed' : 'plain'}`;
}

interface Entry { mesh: THREE.Mesh; geometry: THREE.BufferGeometry }
interface Bucket { material: THREE.Material; entries: Entry[] }

/**
 * Merge every static mesh under `root` into one mesh per material, in place.
 *
 * Transforms are baked relative to `root`, so the merged output can live at the same place in the graph
 * as the meshes it replaces without applying the root's own transform twice.
 *
 * Returns what it built and what it removed, so the caller can report the real cost rather than a claim.
 */
export function mergeStaticGeometry(root: THREE.Object3D, track: Track): { built: number; removed: number } {
  root.updateMatrixWorld(true);
  const toLocal = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const offset = new THREE.Matrix4();
  const buckets = new Map<string, Bucket>();

  root.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || (mesh as unknown as THREE.Sprite).isSprite) return;
    if (Array.isArray(mesh.material)) return;
    const material = mesh.material as THREE.Material;
    const key = `${material.uuid}|${signature(mesh.geometry)}`;
    let bucket = buckets.get(key);
    if (!bucket) { bucket = { material, entries: [] }; buckets.set(key, bucket); }
    const geometry = mesh.geometry.clone();
    offset.multiplyMatrices(toLocal, mesh.matrixWorld);
    geometry.applyMatrix4(offset);
    bucket.entries.push({ mesh, geometry });
  });

  const merged = new THREE.Group();
  merged.name = 'merged-static';
  let removed = 0;
  let built = 0;

  for (const bucket of buckets.values()) {
    built += bucket.entries.length;
    if (bucket.entries.length < 2) {
      for (const entry of bucket.entries) entry.geometry.dispose();
      continue;
    }
    const geometry = mergeGeometries(bucket.entries.map(entry => entry.geometry));
    for (const entry of bucket.entries) entry.geometry.dispose();
    if (!geometry) continue;
    const mesh = new THREE.Mesh(track(geometry), bucket.material);
    mesh.userData.merged = bucket.entries.length;
    merged.add(mesh);
    for (const entry of bucket.entries) {
      entry.mesh.removeFromParent();
      removed += 1;
    }
  }

  if (removed === 0) return { built, removed: 0 };
  root.add(merged);
  root.updateMatrixWorld(true);
  return { built, removed };
}

/**
 * Concatenate geometries that share an attribute layout into one.
 *
 * A local implementation rather than the `examples/jsm` helper: the layouts here are all indexed
 * position/normal/uv primitives, and owning it keeps the import surface to `three` itself.
 */
function mergeGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (parts.length < 2) return null;
  const layout = signature(parts[0]);
  for (const part of parts) if (signature(part) !== layout) return null;

  const names = Object.keys(parts[0].attributes);
  if (!names.length) return null;
  const out = new THREE.BufferGeometry();

  for (const name of names) {
    const first = parts[0].attributes[name];
    const total = parts.reduce((sum, part) => sum + part.attributes[name].count, 0);
    const Source = first.array.constructor as new (length: number) => Float32Array;
    const array = new Source(total * first.itemSize);
    let cursor = 0;
    for (const part of parts) {
      const source = part.attributes[name].array as Float32Array;
      array.set(source, cursor);
      cursor += source.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(array, first.itemSize, first.normalized));
  }

  const totalIndices = parts.reduce((sum, part) => sum + (part.index ? part.index.count : 0), 0);
  if (totalIndices > 0) {
    const index = new Uint32Array(totalIndices);
    let cursor = 0;
    let vertex = 0;
    for (const part of parts) {
      if (part.index) {
        for (let i = 0; i < part.index.count; i += 1) index[cursor + i] = part.index.getX(i) + vertex;
        cursor += part.index.count;
      }
      vertex += part.attributes.position.count;
    }
    out.setIndex(new THREE.BufferAttribute(index, 1));
  }
  out.computeBoundingSphere();
  return out;
}
