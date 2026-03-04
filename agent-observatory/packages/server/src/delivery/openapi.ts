import { Router } from 'express';
import express from 'express';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { schemas } from './openapi-schemas.js';

function getSwaggerUiDistPath(): string {
  const require = createRequire(import.meta.url);
  const swaggerUiDistPath = dirname(require.resolve('swagger-ui-dist/package.json'));
  return swaggerUiDistPath;
}

export function buildOpenApiSpec(): Record<string, unknown> {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Agent Observatory API',
      version: '0.3.0',
      description: 'Real-time agent activity observation and visualization API',
    },
    servers: [{ url: '/' }],
    paths: {
      '/api/v1/agents': {
        get: {
          tags: ['Agents'],
          summary: 'List all active agents',
          responses: {
            200: {
              description: 'Agent list',
              content: { 'application/json': { schema: { type: 'object', properties: { agents: { type: 'array', items: { $ref: '#/components/schemas/AgentLiveState' } }, total: { type: 'number' } } } } },
            },
          },
        },
      },
      '/api/v1/agents/hierarchy': {
        get: {
          tags: ['Agents'],
          summary: 'Get agent hierarchy tree',
          responses: { 200: { description: 'Agent hierarchy' } },
        },
      },
      '/api/v1/agents/by-team': {
        get: {
          tags: ['Agents'],
          summary: 'Get agents grouped by team',
          responses: { 200: { description: 'Agents by team' } },
        },
      },
      '/api/v1/agents/{id}': {
        get: {
          tags: ['Agents'],
          summary: 'Get agent detail by ID',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'Agent detail', content: { 'application/json': { schema: { type: 'object', properties: { agent: { $ref: '#/components/schemas/AgentLiveState' } } } } } },
            404: { description: 'Agent not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          },
        },
      },
      '/api/v1/agents/{id}/events': {
        get: {
          tags: ['Agents'],
          summary: 'Get events for an agent',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
            { name: 'type', in: 'query', schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'Events list' } },
        },
      },
      '/api/v1/sessions': {
        get: {
          tags: ['Sessions'],
          summary: 'List active sessions',
          responses: { 200: { description: 'Sessions list' } },
        },
      },
      '/api/v1/sessions/{id}': {
        get: {
          tags: ['Sessions'],
          summary: 'Get session events',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'Session events' },
            404: { description: 'Session not found' },
          },
        },
      },
      '/api/v1/sessions/{id}/replay': {
        get: {
          tags: ['Sessions'],
          summary: 'Get session replay with gap/offset timing',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'Start time filter (ISO-8601)' },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'End time filter (ISO-8601)' },
            { name: 'types', in: 'query', schema: { type: 'string' }, description: 'Comma-separated event types filter' },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
            { name: 'offset', in: 'query', schema: { type: 'integer' } },
          ],
          responses: {
            200: { description: 'Session replay', content: { 'application/json': { schema: { $ref: '#/components/schemas/SessionReplayResponse' } } } },
            404: { description: 'Session not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          },
        },
      },
      '/api/v1/metrics/summary': {
        get: {
          tags: ['Metrics'],
          summary: 'Get current metrics snapshot',
          responses: { 200: { description: 'Metrics snapshot', content: { 'application/json': { schema: { type: 'object', properties: { metrics: { $ref: '#/components/schemas/MetricsSnapshot' } } } } } } },
        },
      },
      '/api/v1/metrics/timeseries': {
        get: {
          tags: ['Metrics'],
          summary: 'Get timeseries data for a metric',
          parameters: [
            { name: 'metric', in: 'query', schema: { type: 'string', default: 'tokens_per_minute' } },
            { name: 'from', in: 'query', schema: { type: 'integer', default: 60 }, description: 'Minutes ago' },
          ],
          responses: { 200: { description: 'Timeseries data' } },
        },
      },
      '/api/v1/events/search': {
        get: {
          tags: ['Events'],
          summary: 'Full-text search across events',
          parameters: [
            { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: {
            200: { description: 'Search results' },
            400: { description: 'Missing query parameter' },
          },
        },
      },
      '/api/v1/migration/shadow-report': {
        get: {
          tags: ['Migration'],
          summary: 'Get migration shadow comparison report summary',
          responses: {
            200: {
              description: 'Shadow report summary',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ShadowReportResponse' },
                },
              },
            },
            503: {
              description: 'Shadow mode disabled',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/v2/auth/status': {
        get: {
          tags: ['Migration'],
          summary: 'Get auth v2 route status',
          responses: {
            200: { description: 'Auth v2 route enabled' },
            503: {
              description: 'Auth v2 route disabled by feature flag or global kill switch',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/v2/tasks': {
        get: {
          tags: ['Migration'],
          summary: 'List tasks from v2 route',
          responses: {
            200: { description: 'Tasks v2 route enabled' },
            503: {
              description: 'Tasks v2 route disabled by feature flag or global kill switch',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/v2/webhooks/test': {
        post: {
          tags: ['Migration'],
          summary: 'Test webhooks v2 route',
          responses: {
            202: { description: 'Webhooks v2 route enabled' },
            503: {
              description: 'Webhooks v2 route disabled by feature flag or global kill switch',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/v1/config': {
        get: {
          tags: ['Config'],
          summary: 'Get current configuration',
          responses: { 200: { description: 'Config', content: { 'application/json': { schema: { type: 'object', properties: { config: { $ref: '#/components/schemas/ObservatoryConfig' } } } } } } },
        },
        put: {
          tags: ['Config'],
          summary: 'Update configuration',
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/ObservatoryConfig' } } } },
          responses: { 200: { description: 'Updated config' } },
        },
      },
      '/api/v1/events': {
        post: {
          tags: ['Events'],
          summary: 'Ingest a single UAEP event',
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/UAEPEvent' } } } },
          responses: {
            201: { description: 'Event accepted' },
            400: { description: 'Invalid event' },
          },
        },
      },
      '/api/v1/events/batch': {
        post: {
          tags: ['Events'],
          summary: 'Ingest multiple UAEP events',
          requestBody: { content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/UAEPEvent' } } } } },
          responses: {
            201: { description: 'Events accepted' },
            400: { description: 'Invalid batch' },
          },
        },
      },
      '/api/v1/analytics/cost': {
        get: {
          tags: ['Analytics'],
          summary: 'Get cost analytics summary',
          parameters: [
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: { 200: { description: 'Cost analytics', content: { 'application/json': { schema: { $ref: '#/components/schemas/CostAnalyticsResponse' } } } } },
        },
      },
      '/api/v1/analytics/cost/by-agent': {
        get: {
          tags: ['Analytics'],
          summary: 'Get cost breakdown by agent',
          parameters: [
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: { 200: { description: 'Cost by agent', content: { 'application/json': { schema: { $ref: '#/components/schemas/CostByAgentResponse' } } } } },
        },
      },
      '/api/v1/analytics/cost/by-team': {
        get: {
          tags: ['Analytics'],
          summary: 'Get cost breakdown by team',
          parameters: [
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: { 200: { description: 'Cost by team', content: { 'application/json': { schema: { $ref: '#/components/schemas/CostByTeamResponse' } } } } },
        },
      },
      '/api/v1/analytics/cost/by-tool': {
        get: {
          tags: ['Analytics'],
          summary: 'Get cost breakdown by tool category (estimated)',
          parameters: [
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: { 200: { description: 'Cost by tool', content: { 'application/json': { schema: { $ref: '#/components/schemas/CostByToolResponse' } } } } },
        },
      },
      '/api/v1/analytics/tokens': {
        get: {
          tags: ['Analytics'],
          summary: 'Get token usage analytics',
          parameters: [
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: { 200: { description: 'Token analytics', content: { 'application/json': { schema: { $ref: '#/components/schemas/TokenAnalyticsResponse' } } } } },
        },
      },
    },
    components: {
      schemas,
    },
  };
}

export function createOpenApiRouter(): Router {
  const router = Router();

  const spec = buildOpenApiSpec();

  // GET /api-docs/openapi.json
  router.get('/api-docs/openapi.json', (_req, res) => {
    res.json(spec);
  });

  // Serve Swagger UI static files with custom initializer
  const swaggerUiPath = getSwaggerUiDistPath();

  // Override swagger-initializer.js to point to our spec
  router.get('/api-docs/swagger-initializer.js', (_req, res) => {
    res.type('application/javascript').send(`
window.onload = function() {
  window.ui = SwaggerUIBundle({
    url: "/api-docs/openapi.json",
    dom_id: '#swagger-ui',
    deepLinking: true,
    presets: [
      SwaggerUIBundle.presets.apis,
      SwaggerUIStandalonePreset
    ],
    plugins: [
      SwaggerUIBundle.plugins.DownloadUrl
    ],
    layout: "StandaloneLayout"
  });
};
`);
  });

  // Serve static files from swagger-ui-dist
  router.use('/api-docs', express.static(swaggerUiPath));

  return router;
}
