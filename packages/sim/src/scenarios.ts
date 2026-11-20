import { applyPatch, type PatchOp } from './patch.ts';
import { World } from './world.ts';

/**
 * A small, deliberately under-built tier 1 line for the default seed:
 * two iron miners and one coal miner feed a single stone furnace, which
 * ships iron plates to the hub. Throughput is capped by the furnace.
 */
export const DEMO_OPS: PatchOp[] = [
  { op: 'place', type: 'miner', x: 8, y: 6, dir: 'E' },
  { op: 'place', type: 'miner', x: 8, y: 8, dir: 'E' },
  { op: 'belt_path', points: [[10, 6], [10, 10], [18, 10], [18, 11]], end_dir: 'S' },
  { op: 'place', type: 'miner', x: 33, y: 7, dir: 'W' },
  { op: 'belt_path', points: [[32, 8], [19, 8], [19, 11]], end_dir: 'S' },
  { op: 'place', type: 'stone_furnace', x: 18, y: 12, dir: 'S', recipe: 'iron_plate' },
  { op: 'belt_path', points: [[19, 14], [19, 17], [21, 17]], end_dir: 'E' },
];

export function createDemoWorld(seed = 1): World {
  const world = World.create({ seed });
  const res = applyPatch(world, DEMO_OPS);
  if (!res.ok) throw new Error(`demo layout failed: ${res.errors.map((e) => e.message).join('; ')}`);
  return world;
}
