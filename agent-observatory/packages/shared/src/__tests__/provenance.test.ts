import { describe, expect, it } from 'vitest';
import type { UAEPEvent } from '../types/uaep.js';
import {
  coerceTaskContext,
  createDeterministicFingerprint,
  createEventFingerprint,
  enrichProvenance,
  inferRuntimeDescriptor,
} from '../utils/provenance.js';

function makeEvent(overrides: Partial<UAEPEvent> = {}): UAEPEvent {
  return {
    ts: '2026-03-07T00:00:00.000Z',
    event_id: 'evt-1',
    source: 'omx',
    agent_id: 'agent-1',
    session_id: 'session-1',
    type: 'tool.start',
    data: {
      tool_name: 'Read',
      tool_category: 'file_read',
    },
    ...overrides,
  };
}

describe('provenance helpers', () => {
  it('infers codex runtime from omx source', () => {
    expect(inferRuntimeDescriptor('omx')).toEqual({
      family: 'codex',
      orchestrator: 'omx',
      client: 'omx',
    });
  });

  it('merges top-level work context with richer task context', () => {
    expect(coerceTaskContext(makeEvent({
      project_id: 'moonlit',
      task_context: {
        provider: 'paperclip',
        task_id: 'task-42',
        issue_identifier: 'ISSUE-42',
      },
    }))).toEqual({
      provider: 'paperclip',
      project_id: 'moonlit',
      task_id: 'task-42',
      issue_identifier: 'ISSUE-42',
    });
  });

  it('creates stable fingerprints regardless of key order', () => {
    expect(createDeterministicFingerprint({ b: 2, a: 1 })).toBe(
      createDeterministicFingerprint({ a: 1, b: 2 }),
    );
  });

  it('creates canonical event fingerprint independent of event_id', () => {
    const left = createEventFingerprint(makeEvent({ event_id: 'evt-left' }));
    const right = createEventFingerprint(makeEvent({ event_id: 'evt-right' }));
    expect(left).toBe(right);
  });

  it('enriches provenance with source fingerprint and dedupe key', () => {
    const provenance = enrichProvenance(makeEvent({
      provenance: {
        ingestion_kind: 'jsonl',
        source_event_id: 'line-42',
        source_path: '/tmp/session.jsonl',
        source_offset: 42,
      },
    }));

    expect(provenance.received_at).toBeTruthy();
    expect(provenance.source_event_fingerprint).toMatch(/^fp_/);
    expect(provenance.dedupe_key).toMatch(/^fp_/);
  });
});
