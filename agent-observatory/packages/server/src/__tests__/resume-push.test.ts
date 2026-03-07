import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InMemoryEventBus } from '../core/event-bus.js';
import { ResumePushHook, registerResumePushHook, readResumePushConfigFromEnv } from '../delivery/resume-push.js';
import type { UAEPEvent } from '@agent-observatory/shared';
import { generateEventId } from '@agent-observatory/shared';

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

        const config = readResumePushConfigFromEnv();
        expect(config).not.toBeNull();
        expect(config!.resumeUrl).toBe('https://example.com/api/tokens');
        expect(config!.apiKey).toBe('my-key');
        expect(config!.intervalMs).toBe(60000);
    });
});
