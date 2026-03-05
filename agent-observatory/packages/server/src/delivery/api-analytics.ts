import { Router } from 'express';
import type { HistoryStore } from '../core/history-store.js';
import { getToolCategory } from '@agent-observatory/shared';

export function createAnalyticsRouter(historyStore: HistoryStore): Router {
  const router = Router();

  function parseTimeRange(req: { query: Record<string, unknown> }): { from?: string; to?: string } {
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    return { from: from || undefined, to: to || undefined };
  }

  function getEffectiveTimeRange(from?: string, to?: string): { from: string; to: string } {
    return {
      from: from ?? '1970-01-01T00:00:00Z',
      to: to ?? new Date().toISOString(),
    };
  }

  // GET /api/v1/analytics/cost
  router.get('/api/v1/analytics/cost', (req, res) => {
    const { from, to } = parseTimeRange(req);
    const summary = historyStore.getCostSummary({ from, to });
    const timeseries = historyStore.getCostTimeseries({ from, to });
    const range = getEffectiveTimeRange(from, to);

    res.json({
      time_range: range,
      total_cost_usd: summary.total_cost_usd,
      total_tokens: summary.total_tokens,
      total_sessions: summary.total_sessions,
      cost_timeseries: timeseries,
    });
  });

  // GET /api/v1/analytics/cost/by-agent
  router.get('/api/v1/analytics/cost/by-agent', (req, res) => {
    const { from, to } = parseTimeRange(req);
    const agents = historyStore.getCostByAgent({ from, to });
    const summary = historyStore.getCostSummary({ from, to });
    const range = getEffectiveTimeRange(from, to);

    const agentsWithPercentage = agents.map((a) => ({
      ...a,
      cost_percentage: summary.total_cost_usd > 0
        ? (a.total_cost_usd / summary.total_cost_usd) * 100
        : 0,
    }));

    res.json({
      time_range: range,
      agents: agentsWithPercentage,
      total_cost_usd: summary.total_cost_usd,
      total_tokens: summary.total_tokens,
    });
  });

  // GET /api/v1/analytics/cost/by-project
  router.get('/api/v1/analytics/cost/by-project', (req, res) => {
    const { from, to } = parseTimeRange(req);
    const projects = historyStore.getCostByProject({ from, to });
    const summary = historyStore.getCostSummary({ from, to });
    const range = getEffectiveTimeRange(from, to);

    const projectsWithPercentage = projects.map((project) => ({
      ...project,
      cost_percentage: summary.total_cost_usd > 0
        ? (project.total_cost_usd / summary.total_cost_usd) * 100
        : 0,
    }));

    res.json({
      time_range: range,
      projects: projectsWithPercentage,
      total_cost_usd: summary.total_cost_usd,
      total_tokens: summary.total_tokens,
    });
  });

  // GET /api/v1/analytics/cost/by-team
  router.get('/api/v1/analytics/cost/by-team', (req, res) => {
    const { from, to } = parseTimeRange(req);
    const teams = historyStore.getCostByTeam({ from, to });
    const summary = historyStore.getCostSummary({ from, to });
    const range = getEffectiveTimeRange(from, to);

    const teamsWithPercentage = teams.map((t) => ({
      ...t,
      cost_percentage: summary.total_cost_usd > 0
        ? (t.total_cost_usd / summary.total_cost_usd) * 100
        : 0,
    }));

    res.json({
      time_range: range,
      teams: teamsWithPercentage,
      total_cost_usd: summary.total_cost_usd,
      total_tokens: summary.total_tokens,
    });
  });

  // GET /api/v1/analytics/cost/by-model
  router.get('/api/v1/analytics/cost/by-model', (req, res) => {
    const { from, to } = parseTimeRange(req);
    const models = historyStore.getCostByModel({ from, to });
    const summary = historyStore.getCostSummary({ from, to });
    const range = getEffectiveTimeRange(from, to);

    const modelsWithPercentage = models.map((model) => ({
      ...model,
      cost_percentage: summary.total_cost_usd > 0
        ? (model.total_cost_usd / summary.total_cost_usd) * 100
        : 0,
    }));

    res.json({
      time_range: range,
      models: modelsWithPercentage,
      total_cost_usd: summary.total_cost_usd,
      total_tokens: summary.total_tokens,
    });
  });

  // GET /api/v1/analytics/cost/by-tool
  router.get('/api/v1/analytics/cost/by-tool', (req, res) => {
    const { from, to } = parseTimeRange(req);
    const tools = historyStore.getToolCallDistribution({ from, to });
    const summary = historyStore.getCostSummary({ from, to });
    const range = getEffectiveTimeRange(from, to);

    const totalCalls = tools.reduce((sum, t) => sum + t.count, 0);

    const toolEntries = tools.map((t) => {
      const category = t.tool_name ? getToolCategory(t.tool_name) : 'other';
      return { tool_name: t.tool_name, category, count: t.count };
    });

    // Group by category
    const categoryMap = new Map<string, number>();
    for (const entry of toolEntries) {
      categoryMap.set(entry.category, (categoryMap.get(entry.category) ?? 0) + entry.count);
    }

    const toolCostEntries = Array.from(categoryMap.entries()).map(([category, callCount]) => {
      const proportion = totalCalls > 0 ? callCount / totalCalls : 0;
      const estimated_cost_usd = proportion * summary.total_cost_usd;
      return {
        tool_category: category,
        call_count: callCount,
        estimated_cost_usd,
        cost_percentage: summary.total_cost_usd > 0
          ? (estimated_cost_usd / summary.total_cost_usd) * 100
          : 0,
      };
    }).sort((a, b) => b.call_count - a.call_count);

    res.json({
      time_range: range,
      tools: toolCostEntries,
      total_cost_usd: summary.total_cost_usd,
    });
  });

  // GET /api/v1/analytics/tokens
  router.get('/api/v1/analytics/tokens', (req, res) => {
    const { from, to } = parseTimeRange(req);
    const summary = historyStore.getCostSummary({ from, to });
    const timeseries = historyStore.getCostTimeseries({ from, to });
    const byAgent = historyStore.getTokensByAgent({ from, to });
    const range = getEffectiveTimeRange(from, to);

    res.json({
      time_range: range,
      total_tokens: summary.total_tokens,
      tokens_timeseries: timeseries.map((t) => ({ ts: t.ts, tokens: t.tokens })),
      by_agent: byAgent,
    });
  });

  return router;
}
