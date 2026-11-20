import { ENTITY_DEFS, RECIPES, type EntityType, type RecipeId } from '@factorymcp/sim';
import { useGame } from '../game/context.ts';
import { ENTITY_DESC, recipeName } from './labels.ts';

const GROUPS: { title: string; types: EntityType[] }[] = [
  { title: '물류', types: ['belt', 'fast_belt', 'splitter', 'merger', 'tunnel_in', 'tunnel_out'] },
  { title: '생산', types: ['miner', 'stone_furnace', 'electric_furnace', 'assembler'] },
  { title: '전력', types: ['coal_generator'] },
];

const DIR_ARROW = { E: '→', S: '↓', W: '←', N: '↑' } as const;

export function Palette() {
  const game = useGame();
  const tool = game.tool;
  const w = game.world;

  const pick = (type: EntityType) => {
    const def = ENTITY_DEFS[type];
    const prev = tool.kind === 'place' && tool.type === type ? tool.recipe : null;
    const recipe = def.recipes ? (prev ?? def.recipes.find((r) => w.isRecipeUnlocked(r)) ?? null) : null;
    game.setTool({ kind: 'place', type, recipe });
  };

  const placing = tool.kind === 'place' ? ENTITY_DEFS[tool.type] : null;

  return (
    <section className="border-b border-gray-800 p-3">
      <div className="mb-2 flex gap-1.5">
        {[
          { kind: 'select', label: '선택', key: 'Esc' },
          { kind: 'remove', label: '철거', key: 'X' },
          { kind: 'zone', label: '구역 지정', key: 'Z' },
        ].map((t) => (
          <button
            key={t.kind}
            onClick={() => game.setTool({ kind: t.kind } as never)}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${tool.kind === t.kind ? 'bg-indigo-500 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
          >
            {t.label} <span className="opacity-60">{t.key}</span>
          </button>
        ))}
      </div>

      {GROUPS.map((g) => (
        <div key={g.title} className="mt-2">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{g.title}</div>
          <div className="grid grid-cols-3 gap-1.5">
            {g.types.map((type) => {
              const def = ENTITY_DEFS[type];
              const unlocked = w.isUnlocked(type);
              const active = tool.kind === 'place' && tool.type === type;
              return (
                <button
                  key={type}
                  disabled={!unlocked}
                  onClick={() => pick(type)}
                  title={ENTITY_DESC[type]}
                  className={`rounded-md border px-1.5 py-2 text-[11px] leading-tight transition ${
                    active
                      ? 'border-indigo-400 bg-indigo-500/20 text-gray-100'
                      : unlocked
                        ? 'border-gray-700 bg-gray-800 text-gray-200 hover:border-gray-500'
                        : 'cursor-not-allowed border-gray-800 bg-gray-900 text-gray-600'
                  }`}
                >
                  <div className="font-medium">{def.name}</div>
                  <div className="mt-0.5 text-[10px] text-gray-500">{unlocked ? `${def.size}x${def.size}` : `티어 ${def.tier}`}</div>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {placing && tool.kind === 'place' && (
        <div className="mt-3 space-y-2 rounded-md bg-gray-800/60 p-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-gray-400">방향</span>
            <button onClick={() => game.rotate()} className="rounded bg-gray-700 px-2 py-0.5 hover:bg-gray-600">
              {DIR_ARROW[game.dir]} {game.dir} <span className="opacity-60">(R)</span>
            </button>
          </div>
          {placing.recipes && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-gray-400">레시피</span>
              <select
                value={tool.recipe ?? ''}
                onChange={(e) => game.setTool({ ...tool, recipe: (e.target.value || null) as RecipeId | null })}
                className="flex-1 rounded bg-gray-700 px-1.5 py-1"
              >
                {placing.recipes.map((r) => (
                  <option key={r} value={r} disabled={!w.isRecipeUnlocked(r)}>
                    {recipeName(r)} ({RECIPES[r].time}s)
                  </option>
                ))}
              </select>
            </div>
          )}
          <p className="text-gray-500">
            {tool.type === 'belt' || tool.type === 'fast_belt' ? '드래그해서 벨트를 깝니다. 우클릭으로 취소.' : '클릭해서 배치. 우클릭으로 취소.'}
          </p>
        </div>
      )}
    </section>
  );
}
