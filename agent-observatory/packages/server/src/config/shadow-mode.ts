export interface ShadowModeFlags {
  shadowModeEnabled: boolean;
  shadowModeReadOnly: boolean;
}

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

export function parseBooleanFlag(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }
  if (FALSE_VALUES.has(normalized)) {
    return false;
  }
  return defaultValue;
}

export function getShadowModeFlagsFromEnv(env: NodeJS.ProcessEnv = process.env): ShadowModeFlags {
  return {
    shadowModeEnabled: parseBooleanFlag(env.OBSERVATORY_SHADOW_MODE_ENABLED, false),
    shadowModeReadOnly: parseBooleanFlag(env.OBSERVATORY_SHADOW_MODE_READ_ONLY, true),
  };
}
