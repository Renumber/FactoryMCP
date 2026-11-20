import { TIER_GOALS, type SimSpeed } from '@factorymcp/sim';
import { useState } from 'react';
import { useGame } from '../game/context.ts';
import { ConnectDialog } from './ConnectDialog.tsx';
import { fmt, itemName } from './labels.ts';

const SPEEDS: SimSpeed[] = [0, 1, 2, 4];

export function TopBar() {
  const game = useGame();
  const [open, setOpen] = useState(false);
  const s = game.world.state;
  const goal = TIER_GOALS.find((g) => g.tier === s.tier);
  const delivered = goal ? (s.delivered[goal.item] ?? 0) : 0;
  const power = s.power;
  const powerPct = power.capacityKW ? Math.min(100, (power.demandKW / power.capacityKW) * 100) : 0;
  const minutes = Math.floor(game.world.seconds / 60);
  const seconds = Math.floor(game.world.seconds % 60);

  return (
    <header className="flex h-12 shrink-0 items-center gap-5 border-b border-gray-800 bg-gray-900 px-4 text-sm">
      <div className="flex items-center gap-2 font-semibold tracking-tight">
        <span className="rounded bg-indigo-500 px-1.5 py-0.5 text-xs text-white">MCP</span>
        FactoryMCP
      </div>

      <div className="flex items-center gap-1 rounded-lg bg-gray-800 p-0.5">
        {SPEEDS.map((sp) => (
          <button
            key={sp}
            onClick={() => game.setSpeed(sp)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${game.speed === sp ? 'bg-indigo-500 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
          >
            {sp === 0 ? '❚❚' : `${sp}x`}
          </button>
        ))}
      </div>
      <span className="tabular-nums text-gray-400">
        {minutes}:{String(seconds).padStart(2, '0')}
      </span>

      <div className="flex items-center gap-2" title={`${fmt(power.demandKW, 0)} / ${fmt(power.capacityKW, 0)} kW`}>
        <span className="text-gray-400">전력</span>
        <div className="h-2 w-24 overflow-hidden rounded bg-gray-800">
          <div
            className={`h-full ${power.satisfaction < 1 ? 'bg-red-400' : powerPct > 80 ? 'bg-amber-400' : 'bg-emerald-400'}`}
            style={{ width: `${powerPct}%` }}
          />
        </div>
        <span className="tabular-nums text-xs text-gray-400">
          {fmt(power.demandKW / 1000, 2)}/{fmt(power.capacityKW / 1000, 1)} MW
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="rounded bg-gray-800 px-2 py-0.5 text-xs">티어 {s.tier}</span>
        {goal ? (
          <>
            <span className="text-gray-300">
              {itemName(goal.item)} {Math.min(delivered, goal.amount)}/{goal.amount}
            </span>
            <div className="h-2 w-28 overflow-hidden rounded bg-gray-800">
              <div className="h-full bg-indigo-400" style={{ width: `${Math.min(100, (delivered / goal.amount) * 100)}%` }} />
            </div>
          </>
        ) : (
          <span className="text-gray-400">모든 목표 달성</span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-3">
        <span className="flex items-center gap-1.5 text-xs text-gray-400">
          <span
            className={`h-2 w-2 rounded-full ${game.connection === 'online' ? 'bg-emerald-400' : game.connection === 'connecting' ? 'bg-amber-400' : 'bg-red-400'}`}
          />
          {game.connection === 'online' ? '서버 연결됨' : game.connection === 'connecting' ? '연결 중' : '서버 오프라인'}
        </span>
        <button onClick={() => setOpen(true)} className="rounded-md bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-400">
          에이전트 연결
        </button>
      </div>
      {open && <ConnectDialog onClose={() => setOpen(false)} />}
    </header>
  );
}
