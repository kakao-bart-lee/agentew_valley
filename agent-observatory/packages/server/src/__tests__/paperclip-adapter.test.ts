import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaperclipAdapter } from '../core/paperclip-adapter.js';

describe('PaperclipAdapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env['PAPERCLIP_API_URL'];
    delete process.env['PAPERCLIP_API_KEY'];
  });

  describe('fromEnv()', () => {
    it('returns null when PAPERCLIP_API_URL is not set', () => {
      expect(PaperclipAdapter.fromEnv()).toBeNull();
    });

    it('returns adapter when PAPERCLIP_API_URL is set', () => {
      process.env['PAPERCLIP_API_URL'] = 'http://paperclip.local';
      expect(PaperclipAdapter.fromEnv()).toBeInstanceOf(PaperclipAdapter);
    });
  });

  describe('getTask()', () => {
    it('returns task from Paperclip API', async () => {
      const adapter = new PaperclipAdapter('http://paperclip.local');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ task: { id: 'T-42', title: '로그인 페이지 구현', status: 'in_progress' } }),
      }));

      const task = await adapter.getTask('T-42');
      expect(task?.id).toBe('T-42');
      expect(task?.title).toBe('로그인 페이지 구현');
    });

    it('returns undefined when API returns non-ok', async () => {
      const adapter = new PaperclipAdapter('http://paperclip.local');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

      const task = await adapter.getTask('T-nonexistent');
      expect(task).toBeUndefined();
    });

    it('returns undefined on network error (graceful degradation)', async () => {
      const adapter = new PaperclipAdapter('http://paperclip.local');
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

      const task = await adapter.getTask('T-42');
      expect(task).toBeUndefined();
    });

    it('caches results within TTL', async () => {
      const adapter = new PaperclipAdapter('http://paperclip.local', undefined, 60_000);
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ task: { id: 'T-1', title: 'Task One' } }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await adapter.getTask('T-1');
      await adapter.getTask('T-1');

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('re-fetches after cache expires', async () => {
      const adapter = new PaperclipAdapter('http://paperclip.local', undefined, 1); // 1ms TTL
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ task: { id: 'T-1', title: 'Task One' } }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await adapter.getTask('T-1');
      await new Promise((resolve) => setTimeout(resolve, 5)); // TTL 만료 대기
      await adapter.getTask('T-1');

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('getProject()', () => {
    it('returns project from Paperclip API', async () => {
      const adapter = new PaperclipAdapter('http://paperclip.local');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ project: { id: 'moonlit', name: 'Project Moonlit' } }),
      }));

      const project = await adapter.getProject('moonlit');
      expect(project?.id).toBe('moonlit');
      expect(project?.name).toBe('Project Moonlit');
    });

    it('returns undefined on failure', async () => {
      const adapter = new PaperclipAdapter('http://paperclip.local');
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));

      expect(await adapter.getProject('moonlit')).toBeUndefined();
    });
  });

  describe('Authorization header', () => {
    it('sends Authorization header when apiKey is set', async () => {
      const adapter = new PaperclipAdapter('http://paperclip.local', 'secret-key');
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ task: { id: 'T-1', title: 'T' } }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await adapter.getTask('T-1');

      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
      expect((callArgs[1].headers as Record<string, string>)['Authorization']).toBe('Bearer secret-key');
    });
  });
});
