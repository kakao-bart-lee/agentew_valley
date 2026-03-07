import type {
  MetricsSnapshot,
  UAEPEvent,
  ToolCategory,
  AgentSourceType,
} from '@agent-observatory/shared';
import { getToolCategory, estimateCostUsd } from '@agent-observatory/shared';
import type { StateManager } from './state-manager.js';
import type Database from 'better-sqlite3';

interface MinuteWindow {
  ts: string;
  input_tokens: number;
  output_tokens: number;
  tokens: number;
  cost: number;
  tool_calls: number;
  errors: number;
  active_agents: Set<string>;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  llm_responses: number;
}

const MAX_WINDOWS = 60;

function minuteKey(date: Date): string {
  const d = new Date(date);
  d.setSeconds(0, 0);
  return d.toISOString();
}

export class MetricsAggregator {
  private windows: MinuteWindow[] = [];
  private totalToolCalls = 0;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalTokens = 0;
  private totalCost = 0;
  private totalErrors = 0;
  private totalSessions = 0;
  private toolDistribution: Record<string, number> = {};
  private sourceDistribution: Record<string, number> = {};
  private modelDistribution: Record<string, { agent_count: number; token_count: number }> = {};
  private totalCacheReadTokens = 0;
  private totalCacheCreationTokens = 0;
  private stateManager?: StateManager;
  private db?: Database.Database;

  setStateManager(sm: StateManager): void {
    this.stateManager = sm;
  }

  /** Set SQLite DB instance for persisting timeseries data beyond in-memory window */
  setDb(db: Database.Database): void {
    this.db = db;
    this.initMetricsTable();
  }

  private initMetricsTable(): void {
    if (!this.db) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metrics_timeseries (
        ts TEXT PRIMARY KEY,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        tokens INTEGER DEFAULT 0,
        cost REAL DEFAULT 0,
        tool_calls INTEGER DEFAULT 0,
        errors INTEGER DEFAULT 0,
        active_agents INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_metrics_ts ON metrics_timeseries(ts);
    `);
    // 기존 테이블에 새 컬럼 추가 (이미 존재하면 무시)
    for (const col of ['input_tokens INTEGER DEFAULT 0', 'output_tokens INTEGER DEFAULT 0']) {
      try {
        this.db.exec(`ALTER TABLE metrics_timeseries ADD COLUMN ${col}`);
      } catch {
        // 컬럼이 이미 존재하는 경우 무시
      }
    }
  }

  handleEvent(event: UAEPEvent): void {
    const window = this.getOrCreateWindow(new Date(event.ts));
    window.active_agents.add(event.agent_id);

    switch (event.type) {
      case 'session.start':
        this.totalSessions++;
        this.sourceDistribution[event.source] =
          (this.sourceDistribution[event.source] ?? 0) + 1;
        // 모델 분포 집계 (session.start 이벤트에서 model_id 추출)
        if (event.model_id) {
          const entry = this.modelDistribution[event.model_id] ?? { agent_count: 0, token_count: 0 };
          entry.agent_count++;
          this.modelDistribution[event.model_id] = entry;
        }
        break;
      case 'tool.start': {
        this.totalToolCalls++;
        window.tool_calls++;
        const toolName = (event.data?.['tool_name'] as string) ?? 'unknown';
        const category = getToolCategory(toolName);
        this.toolDistribution[category] = (this.toolDistribution[category] ?? 0) + 1;
        break;
      }
      case 'tool.error':
        this.totalErrors++;
        window.errors++;
        break;
      case 'metrics.usage': {
        const inputTokens = typeof event.data?.['input_tokens'] === 'number'
          ? (event.data['input_tokens'] as number)
          : 0;
        const outputTokens = typeof event.data?.['output_tokens'] === 'number'
          ? (event.data['output_tokens'] as number)
          : 0;
        const totalTokens = typeof event.data?.['tokens'] === 'number'
          ? (event.data['tokens'] as number)
          : inputTokens + outputTokens;

        this.totalInputTokens += inputTokens;
        this.totalOutputTokens += outputTokens;
        this.totalTokens += totalTokens;
        window.input_tokens += inputTokens;
        window.output_tokens += outputTokens;
        window.tokens += totalTokens;

        const reportedCost = typeof event.data?.['cost'] === 'number'
          ? (event.data['cost'] as number)
          : undefined;
        const modelIdForCost = event.model_id ?? (event.data?.['model_id'] as string | undefined);
        const cost = (reportedCost !== undefined && reportedCost > 0)
          ? reportedCost
          : (modelIdForCost ? estimateCostUsd(modelIdForCost, inputTokens, outputTokens) : 0);
        if (cost > 0) {
          this.totalCost += cost;
          window.cost += cost;
        }
        // 캐시 토큰 집계
        const cacheRead = typeof event.data?.['cache_read_input_tokens'] === 'number'
          ? (event.data['cache_read_input_tokens'] as number) : 0;
        const cacheCreate = typeof event.data?.['cache_creation_input_tokens'] === 'number'
          ? (event.data['cache_creation_input_tokens'] as number) : 0;
        this.totalCacheReadTokens += cacheRead;
        this.totalCacheCreationTokens += cacheCreate;
        window.cache_read_tokens += cacheRead;
        window.cache_creation_tokens += cacheCreate;
        // 모델별 토큰 집계
        const modelId = event.model_id ?? (event.data?.['model_id'] as string | undefined);
        if (modelId) {
          const entry = this.modelDistribution[modelId] ?? { agent_count: 0, token_count: 0 };
          entry.token_count += totalTokens;
          this.modelDistribution[modelId] = entry;
        }
        break;
      }
      case 'llm.end': {
        window.llm_responses++;
        break;
      }
      default:
        break;
    }
  }

  private buildModelDistribution(): Record<string, { agent_count: number; token_count: number }> {
    // 1. StateManager 현재 에이전트 기준 (live agents)
    const liveAgentIds = new Set<string>();
    const result: Record<string, { agent_count: number; token_count: number }> = {};

    if (this.stateManager) {
      for (const agent of this.stateManager.getAllAgents()) {
        liveAgentIds.add(agent.agent_id);
        if (!agent.model_id) continue;
        const entry = result[agent.model_id] ?? { agent_count: 0, token_count: 0 };
        entry.agent_count++;
        entry.token_count += agent.total_tokens;
        result[agent.model_id] = entry;
      }
    }

    // 2. 이벤트 누적분에서 이미 종료된(StateManager에 없는) 에이전트 토큰만 추가
    for (const [modelId, dist] of Object.entries(this.modelDistribution)) {
      if (result[modelId]) continue; // live 에이전트가 있으면 스킵 (중복 방지)
      result[modelId] = { agent_count: dist.agent_count, token_count: dist.token_count };
    }

    return result;
  }

  getSnapshot(): MetricsSnapshot {
    const now = new Date();
    this.pruneOldWindows(now);

    const activeAgents = this.stateManager?.getAllAgents().length ?? 0;
    const totalAgents = activeAgents;

    const timestamps: string[] = [];
    const inputTokensPerMinute: number[] = [];
    const outputTokensPerMinute: number[] = [];
    const tokensPerMinute: number[] = [];
    const costPerMinute: number[] = [];
    const activeAgentsTs: number[] = [];
    const toolCallsPerMinute: number[] = [];
    const errorCount: number[] = [];
    const cacheHitRate: number[] = [];
    const llmResponsesPerMinute: number[] = [];

    for (const w of this.windows) {
      timestamps.push(w.ts);
      inputTokensPerMinute.push(w.input_tokens);
      outputTokensPerMinute.push(w.output_tokens);
      tokensPerMinute.push(w.tokens);
      costPerMinute.push(w.cost);
      activeAgentsTs.push(w.active_agents.size);
      toolCallsPerMinute.push(w.tool_calls);
      errorCount.push(w.errors);
      const totalIn = w.input_tokens + w.cache_read_tokens;
      cacheHitRate.push(totalIn > 0 ? w.cache_read_tokens / totalIn : 0);
      llmResponsesPerMinute.push(w.llm_responses);
    }

    const recentWindow = this.windows[this.windows.length - 1];
    const tokensLastMin = recentWindow?.tokens ?? 0;
    const toolCallsLastMin = recentWindow?.tool_calls ?? 0;

    const last5 = this.windows.slice(-5);
    const errorsLast5 = last5.reduce((s, w) => s + w.errors, 0);
    const totalCallsLast5 = last5.reduce((s, w) => s + w.tool_calls, 0);
    const toolErrorRate = totalCallsLast5 > 0 ? errorsLast5 / totalCallsLast5 : 0;

    const errorsLastHour = this.windows.reduce((s, w) => s + w.errors, 0);
    const costLastHour = this.windows.reduce((s, w) => s + w.cost, 0);

    return {
      timestamp: now.toISOString(),
      active_agents: activeAgents,
      total_agents: totalAgents,
      total_sessions: this.totalSessions,
      total_tool_calls: this.totalToolCalls,
      total_input_tokens: this.totalInputTokens,
      total_output_tokens: this.totalOutputTokens,
      total_cost_usd: this.totalCost,
      tool_error_rate: toolErrorRate,
      total_tokens_per_minute: tokensLastMin,
      total_cost_per_hour: costLastHour,
      total_errors_last_hour: errorsLastHour,
      total_tool_calls_per_minute: toolCallsLastMin,
      tool_distribution: { ...this.toolDistribution } as Record<ToolCategory, number>,
      source_distribution: { ...this.sourceDistribution } as Record<AgentSourceType, number>,
      model_distribution: this.buildModelDistribution(),
      cache_hit_rate: this.totalCacheReadTokens > 0
        ? this.totalCacheReadTokens / (this.totalInputTokens + this.totalCacheReadTokens)
        : 0,
      cache_read_tokens: this.totalCacheReadTokens,
      cache_creation_tokens: this.totalCacheCreationTokens,
      llm_responses_per_minute: recentWindow?.llm_responses ?? 0,
      timeseries: {
        timestamps,
        input_tokens_per_minute: inputTokensPerMinute,
        output_tokens_per_minute: outputTokensPerMinute,
        tokens_per_minute: tokensPerMinute,
        cost_per_minute: costPerMinute,
        active_agents: activeAgentsTs,
        tool_calls_per_minute: toolCallsPerMinute,
        error_count: errorCount,
        cache_hit_rate: cacheHitRate,
        llm_responses_per_minute: llmResponsesPerMinute,
      },
    };
  }

  getTimeseries(
    metric: string,
    fromMinutesAgo: number,
  ): { ts: string; value: number }[] {
    const now = new Date();
    this.pruneOldWindows(now);

    // If within in-memory range, use windows
    if (fromMinutesAgo <= MAX_WINDOWS) {
      return this.getInMemoryTimeseries(metric, fromMinutesAgo, now);
    }

    // Otherwise, combine SQLite historical + in-memory recent
    return this.getCombinedTimeseries(metric, fromMinutesAgo, now);
  }

  private getInMemoryTimeseries(
    metric: string,
    fromMinutesAgo: number,
    now: Date,
  ): { ts: string; value: number }[] {
    const cutoff = new Date(now.getTime() - fromMinutesAgo * 60_000);
    const result: { ts: string; value: number }[] = [];

    for (const w of this.windows) {
      if (new Date(w.ts) < cutoff) continue;
      result.push({ ts: w.ts, value: this.extractMetricValue(w, metric) });
    }

    return result;
  }

  private getCombinedTimeseries(
    metric: string,
    fromMinutesAgo: number,
    now: Date,
  ): { ts: string; value: number }[] {
    const cutoff = new Date(now.getTime() - fromMinutesAgo * 60_000);
    const result: { ts: string; value: number }[] = [];

    // Get historical data from SQLite
    if (this.db) {
      const dbColumn = this.metricToColumn(metric);
      if (dbColumn) {
        const rows = this.db.prepare(`
          SELECT ts, ${dbColumn} as value FROM metrics_timeseries
          WHERE ts >= ? ORDER BY ts ASC
        `).all(cutoff.toISOString()) as { ts: string; value: number }[];
        result.push(...rows);
      }
    }

    // Merge in-memory windows (they may overlap with persisted data, prefer in-memory)
    const existingTs = new Set(result.map((r) => r.ts));
    for (const w of this.windows) {
      if (new Date(w.ts) < cutoff) continue;
      if (existingTs.has(w.ts)) {
        // Replace with in-memory (more accurate for recent data)
        const idx = result.findIndex((r) => r.ts === w.ts);
        if (idx >= 0) {
          result[idx] = { ts: w.ts, value: this.extractMetricValue(w, metric) };
        }
      } else {
        result.push({ ts: w.ts, value: this.extractMetricValue(w, metric) });
      }
    }

    // Sort by timestamp
    result.sort((a, b) => a.ts.localeCompare(b.ts));

    return result;
  }

  /** Get historical timeseries from SQLite for a specific time range */
  getHistoricalTimeseries(
    metric: string,
    from: string,
    to: string,
  ): { ts: string; value: number }[] {
    if (!this.db) return [];

    const dbColumn = this.metricToColumn(metric);
    if (!dbColumn) return [];

    return this.db.prepare(`
      SELECT ts, ${dbColumn} as value FROM metrics_timeseries
      WHERE ts >= ? AND ts <= ? ORDER BY ts ASC
    `).all(from, to) as { ts: string; value: number }[];
  }

  private extractMetricValue(w: MinuteWindow, metric: string): number {
    switch (metric) {
      case 'tokens_per_minute': return w.tokens;
      case 'cost_per_minute': return w.cost;
      case 'active_agents': return w.active_agents.size;
      case 'tool_calls_per_minute': return w.tool_calls;
      case 'error_count': return w.errors;
      default: return 0;
    }
  }

  private metricToColumn(metric: string): string | null {
    switch (metric) {
      case 'tokens_per_minute': return 'tokens';
      case 'cost_per_minute': return 'cost';
      case 'active_agents': return 'active_agents';
      case 'tool_calls_per_minute': return 'tool_calls';
      case 'error_count': return 'errors';
      default: return null;
    }
  }

  getTotalToolCalls(): number {
    return this.totalToolCalls;
  }

  getTotalTokens(): number {
    return this.totalTokens;
  }

  getTotalCost(): number {
    return this.totalCost;
  }

  private getOrCreateWindow(date: Date): MinuteWindow {
    const key = minuteKey(date);

    if (this.windows.length > 0) {
      const last = this.windows[this.windows.length - 1]!;
      if (last.ts === key) return last;
    }

    const window: MinuteWindow = {
      ts: key,
      input_tokens: 0,
      output_tokens: 0,
      tokens: 0,
      cost: 0,
      tool_calls: 0,
      errors: 0,
      active_agents: new Set(),
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      llm_responses: 0,
    };

    this.windows.push(window);
    this.pruneOldWindows(date);

    return window;
  }

  private pruneOldWindows(now: Date): void {
    if (this.windows.length <= MAX_WINDOWS) return;

    // Persist pruned windows to SQLite before discarding
    const toPrune = this.windows.slice(0, this.windows.length - MAX_WINDOWS);
    this.persistWindows(toPrune);

    this.windows = this.windows.slice(-MAX_WINDOWS);
  }

  private persistWindows(windows: MinuteWindow[]): void {
    if (!this.db || windows.length === 0) return;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO metrics_timeseries
        (ts, input_tokens, output_tokens, tokens, cost, tool_calls, errors, active_agents)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((ww: MinuteWindow[]) => {
      for (const w of ww) {
        stmt.run(
          w.ts,
          w.input_tokens,
          w.output_tokens,
          w.tokens,
          w.cost,
          w.tool_calls,
          w.errors,
          w.active_agents.size,
        );
      }
    });

    insertMany(windows);
  }
}
