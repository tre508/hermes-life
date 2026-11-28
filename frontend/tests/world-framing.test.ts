/**
 * World framing (HA-017) and resident name plates (HA-035).
 *
 * The HA-017 audit measured the 3D facility filling only ~47% of the world
 * viewport width — small in a large dark void. Two causes: the renderer capped
 * the drawing width at MAX_ASPECT=2.6 (letterboxing wide viewports), and the
 * -22° overview azimuth projected the ~45x29-unit room grid as a diagonal band
 * whose silhouette ran well under the canvas width.
 *
 * The fill PROBE below projects the facility bounds' 8 corners with the same
 * dir/right/up math frameBounds uses. max |ndc_h| and |ndc_v| at the fitted pose
 * are the fill fraction of the drawing area: values ≤ 1 mean nothing is cropped
 * (fill above 1.0 IS cropping — forbidden), and the closer to 1 the fuller the
 * facility fills the canvas.
 *
 * HA-035: resident name plates must be screen-space constant size (legible at
 * the overview zoom) and toggleable from the existing HUD.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

import {
    frameBounds, GRID_AZIMUTH, FOCUS_AZIMUTH, OVERVIEW_AZIMUTH,
    OVERVIEW_ELEVATION, OVERVIEW_MARGIN,
    type Bounds, type CameraPose, type Vec3,
} from '../src/town-camera.ts';
import { ROOMS, facilityBounds } from '../src/town-renderer-v2.ts';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src');
const v2 = readFileSync(join(src, 'town-renderer-v2.ts'), 'utf8');
const residents = readFileSync(join(src, 'town-world', 'residents.ts'), 'utf8');

// --------------------------------------------------------------------------- probe

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 =>
    ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (v: Vec3): Vec3 => {
    const l = Math.hypot(v.x, v.y, v.z) || 1;
    return { x: v.x / l, y: v.y / l, z: v.z / l };
};

/**
 * Fill fraction of the drawing area at `pose`: project the 8 bounds corners
 * through frameBounds' own camera basis and take the worst |ndc_h| and |ndc_v|.
 * `h`/`v` ≤ 1 means no corner leaves the frustum — no crop.
 */
function projectFill(bounds: Bounds, pose: CameraPose, aspect: number): { h: number; v: number } {
    const tanY = Math.tan(pose.fov * Math.PI / 180 / 2);
    const tanX = tanY * aspect;
    const toCam = { x: pose.position.x - pose.target.x, y: pose.position.y - pose.target.y, z: pose.position.z - pose.target.z };
    const dist = Math.hypot(toCam.x, toCam.y, toCam.z);
    const dir = norm(toCam);
    const fwd = { x: -dir.x, y: -dir.y, z: -dir.z };
    let right = cross(fwd, { x: 0, y: 1, z: 0 });
    if (Math.hypot(right.x, right.y, right.z) < 1e-6) right = { x: 1, y: 0, z: 0 };
    right = norm(right);
    const up = norm(cross(right, fwd));

    let h = 0;
    let v = 0;
    for (const x of [bounds.minX, bounds.maxX]) {
        for (const y of [bounds.minY, bounds.maxY]) {
            for (const z of [bounds.minZ, bounds.maxZ]) {
                const r = { x: x - pose.target.x, y: y - pose.target.y, z: z - pose.target.z };
                const depth = dist - dot(r, dir);
                assert.ok(depth > 0, 'corner is in front of the camera');
                h = Math.max(h, Math.abs(dot(r, right)) / (depth * tanX));
                v = Math.max(v, Math.abs(dot(r, up)) / (depth * tanY));
            }
        }
    }
    return { h, v };
}

const FACILITY = facilityBounds(ROOMS);

/**
 * The aspects the audit cares about: 16/9 and 21/9 viewports, the old 2.6
 * MAX_ASPECT drawing area, and the world box itself — HERMESHA-WORLD-ASPECT-001
 * pins #game to 2.85:1, where the ~47% was measured.
 */
const ASPECTS: Array<[string, number]> = [
    ['16:9', 16 / 9], ['21:9', 21 / 9], ['2.6', 2.6], ['2.85', 2.85],
];

const overviewFill = (aspect: number): { h: number; v: number } =>
    projectFill(FACILITY, frameBounds(FACILITY, {
        aspect, margin: OVERVIEW_MARGIN, elevationDeg: OVERVIEW_ELEVATION, azimuthDeg: GRID_AZIMUTH,
    }), aspect);

// ---------------------------------------------------------------------------- HA-017

test('HA-017 the facility fills the drawing area at every measured aspect — and never crops', () => {
    const measured: string[] = [];
    for (const [label, aspect] of ASPECTS) {
        const { h, v } = overviewFill(aspect);
        measured.push(`${label} width=${h.toFixed(3)} height=${v.toFixed(3)}`);
        // The hard rule: fill > 1.0 is cropping. The fit keeps a corner inside
        // at margin distance, so this must hold by construction and stay true.
        assert.ok(h <= 1 && v <= 1, `${label} fill ${h.toFixed(3)}/${v.toFixed(3)} exceeds 1.0 — cropping`);
        // The audit measured WIDTH fill (~47% on the 2.85:1 box): the facility
        // must now run nearly edge to edge across the canvas.
        assert.ok(h >= 0.9, `${label} width fill ${h.toFixed(3)} must reach the canvas edges`);
        // The other axis follows the aspect: tall viewports letterbox a wide
        // facility by necessity, but must stay near full.
        assert.ok(v >= 0.6, `${label} height fill ${v.toFixed(3)} must stay near full`);
    }
    console.log('HA-017 fill fractions (≤ 1.0, closer to 1 is fuller):', measured.join(' | '));
});

test('HA-017 the pre-fix framing measured — the audited baseline this replaces', () => {
    // The old eye: 38° elevation, -22° azimuth, margin 1.03. On the 2.85:1 box
    // the probe reproduces the audit's "~47% of the world viewport width".
    const old = projectFill(FACILITY, frameBounds(FACILITY, {
        aspect: 2.85, margin: 1.03, elevationDeg: 38, azimuthDeg: -22,
    }), 2.85);
    console.log(`HA-017 baseline 2.85: width=${old.h.toFixed(3)} height=${old.v.toFixed(3)}`);
    assert.ok(old.h <= 0.5, `baseline width fill ${old.h.toFixed(3)} documents the audited ~47%`);
    assert.ok(overviewFill(2.85).h >= 1.8 * old.h, 'the new framing must far exceed the audited baseline');
});

test('HA-017 the overview eye is square to the room grid (the diagonal band stays gone)', () => {
    // The -22° azimuth projected the 45x29 grid as a diagonal band whose
    // silhouette filled only part of the frame; grid-aligned, it fills.
    assert.ok(Math.abs(GRID_AZIMUTH) <= 8, `GRID_AZIMUTH ${GRID_AZIMUTH} must stay on the room grid`);
    assert.ok(Math.abs(FOCUS_AZIMUTH) <= 8, `FOCUS_AZIMUTH ${FOCUS_AZIMUTH} must stay on the room grid`);
    assert.match(v2, /azimuthDeg:\s*GRID_AZIMUTH/);
    // frameBounds' stock default eye stays at the classic -22° (tests/town-camera.test.ts pins it).
    assert.equal(OVERVIEW_AZIMUTH, -22);
});

test('HA-017 the canvas takes the full host box — the MAX_ASPECT letterbox is gone', () => {
    // drawW was the capped drawing width; without it (and without any cap
    // constant) the canvas takes every pixel of the host box.
    assert.ok(!/const MAX_ASPECT|drawW/.test(v2), 'the draw-width cap must be gone: it letterboxed wide viewports');
    assert.match(v2, /canvas\.style\.width = `\$\{width\}px`/, 'the canvas gets the full host width');
    assert.match(v2, /renderer\.setSize\(width, height, true\)/);
});

// ---------------------------------------------------------------------------- HA-035

test('HA-035 name plates are screen-space constant size above the residents', () => {
    // sizeAttenuation: false is the whole trick: the sprite shader scales the
    // quad by the view distance, so the plate keeps one size at every zoom and
    // resident identity stays legible at the overview framing.
    assert.match(residents, /export function namePlate\(/);
    assert.match(residents, /sizeAttenuation:\s*false/, 'the plate must be screen-space constant size');
    assert.match(residents, /sprite\.renderOrder = 3/);
    // Wired above each figure in the world renderer, under the figure group.
    assert.match(v2, /namePlate\(track, ROSTER\[role\]\.name, FIGURE_SCALE\)/);
    assert.match(v2, /plate\.position\.set\(0, 2\.35, 0\)/, 'the plate floats above the head and badge');
});

test('HA-035 name plates toggle from the existing HUD', () => {
    // The toggle rides in the HUD the town view already owns — a Labels button
    // next to Motion — and the choice persists like the motion preference.
    assert.match(v2, /document\.querySelector<HTMLElement>\('\.town-hud'\)/);
    assert.match(v2, /labelsButton\.id = 'town-labels'/);
    assert.match(v2, /'hermes-life-town-labels'/);
    assert.match(v2, /figure\.plate\.visible = platesVisible/);
});
