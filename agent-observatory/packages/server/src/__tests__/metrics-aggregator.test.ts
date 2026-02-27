import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { MetricsAggregator } from '../core/metrics-aggregator.js';
import { makeEvent, makeToolStart, makeMetricsUsage } from './helpers.js';

describe('MetricsAggregator', () => {
  it('should increment total_tool_calls on tool.start', () => {
    const ma = new MetricsAggregator();

    ma.handleEvent(makeToolStart('Read'));
    ma.handleEvent(makeToolStart('Bash'));
    ma.handleEvent(makeToolStart('Write'));

    expect(ma.getTotalToolCalls()).toBe(3);
  });

  it('should sum tokens and cost from metrics.usage', () => {
    const ma = new MetricsAggregator();

    ma.handleEvent(makeMetricsUsage(1000, 0.05));
    ma.handleEvent(makeMetricsUsage(2000, 0.10));

    expect(ma.getTotalTokens()).toBe(3000);
    expect(ma.getTotalCost()).toBeCloseTo(0.15);
  });

  it('should return accurate snapshot', () => {
    const ma = new MetricsAggregator();

    ma.handleEvent(makeEvent({ type: 'session.start', source: 'claude_code' }));
    ma.handleEvent(makeToolStart('Read'));
    ma.handleEvent(makeToolStart('Bash'));
    ma.handleEvent(makeMetricsUsage(500, 0.02));
    ma.handleEvent(makeEvent({ type: 'tool.error' }));

    const snapshot = ma.getSnapshot();

    expect(snapshot.timestamp).toBeDefined();
    expect(snapshot.tool_distribution).toBeDefined();
    expect(snapshot.source_distribution).toBeDefined();
    expect(snapshot.timeseries).toBeDefined();
    expect(snapshot.timeseries.timestamps.length).toBeGreaterThan(0);
  });

  it('should count errors on tool.error', () => {
    const ma = new MetricsAggregator();

    ma.handleEvent(makeEvent({ type: 'tool.error' }));
    ma.handleEvent(makeEvent({ type: 'tool.error' }));

    const snapshot = ma.getSnapshot();
    expect(snapshot.total_errors_last_hour).toBe(2);
  });

  it('should track tool category distribution', () => {
    const ma = new MetricsAggregator();

    ma.handleEvent(makeToolStart('Read'));
    ma.handleEvent(makeToolStart('Read'));
    ma.handleEvent(makeToolStart('Bash'));

    const snapshot = ma.getSnapshot();
    expect(snapshot.tool_distribution.file_read).toBe(2);
    expect(snapshot.tool_distribution.command).toBe(1);
  });

  it('should return timeseries data via getTimeseries', () => {
    const ma = new MetricsAggregator();

    ma.handleEvent(makeMetricsUsage(100, 0.01));

    const ts = ma.getTimeseries('tokens_per_minute', 60);
    expect(ts.length).toBeGreaterThan(0);
    expect(ts[0].value).toBe(100);
  });

  it('should track source distribution on session.start', () => {
    const ma = new MetricsAggregator();

    ma.handleEvent(makeEvent({ type: 'session.start', source: 'claude_code' }));
    ma.handleEvent(makeEvent({ type: 'session.start', source: 'openclaw' }));
    ma.handleEvent(makeEvent({ type: 'session.start', source: 'claude_code' }));

    const snapshot = ma.getSnapshot();
    expect(snapshot.source_distribution.claude_code).toBe(2);
    expect(snapshot.source_distribution.openclaw).toBe(1);
  });

  describe('SQLite timeseries persistence', () => {
    let db: Database.Database;

    afterEach(() => {
      db?.close();
    });

    it('should persist pruned windows to SQLite', () => {
      db = new Database(':memory:');
      const ma = new MetricsAggregator();
      ma.setDb(db);

      // Create 65 windows (5 more than MAX_WINDOWS=60) to trigger pruning
      const baseTime = new Date('2026-01-01T00:00:00Z');
      for (let i = 0; i < 65; i++) {
        const ts = new Date(baseTime.getTime() + i * 60_000).toISOString();
        ma.handleEvent(makeMetricsUsage(100, 0.01, 'agent-1', { ts }));
      }

      // Check SQLite has persisted rows (the first 5 windows should be pruned and persisted)
      const count = db.prepare('SELECT COUNT(*) as cnt FROM metrics_timeseries').get() as { cnt: number };
      expect(count.cnt).toBeGreaterThan(0);
    });

    it('should query historical timeseries from SQLite', () => {
      db = new Database(':memory:');
      const ma = new MetricsAggregator();
      ma.setDb(db);

      // Insert historical data directly into SQLite
      db.prepare(`
        INSERT INTO metrics_timeseries (ts, tokens, cost, tool_calls, errors, active_agents)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('2026-01-01T00:00:00.000Z', 500, 0.05, 10, 1, 3);

      const results = ma.getHistoricalTimeseries(
        'tokens_per_minute',
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T01:00:00.000Z',
      );

      expect(results).toHaveLength(1);
      expect(results[0].value).toBe(500);
    });

    it('should combine SQLite and in-memory data for large time ranges', () => {
      db = new Database(':memory:');
      const ma = new MetricsAggregator();
      ma.setDb(db);

      // Insert old historical data into SQLite
      const oldTs = new Date(Date.now() - 90 * 60_000); // 90 minutes ago
      oldTs.setSeconds(0, 0);
      db.prepare(`
        INSERT INTO metrics_timeseries (ts, tokens, cost, tool_calls, errors, active_agents)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(oldTs.toISOString(), 200, 0.02, 5, 0, 2);

      // Add recent in-memory data
      ma.handleEvent(makeMetricsUsage(300, 0.03, 'agent-1'));

      // Query beyond 60 minutes to get combined data
      const results = ma.getTimeseries('tokens_per_minute', 120);
      expect(results.length).toBeGreaterThanOrEqual(2);

      // Should have both old and recent data
      const oldEntry = results.find((r) => r.ts === oldTs.toISOString());
      expect(oldEntry?.value).toBe(200);
    });

    it('should create metrics_timeseries table on setDb', () => {
      db = new Database(':memory:');
      const ma = new MetricsAggregator();
      ma.setDb(db);

      // Verify table exists
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='metrics_timeseries'"
      ).all() as { name: string }[];
      expect(tables).toHaveLength(1);
    });
  });
});
