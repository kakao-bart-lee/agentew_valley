/**
 * Resume Push Hook — Observatory → Resume Site 토큰 집계 push.
 *
 * ## 두 가지 push 모드
 *
 * ### 1. 증분 push (기본 동작)
 *   - `metrics.usage` 이벤트를 버퍼에 누적
 *   - 매 N분(기본 5분)마다 provider/model/source 단위로 집계하여 `POST /api/tokens`
 *   - 버퍼는 push 후 비워짐 (delta 방식)
 *
 * ### 2. Full sync (DELETE + PUT)
 *   - Resume site의 기존 데이터를 `DELETE /api/tokens`로 초기화
 *   - Observatory가 보유한 전체 이력을 `PUT /api/tokens`로 덮어씀
 *   - 사용 시나리오:
 *     a) 서버 시작 시 (`OBSERVATORY_RESUME_FULL_SYNC_ON_START=true`)
 *     b) REST API 호출 (`POST /api/v1/resume/sync`)
 *     c) 증분 push가 3회 연속 실패 → 자동 fallback
 *
 * ## 전체 이력 재구성 방법
 *   - 우선: in-memory 누적 running total (live events로 쌓인 것)
 *   - fallback: SQLite events 테이블에서 `metrics.usage` 재집계
 *
 * ## 설정 (환경변수)
 *   OBSERVATORY_RESUME_URL              — push 대상 URL (필수, 미설정 시 비활성)
 *   OBSERVATORY_RESUME_API_KEY          — Bearer 토큰 (선택)
 *   OBSERVATORY_RESUME_INTERVAL_MS      — 증분 push 주기 ms (기본 300000 = 5분)
 *   OBSERVATORY_RESUME_FULL_SYNC_ON_START — 시작 시 full sync 여부 (기본 false)
 *   OBSERVATORY_RESUME_FULL_SYNC_DELAY_MS — full sync 전 대기 ms (기본 10000)
 */

import type { UAEPEvent, AgentSourceType } from '@agent-observatory/shared';
import type { EventBus } from '../core/event-bus.js';
import type Database from 'better-sqlite3';

// ─── 타입 ─────────────────────────────────────────────────────────────────────

interface TokenDelta {
    source: string;
    provider: string;
    model: string;
    input: number;
    output: number;
    session_id: string;
    date: string; // UTC "YYYY-MM-DD"
}

type AggregateKey = string; // `${source}::${provider}::${model}`

interface AggregatedEntry {
    provider: string;
    model: string;
    source: string;
    input_tokens: number;
    output_tokens: number;
    session_ids: string[];
}

/** running total의 단일 항목 */
interface RunningEntry {
    provider: string;
    model: string;
    source: string;
    input_tokens: number;
    output_tokens: number;
    sessions: Set<string>;
    /** UTC date → { input, output } */
    daily: Map<string, { input: number; output: number }>;
}

/** PUT /api/tokens 본문 */
interface TokenSnapshotBody {
    providers: Record<string, {
        total: { input: number; output: number; sessions: number };
        models: Record<string, { input: number; output: number; sessions: number }>;
        _sessions: Record<string, true>;
    }>;
    sources: Record<string, {
        input: number;
        output: number;
        sessions: number;
        _sessions: Record<string, true>;
    }>;
    history: Record<string, { input: number; output: number }>;
    total: { input: number; output: number; sessions: number };
    _sessions: Record<string, true>;
    last_updated: string;
}

export interface ResumePushConfig {
    /** POST 대상 URL. 예: https://resume.example.com/api/tokens */
    resumeUrl: string;
    /** Bearer 토큰 (선택) */
    apiKey?: string;
    /** 증분 push 주기 ms (기본 300_000 = 5분) */
    intervalMs?: number;
    /** 시작 시 full sync 여부 (기본 false) */
    fullSyncOnStart?: boolean;
    /** full sync 전 대기 ms — collectors 초기 로딩 완료를 기다림 (기본 10_000) */
    fullSyncDelayMs?: number;
    /** SQLite DB 참조 (full sync에서 이력 재구성 시 사용) */
    db?: Database.Database;
}

export interface ResumeSyncResult {
    ok: boolean;
    entries?: number;
    error?: string;
}

// ─── 헬퍼 함수 ────────────────────────────────────────────────────────────────

/** UAEP source → LLM provider 매핑 */
function deriveProvider(source: AgentSourceType, modelId?: string): string {
    if (modelId) {
        const m = modelId.toLowerCase();
        if (m.includes('claude')) return 'anthropic';
        if (m.includes('gpt') || m.includes('codex') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) return 'openai';
        if (m.includes('gemini')) return 'google';
        if (m.includes('mistral')) return 'mistral';
        if (m.includes('llama')) return 'meta';
    }
    switch (source) {
        case 'claude_code':
        case 'openclaw': return 'anthropic';
        case 'codex': return 'openai';
        case 'opencode': return 'openai';
        default: return 'unknown';
    }
}

function aggregateKey(source: string, provider: string, model: string): AggregateKey {
    return `${source}::${provider}::${model}`;
}

function utcDateStr(ts: string): string {
    return new Date(ts).toISOString().slice(0, 10);
}

/** 버퍼 → 증분 집계 */
function aggregateBuffer(buffer: TokenDelta[]): AggregatedEntry[] {
    const map = new Map<AggregateKey, AggregatedEntry>();
    const sessionSets = new Map<AggregateKey, Set<string>>();

    for (const delta of buffer) {
        const key = aggregateKey(delta.source, delta.provider, delta.model);
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
                session_ids: [],
            });
            sessionSets.set(key, new Set());
        }
        sessionSets.get(key)!.add(delta.session_id);
    }

    for (const [key, entry] of map) {
        entry.session_ids = Array.from(sessionSets.get(key)!);
    }

    return Array.from(map.values()).filter(
        (e) => e.input_tokens > 0 || e.output_tokens > 0,
    );
}

/** running total → PUT body 변환 */
function buildSnapshotBody(entries: Map<AggregateKey, RunningEntry>): TokenSnapshotBody {
    const providers: TokenSnapshotBody['providers'] = {};
    const sources: TokenSnapshotBody['sources'] = {};
    const history: Record<string, { input: number; output: number }> = {};
    const globalSessions = new Set<string>();
    let totalInput = 0;
    let totalOutput = 0;

    for (const entry of entries.values()) {
        const { provider, model, source, input_tokens, output_tokens, sessions, daily } = entry;
        if (input_tokens === 0 && output_tokens === 0) continue;

        // providers
        if (!providers[provider]) {
            providers[provider] = { total: { input: 0, output: 0, sessions: 0 }, models: {}, _sessions: {} };
        }
        const pEntry = providers[provider]!;
        pEntry.total.input += input_tokens;
        pEntry.total.output += output_tokens;
        if (!pEntry.models[model]) {
            pEntry.models[model] = { input: 0, output: 0, sessions: 0 };
        }
        pEntry.models[model]!.input += input_tokens;
        pEntry.models[model]!.output += output_tokens;
        for (const sid of sessions) {
            pEntry._sessions[sid] = true;
        }

        // sources
        if (!sources[source]) {
            sources[source] = { input: 0, output: 0, sessions: 0, _sessions: {} };
        }
        const sEntry = sources[source]!;
        sEntry.input += input_tokens;
        sEntry.output += output_tokens;
        for (const sid of sessions) {
            sEntry._sessions[sid] = true;
            globalSessions.add(sid);
        }

        // history (daily)
        for (const [date, d] of daily) {
            if (!history[date]) history[date] = { input: 0, output: 0 };
            history[date]!.input += d.input;
            history[date]!.output += d.output;
        }

        totalInput += input_tokens;
        totalOutput += output_tokens;
    }

    // session counts
    for (const pEntry of Object.values(providers)) {
        pEntry.total.sessions = Object.keys(pEntry._sessions).length;
        for (const mEntry of Object.values(pEntry.models)) {
            // model-level session count: approximate from global sessions per provider
            mEntry.sessions = pEntry.total.sessions;
        }
    }
    for (const sEntry of Object.values(sources)) {
        sEntry.sessions = Object.keys(sEntry._sessions).length;
    }

    const _sessions: Record<string, true> = {};
    for (const sid of globalSessions) _sessions[sid] = true;

    return {
        providers,
        sources,
        history,
        total: { input: totalInput, output: totalOutput, sessions: globalSessions.size },
        _sessions,
        last_updated: new Date().toISOString(),
    };
}

/**
 * SQLite events 테이블에서 `metrics.usage` 이벤트를 재집계하여
 * running total Map을 재구성한다.
 * running total이 비어 있을 때 fallback으로 사용.
 */
function buildRunningTotalFromDb(db: Database.Database): Map<AggregateKey, RunningEntry> {
    const result = new Map<AggregateKey, RunningEntry>();

    type DbRow = {
        source: string;
        model_id: string | null;
        session_id: string;
        date: string;
        input_tokens: number;
        output_tokens: number;
    };

    const rows = db.prepare(`
        SELECT
            source,
            json_extract(data, '$.model_id') AS model_id,
            session_id,
            strftime('%Y-%m-%d', ts) AS date,
            COALESCE(CAST(json_extract(data, '$.input_tokens') AS INTEGER), 0) AS input_tokens,
            COALESCE(CAST(json_extract(data, '$.output_tokens') AS INTEGER), 0) AS output_tokens
        FROM events
        WHERE type = 'metrics.usage'
          AND (
            COALESCE(CAST(json_extract(data, '$.input_tokens') AS INTEGER), 0) > 0
            OR COALESCE(CAST(json_extract(data, '$.output_tokens') AS INTEGER), 0) > 0
          )
    `).all() as DbRow[];

    for (const row of rows) {
        const modelId = row.model_id ?? 'unknown';
        const source = row.source;
        const provider = deriveProvider(source as AgentSourceType, modelId);
        const key = aggregateKey(source, provider, modelId);

        let entry = result.get(key);
        if (!entry) {
            entry = {
                provider,
                model: modelId,
                source,
                input_tokens: 0,
                output_tokens: 0,
                sessions: new Set(),
                daily: new Map(),
            };
            result.set(key, entry);
        }

        entry.input_tokens += row.input_tokens;
        entry.output_tokens += row.output_tokens;
        entry.sessions.add(row.session_id);

        const daily = entry.daily.get(row.date) ?? { input: 0, output: 0 };
        daily.input += row.input_tokens;
        daily.output += row.output_tokens;
        entry.daily.set(row.date, daily);
    }

    return result;
}

// ─── HTTP 헬퍼 ────────────────────────────────────────────────────────────────

async function httpRequest(
    url: string,
    method: 'POST' | 'PUT' | 'DELETE',
    body?: unknown,
    apiKey?: string,
): Promise<void> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
}

// ─── ResumePushHook 클래스 ────────────────────────────────────────────────────

/**
 * Observatory → Resume Site 토큰 push 훅.
 *
 * 사용법:
 * ```typescript
 * const hook = new ResumePushHook(config);
 * hook.start(eventBus);
 * // ...
 * hook.stop();
 * ```
 */
export class ResumePushHook {
    /** 증분 push 버퍼 (flush 후 초기화) */
    private buffer: TokenDelta[] = [];
    /** 전체 누적 running total (리셋 없음) */
    private runningTotal = new Map<AggregateKey, RunningEntry>();
    /** 연속 push 실패 횟수 */
    private consecutiveFailures = 0;
    /** 마지막 full sync 시각 */
    private lastFullSyncAt: string | null = null;

    private timer?: ReturnType<typeof setInterval>;
    private unsubscribe?: () => void;

    constructor(private readonly config: ResumePushConfig) {}

    start(eventBus: EventBus): void {
        // metrics.usage 이벤트 구독
        this.unsubscribe = eventBus.subscribeByType('metrics.usage', (event: UAEPEvent) => {
            this.onUsageEvent(event);
        });

        // 증분 push 타이머
        const intervalMs = this.config.intervalMs ?? 300_000;
        this.timer = setInterval(() => {
            void this.flush();
        }, intervalMs);

        // 시작 시 full sync
        if (this.config.fullSyncOnStart) {
            const delay = this.config.fullSyncDelayMs ?? 10_000;
            setTimeout(() => {
                console.log('[resume-push] Starting full sync after initial delay...');
                void this.fullSync().then((result) => {
                    if (result.ok) {
                        console.log(`[resume-push] Startup full sync complete (${result.entries ?? 0} entries)`);
                    } else {
                        console.warn(`[resume-push] Startup full sync failed: ${result.error ?? 'unknown'}`);
                    }
                });
            }, delay);
        }
    }

    stop(): void {
        if (this.timer !== undefined) clearInterval(this.timer);
        this.unsubscribe?.();
    }

    /** 현재 상태 반환 (API용) */
    status(): {
        runningTotalEntries: number;
        bufferSize: number;
        consecutiveFailures: number;
        lastFullSyncAt: string | null;
    } {
        return {
            runningTotalEntries: this.runningTotal.size,
            bufferSize: this.buffer.length,
            consecutiveFailures: this.consecutiveFailures,
            lastFullSyncAt: this.lastFullSyncAt,
        };
    }

    /**
     * Full sync: Resume site를 DELETE하고 전체 누적 데이터를 PUT으로 덮어씀.
     *
     * running total이 비어 있고 db가 제공된 경우 SQLite에서 재구성.
     */
    async fullSync(): Promise<ResumeSyncResult> {
        try {
            // running total이 비어 있으면 DB에서 재구성 시도
            let total = this.runningTotal;
            if (total.size === 0 && this.config.db) {
                console.log('[resume-push] Running total empty — rebuilding from SQLite...');
                total = buildRunningTotalFromDb(this.config.db);
                // 재구성된 것을 running total로 병합 (이후 증분 push에도 활용)
                for (const [key, entry] of total) {
                    this.runningTotal.set(key, entry);
                }
                console.log(`[resume-push] Rebuilt ${total.size} entries from SQLite`);
            }

            if (total.size === 0) {
                console.log('[resume-push] Full sync skipped: no data to sync');
                return { ok: true, entries: 0 };
            }

            const body = buildSnapshotBody(total);

            // 1. DELETE
            await httpRequest(this.config.resumeUrl, 'DELETE', undefined, this.config.apiKey);

            // 2. PUT
            await httpRequest(this.config.resumeUrl, 'PUT', body, this.config.apiKey);

            this.lastFullSyncAt = new Date().toISOString();
            this.consecutiveFailures = 0;
            const entries = Object.values(body.providers).reduce(
                (n, p) => n + Object.keys(p.models).length, 0,
            );
            console.log(`[resume-push] Full sync complete (${entries} model entries, ${body.total.sessions} sessions)`);
            return { ok: true, entries };
        } catch (err) {
            const error = String(err);
            console.error(`[resume-push] Full sync failed: ${error}`);
            return { ok: false, error };
        }
    }

    // ─── private ──────────────────────────────────────────────────────────────

    private onUsageEvent(event: UAEPEvent): void {
        const data = event.data ?? {};
        const input = typeof data['input_tokens'] === 'number' ? data['input_tokens'] : 0;
        const output = typeof data['output_tokens'] === 'number' ? data['output_tokens'] : 0;
        if (input === 0 && output === 0) return;

        const provider = deriveProvider(event.source, event.model_id);
        const model = event.model_id ?? (typeof data['model'] === 'string' ? data['model'] : 'unknown');
        const date = utcDateStr(event.ts);

        const delta: TokenDelta = {
            source: event.source,
            provider,
            model,
            input,
            output,
            session_id: event.session_id,
            date,
        };

        // 버퍼 (증분 push용)
        this.buffer.push(delta);

        // running total (full sync용)
        const key = aggregateKey(event.source, provider, model);
        let entry = this.runningTotal.get(key);
        if (!entry) {
            entry = { provider, model, source: event.source, input_tokens: 0, output_tokens: 0, sessions: new Set(), daily: new Map() };
            this.runningTotal.set(key, entry);
        }
        entry.input_tokens += input;
        entry.output_tokens += output;
        entry.sessions.add(event.session_id);
        const daily = entry.daily.get(date) ?? { input: 0, output: 0 };
        daily.input += input;
        daily.output += output;
        entry.daily.set(date, daily);
    }

    private async flush(): Promise<void> {
        if (this.buffer.length === 0) return;

        const snapshot = this.buffer;
        this.buffer = [];

        const entries = aggregateBuffer(snapshot);
        if (entries.length === 0) return;

        let sent = 0;
        for (const entry of entries) {
            try {
                await httpRequest(
                    this.config.resumeUrl,
                    'POST',
                    {
                        provider: entry.provider,
                        model: entry.model,
                        source: entry.source,
                        input_tokens: entry.input_tokens,
                        output_tokens: entry.output_tokens,
                        session_ids: entry.session_ids,
                    },
                    this.config.apiKey,
                );
                sent++;
            } catch (err) {
                console.warn(
                    `[resume-push] Failed to push ${entry.source}/${entry.provider}/${entry.model}: ${String(err)}`,
                );
            }
        }

        if (sent > 0) {
            this.consecutiveFailures = 0;
            console.log(`[resume-push] Pushed ${sent}/${entries.length} entries to ${this.config.resumeUrl}`);
        } else if (entries.length > 0) {
            this.consecutiveFailures++;
            console.warn(`[resume-push] All ${entries.length} entries failed (consecutive: ${this.consecutiveFailures})`);

            // 3회 연속 실패 → full sync로 자동 fallback
            if (this.consecutiveFailures >= 3) {
                console.warn('[resume-push] 3 consecutive failures — attempting full sync fallback');
                void this.fullSync();
            }
        }
    }
}

// ─── 환경변수 / 편의 함수 ──────────────────────────────────────────────────────

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
        fullSyncOnStart: process.env['OBSERVATORY_RESUME_FULL_SYNC_ON_START'] === 'true',
        fullSyncDelayMs: process.env['OBSERVATORY_RESUME_FULL_SYNC_DELAY_MS']
            ? parseInt(process.env['OBSERVATORY_RESUME_FULL_SYNC_DELAY_MS'], 10)
            : undefined,
    };
}

/**
 * @deprecated `new ResumePushHook(config).start(eventBus)` 사용 권장.
 * 하위 호환성을 위해 유지.
 */
export function registerResumePushHook(eventBus: EventBus, config: ResumePushConfig): () => void {
    const hook = new ResumePushHook(config);
    hook.start(eventBus);
    return () => hook.stop();
}
