import type { Metrics, SimulatePatchResult } from './analysis.ts';
import type { EntitySummary, PatchError, PatchOp } from './patch.ts';
import type { WorldState } from './types.ts';

export type SimSpeed = 0 | 1 | 2 | 4;

export type PlanStatus = 'pending' | 'applied' | 'rejected' | 'failed' | 'stale';

export interface RefactorPlan {
  id: string;
  title: string;
  rationale: string;
  ops: PatchOp[];
  zoneId: string | null;
  createdAt: number;
  status: PlanStatus;
  statusMessage?: string;
  changes: { added: EntitySummary[]; removed: EntitySummary[]; modified: EntitySummary[] };
  before?: Metrics;
  after?: Metrics;
  delta?: SimulatePatchResult['delta'];
  warnings: string[];
  portRegressions: string[];
}

export interface AgentLogEntry {
  at: number;
  tool: string;
  summary: string;
  ok: boolean;
}

export interface ApplyPatchResult {
  ok: boolean;
  errors: PatchError[];
  warnings: string[];
  message?: string;
}

/** Calls the server makes into the browser, which owns the live world. */
export interface BridgeMethods {
  snapshot: { params: Record<string, never>; result: WorldState };
  apply_patch: { params: { ops: PatchOp[]; reason: string }; result: ApplyPatchResult };
  show_plan: { params: { plan: RefactorPlan }; result: { ok: true } };
  apply_plan: { params: { planId: string }; result: ApplyPatchResult };
  set_speed: { params: { speed: SimSpeed }; result: { ok: true } };
  set_notes: { params: { notes: string }; result: { ok: true } };
}

export type BridgeMethod = keyof BridgeMethods;

export type ServerToClient =
  | { type: 'request'; id: number; method: BridgeMethod; params: unknown }
  | { type: 'agent_log'; entry: AgentLogEntry }
  | { type: 'hello'; sessionId: string; mcpUrl: string };

export type ClientToServer =
  | { type: 'response'; id: number; result?: unknown; error?: string }
  | { type: 'plan_status'; planId: string; status: PlanStatus; message?: string };
