export { createApp } from './app.js';
export type { AppConfig, AppInstance } from './app.js';
export { InMemoryEventBus } from './core/event-bus.js';
export type { EventBus } from './core/event-bus.js';
export { StateManager } from './core/state-manager.js';
export { MetricsAggregator } from './core/metrics-aggregator.js';
export { HistoryStore } from './core/history-store.js';
export { createApiRouter } from './delivery/api.js';
export { createWebSocketServer } from './delivery/websocket.js';
export { createCollectorGateway } from './delivery/collector-gateway.js';
export type { CollectorGateway } from './delivery/collector-gateway.js';
export {
  SHADOW_DIFF_STATUSES,
  SHADOW_DIFF_PAYLOAD_SCHEMA,
  DefaultShadowComparator,
  compareShadowPayloads,
  isShadowDiffStatus,
  isShadowDiffPayload,
} from './domains/migration/shadow-mode.js';
export type {
  ShadowDiffStatus,
  ShadowComparisonInput,
  ShadowFieldDiff,
  ShadowDiffPayload,
  ShadowComparator,
} from './domains/migration/shadow-mode.js';
export {
  FEATURE_FLAG_NAMES,
  FEATURE_FLAG_ENV_VARS,
  DEFAULT_FEATURE_FLAGS,
  getFeatureFlagsFromEnv,
  isFeatureFlagEnabled,
  isAuthV2Enabled,
  isTasksV2Enabled,
  isWebhooksV2Enabled,
  isKillSwitchAllV2Enabled,
} from './config/feature-flags.js';
export type { FeatureFlagName, FeatureFlags } from './config/feature-flags.js';

import type { UAEPEvent } from '@agent-observatory/shared';
import type { Collector } from '@agent-observatory/collectors';
import { ClaudeCodeCollector, OpenClawCollector, AgentSDKCollector, HTTPCollector, MissionControlCollector, OMXCollector } from '@agent-observatory/collectors';
import { createApp } from './app.js';
import { getFeatureFlagsFromEnv } from './config/feature-flags.js';
import { getShadowModeFlagsFromEnv } from './config/shadow-mode.js';

type ObservatoryMode = 'local' | 'remote';

async function main(): Promise<void> {
  const port = parseInt(process.env.PORT ?? '3561', 10);
  const watchPaths = (process.env.WATCH_PATHS ?? '').split(',').filter(Boolean);
  const dbPath = process.env.OBSERVATORY_DB_PATH ?? undefined;
  const tailOnly = process.env.OBSERVATORY_TAIL_ONLY !== 'false'; // 기본 true
  const mode: ObservatoryMode = (process.env.OBSERVATORY_MODE as ObservatoryMode) ?? 'local';
  const collectorApiKeys = (process.env.OBSERVATORY_COLLECTOR_API_KEYS ?? '').split(',').filter(Boolean);
  const dashboardApiKey = process.env.OBSERVATORY_DASHBOARD_API_KEY || undefined;
  const shadowModeFlags = getShadowModeFlagsFromEnv();
  const featureFlags = getFeatureFlagsFromEnv();

  const mcDbPath = process.env.MISSION_CONTROL_DB_PATH ?? undefined;

  const { app, server, eventBus, close } = createApp({
    watchPaths,
    dbPath,
    mcDbPath,
    collectorApiKeys,
    dashboardApiKey,
    shadowModeEnabled: shadowModeFlags.shadowModeEnabled,
    shadowModeReadOnly: shadowModeFlags.shadowModeReadOnly,
    featureFlags,
  });

  const activeCollectors: Collector[] = [];

  if (mode === 'local') {
    // Local mode: run collectors in-process (existing behavior)

    // Mission Control Collector (Local Linear Tasks)
    try {
      const mcPaths = (process.env.MISSION_CONTROL_WATCH_PATHS ?? '/Users/bclaw/workspace/agentic-dev-group').split(',');
      const mc = new MissionControlCollector({ watchPaths: mcPaths });
      mc.onEvent((event: UAEPEvent) => eventBus.publish(event));
      await mc.start();
      activeCollectors.push(mc);
      console.log(`[server] Mission Control collector started (paths: ${mcPaths.join(', ')})`);
    } catch (err) {
      console.warn('[server] Mission Control collector failed to start:', err);
    }

    // Claude Code Collector
    try {
      const ccPaths = (process.env.CLAUDE_CODE_WATCH_PATHS ?? '~/.claude/projects').split(',');
      const cc = new ClaudeCodeCollector({ watchPaths: ccPaths, tailOnly });
      cc.onEvent((event: UAEPEvent) => eventBus.publish(event));
      await cc.start();
      activeCollectors.push(cc);
      console.log(`[server] Claude Code collector started (paths: ${ccPaths.join(', ')})`);
    } catch (err) {
      console.warn('[server] Claude Code collector failed to start:', err);
    }

    // OpenClaw Collector
    try {
      const ocPaths = (process.env.OPENCLAW_WATCH_PATHS ?? '~/.openclaw/agents').split(',');
      const oc = new OpenClawCollector({ watchPaths: ocPaths, tailOnly });
      oc.onEvent((event: UAEPEvent) => eventBus.publish(event));
      await oc.start();
      activeCollectors.push(oc);
      console.log(`[server] OpenClaw collector started (paths: ${ocPaths.join(', ')})`);
    } catch (err) {
      console.warn('[server] OpenClaw collector failed to start:', err);
    }

    // OMX Collector
    try {
      const omxPaths = (process.env.OMX_WATCH_PATHS ?? '.omx').split(',');
      const omx = new OMXCollector({ watchPaths: omxPaths, tailOnly });
      omx.onEvent((event: UAEPEvent) => eventBus.publish(event));
      await omx.start();
      activeCollectors.push(omx);
      console.log(`[server] OMX collector started (paths: ${omxPaths.join(', ')})`);
    } catch (err) {
      console.warn('[server] OMX collector failed to start:', err);
    }

    // Agent SDK Hook Collector (Express Router)
    const sdkCollector = new AgentSDKCollector();
    sdkCollector.onEvent((event: UAEPEvent) => eventBus.publish(event));
    app.use(sdkCollector.getRouter());
    activeCollectors.push(sdkCollector);
    console.log('[server] Agent SDK hook collector mounted');

    // HTTP Collector (Express Router with API key auth)
    const apiKeys = (process.env.OBSERVATORY_API_KEYS ?? '').split(',').filter(Boolean);
    const httpCollector = new HTTPCollector({ apiKeys: apiKeys.length > 0 ? apiKeys : undefined });
    httpCollector.onEvent((event: UAEPEvent) => eventBus.publish(event));
    app.use(httpCollector.getRouter());
    activeCollectors.push(httpCollector);
    console.log(`[server] HTTP collector mounted (API keys: ${apiKeys.length > 0 ? apiKeys.length + ' configured' : 'open access'})`);
  } else {
    console.log('[server] Remote mode — local collectors disabled, WebSocket Gateway active');
  }

  if (mode === 'local' && activeCollectors.length === 0) {
    console.log('[server] No collectors active — running in API-only mode');
  }

  server.listen(port, () => {
    console.log(`[server] Agent Observatory server listening on port ${port}`);
    console.log(`[server] Mode: ${mode}`);
    if (mode === 'local') {
      console.log(`[server] Active collectors: ${activeCollectors.map(c => c.name).join(', ') || 'none'}`);
      console.log(`[server] Tail-only mode: ${tailOnly ? 'ON (skip existing, collect new only)' : 'OFF (read all existing files)'}`);
    }
    if (collectorApiKeys.length > 0) {
      console.log(`[server] Collector Gateway: ${collectorApiKeys.length} API key(s) configured`);
    } else {
      console.log('[server] Collector Gateway: open access (no API keys)');
    }
    if (dbPath) {
      console.log(`[server] SQLite database: ${dbPath}`);
    } else {
      console.log('[server] SQLite database: in-memory (data will not persist across restarts)');
    }
    if (mcDbPath) {
      console.log(`[server] Mission Control DB: ${mcDbPath}`);
    } else {
      console.log('[server] Mission Control DB: not configured (set MISSION_CONTROL_DB_PATH to enable)');
    }
    if (shadowModeFlags.shadowModeEnabled) {
      console.log(`[server] Shadow mode: ON (read-only=${shadowModeFlags.shadowModeReadOnly ? 'true' : 'false'})`);
      if (!shadowModeFlags.shadowModeReadOnly) {
        console.warn('[server] Shadow mode misconfigured: set OBSERVATORY_SHADOW_MODE_READ_ONLY=true for comparison-only reports');
      }
    } else {
      console.log('[server] Shadow mode: OFF');
    }
    console.log(
      `[server] Feature flags: auth_v2=${featureFlags.auth_v2 ? 'ON' : 'OFF'}, tasks_v2=${featureFlags.tasks_v2 ? 'ON' : 'OFF'}, webhooks_v2=${featureFlags.webhooks_v2 ? 'ON' : 'OFF'}, kill_switch_all_v2=${featureFlags.kill_switch_all_v2 ? 'ON' : 'OFF'}`,
    );
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[server] Shutting down...');
    for (const collector of activeCollectors) {
      try {
        await collector.stop();
        console.log(`[server] Collector ${collector.name} stopped`);
      } catch (err) {
        console.warn(`[server] Error stopping collector ${collector.name}:`, err);
      }
    }
    close();
    server.close(() => {
      console.log('[server] Server closed');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

// Run only when executed directly
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('/index.js') ||
    process.argv[1].endsWith('/index.ts'));

if (isMain) {
  main().catch((err) => {
    console.error('[server] Fatal error:', err);
    process.exit(1);
  });
}
