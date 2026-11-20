import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ENTITY_DEFS,
  RECIPES,
  TIER_GOALS,
  ASCII_LEGEND,
  inspect,
  makeZone,
  measure,
  overview,
  renderAscii,
  simulatePatch,
  World,
  type EntityType,
  type PatchOp,
  type RecipeId,
  type RefactorPlan,
  type Zone,
} from '@factorymcp/sim';
import { z } from 'zod';
import type { SessionBridge } from './bridge.ts';
import { GAME_RULES, SERVER_INSTRUCTIONS } from './rules.ts';

const dir = z.enum(['N', 'E', 'S', 'W']);
const entityType = z.enum(Object.keys(ENTITY_DEFS).filter((t) => t !== 'hub') as [EntityType, ...EntityType[]]);
const recipe = z.enum(Object.keys(RECIPES) as [RecipeId, ...RecipeId[]]);
const point = z.tuple([z.number().int(), z.number().int()]);

const opSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('place'), type: entityType, x: z.number().int(), y: z.number().int(), dir: dir.optional(), recipe: recipe.nullish() }),
  z.object({ op: z.literal('remove'), x: z.number().int(), y: z.number().int() }),
  z.object({
    op: z.literal('clear'),
    x: z.number().int(),
    y: z.number().int(),
    w: z.number().int().positive(),
    h: z.number().int().positive(),
  }),
  z.object({ op: z.literal('set_recipe'), x: z.number().int(), y: z.number().int(), recipe: recipe.nullable() }),
  z.object({ op: z.literal('rotate'), x: z.number().int(), y: z.number().int(), dir }),
  z.object({
    op: z.literal('belt_path'),
    points: z.array(point).min(1),
    type: z.enum(['belt', 'fast_belt']).optional(),
    end_dir: dir.optional(),
  }),
]);

const opsSchema = z.array(opSchema).min(1).max(400).describe('Patch ops applied in order. See get_rules_and_recipes.');
const rectShape = {
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().positive().max(64),
  h: z.number().int().positive().max(64),
};
const zoneId = z.string().optional().describe('Restrict edits to this player-marked zone and lock its ports.');

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const json = (v: unknown) => JSON.stringify(v, null, 1);

function text(...parts: string[]): ToolResult {
  return { content: parts.map((t) => ({ type: 'text' as const, text: t })) };
}

function fail(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export function createMcpServer(bridge: SessionBridge, token: string | null): McpServer {
  const server = new McpServer({ name: 'factorymcp', version: '0.1.0' }, { instructions: SERVER_INSTRUCTIONS });

  const session = () => {
    const id = bridge.resolveSession(token);
    if (!id) throw new Error('No game session. Use the MCP URL shown in the game (it carries ?session=...).');
    return id;
  };

  const loadWorld = async () => {
    const sessionId = session();
    const state = await bridge.call(sessionId, 'snapshot', {});
    return { sessionId, world: World.fromState(state) };
  };

  const findZone = (world: World, id: string | undefined): Zone | undefined => {
    if (!id) return undefined;
    const z = world.state.zones.find((zz) => zz.id === id || zz.name === id);
    if (!z) throw new Error(`zone "${id}" not found. Zones: ${world.state.zones.map((zz) => `${zz.id} (${zz.name})`).join(', ') || 'none'}`);
    return makeZone(world, z.id, z.name, z);
  };

  /** Runs a handler with session lookup, error reporting and an in-game activity log. */
  const tool = <A>(name: string, summarize: (args: A) => string, handler: (args: A) => Promise<ToolResult>) => {
    return async (args: A): Promise<ToolResult> => {
      let result: ToolResult;
      try {
        result = await handler(args);
      } catch (err) {
        result = fail(err instanceof Error ? err.message : String(err));
      }
      const sessionId = bridge.resolveSession(token);
      if (sessionId) {
        bridge.log(sessionId, { at: Date.now(), tool: name, summary: summarize(args), ok: !result.isError });
      }
      return result;
    };
  };

  server.registerTool(
    'get_overview',
    {
      title: 'Factory overview',
      description: 'Tier goal, hub delivery totals and rates, power, entity counts, ore patches and zones.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    tool('get_overview', () => '공장 현황 조회', async () => {
      const { world } = await loadWorld();
      return text(json({ ...overview(world), notes: world.state.notes || undefined }));
    }),
  );

  server.registerTool(
    'get_rules_and_recipes',
    {
      title: 'Rules, buildings and recipes',
      description: 'Game rules, patch op syntax, every building (with ports, tier, power) and recipe. Read once per conversation.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    tool('get_rules_and_recipes', () => '규칙·레시피 조회', async () => {
      const { world } = await loadWorld();
      const buildings = Object.values(ENTITY_DEFS)
        .filter((d) => d.type !== 'hub')
        .map((d) => ({
          type: d.type,
          name: d.name,
          size: d.size,
          tier: d.tier,
          unlocked: world.isUnlocked(d.type),
          powerKW: d.powerKW || undefined,
          craftingSpeed: d.craftingSpeed,
          recipes: d.recipes,
          ports: d.ports.length ? d.ports : undefined,
          description: d.description,
        }));
      const recipes = Object.values(RECIPES).map((r) => ({
        ...r,
        unlocked: world.isRecipeUnlocked(r.id),
        perMinuteAtSpeed1: { inputs: scale(r.inputs, 60 / r.time), outputs: scale(r.outputs, 60 / r.time) },
      }));
      return text(GAME_RULES, json({ tier: world.state.tier, tierGoals: TIER_GOALS, buildings, recipes }));
    }),
  );

  server.registerTool(
    'get_map',
    {
      title: 'ASCII map',
      description: `ASCII view of the whole map or a rectangle. ${ASCII_LEGEND}`,
      inputSchema: { x: z.number().int().optional(), y: z.number().int().optional(), w: z.number().int().optional(), h: z.number().int().optional() },
      annotations: { readOnlyHint: true },
    },
    tool('get_map', () => '지도 조회', async (a: { x?: number; y?: number; w?: number; h?: number }) => {
      const { world } = await loadWorld();
      const rect = { x: a.x ?? 0, y: a.y ?? 0, w: a.w ?? world.width, h: a.h ?? world.height };
      return text(renderAscii(world, rect), ASCII_LEGEND);
    }),
  );

  server.registerTool(
    'inspect_region',
    {
      title: 'Inspect region',
      description: 'ASCII plus every machine in a rectangle with status, buffers and absolute ports. Plain belts are summarized unless include_belts.',
      inputSchema: { ...rectShape, include_belts: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    tool('inspect_region', (a) => `영역 조사 (${a.x},${a.y}) ${a.w}x${a.h}`, async (a: { x: number; y: number; w: number; h: number; include_belts?: boolean }) => {
      const { world } = await loadWorld();
      const res = inspect(world, a, a.include_belts);
      return text(res.ascii, json({ ...res, ascii: undefined, legend: undefined }));
    }),
  );

  server.registerTool(
    'inspect_zone',
    {
      title: 'Inspect zone',
      description: 'Like inspect_region for a player-marked zone, plus its locked ports and a 60s throughput measurement.',
      inputSchema: { zone_id: z.string(), include_belts: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    tool('inspect_zone', (a) => `구역 조사: ${a.zone_id}`, async (a: { zone_id: string; include_belts?: boolean }) => {
      const { world } = await loadWorld();
      const zone = findZone(world, a.zone_id)!;
      const res = inspect(world, zone, a.include_belts);
      const metrics = measure(world, { zone, warmup: 30, seconds: 60 });
      return text(res.ascii, json({ zone, ...res, ascii: undefined, legend: undefined, metrics }));
    }),
  );

  server.registerTool(
    'measure',
    {
      title: 'Measure production',
      description: 'Simulate a copy of the factory forward and report steady-state rates, machine utilization and bottlenecks.',
      inputSchema: {
        zone_id: zoneId,
        x: z.number().int().optional(),
        y: z.number().int().optional(),
        w: z.number().int().optional(),
        h: z.number().int().optional(),
        seconds: z.number().int().min(10).max(600).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    tool('measure', () => '생산량 측정', async (a: { zone_id?: string; x?: number; y?: number; w?: number; h?: number; seconds?: number }) => {
      const { world } = await loadWorld();
      const zone = findZone(world, a.zone_id);
      const rect = a.x !== undefined && a.y !== undefined && a.w && a.h ? { x: a.x, y: a.y, w: a.w, h: a.h } : undefined;
      return text(json(measure(world, { zone, rect, seconds: a.seconds })));
    }),
  );

  server.registerTool(
    'simulate_patch',
    {
      title: 'Simulate patch',
      description:
        'Validate and simulate patch ops on a copy of the factory. Returns the first error (op index, code, cell) or before/after metrics, deltas and the resulting ASCII. Nothing changes in the game.',
      inputSchema: { ops: opsSchema, zone_id: zoneId, seconds: z.number().int().min(10).max(300).optional() },
      annotations: { readOnlyHint: true },
    },
    tool('simulate_patch', (a) => `패치 시뮬레이션 (${a.ops.length} ops)`, async (a: { ops: PatchOp[]; zone_id?: string; seconds?: number }) => {
      const { world } = await loadWorld();
      const zone = findZone(world, a.zone_id);
      const res = simulatePatch(world, a.ops, { zone, seconds: a.seconds });
      if (!res.ok) return text(json({ ok: false, errors: res.errors, warnings: res.warnings }));
      const { ascii, world: _w, ...rest } = res;
      return text(ascii ?? '', json(rest));
    }),
  );

  server.registerTool(
    'propose_refactor',
    {
      title: 'Propose refactor',
      description:
        'Send a validated patch to the game as a ghost preview with before/after numbers. The player approves or rejects it in-game. Use simulate_patch first.',
      inputSchema: {
        title: z.string().max(80),
        rationale: z.string().max(2000).describe('Why this layout, what it improves, trade-offs and prerequisites.'),
        ops: opsSchema,
        zone_id: zoneId,
      },
    },
    tool('propose_refactor', (a) => `제안: ${a.title}`, async (a: { title: string; rationale: string; ops: PatchOp[]; zone_id?: string }) => {
      const { sessionId, world } = await loadWorld();
      const zone = findZone(world, a.zone_id);
      const res = simulatePatch(world, a.ops, { zone });
      if (!res.ok) return text(json({ ok: false, errors: res.errors, hint: 'Fix the patch with simulate_patch first.' }));
      const plan: RefactorPlan = {
        id: randomUUID().slice(0, 8),
        title: a.title,
        rationale: a.rationale,
        ops: a.ops,
        zoneId: zone?.id ?? null,
        createdAt: Date.now(),
        status: 'pending',
        changes: res.changes,
        before: res.before,
        after: res.after,
        delta: res.delta,
        warnings: res.warnings,
        portRegressions: res.portRegressions ?? [],
      };
      bridge.savePlan(sessionId, plan);
      await bridge.call(sessionId, 'show_plan', { plan });
      return text(
        json({
          ok: true,
          planId: plan.id,
          status: 'pending',
          message: 'The player is reviewing the ghost preview. Check list_plans later for the decision.',
          delta: plan.delta,
          portRegressions: plan.portRegressions,
          warnings: plan.warnings,
        }),
      );
    }),
  );

  server.registerTool(
    'list_plans',
    {
      title: 'List plans',
      description: 'Plans proposed in this session and whether the player applied or rejected them.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    tool('list_plans', () => '제안 목록 조회', async () => {
      const plans = bridge.plans(session()).map((p) => ({
        id: p.id,
        title: p.title,
        status: p.status,
        statusMessage: p.statusMessage,
        zoneId: p.zoneId,
        delta: p.delta,
        createdAt: new Date(p.createdAt).toISOString(),
      }));
      return text(json(plans));
    }),
  );

  server.registerTool(
    'execute_actions',
    {
      title: 'Execute actions directly',
      description:
        'Apply small patch ops immediately, without a preview. Only works when the player enabled direct execution in-game; otherwise use propose_refactor.',
      inputSchema: { ops: opsSchema, reason: z.string().max(300) },
      annotations: { destructiveHint: true },
    },
    tool('execute_actions', (a) => `직접 실행: ${a.reason}`, async (a: { ops: PatchOp[]; reason: string }) => {
      const sessionId = session();
      const res = await bridge.call(sessionId, 'apply_patch', { ops: a.ops, reason: a.reason });
      return res.ok ? text(json(res)) : { ...text(json(res)), isError: true };
    }),
  );

  server.registerTool(
    'set_simulation_speed',
    {
      title: 'Set simulation speed',
      description: 'Pause (0) or run the live game at 1x, 2x or 4x.',
      inputSchema: { speed: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(4)]) },
    },
    tool('set_simulation_speed', (a) => (a.speed === 0 ? '일시정지' : `${a.speed}배속`), async (a: { speed: 0 | 1 | 2 | 4 }) => {
      await bridge.call(session(), 'set_speed', { speed: a.speed });
      return text(`speed set to ${a.speed}`);
    }),
  );

  server.registerTool(
    'get_notes',
    {
      title: 'Read notes',
      description: 'Read the shared notepad saved with this factory (plans, conventions, todo).',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    tool('get_notes', () => '메모 읽기', async () => {
      const { world } = await loadWorld();
      return text(world.state.notes || '(empty)');
    }),
  );

  server.registerTool(
    'set_notes',
    {
      title: 'Write notes',
      description: 'Replace the shared notepad. Keep it short: layout conventions, open tasks, next steps.',
      inputSchema: { notes: z.string().max(4000) },
    },
    tool('set_notes', () => '메모 저장', async (a: { notes: string }) => {
      await bridge.call(session(), 'set_notes', { notes: a.notes });
      return text('saved');
    }),
  );

  return server;
}

function scale(inv: Partial<Record<string, number>>, k: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, v] of Object.entries(inv)) out[key] = Math.round((v ?? 0) * k * 10) / 10;
  return out;
}
