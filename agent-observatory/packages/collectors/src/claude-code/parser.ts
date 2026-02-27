/**
 * Claude Code JSONL 파서.
 *
 * Claude Code transcript JSONL의 각 줄을 파싱하여
 * 구조화된 레코드로 변환한다.
 *
 * 처리 대상 type:
 *   - "assistant" -> tool_use 추출
 *   - "user" -> tool_result / user.input 추출
 *   - "system" (subtype: "turn_duration") -> idle 전환
 *   - "progress" (data.type: "agent_progress") -> 서브에이전트
 *
 * 방어적 파싱: 알려진 type만 처리, 미지 type은 무시.
 */

/** tool_use 블록에서 추출하는 구조 */
export interface CCToolUse {
  kind: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
  timestamp?: string;
}

/** tool_result 블록에서 추출하는 구조 */
export interface CCToolResult {
  kind: 'tool_result';
  toolUseId: string;
  content?: string;
  isError?: boolean;
  timestamp?: string;
}

/** turn_duration 시스템 레코드 */
export interface CCTurnDuration {
  kind: 'turn_duration';
  durationMs: number;
  timestamp?: string;
}

/** 사용자 입력 레코드 */
export interface CCUserInput {
  kind: 'user_input';
  text: string;
  timestamp?: string;
}

/** 서브에이전트 progress 레코드 */
export interface CCSubagentProgress {
  kind: 'subagent_progress';
  parentToolUseId: string;
  nestedRecords: CCParsedRecord[];
  timestamp?: string;
}

/** LLM 사용량 레코드 (assistant 메시지의 message.usage 필드) */
export interface CCUsage {
  kind: 'usage';
  inputTokens: number;
  outputTokens: number;
  /** Claude Code JSONL 최상위 costUSD 필드 */
  costUsd?: number;
  timestamp?: string;
}

/** 파서가 반환하는 모든 레코드 타입의 합집합 */
export type CCParsedRecord =
  | CCToolUse
  | CCToolResult
  | CCTurnDuration
  | CCUserInput
  | CCSubagentProgress
  | CCUsage;

/**
 * content 블록 배열에서 tool_use / tool_result를 추출한다.
 */
function extractContentBlocks(
  contents: unknown[],
  recordTimestamp?: string,
): CCParsedRecord[] {
  const records: CCParsedRecord[] = [];

  for (const block of contents) {
    if (typeof block !== 'object' || block === null) continue;
    const b = block as Record<string, unknown>;

    if (b.type === 'tool_use') {
      if (typeof b.id === 'string' && typeof b.name === 'string') {
        records.push({
          kind: 'tool_use',
          id: b.id,
          name: b.name,
          input: (typeof b.input === 'object' && b.input !== null
            ? b.input
            : {}) as Record<string, unknown>,
          timestamp: recordTimestamp,
        });
      }
    } else if (b.type === 'tool_result') {
      if (typeof b.tool_use_id === 'string') {
        let content: string | undefined;
        if (Array.isArray(b.content)) {
          const textParts = (b.content as unknown[])
            .filter(
              (c): c is Record<string, unknown> =>
                typeof c === 'object' &&
                c !== null &&
                (c as Record<string, unknown>).type === 'text',
            )
            .map((c) => String(c.text ?? ''));
          if (textParts.length > 0) {
            content = textParts.join('\n');
          }
        } else if (typeof b.content === 'string') {
          content = b.content;
        }

        records.push({
          kind: 'tool_result',
          toolUseId: b.tool_use_id,
          content,
          isError: b.is_error === true,
          timestamp: recordTimestamp,
        });
      }
    }
  }

  return records;
}

/**
 * 단일 JSONL 줄을 파싱하여 CCParsedRecord 배열을 반환한다.
 *
 * 잘못된 JSON이나 미지 type은 빈 배열을 반환한다.
 */
export function parseLine(line: string): CCParsedRecord[] {
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

  if (type === 'assistant') {
    const message = record.message as Record<string, unknown> | undefined;
    const records: CCParsedRecord[] = [];

    if (message && Array.isArray(message.content)) {
      records.push(...extractContentBlocks(message.content, timestamp));
    }

    // message.usage에서 토큰 사용량 추출
    const usage = message?.usage as Record<string, unknown> | undefined;
    const inputTokens =
      typeof usage?.input_tokens === 'number' ? usage.input_tokens : 0;
    const outputTokens =
      typeof usage?.output_tokens === 'number' ? usage.output_tokens : 0;
    if (inputTokens > 0 || outputTokens > 0) {
      const costUsd =
        typeof record.costUSD === 'number' ? record.costUSD : undefined;
      records.push({ kind: 'usage', inputTokens, outputTokens, costUsd, timestamp });
    }

    return records;
  }

  if (type === 'user') {
    const records: CCParsedRecord[] = [];
    const message = record.message as Record<string, unknown> | undefined;
    if (message && Array.isArray(message.content)) {
      // tool_result 추출
      const toolResults = extractContentBlocks(message.content, timestamp);
      records.push(...toolResults);

      // 첫 번째 text 블록이 있고 tool_result가 없으면 user.input
      if (toolResults.length === 0) {
        for (const block of message.content) {
          if (
            typeof block === 'object' &&
            block !== null &&
            (block as Record<string, unknown>).type === 'text'
          ) {
            const text = String(
              (block as Record<string, unknown>).text ?? '',
            );
            if (text.length > 0) {
              records.push({
                kind: 'user_input',
                text,
                timestamp,
              });
              break;
            }
          }
        }
      }
    } else if (
      message &&
      typeof message.content === 'string' &&
      message.content.length > 0
    ) {
      records.push({
        kind: 'user_input',
        text: message.content,
        timestamp,
      });
    }
    return records;
  }

  if (type === 'system') {
    if (record.subtype === 'turn_duration') {
      const durationMs =
        typeof record.duration_ms === 'number'
          ? record.duration_ms
          : typeof (record as Record<string, unknown>).duration_ms ===
              'number'
            ? (record as Record<string, unknown>).duration_ms as number
            : 0;

      return [
        {
          kind: 'turn_duration',
          durationMs,
          timestamp,
        },
      ];
    }
    return [];
  }

  if (type === 'progress') {
    const data = record.data as Record<string, unknown> | undefined;
    if (data && data.type === 'agent_progress') {
      const parentToolUseId =
        typeof record.parentToolUseID === 'string'
          ? record.parentToolUseID
          : '';

      const nestedRecords: CCParsedRecord[] = [];
      const nestedMessage = data.message as
        | Record<string, unknown>
        | undefined;
      if (nestedMessage) {
        // 재귀적으로 중첩 메시지 파싱
        const nestedLine = JSON.stringify(nestedMessage);
        nestedRecords.push(...parseLine(nestedLine));
      }

      return [
        {
          kind: 'subagent_progress',
          parentToolUseId,
          nestedRecords,
          timestamp,
        },
      ];
    }
    // bash_progress, mcp_progress 등은 무시
    return [];
  }

  // 미지 type은 무시
  return [];
}

/**
 * 여러 줄의 JSONL 텍스트를 파싱한다.
 */
export function parseLines(text: string): CCParsedRecord[] {
  const lines = text.split('\n');
  const records: CCParsedRecord[] = [];
  for (const line of lines) {
    records.push(...parseLine(line));
  }
  return records;
}
