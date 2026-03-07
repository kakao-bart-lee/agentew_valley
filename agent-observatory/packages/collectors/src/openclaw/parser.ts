/**
 * OpenClaw JSONL 파서.
 *
 * OpenClaw transcript JSONL의 각 줄을 파싱하여
 * 구조화된 레코드로 변환한다.
 *
 * 처리 대상:
 *   - type: "session" (첫 줄) → 세션 메타데이터
 *   - type: "message" → role별 분기
 *     - role: "user"      → user.input
 *     - role: "assistant" → toolCall/toolUse/functionCall + 텍스트 응답 + 토큰 사용량
 *     - role: "toolResult" → tool.end
 *
 * 무시: compaction, branch_summary, custom 등
 */

/** OpenClaw 세션 헤더 */
export interface OCSessionHeader {
  kind: 'session_header';
  version: number;
  sessionId: string;
  cwd?: string;
  /** 세션 헤더에 명시된 모델 ID (있는 경우) */
  model?: string;
  timestamp?: string;
}

/** OpenClaw 도구 호출 (assistant content 블록) */
export interface OCToolCall {
  kind: 'tool_call';
  id: string;
  name: string;
  input: Record<string, unknown>;
  timestamp?: string;
}

/** OpenClaw 도구 결과 */
export interface OCToolResult {
  kind: 'tool_result';
  toolCallId: string;
  content?: string;
  isError?: boolean;
  timestamp?: string;
}

/** OpenClaw 사용자 입력 */
export interface OCUserInput {
  kind: 'user_input';
  text: string;
  timestamp?: string;
}

/**
 * OpenClaw 어시스턴트 응답 (텍스트 + 토큰 사용량).
 *
 * 도구 호출 없이 텍스트만 반환하거나, 도구 호출과 함께 사용량 정보가
 * 포함된 경우 발행된다. tool_call 레코드와 별도로 emit된다.
 */
export interface OCAssistantMessage {
  kind: 'assistant_message';
  /** 어시스턴트 응답 텍스트 길이 (개인정보 보호 — 실제 내용은 저장 안 함) */
  textLength: number;
  /** 응답 생성에 사용된 모델 ID */
  model?: string;
  /** API가 반환한 토큰 사용량 */
  usage?: OCTokenUsage;
  timestamp?: string;
}

/** 토큰 사용량 데이터 (내부 정규화 포맷) */
export interface OCTokenUsage {
  input_tokens: number;
  output_tokens: number;
  /** 캐시 생성에 사용된 입력 토큰 */
  cache_creation_input_tokens?: number;
  /** 캐시에서 읽은 입력 토큰 */
  cache_read_input_tokens?: number;
  /**
   * provider가 직접 제공한 비용 (USD).
   * OpenClaw는 cost.total 필드로 제공.
   * 있는 경우 estimateCostUsd() 계산보다 우선 사용.
   */
  cost_usd?: number;
}

/**
 * OpenClaw 모델 변경 이벤트.
 * 세션 중 모델이 바뀔 때 발행된다.
 */
export interface OCModelChange {
  kind: 'model_change';
  modelId: string;
  provider?: string;
  timestamp?: string;
}

/**
 * OpenClaw custom 레코드 (type: "custom").
 *
 * 지원하는 customType:
 *   - "model-snapshot"       : 세션 시작 시 모델/프로바이더 스냅샷 → 모델 컨텍스트 업데이트
 *   - "openclaw.cache-ttl"   : 캐시 만료 알림 (모델 정보 포함) → 모델 컨텍스트 업데이트
 *   - "openclaw:prompt-error": LLM 호출 실패 → llm.error 이벤트 발행
 */
export interface OCCustomRecord {
  kind: 'custom';
  customType: string;
  /** model-snapshot / cache-ttl 에서 사용 */
  modelId?: string;
  provider?: string;
  /** prompt-error 에서 사용 */
  error?: string;
  sessionId?: string;
  timestamp?: string;
}

/** 파서가 반환하는 모든 레코드 타입의 합집합 */
export type OCParsedRecord =
  | OCSessionHeader
  | OCToolCall
  | OCToolResult
  | OCUserInput
  | OCAssistantMessage
  | OCModelChange
  | OCCustomRecord;

// ─── 내부 헬퍼 ───────────────────────────────────────────────────────────────

/**
 * assistant 메시지의 content 블록에서 tool call을 추출한다.
 */
function extractToolCalls(
  contents: unknown[],
  timestamp?: string,
): OCToolCall[] {
  const calls: OCToolCall[] = [];

  for (const block of contents) {
    if (typeof block !== 'object' || block === null) continue;
    const b = block as Record<string, unknown>;

    // toolCall, toolUse, functionCall, tool_use 모두 처리
    if (
      b.type === 'toolCall' ||
      b.type === 'toolUse' ||
      b.type === 'functionCall' ||
      b.type === 'tool_use'
    ) {
      const id =
        (typeof b.id === 'string' ? b.id : undefined) ??
        (typeof b.toolCallId === 'string' ? b.toolCallId : undefined) ??
        (typeof b.toolUseId === 'string' ? b.toolUseId : undefined) ??
        '';

      const name =
        (typeof b.name === 'string' ? b.name : undefined) ??
        (typeof b.toolName === 'string' ? b.toolName : undefined) ??
        (typeof (b.function as Record<string, unknown>)?.name === 'string'
          ? (b.function as Record<string, unknown>).name as string
          : undefined) ??
        'unknown';

      const input =
        (typeof b.input === 'object' && b.input !== null
          ? b.input
          : typeof b.arguments === 'object' && b.arguments !== null
            ? b.arguments
            : typeof (b.function as Record<string, unknown>)?.arguments ===
                'object'
              ? (b.function as Record<string, unknown>).arguments
              : {}) as Record<string, unknown>;

      if (id) {
        calls.push({ kind: 'tool_call', id, name, input, timestamp });
      }
    }
  }

  return calls;
}

/**
 * content 블록 배열에서 텍스트를 추출하여 총 길이를 반환한다.
 */
function extractTextLength(contents: unknown[]): number {
  let total = 0;
  for (const block of contents) {
    if (typeof block !== 'object' || block === null) continue;
    const b = block as Record<string, unknown>;
    if (b.type === 'text' && typeof b.text === 'string') {
      total += (b.text as string).length;
    }
  }
  return total;
}

/**
 * usage 객체에서 OCTokenUsage를 파싱한다.
 *
 * 두 가지 포맷을 모두 지원한다:
 *   Format A (Claude Code / Anthropic API 표준):
 *     { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens }
 *   Format B (OpenClaw):
 *     { input, output, cacheRead, cacheWrite, cost: { total } }
 */
function parseUsage(raw: unknown): OCTokenUsage | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const u = raw as Record<string, unknown>;

  // Format A: standard input_tokens / output_tokens
  let inputTokens = typeof u.input_tokens === 'number' ? u.input_tokens : undefined;
  let outputTokens = typeof u.output_tokens === 'number' ? u.output_tokens : undefined;

  // Format B: OpenClaw input / output
  if (inputTokens === undefined && typeof u.input === 'number') inputTokens = u.input;
  if (outputTokens === undefined && typeof u.output === 'number') outputTokens = u.output;

  if (inputTokens === undefined && outputTokens === undefined) return undefined;

  // cache tokens: Format A
  const cacheCreate =
    typeof u.cache_creation_input_tokens === 'number'
      ? u.cache_creation_input_tokens
      : undefined;
  const cacheRead =
    typeof u.cache_read_input_tokens === 'number'
      ? u.cache_read_input_tokens
      // Format B: cacheRead (OpenClaw)
      : typeof u.cacheRead === 'number' && u.cacheRead > 0
        ? u.cacheRead
        : undefined;
  const cacheWrite =
    cacheCreate !== undefined
      ? cacheCreate
      // Format B: cacheWrite (OpenClaw)
      : typeof u.cacheWrite === 'number' && u.cacheWrite > 0
        ? u.cacheWrite
        : undefined;

  // cost: Format B (OpenClaw) provides cost.total directly
  let cost_usd: number | undefined;
  if (typeof u.cost === 'object' && u.cost !== null) {
    const c = u.cost as Record<string, unknown>;
    if (typeof c.total === 'number' && c.total > 0) cost_usd = c.total;
  }

  return {
    input_tokens: inputTokens ?? 0,
    output_tokens: outputTokens ?? 0,
    ...(cacheWrite !== undefined ? { cache_creation_input_tokens: cacheWrite } : {}),
    ...(cacheRead !== undefined ? { cache_read_input_tokens: cacheRead } : {}),
    ...(cost_usd !== undefined ? { cost_usd } : {}),
  };
}

// ─── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * 단일 JSONL 줄을 파싱하여 OCParsedRecord 배열을 반환한다.
 */
export function parseLine(line: string): OCParsedRecord[] {
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
  const type = record.type;
  const timestamp =
    typeof record.timestamp === 'string' ? record.timestamp : undefined;

  // ── session header ─────────────────────────────────────────────────────────
  if (type === 'session') {
    return [
      {
        kind: 'session_header',
        version: typeof record.version === 'number' ? record.version : 0,
        sessionId: typeof record.id === 'string' ? record.id : '',
        cwd: typeof record.cwd === 'string' ? record.cwd : undefined,
        model: typeof record.model === 'string' ? record.model : undefined,
        timestamp,
      },
    ];
  }

  // ── message entries ────────────────────────────────────────────────────────
  if (type === 'message') {
    const message = record.message as Record<string, unknown> | undefined;
    if (!message) return [];

    const role = message.role;

    // ── user input ──────────────────────────────────────────────────────────
    if (role === 'user') {
      let text = '';
      if (typeof message.content === 'string') {
        text = message.content;
      } else if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (
            typeof block === 'object' &&
            block !== null &&
            (block as Record<string, unknown>).type === 'text'
          ) {
            text = String((block as Record<string, unknown>).text ?? '');
            break;
          }
        }
      }

      if (text.length > 0) {
        return [{ kind: 'user_input', text, timestamp }];
      }
      return [];
    }

    // ── assistant message ───────────────────────────────────────────────────
    if (role === 'assistant') {
      const results: OCParsedRecord[] = [];

      if (Array.isArray(message.content)) {
        // 도구 호출 추출
        const toolCalls = extractToolCalls(message.content, timestamp);
        results.push(...toolCalls);

        // 텍스트 응답 + 사용량 정보 추출
        const textLength = extractTextLength(message.content);
        const usage = parseUsage(message.usage);
        const model = typeof message.model === 'string' ? message.model : undefined;

        // 텍스트 응답이 있거나 사용량 데이터가 있을 때만 발행
        if (textLength > 0 || usage !== undefined || model !== undefined) {
          results.push({
            kind: 'assistant_message',
            textLength,
            model,
            usage,
            timestamp,
          });
        }
      }

      return results;
    }

    // ── tool result ─────────────────────────────────────────────────────────
    if (role === 'toolResult' || role === 'tool') {
      const toolCallId =
        (typeof message.toolCallId === 'string'
          ? message.toolCallId
          : undefined) ??
        (typeof message.toolUseId === 'string'
          ? message.toolUseId
          : undefined) ??
        (typeof message.tool_use_id === 'string'
          ? message.tool_use_id
          : undefined) ??
        '';

      let content: string | undefined;
      if (typeof message.content === 'string') {
        content = message.content;
      } else if (Array.isArray(message.content)) {
        const textParts = (message.content as unknown[])
          .filter(
            (c): c is Record<string, unknown> =>
              typeof c === 'object' &&
              c !== null &&
              (c as Record<string, unknown>).type === 'text',
          )
          .map((c) => String(c.text ?? ''));
        if (textParts.length > 0) content = textParts.join('\n');
      }

      if (toolCallId) {
        return [
          {
            kind: 'tool_result',
            toolCallId,
            content,
            isError: message.isError === true,
            timestamp,
          },
        ];
      }
      return [];
    }

    return [];
  }

  // ── model_change ───────────────────────────────────────────────────────────
  if (type === 'model_change') {
    const modelId = typeof record.modelId === 'string' ? record.modelId : '';
    if (modelId) {
      return [
        {
          kind: 'model_change',
          modelId,
          provider: typeof record.provider === 'string' ? record.provider : undefined,
          timestamp,
        },
      ];
    }
    return [];
  }

  // ── custom ─────────────────────────────────────────────────────────────────
  // model-snapshot, openclaw.cache-ttl → 모델 컨텍스트 업데이트용 레코드
  // openclaw:prompt-error → LLM 오류 이벤트
  if (type === 'custom') {
    const customType = typeof record.customType === 'string' ? record.customType : '';
    if (!customType) return [];

    const data = typeof record.data === 'object' && record.data !== null
      ? (record.data as Record<string, unknown>)
      : {};

    if (customType === 'model-snapshot' || customType === 'openclaw.cache-ttl') {
      const modelId =
        (typeof data.modelId === 'string' ? data.modelId : undefined) ??
        (typeof record.modelId === 'string' ? record.modelId : undefined);
      if (modelId) {
        return [
          {
            kind: 'custom',
            customType,
            modelId,
            provider: (typeof data.provider === 'string' ? data.provider : undefined) ??
              (typeof record.provider === 'string' ? record.provider : undefined),
            timestamp,
          },
        ];
      }
      return [];
    }

    if (customType === 'openclaw:prompt-error') {
      return [
        {
          kind: 'custom',
          customType,
          modelId: (typeof data.model === 'string' ? data.model : undefined) ??
            (typeof data.modelId === 'string' ? data.modelId : undefined),
          provider: typeof data.provider === 'string' ? data.provider : undefined,
          error: typeof data.error === 'string' ? data.error : 'unknown',
          sessionId: typeof data.sessionId === 'string' ? data.sessionId : undefined,
          timestamp,
        },
      ];
    }

    return [];
  }

  // compaction, branch_summary, thinking_level_change 등 → 무시
  return [];
}

/**
 * 여러 줄의 JSONL 텍스트를 파싱한다.
 */
export function parseLines(text: string): OCParsedRecord[] {
  const lines = text.split('\n');
  const records: OCParsedRecord[] = [];
  for (const line of lines) {
    records.push(...parseLine(line));
  }
  return records;
}
