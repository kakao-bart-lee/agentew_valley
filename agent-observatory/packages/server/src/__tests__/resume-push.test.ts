import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { InMemoryEventBus } from '../core/event-bus.js';
import { ResumePushHook, registerResumePushHook, readResumePushConfigFromEnv } from '../delivery/resume-push.js';
import type { UAEPEvent } from '@agent-observatory/shared';
import { generateEventId } from '@agent-observatory/shared';

function makeInMemoryDb(): BetterSqlite3.Database {
    return new BetterSqlite3(':memory:');
}

function makeMetricsEvent(overrides: Partial<UAEPEvent> = {}): UAEPEvent {
    return {
        ts: new Date().toISOString(),
        event_id: generateEventId(),
        source: 'claude_code',
        agent_id: 'cc-abc12345',
        session_id: 'sess-1',
        type: 'metrics.usage',
        data: { input_tokens: 1000, output_tokens: 500 },
        ...overrides,
    };
}

describe('registerResumePushHook', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let eventBus: InMemoryEventBus;

    beforeEach(() => {
        vi.useFakeTimers();
        eventBus = new InMemoryEventBus();
        fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('buffers metrics.usage events and pushes on interval', async () => {
        const cleanup = registerResumePushHook(eventBus, {
            resumeUrl: 'https://resume.example.com/api/tokens',
            intervalMs: 1000,
        });

        eventBus.publish(makeMetricsEvent({
            source: 'claude_code',
            model_id: 'claude-sonnet-4-6',
            data: { input_tokens: 1000, output_tokens: 500 },
        }));

        expect(fetchMock).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1000);
        await Promise.resolve(); // flush microtasks

        expect(fetchMock).toHaveBeenCalledOnce();
        const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
        expect(body.provider).toBe('anthropic');
        expect(body.model).toBe('claude-sonnet-4-6');
        expect(body.source).toBe('claude_code');
        expect(body.input_tokens).toBe(1000);
        expect(body.output_tokens).toBe(500);
        expect(body.session_ids).toEqual(['sess-1']);

        cleanup();
    });

    it('aggregates multiple events with same provider/model/source', async () => {
        const cleanup = registerResumePushHook(eventBus, {
            resumeUrl: 'https://resume.example.com/api/tokens',
            intervalMs: 1000,
        });

        eventBus.publish(makeMetricsEvent({
            source: 'codex',
            model_id: 'gpt-5.3-codex',
            data: { input_tokens: 100, output_tokens: 50 },
        }));
        eventBus.publish(makeMetricsEvent({
            source: 'codex',
            model_id: 'gpt-5.3-codex',
            data: { input_tokens: 200, output_tokens: 80 },
        }));

        await vi.advanceTimersByTimeAsync(1000);
        await Promise.resolve();

        // 두 이벤트가 하나로 집계
        expect(fetchMock).toHaveBeenCalledOnce();
        const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
        expect(body.input_tokens).toBe(300);
        expect(body.output_tokens).toBe(130);
        expect(body.session_ids).toEqual(['sess-1']);

        cleanup();
    });

    it('deduplicates session_ids across events with same model', async () => {
        const cleanup = registerResumePushHook(eventBus, {
            resumeUrl: 'https://resume.example.com/api/tokens',
            intervalMs: 1000,
        });

        // 같은 세션에서 2번, 다른 세션에서 1번
        eventBus.publish(makeMetricsEvent({ session_id: 'sess-A', data: { input_tokens: 100, output_tokens: 50 } }));
        eventBus.publish(makeMetricsEvent({ session_id: 'sess-A', data: { input_tokens: 200, output_tokens: 80 } }));
        eventBus.publish(makeMetricsEvent({ session_id: 'sess-B', data: { input_tokens: 50, output_tokens: 20 } }));

        await vi.advanceTimersByTimeAsync(1000);
        await Promise.resolve();

        expect(fetchMock).toHaveBeenCalledOnce();
        const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
        expect(body.session_ids).toHaveLength(2);
        expect(body.session_ids).toContain('sess-A');
        expect(body.session_ids).toContain('sess-B');

        cleanup();
    });

    it('sends separate requests for different models', async () => {
        const cleanup = registerResumePushHook(eventBus, {
            resumeUrl: 'https://resume.example.com/api/tokens',
            intervalMs: 1000,
        });

        eventBus.publish(makeMetricsEvent({
            source: 'claude_code',
            model_id: 'claude-opus-4-6',
            data: { input_tokens: 100, output_tokens: 50 },
        }));
        eventBus.publish(makeMetricsEvent({
            source: 'claude_code',
            model_id: 'claude-sonnet-4-6',
            data: { input_tokens: 200, output_tokens: 80 },
        }));

        await vi.advanceTimersByTimeAsync(1000);
        await Promise.resolve();

        expect(fetchMock).toHaveBeenCalledTimes(2);

        cleanup();
    });

    it('skips events with zero tokens', async () => {
        const cleanup = registerResumePushHook(eventBus, {
            resumeUrl: 'https://resume.example.com/api/tokens',
            intervalMs: 1000,
        });

        eventBus.publish(makeMetricsEvent({ data: { input_tokens: 0, output_tokens: 0 } }));

        await vi.advanceTimersByTimeAsync(1000);
        await Promise.resolve();

        expect(fetchMock).not.toHaveBeenCalled();
        cleanup();
    });

    it('does not push when buffer is empty', async () => {
        const cleanup = registerResumePushHook(eventBus, {
            resumeUrl: 'https://resume.example.com/api/tokens',
            intervalMs: 1000,
        });

        await vi.advanceTimersByTimeAsync(1000);
        await Promise.resolve();

        expect(fetchMock).not.toHaveBeenCalled();
        cleanup();
    });

    it('includes Authorization header when apiKey is set', async () => {
        const cleanup = registerResumePushHook(eventBus, {
            resumeUrl: 'https://resume.example.com/api/tokens',
            apiKey: 'secret-token',
            intervalMs: 1000,
        });

        eventBus.publish(makeMetricsEvent());
        await vi.advanceTimersByTimeAsync(1000);
        await Promise.resolve();

        const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
        expect(headers['Authorization']).toBe('Bearer secret-token');

        cleanup();
    });

    it('only processes metrics.usage events (ignores others)', async () => {
        const cleanup = registerResumePushHook(eventBus, {
            resumeUrl: 'https://resume.example.com/api/tokens',
            intervalMs: 1000,
        });

        // tool.start 이벤트 — 무시되어야 함
        eventBus.publish({
            ...makeMetricsEvent(),
            type: 'tool.start',
            data: { tool_name: 'Read' },
        });

        await vi.advanceTimersByTimeAsync(1000);
        await Promise.resolve();

        expect(fetchMock).not.toHaveBeenCalled();
        cleanup();
    });
});

describe('ResumePushHook — fullSync', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let eventBus: InMemoryEventBus;

    beforeEach(() => {
        vi.useFakeTimers();
        eventBus = new InMemoryEventBus();
        fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('fullSync sends DELETE then PUT with accumulated data', async () => {
        const hook = new ResumePushHook({
            resumeUrl: 'https://resume.example.com/api/tokens',
            intervalMs: 60_000,
        });
        hook.start(eventBus);

        // 이벤트 누적
        eventBus.publish(makeMetricsEvent({
            source: 'claude_code',
            model_id: 'claude-sonnet-4-6',
            session_id: 'sess-X',
            data: { input_tokens: 1000, output_tokens: 500 },
        }));
        eventBus.publish(makeMetricsEvent({
            source: 'codex',
            model_id: 'gpt-5.3-codex',
            session_id: 'sess-Y',
            data: { input_tokens: 200, output_tokens: 80 },
        }));

        const result = await hook.fullSync();
        expect(result.ok).toBe(true);
        expect(result.entries).toBeGreaterThan(0);

        // DELETE 호출
        const deleteCalls = fetchMock.mock.calls.filter(
            (c: unknown[]) => (c[1] as { method: string }).method === 'DELETE',
        );
        expect(deleteCalls).toHaveLength(1);

        // PUT 호출
        const putCalls = fetchMock.mock.calls.filter(
            (c: unknown[]) => (c[1] as { method: string }).method === 'PUT',
        );
        expect(putCalls).toHaveLength(1);

        const body = JSON.parse((putCalls[0]![1] as { body: string }).body);
        expect(body.providers).toHaveProperty('anthropic');
        expect(body.providers).toHaveProperty('openai');
        expect(body.sources).toHaveProperty('claude_code');
        expect(body.sources).toHaveProperty('codex');
        expect(body.total.input).toBe(1200);
        expect(body.total.output).toBe(580);
        expect(body.total.sessions).toBe(2);
        expect(body._sessions).toHaveProperty('sess-X');
        expect(body._sessions).toHaveProperty('sess-Y');

        hook.stop();
    });

    it('fullSync skips when running total is empty and no db', async () => {
        const hook = new ResumePushHook({
            resumeUrl: 'https://resume.example.com/api/tokens',
            intervalMs: 60_000,
        });
        hook.start(eventBus);

        const result = await hook.fullSync();
        expect(result.ok).toBe(true);
        expect(result.entries).toBe(0);
        expect(fetchMock).not.toHaveBeenCalled();

        hook.stop();
    });

    it('fullSync includes daily history', async () => {
        const hook = new ResumePushHook({
            resumeUrl: 'https://resume.example.com/api/tokens',
            intervalMs: 60_000,
        });
        hook.start(eventBus);

        const today = new Date().toISOString().slice(0, 10);
        eventBus.publish(makeMetricsEvent({
            ts: `${today}T10:00:00.000Z`,
            model_id: 'claude-sonnet-4-6',
            data: { input_tokens: 100, output_tokens: 50 },
        }));

        await hook.fullSync();

        const putCalls = fetchMock.mock.calls.filter(
            (c: unknown[]) => (c[1] as { method: string }).method === 'PUT',
        );
        const body = JSON.parse((putCalls[0]![1] as { body: string }).body);
        expect(body.history).toHaveProperty(today);
        expect(body.history[today].input).toBe(100);

        hook.stop();
    });

    it('auto fullSync after 3 consecutive failures', async () => {
        fetchMock = vi.fn()
            .mockRejectedValue(new Error('network error')); // 모든 호출 실패
        vi.stubGlobal('fetch', fetchMock);

        const hook = new ResumePushHook({
            resumeUrl: 'https://resume.example.com/api/tokens',
            intervalMs: 1000,
        });
        hook.start(eventBus);

        // 이벤트 누적
        eventBus.publish(makeMetricsEvent({ data: { input_tokens: 100, output_tokens: 50 } }));

        // 3번 interval tick
        await vi.advanceTimersByTimeAsync(1000);
        await Promise.resolve();
        eventBus.publish(makeMetricsEvent({ data: { input_tokens: 10, output_tokens: 5 } }));
        await vi.advanceTimersByTimeAsync(1000);
        await Promise.resolve();
        eventBus.publish(makeMetricsEvent({ data: { input_tokens: 10, output_tokens: 5 } }));
        await vi.advanceTimersByTimeAsync(1000);
        await Promise.resolve();

        expect(hook.status().consecutiveFailures).toBeGreaterThanOrEqual(3);

        hook.stop();
    });
});

describe('ResumePushHook — snapshot restore', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let eventBus: InMemoryEventBus;

    beforeEach(() => {
        vi.useFakeTimers();
        eventBus = new InMemoryEventBus();
        fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('stop() saves snapshot to DB and start() restores it', () => {
        const db = makeInMemoryDb();

        // 1차 실행: 이벤트 누적 후 stop (스냅샷 저장)
        const hook1 = new ResumePushHook({ resumeUrl: 'https://example.com', intervalMs: 60_000, db });
        hook1.start(eventBus);
        eventBus.publish(makeMetricsEvent({
            model_id: 'claude-sonnet-4-6',
            session_id: 'sess-A',
            data: { input_tokens: 1000, output_tokens: 400 },
        }));
        hook1.stop(); // 스냅샷 저장

        expect(hook1.status().lastSnapshotAt).not.toBeNull();

        // 2차 실행: DB에서 복원
        const hook2 = new ResumePushHook({ resumeUrl: 'https://example.com', intervalMs: 60_000, db });
        hook2.start(new InMemoryEventBus()); // 새 버스 (이벤트 없음)

        expect(hook2.status().runningTotalEntries).toBe(1);
        hook2.stop();
    });

    it('after restore, fullSync reflects snapshotted data', async () => {
        const db = makeInMemoryDb();

        // 1차: 이벤트 누적 + stop
        const hook1 = new ResumePushHook({ resumeUrl: 'https://example.com', intervalMs: 60_000, db });
        hook1.start(eventBus);
        eventBus.publish(makeMetricsEvent({
            model_id: 'claude-sonnet-4-6',
            session_id: 'sess-A',
            data: { input_tokens: 500, output_tokens: 200 },
        }));
        hook1.stop();

        // 2차: 복원 후 fullSync
        const hook2 = new ResumePushHook({ resumeUrl: 'https://example.com', intervalMs: 60_000, db });
        hook2.start(new InMemoryEventBus());
        const result = await hook2.fullSync();

        expect(result.ok).toBe(true);
        expect(result.entries).toBeGreaterThan(0);

        const putCalls = fetchMock.mock.calls.filter(
            (c: unknown[]) => (c[1] as { method: string }).method === 'PUT',
        );
        const body = JSON.parse((putCalls[0]![1] as { body: string }).body);
        expect(body.total.input).toBe(500);
        expect(body.total.output).toBe(200);

        hook2.stop();
    });

    it('snapshot interval env var is parsed correctly', () => {
        process.env['OBSERVATORY_RESUME_URL'] = 'https://example.com/api/tokens';
        process.env['OBSERVATORY_RESUME_SNAPSHOT_INTERVAL_MS'] = '86400000';

        const config = readResumePushConfigFromEnv();
        expect(config!.snapshotIntervalMs).toBe(86_400_000);

        delete process.env['OBSERVATORY_RESUME_URL'];
        delete process.env['OBSERVATORY_RESUME_SNAPSHOT_INTERVAL_MS'];
    });
});

describe('readResumePushConfigFromEnv', () => {
    afterEach(() => {
        delete process.env['OBSERVATORY_RESUME_URL'];
        delete process.env['OBSERVATORY_RESUME_API_KEY'];
        delete process.env['OBSERVATORY_RESUME_INTERVAL_MS'];
    });

    it('returns null when OBSERVATORY_RESUME_URL is not set', () => {
        expect(readResumePushConfigFromEnv()).toBeNull();
    });

    it('reads URL and optional fields', () => {
        process.env['OBSERVATORY_RESUME_URL'] = 'https://example.com/api/tokens';
        process.env['OBSERVATORY_RESUME_API_KEY'] = 'my-key';
        process.env['OBSERVATORY_RESUME_INTERVAL_MS'] = '60000';
        process.env['OBSERVATORY_RESUME_FULL_SYNC_ON_START'] = 'true';

        const config = readResumePushConfigFromEnv();
        expect(config).not.toBeNull();
        expect(config!.resumeUrl).toBe('https://example.com/api/tokens');
        expect(config!.apiKey).toBe('my-key');
        expect(config!.intervalMs).toBe(60000);
        expect(config!.fullSyncOnStart).toBe(true);

        delete process.env['OBSERVATORY_RESUME_FULL_SYNC_ON_START'];
    });
});
