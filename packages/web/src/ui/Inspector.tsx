import { ENTITY_DEFS, type ItemId, type RecipeId } from '@factorymcp/sim';
import { useGame } from '../game/context.ts';
import { fmt, itemColor, itemName, recipeName, STATUS_DOT, STATUS_LABELS } from './labels.ts';

function InvList({ title, inv }: { title: string; inv: Partial<Record<ItemId, number>> }) {
  const entries = Object.entries(inv).filter(([, n]) => n);
  if (!entries.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-gray-500">{title}</span>
      {entries.map(([item, n]) => (
        <span key={item} className="flex items-center gap-1 rounded bg-gray-800 px-1.5 py-0.5">
          <span className="h-2 w-2 rounded-full" style={{ background: itemColor(item) }} />
          {itemName(item)} {n}
        </span>
      ))}
    </div>
  );
}

export function Inspector() {
  const game = useGame();
  const e = game.selectedId !== null ? game.world.getEntity(game.selectedId) : undefined;
  if (!e) return null;
  const def = ENTITY_DEFS[e.type];
  const ore = e.type === 'miner' ? game.world.minerOre(e.x, e.y) : null;

  return (
    <section className="border-b border-gray-800 p-3 text-xs">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">
          {def.name} <span className="text-gray-500">#{e.id}</span>
        </div>
        <span className="flex items-center gap-1.5 text-gray-300">
          <span className={`h-2 w-2 rounded-full ${STATUS_DOT[e.status]}`} />
          {STATUS_LABELS[e.status]}
        </span>
      </div>
      <div className="mt-1 text-gray-500">
        ({e.x}, {e.y}) · 방향 {e.dir} {def.powerKW ? `· ${def.powerKW} kW` : ''}
      </div>

      <div className="mt-2 space-y-1.5">
        {ore && (
          <div className="text-gray-300">
            {itemName(ore.ore)} · 순도 x{ore.purity} · {fmt(30 * ore.purity)}/m
          </div>
        )}
        {def.recipes && (
          <div className="flex items-center gap-2">
            <span className="text-gray-500">레시피</span>
            <select
              value={e.recipe ?? ''}
              onChange={(ev) => game.setRecipe(e.id, (ev.target.value || null) as RecipeId | null)}
              className="flex-1 rounded bg-gray-800 px-1.5 py-1"
            >
              <option value="">없음</option>
              {def.recipes.map((r) => (
                <option key={r} value={r} disabled={!game.world.isRecipeUnlocked(r)}>
                  {recipeName(r)}
                </option>
              ))}
            </select>
          </div>
        )}
        <InvList title="입력" inv={e.inv} />
        <InvList title="출력" inv={e.out} />
        {def.fuelSecondsPerCoal ? <div className="text-gray-500">연료 잔량 {fmt(e.fuel)}s</div> : null}
        <div className="text-gray-500">
          누적 생산 {e.stats.produced} · 이동 {e.stats.moved}
        </div>
      </div>

      {e.type !== 'hub' && (
        <div className="mt-2 flex gap-1.5">
          <button onClick={() => game.rotate()} className="flex-1 rounded bg-gray-800 py-1 hover:bg-gray-700">
            회전 (R)
          </button>
          <button onClick={() => game.removeAt(e.x, e.y)} className="flex-1 rounded bg-gray-800 py-1 text-red-300 hover:bg-gray-700">
            철거 (Del)
          </button>
        </div>
      )}
    </section>
  );
}
