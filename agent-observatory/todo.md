# Web 코드 리뷰 수정 Todo

> 대상: `packages/web/src/` (Pixel 뷰 제외)

## 🔴 CRITICAL

- [x] **#1** `useSocket.ts` — 이벤트 리스너 이중 등록 위험 (`client-data-duplicate-listeners`)
  - `App.tsx`와 `DashboardView.tsx`에서 `useSocket()` 중복 호출, React StrictMode 경쟁 조건
  - 개선: Context Provider로 전환

- [x] **#2** `Cost*Chart.tsx`, `TokensAnalyticsChart.tsx` — 차트 4개 각자 독립 fetch (`waterfall-parallel-fetch`)
  - analytics 탭 진입 시 4개 컴포넌트가 각자 별도 fetch, 에러도 `.catch(() => null)`로 무시
  - 개선: `MetricsPanel`에서 `Promise.all()`로 병렬화

- [x] **#3** `RelationshipGraph.tsx:14–25` — `agents` Map 전체를 의존성으로 사용해 매 WebSocket 이벤트마다 hierarchy 재fetch (`waterfall-unnecessary-refetch`)
  - `agentStore`가 `new Map()`으로 매번 새 참조 생성 → 무한 재fetch
  - 개선: `agents.size`를 의존성으로 사용

- [x] **#4** `AgentCardFilters.tsx` + `AgentCardGrid.tsx` — `/api/v1/agents/by-team` 중복 호출 (`client-data-duplicate-requests`)
  - 같은 엔드포인트를 두 컴포넌트에서 독립적으로 fetch
  - 개선: 상위에서 한 번만 fetch하여 props로 전달

## 🟠 IMPORTANT

- [x] **#5** `useActivityFeed.ts:13–33` — `isPaused` 변경 시 이벤트 리스너 재등록으로 이벤트 누락 가능 (`rerender-use-ref-transient-values`)
  - 개선: `isPausedRef`로 관리, 의존성 배열에서 제거

- [x] **#6** `AgentDetailPanel.tsx:23–38` — `VITE_MOCK !== 'false'` 조건 역전 버그
  - 미설정 시(`undefined`)도 early return → 실서버 모드에서 에이전트 이벤트 히스토리 미fetch
  - 개선: `VITE_MOCK === 'true'` 조건으로 변경

- [x] **#7** `AgentCard.tsx:103–138` — 동일 `entries` 배열 두 번 정렬 + `React.memo` 미적용 (`rerender-memo`)
  - 개선: `useMemo` + `React.memo` 적용

- [x] **#8** `App.tsx:18–20` — 뷰 전환 시 완전 언마운트/리마운트 (`rendering-conditional-mount`)
  - `&&` 조건부 렌더링으로 뷰 전환마다 전체 재마운트, 모든 fetch 재실행
  - 개선: `hidden` 클래스로 마운트 유지

- [x] **#9** `SessionReplayView.tsx:108–114` — playback effect `currentIndex` 의존으로 타이머 이중 실행 가능 (`rerender-stale-closure`)
  - 개선: `currentIndex`를 ref로 관리, 의존성 제거

## 🟡 MEDIUM

- [x] **#10** `StatusBar.tsx:13–14` — 매 렌더마다 `Array.from(agents.values()).filter(...)` 실행 (`rerender-memo`)
  - 개선: zustand selector로 파생 값 구독

- [x] **#11** `AgentCardGrid.tsx:149` — `e: any` 타입 사용 (TypeScript strict mode 위반)
  - 개선: `React.ChangeEvent<HTMLSelectElement>` 명시
