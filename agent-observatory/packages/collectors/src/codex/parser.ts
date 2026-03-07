/**
 * Codex JSONL 파서.
 *
 * ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl 파일의 각 줄을 파싱하여
 * 구조화된 레코드로 변환한다.
 *
 * 처리 대상:
 *   type: "session_meta"         → 세션 메타데이터 (agent_nickname, cwd, model_provider)
 *   type: "turn_context"         → 턴별 컨텍스트 (model, turn_id, cwd)
 *   type: "event_msg"
 *     subtype: "task_started"    → 턴 시작 (turn_id, model_context_window)
 *     subtype: "task_complete"   → 턴 완료 (turn_id, last_agent_message)
 *     subtype: "user_message"    → 사용자 입력 (message)
 *     subtype: "agent_message"   → 에이전트 메시지 (message, phase)
 *     subtype: "token_count"     → 토큰 사용량 (total_token_usage)
 *   type: "response_item"
 *     subtype: "function_call"   → 도구 호출 시작 (name, arguments, call_id)
 *     subtype: "function_call_output" → 도구 호출 결과 (call_id, output)
 *
 * 무시: compacted, response_item/message, response_item/reasoning, response_item/web_search_call
 *       event_msg/context_compacted, event_msg/turn_aborted
 */

/** Codex 세션 메타데이터 */
export interface CdxSessionMeta {
  kind: 'session_meta';
  id: string;
  timestamp: string;
  cwd?: string;
  originator?: string;
  modelProvider?: string;
  /** 에이전트 닉네임 (서브에이전트인 경우) */
  agentNickname?: string;
  /** 에이전트 역할 (서브에이전트인 경우) */
  agentRole?: string;
  /** 부모 스레드 ID (서브에이전트인 경우) */
  parentThreadId?: string;
}

/** 턴별 컨텍스트 */
export interface CdxTurnContext {
  kind: 'turn_context';
  turnId: string;
  model?: string;
  cwd?: string;
  timestamp: string;
}

/** 턴 시작 이벤트 */
export interface CdxTaskStarted {
  kind: 'task_started';
  turnId: string;
  modelContextWindow?: number;
  timestamp: string;
}

/** 턴 완료 이벤트 */
export interface CdxTaskComplete {
  kind: 'task_complete';
  turnId: string;
  timestamp: string;
}

/** 사용자 메시지 */
export interface CdxUserMessage {
  kind: 'user_message';
  message: string;
  timestamp: string;
}

/** 에이전트 메시지 */
export interface CdxAgentMessage {
  kind: 'agent_message';
  message: string;
  phase?: string;
  timestamp: string;
}

/** 토큰 사용량 */
export interface CdxTokenCount {
  kind: 'token_count';
  /** 세션 누적 토큰 사용량 */
  totalInputTokens: number;
  totalCachedInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  /** 마지막 턴 토큰 사용량 */
  lastInputTokens?: number;
  lastCachedInputTokens?: number;
  lastOutputTokens?: number;
  timestamp: string;
}

/** 함수(도구) 호출 */
export interface CdxFunctionCall {
  kind: 'function_call';
  name: string;
  /** JSON 문자열 */
  arguments: string;
  callId: string;
  timestamp: string;
}

/** 함수(도구) 호출 결과 */
export interface CdxFunctionCallOutput {
  kind: 'function_call_output';
  callId: string;
  output: string;
  timestamp: string;
}

/** 파서가 반환하는 모든 레코드 타입의 합집합 */
export type CdxParsedRecord =
  | CdxSessionMeta
  | CdxTurnContext
  | CdxTaskStarted
  | CdxTaskComplete
  | CdxUserMessage
  | CdxAgentMessage
  | CdxTokenCount
  | CdxFunctionCall
  | CdxFunctionCallOutput;

// ─── 내부 헬퍼 ───────────────────────────────────────────────────────────────

function asStr(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asNum(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

function asObj(v: unknown): Record<string, unknown> | undefined {
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return undefined;
}

// ─── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * 단일 JSONL 줄을 파싱하여 CdxParsedRecord 배열을 반환한다.
 */
export function parseLine(line: string): CdxParsedRecord[] {
  const trimmed = line.trim();
  if (trimmed.length === 0) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }

  if (typeof parsed !== 'object' || parsed === null) return [];

  const record = parsed as Record<string, unknown>;
  const type = asStr(record.type);
  const timestamp = asStr(record.timestamp) ?? new Date().toISOString();
  const payload = asObj(record.payload);

  if (!type || !payload) return [];

  // ── session_meta ─────────────────────────────────────────────────────────
  if (type === 'session_meta') {
    const id = asStr(payload.id);
    if (!id) return [];

    const sourcePayload = payload.source;
    let parentThreadId: string | undefined;
    let agentNickname = asStr(payload.agent_nickname);
    let agentRole = asStr(payload.agent_role);

    // source: { subagent: { thread_spawn: { parent_thread_id, ... } } }
    const sourceObj = asObj(sourcePayload);
    if (sourceObj) {
      const subagent = asObj(sourceObj.subagent);
      if (subagent) {
        const threadSpawn = asObj(subagent.thread_spawn);
        if (threadSpawn) {
          parentThreadId = asStr(threadSpawn.parent_thread_id);
          if (!agentNickname) agentNickname = asStr(threadSpawn.agent_nickname);
          if (!agentRole) agentRole = asStr(threadSpawn.agent_role);
        }
      }
    }

    return [
      {
        kind: 'session_meta',
        id,
        timestamp: asStr(payload.timestamp) ?? timestamp,
        cwd: asStr(payload.cwd),
        originator: asStr(payload.originator),
        modelProvider: asStr(payload.model_provider),
        agentNickname,
        agentRole,
        parentThreadId,
      },
    ];
  }

  // ── turn_context ─────────────────────────────────────────────────────────
  if (type === 'turn_context') {
    const turnId = asStr(payload.turn_id);
    if (!turnId) return [];

    return [
      {
        kind: 'turn_context',
        turnId,
        model: asStr(payload.model),
        cwd: asStr(payload.cwd),
        timestamp,
      },
    ];
  }

  // ── event_msg ────────────────────────────────────────────────────────────
  if (type === 'event_msg') {
    const subtype = asStr(payload.type);

    if (subtype === 'task_started') {
      const turnId = asStr(payload.turn_id);
      if (!turnId) return [];
      return [
        {
          kind: 'task_started',
          turnId,
          modelContextWindow: asNum(payload.model_context_window),
          timestamp,
        },
      ];
    }

    if (subtype === 'task_complete') {
      const turnId = asStr(payload.turn_id);
      if (!turnId) return [];
      return [{ kind: 'task_complete', turnId, timestamp }];
    }

    if (subtype === 'user_message') {
      const message = asStr(payload.message) ?? '';
      if (message.length === 0) return [];
      return [{ kind: 'user_message', message, timestamp }];
    }

    if (subtype === 'agent_message') {
      const message = asStr(payload.message) ?? '';
      if (message.length === 0) return [];
      return [
        {
          kind: 'agent_message',
          message,
          phase: asStr(payload.phase),
          timestamp,
        },
      ];
    }

    if (subtype === 'token_count') {
      const info = asObj(payload.info);
      if (!info) return [];

      const total = asObj(info.total_token_usage);
      const last = asObj(info.last_token_usage);

      if (!total) return [];

      const totalInputTokens = asNum(total.input_tokens) ?? 0;
      const totalCachedInputTokens = asNum(total.cached_input_tokens) ?? 0;
      const totalOutputTokens = asNum(total.output_tokens) ?? 0;
      const totalTokens = asNum(total.total_tokens) ?? totalInputTokens + totalOutputTokens;

      return [
        {
          kind: 'token_count',
          totalInputTokens,
          totalCachedInputTokens,
          totalOutputTokens,
          totalTokens,
          lastInputTokens: last ? asNum(last.input_tokens) : undefined,
          lastCachedInputTokens: last ? asNum(last.cached_input_tokens) : undefined,
          lastOutputTokens: last ? asNum(last.output_tokens) : undefined,
          timestamp,
        },
      ];
    }

    return [];
  }

  // ── response_item ─────────────────────────────────────────────────────────
  if (type === 'response_item') {
    const subtype = asStr(payload.type);

    if (subtype === 'function_call') {
      const name = asStr(payload.name);
      const callId = asStr(payload.call_id);
      if (!name || !callId) return [];

      const args = asStr(payload.arguments) ?? '{}';
      return [
        {
          kind: 'function_call',
          name,
          arguments: args,
          callId,
          timestamp,
        },
      ];
    }

    if (subtype === 'function_call_output') {
      const callId = asStr(payload.call_id);
      if (!callId) return [];

      const output = asStr(payload.output) ?? '';
      return [
        {
          kind: 'function_call_output',
          callId,
          output,
          timestamp,
        },
      ];
    }

    return [];
  }

  // 미지 타입 (compacted 등) → 무시
  return [];
}

/**
 * 여러 줄의 JSONL 텍스트를 파싱한다.
 */
export function parseLines(text: string): CdxParsedRecord[] {
  const records: CdxParsedRecord[] = [];
  for (const line of text.split('\n')) {
    records.push(...parseLine(line));
  }
  return records;
}
