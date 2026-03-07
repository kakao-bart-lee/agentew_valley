import { Router } from 'express';
import express from 'express';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import { schemas } from './openapi-schemas.js';

function getSwaggerUiDistPath(): string {
  const require = createRequire(import.meta.url);
  return dirname(require.resolve('swagger-ui-dist/package.json'));
}

export function buildOpenApiSpec(): Record<string, unknown> {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Agent Observatory API',
      version: '0.3.0',
      description: 'Observe-first API for live agent activity, replay, and runtime analytics.',
    },
    servers: [{ url: '/' }],
    paths: {
      '/api/v1/health': {
        get: {
          tags: ['System'],
          summary: 'Health check',
          responses: { 200: { description: 'Server health' } },
        },
      },
      '/api/v1/agents': {
        get: {
          tags: ['Agents'],
          summary: 'List active agents',
          responses: { 200: { description: 'Agent list' } },
        },
      },
      '/api/v1/agents/by-team': {
        get: {
          tags: ['Agents'],
          summary: 'Get agents grouped by team',
          responses: { 200: { description: 'Agents grouped by team' } },
        },
      },
      '/api/v1/agents/{id}': {
        get: {
          tags: ['Agents'],
          summary: 'Get agent detail',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'Agent detail' },
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
          responses: { 200: { description: 'Agent events' } },
        },
      },
      '/api/v1/agents/{id}/context': {
        get: {
          tags: ['Agents'],
          summary: 'Get linked task context for an agent',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'Agent task context', content: { 'application/json': { schema: { $ref: '#/components/schemas/TaskContextResponse' } } } },
            404: { description: 'Agent not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          },
        },
      },
      '/api/v1/sessions': {
        get: {
          tags: ['Sessions'],
          summary: 'List recorded sessions',
          responses: { 200: { description: 'Session list' } },
        },
      },
      '/api/v1/sessions/{id}': {
        get: {
          tags: ['Sessions'],
          summary: 'Get session events',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'Session events' },
            404: { description: 'Session not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          },
        },
      },
      '/api/v1/sessions/{id}/context': {
        get: {
          tags: ['Sessions'],
          summary: 'Get linked task context for a session',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'Session task context', content: { 'application/json': { schema: { $ref: '#/components/schemas/TaskContextResponse' } } } },
            404: { description: 'Session not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          },
        },
      },
      '/api/v1/sessions/{id}/replay': {
        get: {
          tags: ['Sessions'],
          summary: 'Replay a session with timing offsets',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'types', in: 'query', schema: { type: 'string' } },
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
          summary: 'Get a metrics timeseries',
          parameters: [
            { name: 'metric', in: 'query', schema: { type: 'string', default: 'tokens_per_minute' } },
            { name: 'from', in: 'query', schema: { type: 'integer', default: 60 } },
          ],
          responses: { 200: { description: 'Metrics timeseries' } },
        },
      },
      '/api/v1/dashboard/summary': {
        get: {
          tags: ['Dashboard'],
          summary: 'Get observe-first dashboard summary',
          parameters: [
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: {
            200: { description: 'Dashboard summary', content: { 'application/json': { schema: { $ref: '#/components/schemas/DashboardSummaryResponse' } } } },
          },
        },
      },
      '/api/v1/events/search': {
        get: {
          tags: ['Events'],
          summary: 'Search events',
          parameters: [
            { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: {
            200: { description: 'Search results' },
            400: { description: 'Missing search query', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          },
        },
      },
      '/api/v1/events': {
        post: {
          tags: ['Events'],
          summary: 'Ingest a single UAEP event',
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/UAEPEvent' } } } },
          responses: {
            201: { description: 'Event accepted' },
            400: { description: 'Invalid event', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
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
            400: { description: 'Invalid batch', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          },
        },
      },
      '/api/v1/config': {
        get: {
          tags: ['Config'],
          summary: 'Get current server config',
          responses: { 200: { description: 'Server config', content: { 'application/json': { schema: { type: 'object', properties: { config: { $ref: '#/components/schemas/ObservatoryConfig' } } } } } } },
        },
        put: {
          tags: ['Config'],
          summary: 'Update current server config',
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/ObservatoryConfig' } } } },
          responses: { 200: { description: 'Updated config' } },
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
      '/api/v1/analytics/cost/by-project': {
        get: {
          tags: ['Analytics'],
          summary: 'Get cost breakdown by project',
          parameters: [
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: { 200: { description: 'Cost by project' } },
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
      '/api/v1/analytics/cost/by-model': {
        get: {
          tags: ['Analytics'],
          summary: 'Get cost breakdown by model',
          parameters: [
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: { 200: { description: 'Cost by model' } },
        },
      },
      '/api/v1/analytics/cost/by-tool': {
        get: {
          tags: ['Analytics'],
          summary: 'Get estimated cost breakdown by tool category',
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
          summary: 'Get token analytics',
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
  const swaggerUiPath = getSwaggerUiDistPath();

  router.get('/api-docs/openapi.json', (_req, res) => {
    res.json(spec);
  });

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

  router.use('/api-docs', express.static(swaggerUiPath));

  return router;
}
