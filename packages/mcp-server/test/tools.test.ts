import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  applyPatch,
  createDemoWorld,
  type AgentLogEntry,
  type BridgeMethod,
  type BridgeMethods,
  type RefactorPlan,
} from '@factorymcp/sim';
import { describe, expect, it } from 'vitest';
import type { SessionBridge } from '../src/bridge.ts';
import { createMcpServer } from '../src/tools.ts';

class FakeBridge implements SessionBridge {
  world = createDemoWorld();
  shown: RefactorPlan[] = [];
  logs: AgentLogEntry[] = [];
  private store: RefactorPlan[] = [];

  constructor() {
    this.world.state.zones.push({ id: 'z1', name: 'smelting', x: 17, y: 9, w: 4, h: 7, ports: [] });
  }

  resolveSession(): string {
    return 'test-session';
  }
  isConnected(): boolean {
    return true;
  }
  async call<M extends BridgeMethod>(_s: string, method: M, params: BridgeMethods[M]['params']): Promise<BridgeMethods[M]['result']> {
    const p = params as Record<string, unknown>;
    switch (method) {
      case 'snapshot':
        return this.world.toState() as BridgeMethods[M]['result'];
      case 'show_plan':
        this.shown.push(p.plan as RefactorPlan);
        return { ok: true } as BridgeMethods[M]['result'];
      case 'apply_patch': {
        const res = applyPatch(this.world, p.ops as never);
        return { ok: res.ok, errors: res.errors, warnings: res.warnings } as BridgeMethods[M]['result'];
      }
      default:
        return { ok: true } as BridgeMethods[M]['result'];
    }
  }
  log(_s: string, entry: AgentLogEntry): void {
    this.logs.push(entry);
  }
  plans(): RefactorPlan[] {
    return this.store;
  }
  savePlan(_s: string, plan: RefactorPlan): void {
    this.store.push(plan);
  }
}

async function connect(bridge: SessionBridge) {
  const server = createMcpServer(bridge, 'test-session');
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(b);
  return client;
}

function textOf(res: Awaited<ReturnType<Client['callTool']>>): string {
  return (res.content as { type: string; text: string }[]).map((c) => c.text).join('\n');
}

describe('mcp tools', () => {
  it('lists the agent tools', async () => {
    const client = await connect(new FakeBridge());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['get_overview', 'inspect_zone', 'simulate_patch', 'propose_refactor', 'execute_actions']),
    );
  });

  it('reports overview and zone ports', async () => {
    const bridge = new FakeBridge();
    const client = await connect(bridge);
    const overview = JSON.parse(textOf(await client.callTool({ name: 'get_overview', arguments: {} })));
    expect(overview.tier).toBe(1);
    expect(overview.goal.item).toBe('machine_part');

    const zone = textOf(await client.callTool({ name: 'inspect_zone', arguments: { zone_id: 'z1' } }));
    expect(zone).toContain('"kind": "in"');
    expect(bridge.logs.map((l) => l.tool)).toEqual(['get_overview', 'inspect_zone']);
  });

  it('returns patch errors with op index', async () => {
    const client = await connect(new FakeBridge());
    const res = await client.callTool({
      name: 'simulate_patch',
      arguments: { ops: [{ op: 'remove', x: 17, y: 10 }], zone_id: 'z1' },
    });
    const body = JSON.parse(textOf(res));
    expect(body.ok).toBe(false);
    expect(body.errors[0]).toMatchObject({ op: 0, code: 'port_locked' });
  });

  it('proposes a plan and pushes the ghost to the game', async () => {
    const bridge = new FakeBridge();
    const client = await connect(bridge);
    const res = await client.callTool({
      name: 'propose_refactor',
      arguments: {
        title: 'Remove furnace',
        rationale: 'test',
        ops: [{ op: 'remove', x: 18, y: 12 }],
        zone_id: 'z1',
      },
    });
    const body = JSON.parse(textOf(res));
    expect(body.ok).toBe(true);
    expect(bridge.shown).toHaveLength(1);
    expect(bridge.shown[0]!.changes.removed[0]!.type).toBe('stone_furnace');
    const plans = JSON.parse(textOf(await client.callTool({ name: 'list_plans', arguments: {} })));
    expect(plans[0].status).toBe('pending');
  });

  it('rejects malformed ops at the schema level', async () => {
    const client = await connect(new FakeBridge());
    const res = await client.callTool({ name: 'simulate_patch', arguments: { ops: [{ op: 'explode', x: 1, y: 1 }] } });
    expect(res.isError).toBe(true);
  });
});
