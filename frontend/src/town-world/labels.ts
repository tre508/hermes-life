/**
 * Presentation vocabulary and text rendering.
 *
 * The redesign changes the metaphor from a pixel-art town to an AI operations facility, so the words
 * the operator reads have to change with it (discrepancy report §10). The persisted model identifiers
 * do **not** change — `town_square`, `library` and the rest remain the contract — only what is shown.
 * Every visible surface reads its wording from here, so the 3D signage, the no-WebGL list, the HUD and
 * the room panel can never disagree.
 *
 * Labels are sprites over a 2D canvas: a handful of tiny textures, no font files, no atlas. Each one is
 * drawn on a dark plate inside the texture, which is what keeps it legible over the floor, over a wall
 * and over a workstation without competing with the geometry behind it (report §9).
 */
import * as THREE from 'three';

import { ROSTER, type LocationId, type Role } from '../town-model';
import { PALETTE, type Track } from './palette';
import { locationLabel } from '../town-vocabulary';

/**
 * Break a label into at most `maxLines` lines of `perLine`, with an ellipsis when it must cut.
 */
export function wrapText(text: string, perLine: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? line + ' ' + word : word;
    if (candidate.length <= perLine) line = candidate;
    else { if (line) lines.push(line); line = word; }
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (!lines.length) return [];
  if (lines.join(' ').length < text.trim().length) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = last.length > perLine - 1 ? last.slice(0, perLine - 1) + '…' : last + '…';
  }
  return lines;
}

export interface LabelStyle {
  /** Rendered width in world units. The texture is 4x wider than tall, so height follows. */
  width: number;
  colour: string;
  /** A bordered, brighter plate for permanent environment signage. */
  signage?: boolean;
  /** Larger type for signage read at panel size. */
  large?: boolean;
}

/** A shared font stack, so every label in the facility is set in the same type. */
const FONT = 'system-ui, "Segoe UI", Inter, sans-serif';

/**
 * A label that always faces the camera, drawn on a dark plate so it stays readable over anything.
 *
 * Billboarded on purpose: with one fixed camera, half of any ring of stations would show the blank
 * back of a flat sign (discovery: milestone 3).
 */
export function textSprite(track: Track, text: string, style: LabelStyle): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    const { width: w, height: h } = canvas;
    context.clearRect(0, 0, w, h);
    // The plate: what keeps a label readable anywhere in the scene.
    const radius = style.signage ? 20 : 24;
    const inset = style.signage ? 5 : 12;
    context.beginPath();
    context.roundRect(inset, inset, w - inset * 2, h - inset * 2, radius);
    context.fillStyle = style.signage ? 'rgba(9,15,20,0.88)' : 'rgba(9,15,20,0.66)';
    context.fill();
    if (style.signage) {
      context.lineWidth = 4;
      context.strokeStyle = style.colour;
      context.globalAlpha = 0.75;
      context.stroke();
      context.globalAlpha = 1;
    }
    // Fit the type to the plate: a long name ("Verification Laboratory") must shrink rather than run
    // off the canvas, which is what used to clip the end of the label.
    const weight = style.large ? 700 : 600;
    const available = w - inset * 2 - 26;
    let size = style.large ? 54 : 48;
    context.font = `${weight} ${size}px ${FONT}`;
    const measured = context.measureText(text).width;
    if (measured > available) {
      size = Math.max(17, Math.floor(size * (available / measured)));
      context.font = `${weight} ${size}px ${FONT}`;
    }
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineWidth = 7;
    context.strokeStyle = 'rgba(6,10,14,0.9)';
    context.strokeText(text, w / 2, h / 2 + 2);
    context.fillStyle = style.colour;
    context.fillText(text, w / 2, h / 2 + 2);
  }
  const texture = track(new THREE.CanvasTexture(canvas));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = track(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(style.width, style.width * (canvas.height / canvas.width), 1);
  return sprite;
}

/**
 * Permanent department signage, painted into the floor at the front edge of the department's plate.
 *
 * Audit v2 §9: the old labels were plates floating above each work area, competing with the monitors,
 * covering equipment and reading as interface pasted onto a scene. A decal is architectural — it lies
 * in the surface, can never cover a figure or a screen, and reads cleanly from an isometric eye.
 */
export function floorDecal(track: Track, text: string, accent: string, width = 2.3): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    const weight = 700;
    const available = canvas.width - 36;
    let size = 60;
    context.font = `${weight} ${size}px ${FONT}`;
    const measured = context.measureText(text).width;
    if (measured > available) {
      size = Math.max(24, Math.floor(size * (available / measured)));
      context.font = `${weight} ${size}px ${FONT}`;
    }
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    context.lineWidth = 9;
    context.strokeStyle = 'rgba(6,11,15,0.92)';
    context.strokeText(text, canvas.width / 2, canvas.height / 2);
    context.fillStyle = accent;
    context.fillText(text, canvas.width / 2, canvas.height / 2);
  }
  const texture = track(new THREE.CanvasTexture(canvas));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const material = track(new THREE.MeshBasicMaterial({
    map: texture, transparent: true, depthWrite: false, toneMapped: false,
  }));
  const plane = new THREE.Mesh(track(new THREE.PlaneGeometry(width, width * (canvas.height / canvas.width))), material);
  plane.rotation.x = -Math.PI / 2;
  plane.renderOrder = 1;
  return plane;
}

/** The resident's name, kept small and close to the figure so it reads as a nametag, not a sign. */
export function residentName(track: Track, role: Role): THREE.Sprite {
  return textSprite(track, ROSTER[role].name.toUpperCase(), {
    width: 1.78, colour: ROSTER[role].accent, signage: true, large: true,
  });
}

/** A one-line environmental caption (equipment, wall panels). */
export function equipmentSign(track: Track, text: string, accent: string): THREE.Sprite {
  return textSprite(track, text, { width: 1.7, colour: accent });
}

/** A station's activity readout: the resident's real label, and nothing when there is no label. */
export interface TaskPanel {
  sprite: THREE.Sprite;
  texture: THREE.CanvasTexture;
  /** What is currently painted, so a poll that changes nothing costs nothing. */
  painted: string;
  paint(text: string | null, accent: string): void;
}

/**
 * The contextual readout over a workstation.
 *
 * Separate from the station's permanent signage on purpose (§9): the sign says where you are, this says
 * what is happening, and it only exists when the model has something true to put on it.
 */
export function taskPanel(track: Track, width = 2.0): TaskPanel {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  const texture = track(new THREE.CanvasTexture(canvas));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = track(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(width, width * (canvas.height / canvas.width), 1);
  sprite.visible = false;

  const panel: TaskPanel = {
    sprite, texture, painted: '',
    paint(text, accent) {
      const signature = (text || '') + '|' + accent;
      if (panel.painted === signature) return;
      panel.painted = signature;
      sprite.visible = !!text;
      if (!text || !context) return;
      const { width: w, height: h } = canvas;
      context.clearRect(0, 0, w, h);
      context.beginPath();
      context.roundRect(10, 34, w - 20, h - 68, 22);
      context.fillStyle = 'rgba(8,14,19,0.86)';
      context.fill();
      context.lineWidth = 4;
      context.strokeStyle = accent;
      context.globalAlpha = 0.7;
      context.stroke();
      context.globalAlpha = 1;
      context.fillStyle = accent;
      context.fillRect(w * 0.3, 46, w * 0.4, 7);
      context.font = `600 46px ${FONT}`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.lineWidth = 8;
      context.strokeStyle = 'rgba(6,10,14,0.85)';
      const lines = wrapText(text, 22, 2);
      lines.forEach((line, index) => {
        const y = h / 2 + 12 + (index - (lines.length - 1) / 2) * 50;
        context.strokeText(line, w / 2, y);
        context.fillStyle = accent;
        context.fillText(line, w / 2, y);
      });
      texture.needsUpdate = true;
    },
  };
  return panel;
}

export const INK = { plate: 'rgba(9,15,20,0.88)', line: PALETTE.wallTrim } as const;
