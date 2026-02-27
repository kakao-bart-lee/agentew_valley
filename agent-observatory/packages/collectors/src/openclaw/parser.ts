/**
 * OpenClaw JSONL 파서.
 *
 * OpenClaw transcript JSONL의 각 줄을 파싱하여
 * 구조화된 레코드로 변환한다.
 *
 * 처리 대상:
 *   - type: "session" (첫 줄) -> 세션 메타데이터
 *   - type: "message" -> role별 분기
 *     - role: "user" -> user.input
 *     - role: "assistant" -> toolCall/toolUse/functionCall 추출
 *     - role: "toolResult" -> tool.end
 *
 * 무시: compaction, branch_summary, custom 등
 */

/** OpenClaw 세션 헤더 */
export interface OCSessionHeader {
  kind: 'session_header';
  version: number;
  sessionId: string;
  cwd?: string;
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

/** 파서가 반환하는 모든 레코드 타입의 합집합 */
export type OCParsedRecord =
  | OCSessionHeader
  | OCToolCall
  | OCToolResult
  | OCUserInput;

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

    // toolCall, toolUse, functionCall 모두 처리
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

  // session header
  if (type === 'session') {
    return [
      {
        kind: 'session_header',
        version: typeof record.version === 'number' ? record.version : 0,
        sessionId: typeof record.id === 'string' ? record.id : '',
        cwd: typeof record.cwd === 'string' ? record.cwd : undefined,
        timestamp,
      },
    ];
  }

  // message entries
  if (type === 'message') {
    const message = record.message as Record<string, unknown> | undefined;
    if (!message) return [];

    const role = message.role;

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

    if (role === 'assistant') {
      if (Array.isArray(message.content)) {
        return extractToolCalls(message.content, timestamp);
      }
      return [];
    }

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

  // compaction, branch_summary, custom -> 무시
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
