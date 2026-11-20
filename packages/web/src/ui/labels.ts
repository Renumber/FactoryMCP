import { ITEMS, RECIPES, type EntityStatus, type EntityType, type ItemId, type RecipeId } from '@factorymcp/sim';

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

export const ENTITY_DESC: Record<EntityType, string> = {
  belt: '60/m. 화살표 방향으로 운반. 뒤와 양옆에서 받고, 앞에서는 받지 않음.',
  fast_belt: '180/m. 화살표 방향으로 운반. 뒤와 양옆에서 받음.',
  splitter: '뒤에서 받아 왼쪽·오른쪽으로 번갈아 내보냄.',
  merger: '뒤·왼쪽·오른쪽에서 받아 앞으로 합쳐 내보냄.',
  tunnel_in: '뒤에서만 받음. 앞쪽 5칸 안의 같은 방향 출구로 지하 이동.',
  tunnel_out: '연결된 터널 입구에서 받은 아이템을 앞으로 내보냄.',
  miner: '광석 위에 설치. 보통 30/m, 저순도 15/m, 고순도 60/m.',
  stone_furnace: '광석을 판으로 제련. 연료로 석탄 3/m 필요, 전력 불필요.',
  electric_furnace: '1.5배 속도 제련. 석탄 불필요, 전력 180kW.',
  assembler: '뒤·양옆으로 재료 입력, 앞으로 출력.',
  coal_generator: '전력망에 1.2MW 추가. 최대 석탄 15/m.',
  hub: '모든 가장자리에서 아이템을 받아 납품. 기본 전력 1MW 공급.',
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
