import type { OreType, Rect } from './types.ts';

export const ORE_TYPES: OreType[] = ['iron_ore', 'copper_ore', 'coal'];

export type Purity = 0.5 | 1 | 2;

export interface OrePatch {
  id: number;
  ore: OreType;
  purity: Purity;
  cx: number;
  cy: number;
  radius: number;
}

export interface Terrain {
  width: number;
  height: number;
  /** 0 = none, otherwise index into ORE_TYPES + 1. */
  ore: Uint8Array;
  /** Patch id per cell, -1 when empty. */
  patch: Int16Array;
  patches: OrePatch[];
}

export const HUB_SIZE = 4;

export function hubOrigin(width: number, height: number): { x: number; y: number } {
  return { x: Math.floor(width / 2) - HUB_SIZE / 2, y: Math.floor(height / 2) - HUB_SIZE / 2 };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface PatchSpec {
  ore: OreType;
  purity: Purity;
  /** Position as a fraction of the map size. */
  fx: number;
  fy: number;
  radius: number;
}

const PATCH_LAYOUT: PatchSpec[] = [
  { ore: 'iron_ore', purity: 1, fx: 0.2, fy: 0.25, radius: 3.6 },
  { ore: 'copper_ore', purity: 1, fx: 0.2, fy: 0.75, radius: 3.6 },
  { ore: 'coal', purity: 1, fx: 0.72, fy: 0.22, radius: 3 },
  { ore: 'iron_ore', purity: 2, fx: 0.86, fy: 0.78, radius: 2.4 },
  { ore: 'copper_ore', purity: 0.5, fx: 0.62, fy: 0.84, radius: 3 },
  { ore: 'coal', purity: 0.5, fx: 0.08, fy: 0.5, radius: 2.2 },
];

/** Deterministic terrain: ore patch layout is fixed, the seed only jitters shapes. */
export function generateTerrain(seed: number, width: number, height: number): Terrain {
  const rand = mulberry32(seed);
  const ore = new Uint8Array(width * height);
  const patch = new Int16Array(width * height).fill(-1);
  const patches: OrePatch[] = [];
  const hub = hubOrigin(width, height);
  const hubRect: Rect = { x: hub.x - 2, y: hub.y - 2, w: HUB_SIZE + 4, h: HUB_SIZE + 4 };

  PATCH_LAYOUT.forEach((spec, id) => {
    const cx = Math.round(spec.fx * width + (rand() - 0.5) * 2);
    const cy = Math.round(spec.fy * height + (rand() - 0.5) * 2);
    const p: OrePatch = { id, ore: spec.ore, purity: spec.purity, cx, cy, radius: spec.radius };
    patches.push(p);
    const r = Math.ceil(spec.radius + 1);
    const phase = rand() * Math.PI * 2;
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        if (x >= hubRect.x && y >= hubRect.y && x < hubRect.x + hubRect.w && y < hubRect.y + hubRect.h) continue;
        const dx = x - cx;
        const dy = y - cy;
        const angle = Math.atan2(dy, dx);
        const wobble = 1 + 0.18 * Math.sin(angle * 3 + phase);
        if (Math.hypot(dx, dy) <= spec.radius * wobble) {
          const i = y * width + x;
          ore[i] = ORE_TYPES.indexOf(spec.ore) + 1;
          patch[i] = id;
        }
      }
    }
  });

  return { width, height, ore, patch, patches };
}

export function oreAt(t: Terrain, x: number, y: number): OreType | null {
  if (x < 0 || y < 0 || x >= t.width || y >= t.height) return null;
  const v = t.ore[y * t.width + x]!;
  return v === 0 ? null : ORE_TYPES[v - 1]!;
}

export function purityAt(t: Terrain, x: number, y: number): Purity | null {
  if (x < 0 || y < 0 || x >= t.width || y >= t.height) return null;
  const id = t.patch[y * t.width + x]!;
  return id < 0 ? null : t.patches[id]!.purity;
}
