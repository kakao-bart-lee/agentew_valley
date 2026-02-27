import type {
  MetricsSnapshot,
  UAEPEvent,
  ToolCategory,
  AgentSourceType,
} from '@agent-observatory/shared';
import { getToolCategory } from '@agent-observatory/shared';
import type { StateManager } from './state-manager.js';
import type Database from 'better-sqlite3';

interface MinuteWindow {
  ts: string;
  tokens: number;
  cost: number;
  tool_calls: number;
  errors: number;
  active_agents: Set<string>;
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
  private totalTokens = 0;
  private totalCost = 0;
  private totalErrors = 0;
  private totalSessions = 0;
  private toolDistribution: Record<string, number> = {};
  private sourceDistribution: Record<string, number> = {};
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
        tokens INTEGER DEFAULT 0,
        cost REAL DEFAULT 0,
        tool_calls INTEGER DEFAULT 0,
        errors INTEGER DEFAULT 0,
        active_agents INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_metrics_ts ON metrics_timeseries(ts);
    `);
  }

  handleEvent(event: UAEPEvent): void {
    const window = this.getOrCreateWindow(new Date(event.ts));
    window.active_agents.add(event.agent_id);

    switch (event.type) {
      case 'session.start':
        this.totalSessions++;
        this.sourceDistribution[event.source] =
          (this.sourceDistribution[event.source] ?? 0) + 1;
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
      case 'metrics.usage':
        if (typeof event.data?.['tokens'] === 'number') {
          const tokens = event.data['tokens'] as number;
          this.totalTokens += tokens;
          window.tokens += tokens;
        }
        if (typeof event.data?.['cost'] === 'number') {
          const cost = event.data['cost'] as number;
          this.totalCost += cost;
          window.cost += cost;
        }
        break;
      default:
        break;
    }
  }

  getSnapshot(): MetricsSnapshot {
    const now = new Date();
    this.pruneOldWindows(now);

    const activeAgents = this.stateManager?.getAllAgents().length ?? 0;
    const totalAgents = activeAgents;

    const timestamps: string[] = [];
    const tokensPerMinute: number[] = [];
    const costPerMinute: number[] = [];
    const activeAgentsTs: number[] = [];
    const toolCallsPerMinute: number[] = [];
    const errorCount: number[] = [];

    for (const w of this.windows) {
      timestamps.push(w.ts);
      tokensPerMinute.push(w.tokens);
      costPerMinute.push(w.cost);
      activeAgentsTs.push(w.active_agents.size);
      toolCallsPerMinute.push(w.tool_calls);
      errorCount.push(w.errors);
    }

    const recentWindow = this.windows[this.windows.length - 1];
    const tokensLastMin = recentWindow?.tokens ?? 0;
    const toolCallsLastMin = recentWindow?.tool_calls ?? 0;

    const last5 = this.windows.slice(-5);
    const errorsLast5 = last5.reduce((s, w) => s + w.errors, 0);
    const totalCallsLast5 = last5.reduce((s, w) => s + w.tool_calls, 0);
    const errorRate = totalCallsLast5 > 0 ? errorsLast5 / totalCallsLast5 : 0;

    const errorsLastHour = this.windows.reduce((s, w) => s + w.errors, 0);
    const costLastHour = this.windows.reduce((s, w) => s + w.cost, 0);

    return {
      timestamp: now.toISOString(),
      active_agents: activeAgents,
      total_agents: totalAgents,
      total_tokens_per_minute: tokensLastMin,
      total_cost_per_hour: costLastHour,
      total_errors_last_hour: errorsLastHour,
      total_tool_calls_per_minute: toolCallsLastMin,
      tool_distribution: { ...this.toolDistribution } as Record<ToolCategory, number>,
      source_distribution: { ...this.sourceDistribution } as Record<AgentSourceType, number>,
      timeseries: {
        timestamps,
        tokens_per_minute: tokensPerMinute,
        cost_per_minute: costPerMinute,
        active_agents: activeAgentsTs,
        tool_calls_per_minute: toolCallsPerMinute,
        error_count: errorCount,
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
      tokens: 0,
      cost: 0,
      tool_calls: 0,
      errors: 0,
      active_agents: new Set(),
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
      INSERT OR REPLACE INTO metrics_timeseries (ts, tokens, cost, tool_calls, errors, active_agents)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((ww: MinuteWindow[]) => {
      for (const w of ww) {
        stmt.run(w.ts, w.tokens, w.cost, w.tool_calls, w.errors, w.active_agents.size);
      }
    });

    insertMany(windows);
  }
}
