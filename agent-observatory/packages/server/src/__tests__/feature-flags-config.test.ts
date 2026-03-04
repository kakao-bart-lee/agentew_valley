import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FEATURE_FLAGS,
  FEATURE_FLAG_ENV_VARS,
  getFeatureFlagsFromEnv,
  isAuthV2Enabled,
  isFeatureFlagEnabled,
  isKillSwitchAllV2Enabled,
  isTasksV2Enabled,
  isWebhooksV2Enabled,
} from '../config/feature-flags.js';

describe('feature flag env config', () => {
  it('defaults all feature flags to false', () => {
    const flags = getFeatureFlagsFromEnv({} as NodeJS.ProcessEnv);

    expect(flags).toEqual(DEFAULT_FEATURE_FLAGS);
  });

  it('parses truthy and falsy values from env vars', () => {
    const flags = getFeatureFlagsFromEnv(
      {
        [FEATURE_FLAG_ENV_VARS.auth_v2]: 'true',
        [FEATURE_FLAG_ENV_VARS.tasks_v2]: '1',
        [FEATURE_FLAG_ENV_VARS.webhooks_v2]: 'off',
        [FEATURE_FLAG_ENV_VARS.kill_switch_all_v2]: 'no',
      } as NodeJS.ProcessEnv,
    );

    expect(flags).toEqual({
      auth_v2: true,
      tasks_v2: true,
      webhooks_v2: false,
      kill_switch_all_v2: false,
    });
  });

  it('falls back to defaults for unknown values', () => {
    const flags = getFeatureFlagsFromEnv(
      {
        [FEATURE_FLAG_ENV_VARS.auth_v2]: 'enabled',
        [FEATURE_FLAG_ENV_VARS.tasks_v2]: 'disabled',
      } as NodeJS.ProcessEnv,
    );

    expect(flags).toEqual(DEFAULT_FEATURE_FLAGS);
  });
});

describe('feature flag accessors', () => {
  const flags = {
    auth_v2: true,
    tasks_v2: false,
    webhooks_v2: true,
    kill_switch_all_v2: false,
  };

  it('supports generic feature flag reads', () => {
    expect(isFeatureFlagEnabled(flags, 'auth_v2')).toBe(true);
    expect(isFeatureFlagEnabled(flags, 'tasks_v2')).toBe(false);
  });

  it('supports typed per-flag helpers', () => {
    expect(isAuthV2Enabled(flags)).toBe(true);
    expect(isTasksV2Enabled(flags)).toBe(false);
    expect(isWebhooksV2Enabled(flags)).toBe(true);
    expect(isKillSwitchAllV2Enabled(flags)).toBe(false);
  });
});
