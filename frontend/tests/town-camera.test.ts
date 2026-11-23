/**
 * HERMESHA §2/§11 — perspective "operations-centre" camera framing.
 *
 * The framing math is pure (town-camera.ts) so it is unit-tested here; the
 * renderer/world wiring is asserted structurally.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

import {
    boundsCenter, boundsRadius, cameraDirection, frameBounds, roomBounds,
    ease, lerpPose, DEFAULT_FOV, OVERVIEW_ELEVATION,
} from '../src/town-camera.ts';

const here = dirname(fileURLToPath(import.meta.url));
const frontend = join(here, '..');
const v2 = readFileSync(join(frontend, 'src', 'town-renderer-v2.ts'), 'utf8');
const view = readFileSync(join(frontend, 'src', 'town-view.ts'), 'utf8');

const box = { minX: -20, maxX: 20, minY: 0, maxY: 2.4, minZ: -13, maxZ: 13 };

test('boundsCenter is the box midpoint', () => {
    assert.deepEqual(boundsCenter(box), { x: 0, y: 1.2, z: 0 });
});

test('boundsRadius is half the diagonal', () => {
    const r = boundsRadius({ minX: 0, maxX: 2, minY: 0, maxY: 0, minZ: 0, maxZ: 0 });
    assert.equal(r, 1);
});

test('cameraDirection is a unit vector', () => {
    const d = cameraDirection(38, -22);
    assert.ok(Math.abs(Math.hypot(d.x, d.y, d.z) - 1) < 1e-9);
});

test('frameBounds places the camera above the target along the eye direction', () => {
    const pose = frameBounds(box, { aspect: 16 / 9 });
    const c = boundsCenter(box);
    assert.ok(pose.position.y > c.y, 'camera is above the facility');
    assert.equal(pose.fov, DEFAULT_FOV);
    // position = target + unitDir * distance
    const d = cameraDirection(OVERVIEW_ELEVATION, -22);
    const dist = Math.hypot(pose.position.x - c.x, pose.position.y - c.y, pose.position.z - c.z);
    assert.ok(dist > 0);
    for (const axis of ['x', 'y', 'z'] as const) {
        assert.ok(Math.abs((pose.position[axis] - c[axis]) - d[axis] * dist) < 1e-6);
    }
});

test('every corner of the bounds projects inside the frustum', () => {
    const aspect = 16 / 9;
    const pose = frameBounds(box, { aspect });
    const fovY = pose.fov * Math.PI / 180;
    const tanY = Math.tan(fovY / 2);
    const tanX = tanY * aspect;

    const dot = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
        a.x * b.x + a.y * b.y + a.z * b.z;
    const cross = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
        ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
    const norm = (v: { x: number; y: number; z: number }) => {
        const l = Math.hypot(v.x, v.y, v.z) || 1;
        return { x: v.x / l, y: v.y / l, z: v.z / l };
    };

    const toCam = { x: pose.position.x - pose.target.x, y: pose.position.y - pose.target.y, z: pose.position.z - pose.target.z };
    const dist = Math.hypot(toCam.x, toCam.y, toCam.z);
    const dir = norm(toCam);
    const fwd = { x: -dir.x, y: -dir.y, z: -dir.z };
    const right = norm(cross(fwd, { x: 0, y: 1, z: 0 }));
    const up = norm(cross(right, fwd));

    const corners: Array<[number, number, number]> = [
        [box.minX, box.minY, box.minZ], [box.maxX, box.minY, box.minZ],
        [box.minX, box.maxY, box.minZ], [box.maxX, box.maxY, box.minZ],
        [box.minX, box.minY, box.maxZ], [box.maxX, box.minY, box.maxZ],
        [box.minX, box.maxY, box.maxZ], [box.maxX, box.maxY, box.maxZ],
    ];
    for (const [x, y, z] of corners) {
        const r = { x: x - pose.target.x, y: y - pose.target.y, z: z - pose.target.z };
        const depth = dist - dot(r, dir);
        assert.ok(depth > 0, 'corner is in front of the camera');
        assert.ok(Math.abs(dot(r, right)) <= depth * tanX + 1e-6, 'corner within the horizontal fov');
        assert.ok(Math.abs(dot(r, up)) <= depth * tanY + 1e-6, 'corner within the vertical fov');
    }
});

test('the fit is tight — well under the loose bounding-sphere fit (no tiny facility in a void)', () => {
    const aspect = 1.86;
    const pose = frameBounds(box, { aspect });
    const dist = Math.hypot(pose.position.x, pose.position.y - 1.2, pose.position.z);
    const radius = boundsRadius(box);
    const fovY = pose.fov * Math.PI / 180;
    const fovX = 2 * Math.atan(Math.tan(fovY / 2) * aspect);
    const sphereFit = radius / Math.sin(Math.min(fovY, fovX) / 2);
    assert.ok(dist < sphereFit * 0.8, `tight fit ${dist.toFixed(1)} should be well under the sphere fit ${sphereFit.toFixed(1)}`);
});

test('a larger margin pushes the camera further back', () => {
    const near = frameBounds(box, { aspect: 1.6, margin: 1.0 });
    const far = frameBounds(box, { aspect: 1.6, margin: 1.4 });
    const dist = (p: typeof near) => Math.hypot(p.position.x, p.position.y, p.position.z);
    assert.ok(dist(far) > dist(near));
});

test('a narrow aspect backs the camera off further than a wide one', () => {
    const wide = frameBounds(box, { aspect: 2.0 });
    const narrow = frameBounds(box, { aspect: 0.6 });
    const dist = (p: typeof wide) => Math.hypot(p.position.x, p.position.y, p.position.z);
    assert.ok(dist(narrow) > dist(wide));
});

test('roomBounds wraps a single room', () => {
    const b = roomBounds({ x: 5, z: -3, w: 10, d: 6 });
    assert.deepEqual(b, { minX: 0, maxX: 10, minY: 0, maxY: 2.2, minZ: -6, maxZ: 0 });
});

test('ease and lerpPose are well-behaved', () => {
    assert.equal(ease(0), 0);
    assert.equal(ease(1), 1);
    assert.equal(ease(0.5), 0.5);
    const a = frameBounds(box, { aspect: 1.6 });
    const b = frameBounds(roomBounds({ x: 5, z: -3, w: 10, d: 6 }), { aspect: 1.6 });
    const close = (p: number, q: number) => Math.abs(p - q) < 1e-9;
    const at0 = lerpPose(a, b, 0);
    const at1 = lerpPose(a, b, 1);
    for (const axis of ['x', 'y', 'z'] as const) {
        assert.ok(close(at0.position[axis], a.position[axis]), `t=0 position.${axis}`);
        assert.ok(close(at0.target[axis], a.target[axis]), `t=0 target.${axis}`);
        assert.ok(close(at1.position[axis], b.position[axis]), `t=1 position.${axis}`);
        assert.ok(close(at1.target[axis], b.target[axis]), `t=1 target.${axis}`);
    }
});

// --------------------------------------------------------------------------- wiring

test('the renderer uses a perspective camera and exposes focus/overview', () => {
    assert.match(v2, /new THREE\.PerspectiveCamera\(/);
    assert.ok(!/OrthographicCamera/.test(v2), 'the top-down ortho camera is gone');
    assert.match(v2, /focusRoom/);
    assert.match(v2, /overview/);
});

test('the world view drives focus on room select and overview on close', () => {
    assert.match(view, /renderer\?\.focusRoom\?\.\(location\)/);
    assert.match(view, /renderer\?\.overview\?\.\(\)/);
});
