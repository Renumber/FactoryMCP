import { useState } from 'react';
import { sessionId } from '../game/bridge.ts';
import { useGame } from '../game/context.ts';

export function ConnectDialog({ onClose }: { onClose: () => void }) {
  const game = useGame();
  const url = game.mcpUrl || `${location.origin}/mcp?session=${sessionId()}`;
  const config = JSON.stringify({ mcpServers: { factorymcp: { url } } }, null, 2);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-[520px] rounded-xl border border-gray-700 bg-gray-900 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold">내 AI 에이전트 연결하기</h2>
        <p className="mt-1 text-sm text-gray-400">
          Cursor, Claude Desktop/Code 등 MCP를 지원하는 에이전트에 아래 서버를 추가하세요. 이 URL은 지금 열려 있는 게임 세션 전용입니다.
        </p>

        <label className="mt-4 block text-xs font-medium text-gray-400">MCP URL (Streamable HTTP)</label>
        <div className="mt-1 flex gap-2">
          <code className="flex-1 truncate rounded-md bg-gray-950 px-3 py-2 text-xs text-indigo-300">{url}</code>
          <button onClick={() => copy('url', url)} className="rounded-md bg-gray-800 px-3 text-xs hover:bg-gray-700">
            {copied === 'url' ? '복사됨' : '복사'}
          </button>
        </div>

        <label className="mt-4 block text-xs font-medium text-gray-400">mcp.json 설정 예시</label>
        <div className="relative mt-1">
          <pre className="rounded-md bg-gray-950 p-3 text-xs text-gray-300">{config}</pre>
          <button onClick={() => copy('config', config)} className="absolute right-2 top-2 rounded bg-gray-800 px-2 py-1 text-xs hover:bg-gray-700">
            {copied === 'config' ? '복사됨' : '복사'}
          </button>
        </div>

        <div className="mt-4 rounded-md bg-gray-800/60 p-3 text-xs leading-relaxed text-gray-300">
          예시 요청
          <ul className="mt-1 list-disc pl-4 text-gray-400">
            <li>"지금 뭘 생산해야 다음 티어로 갈 수 있어? 계획 세워줘"</li>
            <li>"z1 구역 효율이 안 좋아. 포트는 유지하고 최적화해서 제안해줘"</li>
            <li>"철판 생산을 2배로 늘리는 라인을 설계해줘"</li>
          </ul>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs text-gray-300">
            <input type="checkbox" checked={game.allowDirect} onChange={(e) => game.setAllowDirect(e.target.checked)} />
            에이전트 직접 실행 허용 (미리보기 없이 즉시 건설)
          </label>
          <button onClick={onClose} className="rounded-md bg-indigo-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-400">
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
