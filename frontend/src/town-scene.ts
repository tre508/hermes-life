/**
 * UI-VIS-002: the town. One top-down pixel-art place, seven workflow residents, one system.
 *
 * The scene draws only what the model says. Every animation is a *state transition*: a resident
 * walks to their building when their backend state becomes working, walks home when it ends, and
 * stands with a badge while waiting or blocked. Nothing here invents work — an idle resident only
 * breathes, and the decorative villagers carry no name and no badge.
 */
import Phaser from 'phaser';

import {
  type Activity, type LocationId, type Role, type TownState, ROLES, ROSTER,
} from './town-model';

const WIDTH = 800;
const HEIGHT = 425;
const PULSE_MS = 150;
const ROAD_Y = 212;
const STEP_MS_PER_PX = 7;

const PALETTE = {
  grass: 0x3d6b47, grassDark: 0x33603e, grassLight: 0x4a7d52, grassDry: 0x5d7f4a,
  road: 0x8a7550, roadDark: 0x776141, roadEdge: 0x5c4c33, gravel: 0x9c8a6a,
  stone: 0x9c9c8f, stoneDark: 0x7e7e72, stoneLight: 0xb2b2a4,
  wall: 0xd8c6a0, wallDark: 0xb4a07a, wallShade: 0x9c8965,
  roofSlate: 0x4c6080, roofSlateDark: 0x39496b, roofSlateLight: 0x5f769b,
  roofClay: 0x9a4f42, roofClayDark: 0x76382f, roofClayLight: 0xb5624f,
  wood: 0x7c5633, woodDark: 0x5a3c22, woodLight: 0x9b7147,
  window: 0x22323f, windowLit: 0xf0d68a, windowFrame: 0xe8dcc0,
  water: 0x4d84a6, waterLight: 0x79aec9,
  ink: 0x141d1b, outline: 0x141d1b,
  leaf: 0x2f6b3c, leafLight: 0x418a4d, leafDark: 0x24522f, trunk: 0x5a3f22,
  flower: 0xd8737f, flowerAlt: 0xe4c86a,
};

interface Building {
  id: LocationId;
  label: string;
  sign: 'BOOK' | 'JAR' | 'MAP' | 'GEAR' | 'SEAL' | 'FLASK';
  x: number; y: number; w: number; h: number;
  doorX: number;
  /** 'down' faces the lane from the north row; 'up' faces it from the south row. */
  faces: 'down' | 'up';
  roof: number; roofDark: number; roofLight: number;
}

const BUILDINGS: readonly Building[] = Object.freeze([
  { id: 'library', label: 'LIBRARY', sign: 'BOOK', x: 30, y: 58, w: 150, h: 100, doorX: 105, faces: 'down', roof: PALETTE.roofSlate, roofDark: PALETTE.roofSlateDark, roofLight: PALETTE.roofSlateLight },
  { id: 'archive', label: 'ARCHIVE', sign: 'JAR', x: 325, y: 30, w: 150, h: 96, doorX: 400, faces: 'down', roof: PALETTE.roofClay, roofDark: PALETTE.roofClayDark, roofLight: PALETTE.roofClayLight },
  { id: 'planning_house', label: 'PLANNING', sign: 'MAP', x: 620, y: 58, w: 150, h: 100, doorX: 695, faces: 'down', roof: PALETTE.roofClay, roofDark: PALETTE.roofClayDark, roofLight: PALETTE.roofClayLight },
  { id: 'workshop', label: 'WORKSHOP', sign: 'GEAR', x: 30, y: 266, w: 150, h: 100, doorX: 105, faces: 'up', roof: PALETTE.roofSlate, roofDark: PALETTE.roofSlateDark, roofLight: PALETTE.roofSlateLight },
  { id: 'review_office', label: 'REVIEW', sign: 'SEAL', x: 325, y: 300, w: 150, h: 96, doorX: 400, faces: 'up', roof: PALETTE.roofClay, roofDark: PALETTE.roofClayDark, roofLight: PALETTE.roofClayLight },
  { id: 'testing_lab', label: 'TEST LAB', sign: 'FLASK', x: 620, y: 266, w: 150, h: 100, doorX: 695, faces: 'up', roof: PALETTE.roofSlate, roofDark: PALETTE.roofSlateDark, roofLight: PALETTE.roofSlateLight },
]);

/** The square is the lane crossing: paved, with a well and a notice board. Not a seventh building. */
const SQUARE = { x: 300, y: 168, w: 200, h: 96 };

const ACCENT: Readonly<Record<Role, number>> = Object.freeze(
  Object.fromEntries(ROLES.map(role => [role, Number.parseInt(ROSTER[role].accent.slice(1), 16)])) as Record<Role, number>);

interface Pose { x: number; y: number; facing: 1 | -1; walking: boolean; frame: number }

interface Sprite {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Graphics;
  name: Phaser.GameObjects.Text;
  badge: Phaser.GameObjects.Text;
}

interface Villager {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Graphics;
  pose: Pose;
  path: Phaser.Math.Vector2[];
  seat: number;
}

export class TownScene extends Phaser.Scene {
  private motion: boolean;
  private state: TownState | null = null;
  private pulse = 0;
  private sprites = new Map<Role, Sprite>();
  private pose = new Map<Role, Pose>();
  private paths = new Map<Role, Phaser.Math.Vector2[]>();
  /** Where each resident is currently heading, so events cannot restart an in-flight walk. */
  private targets = new Map<Role, { x: number; y: number }>();
  private villagers: Villager[] = [];
  private ambient: Phaser.GameObjects.Graphics | null = null;
  private glow: Phaser.GameObjects.Graphics | null = null;
  private smoke: Phaser.GameObjects.Graphics | null = null;
  private hover: Phaser.GameObjects.Graphics | null = null;
  private hoverRole: Role | null = null;

  constructor(motion = true) {
    super('TownScene');
    this.motion = motion && !prefersReducedMotion();
  }

  create(): void {
    this.drawTerrain();
    this.drawSquare();
    this.drawBuildings();
    this.glow = this.add.graphics().setDepth(4);
    this.ambient = this.add.graphics().setDepth(5);
    this.smoke = this.add.graphics().setDepth(6);
    this.hover = this.add.graphics().setDepth(9);

    // The square zone goes in first: with input.topOnly the topmost interactive object wins, and
    // the coordinator stands inside the square.
    const squareZone = this.add.zone(SQUARE.x + SQUARE.w / 2, SQUARE.y + SQUARE.h / 2 + 24, SQUARE.w, SQUARE.h + 44)
      .setInteractive({ useHandCursor: true });
    squareZone.on('pointerdown', () => window.dispatchEvent(new CustomEvent('town:building', { detail: { location: 'town_square' } })));
    squareZone.on('pointerover', () => this.hover?.clear().lineStyle(2, 0xf2e6b8, 0.9)
      .strokeRoundedRect(SQUARE.x, SQUARE.y, SQUARE.w, SQUARE.h + 44, 6));
    squareZone.on('pointerout', () => this.hover?.clear());

    for (const building of BUILDINGS) {
      const zone = this.add.zone(building.x + building.w / 2, building.y + building.h / 2 - 10, building.w, building.h + 40)
        .setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => this.hover?.clear().lineStyle(2, 0xf2e6b8, 0.95)
        .strokeRoundedRect(building.x - 6, building.y - 42, building.w + 12, building.h + 48, 6));
      zone.on('pointerout', () => this.hover?.clear());
      zone.on('pointerdown', () => window.dispatchEvent(new CustomEvent('town:building', { detail: { location: building.id } })));
    }

    for (const role of ROLES) this.createResident(role);
    this.createVillagers();

    this.add.text(10, HEIGHT - 16, 'HERMES LIFE  ·  ONE SYSTEM, SEVEN ROLES', {
      fontFamily: 'monospace', fontSize: '10px', color: '#dcecd8',
      stroke: '#1d2b26', strokeThickness: 3,
    }).setDepth(12);

    this.time.addEvent({ delay: PULSE_MS, loop: true, callback: () => this.animate() });
    if (this.state) this.applyState(this.state);
  }

  // ------------------------------------------------------------------ residents

  private createResident(role: Role): void {
    const blueprint = ROSTER[role];
    const container = this.add.container(0, 0).setDepth(8);
    const body = this.add.graphics();
    // Two short lines instead of one long plaque: a 30-character badge painted a dark bar across
    // neighbouring buildings and the lane, which is what made the town look blocked off.
    const badge = this.add.text(0, -52, '', {
      fontFamily: 'monospace', fontSize: '10px', fontStyle: 'bold', color: '#f4fbf7',
      backgroundColor: '#16211fe0', padding: { x: 4, y: 2 }, align: 'center',
    }).setOrigin(0.5);
    const name = this.add.text(0, -36, blueprint.name, {
      fontFamily: 'monospace', fontSize: '11px', fontStyle: 'bold', color: '#0e1c1a',
      stroke: '#eef6e8', strokeThickness: 4,
    }).setOrigin(0.5);
    container.add([body, badge, name]);
    const point = yardPoint(blueprint.location);
    container.setPosition(point.x, point.y);
    this.sprites.set(role, { container, body, name, badge });
    this.pose.set(role, { x: point.x, y: point.y, facing: 1, walking: false, frame: 0 });

    const zone = this.add.zone(point.x, point.y - 14, 46, 60).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => { this.hoverRole = role; });
    zone.on('pointerout', () => { if (this.hoverRole === role) this.hoverRole = null; });
    zone.on('pointerdown', () => window.dispatchEvent(new CustomEvent('town:select', { detail: { role } })));
  }

  /** Decorative townspeople: grey kit, no name, no badge, and never a work animation. */
  private createVillagers(): void {
    for (const [index, [x, y]] of [[240, 212], [560, 232], [420, 150]].entries()) {
      const container = this.add.container(x, y).setDepth(7);
      const body = this.add.graphics();
      container.add(body);
      this.villagers.push({ container, body, pose: { x, y, facing: index % 2 ? -1 : 1, walking: false, frame: index }, path: [], seat: index });
    }
  }

  // ------------------------------------------------------------------ terrain

  private drawTerrain(): void {
    const g = this.add.graphics().setDepth(0);
    g.fillStyle(PALETTE.grass); g.fillRect(0, 0, WIDTH, HEIGHT);
    for (let i = 0; i < 340; i++) {
      const x = (i * 137 + 29) % WIDTH;
      const y = (i * 89 + 13) % HEIGHT;
      g.fillStyle(i % 3 ? PALETTE.grassDark : PALETTE.grassLight, 0.5);
      g.fillRect(x, y, 2, i % 2 ? 2 : 4);
      if (i % 11 === 0) { g.fillStyle(PALETTE.grassDry, 0.45); g.fillRect(x + 3, y + 5, 3, 2); }
    }
    // Lane: packed earth with stony edges, drawn behind everything else.
    g.fillStyle(PALETTE.roadEdge); g.fillRect(0, ROAD_Y - 17, WIDTH, 34);
    g.fillStyle(PALETTE.road); g.fillRect(0, ROAD_Y - 14, WIDTH, 28);
    for (let x = 6; x < WIDTH; x += 21) {
      g.fillStyle(PALETTE.roadDark, 0.45); g.fillRect(x, ROAD_Y + 4, 11, 4);
      g.fillStyle(PALETTE.gravel, 0.5); g.fillRect(x + 9, ROAD_Y - 9, 5, 3);
    }
    // A path from every door to the lane.
    for (const building of BUILDINGS) {
      const from = building.faces === 'down' ? building.y + building.h : building.y;
      const to = building.faces === 'down' ? ROAD_Y - 17 : ROAD_Y + 17;
      const top = Math.min(from, to);
      const height = Math.abs(to - from);
      g.fillStyle(PALETTE.gravel); g.fillRect(building.doorX - 9, top, 18, height);
      g.fillStyle(PALETTE.roadDark, 0.35);
      for (let y = top + 5; y < top + height - 2; y += 9) g.fillRect(building.doorX - 6, y, 12, 2);
      const lampX = building.faces === 'down' ? building.doorX + 24 : building.doorX - 24;
      const lampY = building.faces === 'down' ? building.y + building.h + 14 : building.y - 14;
      g.fillStyle(0x3a3a44); g.fillRect(lampX - 1, lampY - 16, 3, 18);
      g.fillStyle(0xf0e0a8, 0.85); g.fillRect(lampX - 4, lampY - 22, 9, 7);
      g.fillStyle(0x3a3a44); g.fillRect(lampX - 5, lampY - 24, 11, 3);
    }
    // Trees and hedges along the town edge, deterministic so the town looks the same every load.
    const trees: Array<[number, number]> = [[14, 206], [786, 206], [214, 20], [586, 20], [14, 392], [786, 392], [214, 404], [586, 404], [196, 214], [604, 208]];
    for (const [x, y] of trees) {
      g.fillStyle(0x1f3326, 0.3); g.fillEllipse(x, y + 17, 30, 9);
      g.fillStyle(PALETTE.trunk); g.fillRect(x - 3, y + 3, 6, 16);
      g.fillStyle(PALETTE.leafDark); g.fillRect(x - 13, y - 13, 26, 20);
      g.fillStyle(PALETTE.leaf); g.fillRect(x - 11, y - 17, 22, 20);
      g.fillStyle(PALETTE.leafLight); g.fillRect(x - 7, y - 20, 14, 8);
      g.fillStyle(PALETTE.leafDark, 0.5); g.fillRect(x - 11, y + 1, 22, 4);
    }
    for (const [x, y, w] of [[236, 172, 48], [516, 172, 48], [236, 252, 48], [516, 252, 48]] as Array<[number, number, number]>) {
      g.fillStyle(PALETTE.leafDark); g.fillRect(x, y, w, 15);
      g.fillStyle(PALETTE.leaf); g.fillRect(x + 2, y + 2, w - 4, 11);
      g.fillStyle(PALETTE.flower, 0.85); g.fillRect(x + 7, y + 4, 3, 3); g.fillRect(x + 27, y + 7, 3, 3);
      g.fillStyle(PALETTE.flowerAlt, 0.85); g.fillRect(x + 17, y + 3, 3, 3);
    }
  }

  private drawSquare(): void {
    const g = this.add.graphics().setDepth(1);
    g.fillStyle(PALETTE.stoneDark); g.fillRect(SQUARE.x, SQUARE.y, SQUARE.w, SQUARE.h);
    g.fillStyle(PALETTE.stone); g.fillRect(SQUARE.x + 3, SQUARE.y + 3, SQUARE.w - 6, SQUARE.h - 6);
    for (let x = SQUARE.x + 6; x < SQUARE.x + SQUARE.w - 6; x += 16) {
      for (let y = SQUARE.y + 6; y < SQUARE.y + SQUARE.h - 6; y += 16) {
        g.fillStyle((x + y) % 32 === 0 ? PALETTE.stoneLight : PALETTE.stoneDark, 0.4);
        g.fillRect(x, y, 13, 13);
      }
    }
    const wellX = SQUARE.x + 14; const wellY = SQUARE.y + 54;
    g.fillStyle(PALETTE.stoneDark); g.fillRect(wellX - 3, wellY - 3, 32, 26);
    g.fillStyle(PALETTE.stoneLight); g.fillRect(wellX, wellY, 26, 20);
    g.fillStyle(PALETTE.water); g.fillRect(wellX + 4, wellY + 5, 18, 10);
    g.fillStyle(PALETTE.waterLight, 0.7); g.fillRect(wellX + 6, wellY + 7, 8, 3);
    g.fillStyle(PALETTE.wood); g.fillRect(wellX + 10, wellY - 16, 4, 14); g.fillRect(wellX - 2, wellY - 20, 30, 4);
    const boardX = SQUARE.x + SQUARE.w - 56; const boardY = SQUARE.y + 44;
    g.fillStyle(PALETTE.woodDark); g.fillRect(boardX, boardY + 14, 6, 30); g.fillRect(boardX + 36, boardY + 14, 6, 30);
    g.fillStyle(PALETTE.wood); g.fillRect(boardX - 6, boardY - 2, 54, 20);
    g.fillStyle(0xf2e6c2); g.fillRect(boardX - 4, boardY, 50, 16);
    g.fillStyle(PALETTE.ink, 0.65);
    g.fillRect(boardX, boardY + 3, 26, 2); g.fillRect(boardX, boardY + 7, 40, 2); g.fillRect(boardX, boardY + 11, 20, 2);
    this.add.text(SQUARE.x + SQUARE.w / 2, SQUARE.y + SQUARE.h + 14, 'TOWN SQUARE', {
      fontFamily: 'monospace', fontSize: '10px', fontStyle: 'bold', color: '#0f1c17',
      stroke: '#eaf3e4', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(3);
  }

  /** Facades: shingled roof with eaves, planked walls, framed windows, a real door and a sign. */
  private drawBuildings(): void {
    for (const building of BUILDINGS) {
      const g = this.add.graphics().setDepth(2);
      const { x, y, w, h } = building;
      const roofAbove = building.faces === 'down';
      const roofY = roofAbove ? y - 30 : y;
      const wallY = roofAbove ? y : y + 30;
      const wallH = roofAbove ? h : h - 30;

      g.fillStyle(0x1b2a22, 0.34); g.fillRect(x + 8, wallY + 12, w, wallH + 4);
      // Wall: planks, corner posts, skirting board.
      g.fillStyle(PALETTE.wall); g.fillRect(x, wallY, w, wallH);
      for (let py = wallY + 9; py < wallY + wallH - 4; py += 9) {
        g.fillStyle(PALETTE.wallShade, 0.3); g.fillRect(x + 2, py, w - 4, 1);
      }
      g.fillStyle(PALETTE.wallDark); g.fillRect(x, wallY, 7, wallH); g.fillRect(x + w - 7, wallY, 7, wallH);
      g.fillStyle(PALETTE.woodDark); g.fillRect(x, wallY + wallH - 7, w, 7);
      g.fillStyle(PALETTE.wood); g.fillRect(x + 2, wallY + wallH - 6, w - 4, 3);

      // Roof: shingle rows, ridge light, deep eaves with shadow.
      g.fillStyle(building.roofDark); g.fillRect(x - 9, roofY, w + 18, 30);
      let row = 0;
      for (let ry = roofY + 2; ry < roofY + 26; ry += 7, row++) {
        g.fillStyle(row % 2 ? building.roof : building.roofLight, 0.9);
        g.fillRect(x - 7, ry, w + 14, 5);
      }
      g.fillStyle(building.roofDark, 0.5);
      for (let rx = x - 7; rx < x + w + 7; rx += 11) g.fillRect(rx, roofY + 2, 2, 24);
      g.fillStyle(building.roofLight); g.fillRect(x - 9, roofY, w + 18, 3);
      g.fillStyle(0x1b2a22, 0.38); g.fillRect(x - 11, roofY + 28, w + 22, 4);

      // Chimney.
      g.fillStyle(PALETTE.wallDark); g.fillRect(x + w - 36, roofY - 14, 15, 18);
      g.fillStyle(building.roofDark); g.fillRect(x + w - 39, roofY - 18, 21, 5);

      // Windows: frame, mullions, sill.
      const windowY = roofAbove ? wallY + 16 : wallY + 22;
      for (const wx of [x + 20, x + w - 48]) {
        g.fillStyle(PALETTE.windowFrame); g.fillRect(wx - 2, windowY - 2, 32, 26);
        g.fillStyle(PALETTE.window); g.fillRect(wx, windowY, 28, 22);
        g.fillStyle(PALETTE.windowFrame, 0.9); g.fillRect(wx + 13, windowY, 2, 22); g.fillRect(wx, windowY + 10, 28, 2);
        g.fillStyle(PALETTE.wallDark); g.fillRect(wx - 4, windowY + 24, 36, 3);
      }

      // Door: lintel, planks, handle, stone step.
      const doorTop = roofAbove ? wallY + wallH - 42 : wallY + 12;
      g.fillStyle(PALETTE.woodDark); g.fillRect(building.doorX - 15, doorTop - 5, 30, 6);
      g.fillStyle(PALETTE.wood); g.fillRect(building.doorX - 12, doorTop, 24, 36);
      g.fillStyle(PALETTE.woodDark); g.fillRect(building.doorX - 1, doorTop, 2, 36);
      g.fillStyle(PALETTE.wallShade, 0.45);
      for (let dy = doorTop + 7; dy < doorTop + 34; dy += 8) g.fillRect(building.doorX - 11, dy, 10, 1);
      g.fillStyle(0xe8c86a); g.fillRect(building.doorX + 7, doorTop + 18, 3, 3);
      g.fillStyle(PALETTE.stoneLight); g.fillRect(building.doorX - 17, doorTop + 36, 34, 4);

      // Sign with a drawn glyph, readable without relying on colour.
      const signX = building.doorX - 66; const signY = doorTop + 4;
      g.fillStyle(PALETTE.woodDark); g.fillRect(signX - 3, signY - 3, 46, 24);
      g.fillStyle(0xf2e6c2); g.fillRect(signX, signY, 40, 18);
      g.fillStyle(PALETTE.ink, 0.85);
      if (building.sign === 'BOOK') { g.fillRect(signX + 7, signY + 4, 12, 10); g.fillRect(signX + 21, signY + 4, 12, 10); g.fillRect(signX + 19, signY + 4, 2, 10); }
      if (building.sign === 'JAR') { g.fillRect(signX + 11, signY + 3, 18, 4); g.fillRect(signX + 9, signY + 7, 22, 8); }
      if (building.sign === 'MAP') { g.fillRect(signX + 7, signY + 5, 26, 2); g.fillRect(signX + 7, signY + 10, 18, 2); g.fillRect(signX + 27, signY + 8, 3, 7); }
      if (building.sign === 'GEAR') { g.fillRect(signX + 13, signY + 4, 12, 12); g.fillStyle(0xf2e6c2); g.fillRect(signX + 17, signY + 8, 4, 4); }
      if (building.sign === 'SEAL') { g.fillRect(signX + 12, signY + 3, 14, 12); g.fillStyle(0xf2e6c2); g.fillRect(signX + 16, signY + 6, 6, 6); }
      if (building.sign === 'FLASK') { g.fillRect(signX + 15, signY + 3, 6, 8); g.fillRect(signX + 11, signY + 10, 14, 6); }

      // Name on the ground in front of the building, never on the wall art.
      this.add.text(x + w / 2, roofAbove ? y + h + 40 : y - 22, building.label, {
        fontFamily: 'monospace', fontSize: '10px', fontStyle: 'bold', color: '#0f1c17',
        stroke: '#eaf3e4', strokeThickness: 3,
      }).setOrigin(0.5).setDepth(3);
    }
  }

  // ------------------------------------------------------------------ state

  applyState(state: TownState): void {
    this.state = state;
    for (const role of ROLES) {
      const resident = state.residents[role];
      const current = this.pose.get(role);
      if (!this.sprites.get(role) || !current) continue;   // create() has not run yet
      // Working happens at the building's bench; everything else waits in its yard. The
      // coordinator's building is whatever the tool he is running belongs to.
      const target = resident.state === 'working' ? workPoint(resident.location) : yardPoint(resident.location);
      // Already heading somewhere? Do not restart: tool traffic arrives every few hundred ms during
      // a task, and restarting the tween each time made the walk crawl.
      const intent = this.targets.get(role);
      if (intent && Math.abs(intent.x - target.x) <= 3 && Math.abs(intent.y - target.y) <= 3) continue;
      this.targets.set(role, target);
      if (Math.abs(current.x - target.x) > 3 || Math.abs(current.y - target.y) > 3) this.walk(role, target);
    }
  }

  /** Walking is a visual state transition: out to the lane, along it, then to the destination. */
  private walk(role: Role, target: { x: number; y: number }): void {
    const current = this.pose.get(role)!;
    const from = { x: current.x, y: current.y };
    const points: Array<[number, number]> = [];
    if (Math.abs(from.y - ROAD_Y) > 20 || Math.abs(target.y - ROAD_Y) > 20) {
      points.push([from.x, ROAD_Y]);
      points.push([target.x, ROAD_Y]);
    }
    points.push([target.x, target.y]);
    const remaining: Phaser.Math.Vector2[] = [];
    for (const [x, y] of points) {
      const previous = remaining[remaining.length - 1];
      if (previous && Math.abs(previous.x - x) < 3 && Math.abs(previous.y - y) < 3) continue;
      if (!previous && Math.abs(from.x - x) < 3 && Math.abs(from.y - y) < 3) continue;
      remaining.push(new Phaser.Math.Vector2(x, y));
    }
    this.paths.set(role, remaining);
    if (!this.motion) {
      const last = remaining[remaining.length - 1];
      if (last) this.place(role, last.x, last.y, false);
      this.paths.set(role, []);
      return;
    }
    this.step(role);
  }

  private step(role: Role): void {
    const path = this.paths.get(role) || [];
    const next = path.shift();
    const pose = this.pose.get(role)!;
    if (!next) { pose.walking = false; return; }
    const distance = Phaser.Math.Distance.Between(pose.x, pose.y, next.x, next.y);
    if (distance < 3) { this.place(role, next.x, next.y, true); this.step(role); return; }
    pose.walking = true;
    pose.facing = next.x >= pose.x ? 1 : -1;
    const container = this.sprites.get(role)!.container;
    this.tweens.killTweensOf(container);
    this.tweens.add({
      targets: container, x: next.x, y: next.y,
      duration: Math.max(180, distance * STEP_MS_PER_PX), ease: 'Linear',
      onUpdate: () => { pose.x = container.x; pose.y = container.y; },
      onComplete: () => { this.place(role, next.x, next.y, true); this.step(role); },
    });
  }

  private place(role: Role, x: number, y: number, keepWalking: boolean): void {
    const pose = this.pose.get(role)!;
    pose.x = x; pose.y = y; pose.walking = keepWalking;
    this.sprites.get(role)?.container.setPosition(x, y);
  }

  setMotion(enabled: boolean): void {
    this.motion = enabled;
    if (!enabled) {
      // Reduced motion: stop walking, park every resident where its state belongs, idle the clock.
      this.tweens.killAll();
      this.paths.clear();
      this.targets.clear();
      for (const role of ROLES) {
        const pose = this.pose.get(role);
        if (!pose) continue;
        const resident = this.state?.residents[role];
        const point = resident?.state === 'working' ? workPoint(resident.location) : yardPoint(ROSTER[role].location);
        pose.x = point.x; pose.y = point.y; pose.walking = false;
        this.sprites.get(role)?.container.setPosition(point.x, point.y);
      }
      if (this.time) this.time.paused = true;
    } else if (this.time) {
      this.time.paused = false;
    }
  }

  /** Verification hooks: a rendered frame counter and where each resident actually stands. */
  frames(): number { return this.pulse; }

  positions(): Array<{ role: string; x: number; y: number; state: string; location: string }> {
    return ROLES.map(role => ({
      role,
      x: Math.round(this.pose.get(role)?.x ?? -1),
      y: Math.round(this.pose.get(role)?.y ?? -1),
      state: this.state?.residents[role]?.state ?? 'unknown',
      location: this.state?.residents[role]?.location ?? ROSTER[role].location,
    }));
  }

  // ------------------------------------------------------------------ per-pulse drawing

  private animate(): void {
    this.pulse++;
    this.glow?.clear(); this.ambient?.clear(); this.smoke?.clear();
    // A hidden tab animates nothing; the town resumes from the backend snapshot on return.
    if (typeof document !== 'undefined' && document.hidden) return;

    if (this.hoverRole) {
      const pose = this.pose.get(this.hoverRole)!;
      this.hover?.clear().lineStyle(2, 0xf7ecc0, 0.95).strokeRoundedRect(pose.x - 18, pose.y - 46, 36, 70, 5);
    }

    const frame = this.pulse;
    for (const role of ROLES) {
      const sprite = this.sprites.get(role)!;
      const pose = this.pose.get(role)!;
      const resident = this.state?.residents[role];
      const activity: Activity = resident?.state || 'idle';
      pose.frame = frame;
      this.drawResident(sprite.body, role, activity, pose, frame);
      const bob = this.motion ? bobFor(activity, frame, role) : 0;
      sprite.container.setPosition(pose.x, pose.y + bob);
      sprite.name.setPosition(0, -36 + bob);
      // The badge is a small nameplate beside the character: above/below placed it over the
      // neighbouring row's residents and buildings, because the town is mirrored around the lane.
      const badge = badgeFor(activity, resident?.label || '');
      if (sprite.badge.text !== badge) sprite.badge.setText(badge);
      const offset = badgeOffset(role);
      sprite.badge.setPosition(offset.x, offset.y + bob);
      this.drawAura(role, activity, pose, frame);
    }

    for (const villager of this.villagers) {
      villager.pose.frame = frame;
      this.drawVillager(villager.body, villager.pose, frame);
      if (this.motion && !villager.path.length && frame % 30 === villager.seat * 10) this.wander(villager);
      this.villagerStep(villager);
    }

    // Work lights and chimney smoke: only where a role is genuinely working.
    for (const building of BUILDINGS) {
      const activity = this.state?.residents[roleAtBuilding(building.id)]?.state || 'idle';
      if (activity !== 'working') continue;
      const windowY = building.faces === 'down' ? building.y + 14 : building.y + 52;
      const flicker = this.motion && frame % 6 < 3;
      this.ambient?.fillStyle(flicker ? 0xfff0b8 : PALETTE.windowLit, 0.9);
      this.ambient?.fillRect(building.x + 20, windowY, 28, 22);
      this.ambient?.fillRect(building.x + building.w - 48, windowY, 28, 22);
      const roofY = building.faces === 'down' ? building.y - 30 : building.y;
      for (let puff = 0; puff < 3; puff++) {
        const lift = this.motion ? ((frame + puff * 6) % 30) : 0;
        this.smoke?.fillStyle(0xd8dde0, 0.3 - puff * 0.07);
        this.smoke?.fillEllipse(building.x + building.w - 28 + (puff % 2 ? 3 : -3), roofY - 22 - lift, 10, 7);
      }
    }
  }

  /** State aura: a working resident glows, a waiting one pulses amber, a failure sits in red. */
  private drawAura(role: Role, activity: Activity, pose: Pose, frame: number): void {
    if (activity === 'working') {
      const pulse = (frame % 6) / 6;
      this.glow?.fillStyle(ACCENT[role], 0.14 + 0.18 * (1 - pulse));
      this.glow?.fillEllipse(pose.x, pose.y + 14, 46 + pulse * 14, 20 + pulse * 6);
    } else if (activity === 'waiting_approval') {
      this.glow?.fillStyle(0xf0d27a, frame % 8 < 5 ? 0.24 : 0.08);
      this.glow?.fillEllipse(pose.x, pose.y + 14, 44, 18);
    } else if (activity === 'failed' || activity === 'blocked') {
      this.glow?.fillStyle(activity === 'failed' ? 0xe0736a : 0xe0b45c, 0.2);
      this.glow?.fillEllipse(pose.x, pose.y + 14, 44, 18);
    }
  }

  /**
   * Role sprites, ~26x44 including hat and tool, outlined so they read at 1x. Every pose is driven
   * by the resident's state: only `working` moves a tool, and only `walking` swings the legs.
   */
  private drawResident(g: Phaser.GameObjects.Graphics, role: Role, activity: Activity, pose: Pose, frame: number): void {
    g.clear();
    const colour = ACCENT[role];
    const walking = pose.walking && this.motion;
    const working = activity === 'working';
    const step = walking ? (frame % 2 ? 3 : -3) : 0;
    const toolY = working && this.motion ? (frame % 4 < 2 ? -3 : 1) : 0;
    const flip = pose.facing;
    const waiting = activity === 'waiting_approval' || activity === 'queued' || activity === 'blocked';

    // Shadow, legs, boots.
    g.fillStyle(0x1b2a22, 0.36); g.fillEllipse(0, 23, 30, 8);
    g.fillStyle(PALETTE.outline); g.fillRect(-9, 8 + step, 8, 15); g.fillRect(2, 8 - step, 8, 15);
    g.fillStyle(0x8a6b4a); g.fillRect(-8, 10 + step, 6, 10); g.fillRect(3, 10 - step, 6, 10);
    g.fillStyle(0x33261c); g.fillRect(-9, 20 + step, 8, 4); g.fillRect(2, 20 - step, 8, 4);
    // Torso.
    g.fillStyle(PALETTE.outline); g.fillRect(-12, -13, 24, 22);
    g.fillStyle(colour); g.fillRect(-10, -11, 20, 18);
    g.fillStyle(shade(colour), 0.5); g.fillRect(-10, 3, 20, 4);
    g.fillStyle(0x2b3a48); g.fillRect(-11, -1, 22, 4);
    g.fillStyle(0xf2ead6, 0.9); g.fillRect(-4, -11, 8, 3);
    // Arms.
    const swing = walking ? (frame % 2 ? 4 : -4) : 0;
    g.fillStyle(PALETTE.outline); g.fillRect(-18, -9 + swing, 7, 18); g.fillRect(11, -9 - swing, 7, 18);
    g.fillStyle(colour); g.fillRect(-17, -8 + swing, 5, 14); g.fillRect(12, -8 - swing, 5, 14);
    g.fillStyle(0xe8c39c); g.fillRect(-17, 6 + swing, 5, 5); g.fillRect(12, 6 - swing, 5, 5);
    // Head.
    g.fillStyle(PALETTE.outline); g.fillRect(-9, -30, 18, 17);
    g.fillStyle(0xe8c39c); g.fillRect(-7, -28, 14, 14);
    g.fillStyle(0x2b2118); g.fillRect(-8, -31, 16, 5);
    if (walking) { g.fillStyle(PALETTE.outline); g.fillRect(-3 + flip, -23, 3, 2); }
    else { g.fillStyle(PALETTE.outline); g.fillRect(-4 + flip, -23, 2, 2); g.fillRect(2 + flip, -23, 2, 2); }

    // Role kit: a distinct silhouette so avatars are identifiable without colour.
    if (role === 'coordinator') {
      g.fillStyle(0x1f3b46); g.fillRect(-11, -35, 22, 5); g.fillRect(-15, -31, 30, 3);
      g.fillStyle(0xf2e6c2); g.fillRect(9 * flip, -5, 10, 13);
      g.fillStyle(0x8a6b4a); g.fillRect(10 * flip, -3, 8, 2);
    }
    if (role === 'researcher') {
      g.fillStyle(0x3f6b8f); g.fillRect(-10, -35, 20, 5);
      g.fillStyle(0xe4eef6); g.fillRect(-8, -25, 16, 4);
      g.fillStyle(0xa8503c); g.fillRect(11 * flip, -5 + toolY, 10, 13);
      g.fillStyle(0xf2ead6); g.fillRect(12 * flip, -3 + toolY, 8, 9);
    }
    if (role === 'planner') {
      g.fillStyle(0x6e4f8f); g.fillRect(-10, -35, 20, 6);
      g.fillStyle(0xf2e6c2); g.fillRect(10 * flip, -5 + toolY, 11, 14);
      g.fillStyle(0xe8c86a); g.fillRect(13 * flip, -12 + toolY, 4, 7);
    }
    if (role === 'builder') {
      g.fillStyle(0xe8b23c); g.fillRect(-11, -38, 22, 6); g.fillRect(-7, -42, 14, 5);
      g.fillStyle(0x8f9aa3); g.fillRect(11 * flip, -5 + toolY, 11, 4);
      g.fillStyle(0x6b767f); g.fillRect(18 * flip, -8 + toolY, 4, 8);
    }
    if (role === 'tester') {
      g.fillStyle(0x2b5f5a); g.fillRect(-10, -35, 20, 6);
      g.lineStyle(2, 0xdfe9f2); g.strokeCircle(14 * flip, -1 + toolY, 6);
      g.fillStyle(0xdfe9f2); g.fillRect(17 * flip, 3 + toolY, 7, 3);
    }
    if (role === 'archivist') {
      g.fillStyle(0x6b4a2c); g.fillRect(-10, -12, 20, 7);
      g.fillStyle(0xefe3c4); g.fillRect(11 * flip, -5 + toolY, 11, 14);
      g.fillStyle(0xc9a37a); g.fillRect(12 * flip, -2 + toolY, 9, 2);
    }
    if (role === 'reviewer') {
      g.fillStyle(0x2f5c3a); g.fillRect(-10, -35, 20, 5);
      g.fillStyle(0xf4f1e6); g.fillRect(10 * flip, -5 + toolY, 12, 15);
      g.fillStyle(0x4d8f5a); g.fillRect(12 * flip, -2 + toolY, 8, 2);
      g.fillStyle(0xb05a4a); g.fillRect(12 * flip, 2 + toolY, 8, 2);
    }

    if (working && this.motion) {
      g.fillStyle(0xfff0b8, frame % 4 < 2 ? 0.95 : 0.35);
      g.fillRect(13 * flip, -14 + toolY, 3, 3); g.fillRect(17 * flip, -10 + toolY, 2, 2);
    }
    if (waiting) { g.fillStyle(0xf7ecc0, 0.9); g.fillRect(-1, -36, 3, 3); }
  }

  private drawVillager(g: Phaser.GameObjects.Graphics, pose: Pose, frame: number): void {
    g.clear();
    const walking = pose.walking && this.motion;
    const step = walking ? (frame % 2 ? 3 : -3) : 0;
    g.fillStyle(0x1b2a22, 0.28); g.fillEllipse(0, 19, 24, 6);
    g.fillStyle(0x3b3b45); g.fillRect(-7, 5 + step, 6, 13); g.fillRect(1, 5 - step, 6, 13);
    g.fillStyle(0x5c5c66); g.fillRect(-9, -12, 18, 19);
    g.fillStyle(0x8a8a94); g.fillRect(-9, -1, 18, 3);
    g.fillStyle(0xd8b08c); g.fillRect(-6, -25, 12, 13);
    g.fillStyle(0x4a4a52); g.fillRect(-7, -28, 14, 4);
    g.fillStyle(PALETTE.outline); g.fillRect(-3, -21, 2, 2); g.fillRect(1, -21, 2, 2);
  }

  private wander(villager: Villager): void {
    const spots: Array<[number, number]> = [[150, 212], [400, 212], [660, 212], [400, 146], [120, 350], [680, 350]];
    const [x, y] = spots[Math.floor(this.pulse / 30) % spots.length];
    villager.path = [new Phaser.Math.Vector2(x, ROAD_Y), new Phaser.Math.Vector2(x, y)];
  }

  private villagerStep(villager: Villager): void {
    if (!this.motion || villager.pose.walking) return;
    const next = villager.path.shift();
    if (!next) return;
    villager.pose.walking = true;
    villager.pose.facing = next.x >= villager.pose.x ? 1 : -1;
    const distance = Phaser.Math.Distance.Between(villager.pose.x, villager.pose.y, next.x, next.y);
    this.tweens.add({
      targets: villager.container, x: next.x, y: next.y,
      duration: Math.max(500, distance * 12), ease: 'Linear',
      onComplete: () => { villager.pose.x = next.x; villager.pose.y = next.y; villager.pose.walking = false; },
    });
  }
}

// ---------------------------------------------------------------------- geometry

/** Where a resident stands while idle: its own building's yard, on the lane side. */
export function yardPoint(location: LocationId): { x: number; y: number } {
  const building = BUILDINGS.find(item => item.id === location);
  if (!building) return { x: SQUARE.x + 100, y: SQUARE.y + 46 };
  return building.faces === 'down'
    ? { x: building.doorX, y: building.y + building.h + 28 }
    : { x: building.doorX, y: building.y - 24 };
}

/** Where a resident works: at the bench beside its own door. */
export function workPoint(location: LocationId): { x: number; y: number } {
  const building = BUILDINGS.find(item => item.id === location);
  if (!building) return { x: SQUARE.x + 100, y: SQUARE.y + 46 };
  return building.faces === 'down'
    ? { x: building.doorX + 30, y: building.y + building.h + 14 }
    : { x: building.doorX + 30, y: building.y - 10 };
}

/** The one role whose home building this is (decorative villagers have none). */
export function roleAtBuilding(location: LocationId): Role {
  return (ROLES.find(role => ROSTER[role].location === location) || 'coordinator') as Role;
}

const ACTIVITY_BADGES: Readonly<Record<Activity, string>> = Object.freeze({
  idle: '', queued: '⋯ queued', working: '▶ working', waiting_approval: '! waiting',
  completed: '✓ finished', failed: '✕ failed', blocked: '‖ blocked', unknown: '? unknown',
});

/** Short, factual, and bounded: a state word plus at most a few words of detail. */
function badgeFor(activity: Activity, label: string): string {
  if (activity === 'idle') return '';
  const words = label.replace(/\s+/g, ' ').trim();
  const short = words.length > 16 ? words.slice(0, 15) + '…' : words;
  const state = ACTIVITY_BADGES[activity];
  return short ? `${state}\n${short}` : state;
}

/**
 * Nameplate position: to the right of the character, or to the left in the right-hand column so it
 * never runs off the canvas. Placed at chest height beside the sprite, which is free ground in
 * every column and cannot collide with the mirrored row on the other side of the lane.
 */
function badgeOffset(role: Role): { x: number; y: number } {
  const building = BUILDINGS.find(item => item.id === ROSTER[role].location);
  const rightColumn = !!building && building.x + building.w / 2 > 600;
  return { x: rightColumn ? -66 : 66, y: -8 };
}

/** Motion that is clearly *not* work: a 1px breath when idle, a nudge while working. */
function bobFor(activity: Activity, frame: number, role: Role): number {
  if (activity === 'working') return frame % 3 === 0 ? -1 : 0;
  if (activity === 'idle') return Math.round(Math.sin((frame + role.length * 7) * 0.14));
  return 0;
}

function shade(colour: number): number {
  const r = Math.max(0, ((colour >> 16) & 0xff) - 34);
  const g = Math.max(0, ((colour >> 8) & 0xff) - 34);
  const b = Math.max(0, (colour & 0xff) - 34);
  return (r << 16) | (g << 8) | b;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export const TOWN_SIZE = { width: WIDTH, height: HEIGHT, pulseMs: PULSE_MS };
export { BUILDINGS, SQUARE, PALETTE };
