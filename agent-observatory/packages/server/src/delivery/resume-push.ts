/**
 * Resume Push Hook — Observatory → Resume Site 토큰 집계 push.
 *
 * collect-tokens.py(LaunchAgent) 를 대체한다.
 *
 * 동작:
 *   - EventBus의 `metrics.usage` 이벤트를 수신하여 버퍼에 누적
 *   - 5분(기본)마다 provider/model/source 단위로 집계하여 Resume site에 POST
 *
 * 민감 정보 필터:
 *   - 전송 필드: provider, model, source, input_tokens, output_tokens 만 포함
 *   - 세션 내용, 파일 경로, API 키 등 일체 제외
 *
 * Resume Site API:
 *   POST {resumeUrl}
 *   Content-Type: application/json
 *   Body: { provider, model, source, input_tokens, output_tokens }
 *
 * 설정 (환경변수):
 *   OBSERVATORY_RESUME_URL      — push 대상 URL (필수, 미설정 시 비활성)
 *   OBSERVATORY_RESUME_API_KEY  — Bearer 토큰 (선택)
 *   OBSERVATORY_RESUME_INTERVAL_MS — push 주기 ms (기본 300000 = 5분)
 */

import type { UAEPEvent, AgentSourceType } from '@agent-observatory/shared';
import type { EventBus } from '../core/event-bus.js';

// ─── 타입 ─────────────────────────────────────────────────────────────────────

interface TokenDelta {
    source: string;
    provider: string;
    model: string;
    input: number;
    output: number;
}

/** source, provider, model 복합 키 */
type AggregateKey = string;

interface AggregatedEntry {
    provider: string;
    model: string;
    source: string;
    input_tokens: number;
    output_tokens: number;
}

export interface ResumePushConfig {
    /** POST 대상 URL. 예: https://resume.example.com/api/tokens */
    resumeUrl: string;
    /** Bearer 토큰 (선택) */
    apiKey?: string;
    /** push 주기 ms (기본 300_000 = 5분) */
    intervalMs?: number;
}

// ─── 헬퍼 함수 ────────────────────────────────────────────────────────────────

/** UAEP source → LLM provider 매핑 */
function deriveProvider(source: AgentSourceType, modelId?: string): string {
    // model_id로 먼저 판단 (더 정확)
    if (modelId) {
        const m = modelId.toLowerCase();
        if (m.includes('claude')) return 'anthropic';
        if (m.includes('gpt') || m.includes('codex') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) return 'openai';
        if (m.includes('gemini')) return 'google';
        if (m.includes('mistral')) return 'mistral';
        if (m.includes('llama')) return 'meta';
    }
    // source 기반 fallback
    switch (source) {
        case 'claude_code':
        case 'openclaw': return 'anthropic';
        case 'codex': return 'openai';
        case 'opencode': return 'openai';
        default: return 'unknown';
    }
}

/** provider/model/source 복합 키 */
function aggregateKey(delta: TokenDelta): AggregateKey {
    return `${delta.source}::${delta.provider}::${delta.model}`;
}

/** 버퍼 집계 */
function aggregate(buffer: TokenDelta[]): AggregatedEntry[] {
    const map = new Map<AggregateKey, AggregatedEntry>();

    for (const delta of buffer) {
        const key = aggregateKey(delta);
        const existing = map.get(key);
        if (existing) {
            existing.input_tokens += delta.input;
            existing.output_tokens += delta.output;
        } else {
            map.set(key, {
                provider: delta.provider,
                model: delta.model,
                source: delta.source,
                input_tokens: delta.input,
                output_tokens: delta.output,
            });
        }
    }

    return Array.from(map.values()).filter(
        (e) => e.input_tokens > 0 || e.output_tokens > 0,
    );
}

/** Resume site로 단건 POST */
async function postEntry(
    url: string,
    entry: AggregatedEntry,
    apiKey?: string,
): Promise<void> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            provider: entry.provider,
            model: entry.model,
            source: entry.source,
            input_tokens: entry.input_tokens,
            output_tokens: entry.output_tokens,
        }),
        signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
}

// ─── 메인 함수 ────────────────────────────────────────────────────────────────

/**
 * Resume push hook을 EventBus에 등록한다.
 *
 * @returns cleanup 함수 (타이머 정지 + 구독 해제)
 */
export function registerResumePushHook(eventBus: EventBus, config: ResumePushConfig): () => void {
    let buffer: TokenDelta[] = [];

    // metrics.usage 이벤트 수신 → 버퍼에 누적
    const unsubscribe = eventBus.subscribeByType('metrics.usage', (event: UAEPEvent) => {
        const data = event.data ?? {};
        const input = typeof data['input_tokens'] === 'number' ? data['input_tokens'] : 0;
        const output = typeof data['output_tokens'] === 'number' ? data['output_tokens'] : 0;

        if (input === 0 && output === 0) return;

        const provider = deriveProvider(event.source, event.model_id);
        const model = event.model_id ?? (typeof data['model'] === 'string' ? data['model'] : 'unknown');

        buffer.push({ source: event.source, provider, model, input, output });
    });

    // 주기적 push
    const intervalMs = config.intervalMs ?? 300_000;
    const timer = setInterval(() => {
        if (buffer.length === 0) return;

        const snapshot = buffer;
        buffer = [];

        const entries = aggregate(snapshot);
        if (entries.length === 0) return;

        // 비동기 push — 실패 시 로그만 (재시도 없음)
        void (async () => {
            let sent = 0;
            for (const entry of entries) {
                try {
                    await postEntry(config.resumeUrl, entry, config.apiKey);
                    sent++;
                } catch (err) {
                    console.warn(
                        `[resume-push] Failed to push ${entry.source}/${entry.provider}/${entry.model}: ${String(err)}`,
                    );
                }
            }
            if (sent > 0) {
                console.log(`[resume-push] Pushed ${sent}/${entries.length} entries to ${config.resumeUrl}`);
            }
        })();
    }, intervalMs);

    return () => {
        clearInterval(timer);
        unsubscribe();
    };
}

/**
 * 환경변수에서 ResumePushConfig를 읽는다.
 * OBSERVATORY_RESUME_URL이 없으면 null 반환 (비활성).
 */
export function readResumePushConfigFromEnv(): ResumePushConfig | null {
    const resumeUrl = process.env['OBSERVATORY_RESUME_URL'];
    if (!resumeUrl) return null;

    return {
        resumeUrl,
        apiKey: process.env['OBSERVATORY_RESUME_API_KEY'] || undefined,
        intervalMs: process.env['OBSERVATORY_RESUME_INTERVAL_MS']
            ? parseInt(process.env['OBSERVATORY_RESUME_INTERVAL_MS'], 10)
            : undefined,
    };
}
