/**
 * World camera framing (HERMESHA spec §2/§11) — pure math, no Three.js.
 *
 * The World uses a PERSPECTIVE "operations-centre" eye (decided 2026-11-23),
 * not the old top-down orthographic floor plan. Framing fits the bounds'
 * corners so nothing is ever cropped: the camera sits on a fixed
 * elevation/azimuth and backs off just far enough that every corner fits both
 * the vertical and the horizontal field of view.
 *
 * Kept dependency-free so the framing can be unit-tested headlessly.
 */

export interface Vec3 { x: number; y: number; z: number }
export interface Bounds {
    minX: number; maxX: number;
    minY: number; maxY: number;
    minZ: number; maxZ: number;
}
export interface CameraPose { position: Vec3; target: Vec3; fov: number }

/**
 * The stock frameBounds eye: raised, three-quarter. `frameBounds` falls back to
 * this pair when a caller passes no angles, and `OVERVIEW_ELEVATION` is the
 * shared elevation (the world box HERMESHA-WORLD-ASPECT-001 was measured at —
 * "the 30 degree camera"). The default azimuth stays -22 on purpose.
 */
export const OVERVIEW_ELEVATION = 30;
export const OVERVIEW_AZIMUTH = -22;
/**
 * HA-017: the facility overview looks SQUARE TO THE ROOM GRID. The old -22°
 * overview azimuth projected the ~45x29-unit grid as a diagonal band whose
 * silhouette filled only ~47% of the 2.85:1 world canvas; grid-aligned, the
 * silhouette runs with the rooms and the facility fills the canvas width.
 */
export const GRID_AZIMUTH = 0;
/** Focus eye: a little lower and head-on for a single room, on the same grid. */
export const FOCUS_ELEVATION = 30;
export const FOCUS_AZIMUTH = GRID_AZIMUTH;

export const DEFAULT_FOV = 45;

/**
 * Facility overview margin. Tight — the fit is exact, so 1.02 keeps every
 * corner inside the frustum while the facility fills the drawing area.
 */
export const OVERVIEW_MARGIN = 1.02;

export function boundsCenter(b: Bounds): Vec3 {
    return {
        x: (b.minX + b.maxX) / 2,
        y: (b.minY + b.maxY) / 2,
        z: (b.minZ + b.maxZ) / 2,
    };
}

/** Radius of the sphere enclosing the box (half its diagonal). */
export function boundsRadius(b: Bounds): number {
    return 0.5 * Math.hypot(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ);
}

/** Unit direction from the target toward the camera. */
export function cameraDirection(elevationDeg: number, azimuthDeg: number): Vec3 {
    const rad = Math.PI / 180;
    const e = elevationDeg * rad;
    const a = azimuthDeg * rad;
    return { x: Math.cos(e) * Math.sin(a), y: Math.sin(e), z: Math.cos(e) * Math.cos(a) };
}

/**
 * A camera pose that frames `bounds` with a margin. `aspect` = width / height.
 *
 * The distance is computed from the bounds' 8 CORNERS projected into the camera
 * basis, so the box is fitted tightly — a bounding-SPHERE fit is far too loose
 * for a flat, wide facility (it backs off by the half-diagonal and leaves the
 * scene small in a void). Each corner constrains the distance by
 *   d >= (P-T)·dir + |offset| / tan(halfFov)
 * on both the horizontal and vertical axis; the maximum wins.
 */
export function frameBounds(
    b: Bounds,
    opts: { fov?: number; aspect: number; margin?: number; elevationDeg?: number; azimuthDeg?: number },
): CameraPose {
    const fov = opts.fov ?? DEFAULT_FOV;
    const margin = opts.margin ?? 1.04;
    const aspect = Math.max(0.1, opts.aspect || 1);
    const center = boundsCenter(b);

    const fovY = fov * Math.PI / 180;
    const tanY = Math.tan(fovY / 2);
    const tanX = tanY * aspect;

    const dir = cameraDirection(opts.elevationDeg ?? OVERVIEW_ELEVATION, opts.azimuthDeg ?? OVERVIEW_AZIMUTH);
    const fwd = { x: -dir.x, y: -dir.y, z: -dir.z };
    let right = cross(fwd, { x: 0, y: 1, z: 0 });
    if (Math.hypot(right.x, right.y, right.z) < 1e-6) right = { x: 1, y: 0, z: 0 };
    right = normalize(right);
    const up = normalize(cross(right, fwd));

    const corners: Vec3[] = [
        { x: b.minX, y: b.minY, z: b.minZ }, { x: b.maxX, y: b.minY, z: b.minZ },
        { x: b.minX, y: b.maxY, z: b.minZ }, { x: b.maxX, y: b.maxY, z: b.minZ },
        { x: b.minX, y: b.minY, z: b.maxZ }, { x: b.maxX, y: b.minY, z: b.maxZ },
        { x: b.minX, y: b.maxY, z: b.maxZ }, { x: b.maxX, y: b.maxY, z: b.maxZ },
    ];

    let distance = 0;
    for (const p of corners) {
        const r = { x: p.x - center.x, y: p.y - center.y, z: p.z - center.z };
        const along = dot(r, dir);          // component toward the camera
        const h = Math.abs(dot(r, right));
        const v = Math.abs(dot(r, up));
        // depth at this corner is (d - along); require |h| <= depth*tanX, |v| <= depth*tanY.
        distance = Math.max(distance, along + h / tanX, along + v / tanY);
    }
    distance = Math.max(0.001, distance) * margin;

    return {
        position: {
            x: center.x + dir.x * distance,
            y: center.y + dir.y * distance,
            z: center.z + dir.z * distance,
        },
        target: center,
        fov,
    };
}

function dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function cross(a: Vec3, b: Vec3): Vec3 {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function normalize(v: Vec3): Vec3 {
    const len = Math.hypot(v.x, v.y, v.z) || 1;
    return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/** The box a single room occupies, for zoom-to-room focus. */
export function roomBounds(room: { x: number; z: number; w: number; d: number }, height = 2.2): Bounds {
    return {
        minX: room.x - room.w / 2, maxX: room.x + room.w / 2,
        minY: 0, maxY: height,
        minZ: room.z - room.d / 2, maxZ: room.z + room.d / 2,
    };
}

/** Smooth-step easing for camera transitions (0 → 1). */
export function ease(t: number): number {
    const c = Math.max(0, Math.min(1, t));
    return c * c * (3 - 2 * c);
}

/** Linear blend between two poses. */
export function lerpPose(a: CameraPose, b: CameraPose, t: number): CameraPose {
    const k = ease(t);
    const mix = (p: number, q: number) => p + (q - p) * k;
    return {
        position: { x: mix(a.position.x, b.position.x), y: mix(a.position.y, b.position.y), z: mix(a.position.z, b.position.z) },
        target: { x: mix(a.target.x, b.target.x), y: mix(a.target.y, b.target.y), z: mix(a.target.z, b.target.z) },
        fov: mix(a.fov, b.fov),
    };
}
