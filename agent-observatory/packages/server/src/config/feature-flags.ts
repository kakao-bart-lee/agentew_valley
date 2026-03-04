import { parseBooleanFlag } from './shadow-mode.js';

export const FEATURE_FLAG_NAMES = [
  'auth_v2',
  'tasks_v2',
  'webhooks_v2',
  'kill_switch_all_v2',
] as const;

export type FeatureFlagName = (typeof FEATURE_FLAG_NAMES)[number];

export type FeatureFlags = Record<FeatureFlagName, boolean>;

export const FEATURE_FLAG_ENV_VARS: Record<FeatureFlagName, string> = {
  auth_v2: 'OBSERVATORY_AUTH_V2_ENABLED',
  tasks_v2: 'OBSERVATORY_TASKS_V2_ENABLED',
  webhooks_v2: 'OBSERVATORY_WEBHOOKS_V2_ENABLED',
  kill_switch_all_v2: 'OBSERVATORY_KILL_SWITCH_ALL_V2_ENABLED',
};

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  auth_v2: false,
  tasks_v2: false,
  webhooks_v2: false,
  kill_switch_all_v2: false,
};

export function getFeatureFlagsFromEnv(env: NodeJS.ProcessEnv = process.env): FeatureFlags {
  return {
    auth_v2: parseBooleanFlag(env[FEATURE_FLAG_ENV_VARS.auth_v2], DEFAULT_FEATURE_FLAGS.auth_v2),
    tasks_v2: parseBooleanFlag(env[FEATURE_FLAG_ENV_VARS.tasks_v2], DEFAULT_FEATURE_FLAGS.tasks_v2),
    webhooks_v2: parseBooleanFlag(env[FEATURE_FLAG_ENV_VARS.webhooks_v2], DEFAULT_FEATURE_FLAGS.webhooks_v2),
    kill_switch_all_v2: parseBooleanFlag(env[FEATURE_FLAG_ENV_VARS.kill_switch_all_v2], DEFAULT_FEATURE_FLAGS.kill_switch_all_v2),
  };
}

export function isFeatureFlagEnabled(flags: FeatureFlags, featureFlagName: FeatureFlagName): boolean {
  return flags[featureFlagName];
}

export function isAuthV2Enabled(flags: FeatureFlags): boolean {
  return flags.auth_v2;
}

export function isTasksV2Enabled(flags: FeatureFlags): boolean {
  return flags.tasks_v2;
}

export function isWebhooksV2Enabled(flags: FeatureFlags): boolean {
  return flags.webhooks_v2;
}

export function isKillSwitchAllV2Enabled(flags: FeatureFlags): boolean {
  return flags.kill_switch_all_v2;
}
