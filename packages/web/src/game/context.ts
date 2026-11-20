import { createContext, useContext, useSyncExternalStore } from 'react';
import type { GameController } from './controller.ts';

export const GameContext = createContext<GameController | null>(null);

/** Returns the controller and re-renders on every controller notify (about 4 Hz while running). */
export function useGame(): GameController {
  const game = useContext(GameContext);
  if (!game) throw new Error('useGame outside GameContext');
  useSyncExternalStore(game.subscribe, game.getVersion);
  return game;
}
