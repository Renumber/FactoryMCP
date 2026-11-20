import type { ItemId } from '@factorymcp/sim';
import { useGame } from '../game/context.ts';
import { fmt, itemColor, itemName } from './labels.ts';

export function HubBar() {
  const game = useGame();
  const delivered = game.world.state.delivered;
  const rates = game.world.deliveryRates();
  const items = Object.keys(delivered) as ItemId[];

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex justify-center">
      <div className="pointer-events-auto flex max-w-full items-center gap-3 overflow-x-auto rounded-xl border border-gray-800 bg-gray-900/90 px-4 py-2 text-xs shadow-lg backdrop-blur">
        <span className="font-semibold text-gray-400">허브</span>
        {items.length === 0 && <span className="text-gray-500">벨트를 허브 가장자리로 연결하면 납품됩니다.</span>}
        {items.map((item) => (
          <span key={item} className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: itemColor(item) }} />
            <span className="text-gray-300">{itemName(item)}</span>
            <span className="tabular-nums text-gray-100">{delivered[item]}</span>
            <span className="tabular-nums text-gray-500">{fmt(rates[item] ?? 0)}/m</span>
          </span>
        ))}
      </div>
    </div>
  );
}
