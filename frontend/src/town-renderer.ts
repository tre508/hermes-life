/**
 * UI-VIS-003 §4: the renderer seam.
 *
 * `town-view.ts` talks to this module and nothing else — it never imports Three.js or the DOM list.
 * Two implementations satisfy the interface and are fed the same `TownState`:
 *
 *   - `town-renderer-3d.ts`     the 3D facility (the world the operator sees)
 *   - `town-renderer-static.ts` a static label view, used when the client cannot run WebGL (D4)
 *
 * Both emit the same `town:select` / `town:building` events, so the popovers, the deep links and the
 * rest of the dashboard are unaffected by which renderer is active.
 *
 * The seam is a module boundary, not a swap mechanism: D1 retired the pixel-art renderer, so there is
 * only ever one 3D implementation. It exists so the view and the tests never depend on renderer
 * internals, and so the fallback shares the same input.
 */
import type { Activity, LocationId, Role, TownState } from './town-model';
import { ACTIVITY_WORDS } from './town-model';
import { create3DRenderer } from './town-renderer-3d';
import { createStaticRenderer } from './town-renderer-static';

export type RendererKind = '3d' | 'static';

/** One row per resident: what a test (and an acceptance run) asserts the world is showing. */
export interface RendererPoint {
  role: Role;
  x: number;
  y: number;
  state: string;
  location: LocationId;
}

export interface TownRenderer {
  readonly kind: RendererKind;
  /** The only way the world changes: authoritative state in, drawing out. Idempotent. */
  applyState(state: TownState): void;
  /** Reduced motion: freeze movement, keep every state label. */
  setMotion(on: boolean): void;
  /** Re-measure the host box. The container resizes without a window resize event. */
  resize(): void;
  /** Introspection for tests and acceptance runs — never read by the UI. */
  positions(): RendererPoint[];
  /** Renders drawn so far; 0 for the static renderer, which has no clock. */
  frames(): number;
  /** Release geometries, materials, textures, listeners, RAF handles and any WebGL context. */
  destroy(): void;
}

/** The design space. Every renderer frames this box; CSS keeps the host at the same ratio. */
export const DESIGN = { width: 800, height: 425 } as const;

/**
 * The semantic word for a state, shared by every view so they cannot disagree.
 *
 * `unknown` reads as "Status unknown" rather than a word that implies an action the model did not
 * report (acceptance criterion 19).
 */
export function stateWordFor(activity: Activity): string {
  return activity === 'unknown' ? 'Status unknown' : ACTIVITY_WORDS[activity];
}

/**
 * Mount a renderer's own element without touching its siblings.
 *
 * `#game` also holds the resident popover, and the host's other children belong to someone else; a
 * renderer that emptied the host would silently take the popover with it.
 */
export function mountInto(host: HTMLElement, element: Element, marker: string): void {
  host.querySelectorAll(`:scope > [${marker}]`).forEach(stale => {
    if (stale !== element) stale.remove();
  });
  element.setAttribute(marker, '');
  host.append(element);
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Can this client run the 3D renderer? A failed probe is not an error — it picks the fallback. */
export function supportsWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2');
    // A context that was handed out here should not be left alive.
    if (context && typeof (context as WebGL2RenderingContext).getExtension === 'function') {
      (context as WebGL2RenderingContext).getExtension('WEBGL_lose_context')?.loseContext();
    }
    return !!context;
  } catch {
    return false;
  }
}

/** Picks the 3D renderer when the client can run it, otherwise the static fallback. A failed WebGL
 *  probe is not an error — it is what selects the fallback (D4). */
export function createTownRenderer(host: HTMLElement, opts: { motion: boolean }): TownRenderer {
  if (supportsWebGL2()) {
    try {
      return create3DRenderer(host, opts);
    } catch (error) {
      console.warn('town: 3D renderer unavailable, using the static view', error);
    }
  }
  return createStaticRenderer(host, opts);
}
