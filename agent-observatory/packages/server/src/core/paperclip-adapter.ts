/**
 * R-005: Paperclip Adapter (읽기 전용)
 *
 * Observatory UI에서 task/project 이름을 Paperclip API에서 조회.
 * Observatory는 Paperclip 데이터를 저장하지 않음 — 표시 전용.
 *
 * 미연동 시 (PAPERCLIP_API_URL 미설정): undefined 반환 → graceful degradation.
 */

export interface PaperclipTask {
  id: string;
  title: string;
  status?: string;
  project?: string;
}

export interface PaperclipProject {
  id: string;
  name: string;
}

interface CacheEntry<T> {
  value: T | null;
  expiresAt: number;
}

export class PaperclipAdapter {
  private readonly taskCache = new Map<string, CacheEntry<PaperclipTask>>();
  private readonly projectCache = new Map<string, CacheEntry<PaperclipProject>>();

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string,
    /** 캐시 TTL (ms). 기본 5분 */
    private readonly ttlMs: number = 5 * 60 * 1000,
  ) {}

  /** Paperclip API URL로 어댑터 생성. URL이 없으면 null 반환. */
  static fromEnv(): PaperclipAdapter | null {
    const url = process.env['PAPERCLIP_API_URL'];
    if (!url) return null;
    const key = process.env['PAPERCLIP_API_KEY'] || undefined;
    return new PaperclipAdapter(url, key);
  }

  /** task_id → Paperclip task 조회. 실패/미연동 시 undefined */
  async getTask(taskId: string): Promise<PaperclipTask | undefined> {
    const cached = this.taskCache.get(taskId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value ?? undefined;
    }

    try {
      const res = await fetch(`${this.baseUrl}/api/tasks/${encodeURIComponent(taskId)}`, {
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) {
        this.taskCache.set(taskId, { value: null, expiresAt: Date.now() + this.ttlMs });
        return undefined;
      }
      const body = await res.json() as { task?: PaperclipTask };
      const task = body.task ?? null;
      this.taskCache.set(taskId, { value: task, expiresAt: Date.now() + this.ttlMs });
      return task ?? undefined;
    } catch {
      // 네트워크 오류 / 타임아웃 → graceful degradation
      return undefined;
    }
  }

  /** project_id → Paperclip project 조회. 실패/미연동 시 undefined */
  async getProject(projectId: string): Promise<PaperclipProject | undefined> {
    const cached = this.projectCache.get(projectId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value ?? undefined;
    }

    try {
      const res = await fetch(`${this.baseUrl}/api/projects/${encodeURIComponent(projectId)}`, {
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) {
        this.projectCache.set(projectId, { value: null, expiresAt: Date.now() + this.ttlMs });
        return undefined;
      }
      const body = await res.json() as { project?: PaperclipProject };
      const project = body.project ?? null;
      this.projectCache.set(projectId, { value: project, expiresAt: Date.now() + this.ttlMs });
      return project ?? undefined;
    } catch {
      return undefined;
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
    return headers;
  }

  /** 테스트/디버그용 캐시 초기화 */
  clearCache(): void {
    this.taskCache.clear();
    this.projectCache.clear();
  }
}
