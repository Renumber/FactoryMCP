import type { Dir, EntityType, ItemId, RecipeId } from './types.ts';

export const TICK_RATE = 20;
export const TICK_DT = 1 / TICK_RATE;

/** Power the hub supplies on its own, before any generator is built. */
export const HUB_BASE_POWER_KW = 1000;

export interface PortDef {
  /** Cell offset inside the footprint, in the east-facing orientation. */
  dx: number;
  dy: number;
  /** Side of that cell the port opens to, in the east-facing orientation. */
  side: Dir;
  kind: 'in' | 'out';
}

export type EntityCategory = 'transport' | 'machine' | 'power' | 'special';

export interface EntityDef {
  type: EntityType;
  name: string;
  category: EntityCategory;
  size: number;
  tier: number;
  powerKW: number;
  /** Tiles per second for transport entities. */
  speed?: number;
  /** Crafting speed multiplier for machines. */
  craftingSpeed?: number;
  /** Burner fuel: seconds of operation one coal provides. */
  fuelSecondsPerCoal?: number;
  /** Max underground distance for tunnel_in (cells between entrance and exit, exclusive). */
  maxGap?: number;
  recipes?: RecipeId[];
  ports: PortDef[];
  description: string;
}

export const ENTITY_DEFS: Record<EntityType, EntityDef> = {
  belt: {
    type: 'belt',
    name: '저속 벨트',
    category: 'transport',
    size: 1,
    tier: 1,
    powerKW: 0,
    speed: 1,
    ports: [],
    description: '60/m. Moves items toward dir. Accepts from back and both sides.',
  },
  fast_belt: {
    type: 'fast_belt',
    name: '고속 벨트',
    category: 'transport',
    size: 1,
    tier: 2,
    powerKW: 0,
    speed: 3,
    ports: [],
    description: '180/m. Moves items toward dir. Accepts from back and both sides.',
  },
  splitter: {
    type: 'splitter',
    name: '분배기',
    category: 'transport',
    size: 1,
    tier: 2,
    powerKW: 0,
    speed: 3,
    ports: [],
    description: 'Accepts from back, alternates output to its left and right sides (relative to dir). 180/m.',
  },
  merger: {
    type: 'merger',
    name: '합류기',
    category: 'transport',
    size: 1,
    tier: 2,
    powerKW: 0,
    speed: 3,
    ports: [],
    description: 'Accepts from back, left and right; outputs toward dir. 180/m.',
  },
  tunnel_in: {
    type: 'tunnel_in',
    name: '지하 터널 입구',
    category: 'transport',
    size: 1,
    tier: 2,
    powerKW: 0,
    speed: 3,
    maxGap: 4,
    ports: [],
    description:
      'Accepts from back only. Links to the nearest tunnel_out with the same dir within 4 cells ahead; items pass under anything in between. 180/m.',
  },
  tunnel_out: {
    type: 'tunnel_out',
    name: '지하 터널 출구',
    category: 'transport',
    size: 1,
    tier: 2,
    powerKW: 0,
    speed: 3,
    ports: [],
    description: 'Receives items from its linked tunnel_in and outputs toward dir.',
  },
  miner: {
    type: 'miner',
    name: '채굴기',
    category: 'machine',
    size: 2,
    tier: 1,
    powerKW: 60,
    ports: [{ dx: 1, dy: 0, side: 'E', kind: 'out' }],
    description: 'Must cover ore. 30/m on standard ore (x0.5 low, x2 high purity).',
  },
  stone_furnace: {
    type: 'stone_furnace',
    name: '석탄 용광로',
    category: 'machine',
    size: 2,
    tier: 1,
    powerKW: 0,
    craftingSpeed: 1,
    fuelSecondsPerCoal: 20,
    recipes: ['iron_plate', 'copper_plate'],
    ports: [
      { dx: 0, dy: 0, side: 'W', kind: 'in' },
      { dx: 0, dy: 1, side: 'W', kind: 'in' },
      { dx: 1, dy: 0, side: 'E', kind: 'out' },
    ],
    description: 'Burns coal (3/m while working). No power needed.',
  },
  electric_furnace: {
    type: 'electric_furnace',
    name: '전기 용광로',
    category: 'machine',
    size: 2,
    tier: 2,
    powerKW: 180,
    craftingSpeed: 1.5,
    recipes: ['iron_plate', 'copper_plate'],
    ports: [
      { dx: 0, dy: 0, side: 'W', kind: 'in' },
      { dx: 0, dy: 1, side: 'W', kind: 'in' },
      { dx: 1, dy: 0, side: 'E', kind: 'out' },
    ],
    description: 'No coal needed, 1.5x speed.',
  },
  assembler: {
    type: 'assembler',
    name: '소형 조립기',
    category: 'machine',
    size: 1,
    tier: 1,
    powerKW: 80,
    craftingSpeed: 1,
    recipes: ['iron_gear', 'copper_wire', 'basic_circuit', 'machine_part'],
    ports: [
      { dx: 0, dy: 0, side: 'W', kind: 'in' },
      { dx: 0, dy: 0, side: 'N', kind: 'in' },
      { dx: 0, dy: 0, side: 'S', kind: 'in' },
      { dx: 0, dy: 0, side: 'E', kind: 'out' },
    ],
    description: 'Inputs from back and both sides, output from front.',
  },
  coal_generator: {
    type: 'coal_generator',
    name: '석탄 화력발전기',
    category: 'power',
    size: 3,
    tier: 1,
    powerKW: 0,
    fuelSecondsPerCoal: 4,
    ports: [
      { dx: 0, dy: 1, side: 'W', kind: 'in' },
      { dx: 1, dy: 0, side: 'N', kind: 'in' },
      { dx: 1, dy: 2, side: 'S', kind: 'in' },
      { dx: 2, dy: 1, side: 'E', kind: 'in' },
    ],
    description: 'Adds 1.2 MW to the global grid. Burns up to 15 coal/m at full load.',
  },
  hub: {
    type: 'hub',
    name: '중앙 허브',
    category: 'special',
    size: 4,
    tier: 0,
    powerKW: 0,
    ports: [],
    description: 'Accepts any item from belts on any edge. Supplies 1 MW base power.',
  },
};

export const GENERATOR_OUTPUT_KW = 1200;

export interface RecipeDef {
  id: RecipeId;
  name: string;
  tier: number;
  /** Seconds per craft at crafting speed 1. */
  time: number;
  inputs: Partial<Record<ItemId, number>>;
  outputs: Partial<Record<ItemId, number>>;
}

export const RECIPES: Record<RecipeId, RecipeDef> = {
  iron_plate: { id: 'iron_plate', name: '철판', tier: 1, time: 2, inputs: { iron_ore: 1 }, outputs: { iron_plate: 1 } },
  copper_plate: {
    id: 'copper_plate',
    name: '구리판',
    tier: 1,
    time: 2,
    inputs: { copper_ore: 1 },
    outputs: { copper_plate: 1 },
  },
  iron_gear: { id: 'iron_gear', name: '철 기어', tier: 1, time: 3, inputs: { iron_plate: 2 }, outputs: { iron_gear: 1 } },
  copper_wire: {
    id: 'copper_wire',
    name: '구리 전선',
    tier: 1,
    time: 3,
    inputs: { copper_plate: 1 },
    outputs: { copper_wire: 2 },
  },
  basic_circuit: {
    id: 'basic_circuit',
    name: '기초 회로',
    tier: 1,
    time: 3,
    inputs: { iron_plate: 1, copper_wire: 3 },
    outputs: { basic_circuit: 1 },
  },
  machine_part: {
    id: 'machine_part',
    name: '기초 기계 부품',
    tier: 1,
    time: 6,
    inputs: { iron_plate: 2, iron_gear: 1 },
    outputs: { machine_part: 1 },
  },
};

export interface ItemDef {
  id: ItemId;
  name: string;
  color: number;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  iron_ore: { id: 'iron_ore', name: '철광석', color: 0x8fa3b8 },
  copper_ore: { id: 'copper_ore', name: '구리광석', color: 0xd9824a },
  coal: { id: 'coal', name: '석탄', color: 0x2b2b2b },
  iron_plate: { id: 'iron_plate', name: '철판', color: 0xcfd8e3 },
  copper_plate: { id: 'copper_plate', name: '구리판', color: 0xf0a868 },
  iron_gear: { id: 'iron_gear', name: '철 기어', color: 0x9aa7b5 },
  copper_wire: { id: 'copper_wire', name: '구리 전선', color: 0xffc46b },
  basic_circuit: { id: 'basic_circuit', name: '기초 회로', color: 0x4fd18b },
  machine_part: { id: 'machine_part', name: '기초 기계 부품', color: 0x6f8cff },
};

export interface TierGoal {
  tier: number;
  name: string;
  item: ItemId;
  amount: number;
}

/** Delivering `amount` of `item` to the hub while at `tier` unlocks tier + 1. */
export const TIER_GOALS: TierGoal[] = [
  { tier: 1, name: '기초 기계 부품 납품', item: 'machine_part', amount: 100 },
  { tier: 2, name: '기초 회로 대량 납품', item: 'basic_circuit', amount: 600 },
];

export const MAX_TIER = 3;
