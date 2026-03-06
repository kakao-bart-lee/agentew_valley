/**
 * JSON Schema 정의 — shared TypeScript 타입에 대응.
 * swagger-jsdoc의 components.schemas 에서 사용.
 */

export const schemas = {
  UAEPEvent: {
    type: 'object',
    properties: {
      ts: { type: 'string', format: 'date-time' },
      event_id: { type: 'string' },
      source: { type: 'string', enum: ['claude_code', 'openclaw', 'agent_sdk', 'langchain', 'crewai', 'custom', 'mission_control'] },
      agent_id: { type: 'string' },
      agent_name: { type: 'string' },
      session_id: { type: 'string' },
      span_id: { type: 'string' },
      parent_span_id: { type: 'string' },
      team_id: { type: 'string' },
      project_id: { type: 'string' },
      task_id: { type: 'string' },
      goal_id: { type: 'string' },
      type: { type: 'string' },
      data: { type: 'object', additionalProperties: true },
      metadata: { type: 'object', additionalProperties: true },
    },
    required: ['ts', 'event_id', 'source', 'agent_id', 'session_id', 'type'],
  },

  AgentLiveState: {
    type: 'object',
    properties: {
      agent_id: { type: 'string' },
      agent_name: { type: 'string' },
      source: { type: 'string' },
      team_id: { type: 'string' },
      project_id: { type: 'string' },
      task_id: { type: 'string' },
      goal_id: { type: 'string' },
      status: { type: 'string', enum: ['idle', 'thinking', 'acting', 'waiting_input', 'waiting_permission', 'error'] },
      current_tool: { type: 'string' },
      current_tool_category: { type: 'string' },
      status_detail: { type: 'string' },
      last_activity: { type: 'string', format: 'date-time' },
      session_id: { type: 'string' },
      session_start: { type: 'string', format: 'date-time' },
      total_tokens: { type: 'number' },
      total_cost_usd: { type: 'number' },
      total_tool_calls: { type: 'number' },
      total_errors: { type: 'number' },
      tool_distribution: { type: 'object', additionalProperties: { type: 'number' } },
      parent_agent_id: { type: 'string' },
      child_agent_ids: { type: 'array', items: { type: 'string' } },
    },
  },

  MetricsSnapshot: {
    type: 'object',
    properties: {
      timestamp: { type: 'string', format: 'date-time' },
      active_agents: { type: 'number' },
      total_agents: { type: 'number' },
      total_tokens_per_minute: { type: 'number' },
      total_cost_per_hour: { type: 'number' },
      total_errors_last_hour: { type: 'number' },
      total_tool_calls_per_minute: { type: 'number' },
      tool_distribution: { type: 'object', additionalProperties: { type: 'number' } },
      source_distribution: { type: 'object', additionalProperties: { type: 'number' } },
      timeseries: { $ref: '#/components/schemas/MetricsTimeseries' },
    },
  },

  MetricsTimeseries: {
    type: 'object',
    properties: {
      timestamps: { type: 'array', items: { type: 'string' } },
      tokens_per_minute: { type: 'array', items: { type: 'number' } },
      cost_per_minute: { type: 'array', items: { type: 'number' } },
      active_agents: { type: 'array', items: { type: 'number' } },
      tool_calls_per_minute: { type: 'array', items: { type: 'number' } },
      error_count: { type: 'array', items: { type: 'number' } },
    },
  },

  SessionSummary: {
    type: 'object',
    properties: {
      session_id: { type: 'string' },
      agent_id: { type: 'string' },
      agent_name: { type: 'string' },
      source: { type: 'string' },
      team_id: { type: 'string' },
      project_id: { type: 'string' },
      task_id: { type: 'string' },
      goal_id: { type: 'string' },
      start_time: { type: 'string', format: 'date-time' },
      end_time: { type: 'string', format: 'date-time' },
      total_events: { type: 'number' },
      total_tokens: { type: 'number' },
      total_cost_usd: { type: 'number' },
    },
  },

  ReplayEvent: {
    type: 'object',
    properties: {
      event: { $ref: '#/components/schemas/UAEPEvent' },
      gap_ms: { type: 'number' },
      offset_ms: { type: 'number' },
    },
  },

  SessionReplaySummary: {
    type: 'object',
    properties: {
      agent_id: { type: 'string' },
      agent_name: { type: 'string' },
      source: { type: 'string' },
      team_id: { type: 'string' },
      project_id: { type: 'string' },
      task_id: { type: 'string' },
      goal_id: { type: 'string' },
      start_time: { type: 'string', format: 'date-time' },
      end_time: { type: 'string', format: 'date-time' },
      duration_ms: { type: 'number' },
      total_events: { type: 'number' },
      total_tokens: { type: 'number' },
      total_cost_usd: { type: 'number' },
      total_tool_calls: { type: 'number' },
      event_type_counts: { type: 'object', additionalProperties: { type: 'number' } },
    },
  },

  SessionReplayResponse: {
    type: 'object',
    properties: {
      session_id: { type: 'string' },
      summary: { $ref: '#/components/schemas/SessionReplaySummary' },
      events: { type: 'array', items: { $ref: '#/components/schemas/ReplayEvent' } },
      total_events: { type: 'number' },
      time_range: {
        type: 'object',
        properties: { from: { type: 'string' }, to: { type: 'string' } },
      },
    },
  },

  CostAnalyticsResponse: {
    type: 'object',
    properties: {
      time_range: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
      total_cost_usd: { type: 'number' },
      total_tokens: { type: 'number' },
      total_sessions: { type: 'number' },
      cost_timeseries: {
        type: 'array',
        items: {
          type: 'object',
          properties: { ts: { type: 'string' }, cost: { type: 'number' }, tokens: { type: 'number' } },
        },
      },
    },
  },

  CostByAgentResponse: {
    type: 'object',
    properties: {
      time_range: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
      agents: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            agent_id: { type: 'string' },
            agent_name: { type: 'string' },
            source: { type: 'string' },
            total_cost_usd: { type: 'number' },
            total_tokens: { type: 'number' },
            session_count: { type: 'number' },
            cost_percentage: { type: 'number' },
          },
        },
      },
      total_cost_usd: { type: 'number' },
      total_tokens: { type: 'number' },
    },
  },

  CostByTeamResponse: {
    type: 'object',
    properties: {
      time_range: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
      teams: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            team_id: { type: 'string' },
            total_cost_usd: { type: 'number' },
            total_tokens: { type: 'number' },
            agent_count: { type: 'number' },
            session_count: { type: 'number' },
            cost_percentage: { type: 'number' },
          },
        },
      },
      total_cost_usd: { type: 'number' },
      total_tokens: { type: 'number' },
    },
  },

  CostByToolResponse: {
    type: 'object',
    properties: {
      time_range: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
      tools: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            tool_category: { type: 'string' },
            call_count: { type: 'number' },
            estimated_cost_usd: { type: 'number' },
            cost_percentage: { type: 'number' },
          },
        },
      },
      total_cost_usd: { type: 'number' },
    },
  },

  TokenAnalyticsResponse: {
    type: 'object',
    properties: {
      time_range: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
      total_tokens: { type: 'number' },
      tokens_timeseries: {
        type: 'array',
        items: { type: 'object', properties: { ts: { type: 'string' }, tokens: { type: 'number' } } },
      },
      by_agent: {
        type: 'array',
        items: {
          type: 'object',
          properties: { agent_id: { type: 'string' }, agent_name: { type: 'string' }, total_tokens: { type: 'number' } },
        },
      },
    },
  },

  ObservatoryConfig: {
    type: 'object',
    properties: {
      watch_paths: { type: 'array', items: { type: 'string' } },
      metrics_interval_ms: { type: 'number' },
      timeseries_retention_minutes: { type: 'number' },
    },
  },

  ShadowReportTopDiff: {
    type: 'object',
    properties: {
      entity: { type: 'string' },
      path: { type: 'string' },
      count: { type: 'number' },
    },
    required: ['entity', 'path', 'count'],
  },

  ShadowReportResponse: {
    type: 'object',
    properties: {
      pass_count: { type: 'number' },
      fail_count: { type: 'number' },
      top_diffs: {
        type: 'array',
        items: { $ref: '#/components/schemas/ShadowReportTopDiff' },
      },
    },
    required: ['pass_count', 'fail_count', 'top_diffs'],
  },

  ErrorResponse: {
    type: 'object',
    properties: {
      error: { type: 'string' },
      code: { type: 'string' },
      reason: { type: 'string' },
    },
  },
} as const;
