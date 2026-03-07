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
 * ## 스냅샷 기반 복원 (서버 재시작 최적화)
 *   - running total을 2~3일마다 SQLite에 저장 (`resume_snapshots` 테이블)
 *   - 재시작 시: 최신 스냅샷 복원 + 스냅샷 이후 이벤트만 replay
 *   - 종료 시 자동 저장 (graceful shutdown)
 *   - 최대 5개 보관 (오래된 것 자동 삭제)
 *
 * ## 설정 (환경변수)
 *   OBSERVATORY_RESUME_URL                  — push 대상 URL (필수, 미설정 시 비활성)
 *   OBSERVATORY_RESUME_API_KEY              — Bearer 토큰 (선택)
 *   OBSERVATORY_RESUME_INTERVAL_MS          — 증분 push 주기 ms (기본 300_000 = 5분)
 *   OBSERVATORY_RESUME_FULL_SYNC_ON_START   — 시작 시 full sync 여부 (기본 false)
 *   OBSERVATORY_RESUME_FULL_SYNC_DELAY_MS   — full sync 전 대기 ms (기본 10_000)
 *   OBSERVATORY_RESUME_SNAPSHOT_INTERVAL_MS — 스냅샷 저장 주기 ms (기본 216_000_000 ≈ 2.5일)
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

/** running total의 단일 항목 (인메모리) */
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

/** SQLite 직렬화용 RunningEntry (Set/Map → 일반 타입) */
interface SerializedEntry {
    provider: string;
    model: string;
    source: string;
    input_tokens: number;
    output_tokens: number;
    sessions: string[];
    daily: Record<string, { input: number; output: number }>;
}

/** resume_snapshots 테이블 row */
interface SnapshotRow {
    id: number;
    created_at: string;
    entries_json: string;
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

export interface ResumeTarget {
    /** POST 대상 URL. 예: https://resume.example.com/api/tokens */
    url: string;
    /** Bearer 토큰 (선택) */
    apiKey?: string;
    /** 로그용 레이블 (예: 'dev', 'prod') */
    label?: string;
}

export interface ResumePushConfig {
    /** push 대상 목록. 여러 개 설정 시 모든 대상에 동시 push. */
    targets: ResumeTarget[];
    /** 증분 push 주기 ms (기본 300_000 = 5분) */
    intervalMs?: number;
    /** 시작 시 full sync 여부 (기본 false) */
    fullSyncOnStart?: boolean;
    /** full sync 전 대기 ms — collectors 초기 로딩 완료를 기다림 (기본 10_000) */
    fullSyncDelayMs?: number;
    /** SQLite DB 참조 (스냅샷 저장/복원, full sync 재구성 시 사용) */
    db?: Database.Database;
    /** 스냅샷 저장 주기 ms (기본 216_000_000 ≈ 2.5일) */
    snapshotIntervalMs?: number;
}

export interface ResumeSyncResult {
    ok: boolean;
    entries?: number;
    error?: string;
}

// ─── 스냅샷 DB 헬퍼 ───────────────────────────────────────────────────────────

const MAX_SNAPSHOTS = 5;
/** 기본 스냅샷 주기: 2.5일 */
const DEFAULT_SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000 * 60; // 60시간

function initSnapshotTable(db: Database.Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS resume_snapshots (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT    NOT NULL,
            entries_json TEXT  NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_resume_snapshots_created_at
            ON resume_snapshots(created_at DESC);
    `);
}

/** running total을 SQLite에 직렬화 저장. 오래된 것은 MAX_SNAPSHOTS 초과 시 삭제. */
function persistSnapshot(
    db: Database.Database,
    total: Map<AggregateKey, RunningEntry>,
): string {
    const created_at = new Date().toISOString();
    const serialized: SerializedEntry[] = [];

    for (const entry of total.values()) {
        if (entry.input_tokens === 0 && entry.output_tokens === 0) continue;
        const daily: Record<string, { input: number; output: number }> = {};
        for (const [date, d] of entry.daily) daily[date] = d;

        serialized.push({
            provider: entry.provider,
            model: entry.model,
            source: entry.source,
            input_tokens: entry.input_tokens,
            output_tokens: entry.output_tokens,
            sessions: Array.from(entry.sessions),
            daily,
        });
    }

    db.prepare(
        'INSERT INTO resume_snapshots (created_at, entries_json) VALUES (?, ?)',
    ).run(created_at, JSON.stringify(serialized));

    // 오래된 스냅샷 정리 (MAX_SNAPSHOTS 초과분)
    db.exec(`
        DELETE FROM resume_snapshots
        WHERE id NOT IN (
            SELECT id FROM resume_snapshots
            ORDER BY created_at DESC
            LIMIT ${MAX_SNAPSHOTS}
        )
    `);

    return created_at;
}

/** 최신 스냅샷을 로드하여 runningTotal Map으로 역직렬화 */
function loadLatestSnapshot(
    db: Database.Database,
): { createdAt: string; total: Map<AggregateKey, RunningEntry> } | null {
    const row = db.prepare(
        'SELECT id, created_at, entries_json FROM resume_snapshots ORDER BY created_at DESC LIMIT 1',
    ).get() as SnapshotRow | undefined;

    if (!row) return null;

    let serialized: SerializedEntry[];
    try {
        serialized = JSON.parse(row.entries_json) as SerializedEntry[];
    } catch {
        return null;
    }

    const total = new Map<AggregateKey, RunningEntry>();
    for (const s of serialized) {
        const key = aggregateKey(s.source, s.provider, s.model);
        const daily = new Map<string, { input: number; output: number }>();
        for (const [date, d] of Object.entries(s.daily)) daily.set(date, d);

        total.set(key, {
            provider: s.provider,
            model: s.model,
            source: s.source,
            input_tokens: s.input_tokens,
            output_tokens: s.output_tokens,
            sessions: new Set(s.sessions),
            daily,
        });
    }

    return { createdAt: row.created_at, total };
}

// ─── 집계 헬퍼 ────────────────────────────────────────────────────────────────

function deriveProvider(source: AgentSourceType, modelId?: string): string {
    if (modelId) {
        const m = modelId.toLowerCase();
        if (m.includes('claude')) return 'anthropic';
        if (m.includes('gpt') || m.includes('codex') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) return 'openai';
        if (m.includes('gemini')) return 'google';
        if (m.includes('mistral')) return 'mistral';
        if (m.includes('llama')) return 'meta';
        if (m === 'big-pickle' || m.includes('glm')) return 'zhipuai';
        if (m.includes('minimax')) return 'minimax';
    }
    switch (source) {
        case 'claude_code': return 'anthropic';
        case 'codex': return 'openai';
        case 'openclaw':
        case 'opencode': return 'unknown';
        default: return 'unknown';
    }
}

function aggregateKey(source: string, provider: string, model: string): AggregateKey {
    return `${source}::${provider}::${model}`;
}

function utcDateStr(ts: string): string {
    return new Date(ts).toISOString().slice(0, 10);
}

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

        if (!providers[provider]) {
            providers[provider] = { total: { input: 0, output: 0, sessions: 0 }, models: {}, _sessions: {} };
        }
        const pEntry = providers[provider]!;
        pEntry.total.input += input_tokens;
        pEntry.total.output += output_tokens;
        if (!pEntry.models[model]) pEntry.models[model] = { input: 0, output: 0, sessions: 0 };
        pEntry.models[model]!.input += input_tokens;
        pEntry.models[model]!.output += output_tokens;
        for (const sid of sessions) pEntry._sessions[sid] = true;

        if (!sources[source]) sources[source] = { input: 0, output: 0, sessions: 0, _sessions: {} };
        const sEntry = sources[source]!;
        sEntry.input += input_tokens;
        sEntry.output += output_tokens;
        for (const sid of sessions) {
            sEntry._sessions[sid] = true;
            globalSessions.add(sid);
        }

        for (const [date, d] of daily) {
            if (!history[date]) history[date] = { input: 0, output: 0 };
            history[date]!.input += d.input;
            history[date]!.output += d.output;
        }

        totalInput += input_tokens;
        totalOutput += output_tokens;
    }

    for (const pEntry of Object.values(providers)) {
        pEntry.total.sessions = Object.keys(pEntry._sessions).length;
        for (const mEntry of Object.values(pEntry.models)) {
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
 * SQLite events 테이블에서 `metrics.usage` 이벤트를 재집계.
 *
 * @param since - 이 시각 이후 이벤트만 처리 (ISO 8601). 미지정 시 전체.
 */
function buildRunningTotalFromDb(
    db: Database.Database,
    since?: string,
): Map<AggregateKey, RunningEntry> {
    const result = new Map<AggregateKey, RunningEntry>();

    // events 테이블이 없으면 (DB가 아직 초기화 전) 빈 결과 반환
    const tableExists = db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='events'",
    ).get();
    if (!tableExists) return result;

    type DbRow = {
        source: string;
        model_id: string | null;
        session_id: string;
        date: string;
        input_tokens: number;
        output_tokens: number;
    };

    const whereExtra = since ? `AND ts > '${since.replace(/'/g, "''")}'` : '';
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
          ${whereExtra}
    `).all() as DbRow[];

    for (const row of rows) {
        const modelId = row.model_id ?? 'unknown';
        const source = row.source;
        const provider = deriveProvider(source as AgentSourceType, modelId);
        const key = aggregateKey(source, provider, modelId);

        let entry = result.get(key);
        if (!entry) {
            entry = { provider, model: modelId, source, input_tokens: 0, output_tokens: 0, sessions: new Set(), daily: new Map() };
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

    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
}

// ─── mergeRunningTotal 헬퍼 ───────────────────────────────────────────────────

/** delta Map을 target Map에 병합 (누적 합산) */
function mergeInto(
    target: Map<AggregateKey, RunningEntry>,
    delta: Map<AggregateKey, RunningEntry>,
): void {
    for (const [key, src] of delta) {
        const dst = target.get(key);
        if (!dst) {
            target.set(key, {
                provider: src.provider,
                model: src.model,
                source: src.source,
                input_tokens: src.input_tokens,
                output_tokens: src.output_tokens,
                sessions: new Set(src.sessions),
                daily: new Map(src.daily),
            });
        } else {
            dst.input_tokens += src.input_tokens;
            dst.output_tokens += src.output_tokens;
            for (const sid of src.sessions) dst.sessions.add(sid);
            for (const [date, d] of src.daily) {
                const existing = dst.daily.get(date) ?? { input: 0, output: 0 };
                existing.input += d.input;
                existing.output += d.output;
                dst.daily.set(date, existing);
            }
        }
    }
}

// ─── ResumePushHook 클래스 ────────────────────────────────────────────────────

export class ResumePushHook {
    private buffer: TokenDelta[] = [];
    private runningTotal = new Map<AggregateKey, RunningEntry>();
    private consecutiveFailures = 0;
    private lastFullSyncAt: string | null = null;
    private lastSnapshotAt: string | null = null;

    private pushTimer?: ReturnType<typeof setInterval>;
    private snapshotTimer?: ReturnType<typeof setInterval>;
    private unsubscribe?: () => void;

    constructor(private readonly config: ResumePushConfig) {}

    /**
     * 훅을 시작한다.
     *
     * DB가 주어진 경우:
     *   1. 스냅샷 테이블 초기화
     *   2. 최신 스냅샷 복원 → runningTotal 복구
     *   3. 스냅샷 이후 이벤트만 replay (없으면 전체)
     *   4. 스냅샷 주기 타이머 시작
     */
    start(eventBus: EventBus): void {
        if (this.config.db) {
            this.restoreFromDb(this.config.db);
        }

        this.unsubscribe = eventBus.subscribeByType('metrics.usage', (event: UAEPEvent) => {
            this.onUsageEvent(event);
        });

        const intervalMs = this.config.intervalMs ?? 300_000;
        this.pushTimer = setInterval(() => { void this.flush(); }, intervalMs);

        if (this.config.db) {
            const snapshotIntervalMs = this.config.snapshotIntervalMs ?? DEFAULT_SNAPSHOT_INTERVAL_MS;
            this.snapshotTimer = setInterval(() => {
                this.saveSnapshot();
            }, snapshotIntervalMs);
        }

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

    /** 훅을 종료한다. 종료 전 스냅샷을 저장한다. */
    stop(): void {
        if (this.pushTimer !== undefined) clearInterval(this.pushTimer);
        if (this.snapshotTimer !== undefined) clearInterval(this.snapshotTimer);
        this.unsubscribe?.();
        // graceful shutdown 시 스냅샷 저장
        if (this.config.db && this.runningTotal.size > 0) {
            this.saveSnapshot();
        }
    }

    status(): {
        runningTotalEntries: number;
        bufferSize: number;
        consecutiveFailures: number;
        lastFullSyncAt: string | null;
        lastSnapshotAt: string | null;
    } {
        return {
            runningTotalEntries: this.runningTotal.size,
            bufferSize: this.buffer.length,
            consecutiveFailures: this.consecutiveFailures,
            lastFullSyncAt: this.lastFullSyncAt,
            lastSnapshotAt: this.lastSnapshotAt,
        };
    }

    /**
     * Full sync: 모든 대상 사이트를 DELETE 후 전체 누적 데이터를 PUT.
     * runningTotal이 비어 있고 db가 있으면 SQLite에서 재구성.
     */
    async fullSync(): Promise<ResumeSyncResult> {
        try {
            if (this.runningTotal.size === 0 && this.config.db) {
                console.log('[resume-push] Running total empty — rebuilding from SQLite...');
                const fromDb = buildRunningTotalFromDb(this.config.db);
                mergeInto(this.runningTotal, fromDb);
                console.log(`[resume-push] Rebuilt ${this.runningTotal.size} entries from SQLite`);
            }

            if (this.runningTotal.size === 0) {
                console.log('[resume-push] Full sync skipped: no data to sync');
                return { ok: true, entries: 0 };
            }

            const body = buildSnapshotBody(this.runningTotal);

            let syncSuccess = false;
            for (const target of this.config.targets) {
                const tag = target.label ?? target.url;
                try {
                    await httpRequest(target.url, 'DELETE', undefined, target.apiKey);
                    await httpRequest(target.url, 'PUT', body, target.apiKey);
                    console.log(`[resume-push] Full sync → ${tag} OK`);
                    syncSuccess = true;
                } catch (err) {
                    console.error(`[resume-push] Full sync → ${tag} failed: ${String(err)}`);
                }
            }

            const entries = Object.values(body.providers).reduce(
                (n, p) => n + Object.keys(p.models).length, 0,
            );
            if (!syncSuccess) {
                return { ok: false, error: 'All targets failed' };
            }
            this.lastFullSyncAt = new Date().toISOString();
            this.consecutiveFailures = 0;
            console.log(`[resume-push] Full sync complete (${entries} model entries, ${body.total.sessions} sessions)`);
            return { ok: true, entries };
        } catch (err) {
            const error = String(err);
            console.error(`[resume-push] Full sync failed: ${error}`);
            return { ok: false, error };
        }
    }

    // ─── private ──────────────────────────────────────────────────────────────

    /** DB에서 스냅샷 복원 후 델타 replay */
    private restoreFromDb(db: Database.Database): void {
        initSnapshotTable(db);

        const snapshot = loadLatestSnapshot(db);
        let replaySince: string | undefined;

        if (snapshot) {
            mergeInto(this.runningTotal, snapshot.total);
            replaySince = snapshot.createdAt;
            this.lastSnapshotAt = snapshot.createdAt;
            console.log(
                `[resume-push] Restored snapshot from ${snapshot.createdAt} (${this.runningTotal.size} entries)`,
            );
        }

        // 스냅샷 이후(또는 전체) 이벤트 replay
        const delta = buildRunningTotalFromDb(db, replaySince);
        if (delta.size > 0) {
            mergeInto(this.runningTotal, delta);
            console.log(
                `[resume-push] Replayed ${delta.size} entries from DB` +
                (replaySince ? ` (since ${replaySince})` : ' (full history)'),
            );
        }
    }

    /** 현재 runningTotal을 DB에 스냅샷으로 저장 */
    private saveSnapshot(): void {
        if (!this.config.db || this.runningTotal.size === 0) return;
        try {
            this.lastSnapshotAt = persistSnapshot(this.config.db, this.runningTotal);
            console.log(
                `[resume-push] Snapshot saved at ${this.lastSnapshotAt} (${this.runningTotal.size} entries)`,
            );
        } catch (err) {
            console.warn(`[resume-push] Failed to save snapshot: ${String(err)}`);
        }
    }

    private onUsageEvent(event: UAEPEvent): void {
        const data = event.data ?? {};
        const input = typeof data['input_tokens'] === 'number' ? data['input_tokens'] : 0;
        const output = typeof data['output_tokens'] === 'number' ? data['output_tokens'] : 0;
        if (input === 0 && output === 0) return;

        const provider = deriveProvider(event.source, event.model_id);
        const model = event.model_id ?? (typeof data['model'] === 'string' ? data['model'] : 'unknown');
        const date = utcDateStr(event.ts);

        this.buffer.push({ source: event.source, provider, model, input, output, session_id: event.session_id, date });

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

        let anySuccess = false;
        for (const target of this.config.targets) {
            const tag = target.label ?? target.url;
            let sent = 0;
            for (const entry of entries) {
                try {
                    await httpRequest(target.url, 'POST', {
                        provider: entry.provider,
                        model: entry.model,
                        source: entry.source,
                        input_tokens: entry.input_tokens,
                        output_tokens: entry.output_tokens,
                        session_ids: entry.session_ids,
                    }, target.apiKey);
                    sent++;
                } catch (err) {
                    console.warn(
                        `[resume-push] [${tag}] Failed to push ${entry.source}/${entry.provider}/${entry.model}: ${String(err)}`,
                    );
                }
            }
            if (sent > 0) {
                anySuccess = true;
                console.log(`[resume-push] [${tag}] Pushed ${sent}/${entries.length} entries`);
            }
        }

        if (anySuccess) {
            this.consecutiveFailures = 0;
        } else if (entries.length > 0) {
            this.consecutiveFailures++;
            console.warn(`[resume-push] All targets failed (consecutive: ${this.consecutiveFailures})`);
            if (this.consecutiveFailures >= 3) {
                console.warn('[resume-push] 3 consecutive failures — attempting full sync fallback');
                void this.fullSync();
            }
        }
    }
}

// ─── 환경변수 / 편의 함수 ──────────────────────────────────────────────────────

export function readResumePushConfigFromEnv(): ResumePushConfig | null {
    const targets: ResumeTarget[] = [];

    // 개발용(기본) 대상
    const devUrl = process.env['OBSERVATORY_RESUME_URL'];
    if (devUrl) {
        targets.push({
            url: devUrl,
            apiKey: process.env['OBSERVATORY_RESUME_API_KEY'] || undefined,
            label: 'dev',
        });
    }

    // 프로덕션 대상 (외부 배포 resume 사이트)
    const prodUrl = process.env['OBSERVATORY_RESUME_URL_PROD'];
    if (prodUrl) {
        targets.push({
            url: prodUrl,
            apiKey: process.env['OBSERVATORY_RESUME_API_KEY_PROD'] || undefined,
            label: 'prod',
        });
    }

    if (targets.length === 0) return null;

    return {
        targets,
        intervalMs: process.env['OBSERVATORY_RESUME_INTERVAL_MS']
            ? parseInt(process.env['OBSERVATORY_RESUME_INTERVAL_MS'], 10)
            : undefined,
        fullSyncOnStart: process.env['OBSERVATORY_RESUME_FULL_SYNC_ON_START'] === 'true',
        fullSyncDelayMs: process.env['OBSERVATORY_RESUME_FULL_SYNC_DELAY_MS']
            ? parseInt(process.env['OBSERVATORY_RESUME_FULL_SYNC_DELAY_MS'], 10)
            : undefined,
        snapshotIntervalMs: process.env['OBSERVATORY_RESUME_SNAPSHOT_INTERVAL_MS']
            ? parseInt(process.env['OBSERVATORY_RESUME_SNAPSHOT_INTERVAL_MS'], 10)
            : undefined,
    };
}

/** @deprecated `new ResumePushHook(config).start(eventBus)` 사용 권장. */
export function registerResumePushHook(eventBus: EventBus, config: ResumePushConfig): () => void {
    const hook = new ResumePushHook(config);
    hook.start(eventBus);
    return () => hook.stop();
}
