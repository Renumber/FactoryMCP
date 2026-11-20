import { ENTITY_DEFS } from './catalog.ts';
import { DIR_VEC, entityPorts, footprint, isDir, leftOf, rectContains, rectContainsRect, rightOf } from './geometry.ts';
import type { Dir, Entity, EntityType, Rect, RecipeId, Zone, ZonePort } from './types.ts';
import { World } from './world.ts';

export type PatchOp =
  | { op: 'place'; type: EntityType; x: number; y: number; dir?: Dir; recipe?: RecipeId | null }
  | { op: 'remove'; x: number; y: number }
  | { op: 'clear'; x: number; y: number; w: number; h: number }
  | { op: 'set_recipe'; x: number; y: number; recipe: RecipeId | null }
  | { op: 'rotate'; x: number; y: number; dir: Dir }
  | { op: 'belt_path'; points: [number, number][]; type?: 'belt' | 'fast_belt'; end_dir?: Dir };

export type PatchErrorCode =
  | 'invalid_op'
  | 'out_of_bounds'
  | 'occupied'
  | 'locked'
  | 'no_ore'
  | 'invalid_recipe'
  | 'unknown_type'
  | 'immutable'
  | 'not_found'
  | 'outside_zone'
  | 'port_locked'
  | 'invalid_path';

export interface PatchError {
  op: number;
  code: PatchErrorCode;
  message: string;
  x?: number;
  y?: number;
}

export interface EntitySummary {
  id: number;
  type: EntityType;
  x: number;
  y: number;
  dir: Dir;
  recipe: RecipeId | null;
}

export interface PatchChanges {
  added: EntitySummary[];
  removed: EntitySummary[];
  modified: EntitySummary[];
}

export interface PatchOptions {
  /** Restrict edits to this zone; its port cells are locked. */
  zone?: Zone;
}

export interface PatchResult {
  ok: boolean;
  errors: PatchError[];
  warnings: string[];
  changes: PatchChanges;
}

export function summarize(e: Entity): EntitySummary {
  return { id: e.id, type: e.type, x: e.x, y: e.y, dir: e.dir, recipe: e.recipe };
}

/** Cells where items leave an entity, paired with the cell they enter. */
export function entityLinks(world: World, e: Entity): { from: [number, number]; to: [number, number]; side: Dir }[] {
  const links: { from: [number, number]; to: [number, number]; side: Dir }[] = [];
  const add = (x: number, y: number, side: Dir) => {
    const [vx, vy] = DIR_VEC[side];
    links.push({ from: [x, y], to: [x + vx, y + vy], side });
  };
  switch (e.type) {
    case 'belt':
    case 'fast_belt':
    case 'merger':
    case 'tunnel_out':
      add(e.x, e.y, e.dir);
      break;
    case 'splitter':
      add(e.x, e.y, leftOf(e.dir));
      add(e.x, e.y, rightOf(e.dir));
      break;
    case 'tunnel_in': {
      const peer = world.tunnelPeerOf(e);
      if (peer) links.push({ from: [e.x, e.y], to: [peer.x, peer.y], side: e.dir });
      break;
    }
    default:
      for (const p of entityPorts(e.type, e.x, e.y, e.dir)) if (p.kind === 'out') add(p.x, p.y, p.side);
  }
  return links;
}

/**
 * Ports of a zone: cells inside the zone that exchange items with entities outside it.
 * Both sides must be occupied for a link to count.
 */
export function detectZonePorts(world: World, rect: Rect): ZonePort[] {
  const ports = new Map<string, ZonePort>();
  for (const e of world.entities()) {
    for (const link of entityLinks(world, e)) {
      const [fx, fy] = link.from;
      const [tx, ty] = link.to;
      const fromIn = rectContains(rect, fx, fy);
      const toIn = rectContains(rect, tx, ty);
      if (fromIn === toIn) continue;
      const target = world.entityAt(tx, ty);
      if (!target || target === e) continue;
      if (fromIn) ports.set(`${fx},${fy}`, { x: fx, y: fy, kind: 'out' });
      else ports.set(`${tx},${ty}`, { x: tx, y: ty, kind: 'in' });
    }
  }
  return [...ports.values()].sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Changed entities whose footprint is not fully inside `rect`. */
export function changesOutside(changes: PatchChanges, rect: Rect): EntitySummary[] {
  return [...changes.added, ...changes.removed, ...changes.modified].filter(
    (c) => !rectContainsRect(rect, footprint(c)),
  );
}

export function makeZone(world: World, id: string, name: string, rect: Rect): Zone {
  return { id, name, x: rect.x, y: rect.y, w: rect.w, h: rect.h, ports: detectZonePorts(world, rect) };
}

/** Cells covered by axis-aligned polyline segments, with the direction each cell faces. */
export function expandPath(
  points: [number, number][],
  endDir?: Dir,
): { cells: { x: number; y: number; dir: Dir }[] } | { error: string } {
  if (!Array.isArray(points) || points.length === 0) return { error: 'points must contain at least one [x, y]' };
  for (const p of points) {
    if (!Array.isArray(p) || p.length !== 2 || !Number.isInteger(p[0]) || !Number.isInteger(p[1])) {
      return { error: `invalid point ${JSON.stringify(p)}; expected [x, y] integers` };
    }
  }
  if (points.length === 1) {
    if (!endDir) return { error: 'a single-point path needs end_dir' };
    return { cells: [{ x: points[0]![0], y: points[0]![1], dir: endDir }] };
  }
  const cells: { x: number; y: number; dir: Dir }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i]!;
    const [bx, by] = points[i + 1]!;
    if (ax !== bx && ay !== by) return { error: `segment (${ax},${ay})->(${bx},${by}) is diagonal; add a corner point` };
    if (ax === bx && ay === by) return { error: `duplicate point (${ax},${ay})` };
    const dir: Dir = bx > ax ? 'E' : bx < ax ? 'W' : by > ay ? 'S' : 'N';
    const [vx, vy] = DIR_VEC[dir];
    let x = ax;
    let y = ay;
    while (x !== bx || y !== by) {
      cells.push({ x, y, dir });
      x += vx;
      y += vy;
    }
  }
  const last = points[points.length - 1]!;
  cells.push({ x: last[0], y: last[1], dir: endDir ?? cells[cells.length - 1]!.dir });
  const seen = new Set<string>();
  for (const c of cells) {
    const key = `${c.x},${c.y}`;
    if (seen.has(key)) return { error: `path crosses itself at (${c.x},${c.y}); use a tunnel` };
    seen.add(key);
  }
  return { cells };
}

/** Apply ops in order, mutating `world`. Stops at the first error. */
export function applyPatch(world: World, ops: PatchOp[], opts: PatchOptions = {}): PatchResult {
  const errors: PatchError[] = [];
  const warnings: string[] = [];
  const added = new Map<number, Entity>();
  const removed = new Map<number, EntitySummary>();
  const modified = new Map<number, Entity>();
  const zone = opts.zone;
  const lockedCells = new Set((zone?.ports ?? []).map((p) => `${p.x},${p.y}`));

  const isLocked = (e: Entity) => {
    const r = footprint(e);
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (lockedCells.has(`${x},${y}`)) return true;
    return false;
  };

  const checkZone = (i: number, r: Rect): boolean => {
    if (zone && !rectContainsRect(zone, r)) {
      errors.push({
        op: i,
        code: 'outside_zone',
        message: `area (${r.x},${r.y}) ${r.w}x${r.h} is outside zone "${zone.name}" (${zone.x},${zone.y}) ${zone.w}x${zone.h}`,
        x: r.x,
        y: r.y,
      });
      return false;
    }
    return true;
  };

  const editable = (i: number, e: Entity | undefined, x: number, y: number): e is Entity => {
    if (!e) {
      errors.push({ op: i, code: 'not_found', message: `no entity at (${x},${y})`, x, y });
      return false;
    }
    if (e.type === 'hub') {
      errors.push({ op: i, code: 'immutable', message: 'the hub cannot be modified', x, y });
      return false;
    }
    if (!checkZone(i, footprint(e))) return false;
    if (isLocked(e)) {
      errors.push({
        op: i,
        code: 'port_locked',
        message: `${e.type}#${e.id} at (${e.x},${e.y}) is a zone port and is locked`,
        x,
        y,
      });
      return false;
    }
    return true;
  };

  const doRemove = (e: Entity) => {
    world.remove(e.id);
    if (added.has(e.id)) added.delete(e.id);
    else removed.set(e.id, summarize(e));
    modified.delete(e.id);
  };

  const doPlace = (i: number, type: EntityType, x: number, y: number, dir: Dir, recipe: RecipeId | null): boolean => {
    const def = ENTITY_DEFS[type];
    if (!def) {
      errors.push({ op: i, code: 'unknown_type', message: `unknown entity type "${type}"`, x, y });
      return false;
    }
    if (!checkZone(i, { x, y, w: def.size, h: def.size })) return false;
    const res = world.place(type, x, y, dir, recipe);
    if (!res.ok) {
      errors.push({ op: i, code: res.error.code, message: res.error.message, x: res.error.x, y: res.error.y });
      return false;
    }
    added.set(res.entity.id, res.entity);
    if (def.recipes && !recipe) warnings.push(`op ${i}: ${type} at (${x},${y}) has no recipe`);
    return true;
  };

  for (let i = 0; i < ops.length && errors.length === 0; i++) {
    const op = ops[i] as PatchOp;
    switch (op?.op) {
      case 'place': {
        const dir = op.dir ?? 'E';
        if (!isDir(dir)) {
          errors.push({ op: i, code: 'invalid_op', message: `invalid dir "${dir}"` });
          break;
        }
        doPlace(i, op.type, op.x, op.y, dir, op.recipe ?? null);
        break;
      }
      case 'remove': {
        const e = world.entityAt(op.x, op.y);
        if (editable(i, e, op.x, op.y)) doRemove(e);
        break;
      }
      case 'clear': {
        const r: Rect = { x: op.x, y: op.y, w: op.w, h: op.h };
        if (!checkZone(i, r)) break;
        const victims = new Set<Entity>();
        for (let y = r.y; y < r.y + r.h; y++) {
          for (let x = r.x; x < r.x + r.w; x++) {
            const e = world.entityAt(x, y);
            if (e) victims.add(e);
          }
        }
        for (const e of victims) {
          if (e.type === 'hub') continue;
          if (!rectContainsRect(r, footprint(e)) || (zone && !rectContainsRect(zone, footprint(e)))) {
            warnings.push(`op ${i}: kept ${e.type}#${e.id} at (${e.x},${e.y}); it extends outside the cleared area`);
            continue;
          }
          if (isLocked(e)) {
            warnings.push(`op ${i}: kept zone port ${e.type} at (${e.x},${e.y})`);
            continue;
          }
          doRemove(e);
        }
        break;
      }
      case 'set_recipe': {
        const e = world.entityAt(op.x, op.y);
        if (!editable(i, e, op.x, op.y)) break;
        const err = world.setRecipe(e.id, op.recipe);
        if (err) errors.push({ op: i, code: err.code, message: err.message, x: op.x, y: op.y });
        else if (!added.has(e.id)) modified.set(e.id, e);
        break;
      }
      case 'rotate': {
        const e = world.entityAt(op.x, op.y);
        if (!isDir(op.dir)) {
          errors.push({ op: i, code: 'invalid_op', message: `invalid dir "${String(op.dir)}"` });
          break;
        }
        if (!editable(i, e, op.x, op.y)) break;
        world.rotate(e.id, op.dir);
        if (!added.has(e.id)) modified.set(e.id, e);
        break;
      }
      case 'belt_path': {
        const type = op.type ?? 'belt';
        if (type !== 'belt' && type !== 'fast_belt') {
          errors.push({ op: i, code: 'invalid_op', message: 'belt_path type must be belt or fast_belt' });
          break;
        }
        if (op.end_dir !== undefined && !isDir(op.end_dir)) {
          errors.push({ op: i, code: 'invalid_op', message: `invalid end_dir "${String(op.end_dir)}"` });
          break;
        }
        const path = expandPath(op.points, op.end_dir);
        if ('error' in path) {
          errors.push({ op: i, code: 'invalid_path', message: path.error });
          break;
        }
        for (const c of path.cells) if (!doPlace(i, type, c.x, c.y, c.dir, null)) break;
        break;
      }
      default:
        errors.push({ op: i, code: 'invalid_op', message: `unknown op ${JSON.stringify((op as { op?: unknown })?.op)}` });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    changes: {
      added: [...added.values()].map(summarize),
      removed: [...removed.values()],
      modified: [...modified.values()].map(summarize),
    },
  };
}

/** Apply to a copy; the original world is untouched. */
export function tryPatch(world: World, ops: PatchOp[], opts: PatchOptions = {}): { result: PatchResult; world: World } {
  const copy = world.clone();
  return { result: applyPatch(copy, ops, opts), world: copy };
}
