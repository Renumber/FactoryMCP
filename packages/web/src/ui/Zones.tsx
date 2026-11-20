import { useState } from 'react';
import { useGame } from '../game/context.ts';

export function Zones() {
  const game = useGame();
  const zones = game.world.state.zones;
  const [copied, setCopied] = useState<string | null>(null);

  const copyPrompt = async (id: string, name: string) => {
    await navigator.clipboard.writeText(
      `FactoryMCP의 ${id} 구역(${name})을 조사해서 병목을 찾고, 포트는 유지한 채 처리량이 늘어나도록 리팩터링안을 propose_refactor로 제안해줘.`,
    );
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <section className="p-3 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">구역</span>
        <button onClick={() => game.setTool({ kind: 'zone' })} className="rounded bg-gray-800 px-2 py-0.5 hover:bg-gray-700">
          + 새 구역 (Z)
        </button>
      </div>
      {zones.length === 0 && <p className="text-gray-500">구역을 드래그로 지정하면 에이전트가 그 안만 고치도록 범위를 줄 수 있습니다.</p>}
      <ul className="space-y-1.5">
        {zones.map((z) => (
          <li key={z.id} className="rounded-md bg-gray-800/60 p-2">
            <div className="flex items-center gap-2">
              <span className="rounded bg-amber-400/20 px-1.5 text-amber-300">{z.id}</span>
              <input
                value={z.name}
                onChange={(e) => game.renameZone(z.id, e.target.value)}
                className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 hover:bg-gray-800 focus:bg-gray-800 focus:outline-none"
              />
              <button onClick={() => game.removeZone(z.id)} className="text-gray-500 hover:text-red-300">
                삭제
              </button>
            </div>
            <div className="mt-1 flex items-center justify-between text-gray-500">
              <span>
                ({z.x},{z.y}) {z.w}x{z.h} · 포트 {z.ports.length}
              </span>
              <button onClick={() => copyPrompt(z.id, z.name)} className="text-indigo-300 hover:text-indigo-200">
                {copied === z.id ? '복사됨' : '최적화 요청 복사'}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-4 border-t border-gray-800 pt-3">
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">월드</div>
        <div className="flex gap-1.5">
          {(
            [
              ['demo', '데모 공장'],
              ['empty', '빈 맵'],
              ['sandbox', '샌드박스'],
            ] as const
          ).map(([kind, label]) => (
            <button
              key={kind}
              onClick={() => confirm(`${label}으로 새로 시작할까요? 현재 공장은 사라집니다.`) && game.resetWorld(kind)}
              className="flex-1 rounded bg-gray-800 py-1 text-gray-300 hover:bg-gray-700"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
