import { useGame } from '../game/context.ts';

const TONE = {
  info: 'border-gray-700 bg-gray-900/95 text-gray-100',
  good: 'border-emerald-500/50 bg-emerald-950/90 text-emerald-100',
  bad: 'border-red-500/50 bg-red-950/90 text-red-100',
};

export function Toasts() {
  const game = useGame();
  return (
    <div className="pointer-events-none absolute left-1/2 top-3 flex -translate-x-1/2 flex-col items-center gap-2">
      {game.toasts.map((t) => (
        <div key={t.id} className={`rounded-lg border px-3 py-2 text-xs shadow-lg ${TONE[t.tone]}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
