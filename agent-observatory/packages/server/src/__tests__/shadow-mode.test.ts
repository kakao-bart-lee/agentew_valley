import { describe, it, expect } from 'vitest';
import {
  SHADOW_DIFF_STATUSES,
  SHADOW_DIFF_PAYLOAD_SCHEMA,
  DefaultShadowComparator,
  compareShadowPayloads,
  isShadowDiffPayload,
} from '../domains/migration/shadow-mode.js';

describe('shadow-mode comparator', () => {
  it('defines required shadow statuses and payload schema', () => {
    expect(SHADOW_DIFF_STATUSES).toEqual([
      'match',
      'mismatch',
      'missing_legacy',
      'missing_new',
    ]);
    expect(SHADOW_DIFF_PAYLOAD_SCHEMA.supportedStatuses).toEqual(SHADOW_DIFF_STATUSES);
  });

  it('returns missing_legacy when only new payload exists', () => {
    const result = compareShadowPayloads({
      entity: 'tasks',
      key: 'task-1',
      legacyPayload: null,
      newPayload: { id: 'task-1', status: 'open' },
    });

    expect(result.status).toBe('missing_legacy');
    expect(result.fieldDiffs).toEqual([]);
    expect(isShadowDiffPayload(result)).toBe(true);
  });

  it('returns missing_new when only legacy payload exists', () => {
    const result = compareShadowPayloads({
      entity: 'tasks',
      key: 'task-1',
      legacyPayload: { id: 'task-1', status: 'open' },
      newPayload: null,
    });

    expect(result.status).toBe('missing_new');
    expect(result.fieldDiffs).toEqual([]);
    expect(isShadowDiffPayload(result)).toBe(true);
  });

  it('returns match when payloads are deep-equal', () => {
    const comparator = new DefaultShadowComparator();
    const result = comparator.compare({
      entity: 'reviews',
      key: 'review-1',
      legacyPayload: { id: 'review-1', nested: { pass: true }, tags: ['a', 'b'] },
      newPayload: { id: 'review-1', nested: { pass: true }, tags: ['a', 'b'] },
    });

    expect(result.status).toBe('match');
    expect(result.fieldDiffs).toEqual([]);
    expect(isShadowDiffPayload(result)).toBe(true);
  });

  it('returns mismatch with deterministic field-level diffs', () => {
    const result = compareShadowPayloads({
      entity: 'notifications',
      key: 'notice-1',
      legacyPayload: {
        id: 'notice-1',
        status: 'open',
        meta: { count: 1, tags: ['alpha'] },
      },
      newPayload: {
        id: 'notice-1',
        status: 'closed',
        meta: { count: 2, tags: ['alpha', 'beta'], extra: true },
      },
    });

    expect(result.status).toBe('mismatch');
    expect(result.fieldDiffs).toEqual([
      { path: '$.meta.count', legacyValue: 1, newValue: 2 },
      { path: '$.meta.extra', legacyValue: undefined, newValue: true },
      { path: '$.meta.tags[1]', legacyValue: undefined, newValue: 'beta' },
      { path: '$.status', legacyValue: 'open', newValue: 'closed' },
    ]);
    expect(isShadowDiffPayload(result)).toBe(true);
  });

  it('throws when both legacy and new payloads are missing', () => {
    expect(() =>
      compareShadowPayloads({
        entity: 'webhooks',
        key: 'hook-1',
        legacyPayload: null,
        newPayload: null,
      }),
    ).toThrowError('Shadow comparison requires legacyPayload or newPayload');
  });
});
