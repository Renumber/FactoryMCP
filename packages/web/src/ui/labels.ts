import { ITEMS, RECIPES, type EntityStatus, type ItemId, type RecipeId } from '@factorymcp/sim';

export const STATUS_LABELS: Record<EntityStatus, string> = {
  working: '가동 중',
  idle: '대기',
  starved: '재료 부족',
  blocked: '출력 막힘',
  no_power: '전력 부족',
  no_fuel: '연료 없음',
  no_recipe: '레시피 없음',
  no_ore: '광석 없음',
  unlinked: '출구 없음',
};

export const STATUS_DOT: Record<EntityStatus, string> = {
  working: 'bg-emerald-400',
  idle: 'bg-gray-500',
  starved: 'bg-amber-400',
  blocked: 'bg-orange-400',
  no_power: 'bg-red-400',
  no_fuel: 'bg-red-400',
  no_recipe: 'bg-gray-400',
  no_ore: 'bg-red-400',
  unlinked: 'bg-red-400',
};

export function itemName(id: string): string {
  return ITEMS[id as ItemId]?.name ?? id;
}

export function itemColor(id: string): string {
  const c = ITEMS[id as ItemId]?.color ?? 0x888888;
  return `#${c.toString(16).padStart(6, '0')}`;
}

export function recipeName(id: string): string {
  return RECIPES[id as RecipeId]?.name ?? id;
}

export function fmt(n: number | undefined, digits = 1): string {
  if (n === undefined) return '-';
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}
