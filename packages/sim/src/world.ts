import {
  ENTITY_DEFS,
  GENERATOR_OUTPUT_KW,
  HUB_BASE_POWER_KW,
  MAX_TIER,
  RECIPES,
  TICK_DT,
  TICK_RATE,
  TIER_GOALS,
} from './catalog.ts';
import { DIR_VEC, entityPorts, leftOf, opposite, rightOf } from './geometry.ts';
import { generateTerrain, hubOrigin, oreAt, purityAt, type Purity, type Terrain } from './terrain.ts';
import type {
  Dir,
  Entity,
  EntityType,
  Inventory,
  ItemId,
  OreType,
  RecipeId,
  WorldState,
} from './types.ts';

export const DEFAULT_WIDTH = 48;
export const DEFAULT_HEIGHT = 36;

const EPS = 1e-9;
const DELIVERY_WINDOW_SECONDS = 60;

export type PlaceErrorCode =
  | 'out_of_bounds'
  | 'occupied'
  | 'locked'
  | 'no_ore'
  | 'invalid_recipe'
  | 'unknown_type'
  | 'immutable';

export interface PlaceError {
  code: PlaceErrorCode;
  message: string;
  x: number;
  y: number;
}

export type PlaceResult = { ok: true; entity: Entity } | { ok: false; error: PlaceError };

export type WorldEvent = { type: 'tier_up'; tier: number };

export interface CreateWorldOptions {
  seed?: number;
  width?: number;
  height?: number;
  unlockAll?: boolean;
}

function emptyStats(): Entity['stats'] {
  return { produced: 0, moved: 0, workingTicks: 0, starvedTicks: 0, blockedTicks: 0, noPowerTicks: 0 };
}

function invCount(inv: Inventory, item: ItemId): number {
  return inv[item] ?? 0;
}

function invAdd(inv: Inventory, item: ItemId, n: number): void {
  const v = (inv[item] ?? 0) + n;
  if (v <= 0) delete inv[item];
  else inv[item] = v;
}

function isTransport(type: EntityType): boolean {
  return ENTITY_DEFS[type].category === 'transport';
}

export class World {
  state: WorldState;
  readonly terrain: Terrain;
  /** Increments whenever entities are added, removed, rotated or re-recipe'd. */
  topologyVersion = 0;
  readonly events: WorldEvent[] = [];

  private grid: Int32Array;
  private byId = new Map<number, Entity>();
  private order: Entity[] | null = null;
  private tunnelPeer = new Map<number, number>();

  private constructor(state: WorldState) {
    this.state = state;
    this.terrain = generateTerrain(state.seed, state.width, state.height);
    this.grid = new Int32Array(state.width * state.height);
    for (const e of state.entities) {
      this.byId.set(e.id, e);
      this.writeFootprint(e, e.id);
    }
  }

  static create(opts: CreateWorldOptions = {}): World {
    const width = opts.width ?? DEFAULT_WIDTH;
    const height = opts.height ?? DEFAULT_HEIGHT;
    const state: WorldState = {
      version: 1,
      seed: opts.seed ?? 1,
      width,
      height,
      tick: 0,
      nextId: 1,
      tier: 1,
      unlockAll: opts.unlockAll ?? false,
      entities: [],
      delivered: {},
      deliveryHistory: Array.from({ length: DELIVERY_WINDOW_SECONDS }, () => ({})),
      zones: [],
      notes: '',
      power: { demandKW: 0, supplyKW: 0, capacityKW: HUB_BASE_POWER_KW, satisfaction: 1 },
    };
    const world = new World(state);
    const hub = hubOrigin(width, height);
    world.insert('hub', hub.x, hub.y, 'E', null);
    return world;
  }

  static fromState(state: WorldState): World {
    return new World(JSON.parse(JSON.stringify(state)) as WorldState);
  }

  toState(): WorldState {
    return JSON.parse(JSON.stringify(this.state)) as WorldState;
  }

  clone(): World {
    return World.fromState(this.state);
  }

  get width(): number {
    return this.state.width;
  }

  get height(): number {
    return this.state.height;
  }

  get seconds(): number {
    return this.state.tick / TICK_RATE;
  }

  // ---------------------------------------------------------------- queries

  entities(): readonly Entity[] {
    return this.state.entities;
  }

  getEntity(id: number): Entity | undefined {
    return this.byId.get(id);
  }

  entityAt(x: number, y: number): Entity | undefined {
    if (!this.inBounds(x, y)) return undefined;
    const id = this.grid[y * this.width + x]!;
    return id === 0 ? undefined : this.byId.get(id);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  hub(): Entity {
    const hub = this.state.entities.find((e) => e.type === 'hub');
    if (!hub) throw new Error('world has no hub');
    return hub;
  }

  isUnlocked(type: EntityType): boolean {
    return this.state.unlockAll || ENTITY_DEFS[type].tier <= this.state.tier;
  }

  isRecipeUnlocked(recipe: RecipeId): boolean {
    return this.state.unlockAll || RECIPES[recipe].tier <= this.state.tier;
  }

  tunnelPeerOf(e: Entity): Entity | undefined {
    this.ensureTopology();
    const id = this.tunnelPeer.get(e.id);
    return id === undefined ? undefined : this.byId.get(id);
  }

  /** Ore type and purity a miner placed at (x, y) would extract. */
  minerOre(x: number, y: number): { ore: OreType; purity: Purity } | null {
    const size = ENTITY_DEFS.miner.size;
    const counts = new Map<OreType, { n: number; purity: Purity }>();
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const ore = oreAt(this.terrain, x + dx, y + dy);
        if (!ore) continue;
        const prev = counts.get(ore);
        counts.set(ore, { n: (prev?.n ?? 0) + 1, purity: purityAt(this.terrain, x + dx, y + dy) ?? 1 });
      }
    }
    let best: { ore: OreType; purity: Purity; n: number } | null = null;
    for (const [ore, v] of counts) if (!best || v.n > best.n) best = { ore, purity: v.purity, n: v.n };
    return best ? { ore: best.ore, purity: best.purity } : null;
  }

  /** Items delivered to the hub per minute, averaged over the last minute. */
  deliveryRates(): Inventory {
    const elapsed = Math.min(DELIVERY_WINDOW_SECONDS, Math.max(1, this.seconds));
    const totals: Inventory = {};
    for (const bucket of this.state.deliveryHistory) {
      for (const [item, n] of Object.entries(bucket) as [ItemId, number][]) invAdd(totals, item, n);
    }
    const rates: Inventory = {};
    for (const [item, n] of Object.entries(totals) as [ItemId, number][]) rates[item] = (n / elapsed) * 60;
    return rates;
  }

  // ------------------------------------------------------------ mutations

  checkPlace(type: EntityType, x: number, y: number, recipe: RecipeId | null = null): PlaceError | null {
    const def = ENTITY_DEFS[type];
    if (!def) return { code: 'unknown_type', message: `unknown entity type "${type}"`, x, y };
    if (type === 'hub') return { code: 'immutable', message: 'the hub cannot be placed', x, y };
    if (!this.isUnlocked(type)) {
      return { code: 'locked', message: `${type} unlocks at tier ${def.tier} (current tier ${this.state.tier})`, x, y };
    }
    for (let dy = 0; dy < def.size; dy++) {
      for (let dx = 0; dx < def.size; dx++) {
        const cx = x + dx;
        const cy = y + dy;
        if (!this.inBounds(cx, cy)) {
          return { code: 'out_of_bounds', message: `cell (${cx},${cy}) is outside the ${this.width}x${this.height} map`, x: cx, y: cy };
        }
        const other = this.entityAt(cx, cy);
        if (other) {
          return {
            code: 'occupied',
            message: `cell (${cx},${cy}) is occupied by ${other.type}#${other.id} at (${other.x},${other.y})`,
            x: cx,
            y: cy,
          };
        }
      }
    }
    if (type === 'miner' && !this.minerOre(x, y)) {
      return { code: 'no_ore', message: `miner at (${x},${y}) does not cover any ore`, x, y };
    }
    if (recipe !== null) {
      const err = this.checkRecipe(type, recipe, x, y);
      if (err) return err;
    }
    return null;
  }

  checkRecipe(type: EntityType, recipe: RecipeId, x: number, y: number): PlaceError | null {
    const def = ENTITY_DEFS[type];
    if (!RECIPES[recipe] || !def.recipes?.includes(recipe)) {
      return {
        code: 'invalid_recipe',
        message: `${type} cannot craft "${recipe}" (allowed: ${def.recipes?.join(', ') || 'none'})`,
        x,
        y,
      };
    }
    if (!this.isRecipeUnlocked(recipe)) {
      return { code: 'locked', message: `recipe ${recipe} unlocks at tier ${RECIPES[recipe].tier}`, x, y };
    }
    return null;
  }

  place(type: EntityType, x: number, y: number, dir: Dir = 'E', recipe: RecipeId | null = null): PlaceResult {
    const error = this.checkPlace(type, x, y, recipe);
    if (error) return { ok: false, error };
    return { ok: true, entity: this.insert(type, x, y, dir, recipe) };
  }

  remove(id: number): Entity | null {
    const e = this.byId.get(id);
    if (!e || e.type === 'hub') return null;
    this.writeFootprint(e, 0);
    this.byId.delete(id);
    const i = this.state.entities.indexOf(e);
    if (i >= 0) this.state.entities.splice(i, 1);
    this.invalidate();
    return e;
  }

  setRecipe(id: number, recipe: RecipeId | null): PlaceError | null {
    const e = this.byId.get(id);
    if (!e) return { code: 'unknown_type', message: `no entity #${id}`, x: 0, y: 0 };
    if (recipe !== null) {
      const err = this.checkRecipe(e.type, recipe, e.x, e.y);
      if (err) return err;
    }
    if (e.recipe !== recipe) {
      e.recipe = recipe;
      e.inv = e.inv.coal && ENTITY_DEFS[e.type].fuelSecondsPerCoal ? { coal: e.inv.coal } : {};
      e.craft = -1;
      this.invalidate();
    }
    return null;
  }

  rotate(id: number, dir: Dir): boolean {
    const e = this.byId.get(id);
    if (!e || e.type === 'hub') return false;
    e.dir = dir;
    this.invalidate();
    return true;
  }

  private insert(type: EntityType, x: number, y: number, dir: Dir, recipe: RecipeId | null): Entity {
    const e: Entity = {
      id: this.state.nextId++,
      type,
      x,
      y,
      dir,
      recipe,
      slots: isTransport(type) ? [{ item: null, progress: 0 }] : [],
      inv: {},
      out: {},
      craft: -1,
      fuel: 0,
      rr: 0,
      lastItem: null,
      status: 'idle',
      stats: emptyStats(),
    };
    this.state.entities.push(e);
    this.byId.set(e.id, e);
    this.writeFootprint(e, e.id);
    this.invalidate();
    return e;
  }

  private writeFootprint(e: Entity, value: number): void {
    const n = ENTITY_DEFS[e.type].size;
    for (let dy = 0; dy < n; dy++) {
      for (let dx = 0; dx < n; dx++) {
        const x = e.x + dx;
        const y = e.y + dy;
        if (this.inBounds(x, y)) this.grid[y * this.width + x] = value;
      }
    }
  }

  private invalidate(): void {
    this.order = null;
    this.topologyVersion++;
  }

  // ------------------------------------------------------------- topology

  private ensureTopology(): void {
    if (this.order) return;
    this.linkTunnels();
    this.order = this.computeOrder();
  }

  private linkTunnels(): void {
    this.tunnelPeer.clear();
    for (const e of this.state.entities) {
      if (e.type !== 'tunnel_in') continue;
      const [vx, vy] = DIR_VEC[e.dir];
      const maxGap = ENTITY_DEFS.tunnel_in.maxGap ?? 4;
      let linkedDistance = 0;
      for (let d = 1; d <= maxGap + 1; d++) {
        const other = this.entityAt(e.x + vx * d, e.y + vy * d);
        if (!other || other.dir !== e.dir) continue;
        if (other.type === 'tunnel_in') break;
        if (other.type === 'tunnel_out' && !this.tunnelPeer.has(other.id)) {
          this.tunnelPeer.set(e.id, other.id);
          this.tunnelPeer.set(other.id, e.id);
          linkedDistance = d;
          break;
        }
      }
      const length = Math.max(1, linkedDistance);
      if (e.slots.length > length) e.slots.length = length;
      while (e.slots.length < length) e.slots.push({ item: null, progress: 0 });
    }
  }

  private downstream(e: Entity): Entity[] {
    const out: Entity[] = [];
    const add = (x: number, y: number) => {
      const t = this.entityAt(x, y);
      if (t && t !== e) out.push(t);
    };
    switch (e.type) {
      case 'belt':
      case 'fast_belt':
      case 'merger':
      case 'tunnel_out': {
        const [vx, vy] = DIR_VEC[e.dir];
        add(e.x + vx, e.y + vy);
        break;
      }
      case 'splitter': {
        for (const side of [leftOf(e.dir), rightOf(e.dir)]) {
          const [vx, vy] = DIR_VEC[side];
          add(e.x + vx, e.y + vy);
        }
        break;
      }
      case 'tunnel_in': {
        const peer = this.tunnelPeer.get(e.id);
        const t = peer === undefined ? undefined : this.byId.get(peer);
        if (t) out.push(t);
        break;
      }
      default: {
        for (const p of entityPorts(e.type, e.x, e.y, e.dir)) {
          if (p.kind !== 'out') continue;
          const [vx, vy] = DIR_VEC[p.side];
          add(p.x + vx, p.y + vy);
        }
      }
    }
    return out;
  }

  /** Downstream-first order so a fully compressed line moves every tick. */
  private computeOrder(): Entity[] {
    const visited = new Set<number>();
    const order: Entity[] = [];
    for (const root of this.state.entities) {
      if (visited.has(root.id)) continue;
      const stack: { e: Entity; next: Entity[]; i: number }[] = [];
      visited.add(root.id);
      stack.push({ e: root, next: this.downstream(root), i: 0 });
      while (stack.length) {
        const top = stack[stack.length - 1]!;
        if (top.i < top.next.length) {
          const child = top.next[top.i++]!;
          if (!visited.has(child.id)) {
            visited.add(child.id);
            stack.push({ e: child, next: this.downstream(child), i: 0 });
          }
        } else {
          order.push(top.e);
          stack.pop();
        }
      }
    }
    return order;
  }

  // ------------------------------------------------------------ simulation

  run(seconds: number): void {
    const ticks = Math.round(seconds * TICK_RATE);
    for (let i = 0; i < ticks; i++) this.step();
  }

  step(): void {
    this.ensureTopology();
    const s = this.state;
    if (s.tick % TICK_RATE === 0) {
      s.deliveryHistory[Math.floor(s.tick / TICK_RATE) % DELIVERY_WINDOW_SECONDS] = {};
    }
    const factor = this.stepPower();
    for (const e of this.order!) {
      if (isTransport(e.type)) this.stepTransport(e);
      else if (e.type === 'coal_generator' || e.type === 'hub') continue;
      else this.stepMachine(e, factor);
    }
    s.tick++;
  }

  private stepPower(): number {
    let demand = 0;
    const gens: Entity[] = [];
    for (const e of this.state.entities) {
      const def = ENTITY_DEFS[e.type];
      if (def.powerKW > 0 && (e.status === 'working' || e.status === 'no_power')) demand += def.powerKW;
      if (e.type === 'coal_generator') {
        if (e.fuel > EPS || invCount(e.inv, 'coal') > 0) gens.push(e);
        else e.status = 'no_fuel';
      }
    }
    const genCapacity = gens.length * GENERATOR_OUTPUT_KW;
    const needed = Math.max(0, demand - HUB_BASE_POWER_KW);
    const load = genCapacity > 0 ? Math.min(1, needed / genCapacity) : 0;
    const fuelPerCoal = ENTITY_DEFS.coal_generator.fuelSecondsPerCoal ?? 4;
    for (const g of gens) {
      if (load <= 0) {
        g.status = 'idle';
        continue;
      }
      if (g.fuel <= EPS) {
        invAdd(g.inv, 'coal', -1);
        g.fuel += fuelPerCoal;
      }
      g.fuel -= TICK_DT * load;
      g.status = 'working';
      g.stats.workingTicks++;
    }
    const supply = HUB_BASE_POWER_KW + Math.min(needed, genCapacity);
    const satisfaction = demand <= 0 ? 1 : Math.min(1, supply / demand);
    this.state.power = { demandKW: demand, supplyKW: supply, capacityKW: HUB_BASE_POWER_KW + genCapacity, satisfaction };
    return satisfaction;
  }

  private stepTransport(e: Entity): void {
    const def = ENTITY_DEFS[e.type];
    const advance = (def.speed ?? 1) * TICK_DT;
    const last = e.slots.length - 1;
    if (e.type === 'tunnel_in' && !this.tunnelPeer.has(e.id)) e.status = 'unlinked';
    for (let i = last; i >= 0; i--) {
      const slot = e.slots[i]!;
      if (!slot.item) continue;
      slot.progress += advance;
      if (slot.progress < 1 - EPS) continue;
      const carry = Math.max(0, slot.progress - 1);
      if (i < last) {
        const next = e.slots[i + 1]!;
        if (!next.item) {
          next.item = slot.item;
          next.progress = carry;
          slot.item = null;
          slot.progress = 0;
        } else {
          slot.progress = 1;
        }
        continue;
      }
      const item = slot.item;
      if (this.transportOutput(e, item, carry)) {
        slot.item = null;
        slot.progress = 0;
        e.stats.moved++;
        e.lastItem = item;
      } else {
        slot.progress = 1;
      }
    }
    if (e.type !== 'tunnel_in' || this.tunnelPeer.has(e.id)) {
      const full = e.slots[last]!.item !== null && e.slots[last]!.progress >= 1 - EPS;
      e.status = full ? 'blocked' : e.slots.some((sl) => sl.item) ? 'working' : 'idle';
    }
  }

  private transportOutput(e: Entity, item: ItemId, carry: number): boolean {
    switch (e.type) {
      case 'tunnel_in': {
        const peer = this.tunnelPeer.get(e.id);
        const out = peer === undefined ? undefined : this.byId.get(peer);
        if (!out || out.slots[0]!.item) return false;
        out.slots[0] = { item, progress: carry };
        return true;
      }
      case 'splitter': {
        const sides = [leftOf(e.dir), rightOf(e.dir)];
        for (let k = 0; k < 2; k++) {
          const side = sides[(e.rr + k) % 2]!;
          if (this.pushToward(e.x, e.y, side, item, carry)) {
            e.rr = (e.rr + k + 1) % 2;
            return true;
          }
        }
        return false;
      }
      default:
        return this.pushToward(e.x, e.y, e.dir, item, carry);
    }
  }

  /** Push an item out of cell (x, y) through its `side` into the neighboring entity. */
  private pushToward(x: number, y: number, side: Dir, item: ItemId, carry: number): boolean {
    const [vx, vy] = DIR_VEC[side];
    const tx = x + vx;
    const ty = y + vy;
    const target = this.entityAt(tx, ty);
    if (!target) return false;
    return this.accept(target, item, tx, ty, opposite(side), carry);
  }

  /** Whether `target` takes `item` entering cell (cx, cy) through its `fromSide`. */
  accept(target: Entity, item: ItemId, cx: number, cy: number, fromSide: Dir, carry = 0): boolean {
    const t = target.type;
    if (isTransport(t)) {
      let allowed: boolean;
      if (t === 'splitter' || t === 'tunnel_in') allowed = fromSide === opposite(target.dir);
      else if (t === 'tunnel_out') allowed = false;
      else allowed = fromSide !== target.dir;
      if (!allowed) return false;
      const first = target.slots[0]!;
      if (first.item) return false;
      first.item = item;
      first.progress = carry;
      return true;
    }
    if (t === 'hub') {
      this.deliver(item);
      return true;
    }
    const port = entityPorts(t, target.x, target.y, target.dir).find(
      (p) => p.kind === 'in' && p.x === cx && p.y === cy && p.side === fromSide,
    );
    if (!port) return false;
    const def = ENTITY_DEFS[t];
    if (item === 'coal' && def.fuelSecondsPerCoal) {
      const cap = t === 'coal_generator' ? 10 : 4;
      if (invCount(target.inv, 'coal') >= cap) return false;
      invAdd(target.inv, 'coal', 1);
      return true;
    }
    const recipe = target.recipe ? RECIPES[target.recipe] : undefined;
    const need = recipe?.inputs[item];
    if (!need) return false;
    if (invCount(target.inv, item) >= need * 2 + 1) return false;
    invAdd(target.inv, item, 1);
    return true;
  }

  private deliver(item: ItemId): void {
    const s = this.state;
    invAdd(s.delivered, item, 1);
    const bucket = s.deliveryHistory[Math.floor(s.tick / TICK_RATE) % DELIVERY_WINDOW_SECONDS]!;
    invAdd(bucket, item, 1);
    const goal = TIER_GOALS.find((g) => g.tier === s.tier);
    if (goal && s.tier < MAX_TIER && invCount(s.delivered, goal.item) >= goal.amount) {
      s.tier++;
      this.events.push({ type: 'tier_up', tier: s.tier });
    }
  }

  private stepMachine(e: Entity, powerFactor: number): void {
    const def = ENTITY_DEFS[e.type];
    this.pushOutputs(e);

    let time: number;
    let inputs: Partial<Record<ItemId, number>>;
    let outputs: Partial<Record<ItemId, number>>;
    if (e.type === 'miner') {
      const ore = this.minerOre(e.x, e.y);
      if (!ore) {
        e.status = 'no_ore';
        return;
      }
      time = 2 / ore.purity;
      inputs = {};
      outputs = { [ore.ore]: 1 };
    } else {
      const recipe = e.recipe ? RECIPES[e.recipe] : undefined;
      if (!recipe) {
        e.status = 'no_recipe';
        return;
      }
      time = recipe.time;
      inputs = recipe.inputs;
      outputs = recipe.outputs;
    }

    const canStart = () => (Object.entries(inputs) as [ItemId, number][]).every(([item, n]) => invCount(e.inv, item) >= n);
    const consume = () => {
      for (const [item, n] of Object.entries(inputs) as [ItemId, number][]) invAdd(e.inv, item, -n);
    };
    const fits = () =>
      (Object.entries(outputs) as [ItemId, number][]).every(([item, n]) => invCount(e.out, item) + n <= n * 2 + 2);

    if (e.craft < 0) {
      if (!canStart()) {
        e.status = 'starved';
        e.stats.starvedTicks++;
        return;
      }
      consume();
      e.craft = 0;
    }

    if (e.craft >= time - EPS && !fits()) {
      e.status = 'blocked';
      e.stats.blockedTicks++;
      return;
    }

    const electric = def.powerKW > 0;
    let factor = 1;
    if (electric) {
      factor = powerFactor;
      if (factor <= EPS) {
        e.status = 'no_power';
        e.stats.noPowerTicks++;
        return;
      }
    }
    if (def.fuelSecondsPerCoal) {
      if (e.fuel <= EPS) {
        if (invCount(e.inv, 'coal') <= 0) {
          e.status = 'no_fuel';
          e.stats.starvedTicks++;
          return;
        }
        invAdd(e.inv, 'coal', -1);
        e.fuel += def.fuelSecondsPerCoal;
      }
    }

    const speed = (def.craftingSpeed ?? 1) * factor;
    e.craft += TICK_DT * speed;
    if (def.fuelSecondsPerCoal) e.fuel -= TICK_DT;
    e.status = 'working';
    e.stats.workingTicks++;
    if (factor < 1) e.stats.noPowerTicks++;

    if (e.craft >= time - EPS) {
      if (!fits()) {
        e.craft = time;
        e.status = 'blocked';
        return;
      }
      for (const [item, n] of Object.entries(outputs) as [ItemId, number][]) {
        invAdd(e.out, item, n);
        e.stats.produced += n;
      }
      const carry = Math.max(0, e.craft - time);
      if (canStart()) {
        consume();
        e.craft = carry;
      } else {
        e.craft = -1;
      }
      this.pushOutputs(e);
    }
  }

  private pushOutputs(e: Entity): void {
    const items = Object.keys(e.out) as ItemId[];
    if (items.length === 0) return;
    for (const p of entityPorts(e.type, e.x, e.y, e.dir)) {
      if (p.kind !== 'out') continue;
      const item = (Object.keys(e.out) as ItemId[])[0];
      if (!item) return;
      if (this.pushToward(p.x, p.y, p.side, item, 0)) {
        invAdd(e.out, item, -1);
        e.stats.moved++;
      }
    }
  }
}
