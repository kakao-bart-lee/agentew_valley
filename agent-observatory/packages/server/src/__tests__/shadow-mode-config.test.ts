import { describe, it, expect } from 'vitest';
import { getShadowModeFlagsFromEnv, parseBooleanFlag } from '../config/shadow-mode.js';

describe('shadow mode env flags', () => {
  it('defaults to shadow mode OFF and read-only ON', () => {
    const flags = getShadowModeFlagsFromEnv({} as NodeJS.ProcessEnv);

    expect(flags).toEqual({
      shadowModeEnabled: false,
      shadowModeReadOnly: true,
    });
  });

  it('parses truthy and falsy values from environment variables', () => {
    const flags = getShadowModeFlagsFromEnv(
      {
        OBSERVATORY_SHADOW_MODE_ENABLED: 'true',
        OBSERVATORY_SHADOW_MODE_READ_ONLY: '0',
      } as NodeJS.ProcessEnv,
    );

    expect(flags).toEqual({
      shadowModeEnabled: true,
      shadowModeReadOnly: false,
    });
  });

  it('falls back to defaults for unrecognized values', () => {
    const flags = getShadowModeFlagsFromEnv(
      {
        OBSERVATORY_SHADOW_MODE_ENABLED: 'enabled',
        OBSERVATORY_SHADOW_MODE_READ_ONLY: 'readonly',
      } as NodeJS.ProcessEnv,
    );

    expect(flags).toEqual({
      shadowModeEnabled: false,
      shadowModeReadOnly: true,
    });
  });
});

describe('parseBooleanFlag', () => {
  it('accepts common true aliases', () => {
    expect(parseBooleanFlag('1', false)).toBe(true);
    expect(parseBooleanFlag('on', false)).toBe(true);
    expect(parseBooleanFlag('YES', false)).toBe(true);
  });

  it('accepts common false aliases', () => {
    expect(parseBooleanFlag('0', true)).toBe(false);
    expect(parseBooleanFlag('off', true)).toBe(false);
    expect(parseBooleanFlag('No', true)).toBe(false);
  });
});
