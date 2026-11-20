import { ENTITY_DEFS } from './catalog.ts';
import type { Dir, Entity, EntityType, Rect } from './types.ts';

export const DIRS: Dir[] = ['E', 'S', 'W', 'N'];

export const DIR_VEC: Record<Dir, readonly [number, number]> = {
  N: [0, -1],
  E: [1, 0],
  S: [0, 1],
  W: [-1, 0],
};

export function opposite(d: Dir): Dir {
  return d === 'N' ? 'S' : d === 'S' ? 'N' : d === 'E' ? 'W' : 'E';
}

export function rotateCW(d: Dir, times = 1): Dir {
  const i = DIRS.indexOf(d);
  return DIRS[(i + times) % 4]!;
}

export function leftOf(d: Dir): Dir {
  return rotateCW(d, 3);
}

export function rightOf(d: Dir): Dir {
  return rotateCW(d, 1);
}

export function dirIndex(d: Dir): number {
  return DIRS.indexOf(d);
}

export function isDir(v: unknown): v is Dir {
  return v === 'N' || v === 'E' || v === 'S' || v === 'W';
}

export interface AbsPort {
  x: number;
  y: number;
  side: Dir;
  kind: 'in' | 'out';
}

/** Ports of an entity in absolute grid coordinates, honoring its rotation. */
export function entityPorts(type: EntityType, x: number, y: number, dir: Dir): AbsPort[] {
  const def = ENTITY_DEFS[type];
  const n = def.size;
  const turns = dirIndex(dir);
  return def.ports.map((p) => {
    let dx = p.dx;
    let dy = p.dy;
    for (let i = 0; i < turns; i++) {
      const nx = n - 1 - dy;
      dy = dx;
      dx = nx;
    }
    return { x: x + dx, y: y + dy, side: rotateCW(p.side, turns), kind: p.kind };
  });
}

export function footprint(e: Pick<Entity, 'type' | 'x' | 'y'>): Rect {
  const n = ENTITY_DEFS[e.type].size;
  return { x: e.x, y: e.y, w: n, h: n };
}

export function rectContains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h
  );
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function rectUnion(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function expandRect(r: Rect, by: number, bounds: { width: number; height: number }): Rect {
  const x = Math.max(0, r.x - by);
  const y = Math.max(0, r.y - by);
  return {
    x,
    y,
    w: Math.min(bounds.width, r.x + r.w + by) - x,
    h: Math.min(bounds.height, r.y + r.h + by) - y,
  };
}
