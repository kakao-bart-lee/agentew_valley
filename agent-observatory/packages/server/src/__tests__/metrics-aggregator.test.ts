import { describe, it, expect } from 'vitest';
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
});
