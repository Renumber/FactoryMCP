import { useEffect, useRef, useState } from 'react';
import { connectBridge } from './game/bridge.ts';
import { GameContext } from './game/context.ts';
import { GameController } from './game/controller.ts';
import { Renderer } from './render/renderer.ts';
import { AgentPanel } from './ui/AgentPanel.tsx';
import { HoverTooltip } from './ui/HoverTooltip.tsx';
import { HubBar } from './ui/HubBar.tsx';
import { Inspector } from './ui/Inspector.tsx';
import { Palette } from './ui/Palette.tsx';
import { Toasts } from './ui/Toasts.tsx';
import { TopBar } from './ui/TopBar.tsx';
import { Zones } from './ui/Zones.tsx';

export function App() {
  const [game] = useState(() => new GameController());
  const canvasRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<'build' | 'agent'>('build');

  useEffect(() => {
    game.start();
    const disconnect = connectBridge(game);
    const renderer = new Renderer(game);
    void renderer.init(canvasRef.current!);
    return () => {
      renderer.destroy();
      disconnect();
      game.stop();
    };
  }, [game]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.metaKey || e.ctrlKey) return;
      switch (e.key.toLowerCase()) {
        case 'r':
          game.rotate();
          break;
        case 'escape':
          game.setTool({ kind: 'select' });
          game.selectedId = null;
          game.notify();
          break;
        case 'x':
          game.setTool({ kind: 'remove' });
          break;
        case 'z':
          game.setTool({ kind: 'zone' });
          break;
        case 'p':
          game.setSpeed(game.speed === 0 ? 1 : 0);
          break;
        case 'delete':
        case 'backspace':
          if (game.selectedId !== null) {
            const sel = game.world.getEntity(game.selectedId);
            if (sel) game.removeAt(sel.x, sel.y);
          }
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game]);

  useEffect(() => {
    let last = game.previewPlanId;
    const onPlan = () => {
      if (game.previewPlanId && game.previewPlanId !== last) setTab('agent');
      last = game.previewPlanId;
    };
    return game.subscribe(onPlan);
  }, [game]);

  return (
    <GameContext.Provider value={game}>
      <div className="flex h-full flex-col bg-gray-950 text-gray-100">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <div className="relative min-w-0 flex-1">
            <div ref={canvasRef} className="absolute inset-0" />
            <HubBar />
            <Toasts />
            <HoverTooltip />
          </div>
          <aside className="flex w-[340px] shrink-0 flex-col border-l border-gray-800 bg-gray-900">
            <div className="flex border-b border-gray-800 text-sm">
              {(['build', 'agent'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`flex-1 py-2.5 font-medium transition ${tab === t ? 'border-b-2 border-indigo-400 text-gray-100' : 'text-gray-400 hover:text-gray-200'}`}
                >
                  {t === 'build' ? '건설' : '에이전트'}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {tab === 'build' ? (
                <>
                  <Palette />
                  <Inspector />
                  <Zones />
                </>
              ) : (
                <AgentPanel />
              )}
            </div>
          </aside>
        </div>
      </div>
    </GameContext.Provider>
  );
}
