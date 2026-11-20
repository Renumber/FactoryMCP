import { ENTITY_DEFS, type EntitySummary, type Inventory, type RefactorPlan } from '@factorymcp/sim';
import { useGame } from '../game/context.ts';
import { fmt, itemColor, itemName, recipeName } from './labels.ts';

const STATUS_STYLE: Record<RefactorPlan['status'], string> = {
  pending: 'bg-indigo-500/20 text-indigo-300',
  applied: 'bg-emerald-500/20 text-emerald-300',
  rejected: 'bg-gray-700 text-gray-400',
  failed: 'bg-red-500/20 text-red-300',
  stale: 'bg-red-500/20 text-red-300',
};

const STATUS_TEXT: Record<RefactorPlan['status'], string> = {
  pending: '검토 대기',
  applied: '적용됨',
  rejected: '거절됨',
  failed: '실패',
  stale: '만료',
};

function RateTable({ before, after }: { before: Inventory; after: Inventory }) {
  const items = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  if (!items.length) return <div className="text-gray-500">허브 납품 변화 없음</div>;
  return (
    <table className="w-full tabular-nums">
      <thead className="text-gray-500">
        <tr>
          <th className="text-left font-normal">허브 납품 /m</th>
          <th className="text-right font-normal">전</th>
          <th className="text-right font-normal">후</th>
          <th className="text-right font-normal">변화</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const b = before[item as keyof Inventory] ?? 0;
          const a = after[item as keyof Inventory] ?? 0;
          const d = a - b;
          return (
            <tr key={item}>
              <td className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: itemColor(item) }} />
                {itemName(item)}
              </td>
              <td className="text-right text-gray-400">{fmt(b)}</td>
              <td className="text-right">{fmt(a)}</td>
              <td className={`text-right ${d > 0.05 ? 'text-emerald-300' : d < -0.05 ? 'text-red-300' : 'text-gray-500'}`}>
                {d > 0 ? '+' : ''}
                {fmt(d)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ChangeList({ plan }: { plan: RefactorPlan }) {
  const outside = new Set(plan.outsideZone?.entityIds ?? []);
  const rows: { key: string; sign: string; tone: string; text: string; outside: boolean }[] = [];
  const groups: [EntitySummary[], string, string][] = [
    [plan.changes.added, '+', 'text-blue-300'],
    [plan.changes.removed, '−', 'text-red-300'],
    [plan.changes.modified, '~', 'text-amber-300'],
  ];
  for (const [list, sign, tone] of groups) {
    const transport = list.filter((c) => ENTITY_DEFS[c.type].category === 'transport');
    for (const c of list) {
      if (ENTITY_DEFS[c.type].category === 'transport') continue;
      const recipe = c.recipe ? ` · ${recipeName(c.recipe)}` : '';
      const verb = sign === '~' ? ` · 방향 ${c.dir}` : '';
      rows.push({ key: `${sign}${c.id}`, sign, tone, text: `${ENTITY_DEFS[c.type].name}${recipe}${verb} (${c.x},${c.y})`, outside: outside.has(c.id) });
    }
    if (transport.length) {
      const byType = new Map<string, EntitySummary[]>();
      for (const c of transport) byType.set(c.type, [...(byType.get(c.type) ?? []), c]);
      for (const [type, cs] of byType) {
        const out = cs.filter((c) => outside.has(c.id)).length;
        rows.push({
          key: `${sign}${type}`,
          sign,
          tone,
          text: `${ENTITY_DEFS[type as EntitySummary['type']].name} ×${cs.length}${out ? ` (구역 밖 ${out})` : ''}`,
          outside: false,
        });
      }
    }
  }
  if (!rows.length) return null;
  return (
    <ul className="mt-2 space-y-0.5">
      {rows.map((r) => (
        <li key={r.key} className="flex gap-1.5">
          <span className={`w-3 shrink-0 font-semibold ${r.tone}`}>{r.sign}</span>
          <span className="text-gray-300">{r.text}</span>
          {r.outside && <span className="text-orange-300">구역 밖</span>}
        </li>
      ))}
      {plan.zoneId && !plan.outsideZone && <li className="text-gray-500">구역 {plan.zoneId} 안에서만 변경</li>}
    </ul>
  );
}

function PlanCard({ plan }: { plan: RefactorPlan }) {
  const game = useGame();
  const previewing = game.previewPlanId === plan.id;
  const pending = plan.status === 'pending';
  return (
    <div className={`rounded-lg border p-3 ${previewing ? 'border-indigo-400 bg-indigo-500/5' : 'border-gray-800 bg-gray-800/40'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-semibold leading-snug">{plan.title}</div>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${STATUS_STYLE[plan.status]}`}>{STATUS_TEXT[plan.status]}</span>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-gray-300">{plan.rationale}</p>

      {plan.before && plan.after && (
        <div className="mt-2 rounded-md bg-gray-950/60 p-2">
          <RateTable before={plan.before.hubPerMin} after={plan.after.hubPerMin} />
          <div className="mt-1.5 flex justify-between text-gray-500">
            <span>
              설비 {plan.before.summary.machineCount} → {plan.after.summary.machineCount}
            </span>
            <span>
              타일 {plan.before.summary.occupiedTiles} → {plan.after.summary.occupiedTiles}
            </span>
            <span>
              가동률 {Math.round(plan.before.summary.avgUtilization * 100)}% → {Math.round(plan.after.summary.avgUtilization * 100)}%
            </span>
          </div>
        </div>
      )}

      <ChangeList plan={plan} />
      {plan.outsideZone && (
        <div className="mt-2 rounded-md border border-orange-400/40 bg-orange-400/10 p-2 text-orange-200">
          ⚠ 구역 {plan.outsideZone.zoneId} 밖 변경 {plan.outsideZone.entityIds.length}건 (지도에 주황 테두리)
          <div className="mt-0.5 text-orange-200/80">사유: {plan.outsideZone.reason}</div>
        </div>
      )}
      {[...plan.portRegressions, ...plan.warnings].map((w) => (
        <div key={w} className="mt-1 text-amber-300">
          ⚠ {w}
        </div>
      ))}
      {plan.statusMessage && <div className="mt-1 text-red-300">{plan.statusMessage}</div>}

      {pending && (
        <div className="mt-2.5 flex gap-1.5">
          <button
            onClick={() => game.setPreview(previewing ? null : plan.id)}
            className="flex-1 rounded-md bg-gray-800 py-1.5 hover:bg-gray-700"
          >
            {previewing ? '미리보기 끄기' : '미리보기'}
          </button>
          <button onClick={() => game.rejectPlan(plan.id)} className="flex-1 rounded-md bg-gray-800 py-1.5 text-red-300 hover:bg-gray-700">
            거절
          </button>
          <button
            onClick={() => game.approvePlan(plan.id)}
            className="flex-1 rounded-md bg-indigo-500 py-1.5 font-semibold text-white hover:bg-indigo-400"
          >
            승인·적용
          </button>
        </div>
      )}
    </div>
  );
}

export function AgentPanel() {
  const game = useGame();
  const plans = [...game.plans].reverse();
  const log = [...game.agentLog].reverse();

  return (
    <div className="space-y-4 p-3 text-xs">
      <section>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">제안</div>
        {plans.length === 0 && (
          <p className="text-gray-500">
            아직 제안이 없습니다. 상단의 <b className="text-gray-300">에이전트 연결</b>로 MCP를 붙이고 "공장 효율 개선안을 제안해줘"라고 요청해 보세요.
          </p>
        )}
        <div className="space-y-2">
          {plans.map((p) => (
            <PlanCard key={p.id} plan={p} />
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">에이전트 활동</div>
        {log.length === 0 && <p className="text-gray-500">에이전트가 도구를 호출하면 여기에 표시됩니다.</p>}
        <ul className="space-y-1">
          {log.map((l, i) => (
            <li key={`${l.at}-${i}`} className="flex gap-2">
              <span className="shrink-0 tabular-nums text-gray-600">{new Date(l.at).toLocaleTimeString('ko-KR', { hour12: false })}</span>
              <span className={l.ok ? 'text-gray-300' : 'text-red-300'}>{l.summary}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">공유 메모</div>
        <textarea
          value={game.world.state.notes}
          onChange={(e) => game.setNotes(e.target.value)}
          placeholder="에이전트와 공유하는 메모 (get_notes / set_notes)"
          className="h-24 w-full resize-none rounded-md bg-gray-800 p-2 text-gray-200 placeholder:text-gray-600 focus:outline-none"
        />
      </section>
    </div>
  );
}
