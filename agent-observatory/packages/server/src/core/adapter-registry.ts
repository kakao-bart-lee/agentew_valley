import {
  ClaudeCodeAdapter,
  MissionControlCollector,
  OpenClawAdapter,
  OpenCodeAdapter,
} from '@agent-observatory/collectors';
import type {
  AdapterSummary,
  ObservatoryAdapter,
} from '@agent-observatory/shared';

interface RegistryEntry {
  adapter: ObservatoryAdapter;
  summary: AdapterSummary;
}

export class ObservatoryAdapterRegistry {
  private readonly entries = new Map<string, RegistryEntry>();

  constructor(watchPaths: string[]) {
    this.register(
      new MissionControlCollector({ watchPaths }),
      { label: 'Mission Control', status: 'ready' },
    );
    this.register(
      new ClaudeCodeAdapter(),
      { label: 'Claude Code', status: 'stub' },
    );
    this.register(
      new OpenClawAdapter(),
      { label: 'OpenClaw', status: 'stub' },
    );
    this.register(
      new OpenCodeAdapter(),
      { label: 'OpenCode', status: 'stub' },
    );
  }

  register(adapter: ObservatoryAdapter, options: { label: string; status: AdapterSummary['status'] }): void {
    this.entries.set(adapter.type, {
      adapter,
      summary: {
        type: adapter.type,
        label: options.label,
        status: options.status,
        capabilities: adapter.capabilities,
      },
    });
  }

  list(): AdapterSummary[] {
    return Array.from(this.entries.values())
      .map(({ summary }) => ({ ...summary }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }

  has(type: string): boolean {
    return this.entries.has(type);
  }

  get(type: string): AdapterSummary | undefined {
    const entry = this.entries.get(type);
    return entry ? { ...entry.summary } : undefined;
  }

  async test(type: string): Promise<{ adapter: AdapterSummary; result: { ok: boolean; message?: string } } | null> {
    const entry = this.entries.get(type);
    if (!entry) {
      return null;
    }

    const result = await entry.adapter.testConnection();
    entry.summary = {
      ...entry.summary,
      status: entry.summary.status === 'stub'
        ? 'stub'
        : result.ok
          ? 'ready'
          : 'error',
      last_tested_at: Math.floor(Date.now() / 1000),
      last_test_result: result,
    };

    return {
      adapter: { ...entry.summary },
      result,
    };
  }
}
