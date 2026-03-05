import { describe, it, expect, afterEach } from 'vitest';
import { HistoryStore } from '../core/history-store.js';
import { makeEvent, makeSessionStart, makeToolStart, makeMetricsUsage } from './helpers.js';

describe('HistoryStore Phase 3 queries', () => {
  let hs: HistoryStore;

  afterEach(() => {
    hs?.close();
  });

  describe('getSession', () => {
    it('should return session by ID', () => {
      hs = new HistoryStore();
      hs.append(makeSessionStart('agent-1', 'sess-1'));

      const session = hs.getSession('sess-1');
      expect(session).toBeDefined();
      expect(session!.session_id).toBe('sess-1');
      expect(session!.agent_id).toBe('agent-1');
    });

    it('should return undefined for unknown session', () => {
      hs = new HistoryStore();
      expect(hs.getSession('unknown')).toBeUndefined();
    });
  });

  describe('getSessionReplay', () => {
    it('should return events in time order', () => {
      hs = new HistoryStore();
      const baseTime = new Date('2026-02-27T10:00:00Z');

      hs.append(makeSessionStart('agent-1', 'sess-1', { ts: baseTime.toISOString() }));
      hs.append(makeToolStart('Read', 'agent-1', undefined, {
        session_id: 'sess-1',
        ts: new Date(baseTime.getTime() + 1000).toISOString(),
      }));
      hs.append(makeToolStart('Bash', 'agent-1', undefined, {
        session_id: 'sess-1',
        ts: new Date(baseTime.getTime() + 3000).toISOString(),
      }));

      const events = hs.getSessionReplay('sess-1');
      expect(events).toHaveLength(3);
      expect(events[0].type).toBe('session.start');
      expect(events[2].type).toBe('tool.start');
    });

    it('should filter by time range', () => {
      hs = new HistoryStore();
      const baseTime = new Date('2026-02-27T10:00:00Z');

      hs.append(makeSessionStart('agent-1', 'sess-1', { ts: baseTime.toISOString() }));
      hs.append(makeToolStart('Read', 'agent-1', undefined, {
        session_id: 'sess-1',
        ts: new Date(baseTime.getTime() + 1000).toISOString(),
      }));
      hs.append(makeToolStart('Bash', 'agent-1', undefined, {
        session_id: 'sess-1',
        ts: new Date(baseTime.getTime() + 5000).toISOString(),
      }));

      const events = hs.getSessionReplay('sess-1', {
        from: new Date(baseTime.getTime() + 500).toISOString(),
        to: new Date(baseTime.getTime() + 2000).toISOString(),
      });
      expect(events).toHaveLength(1);
    });

    it('should filter by event types', () => {
      hs = new HistoryStore();
      hs.append(makeSessionStart('agent-1', 'sess-1'));
      hs.append(makeToolStart('Read', 'agent-1', undefined, { session_id: 'sess-1' }));
      hs.append(makeEvent({ type: 'tool.end', agent_id: 'agent-1', session_id: 'sess-1' }));
      hs.append(makeMetricsUsage(100, 0.05, 'agent-1', { session_id: 'sess-1' }));

      const events = hs.getSessionReplay('sess-1', { types: ['tool.start', 'tool.end'] });
      expect(events).toHaveLength(2);
      expect(events.every((e) => e.type === 'tool.start' || e.type === 'tool.end')).toBe(true);
    });

    it('should support pagination', () => {
      hs = new HistoryStore();
      hs.append(makeSessionStart('agent-1', 'sess-1'));
      for (let i = 0; i < 5; i++) {
        hs.append(makeToolStart(`tool-${i}`, 'agent-1', undefined, { session_id: 'sess-1' }));
      }

      const page1 = hs.getSessionReplay('sess-1', { limit: 2, offset: 0 });
      expect(page1).toHaveLength(2);

      const page2 = hs.getSessionReplay('sess-1', { limit: 2, offset: 2 });
      expect(page2).toHaveLength(2);
      expect(page2[0].event_id).not.toBe(page1[0].event_id);
    });
  });

  describe('getSessionEventTypeCounts', () => {
    it('should return counts by type', () => {
      hs = new HistoryStore();
      hs.append(makeSessionStart('agent-1', 'sess-1'));
      hs.append(makeToolStart('Read', 'agent-1', undefined, { session_id: 'sess-1' }));
      hs.append(makeToolStart('Bash', 'agent-1', undefined, { session_id: 'sess-1' }));
      hs.append(makeEvent({ type: 'tool.end', agent_id: 'agent-1', session_id: 'sess-1' }));

      const counts = hs.getSessionEventTypeCounts('sess-1');
      expect(counts['session.start']).toBe(1);
      expect(counts['tool.start']).toBe(2);
      expect(counts['tool.end']).toBe(1);
    });
  });

  describe('getCostSummary', () => {
    it('should return zero values for empty DB', () => {
      hs = new HistoryStore();
      const result = hs.getCostSummary();
      expect(result.total_cost_usd).toBe(0);
      expect(result.total_tokens).toBe(0);
      expect(result.total_sessions).toBe(0);
    });

    it('should aggregate across sessions', () => {
      hs = new HistoryStore();
      hs.append(makeSessionStart('agent-1', 'sess-1'));
      hs.append(makeMetricsUsage(100, 0.10, 'agent-1', { session_id: 'sess-1' }));
      hs.append(makeSessionStart('agent-2', 'sess-2'));
      hs.append(makeMetricsUsage(200, 0.20, 'agent-2', { session_id: 'sess-2' }));

      const result = hs.getCostSummary();
      expect(result.total_tokens).toBe(300);
      expect(result.total_cost_usd).toBeCloseTo(0.30);
      expect(result.total_sessions).toBe(2);
    });

    it('should filter by time range', () => {
      hs = new HistoryStore();
      hs.append(makeSessionStart('agent-1', 'sess-1', { ts: '2026-02-27T10:00:00Z' }));
      hs.append(makeMetricsUsage(100, 0.10, 'agent-1', { session_id: 'sess-1' }));
      hs.append(makeSessionStart('agent-2', 'sess-2', { ts: '2026-02-27T12:00:00Z' }));
      hs.append(makeMetricsUsage(200, 0.20, 'agent-2', { session_id: 'sess-2' }));

      const result = hs.getCostSummary({ from: '2026-02-27T11:00:00Z' });
      expect(result.total_sessions).toBe(1);
      expect(result.total_tokens).toBe(200);
    });
  });

  describe('getCostByAgent', () => {
    it('should group by agent', () => {
      hs = new HistoryStore();
      hs.append(makeSessionStart('agent-1', 'sess-1'));
      hs.append(makeMetricsUsage(100, 0.10, 'agent-1', { session_id: 'sess-1' }));
      hs.append(makeSessionStart('agent-1', 'sess-1b'));
      hs.append(makeMetricsUsage(50, 0.05, 'agent-1', { session_id: 'sess-1b' }));
      hs.append(makeSessionStart('agent-2', 'sess-2'));
      hs.append(makeMetricsUsage(200, 0.20, 'agent-2', { session_id: 'sess-2' }));

      const agents = hs.getCostByAgent();
      expect(agents).toHaveLength(2);

      const a1 = agents.find((a) => a.agent_id === 'agent-1');
      expect(a1).toBeDefined();
      expect(a1!.total_tokens).toBe(150);
      expect(a1!.total_cost_usd).toBeCloseTo(0.15);
      expect(a1!.session_count).toBe(2);

      const a2 = agents.find((a) => a.agent_id === 'agent-2');
      expect(a2).toBeDefined();
      expect(a2!.total_tokens).toBe(200);
      expect(a2!.session_count).toBe(1);
    });
  });

  describe('getCostByProject', () => {
    it('should group by project and exclude unscoped sessions', () => {
      hs = new HistoryStore();
      hs.append(makeSessionStart('agent-1', 'sess-1', { project_id: 'moonlit' }));
      hs.append(makeMetricsUsage(100, 0.10, 'agent-1', { session_id: 'sess-1' }));
      hs.append(makeSessionStart('agent-2', 'sess-2', { project_id: 'moonlit' }));
      hs.append(makeMetricsUsage(50, 0.05, 'agent-2', { session_id: 'sess-2' }));
      hs.append(makeSessionStart('agent-3', 'sess-3'));
      hs.append(makeMetricsUsage(200, 0.20, 'agent-3', { session_id: 'sess-3' }));

      const projects = hs.getCostByProject();
      expect(projects).toHaveLength(1);
      expect(projects[0].project_id).toBe('moonlit');
      expect(projects[0].total_tokens).toBe(150);
      expect(projects[0].agent_count).toBe(2);
      expect(projects[0].session_count).toBe(2);
    });
  });

  describe('getCostByTeam', () => {
    it('should group by team and exclude teamless sessions', () => {
      hs = new HistoryStore();
      hs.append(makeSessionStart('agent-1', 'sess-1', { team_id: 'team-a' }));
      hs.append(makeMetricsUsage(100, 0.10, 'agent-1', { session_id: 'sess-1' }));
      hs.append(makeSessionStart('agent-2', 'sess-2', { team_id: 'team-a' }));
      hs.append(makeMetricsUsage(50, 0.05, 'agent-2', { session_id: 'sess-2' }));
      hs.append(makeSessionStart('agent-3', 'sess-3')); // no team
      hs.append(makeMetricsUsage(200, 0.20, 'agent-3', { session_id: 'sess-3' }));

      const teams = hs.getCostByTeam();
      expect(teams).toHaveLength(1);
      expect(teams[0].team_id).toBe('team-a');
      expect(teams[0].total_tokens).toBe(150);
      expect(teams[0].agent_count).toBe(2);
      expect(teams[0].session_count).toBe(2);
    });
  });

  describe('getCostByModel', () => {
    it('should group by model', () => {
      hs = new HistoryStore();
      hs.append(makeSessionStart('agent-1', 'sess-1', { model_id: 'claude-sonnet-4-6' }));
      hs.append(makeMetricsUsage(100, 0.10, 'agent-1', { session_id: 'sess-1' }));
      hs.append(makeSessionStart('agent-2', 'sess-2', { model_id: 'gpt-5-mini' }));
      hs.append(makeMetricsUsage(200, 0.20, 'agent-2', { session_id: 'sess-2' }));

      const models = hs.getCostByModel();
      expect(models).toHaveLength(2);
      expect(models[0].model_id).toBe('gpt-5-mini');
      expect(models[0].total_tokens).toBe(200);
      expect(models[1].model_id).toBe('claude-sonnet-4-6');
    });
  });

  describe('getCostTimeseries', () => {
    it('should bucket by minute', () => {
      hs = new HistoryStore();
      hs.append(makeSessionStart('agent-1', 'sess-1'));
      hs.append(makeMetricsUsage(100, 0.10, 'agent-1', {
        session_id: 'sess-1',
        ts: '2026-02-27T10:00:30Z',
      }));
      hs.append(makeMetricsUsage(50, 0.05, 'agent-1', {
        session_id: 'sess-1',
        ts: '2026-02-27T10:00:45Z',
      }));
      hs.append(makeMetricsUsage(200, 0.20, 'agent-1', {
        session_id: 'sess-1',
        ts: '2026-02-27T10:01:15Z',
      }));

      const series = hs.getCostTimeseries();
      expect(series.length).toBeGreaterThanOrEqual(2);

      const minute00 = series.find((s) => s.ts === '2026-02-27T10:00:00Z');
      expect(minute00).toBeDefined();
      expect(minute00!.tokens).toBe(150);
      expect(minute00!.cost).toBeCloseTo(0.15);

      const minute01 = series.find((s) => s.ts === '2026-02-27T10:01:00Z');
      expect(minute01).toBeDefined();
      expect(minute01!.tokens).toBe(200);
    });
  });

  describe('getToolCallDistribution', () => {
    it('should count by tool name', () => {
      hs = new HistoryStore();
      hs.append(makeSessionStart('agent-1', 'sess-1'));
      hs.append(makeToolStart('Read', 'agent-1', undefined, { session_id: 'sess-1' }));
      hs.append(makeToolStart('Read', 'agent-1', undefined, { session_id: 'sess-1' }));
      hs.append(makeToolStart('Bash', 'agent-1', undefined, { session_id: 'sess-1' }));
      hs.append(makeToolStart('Write', 'agent-1', undefined, { session_id: 'sess-1' }));

      const dist = hs.getToolCallDistribution();
      expect(dist).toHaveLength(3);

      const readTool = dist.find((d) => d.tool_name === 'Read');
      expect(readTool).toBeDefined();
      expect(readTool!.count).toBe(2);

      const bashTool = dist.find((d) => d.tool_name === 'Bash');
      expect(bashTool!.count).toBe(1);
    });
  });

  describe('getTokensByAgent', () => {
    it('should aggregate tokens per agent', () => {
      hs = new HistoryStore();
      hs.append(makeSessionStart('agent-1', 'sess-1'));
      hs.append(makeMetricsUsage(100, 0.10, 'agent-1', { session_id: 'sess-1' }));
      hs.append(makeSessionStart('agent-2', 'sess-2'));
      hs.append(makeMetricsUsage(300, 0.30, 'agent-2', { session_id: 'sess-2' }));

      const byAgent = hs.getTokensByAgent();
      expect(byAgent).toHaveLength(2);
      expect(byAgent[0].agent_id).toBe('agent-2'); // ordered by tokens DESC
      expect(byAgent[0].total_tokens).toBe(300);
    });
  });

  describe('getBudgetAlerts', () => {
    it('should flag agents over the warning threshold', () => {
      hs = new HistoryStore();
      hs.setAgentBudget('agent-1', 100, 'Moonlit');
      hs.setAgentBudget('agent-2', 100, 'Sunrise');

      hs.append(makeSessionStart('agent-1', 'sess-1', { ts: '2026-03-01T10:00:00Z' }));
      hs.append(makeMetricsUsage(100, 0.90, 'agent-1', { session_id: 'sess-1' }));
      hs.append(makeSessionStart('agent-2', 'sess-2', { ts: '2026-03-01T11:00:00Z' }));
      hs.append(makeMetricsUsage(100, 0.40, 'agent-2', { session_id: 'sess-2' }));

      const alerts = hs.getBudgetAlerts({
        monthStart: '2026-03-01T00:00:00Z',
        monthEnd: '2026-04-01T00:00:00Z',
      });

      expect(alerts).toHaveLength(1);
      expect(alerts[0].agent_id).toBe('agent-1');
      expect(alerts[0].spent_monthly_cents).toBe(90);
      expect(alerts[0].severity).toBe('warning');
    });

    it('should escalate to critical at or above 100%', () => {
      hs = new HistoryStore();
      hs.setAgentBudget('agent-1', 100);
      hs.append(makeSessionStart('agent-1', 'sess-1', { ts: '2026-03-01T10:00:00Z' }));
      hs.append(makeMetricsUsage(100, 1.10, 'agent-1', { session_id: 'sess-1' }));

      const alerts = hs.getBudgetAlerts({
        monthStart: '2026-03-01T00:00:00Z',
        monthEnd: '2026-04-01T00:00:00Z',
      });

      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe('critical');
      expect(alerts[0].utilization_ratio).toBeGreaterThanOrEqual(1);
    });
  });
});
