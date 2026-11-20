import { ENTITY_DEFS, footprint, oreAt, purityAt, rectContains, type EntitySummary, type ItemId } from '@factorymcp/sim';
import { useContext, useSyncExternalStore, type ReactNode } from 'react';
import { GameContext } from '../game/context.ts';
import { ENTITY_DESC, fmt, itemColor, itemName, recipeName, STATUS_DOT, STATUS_LABELS } from './labels.ts';

const PURITY_LABEL: Record<number, string> = { 0.5: '저순도', 1: '보통', 2: '고순도' };
const DIR_LABEL = { N: '↑ 북', E: '→ 동', S: '↓ 남', W: '← 서' } as const;

function Items({ inv }: { inv: Partial<Record<ItemId, number>> }) {
  return (
    <>
      {Object.entries(inv)
        .filter(([, n]) => n)
        .map(([item, n]) => (
          <span key={item} className="mr-2 inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: itemColor(item) }} />
            {itemName(item)} {n}
          </span>
        ))}
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-12 shrink-0 text-gray-500">{label}</span>
      <span className="text-gray-200">{children}</span>
    </div>
  );
}

export function HoverTooltip() {
  const game = useContext(GameContext)!;
  useSyncExternalStore(game.subscribeHover, game.getHoverVersion);
  const h = game.hover;
  if (!h) return null;
  const w = game.world;
  if (!w.inBounds(h.x, h.y)) return null;

  const e = w.entityAt(h.x, h.y);
  const ore = oreAt(w.terrain, h.x, h.y);
  const purity = purityAt(w.terrain, h.x, h.y);
  const zones = w.state.zones.filter((z) => rectContains(z, h.x, h.y));
  const port = zones.flatMap((z) => z.ports.filter((p) => p.x === h.x && p.y === h.y).map((p) => ({ z, p })))[0];

  const plan = game.previewPlan();
  const hit = (c: EntitySummary) => rectContains(footprint(c), h.x, h.y);
  const ghost = plan
    ? ([
        ...plan.changes.added.filter(hit).map((c) => ({ c, label: '추가 예정', tone: 'text-blue-300' })),
        ...plan.changes.removed.filter(hit).map((c) => ({ c, label: '철거 예정', tone: 'text-red-300' })),
        ...plan.changes.modified.filter(hit).map((c) => ({ c, label: '변경 예정', tone: 'text-amber-300' })),
      ][0] ?? null)
    : null;

  if (!e && !ore && !ghost && !zones.length) return null;

  const def = e ? ENTITY_DEFS[e.type] : null;
  const minerOre = e?.type === 'miner' ? w.minerOre(e.x, e.y) : null;
  const left = h.sx + 16 + 260 > window.innerWidth ? h.sx - 276 : h.sx + 16;

  return (
    <div
      className="pointer-events-none fixed z-40 w-[260px] rounded-lg border border-gray-700 bg-gray-900/95 p-2.5 text-xs shadow-xl backdrop-blur"
      style={{ left, top: h.sy + 16 }}
    >
      <div className="mb-1 text-[10px] text-gray-500">
        ({h.x}, {h.y})
      </div>

      {ghost && (
        <div className="mb-2 rounded bg-gray-800/80 p-1.5">
          <span className={`font-semibold ${ghost.tone}`}>{ghost.label}</span>{' '}
          <span className="text-gray-200">
            {ENTITY_DEFS[ghost.c.type].name}
            {ghost.c.recipe ? ` · ${recipeName(ghost.c.recipe)}` : ''} · {DIR_LABEL[ghost.c.dir]}
          </span>
          {plan?.outsideZone?.entityIds.includes(ghost.c.id) && <div className="text-orange-300">구역 {plan.outsideZone.zoneId} 밖 변경</div>}
        </div>
      )}

      {e && def && (
        <div className="space-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-100">{def.name}</span>
            {e.type !== 'hub' && (
              <span className="flex items-center gap-1 text-gray-300">
                <span className={`h-2 w-2 rounded-full ${STATUS_DOT[e.status]}`} />
                {STATUS_LABELS[e.status]}
              </span>
            )}
          </div>
          <p className="pb-1 text-gray-400">{ENTITY_DESC[e.type]}</p>
          {e.type !== 'hub' && <Row label="방향">{DIR_LABEL[e.dir]}</Row>}
          {e.recipe && <Row label="레시피">{recipeName(e.recipe)}</Row>}
          {minerOre && (
            <Row label="채굴">
              {itemName(minerOre.ore)} · {PURITY_LABEL[minerOre.purity]} · {fmt(30 * minerOre.purity)}/m
            </Row>
          )}
          {def.category === 'transport' && (
            <Row label="운반">{e.slots.some((s) => s.item) ? e.slots.map((s) => (s.item ? itemName(s.item) : '·')).join(' ') : '비어 있음'}</Row>
          )}
          {Object.keys(e.inv).length > 0 && (
            <Row label="입력">
              <Items inv={e.inv} />
            </Row>
          )}
          {Object.keys(e.out).length > 0 && (
            <Row label="출력">
              <Items inv={e.out} />
            </Row>
          )}
          {def.powerKW > 0 && <Row label="전력">{def.powerKW} kW</Row>}
          {e.type === 'hub' && (
            <Row label="납품">
              <Items inv={w.state.delivered} />
            </Row>
          )}
        </div>
      )}

      {ore && (
        <div className={e ? 'mt-1.5 border-t border-gray-800 pt-1.5' : ''}>
          <Row label="지형">
            {itemName(ore)} 광맥 · {PURITY_LABEL[purity ?? 1]} (채굴기 {fmt(30 * (purity ?? 1))}/m)
          </Row>
        </div>
      )}

      {zones.length > 0 && (
        <div className="mt-1.5 border-t border-gray-800 pt-1.5 text-amber-300">
          {zones.map((z) => `${z.name} (${z.id})`).join(', ')}
          {port && <span className="text-gray-300"> · {port.p.kind === 'in' ? '입력' : '출력'} 포트 (잠김)</span>}
        </div>
      )}
    </div>
  );
}
