import { isDeepStrictEqual } from 'node:util';

export const SHADOW_DIFF_STATUSES = ['match', 'mismatch', 'missing_legacy', 'missing_new'] as const;

export type ShadowDiffStatus = (typeof SHADOW_DIFF_STATUSES)[number];

export interface ShadowComparisonInput<TPayload = Record<string, unknown>> {
  entity: string;
  key: string;
  legacyPayload?: TPayload | null;
  newPayload?: TPayload | null;
  comparedAt?: string;
}

export interface ShadowFieldDiff {
  path: string;
  legacyValue: unknown;
  newValue: unknown;
}

export interface ShadowDiffPayload<TPayload = Record<string, unknown>> {
  entity: string;
  key: string;
  status: ShadowDiffStatus;
  comparedAt: string;
  legacyPayload: TPayload | null;
  newPayload: TPayload | null;
  fieldDiffs: ShadowFieldDiff[];
}

export interface ShadowComparator<TPayload = Record<string, unknown>> {
  compare(input: ShadowComparisonInput<TPayload>): ShadowDiffPayload<TPayload>;
}

export const SHADOW_DIFF_PAYLOAD_SCHEMA = {
  requiredFields: [
    'entity',
    'key',
    'status',
    'comparedAt',
    'legacyPayload',
    'newPayload',
    'fieldDiffs',
  ] as const,
  supportedStatuses: SHADOW_DIFF_STATUSES,
} as const;

export class DefaultShadowComparator<TPayload = Record<string, unknown>> implements ShadowComparator<TPayload> {
  compare(input: ShadowComparisonInput<TPayload>): ShadowDiffPayload<TPayload> {
    const legacyPayload = input.legacyPayload ?? null;
    const newPayload = input.newPayload ?? null;

    if (legacyPayload === null && newPayload === null) {
      throw new Error('Shadow comparison requires legacyPayload or newPayload');
    }

    const status = getStatus(legacyPayload, newPayload);
    const fieldDiffs =
      status === 'mismatch'
        ? collectFieldDiffs('$', legacyPayload, newPayload)
        : [];

    return {
      entity: input.entity,
      key: input.key,
      status,
      comparedAt: input.comparedAt ?? new Date().toISOString(),
      legacyPayload,
      newPayload,
      fieldDiffs,
    };
  }
}

export function compareShadowPayloads<TPayload = Record<string, unknown>>(
  input: ShadowComparisonInput<TPayload>,
): ShadowDiffPayload<TPayload> {
  const comparator = new DefaultShadowComparator<TPayload>();
  return comparator.compare(input);
}

export function isShadowDiffStatus(value: string): value is ShadowDiffStatus {
  return SHADOW_DIFF_STATUSES.includes(value as ShadowDiffStatus);
}

export function isShadowDiffPayload(value: unknown): value is ShadowDiffPayload {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.entity !== 'string' ||
    typeof value.key !== 'string' ||
    typeof value.comparedAt !== 'string' ||
    typeof value.status !== 'string' ||
    !isShadowDiffStatus(value.status) ||
    !Object.prototype.hasOwnProperty.call(value, 'legacyPayload') ||
    !Object.prototype.hasOwnProperty.call(value, 'newPayload') ||
    !Array.isArray(value.fieldDiffs)
  ) {
    return false;
  }

  return value.fieldDiffs.every((diff) => {
    if (!isRecord(diff)) {
      return false;
    }

    return (
      typeof diff.path === 'string' &&
      Object.prototype.hasOwnProperty.call(diff, 'legacyValue') &&
      Object.prototype.hasOwnProperty.call(diff, 'newValue')
    );
  });
}

function getStatus(legacyPayload: unknown, newPayload: unknown): ShadowDiffStatus {
  if (legacyPayload === null) {
    return 'missing_legacy';
  }

  if (newPayload === null) {
    return 'missing_new';
  }

  if (isDeepStrictEqual(legacyPayload, newPayload)) {
    return 'match';
  }

  return 'mismatch';
}

function collectFieldDiffs(path: string, legacyValue: unknown, newValue: unknown): ShadowFieldDiff[] {
  if (isDeepStrictEqual(legacyValue, newValue)) {
    return [];
  }

  if (Array.isArray(legacyValue) && Array.isArray(newValue)) {
    const diffs: ShadowFieldDiff[] = [];
    const length = Math.max(legacyValue.length, newValue.length);
    for (let i = 0; i < length; i += 1) {
      diffs.push(...collectFieldDiffs(`${path}[${i}]`, legacyValue[i], newValue[i]));
    }
    return diffs;
  }

  if (isPlainObject(legacyValue) && isPlainObject(newValue)) {
    const diffs: ShadowFieldDiff[] = [];
    const keys = [...new Set([...Object.keys(legacyValue), ...Object.keys(newValue)])].sort();
    for (const key of keys) {
      diffs.push(...collectFieldDiffs(`${path}.${key}`, legacyValue[key], newValue[key]));
    }
    return diffs;
  }

  return [{ path, legacyValue, newValue }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value);
}
