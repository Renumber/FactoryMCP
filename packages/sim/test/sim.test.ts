import { describe, expect, it } from 'vitest';
import {
  applyPatch,
  createDemoWorld,
  entityPorts,
  expandPath,
  makeZone,
  measure,
  renderAscii,
  simulatePatch,
  World,
  type PatchOp,
} from '../src/index.ts';

/** Two high-purity iron miners (60/m each) feeding one line into the hub. */
function feederOps(type: 'belt' | 'fast_belt', points: [number, number][], endDir: 'N' | 'E' | 'S' | 'W'): PatchOp[] {
  return [
    { op: 'place', type: 'miner', x: 41, y: 27 },
    { op: 'place', type: 'miner', x: 41, y: 29 },
    { op: 'belt_path', points, type, end_dir: endDir },
  ];
}

const HUB_PATH: [number, number][] = [
  [43, 29],
  [43, 24],
  [26, 24],
  [26, 17],
];

function expectOk(res: ReturnType<typeof applyPatch>) {
  expect(res.errors).toEqual([]);
  expect(res.ok).toBe(true);
}

describe('geometry', () => {
  it('rotates machine ports clockwise', () => {
    const east = entityPorts('stone_furnace', 0, 0, 'E');
    expect(east.find((p) => p.kind === 'out')).toMatchObject({ x: 1, y: 0, side: 'E' });
    const south = entityPorts('stone_furnace', 0, 0, 'S');
    expect(south.find((p) => p.kind === 'out')).toMatchObject({ x: 1, y: 1, side: 'S' });
    expect(south.filter((p) => p.kind === 'in').every((p) => p.side === 'N' && p.y === 0)).toBe(true);
    const west = entityPorts('miner', 0, 0, 'W');
    expect(west[0]).toMatchObject({ x: 0, y: 1, side: 'W' });
  });

  it('expands polylines and rejects diagonals', () => {
    const res = expandPath([
      [0, 0],
      [2, 0],
      [2, 1],
    ]);
    expect('cells' in res && res.cells.map((c) => c.dir).join('')).toBe('EESS');
    expect('error' in expandPath([[0, 0], [1, 1]])).toBe(true);
    expect('error' in expandPath([[0, 0], [2, 0], [2, 1], [1, 1], [1, 0]])).toBe(true);
  });
});

describe('transport', () => {
  it('caps a slow belt at 60/m', () => {
    const w = World.create({ unlockAll: true });
    expectOk(applyPatch(w, feederOps('belt', HUB_PATH, 'W')));
    expect(measure(w).hubPerMin.iron_ore).toBeCloseTo(60, 0);
  });

  it('carries 120/m on a fast belt', () => {
    const w = World.create({ unlockAll: true });
    expectOk(applyPatch(w, feederOps('fast_belt', HUB_PATH, 'W')));
    expect(measure(w).hubPerMin.iron_ore).toBeCloseTo(120, 0);
  });

  it('passes items through a tunnel under a crossing belt', () => {
    const w = World.create({ unlockAll: true });
    expectOk(applyPatch(w, feederOps('fast_belt', HUB_PATH, 'W')));
    expectOk(
      applyPatch(w, [
        { op: 'clear', x: 30, y: 24, w: 5, h: 1 },
        { op: 'place', type: 'tunnel_in', x: 34, y: 24, dir: 'W' },
        { op: 'place', type: 'tunnel_out', x: 30, y: 24, dir: 'W' },
        { op: 'place', type: 'belt', x: 32, y: 24, dir: 'N' },
      ]),
    );
    expect(w.tunnelPeerOf(w.entityAt(34, 24)!)?.id).toBe(w.entityAt(30, 24)!.id);
    expect(measure(w).hubPerMin.iron_ore).toBeCloseTo(120, 0);
  });

  it('splits evenly between both splitter outputs', () => {
    const w = World.create({ unlockAll: true });
    expectOk(
      applyPatch(w, [
        ...feederOps(
          'fast_belt',
          [
            [43, 29],
            [43, 12],
            [24, 12],
          ],
          'W',
        ),
        { op: 'place', type: 'fast_belt', x: 23, y: 12, dir: 'S' },
        { op: 'place', type: 'splitter', x: 23, y: 13, dir: 'S' },
        { op: 'belt_path', points: [[24, 13], [24, 15]], type: 'fast_belt' },
        { op: 'belt_path', points: [[22, 13], [22, 15]], type: 'fast_belt' },
      ]),
    );
    const m = measure(w, { rect: { x: 22, y: 13, w: 3, h: 3 } });
    expect(m.hubPerMin.iron_ore).toBeCloseTo(120, 0);
    const left = w.clone();
    left.run(120);
    const a = left.entityAt(24, 15)!.stats.moved;
    const b = left.entityAt(22, 15)!.stats.moved;
    expect(Math.abs(a - b)).toBeLessThanOrEqual(2);
  });
});

describe('production', () => {
  it('runs the demo line at the furnace limit', () => {
    const w = createDemoWorld();
    const m = measure(w);
    expect(m.hubPerMin.iron_plate).toBeCloseTo(30, 0);
    expect(m.summary.bottlenecks.some((b) => b.includes('blocked'))).toBe(true);
  });

  it('is deterministic across clones', () => {
    const a = createDemoWorld();
    const b = World.fromState(a.toState());
    a.run(30);
    b.run(30);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
  });

  it('browns out when demand exceeds supply', () => {
    const w = World.create({ unlockAll: true });
    for (let i = 0; i < 15; i++) {
      const res = w.place('assembler', 2 + i * 2, 2, 'E');
      expect(res.ok).toBe(true);
      if (res.ok) res.entity.status = 'working';
    }
    w.step();
    expect(w.state.power.demandKW).toBe(1200);
    expect(w.state.power.satisfaction).toBeCloseTo(1000 / 1200, 5);
  });

  it('advances tiers on delivery goals', () => {
    const w = World.create();
    const hub = w.hub();
    w.state.delivered.machine_part = 99;
    expect(w.accept(hub, 'machine_part', hub.x, hub.y, 'W')).toBe(true);
    expect(w.state.tier).toBe(2);
    expect(w.events).toEqual([{ type: 'tier_up', tier: 2 }]);
  });
});

describe('patch validation', () => {
  it('reports occupied cells, missing ore and locked tech', () => {
    const w = World.create();
    const hub = w.hub();
    expect(applyPatch(w.clone(), [{ op: 'place', type: 'belt', x: hub.x, y: hub.y }]).errors[0]?.code).toBe('occupied');
    expect(applyPatch(w.clone(), [{ op: 'place', type: 'miner', x: 0, y: 0 }]).errors[0]?.code).toBe('no_ore');
    expect(applyPatch(w.clone(), [{ op: 'place', type: 'fast_belt', x: 0, y: 0 }]).errors[0]?.code).toBe('locked');
    expect(applyPatch(w.clone(), [{ op: 'remove', x: hub.x, y: hub.y }]).errors[0]?.code).toBe('immutable');
  });

  it('stops at the first error and points at the failing op', () => {
    const w = World.create();
    const res = applyPatch(w, [
      { op: 'place', type: 'belt', x: 0, y: 0 },
      { op: 'place', type: 'belt', x: 0, y: 0 },
      { op: 'place', type: 'belt', x: 1, y: 0 },
    ]);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toMatchObject({ op: 1, code: 'occupied' });
    expect(w.entityAt(1, 0)).toBeUndefined();
  });

  it('locks zone ports and keeps edits inside the zone', () => {
    const w = createDemoWorld();
    const zone = makeZone(w, 'z1', 'smelting', { x: 17, y: 9, w: 4, h: 7 });
    expect(zone.ports.map((p) => `${p.kind}@${p.x},${p.y}`).sort()).toEqual(['in@17,10', 'in@19,9', 'out@19,15']);

    const outside = applyPatch(w.clone(), [{ op: 'remove', x: 10, y: 6 }], { zone });
    expect(outside.errors[0]?.code).toBe('outside_zone');

    const port = applyPatch(w.clone(), [{ op: 'remove', x: 17, y: 10 }], { zone });
    expect(port.errors[0]?.code).toBe('port_locked');

    const copy = w.clone();
    const cleared = applyPatch(copy, [{ op: 'clear', x: zone.x, y: zone.y, w: zone.w, h: zone.h }], { zone });
    expect(cleared.ok).toBe(true);
    expect(copy.entityAt(17, 10)?.type).toBe('belt');
    expect(copy.entityAt(18, 10)).toBeUndefined();
    expect(copy.entityAt(18, 12)).toBeUndefined();
  });

  it('simulates a patch without touching the original world', () => {
    const w = createDemoWorld();
    const before = renderAscii(w);
    const res = simulatePatch(w, [{ op: 'remove', x: 18, y: 12 }], { warmup: 20, seconds: 30 });
    expect(res.ok).toBe(true);
    expect(res.delta?.hubPerMin.iron_plate).toBeLessThan(-20);
    expect(renderAscii(w)).toBe(before);

    const bad = simulatePatch(w, [{ op: 'place', type: 'belt', x: 18, y: 12 }]);
    expect(bad.ok).toBe(false);
    expect(bad.before).toBeUndefined();
  });
});
