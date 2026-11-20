import { ENTITY_DEFS, RECIPES, TICK_RATE, TIER_GOALS } from './catalog.ts';
import { DIR_VEC, entityPorts, footprint, rectContainsRect, rectsIntersect } from './geometry.ts';
import { applyPatch, detectZonePorts, type PatchOp, type PatchResult } from './patch.ts';
import { oreAt, purityAt } from './terrain.ts';
import type { Dir, Entity, EntityStatus, EntityType, Inventory, ItemId, Rect, Zone } from './types.ts';
import { World } from './world.ts';

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

function addInv(inv: Inventory, item: ItemId, n: number): void {
  inv[item] = (inv[item] ?? 0) + n;
}

function roundInv(inv: Inventory): Inventory {
  const out: Inventory = {};
  for (const [k, v] of Object.entries(inv) as [ItemId, number][]) if (Math.abs(v) > 0.01) out[k] = round(v);
  return out;
}

export function producedItem(world: World, e: Entity): ItemId | null {
  if (e.type === 'miner') return world.minerOre(e.x, e.y)?.ore ?? null;
  if (!e.recipe) return null;
  return (Object.keys(RECIPES[e.recipe].outputs)[0] as ItemId | undefined) ?? null;
}

// ------------------------------------------------------------------ ascii

const BELT_CHARS: Record<Dir, string> = { E: '>', S: 'v', W: '<', N: '^' };
const FAST_CHARS: Record<Dir, string> = { E: '→', S: '↓', W: '←', N: '↑' };
const MACHINE_CHARS: Partial<Record<EntityType, string>> = {
  miner: 'M',
  stone_furnace: 'F',
  electric_furnace: 'E',
  assembler: 'A',
  coal_generator: 'G',
  hub: 'H',
};
const ORE_CHARS: Record<string, string> = { iron_ore: 'i', copper_ore: 'c', coal: 'k' };

export const ASCII_LEGEND = [
  'Empty: "." ground, "i" iron ore, "c" copper ore, "k" coal.',
  'Belts: > v < ^ (slow, 60/m), → ↓ ← ↑ (fast, 180/m). Arrow = direction of travel.',
  'Y splitter, J merger, U tunnel entrance, D tunnel exit.',
  'Machines fill their footprint: M miner, F stone furnace, E electric furnace, A assembler, G coal generator, H hub.',
  'A lowercase machine letter marks the cell that holds the machine output port.',
].join('\n');

function cellChar(world: World, x: number, y: number): string {
  const e = world.entityAt(x, y);
  if (!e) {
    const ore = oreAt(world.terrain, x, y);
    return ore ? ORE_CHARS[ore]! : '.';
  }
  switch (e.type) {
    case 'belt':
      return BELT_CHARS[e.dir];
    case 'fast_belt':
      return FAST_CHARS[e.dir];
    case 'splitter':
      return 'Y';
    case 'merger':
      return 'J';
    case 'tunnel_in':
      return 'U';
    case 'tunnel_out':
      return 'D';
    default: {
      const ch = MACHINE_CHARS[e.type] ?? '?';
      const isOut = entityPorts(e.type, e.x, e.y, e.dir).some((p) => p.kind === 'out' && p.x === x && p.y === y);
      return isOut ? ch.toLowerCase() : ch;
    }
  }
}

export function clampRect(world: World, r: Rect): Rect {
  const x = Math.max(0, Math.min(world.width, r.x));
  const y = Math.max(0, Math.min(world.height, r.y));
  return {
    x,
    y,
    w: Math.max(0, Math.min(world.width, r.x + r.w) - x),
    h: Math.max(0, Math.min(world.height, r.y + r.h) - y),
  };
}

/** Grid view with x coordinates on top and y on the left. */
export function renderAscii(world: World, rect?: Rect): string {
  const r = clampRect(world, rect ?? { x: 0, y: 0, w: world.width, h: world.height });
  const pad = String(r.y + r.h).length;
  const tens: string[] = [];
  const ones: string[] = [];
  for (let x = r.x; x < r.x + r.w; x++) {
    tens.push(x % 10 === 0 || x === r.x ? String(Math.floor(x / 10) % 10) : ' ');
    ones.push(String(x % 10));
  }
  const lines = [' '.repeat(pad + 1) + tens.join(''), ' '.repeat(pad + 1) + ones.join('')];
  for (let y = r.y; y < r.y + r.h; y++) {
    let row = String(y).padStart(pad) + ' ';
    for (let x = r.x; x < r.x + r.w; x++) row += cellChar(world, x, y);
    lines.push(row);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- inspect

export interface PortInfo {
  kind: 'in' | 'out';
  /** Machine cell holding the port. */
  cell: [number, number];
  side: Dir;
  /** Outside cell a belt must occupy to feed (in) or receive (out). */
  connect: [number, number];
  connectedTo: string | null;
}

export interface EntityInfo {
  id: number;
  type: EntityType;
  x: number;
  y: number;
  size: number;
  dir: Dir;
  recipe: string | null;
  status: EntityStatus;
  inputBuffer?: Inventory;
  outputBuffer?: Inventory;
  fuelSeconds?: number;
  items?: (ItemId | null)[];
  ore?: { ore: string; purity: number };
  tunnelPeer?: [number, number] | null;
  ports?: PortInfo[];
}

export function entityInfo(world: World, e: Entity): EntityInfo {
  const def = ENTITY_DEFS[e.type];
  const info: EntityInfo = {
    id: e.id,
    type: e.type,
    x: e.x,
    y: e.y,
    size: def.size,
    dir: e.dir,
    recipe: e.recipe,
    status: e.status,
  };
  if (def.category === 'transport') {
    info.items = e.slots.map((s) => s.item);
    if (e.type === 'tunnel_in' || e.type === 'tunnel_out') {
      const peer = world.tunnelPeerOf(e);
      info.tunnelPeer = peer ? [peer.x, peer.y] : null;
    }
    return info;
  }
  if (Object.keys(e.inv).length) info.inputBuffer = { ...e.inv };
  if (Object.keys(e.out).length) info.outputBuffer = { ...e.out };
  if (def.fuelSecondsPerCoal) info.fuelSeconds = round(e.fuel);
  if (e.type === 'miner') {
    const ore = world.minerOre(e.x, e.y);
    if (ore) info.ore = ore;
  }
  if (e.type !== 'hub') {
    info.ports = entityPorts(e.type, e.x, e.y, e.dir).map((p) => {
      const [vx, vy] = DIR_VEC[p.side];
      const cx = p.x + vx;
      const cy = p.y + vy;
      const other = world.entityAt(cx, cy);
      return {
        kind: p.kind,
        cell: [p.x, p.y],
        side: p.side,
        connect: [cx, cy],
        connectedTo: other ? `${other.type}#${other.id} facing ${other.dir}` : null,
      };
    });
  }
  return info;
}

export function entitiesIn(world: World, rect: Rect): Entity[] {
  return world.entities().filter((e) => rectsIntersect(rect, footprint(e)));
}

export interface InspectResult {
  rect: Rect;
  ascii: string;
  legend: string;
  entities: EntityInfo[];
  belts: { count: number; byStatus: Partial<Record<EntityStatus, number>> };
  ore: { ore: string; purity: number; cells: number }[];
}

/** Detailed view of a region. Belts are summarized unless `includeBelts` is set. */
export function inspect(world: World, rect: Rect, includeBelts = false): InspectResult {
  const r = clampRect(world, rect);
  const ents = entitiesIn(world, r);
  const byStatus: Partial<Record<EntityStatus, number>> = {};
  let beltCount = 0;
  const infos: EntityInfo[] = [];
  for (const e of ents) {
    const transport = ENTITY_DEFS[e.type].category === 'transport';
    const simple = e.type === 'belt' || e.type === 'fast_belt';
    if (transport) {
      beltCount++;
      byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
    }
    if (!simple || includeBelts) infos.push(entityInfo(world, e));
  }
  const ore = new Map<string, { ore: string; purity: number; cells: number }>();
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const o = oreAt(world.terrain, x, y);
      if (!o) continue;
      const p = purityAt(world.terrain, x, y) ?? 1;
      const key = `${o}:${p}`;
      const v = ore.get(key) ?? { ore: o, purity: p, cells: 0 };
      v.cells++;
      ore.set(key, v);
    }
  }
  return {
    rect: r,
    ascii: renderAscii(world, r),
    legend: ASCII_LEGEND,
    entities: infos,
    belts: { count: beltCount, byStatus },
    ore: [...ore.values()],
  };
}

// ---------------------------------------------------------------- measure

export interface MachineReport {
  id: number;
  type: EntityType;
  x: number;
  y: number;
  recipe: string | null;
  item: ItemId | null;
  outputPerMin: number;
  utilization: number;
  starved: number;
  blocked: number;
  noPower: number;
}

export interface PortReport {
  x: number;
  y: number;
  kind: 'in' | 'out';
  item: ItemId | null;
  perMin: number;
}

export interface Metrics {
  seconds: number;
  hubPerMin: Inventory;
  productionPerMin: Inventory;
  power: { avgDemandKW: number; capacityKW: number; minSatisfaction: number };
  machines: MachineReport[];
  ports: PortReport[];
  summary: {
    machineCount: number;
    beltCount: number;
    occupiedTiles: number;
    avgUtilization: number;
    bottlenecks: string[];
  };
}

export interface MeasureOptions {
  warmup?: number;
  seconds?: number;
  /** Restrict machine/belt reports to this area. Hub rates are always global. */
  rect?: Rect;
  zone?: Zone;
}

/** Runs a copy of the world forward and reports steady-state rates. */
export function measure(world: World, opts: MeasureOptions = {}): Metrics {
  const warmup = opts.warmup ?? 60;
  const seconds = opts.seconds ?? 60;
  const rect = opts.zone ?? opts.rect;
  const sim = world.clone();
  sim.run(warmup);

  const startDelivered = { ...sim.state.delivered };
  const startStats = new Map(sim.entities().map((e) => [e.id, { ...e.stats }]));
  const ports = rect ? (opts.zone?.ports ?? detectZonePorts(sim, rect)) : [];
  const portEntities = ports.map((p) => sim.entityAt(p.x, p.y));
  const lastItems = new Map<number, ItemId>();

  let demandSum = 0;
  let minSat = 1;
  const ticks = Math.round(seconds * TICK_RATE);
  for (let t = 0; t < ticks; t++) {
    sim.step();
    demandSum += sim.state.power.demandKW;
    minSat = Math.min(minSat, sim.state.power.satisfaction);
    for (const pe of portEntities) if (pe?.lastItem) lastItems.set(pe.id, pe.lastItem);
  }

  const perMin = (n: number) => (n / seconds) * 60;
  const hubPerMin: Inventory = {};
  for (const [item, n] of Object.entries(sim.state.delivered) as [ItemId, number][]) {
    const d = n - (startDelivered[item] ?? 0);
    if (d > 0) hubPerMin[item] = perMin(d);
  }

  const machines: MachineReport[] = [];
  const productionPerMin: Inventory = {};
  let beltCount = 0;
  let occupied = 0;
  for (const e of sim.entities()) {
    if (rect && !rectContainsRect(rect, footprint(e))) continue;
    const def = ENTITY_DEFS[e.type];
    occupied += def.size * def.size;
    if (def.category === 'transport') {
      beltCount++;
      continue;
    }
    if (e.type === 'hub' || e.type === 'coal_generator') continue;
    const s0 = startStats.get(e.id);
    const d = (k: keyof Entity['stats']) => e.stats[k] - (s0?.[k] ?? 0);
    const item = producedItem(sim, e);
    const out = perMin(d('produced'));
    if (item) addInv(productionPerMin, item, out);
    machines.push({
      id: e.id,
      type: e.type,
      x: e.x,
      y: e.y,
      recipe: e.recipe,
      item,
      outputPerMin: round(out),
      utilization: round(d('workingTicks') / ticks, 2),
      starved: round(d('starvedTicks') / ticks, 2),
      blocked: round(d('blockedTicks') / ticks, 2),
      noPower: round(d('noPowerTicks') / ticks, 2),
    });
  }

  const portReports: PortReport[] = ports.map((p, i) => {
    const pe = portEntities[i];
    let count = 0;
    if (pe) {
      const s0 = startStats.get(pe.id);
      const key = ENTITY_DEFS[pe.type].category === 'transport' ? 'moved' : 'produced';
      count = pe.stats[key] - (s0?.[key] ?? 0);
    }
    return { x: p.x, y: p.y, kind: p.kind, item: pe ? (lastItems.get(pe.id) ?? null) : null, perMin: round(perMin(count)) };
  });

  const bottlenecks: string[] = [];
  for (const m of machines) {
    const label = `${m.type}#${m.id}${m.recipe ? `(${m.recipe})` : ''} at (${m.x},${m.y})`;
    if (m.starved > 0.4) bottlenecks.push(`${label} starved ${Math.round(m.starved * 100)}% of the time`);
    else if (m.blocked > 0.4) bottlenecks.push(`${label} output blocked ${Math.round(m.blocked * 100)}% of the time`);
    else if (m.noPower > 0.2) bottlenecks.push(`${label} underpowered ${Math.round(m.noPower * 100)}% of the time`);
  }
  if (minSat < 1) bottlenecks.push(`power grid dipped to ${Math.round(minSat * 100)}% satisfaction`);

  return {
    seconds,
    hubPerMin: roundInv(hubPerMin),
    productionPerMin: roundInv(productionPerMin),
    power: { avgDemandKW: round(demandSum / ticks), capacityKW: sim.state.power.capacityKW, minSatisfaction: round(minSat, 2) },
    machines,
    ports: portReports,
    summary: {
      machineCount: machines.length,
      beltCount,
      occupiedTiles: occupied,
      avgUtilization: machines.length ? round(machines.reduce((a, m) => a + m.utilization, 0) / machines.length, 2) : 0,
      bottlenecks,
    },
  };
}

// --------------------------------------------------------- simulate_patch

export interface SimulatePatchOptions extends MeasureOptions {
  /** When false, the zone is only used for measurement and edits may leave it. Defaults to true. */
  enforceZone?: boolean;
}

export interface SimulatePatchResult extends PatchResult {
  before?: Metrics;
  after?: Metrics;
  delta?: { hubPerMin: Inventory; productionPerMin: Inventory; occupiedTiles: number; machineCount: number };
  ascii?: string;
  /** Ports whose throughput fell after the patch. */
  portRegressions?: string[];
}

function diffInv(a: Inventory, b: Inventory): Inventory {
  const out: Inventory = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as ItemId[]);
  for (const k of keys) {
    const d = (b[k] ?? 0) - (a[k] ?? 0);
    if (Math.abs(d) > 0.05) out[k] = round(d);
  }
  return out;
}

export function simulatePatch(world: World, ops: PatchOp[], opts: SimulatePatchOptions = {}): SimulatePatchResult & { world?: World } {
  const copy = world.clone();
  const result = applyPatch(copy, ops, { zone: opts.enforceZone === false ? undefined : opts.zone });
  if (!result.ok) return result;
  const before = measure(world, opts);
  const after = measure(copy, opts);
  const portRegressions: string[] = [];
  for (const p of before.ports) {
    const q = after.ports.find((a) => a.x === p.x && a.y === p.y);
    const now = q?.perMin ?? 0;
    if (now < p.perMin - 0.5) portRegressions.push(`${p.kind} port (${p.x},${p.y}) ${p.item ?? ''} ${p.perMin}/m -> ${now}/m`);
  }
  const view = opts.zone ?? opts.rect;
  return {
    ...result,
    before,
    after,
    delta: {
      hubPerMin: diffInv(before.hubPerMin, after.hubPerMin),
      productionPerMin: diffInv(before.productionPerMin, after.productionPerMin),
      occupiedTiles: after.summary.occupiedTiles - before.summary.occupiedTiles,
      machineCount: after.summary.machineCount - before.summary.machineCount,
    },
    ascii: renderAscii(copy, view),
    portRegressions,
    world: copy,
  };
}

// --------------------------------------------------------------- overview

export interface Overview {
  tick: number;
  seconds: number;
  map: { width: number; height: number };
  tier: number;
  goal: { item: ItemId; amount: number; delivered: number; name: string } | null;
  delivered: Inventory;
  hubPerMin: Inventory;
  power: World['state']['power'];
  entityCounts: Partial<Record<EntityType, number>>;
  statusCounts: Partial<Record<EntityStatus, number>>;
  hub: { x: number; y: number; size: number };
  orePatches: { id: number; ore: string; purity: number; center: [number, number]; bounds: Rect; freeCells: number }[];
  zones: { id: string; name: string; rect: Rect; ports: number }[];
}

export function overview(world: World): Overview {
  const s = world.state;
  const entityCounts: Partial<Record<EntityType, number>> = {};
  const statusCounts: Partial<Record<EntityStatus, number>> = {};
  for (const e of world.entities()) {
    entityCounts[e.type] = (entityCounts[e.type] ?? 0) + 1;
    if (ENTITY_DEFS[e.type].category !== 'transport' && e.type !== 'hub') {
      statusCounts[e.status] = (statusCounts[e.status] ?? 0) + 1;
    }
  }
  const goal = TIER_GOALS.find((g) => g.tier === s.tier);
  const hub = world.hub();
  const t = world.terrain;
  const orePatches = t.patches.map((p) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let free = 0;
    for (let y = 0; y < t.height; y++) {
      for (let x = 0; x < t.width; x++) {
        if (t.patch[y * t.width + x] !== p.id) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        if (!world.entityAt(x, y)) free++;
      }
    }
    return {
      id: p.id,
      ore: p.ore,
      purity: p.purity,
      center: [p.cx, p.cy] as [number, number],
      bounds: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
      freeCells: free,
    };
  });
  return {
    tick: s.tick,
    seconds: round(world.seconds),
    map: { width: s.width, height: s.height },
    tier: s.tier,
    goal: goal ? { item: goal.item, amount: goal.amount, delivered: s.delivered[goal.item] ?? 0, name: goal.name } : null,
    delivered: { ...s.delivered },
    hubPerMin: roundInv(world.deliveryRates()),
    power: { ...s.power },
    entityCounts,
    statusCounts,
    hub: { x: hub.x, y: hub.y, size: ENTITY_DEFS.hub.size },
    orePatches,
    zones: s.zones.map((z) => ({ id: z.id, name: z.name, rect: { x: z.x, y: z.y, w: z.w, h: z.h }, ports: z.ports.length })),
  };
}