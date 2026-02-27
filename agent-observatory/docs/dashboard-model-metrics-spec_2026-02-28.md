# Dashboard 모델/토큰 메트릭 개선 스펙 (v2 추가분)

> 작성일: 2026-02-28
> 기반 문서: `FE-dashboard-spec_2026-02-27.md`
> 배경: model_id, 캐시 토큰, llm.end 이벤트 수집 기능 추가로 인한 UI 개선

---

## 0. 개요

이번 브랜치(`feat/metrics-model-tracking`)에서 수집 가능해진 데이터:

| 데이터 | 출처 | 이전 수집 |
|--------|------|----------|
| `model_id` (세션 레벨) | Claude Code Hooks `SessionStart` | ❌ |
| `model_id` (메시지 레벨) | OpenClaw assistant message | ❌ |
| `input_tokens` / `output_tokens` | OpenClaw `metrics.usage` | ❌ |
| `cache_creation_input_tokens` | OpenClaw `metrics.usage` | ❌ |
| `cache_read_input_tokens` | OpenClaw `metrics.usage` | ❌ |
| `llm.end` 이벤트 (text_length, model_id) | OpenClaw | ❌ |
| `tool.error.is_interrupt` | Claude Code Hooks `PostToolUseFailure` | ❌ |

이 데이터를 5개 UI 영역에 반영한다.

---

## 1. 데이터 계약 변경

### 1.1 AgentLiveState 확장

`packages/shared/src/types/agent.ts`에 추가:

```typescript
interface AgentLiveState {
  // … 기존 필드 …

  // === 신규: 모델 정보 ===
  /** 현재 세션에서 마지막으로 확인된 LLM 모델 ID */
  model_id?: string;

  // === 신규: 토큰 세부 분류 ===
  token_breakdown: {
    input_tokens: number;
    output_tokens: number;
    /** 캐시 생성에 쓴 토큰 (비용 발생) */
    cache_creation_tokens: number;
    /** 캐시에서 읽은 토큰 (비용 절감) */
    cache_read_tokens: number;
  };

  // === 신규: LLM 응답 통계 ===
  llm_response_count: number;         // llm.end 이벤트 수
  llm_total_text_length: number;      // 전체 응답 텍스트 길이 합
}
```

### 1.2 MetricsSnapshot 확장

`packages/shared/src/types/metrics.ts`에 추가:

```typescript
interface MetricsSnapshot {
  // … 기존 필드 …

  // === 신규: 모델 분포 ===
  /** 모델 ID → { 에이전트 수, 토큰 수 } */
  model_distribution: Record<string, {
    agent_count: number;
    token_count: number;
  }>;

  // === 신규: 캐시 통계 ===
  /** 전체 캐시 히트율: cache_read / (input + cache_read), 0~1 */
  cache_hit_rate: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;

  // === 신규: LLM 통계 ===
  /** llm.end 이벤트 수/분 (최근 1분) */
  llm_responses_per_minute: number;

  // timeseries에 추가
  timeseries: {
    // … 기존 …
    cache_hit_rate: number[];          // 60개 (1분 단위)
    llm_responses_per_minute: number[];// 60개
  };
}
```

### 1.3 서버 측 처리 규칙

**StateManager** — `metrics.usage` 이벤트 수신 시:
```
token_breakdown.input_tokens          += event.data.input_tokens
token_breakdown.output_tokens         += event.data.output_tokens
token_breakdown.cache_creation_tokens += event.data.cache_creation_input_tokens ?? 0
token_breakdown.cache_read_tokens     += event.data.cache_read_input_tokens ?? 0
```

**StateManager** — `llm.end` 이벤트 수신 시:
```
llm_response_count   += 1
llm_total_text_length += event.data.text_length ?? 0
if event.model_id: model_id = event.model_id
```

**MetricsAggregator** — `metrics.usage` 이벤트 수신 시:
```typescript
// model_distribution 집계
const mid = event.data.model_id ?? event.model_id ?? 'unknown';
dist[mid] ??= { agent_count: 0, token_count: 0 };
dist[mid].token_count += (event.data.tokens ?? 0);

// agent_count: StateManager에서 model_id별 에이전트 집합으로 계산
```

---

## 2. Agent Card (🔴 1순위)

### 변경 파일
`packages/web/src/views/Dashboard/AgentCard.tsx`

### 변경 내용

```
변경 전:
┌──────────────────────────────┐
│ [CC] Claude Code #1      [●]│
│ Status: Acting               │
│ Tool:   Bash (command)       │
│ Tokens: 12.3k    Cost: $0.18│
│ Tools:  47        Errors: 0  │
│ Session: 15m ago             │
│ [████████░░] 도구분포         │
└──────────────────────────────┘

변경 후:
┌──────────────────────────────┐
│ [CC] Claude Code #1  [Sonnet]│  ← 모델 뱃지 (우상단, 소스뱃지 옆)
│                           [●]│
│ Status: Acting               │
│ Tool:   Bash (command)       │
│                              │
│ Tokens: 12.3k   Cache: 71%  │  ← Cost → Cache%로 교체 (비용은 Detail에)
│ Tools:  47        Errors: 0  │
│ Session: 15m ago             │
│ [████████░░] 도구분포         │
└──────────────────────────────┘
```

> **캐시율** = `cache_read_tokens / (input_tokens + cache_read_tokens)`. OpenClaw가 수집하지 않을 경우 undefined → 표시 안 함.

### 모델 뱃지 스펙

```typescript
// utils/colors.ts에 추가
export const MODEL_BADGE: Record<string, { label: string; color: string }> = {
  'claude-opus-4-6':    { label: 'Opus',   color: '#7c3aed' },
  'claude-sonnet-4-6':  { label: 'Sonnet', color: '#ea580c' },
  'claude-haiku-4-5-20251001': { label: 'Haiku', color: '#0891b2' },
  'claude-haiku-4-5':   { label: 'Haiku', color: '#0891b2' },
};
// 미매핑 모델: label = 앞 8자, color = #6b7280 (gray)

// 뱃지 렌더링 예시
function ModelBadge({ modelId }: { modelId?: string }) {
  if (!modelId) return null;
  const badge = MODEL_BADGE[modelId] ?? {
    label: modelId.slice(0, 8),
    color: '#6b7280',
  };
  return (
    <span
      className="text-xs font-medium px-1.5 py-0.5 rounded"
      style={{ backgroundColor: badge.color + '20', color: badge.color, border: `1px solid ${badge.color}40` }}
    >
      {badge.label}
    </span>
  );
}
```

### 캐시율 표시

```typescript
function CacheRateBadge({ breakdown }: { breakdown?: AgentLiveState['token_breakdown'] }) {
  if (!breakdown) return null;
  const total = breakdown.input_tokens + breakdown.cache_read_tokens;
  if (total === 0) return null;
  const rate = Math.round((breakdown.cache_read_tokens / total) * 100);
  const color = rate >= 60 ? 'text-emerald-400' : rate >= 30 ? 'text-amber-400' : 'text-slate-400';
  return <span className={`text-xs ${color}`}>Cache: {rate}%</span>;
}
```

---

## 3. Activity Feed (🔴 1순위)

### 변경 파일
`packages/web/src/views/Dashboard/ActivityFeedItem.tsx`

### 신규: `llm.end` 이벤트 렌더링

```
기존 이벤트 타입 목록에 추가:

llm.end →
  🤖 [Sonnet] LLM response · 245 chars
                               ↑ 캐시율 있으면: · Cache 89%

표시 색상: text-indigo-300 (LLM 특화)
아이콘: 🤖 또는 Lucide <Bot> 아이콘
```

```typescript
case 'llm.end': {
  const model = event.model_id;
  const badge = model ? MODEL_BADGE[model] : undefined;
  const textLen = event.data?.text_length as number | undefined;
  const cacheRate = event.data?.cache_hit_rate as number | undefined;
  return (
    <span>
      {badge && <ModelBadge modelId={model} />}
      {' '}LLM response
      {textLen !== undefined && ` · ${formatNumber(textLen)} chars`}
      {cacheRate !== undefined && cacheRate > 0 && (
        <span className="text-emerald-400"> · Cache {Math.round(cacheRate * 100)}%</span>
      )}
    </span>
  );
}
```

### 변경: `tool.error` 인터럽트 구분

```
기존: ✗ Bash  "command timed out"   (빨강)

변경 후:
  is_interrupt: false → ✗ Bash  "command timed out"    (빨강, 실제 오류)
  is_interrupt: true  → ⚡ Bash  Interrupted by user    (slate-400, 중립)
```

```typescript
case 'tool.error': {
  const isInterrupt = event.data?.is_interrupt as boolean | undefined;
  if (isInterrupt) {
    return (
      <span className="text-slate-400">
        ⚡ {toolName} · Interrupted
      </span>
    );
  }
  return (
    <span className="text-red-400">
      ✗ {toolName} · {(event.data?.error as string)?.slice(0, 80) ?? 'Error'}
    </span>
  );
}
```

---

## 4. Status Bar (🟡 2순위)

### 변경 파일
`packages/web/src/views/Dashboard/StatusBar.tsx`

### 변경 내용

```
변경 전:
● 4 agents   1.2k tok/min   $0.42/hr   ⚠ 0   🟢 Connected

변경 후:
● 4 agents   1.2k tok/min   Cache: 68%   ⚠ 0   🟢 Connected
[Sonnet ×3] [Haiku ×1]
```

모델 칩은 `metrics.model_distribution`의 `agent_count`가 1 이상인 항목만 표시.

```typescript
// MetricsSnapshot.model_distribution 소비
const modelChips = Object.entries(metrics.model_distribution)
  .filter(([, v]) => v.agent_count > 0)
  .sort((a, b) => b[1].agent_count - a[1].agent_count)
  .map(([modelId, { agent_count }]) => {
    const badge = MODEL_BADGE[modelId];
    return (
      <ModelChip key={modelId} modelId={modelId} count={agent_count} />
    );
  });
```

---

## 5. Metrics Panel — 신규 차트 2개 (🟢 3순위)

### 변경 파일
`packages/web/src/views/Dashboard/MetricsPanel.tsx`
신규: `charts/ModelDistributionChart.tsx`, `charts/CacheEfficiencyChart.tsx`

### 차트 5: ModelDistributionChart

```
데이터 소스: MetricsSnapshot.model_distribution

표시 형태: 수평 누적 바 (Recharts BarChart)

Sonnet 4.6  [████████████████████] 78k tok  62%
Haiku 4.5   [███████████] 42k tok           33%
Opus 4.6    [██] 6k tok                      5%
────────────────────────────────────────
Total: 126k tokens

색상: MODEL_BADGE color 재사용
```

### 차트 6: CacheEfficiencyChart

```
데이터 소스: MetricsSnapshot.timeseries.cache_hit_rate (60포인트)

표시 형태: 라인 차트 (Recharts LineChart)

100% │
 80% │         ╭──────────────
 60% │   ╭─────╯
 40% │───╯
     └──────────────────────── 60min

하단 수치:
  Cache Reads: 92k    Cache Creates: 8k    Hit Rate: 67%

색상: emerald-400 (히트율), amber-400 (그리드라인 60% 기준선)
```

---

## 6. Detail Panel — 토큰 Breakdown (🟢 3순위)

미구현 상태인 `AgentDetailPanel.tsx` 구현 시 포함할 섹션:

```
─── Token Usage ───────────────────────────────
                    0          50k        100k
Input tokens:      [████████████░░░░░░░░] 45,231
Cache reads:       [████████████████████] 92,108
Cache writes:      [░░░░░░░░░░░░░░░░░███]  8,012
Output tokens:     [████░░░░░░░░░░░░░░░░] 12,445

Cache Hit Rate: 67%    Est. saved: ~$0.18
Total: 157,796 tokens   Est. cost: $0.43

─── LLM Responses ─────────────────────────────
12 responses · avg 245 chars · max 892 chars
```

**Est. saved 계산**: `cache_read_tokens × (input_price_per_mtok - cache_read_price_per_mtok) / 1_000_000`
모델별 가격은 `packages/shared/src/pricing.ts` (별도 추가 필요)에 상수로 정의.

---

## 7. 구현 순서 체크리스트

```
Phase A — 데이터 계약 (서버 + shared)
  □ shared: AgentLiveState에 model_id, token_breakdown, llm_response_count 추가
  □ shared: MetricsSnapshot에 model_distribution, cache_hit_rate 추가
  □ server: StateManager — metrics.usage, llm.end 이벤트 집계 처리
  □ server: MetricsAggregator — model별 집계 추가

Phase B — FE 1순위 (기존 컴포넌트 수정)
  □ web: utils/colors.ts — MODEL_BADGE 추가
  □ web: AgentCard.tsx — ModelBadge, CacheRateBadge 컴포넌트 추가
  □ web: ActivityFeedItem.tsx — llm.end 케이스 추가, tool.error 인터럽트 구분

Phase C — FE 2순위
  □ web: StatusBar.tsx — 모델 칩 + Cache% 추가

Phase D — FE 3순위 (신규 컴포넌트)
  □ web: charts/ModelDistributionChart.tsx
  □ web: charts/CacheEfficiencyChart.tsx
  □ web: MetricsPanel.tsx — 두 차트 추가
  □ web: AgentDetailPanel.tsx — 토큰 Breakdown 섹션 포함 구현
```

---

## 부록: 데이터 미수집 시 폴백

Claude Code JSONL 전용 에이전트(Hooks 미설정, OpenClaw 미사용)는 토큰 데이터가 없습니다.

| 필드 없을 때 | UI 표시 |
|------------|---------|
| `model_id` 없음 | 모델 뱃지 미표시 |
| `token_breakdown` 없음 | Cache% 미표시, Tokens: 0 |
| `model_distribution` 비어있음 | 모델 칩 미표시 |
| `cache_hit_rate` = 0 | 차트 표시하나 "N/A" 표기 |
