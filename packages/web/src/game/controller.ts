import {
  applyPatch,
  createDemoWorld,
  ENTITY_DEFS,
  makeZone,
  TICK_RATE,
  tryPatch,
  World,
  type AgentLogEntry,
  type ApplyPatchResult,
  type Dir,
  type EntityType,
  type PatchOp,
  type PlanStatus,
  type Rect,
  type RecipeId,
  type RefactorPlan,
  type SimSpeed,
  type WorldState,
} from '@factorymcp/sim';

export type Tool =
  | { kind: 'select' }
  | { kind: 'place'; type: EntityType; recipe: RecipeId | null }
  | { kind: 'remove' }
  | { kind: 'zone' };

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'good' | 'bad';
}

const SAVE_KEY = 'factorymcp.save.v1';
const PLANS_KEY = 'factorymcp.plans.v1';
const MAX_CATCHUP_SECONDS = 2;
const MAX_STEPS_PER_FRAME = MAX_CATCHUP_SECONDS * TICK_RATE * 4;

type Listener = () => void;

export class GameController {
  world: World;
  speed: SimSpeed = 1;
  tool: Tool = { kind: 'select' };
  dir: Dir = 'E';
  selectedId: number | null = null;
  plans: RefactorPlan[] = [];
  previewPlanId: string | null = null;
  agentLog: AgentLogEntry[] = [];
  toasts: Toast[] = [];
  allowDirect = false;
  connection: 'connecting' | 'online' | 'offline' = 'connecting';
  mcpUrl = '';

  /** Bumped for every change React should see. */
  version = 0;
  private listeners = new Set<Listener>();
  private accumulator = 0;
  private lastFrame = 0;
  private loopTimer: ReturnType<typeof setInterval> | undefined;
  private lastNotify = 0;
  private toastId = 1;
  private saveTimer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    this.world = loadWorld() ?? createDemoWorld();
    this.plans = loadPlans();
  }

  // ------------------------------------------------------------ lifecycle

  /** Timer-driven rather than rAF so the factory keeps running while the player is in their agent window. */
  start(): void {
    this.lastFrame = performance.now();
    this.loopTimer = setInterval(() => this.tick(performance.now()), 1000 / TICK_RATE);
    this.saveTimer = setInterval(() => this.save(), 10_000);
    window.addEventListener('beforeunload', this.save);
  }

  stop(): void {
    clearInterval(this.loopTimer);
    clearInterval(this.saveTimer);
    window.removeEventListener('beforeunload', this.save);
    this.save();
  }

  private tick(now: number): void {
    const dt = Math.min(MAX_CATCHUP_SECONDS, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.speed > 0) {
      this.accumulator += dt * this.speed * TICK_RATE;
      let steps = 0;
      while (this.accumulator >= 1 && steps < MAX_STEPS_PER_FRAME) {
        this.world.step();
        this.accumulator -= 1;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    }
    this.drainEvents();
    if (now - this.lastNotify > 250) {
      this.lastNotify = now;
      this.notify();
    }
  }

  private drainEvents(): void {
    while (this.world.events.length) {
      const ev = this.world.events.shift()!;
      if (ev.type === 'tier_up') this.toast(`티어 ${ev.tier} 달성! 새 설비가 해금되었습니다.`, 'good');
    }
  }

  save = (): void => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.world.state));
      localStorage.setItem(PLANS_KEY, JSON.stringify(this.plans.slice(-20)));
    } catch {
      // storage full or unavailable; the next save retries
    }
  };

  // ------------------------------------------------------------------ hover

  hover: { x: number; y: number; sx: number; sy: number } | null = null;
  private hoverListeners = new Set<Listener>();
  private hoverVersion = 0;

  setHover(h: GameController['hover']): void {
    if (h && this.hover && h.x === this.hover.x && h.y === this.hover.y && h.sx === this.hover.sx && h.sy === this.hover.sy) return;
    this.hover = h;
    this.hoverVersion++;
    for (const fn of this.hoverListeners) fn();
  }

  subscribeHover = (fn: Listener): (() => void) => {
    this.hoverListeners.add(fn);
    return () => this.hoverListeners.delete(fn);
  };

  getHoverVersion = (): number => this.hoverVersion;

  // ---------------------------------------------------------- subscription

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = (): number => this.version;

  notify(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  toast(text: string, tone: Toast['tone'] = 'info'): void {
    const t = { id: this.toastId++, text, tone };
    this.toasts = [...this.toasts, t].slice(-4);
    setTimeout(() => {
      this.toasts = this.toasts.filter((x) => x.id !== t.id);
      this.notify();
    }, 4000);
    this.notify();
  }

  // ----------------------------------------------------------- player ops

  setSpeed(speed: SimSpeed): void {
    this.speed = speed;
    this.notify();
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    if (tool.kind !== 'select') this.selectedId = null;
    this.notify();
  }

  rotate(): void {
    const order: Dir[] = ['E', 'S', 'W', 'N'];
    if (this.tool.kind === 'place') {
      this.dir = order[(order.indexOf(this.dir) + 1) % 4]!;
    } else if (this.selectedId !== null) {
      const e = this.world.getEntity(this.selectedId);
      if (e && e.type !== 'hub') this.world.rotate(e.id, order[(order.indexOf(e.dir) + 1) % 4]!);
    }
    this.notify();
  }

  /** Player edits go through the same patch path as the agent. */
  applyOps(ops: PatchOp[], quiet = false): boolean {
    const res = applyPatch(this.world, ops);
    if (!res.ok && !quiet) this.toast(res.errors[0]!.message, 'bad');
    this.notify();
    return res.ok;
  }

  placeAt(x: number, y: number): void {
    if (this.tool.kind !== 'place') return;
    const { type, recipe } = this.tool;
    this.applyOps([{ op: 'place', type, x, y, dir: this.dir, recipe: ENTITY_DEFS[type].recipes ? recipe : null }]);
  }

  removeAt(x: number, y: number): void {
    const e = this.world.entityAt(x, y);
    if (!e || e.type === 'hub') return;
    this.world.remove(e.id);
    if (this.selectedId === e.id) this.selectedId = null;
    this.notify();
  }

  select(x: number, y: number): void {
    this.selectedId = this.world.entityAt(x, y)?.id ?? null;
    this.notify();
  }

  setRecipe(id: number, recipe: RecipeId | null): void {
    const err = this.world.setRecipe(id, recipe);
    if (err) this.toast(err.message, 'bad');
    this.notify();
  }

  addZone(rect: Rect): void {
    const n = this.world.state.zones.length + 1;
    let id = `z${n}`;
    while (this.world.state.zones.some((z) => z.id === id)) id += '_';
    this.world.state.zones.push(makeZone(this.world, id, `구역 ${n}`, rect));
    this.toast(`${id} 구역을 만들었습니다. 에이전트에게 "${id} 최적화해줘"라고 요청해 보세요.`, 'good');
    this.setTool({ kind: 'select' });
  }

  renameZone(id: string, name: string): void {
    const z = this.world.state.zones.find((zz) => zz.id === id);
    if (z) z.name = name;
    this.notify();
  }

  removeZone(id: string): void {
    this.world.state.zones = this.world.state.zones.filter((z) => z.id !== id);
    this.notify();
  }

  setNotes(notes: string): void {
    this.world.state.notes = notes;
    this.notify();
  }

  resetWorld(kind: 'demo' | 'empty' | 'sandbox'): void {
    this.world = kind === 'demo' ? createDemoWorld() : World.create({ unlockAll: kind === 'sandbox' });
    this.plans = [];
    this.previewPlanId = null;
    this.selectedId = null;
    this.save();
    this.notify();
  }

  // ------------------------------------------------------------------ plans

  previewPlan(): RefactorPlan | null {
    return this.plans.find((p) => p.id === this.previewPlanId && p.status === 'pending') ?? null;
  }

  addPlan(plan: RefactorPlan): void {
    this.plans = [...this.plans.filter((p) => p.id !== plan.id), plan];
    this.previewPlanId = plan.id;
    this.toast(`에이전트 제안 도착: ${plan.title}`, 'info');
  }

  setPreview(id: string | null): void {
    this.previewPlanId = id;
    this.notify();
  }

  approvePlan(id: string): ApplyPatchResult {
    const plan = this.plans.find((p) => p.id === id);
    if (!plan) return { ok: false, errors: [], warnings: [], message: 'plan not found' };
    const zoneDef = plan.zoneId ? this.world.state.zones.find((z) => z.id === plan.zoneId) : undefined;
    const zone = zoneDef && !plan.outsideZone ? makeZone(this.world, zoneDef.id, zoneDef.name, zoneDef) : undefined;
    const { result, world } = tryPatch(this.world, plan.ops, { zone });
    if (result.ok) {
      this.world = world;
      this.setPlanStatus(plan, 'applied');
      this.toast(`적용 완료: ${plan.title}`, 'good');
    } else {
      this.setPlanStatus(plan, 'stale', result.errors[0]?.message);
      this.toast(`적용 실패 (공장이 바뀌었습니다): ${result.errors[0]?.message}`, 'bad');
    }
    if (this.previewPlanId === id) this.previewPlanId = null;
    this.notify();
    return { ok: result.ok, errors: result.errors, warnings: result.warnings };
  }

  rejectPlan(id: string): void {
    const plan = this.plans.find((p) => p.id === id);
    if (!plan) return;
    this.setPlanStatus(plan, 'rejected');
    if (this.previewPlanId === id) this.previewPlanId = null;
    this.notify();
  }

  /** Server is informed through this hook (set by the bridge). */
  onPlanStatus: (plan: RefactorPlan) => void = () => {};

  private setPlanStatus(plan: RefactorPlan, status: PlanStatus, message?: string): void {
    plan.status = status;
    plan.statusMessage = message;
    this.plans = [...this.plans];
    this.onPlanStatus(plan);
  }

  // ------------------------------------------------------------ agent hooks

  agentApplyPatch(ops: PatchOp[], reason: string): ApplyPatchResult {
    if (!this.allowDirect) {
      return {
        ok: false,
        errors: [],
        warnings: [],
        message: 'The player has not enabled direct execution. Use propose_refactor instead.',
      };
    }
    const { result, world } = tryPatch(this.world, ops);
    if (result.ok) {
      this.world = world;
      this.toast(`에이전트 실행: ${reason}`, 'info');
    }
    this.notify();
    return { ok: result.ok, errors: result.errors, warnings: result.warnings };
  }

  pushAgentLog(entry: AgentLogEntry): void {
    this.agentLog = [...this.agentLog, entry].slice(-80);
    this.notify();
  }

  setAllowDirect(v: boolean): void {
    this.allowDirect = v;
    this.notify();
  }

  snapshot(): WorldState {
    return this.world.toState();
  }
}

function loadWorld(): World | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw) as WorldState;
    if (state.version !== 1) return null;
    return World.fromState(state);
  } catch {
    return null;
  }
}

function loadPlans(): RefactorPlan[] {
  try {
    return JSON.parse(localStorage.getItem(PLANS_KEY) ?? '[]') as RefactorPlan[];
  } catch {
    return [];
  }
}
