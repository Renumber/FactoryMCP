import {
  DIR_VEC,
  ENTITY_DEFS,
  ITEMS,
  entityPorts,
  expandPath,
  footprint,
  oreAt,
  purityAt,
  type Dir,
  type Entity,
  type EntityStatus,
  type EntityType,
  type Rect,
  type World,
} from '@factorymcp/sim';
import { Application, Container, Graphics, Text } from 'pixi.js';
import type { GameController } from '../game/controller.ts';

export const TILE = 32;

const ORE_COLORS: Record<string, number> = { iron_ore: 0x8fa3b8, copper_ore: 0xd9824a, coal: 0x4a4a4a };

const MACHINE_COLORS: Partial<Record<EntityType, number>> = {
  miner: 0x7a5c3a,
  stone_furnace: 0x8a4b3a,
  electric_furnace: 0x3a5f8a,
  assembler: 0x46704f,
  coal_generator: 0x55585e,
  hub: 0x5b3fd9,
};

const MACHINE_LABELS: Partial<Record<EntityType, string>> = {
  miner: '채굴기',
  stone_furnace: '용광로',
  electric_furnace: '전기로',
  assembler: '조립',
  coal_generator: '발전기',
  hub: 'HUB',
};

const RECIPE_SHORT: Record<string, string> = {
  iron_plate: '철판',
  copper_plate: '구리판',
  iron_gear: '기어',
  copper_wire: '전선',
  basic_circuit: '회로',
  machine_part: '부품',
};

export const STATUS_COLORS: Record<EntityStatus, number> = {
  working: 0x4fd18b,
  idle: 0x6b7280,
  starved: 0xf5c542,
  blocked: 0xff9f43,
  no_power: 0xff5c5c,
  no_fuel: 0xff5c5c,
  no_recipe: 0x9ca3af,
  no_ore: 0xff5c5c,
  unlinked: 0xff5c5c,
};

interface Cell {
  x: number;
  y: number;
}

type Drag =
  | { kind: 'pan'; sx: number; sy: number; cx: number; cy: number; moved: boolean; button: number }
  | { kind: 'belt'; start: Cell; end: Cell }
  | { kind: 'zone'; start: Cell; end: Cell }
  | { kind: 'remove' };

export class Renderer {
  private app = new Application();
  private camera = new Container();
  private terrain = new Graphics();
  private statics = new Graphics();
  private labels = new Container();
  private dynamic = new Graphics();
  private overlay = new Graphics();
  private overlayLabels = new Container();

  private worldRef: World | null = null;
  private topo = -1;
  private overlayKey = '';
  private hover: Cell | null = null;
  private drag: Drag | null = null;
  private spaceDown = false;
  private destroyed = false;
  private ready = false;
  private el: HTMLElement | null = null;
  private cleanup: (() => void)[] = [];

  constructor(private game: GameController) {}

  async init(el: HTMLElement): Promise<void> {
    this.el = el;
    await this.app.init({ resizeTo: el, background: 0x0b0d12, antialias: true, autoDensity: true, resolution: window.devicePixelRatio });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    el.appendChild(this.app.canvas);
    this.camera.addChild(this.terrain, this.statics, this.dynamic, this.labels, this.overlay, this.overlayLabels);
    this.app.stage.addChild(this.camera);
    this.centerOnHub();
    this.bindInput(this.app.canvas);
    this.app.ticker.add(() => this.frame());
    this.ready = true;
  }

  destroy(): void {
    this.destroyed = true;
    for (const fn of this.cleanup) fn();
    if (this.ready) this.app.destroy(true, { children: true });
  }

  centerOnHub(): void {
    const w = this.game.world;
    const hub = w.hub();
    const el = this.el!;
    const scale = Math.min(1.4, Math.max(0.5, Math.min(el.clientWidth / (w.width * TILE), el.clientHeight / (w.height * TILE)) * 1.6));
    this.camera.scale.set(scale);
    this.camera.position.set(el.clientWidth / 2 - (hub.x + 2) * TILE * scale, el.clientHeight / 2 - (hub.y + 2) * TILE * scale);
  }

  // ------------------------------------------------------------------ frame

  private frame(): void {
    const world = this.game.world;
    if (world !== this.worldRef) {
      this.worldRef = world;
      this.topo = -1;
      this.drawTerrain(world);
    }
    if (world.topologyVersion !== this.topo) {
      this.topo = world.topologyVersion;
      this.drawStatics(world);
    }
    this.drawDynamic(world);
    this.drawOverlay(world);
  }

  private drawTerrain(w: World): void {
    const g = this.terrain;
    g.clear();
    g.rect(0, 0, w.width * TILE, w.height * TILE).fill(0x12151c);
    for (let y = 0; y < w.height; y++) {
      for (let x = 0; x < w.width; x++) {
        const ore = oreAt(w.terrain, x, y);
        if (!ore) continue;
        const purity = purityAt(w.terrain, x, y) ?? 1;
        const alpha = purity === 2 ? 0.55 : purity === 1 ? 0.35 : 0.18;
        g.roundRect(x * TILE + 1, y * TILE + 1, TILE - 2, TILE - 2, 5).fill({ color: ORE_COLORS[ore]!, alpha });
        if (purity === 2) g.circle(x * TILE + TILE / 2, y * TILE + TILE / 2, 2.5).fill({ color: 0xffffff, alpha: 0.5 });
      }
    }
    for (let x = 0; x <= w.width; x++) g.moveTo(x * TILE, 0).lineTo(x * TILE, w.height * TILE);
    for (let y = 0; y <= w.height; y++) g.moveTo(0, y * TILE).lineTo(w.width * TILE, y * TILE);
    g.stroke({ width: 1, color: 0xffffff, alpha: 0.04 });
    g.rect(0, 0, w.width * TILE, w.height * TILE).stroke({ width: 2, color: 0x3b4252 });
  }

  private drawStatics(w: World): void {
    const g = this.statics;
    g.clear();
    for (const child of this.labels.removeChildren()) child.destroy();
    for (const e of w.entities()) drawEntity(g, e, 1, this.labels);
  }

  private drawDynamic(w: World): void {
    const g = this.dynamic;
    g.clear();
    for (const e of w.entities()) {
      const def = ENTITY_DEFS[e.type];
      if (def.category === 'transport') {
        const slot = e.slots[0];
        if (!slot?.item) continue;
        const [vx, vy] = DIR_VEC[e.dir];
        const t = e.type === 'splitter' || e.type === 'merger' ? 0 : Math.min(1, slot.progress) - 0.5;
        const cx = (e.x + 0.5 + vx * t) * TILE;
        const cy = (e.y + 0.5 + vy * t) * TILE;
        g.circle(cx, cy, 6).fill(ITEMS[slot.item].color).stroke({ width: 1.5, color: 0x0b0d12 });
        continue;
      }
      if (e.type === 'hub') continue;
      const n = def.size;
      g.circle((e.x + n) * TILE - 7, e.y * TILE + 7, 4).fill(STATUS_COLORS[e.status]);
    }
  }

  private drawOverlay(w: World): void {
    const g = this.overlay;
    g.clear();
    const game = this.game;
    const plan = game.previewPlan();

    const key = `${w.state.zones.map((z) => `${z.id}:${z.name}:${z.x},${z.y},${z.w},${z.h}`).join('|')}#${plan?.id ?? ''}`;
    if (key !== this.overlayKey) {
      this.overlayKey = key;
      for (const child of this.overlayLabels.removeChildren()) child.destroy();
      for (const z of w.state.zones) {
        const label = makeText(`${z.name} · ${z.id}`, 12, 0xf5c542);
        label.position.set(z.x * TILE + 4, z.y * TILE - 18);
        this.overlayLabels.addChild(label);
      }
    }

    for (const z of w.state.zones) {
      g.rect(z.x * TILE, z.y * TILE, z.w * TILE, z.h * TILE)
        .fill({ color: 0xf5c542, alpha: 0.04 })
        .stroke({ width: 2, color: 0xf5c542, alpha: 0.8 });
      for (const p of z.ports) {
        g.rect(p.x * TILE + 3, p.y * TILE + 3, TILE - 6, TILE - 6).stroke({
          width: 2,
          color: p.kind === 'in' ? 0x38d9f5 : 0xf06bd1,
        });
      }
    }

    if (plan) {
      for (const r of plan.changes.removed) {
        const n = ENTITY_DEFS[r.type].size;
        g.rect(r.x * TILE + 1, r.y * TILE + 1, n * TILE - 2, n * TILE - 2)
          .fill({ color: 0xff4d4d, alpha: 0.35 })
          .stroke({ width: 2, color: 0xff4d4d });
      }
      for (const a of plan.changes.added) {
        drawEntity(g, { ...a, status: 'idle' } as Entity, 0.55, null, 0x4b8cff);
      }
      for (const m of plan.changes.modified) {
        const n = ENTITY_DEFS[m.type].size;
        g.rect(m.x * TILE + 1, m.y * TILE + 1, n * TILE - 2, n * TILE - 2).stroke({ width: 2, color: 0xf5c542 });
      }
    }

    const sel = game.selectedId !== null ? w.getEntity(game.selectedId) : undefined;
    if (sel) {
      const r = footprint(sel);
      g.rect(r.x * TILE - 1, r.y * TILE - 1, r.w * TILE + 2, r.h * TILE + 2).stroke({ width: 2, color: 0xffffff });
    }

    const tool = game.tool;
    const drag = this.drag;
    if (drag?.kind === 'zone') {
      const r = cellRect(drag.start, drag.end);
      g.rect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE).fill({ color: 0xf5c542, alpha: 0.12 }).stroke({ width: 2, color: 0xf5c542 });
    } else if (drag?.kind === 'belt' && tool.kind === 'place') {
      const path = this.beltPath(drag.start, drag.end);
      const cells = 'cells' in path ? path.cells : [];
      for (const c of cells) {
        const blocked = !w.inBounds(c.x, c.y) || !!w.entityAt(c.x, c.y);
        drawBelt(g, c.x, c.y, c.dir, tool.type === 'fast_belt', 0.6, blocked ? 0xff4d4d : undefined);
      }
    } else if (this.hover && tool.kind === 'place') {
      const def = ENTITY_DEFS[tool.type];
      const off = Math.floor((def.size - 1) / 2);
      const x = this.hover.x - off;
      const y = this.hover.y - off;
      const ok = w.checkPlace(tool.type, x, y, null) === null;
      drawEntity(g, { type: tool.type, x, y, dir: game.dir, status: 'idle' } as Entity, 0.5, null, ok ? undefined : 0xff4d4d);
    } else if (this.hover && tool.kind === 'remove') {
      const e = w.entityAt(this.hover.x, this.hover.y);
      if (e && e.type !== 'hub') {
        const r = footprint(e);
        g.rect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE).fill({ color: 0xff4d4d, alpha: 0.3 }).stroke({ width: 2, color: 0xff4d4d });
      } else {
        g.rect(this.hover.x * TILE, this.hover.y * TILE, TILE, TILE).stroke({ width: 1, color: 0xff4d4d, alpha: 0.6 });
      }
    } else if (this.hover && tool.kind === 'zone') {
      g.rect(this.hover.x * TILE, this.hover.y * TILE, TILE, TILE).stroke({ width: 1, color: 0xf5c542 });
    } else if (this.hover) {
      g.rect(this.hover.x * TILE, this.hover.y * TILE, TILE, TILE).stroke({ width: 1, color: 0xffffff, alpha: 0.25 });
    }
  }

  // ------------------------------------------------------------------ input

  private cellAt(clientX: number, clientY: number): Cell {
    const rect = this.app.canvas.getBoundingClientRect();
    const s = this.camera.scale.x;
    return {
      x: Math.floor((clientX - rect.left - this.camera.x) / s / TILE),
      y: Math.floor((clientY - rect.top - this.camera.y) / s / TILE),
    };
  }

  private beltPath(a: Cell, b: Cell) {
    if (a.x === b.x && a.y === b.y) return expandPath([[a.x, a.y]], this.game.dir);
    const horizontalFirst = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
    const corner: [number, number] = horizontalFirst ? [b.x, a.y] : [a.x, b.y];
    const pts: [number, number][] = [[a.x, a.y]];
    if ((corner[0] !== a.x || corner[1] !== a.y) && (corner[0] !== b.x || corner[1] !== b.y)) pts.push(corner);
    pts.push([b.x, b.y]);
    return expandPath(pts);
  }

  private bindInput(canvas: HTMLCanvasElement): void {
    const game = this.game;
    const on = <K extends keyof HTMLElementEventMap>(target: HTMLElement | Window, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => target.removeEventListener(type, fn as EventListener));
    };

    on(canvas, 'contextmenu', (e) => e.preventDefault());

    on(
      canvas,
      'wheel',
      (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const old = this.camera.scale.x;
        const next = Math.min(3, Math.max(0.3, old * Math.exp(-e.deltaY * 0.0015)));
        this.camera.position.set(mx - ((mx - this.camera.x) * next) / old, my - ((my - this.camera.y) * next) / old);
        this.camera.scale.set(next);
      },
      { passive: false },
    );

    on(canvas, 'pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      const cell = this.cellAt(e.clientX, e.clientY);
      if (e.button === 1 || e.button === 2 || (e.button === 0 && this.spaceDown)) {
        this.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, cx: this.camera.x, cy: this.camera.y, moved: false, button: e.button };
        return;
      }
      if (e.button !== 0) return;
      const tool = game.tool;
      if (tool.kind === 'select') game.select(cell.x, cell.y);
      else if (tool.kind === 'remove') {
        game.removeAt(cell.x, cell.y);
        this.drag = { kind: 'remove' };
      } else if (tool.kind === 'zone') this.drag = { kind: 'zone', start: cell, end: cell };
      else if (tool.type === 'belt' || tool.type === 'fast_belt') this.drag = { kind: 'belt', start: cell, end: cell };
      else {
        const off = Math.floor((ENTITY_DEFS[tool.type].size - 1) / 2);
        game.placeAt(cell.x - off, cell.y - off);
      }
    });

    on(canvas, 'pointermove', (e) => {
      const cell = this.cellAt(e.clientX, e.clientY);
      this.hover = cell;
      const d = this.drag;
      if (!d) return;
      if (d.kind === 'pan') {
        const dx = e.clientX - d.sx;
        const dy = e.clientY - d.sy;
        if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
        this.camera.position.set(d.cx + dx, d.cy + dy);
      } else if (d.kind === 'belt' || d.kind === 'zone') d.end = cell;
      else if (d.kind === 'remove') game.removeAt(cell.x, cell.y);
    });

    on(canvas, 'pointerleave', () => {
      this.hover = null;
    });

    on(canvas, 'pointerup', () => {
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      if (d.kind === 'pan') {
        if (!d.moved && d.button === 2) {
          if (game.tool.kind !== 'select') game.setTool({ kind: 'select' });
          else game.select(-1, -1);
        }
      } else if (d.kind === 'belt' && game.tool.kind === 'place') {
        const path = this.beltPath(d.start, d.end);
        if ('error' in path) return;
        const type = game.tool.type === 'fast_belt' ? 'fast_belt' : 'belt';
        const cells = path.cells;
        const last = cells[cells.length - 1]!;
        const ok = game.applyOps([{ op: 'belt_path', points: cells.map((c) => [c.x, c.y] as [number, number]), type, end_dir: last.dir }]);
        if (ok && cells.length > 1) game.dir = last.dir;
      } else if (d.kind === 'zone') {
        const r = cellRect(d.start, d.end);
        const w = game.world;
        const clipped = { x: Math.max(0, r.x), y: Math.max(0, r.y), w: 0, h: 0 };
        clipped.w = Math.min(w.width, r.x + r.w) - clipped.x;
        clipped.h = Math.min(w.height, r.y + r.h) - clipped.y;
        if (clipped.w >= 2 && clipped.h >= 2) game.addZone(clipped);
        else game.toast('구역은 최소 2x2 이상이어야 합니다.', 'bad');
      }
    });

    on(window, 'keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.code === 'Space') {
        this.spaceDown = true;
        e.preventDefault();
      }
    });
    on(window, 'keyup', (e) => {
      if (e.code === 'Space') this.spaceDown = false;
    });
  }
}

// -------------------------------------------------------------- drawing

function makeText(text: string, size: number, color: number): Text {
  const t = new Text({ text, style: { fontFamily: 'system-ui, sans-serif', fontSize: size, fill: color, fontWeight: '600' } });
  t.resolution = 2;
  return t;
}

function cellRect(a: Cell, b: Cell): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 };
}

function arrowPoints(cx: number, cy: number, dir: Dir, size: number): number[] {
  const [vx, vy] = DIR_VEC[dir];
  const px = -vy;
  const py = vx;
  return [
    cx + vx * size,
    cy + vy * size,
    cx - vx * size * 0.6 + px * size * 0.8,
    cy - vy * size * 0.6 + py * size * 0.8,
    cx - vx * size * 0.2,
    cy - vy * size * 0.2,
    cx - vx * size * 0.6 - px * size * 0.8,
    cy - vy * size * 0.6 - py * size * 0.8,
  ];
}

function drawBelt(g: Graphics, x: number, y: number, dir: Dir, fast: boolean, alpha: number, tint?: number): void {
  const px = x * TILE;
  const py = y * TILE;
  g.roundRect(px + 2, py + 2, TILE - 4, TILE - 4, 4).fill({ color: tint ?? 0x262b36, alpha });
  g.poly(arrowPoints(px + TILE / 2, py + TILE / 2, dir, 8)).fill({ color: tint ?? (fast ? 0x4b8cff : 0x5b6474), alpha });
}

function drawEntity(g: Graphics, e: Entity, alpha: number, labels: Container | null, tint?: number): void {
  const def = ENTITY_DEFS[e.type];
  const px = e.x * TILE;
  const py = e.y * TILE;
  const n = def.size;
  switch (e.type) {
    case 'belt':
    case 'fast_belt':
      drawBelt(g, e.x, e.y, e.dir, e.type === 'fast_belt', alpha, tint);
      return;
    case 'splitter':
    case 'merger':
    case 'tunnel_in':
    case 'tunnel_out': {
      const base = e.type === 'splitter' || e.type === 'merger' ? 0x3a3156 : 0x1e222b;
      g.roundRect(px + 2, py + 2, TILE - 4, TILE - 4, 6).fill({ color: tint ?? base, alpha }).stroke({ width: 1.5, color: tint ?? 0x7c6cf0, alpha });
      g.poly(arrowPoints(px + TILE / 2, py + TILE / 2, e.dir, 7)).fill({ color: tint ?? 0xb3a8ff, alpha });
      if (labels) {
        const t = makeText({ splitter: 'Y', merger: 'J', tunnel_in: 'U', tunnel_out: 'D' }[e.type], 9, 0xd6d0ff);
        t.position.set(px + 4, py + 2);
        labels.addChild(t);
      }
      return;
    }
  }
  const color = tint ?? MACHINE_COLORS[e.type] ?? 0x555555;
  g.roundRect(px + 3, py + 3, n * TILE - 6, n * TILE - 6, 7)
    .fill({ color, alpha: alpha * 0.9 })
    .stroke({ width: 2, color: 0xffffff, alpha: alpha * 0.25 });
  if (e.type !== 'hub') {
    for (const p of entityPorts(e.type, e.x, e.y, e.dir)) {
      const [vx, vy] = DIR_VEC[p.side];
      const cx = (p.x + 0.5 + vx * 0.38) * TILE;
      const cy = (p.y + 0.5 + vy * 0.38) * TILE;
      const d: Dir = p.kind === 'out' ? p.side : (({ N: 'S', S: 'N', E: 'W', W: 'E' }) as const)[p.side];
      g.poly(arrowPoints(cx, cy, d, 5)).fill({ color: p.kind === 'out' ? 0xffa94d : 0x4fd18b, alpha });
    }
  }
  if (labels) {
    const label = MACHINE_LABELS[e.type] ?? e.type;
    const recipe = e.recipe ? RECIPE_SHORT[e.recipe] : '';
    const text = n === 1 ? recipe || label : recipe ? `${label}\n${recipe}` : label;
    const t = makeText(text, n === 1 ? 9 : 11, 0xf3f4f6);
    t.anchor.set(0.5);
    t.position.set(px + (n * TILE) / 2, py + (n * TILE) / 2);
    t.style.align = 'center';
    labels.addChild(t);
  }
}
