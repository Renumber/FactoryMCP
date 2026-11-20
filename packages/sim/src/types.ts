export type Dir = 'N' | 'E' | 'S' | 'W';

export type OreType = 'iron_ore' | 'copper_ore' | 'coal';

export type ItemId =
  | 'iron_ore'
  | 'copper_ore'
  | 'coal'
  | 'iron_plate'
  | 'copper_plate'
  | 'iron_gear'
  | 'copper_wire'
  | 'basic_circuit'
  | 'machine_part';

export type EntityType =
  | 'belt'
  | 'fast_belt'
  | 'splitter'
  | 'merger'
  | 'tunnel_in'
  | 'tunnel_out'
  | 'miner'
  | 'stone_furnace'
  | 'electric_furnace'
  | 'assembler'
  | 'coal_generator'
  | 'hub';

export type RecipeId =
  | 'iron_plate'
  | 'copper_plate'
  | 'iron_gear'
  | 'copper_wire'
  | 'basic_circuit'
  | 'machine_part';

export type Inventory = Partial<Record<ItemId, number>>;

export type EntityStatus =
  | 'working'
  | 'idle'
  | 'starved'
  | 'blocked'
  | 'no_power'
  | 'no_fuel'
  | 'no_recipe'
  | 'no_ore'
  | 'unlinked';

export interface Slot {
  item: ItemId | null;
  /** 0..1 progress across the current virtual tile. */
  progress: number;
}

export interface EntityStats {
  /** Items crafted / mined. */
  produced: number;
  /** Items pushed out of this entity. */
  moved: number;
  workingTicks: number;
  starvedTicks: number;
  blockedTicks: number;
  noPowerTicks: number;
}

export interface Entity {
  id: number;
  type: EntityType;
  /** Top-left cell of the footprint. */
  x: number;
  y: number;
  dir: Dir;
  recipe: RecipeId | null;
  slots: Slot[];
  inv: Inventory;
  out: Inventory;
  /** Seconds into the current craft, or -1 when idle. */
  craft: number;
  /** Seconds of burner fuel remaining. */
  fuel: number;
  /** Round-robin cursor for splitters. */
  rr: number;
  /** Last item type that moved through (transport only). */
  lastItem: ItemId | null;
  status: EntityStatus;
  stats: EntityStats;
}

export interface ZonePort {
  x: number;
  y: number;
  kind: 'in' | 'out';
}

export interface Zone {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  ports: ZonePort[];
}

export interface PowerState {
  demandKW: number;
  supplyKW: number;
  capacityKW: number;
  satisfaction: number;
}

export interface WorldState {
  version: 1;
  seed: number;
  width: number;
  height: number;
  tick: number;
  nextId: number;
  tier: number;
  unlockAll: boolean;
  entities: Entity[];
  delivered: Inventory;
  /** Per-second hub delivery buckets for the last 60 seconds (ring buffer). */
  deliveryHistory: Inventory[];
  zones: Zone[];
  notes: string;
  power: PowerState;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
