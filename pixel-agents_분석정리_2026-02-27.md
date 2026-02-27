# Pixel Agents 코드 분석 정리 (2026-02-27)

대상 리포지토리: `/Users/joy/workspace/pixel-agents`

요청 범위: **본체 소스 코드는 건드리지 않는 방향**으로, 현재 디렉토리 분석 및 “확장 가능성”을 중심으로 정리.

---

## 0) 한 줄 요약

Pixel Agents는 **VS Code 확장 + React(Webview) + Canvas 2D**로 구성된 툴이며, **Claude Code CLI가 남기는 JSONL transcript 파일을 관찰**해서 “에이전트(=터미널)”를 픽셀 캐릭터로 시각화합니다.

---

## 1) 핵심 개념(Agent / Session / Terminal)

Pixel Agents 내부에서의 정의는 다음처럼 정리되어 있습니다.

- **Terminal**: VS Code 터미널(Claude Code CLI가 실행되는 곳)
- **Agent**: Webview 상의 캐릭터(터미널과 1:1로 묶임)
- **Session**: JSONL conversation file (Claude Code transcript)

참고: `/Users/joy/workspace/pixel-agents/CLAUDE.md`의 Vocabulary 섹션.

---

## 2) JSONL 기반 “관찰(Observational)” 구조

### 2.1 JSONL 파일 위치/규칙

Claude Code transcript(JSONL)은 아래 경로로 가정합니다.

- `~/.claude/projects/<project-hash>/<session-id>.jsonl`
- `<project-hash>`는 workspace path를 `:`/`\`/`/` → `-`로 치환한 문자열

구현 근거:

- 프로젝트 폴더 경로 계산: `/Users/joy/workspace/pixel-agents/src/agentManager.ts`의 `getProjectDirPath()`
- Session ID 생성 + Claude 실행: `/Users/joy/workspace/pixel-agents/src/agentManager.ts`의 `launchNewTerminal()`에서 `crypto.randomUUID()` → `claude --session-id <uuid>`

### 2.2 에이전트 생성 플로우(+ Agent 버튼)

1) 터미널 생성 (`Claude Code #<n>`)  
2) `claude --session-id <uuid>` 실행  
3) `<uuid>.jsonl` 파일이 생길 것으로 “기대”하고 agent를 먼저 생성  
4) JSONL 파일이 생성될 때까지 폴링하다가 발견하면 파일 watcher 시작  

구현 근거:

- `/Users/joy/workspace/pixel-agents/src/agentManager.ts`의 `launchNewTerminal()`
- JSONL 파일 생성 폴링: `JSONL_POLL_INTERVAL_MS` 사용

### 2.3 외부 터미널/세션 “채택(adoption)” 및 `/clear` 처리

확장은 프로젝트 디렉토리(`~/.claude/projects/<hash>/`)에서 **새로운 `.jsonl` 파일 생성**을 감지해 다음을 수행합니다.

- 어떤 agent가 “활성 포커스(activeAgentId)” 상태면: 새 JSONL을 해당 agent로 재할당(`/clear` 상황으로 취급)
- 활성 포커스가 없고, 현재 포커스된 VS Code 터미널이 “아직 agent로 소유되지 않았다면”: 그 터미널을 채택해서 agent를 생성

구현 근거:

- `/Users/joy/workspace/pixel-agents/src/fileWatcher.ts`의 `ensureProjectScan()` / `scanForNewJsonlFiles()` / `adoptTerminalForFile()` / `reassignAgentToFile()`

중요 제약:

- “모든 기존 세션”을 자동으로 전부 로딩하는 구조가 아니라, **새로 생성되는 JSONL 파일**을 중심으로 반응합니다(초기 seed로 기존 파일들을 known set에 넣음).

---

## 3) 질문 1~3 답변(현 상태 기준)

### 3.1 “openclaw agent만 표시?” / “session도 확인 가능?”

- openclaw 전용이 아니라, **Claude Code CLI + VS Code 터미널** 기반 흐름이면 동작합니다.
- “session 확인”은 Pixel Agents UI 내에서 “리스트/뷰어”로 제공되진 않지만,
  - Settings에서 **Open Sessions Folder** 기능으로 JSONL 세션 폴더를 OS 파일 탐색기로 열 수 있습니다.
  - 별도 정적 도구로 `scripts/jsonl-viewer.html`이 있어 JSONL 폴더/파일을 브라우징할 수 있습니다.

구현 근거:

- UI 버튼: `/Users/joy/workspace/pixel-agents/webview-ui/src/components/SettingsModal.tsx` → `openSessionsFolder`
- 확장 메시지 핸들러: `/Users/joy/workspace/pixel-agents/src/PixelAgentsViewProvider.ts`에서 `openSessionsFolder` 처리
- 세션 뷰어: `/Users/joy/workspace/pixel-agents/scripts/jsonl-viewer.html`

### 3.2 “openclaw 아닌 외부 에이전트 스웜(Claude Code agent sdk swarm) 표시 가능?”

현 구조에서 “그대로”는 어렵습니다. 이유:

- agent는 **VS Code Terminal에 묶인 캐릭터**로 모델링되어 있고(`AgentState.terminalRef`),
- 상태 업데이트는 **Claude Code JSONL 포맷(assistant/user/system/progress/turn_duration 등)** 파싱에 강하게 의존합니다.

가능하게 만들려면(본체 수정 없이 현실적인 접근):

- 외부 스웜의 이벤트를 **Claude Code JSONL 유사 포맷으로 변환해** `~/.claude/projects/<hash>/` 아래에 기록하는 “브릿지(sidecar)”를 두는 방식이 가장 간단합니다.
  - Pixel Agents는 그대로 두고, “입력 데이터”만 맞추는 전략
  - 단, 이 경우도 “터미널 채택 로직” 때문에 **VS Code 터미널과의 연결(또는 채택 트리거)**을 어떻게 만들지 설계가 필요합니다.

구현 근거:

- JSONL 파서: `/Users/joy/workspace/pixel-agents/src/transcriptParser.ts`
- AgentState: `/Users/joy/workspace/pixel-agents/src/types.ts`

### 3.3 “별도 웹서버로 띄워서 외부에서도 볼 수 있나?”

현 상태 그대로는 어렵습니다. 이유:

- Web UI는 VS Code webview 전용 API(`acquireVsCodeApi`)를 전제로 합니다.
- 상태 데이터(agents/layout/tools)는 확장이 `postMessage`로 주입하는 구조입니다.

우회 방법(코드 변경 없이):

- VS Code 자체를 원격(터널/원격 개발/화면 공유 등)으로 열어 Pixel Agents 패널을 보는 방식
- “세션만” 보려면 `scripts/jsonl-viewer.html`로 JSONL을 브라우징하는 방식

진짜 “웹서버 + 외부 공개”를 하려면(확장 방향):

- JSONL watcher/파서를 VS Code 확장 밖(Node 서버)으로 분리하고
- WebSocket/HTTP로 UI에 이벤트를 푸시하는 구조로 재설계 필요
- 이 경우 인증/권한/로그 민감도(대화 내용 노출)도 같이 설계해야 함

---

## 4) 화면/렌더링 구조(픽셀 그리기)

### 4.1 레이어 구성

화면은 크게 2겹입니다.

1) **Canvas 2D**: 타일/벽/가구/캐릭터/말풍선/에디터 오버레이 일부를 픽셀로 렌더링  
2) **DOM Overlay(React)**: 하단 툴바, 줌 컨트롤, 설정 모달, hover/selected 툴 상태 라벨 등

핵심 파일:

- Canvas: `/Users/joy/workspace/pixel-agents/webview-ui/src/office/components/OfficeCanvas.tsx`
- 렌더러: `/Users/joy/workspace/pixel-agents/webview-ui/src/office/engine/renderer.ts`
- 게임 루프: `/Users/joy/workspace/pixel-agents/webview-ui/src/office/engine/gameLoop.ts`
- 오버레이(툴 상태 라벨): `/Users/joy/workspace/pixel-agents/webview-ui/src/office/components/ToolOverlay.tsx`

### 4.2 “픽셀 퍼펙트” 렌더링 핵심

- 캔버스 백버퍼를 **CSS 크기 × DPR**로 맞춰 “디바이스 픽셀” 해상도로 렌더링합니다.
- `ctx.scale(dpr)`를 쓰지 않고, **처음부터 디바이스 픽셀 좌표계로 그립니다.**
- `ctx.imageSmoothingEnabled = false`로 필터링을 끕니다.

구현 근거:

- `/Users/joy/workspace/pixel-agents/webview-ui/src/office/components/OfficeCanvas.tsx`의 `resizeCanvas()`
- `/Users/joy/workspace/pixel-agents/webview-ui/src/office/engine/gameLoop.ts`

### 4.3 스프라이트 데이터 구조와 캐싱

스프라이트는 아래 타입으로 표현됩니다.

- `SpriteData = string[][]` (각 픽셀은 `'#RRGGBB'`, 투명은 `''`)

그리고 매 프레임 픽셀을 직접 찍는 대신, 다음 전략을 씁니다.

- `getCachedSprite(sprite, zoom)`가 `SpriteData`를 “오프스크린 canvas”로 미리 래스터라이즈하고
- 메인 캔버스에는 `drawImage`로 그립니다.
- 캐시는 zoom별 `WeakMap<SpriteData, HTMLCanvasElement>`로 관리됩니다.

구현 근거:

- 타입: `/Users/joy/workspace/pixel-agents/webview-ui/src/office/types.ts`
- 캐시: `/Users/joy/workspace/pixel-agents/webview-ui/src/office/sprites/spriteCache.ts`

### 4.4 한 프레임 렌더 파이프라인

`renderFrame()` 기준으로, 대략 아래 순서로 그립니다.

1) 화면 클리어  
2) 맵을 viewport 중앙에 배치 + pan 적용(정수 픽셀로 정렬)  
3) 타일 렌더(바닥 + 벽의 베이스 색)  
4) 좌석 표시(선택된 agent가 있을 때)  
5) 벽(wall auto-tiling) 인스턴스를 “가구처럼” 만들어 z-sort에 포함  
6) 가구 + 캐릭터를 `zY`로 정렬해 렌더  
7) 말풍선(대기/권한) 렌더  
8) 에디터 오버레이(그리드, 고스트 프리뷰, 선택 강조, 삭제/회전 버튼 등)

구현 근거:

- `/Users/joy/workspace/pixel-agents/webview-ui/src/office/engine/renderer.ts`의 `renderFrame()`
- 벽 auto-tiling: `/Users/joy/workspace/pixel-agents/webview-ui/src/office/wallTiles.ts` (`getWallInstances()`)

---

## 5) “픽셀 렌더링 부분만” 분리 가능성

### 5.1 분리 대상(최소 단위)

현재 경계가 비교적 잘 잡혀 있어, 아래 디렉토리 묶음이 “픽셀 오피스 엔진”에 가깝습니다.

- `/Users/joy/workspace/pixel-agents/webview-ui/src/office/**`
- `/Users/joy/workspace/pixel-agents/webview-ui/src/constants.ts` (렌더/게임 로직 상수)

반대로 VS Code 종속이 강한 영역은 아래입니다.

- `/Users/joy/workspace/pixel-agents/webview-ui/src/vscodeApi.ts` (acquireVsCodeApi)
- `/Users/joy/workspace/pixel-agents/webview-ui/src/hooks/useExtensionMessages.ts` (확장 → webview 메시지 의존)
- `OfficeCanvas.tsx` 내부에 일부 `vscode.postMessage({type:'saveAgentSeats'})` 호출(렌더링과 별개로 “저장/연동” 목적)

### 5.2 브라우저(일반 웹)에서 표시 가능?

렌더링 자체(Canvas 2D, React)는 브라우저에서도 정상 동작합니다.

하지만 “현재 App 그대로” 실행하면 막히는 지점이 있습니다.

- `acquireVsCodeApi()`가 일반 브라우저에는 없어서 런타임 에러 발생 가능
- 초기 상태가 확장 메시지(`layoutLoaded` 등)를 전제로 설계되어 있음(`layoutReady`가 false면 Loading 표시)

즉, 브라우저에서 돌리려면(본체 코드 변경 없이도 가능한 아이디어 포함):

1) **목업 VS Code API + 목업 메시지 주입**  
   - `window.acquireVsCodeApi`를 스텁으로 제공  
   - `window.postMessage`로 `layoutLoaded`, `existingAgents`, `agentToolStart` 등을 흉내  
   - 장점: 기존 UI 흐름을 그대로 재사용  
   - 단점: 목업 이벤트/저장 로직을 별도로 구성해야 함

2) **픽셀 엔진(office)만 떼서 “Standalone 엔트리”를 별도로 구성**  
   - `useExtensionMessages`를 거치지 않고 `OfficeState`를 직접 생성/업데이트  
   - agent/툴 이벤트를 원하는 소스(WebSocket, 파일 tail, REST 등)로부터 주입  
   - 장점: 제품화(웹서버/외부 공개) 구조로 확장하기 쉬움  
   - 단점: App 조립을 새로 해야 함(레이아웃 로딩, 입력 이벤트, 설정 등)

---

## 6) 확장/연구 제안(다음 단계 아이디어)

본체 수정 없이 “연구” 관점에서 우선 해볼 만한 것들:

1) **JSONL → UI 이벤트 매핑 표 만들기**  
   - 어떤 JSONL 레코드가 어떤 webview 메시지(`agentToolStart`, `agentStatus`, `subagentToolStart`…)로 이어지는지 도식화  
   - 구현 근거: `/Users/joy/workspace/pixel-agents/src/transcriptParser.ts`

2) **외부 스웜 브릿지 설계(가짜 JSONL 생성)**  
   - 외부 스웜 로그를 “Claude Code JSONL 유사 포맷”으로 변환해 기록  
   - Pixel Agents는 관찰만 하도록 유지

3) **Browser Standalone PoC 설계(코드 수정 없이 가능한 범위 확인)**  
   - `scripts/jsonl-viewer.html`처럼, “web에서도 JSONL을 읽고 이벤트로 재생(playback)”하는 작은 실험 설계  
   - 렌더 엔진을 재사용할지(office), 단순 뷰어로 갈지(현재 jsonl-viewer) 결정

---

## 7) 참고 파일 인덱스

### 확장(backend)

- Agent/Terminal/Session 경로, 생성: `/Users/joy/workspace/pixel-agents/src/agentManager.ts`
- JSONL watcher/adoption: `/Users/joy/workspace/pixel-agents/src/fileWatcher.ts`
- JSONL parser → webview 메시지: `/Users/joy/workspace/pixel-agents/src/transcriptParser.ts`
- webview 메시지 라우팅: `/Users/joy/workspace/pixel-agents/src/PixelAgentsViewProvider.ts`

### Webview(UI)

- Canvas 컴포넌트: `/Users/joy/workspace/pixel-agents/webview-ui/src/office/components/OfficeCanvas.tsx`
- 렌더러: `/Users/joy/workspace/pixel-agents/webview-ui/src/office/engine/renderer.ts`
- 게임 루프: `/Users/joy/workspace/pixel-agents/webview-ui/src/office/engine/gameLoop.ts`
- 오피스 상태/캐릭터: `/Users/joy/workspace/pixel-agents/webview-ui/src/office/engine/officeState.ts`
- 스프라이트 캐시: `/Users/joy/workspace/pixel-agents/webview-ui/src/office/sprites/spriteCache.ts`
- VS Code 메시지 훅: `/Users/joy/workspace/pixel-agents/webview-ui/src/hooks/useExtensionMessages.ts`

### 보조 도구

- JSONL 세션 뷰어(정적 HTML): `/Users/joy/workspace/pixel-agents/scripts/jsonl-viewer.html`

