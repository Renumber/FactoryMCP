import type { BridgeMethods, ClientToServer, PatchOp, RefactorPlan, ServerToClient, SimSpeed } from '@factorymcp/sim';
import type { GameController } from './controller.ts';

const SESSION_KEY = 'factorymcp.session';

export function sessionId(): string {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

/** Answers the MCP server's requests using the live game state. */
export function connectBridge(game: GameController): () => void {
  const id = sessionId();
  let socket: WebSocket | null = null;
  let retry = 0;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const send = (msg: ClientToServer) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
  };

  game.onPlanStatus = (plan) => send({ type: 'plan_status', planId: plan.id, status: plan.status, message: plan.statusMessage });

  const handle = (method: keyof BridgeMethods, params: unknown): unknown => {
    const p = params as Record<string, unknown>;
    switch (method) {
      case 'snapshot':
        return game.snapshot();
      case 'apply_patch':
        return game.agentApplyPatch(p.ops as PatchOp[], String(p.reason ?? ''));
      case 'show_plan':
        game.addPlan(p.plan as RefactorPlan);
        return { ok: true };
      case 'apply_plan':
        return game.approvePlan(String(p.planId));
      case 'set_speed':
        game.setSpeed(p.speed as SimSpeed);
        return { ok: true };
      case 'set_notes':
        game.setNotes(String(p.notes ?? ''));
        return { ok: true };
      default:
        throw new Error(`unknown method ${String(method)}`);
    }
  };

  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${proto}://${location.host}/ws?session=${id}`);
    game.connection = 'connecting';
    game.notify();

    socket.onopen = () => {
      retry = 0;
      game.connection = 'online';
      game.notify();
    };
    socket.onmessage = (ev) => {
      let msg: ServerToClient;
      try {
        msg = JSON.parse(String(ev.data)) as ServerToClient;
      } catch {
        return;
      }
      if (msg.type === 'hello') {
        game.mcpUrl = msg.mcpUrl;
        game.notify();
      } else if (msg.type === 'agent_log') {
        game.pushAgentLog(msg.entry);
      } else if (msg.type === 'request') {
        try {
          send({ type: 'response', id: msg.id, result: handle(msg.method, msg.params) });
        } catch (err) {
          send({ type: 'response', id: msg.id, error: err instanceof Error ? err.message : String(err) });
        }
      }
    };
    socket.onclose = () => {
      game.connection = 'offline';
      game.notify();
      if (closed) return;
      retry = Math.min(retry + 1, 6);
      timer = setTimeout(open, 500 * 2 ** retry);
    };
  };

  open();
  return () => {
    closed = true;
    clearTimeout(timer);
    socket?.close();
  };
}
