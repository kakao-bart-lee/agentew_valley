import type {
  AdapterCapabilities,
  CollectOptions,
  ObservatoryAdapter,
} from '@agent-observatory/shared';

class StubObservatoryAdapter implements ObservatoryAdapter {
  readonly capabilities: AdapterCapabilities;

  constructor(
    readonly type: string,
    capabilities: AdapterCapabilities,
    private readonly connectionMessage: string,
  ) {
    this.capabilities = capabilities;
  }

  async collect(_options: CollectOptions): Promise<void> {
    return;
  }

  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    return {
      ok: false,
      message: this.connectionMessage,
    };
  }
}

export class ClaudeCodeAdapter extends StubObservatoryAdapter {
  constructor() {
    super('claude_code', {
      costTracking: true,
      logStreaming: true,
      statusUpdates: true,
      goalParsing: false,
      taskSync: false,
    }, 'Claude Code adapter stub is registered but not connected yet.');
  }
}

export class OpenClawAdapter extends StubObservatoryAdapter {
  constructor() {
    super('openclaw', {
      costTracking: true,
      logStreaming: true,
      statusUpdates: true,
      goalParsing: false,
      taskSync: false,
    }, 'OpenClaw adapter stub is registered but not connected yet.');
  }
}

export class OpenCodeAdapter extends StubObservatoryAdapter {
  constructor() {
    super('opencode', {
      costTracking: false,
      logStreaming: true,
      statusUpdates: true,
      goalParsing: false,
      taskSync: false,
    }, 'OpenCode adapter stub is registered but not connected yet.');
  }
}
