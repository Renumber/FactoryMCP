# FactoryMCP

내 AI 에이전트를 MCP로 연결해서 함께 공장을 설계·최적화하는 2D 타일 공장 시뮬레이션 (Phase 1 PoC).

플레이어가 게임을 멈추고 "지금 뭘 만들어야 해?", "z1 구역 효율 안 좋은데 최적화해줘"라고 요청하면,
에이전트가 MCP 도구로 공장을 조사하고 시뮬레이션으로 검증한 뒤 **고스트 미리보기(Diff)** 로 제안합니다.
플레이어가 승인하면 즉시 시공됩니다.

## 구조

```
packages/
  sim/          순수 TS 시뮬레이션 엔진 (20 TPS 고정 틱, 브라우저·서버 공용)
  mcp-server/   Hono + WebSocket 브릿지 + MCP(Streamable HTTP) 도구
  web/          React 19 + PixiJS 8 + Tailwind 4 게임 클라이언트
```

- 라이브 월드는 **브라우저**가 소유합니다. MCP 도구가 호출되면 서버가 WebSocket으로 스냅샷을 요청하고,
  같은 `sim` 코드로 검증·시뮬레이션한 결과를 돌려줍니다.
- 서버 ↔ 브라우저 연결은 `SessionBridge` 인터페이스로 추상화되어 있습니다 (PoC 구현: `InMemoryWsBridge`).

## 실행

```bash
pnpm install
pnpm dev        # server :8787 + web :5173
```

브라우저에서 http://localhost:5173 을 열고 상단 **에이전트 연결** 버튼에서 MCP URL을 복사해 에이전트에 등록합니다.

```json
{ "mcpServers": { "factorymcp": { "url": "http://localhost:5173/mcp?session=<게임에 표시된 세션>" } } }
```

개발 모드에서는 열린 게임이 하나뿐이면 `?session` 없이도 그 세션에 연결됩니다.

프로덕션: `pnpm build && pnpm start` (서버 하나가 `/mcp`, `/ws`, 정적 파일을 모두 제공, 포트 `PORT`, 외부 주소 `PUBLIC_URL`).

## 조작

| 입력 | 동작 |
| --- | --- |
| 좌클릭 / 드래그 | 배치, 벨트 깔기(L자 경로), 철거, 구역 지정 |
| 우클릭 | 도구 취소 / 우클릭·휠클릭 드래그로 화면 이동 |
| 휠 | 확대·축소 |
| R | 회전 |
| X / Z / Esc | 철거 / 구역 지정 / 선택 |
| P | 일시정지 토글 |
| Del | 선택한 설비 철거 |

## MCP 도구

| 도구 | 설명 |
| --- | --- |
| `get_overview` | 티어 목표, 허브 납품량·속도, 전력, 광맥, 구역 |
| `get_rules_and_recipes` | 규칙, 패치 문법, 설비 포트, 레시피 |
| `get_map` / `inspect_region` / `inspect_zone` | ASCII 지도 + 설비 상태·버퍼·절대 포트 좌표 |
| `measure` | 사본을 돌려 정상 상태 생산량, 가동률, 병목 측정 |
| `simulate_patch` | 패치 검증(op 인덱스·좌표 포함 에러) + 전/후 지표 |
| `propose_refactor` | 고스트 Diff로 게임에 제안, 플레이어가 승인/거절 |
| `list_plans` | 제안 상태 확인 |
| `execute_actions` | 직접 실행 (게임에서 허용했을 때만) |
| `set_simulation_speed`, `get_notes`, `set_notes` | 속도, 공유 메모 |

에이전트는 `belt_path`(직각 폴리라인)로 직접 경로를 설계하고 `simulate_patch`의 에러 피드백으로 고칩니다.

## 테스트

```bash
pnpm test
pnpm typecheck
```
