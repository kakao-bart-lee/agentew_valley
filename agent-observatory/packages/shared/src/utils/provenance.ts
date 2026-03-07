import type {
  AgentSourceType,
  EventProvenance,
  RuntimeDescriptor,
  TaskContextRef,
  UAEPEvent,
} from '../types/uaep.js';

const SOURCE_RUNTIME_MAP: Record<AgentSourceType, RuntimeDescriptor> = {
  claude_code: { family: 'claude_code', client: 'native' },
  openclaw: { family: 'openclaw', client: 'native' },
  omx: { family: 'codex', orchestrator: 'omx', client: 'omx' },
  codex: { family: 'codex', client: 'native' },
  opencode: { family: 'opencode', client: 'native' },
  agent_sdk: { family: 'agent_sdk', client: 'sdk' },
  langchain: { family: 'langchain', client: 'custom' },
  crewai: { family: 'crewai', client: 'custom' },
  custom: { family: 'custom', client: 'custom' },
  mission_control: {
    family: 'mission_control',
    orchestrator: 'mission_control',
    client: 'custom',
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableSerialize(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(String(value));
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function compactTaskContext(context?: TaskContextRef): TaskContextRef | undefined {
  if (!context) return undefined;
  const compact: TaskContextRef = {};

  if (context.provider) compact.provider = context.provider;
  if (context.project_id) compact.project_id = context.project_id;
  if (context.task_id) compact.task_id = context.task_id;
  if (context.goal_id) compact.goal_id = context.goal_id;
  if (context.issue_id) compact.issue_id = context.issue_id;
  if (context.issue_identifier) compact.issue_identifier = context.issue_identifier;
  if (context.execution_run_id) compact.execution_run_id = context.execution_run_id;
  if (context.checkout_run_id) compact.checkout_run_id = context.checkout_run_id;
  if (context.title) compact.title = context.title;
  if (context.status) compact.status = context.status;

  return Object.keys(compact).length > 0 ? compact : undefined;
}

/**
 * source 기반 기본 runtime taxonomy를 도출한다.
 */
export function inferRuntimeDescriptor(
  source: AgentSourceType,
  runtime?: RuntimeDescriptor,
): RuntimeDescriptor {
  return {
    ...SOURCE_RUNTIME_MAP[source],
    ...(runtime ?? {}),
  };
}

/**
 * top-level work context와 richer task_context를 하나의 canonical ref로 합친다.
 */
export function coerceTaskContext(
  input: Pick<UAEPEvent, 'project_id' | 'task_id' | 'goal_id' | 'task_context'>,
): TaskContextRef | undefined {
  const merged: TaskContextRef = {
    provider: input.task_context?.provider,
    project_id: input.task_context?.project_id ?? input.project_id,
    task_id: input.task_context?.task_id ?? input.task_id,
    goal_id: input.task_context?.goal_id ?? input.goal_id,
    issue_id: input.task_context?.issue_id,
    issue_identifier: input.task_context?.issue_identifier,
    execution_run_id: input.task_context?.execution_run_id,
    checkout_run_id: input.task_context?.checkout_run_id,
    title: input.task_context?.title,
    status: input.task_context?.status,
  };

  return compactTaskContext(merged);
}

/**
 * deterministic but lightweight hash used for dedupe scaffolding.
 */
export function createDeterministicFingerprint(value: unknown): string {
  return `fp_${fnv1a(stableSerialize(value))}`;
}

/**
 * provenance만으로 생성하는 원본 이벤트 fingerprint.
 */
export function createProvenanceFingerprint(provenance?: EventProvenance): string | undefined {
  if (!provenance) return undefined;
  const seed = {
    source_event_id: provenance.source_event_id,
    source_path: provenance.source_path,
    source_offset: provenance.source_offset,
    raw_event_type: provenance.raw_event_type,
    transport: provenance.transport,
    ingestion_kind: provenance.ingestion_kind,
  };
  return Object.values(seed).some((value) => value !== undefined)
    ? createDeterministicFingerprint(seed)
    : undefined;
}

/**
 * event_id/received_at처럼 collector-local 값은 제외하고 canonical fingerprint를 만든다.
 */
export function createEventFingerprint(event: UAEPEvent): string {
  const runtime = inferRuntimeDescriptor(event.source, event.runtime);
  const taskContext = coerceTaskContext(event);
  const data = isPlainObject(event.data) ? event.data : undefined;

  return createDeterministicFingerprint({
    source: event.source,
    runtime,
    agent_id: event.agent_id,
    session_id: event.session_id,
    model_id: event.model_id,
    span_id: event.span_id,
    parent_span_id: event.parent_span_id,
    team_id: event.team_id,
    type: event.type,
    task_context: taskContext,
    data,
    provenance: {
      source_event_id: event.provenance?.source_event_id,
      source_path: event.provenance?.source_path,
      source_offset: event.provenance?.source_offset,
      raw_event_type: event.provenance?.raw_event_type,
      transport: event.provenance?.transport,
      ingestion_kind: event.provenance?.ingestion_kind,
    },
  });
}

/**
 * 현재 이벤트에 provenance 기본값을 채워 넣는다.
 */
export function enrichProvenance(
  event: UAEPEvent,
  defaults: Partial<EventProvenance> = {},
): EventProvenance {
  const merged: EventProvenance = {
    ...defaults,
    ...(event.provenance ?? {}),
  };

  if (!merged.received_at) {
    merged.received_at = event.ts;
  }

  if (!merged.source_event_fingerprint) {
    merged.source_event_fingerprint = createProvenanceFingerprint(merged);
  }

  if (!merged.dedupe_key) {
    merged.dedupe_key = createEventFingerprint(event);
  }

  return merged;
}
