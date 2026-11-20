import type {
  AgentLogEntry,
  BridgeMethod,
  BridgeMethods,
  ClientToServer,
  PlanStatus,
  RefactorPlan,
  ServerToClient,
} from '@factorymcp/sim';
import type { WebSocket } from 'ws';

/**
 * Transport between MCP tool calls and the browser that owns a game session.
 * The PoC keeps everything in one process; a hosted version can swap this
 * for Durable Objects or a pub/sub backed implementation.
 */
export interface SessionBridge {
  resolveSession(token: string | null): string | null;
  isConnected(sessionId: string): boolean;
  call<M extends BridgeMethod>(sessionId: string, method: M, params: BridgeMethods[M]['params']): Promise<BridgeMethods[M]['result']>;
  log(sessionId: string, entry: AgentLogEntry): void;
  plans(sessionId: string): RefactorPlan[];
  savePlan(sessionId: string, plan: RefactorPlan): void;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_PLANS = 30;

export class InMemoryWsBridge implements SessionBridge {
  private sockets = new Map<string, WebSocket>();
  private pending = new Map<number, Pending>();
  private planStore = new Map<string, RefactorPlan[]>();
  private nextId = 1;

  constructor(private readonly opts: { allowSingleSessionFallback: boolean }) {}

  attach(sessionId: string, socket: WebSocket, mcpUrl: string): void {
    const prev = this.sockets.get(sessionId);
    if (prev && prev !== socket) prev.close(4000, 'replaced by a newer connection');
    this.sockets.delete(sessionId);
    this.sockets.set(sessionId, socket);
    this.send(socket, { type: 'hello', sessionId, mcpUrl });

    socket.on('message', (raw) => {
      let msg: ClientToServer;
      try {
        msg = JSON.parse(String(raw)) as ClientToServer;
      } catch {
        return;
      }
      if (msg.type === 'response') {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(msg.error));
        else p.resolve(msg.result);
      } else if (msg.type === 'plan_status') {
        this.updatePlan(sessionId, msg.planId, msg.status, msg.message);
      }
    });
    socket.on('close', () => {
      if (this.sockets.get(sessionId) === socket) this.sockets.delete(sessionId);
    });
  }

  resolveSession(token: string | null): string | null {
    if (token) return token;
    if (!this.opts.allowSingleSessionFallback) return null;
    return [...this.sockets.keys()].at(-1) ?? null;
  }

  isConnected(sessionId: string): boolean {
    return this.sockets.has(sessionId);
  }

  call<M extends BridgeMethod>(sessionId: string, method: M, params: BridgeMethods[M]['params']): Promise<BridgeMethods[M]['result']> {
    const socket = this.sockets.get(sessionId);
    if (!socket) {
      return Promise.reject(new Error('The game is not open. Ask the player to open FactoryMCP in the browser.'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`the game did not answer "${method}" within ${REQUEST_TIMEOUT_MS / 1000}s`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.send(socket, { type: 'request', id, method, params });
    });
  }

  log(sessionId: string, entry: AgentLogEntry): void {
    const socket = this.sockets.get(sessionId);
    if (socket) this.send(socket, { type: 'agent_log', entry });
  }

  plans(sessionId: string): RefactorPlan[] {
    return this.planStore.get(sessionId) ?? [];
  }

  savePlan(sessionId: string, plan: RefactorPlan): void {
    const list = this.planStore.get(sessionId) ?? [];
    const i = list.findIndex((p) => p.id === plan.id);
    if (i >= 0) list[i] = plan;
    else list.push(plan);
    if (list.length > MAX_PLANS) list.splice(0, list.length - MAX_PLANS);
    this.planStore.set(sessionId, list);
  }

  private updatePlan(sessionId: string, planId: string, status: PlanStatus, message?: string): void {
    const plan = this.plans(sessionId).find((p) => p.id === planId);
    if (!plan) return;
    plan.status = status;
    plan.statusMessage = message;
  }

  private send(socket: WebSocket, msg: ServerToClient): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  }
}
