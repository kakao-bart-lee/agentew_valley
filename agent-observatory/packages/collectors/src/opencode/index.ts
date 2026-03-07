import Database from 'better-sqlite3';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { RuntimeDescriptor, UAEPEvent } from '@agent-observatory/shared';
import { generateEventId, getToolCategory } from '@agent-observatory/shared';
import type { Collector, CollectorConfig } from '../base.js';
import { normalizeWatchPaths } from '../path-utils.js';

type OpenCodeRole = 'user' | 'assistant';

interface RowCursor {
  updatedAt: number;
  rowId: number;
}

interface OpenCodeSessionRow {
  rowid: number;
  id: string;
  project_id: string;
  parent_id: string | null;
  slug: string;
  directory: string;
  title: string;
  permission: string | null;
  time_created: number;
  time_updated: number;
  time_compacting: number | null;
  time_archived: number | null;
}

interface OpenCodeMessageRow {
  rowid: number;
  id: string;
  session_id: string;
  time_created: number;
  time_updated: number;
  data: string;
}

interface OpenCodePartRow {
  rowid: number;
  id: string;
  message_id: string;
  session_id: string;
  time_created: number;
  time_updated: number;
  data: string;
}

interface OpenCodeSessionIndexEntry {
  sessionId?: string;
  updatedAt?: number;
  label?: string;
  channel?: string;
  lastChannel?: string;
  deliveryContext?: {
    channel?: string;
  };
  acp?: {
    backend?: string;
    agent?: string;
    mode?: string;
    cwd?: string;
    state?: string;
    lastActivityAt?: number;
    runtimeOptions?: {
      cwd?: string;
    };
    identity?: {
      state?: string;
      source?: string;
      lastUpdatedAt?: number;
      acpxRecordId?: string;
      acpxSessionId?: string;
    };
  };
}

interface OpenCodeMessageData {
  role?: OpenCodeRole;
  time?: {
    created?: number;
    completed?: number;
  };
  modelID?: string;
  providerID?: string;
  model?: {
    modelID?: string;
    providerID?: string;
  };
  agent?: string;
  mode?: string;
  path?: {
    cwd?: string;
  };
  cost?: number;
  tokens?: OpenCodeTokenSnapshot;
  content?: string;
  text?: string;
  prompt?: string;
  input?: string;
  summary?: string;
  system?: string;
  finish?: string;
}

interface OpenCodeTokenSnapshot {
  total?: number;
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: {
    read?: number;
    write?: number;
  };
}

interface OpenCodePartData {
  type?: string;
  text?: string;
  reason?: string;
  auto?: boolean;
  overflow?: boolean;
  cost?: number;
  tokens?: OpenCodeTokenSnapshot;
  callID?: string;
  tool?: string;
  filename?: string;
  url?: string;
  source?: {
    path?: string;
  };
  state?: {
    status?: string;
    input?: Record<string, unknown>;
    output?: unknown;
    error?: string;
  };
  metadata?: Record<string, unknown>;
}

interface OpenCodeMessageMeta {
  id: string;
  sessionId: string;
  role?: OpenCodeRole;
  agentName?: string;
  modelId?: string;
  providerId?: string;
  cwd?: string;
  createdAtMs: number;
  updatedAtMs: number;
  completedAtMs?: number;
  userInputEmitted: boolean;
  llmEmissionVersion?: string;
}

interface OpenCodeTotals {
  total: number;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

interface OpenCodeSessionMeta {
  sessionId: string;
  agentId: string;
  agentName?: string;
  title?: string;
  slug?: string;
  directory?: string;
  opencodeProjectId?: string;
  modelId?: string;
  providerId?: string;
  parentSessionId?: string;
  parentAgentId?: string;
  permission?: string;
  started: boolean;
  archived: boolean;
  subagentLinked: boolean;
  lastTotals: OpenCodeTotals;
}

interface ToolEmissionState {
  started: boolean;
  terminal?: 'completed' | 'error';
}

export interface OpenCodeCollectorConfig extends CollectorConfig {
  dbPath?: string;
  sessionsIndexPath?: string;
  pollIntervalMs?: number;
}

const OPENCODE_RUNTIME: RuntimeDescriptor = {
  family: 'opencode',
  client: 'sqlite',
};

function toIsoFromMs(value: number | undefined): string {
  return new Date(value ?? Date.now()).toISOString();
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeAgentName(value: unknown): string | undefined {
  const name = asNonEmptyString(value);
  if (!name) return undefined;
  const normalized = name.toLowerCase();
  if (normalized === 'opencode' || normalized === 'open code') {
    return 'OpenCode';
  }
  return name;
}

function safeParseJson<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function truncate(value: string, max = 220): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function flattenText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function extractFirstMeaningfulLine(value: string | undefined): string | undefined {
  const flattened = value ? flattenText(value) : '';
  return flattened.length > 0 ? truncate(flattened) : undefined;
}

function buildSyntheticAgentId(sessionId: string): string {
  return `opencode:${sessionId}`;
}

function emptyTotals(): OpenCodeTotals {
  return {
    total: 0,
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
  };
}

function emptyCursor(): RowCursor {
  return { updatedAt: 0, rowId: 0 };
}

function readTokenSnapshot(tokens?: OpenCodeTokenSnapshot, cost?: number): OpenCodeTotals {
  return {
    total: typeof tokens?.total === 'number' ? tokens.total : 0,
    input: typeof tokens?.input === 'number' ? tokens.input : 0,
    output: typeof tokens?.output === 'number' ? tokens.output : 0,
    reasoning: typeof tokens?.reasoning === 'number' ? tokens.reasoning : 0,
    cacheRead: typeof tokens?.cache?.read === 'number' ? tokens.cache.read : 0,
    cacheWrite: typeof tokens?.cache?.write === 'number' ? tokens.cache.write : 0,
    cost: typeof cost === 'number' ? cost : 0,
  };
}

function diffTotals(previous: OpenCodeTotals, current: OpenCodeTotals): OpenCodeTotals {
  return {
    total: Math.max(current.total - previous.total, 0),
    input: Math.max(current.input - previous.input, 0),
    output: Math.max(current.output - previous.output, 0),
    reasoning: Math.max(current.reasoning - previous.reasoning, 0),
    cacheRead: Math.max(current.cacheRead - previous.cacheRead, 0),
    cacheWrite: Math.max(current.cacheWrite - previous.cacheWrite, 0),
    cost: Math.max(current.cost - previous.cost, 0),
  };
}

function mapIndexStateToAgentStatus(state?: string, identityState?: string): UAEPEvent['data'] {
  const normalizedState = (state ?? identityState ?? 'idle').toLowerCase();
  if (normalizedState.includes('error') || normalizedState.includes('failed')) {
    return { status: 'error', status_detail: `acp:${normalizedState}` };
  }
  if (normalizedState === 'running') {
    return { status: 'acting', status_detail: 'acp:running' };
  }
  if (normalizedState === 'pending' || normalizedState === 'resolving') {
    return { status: 'thinking', status_detail: `acp:${normalizedState}` };
  }
  if (normalizedState === 'waiting') {
    return { status: 'waiting_input', status_detail: 'acp:waiting' };
  }
  return { status: 'idle', status_detail: `acp:${normalizedState}` };
}

function summarizeToolInput(input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined;
  const preferredKeys = ['command', 'filePath', 'path', 'query', 'pattern', 'description', 'title'];
  for (const key of preferredKeys) {
    const value = asNonEmptyString(input[key]);
    if (value) return truncate(flattenText(value), 160);
  }

  const todos = Array.isArray(input['todos']) ? input['todos'] as Array<Record<string, unknown>> : undefined;
  const todoContent = todos?.find((todo) => typeof todo['content'] === 'string')?.['content'];
  if (typeof todoContent === 'string' && todoContent.trim().length > 0) {
    return truncate(flattenText(todoContent), 160);
  }

  const firstEntry = Object.entries(input).find(([, value]) => typeof value === 'string');
  if (!firstEntry) return undefined;
  return truncate(flattenText(firstEntry[1] as string), 160);
}

function summarizeToolOutput(output: unknown): string | undefined {
  if (typeof output === 'string') return truncate(flattenText(output), 160);
  if (output && typeof output === 'object') return truncate(flattenText(JSON.stringify(output)), 160);
  return undefined;
}

function extractUserPreview(message: OpenCodeMessageData, sessionTitle?: string): string | undefined {
  const direct =
    asNonEmptyString(message.content)
    ?? asNonEmptyString(message.text)
    ?? asNonEmptyString(message.prompt)
    ?? asNonEmptyString(message.input)
    ?? asNonEmptyString(message.summary)
    ?? sessionTitle;

  if (direct) return truncate(flattenText(direct));
  return extractFirstMeaningfulLine(asNonEmptyString(message.system));
}

function latestCursorFor(db: Database.Database, table: 'session' | 'message' | 'part'): RowCursor {
  const row = db.prepare(`
    SELECT COALESCE(time_updated, 0) AS time_updated, rowid
    FROM ${table}
    ORDER BY time_updated DESC, rowid DESC
    LIMIT 1
  `).get() as { time_updated?: number; rowid?: number } | undefined;

  return {
    updatedAt: Number(row?.time_updated ?? 0),
    rowId: Number(row?.rowid ?? 0),
  };
}

export class OpenCodeCollector implements Collector {
  readonly name = 'OpenCodeCollector';
  readonly sourceType = 'opencode' as const;

  private readonly config: OpenCodeCollectorConfig;
  private readonly handlers: Array<(event: UAEPEvent) => void> = [];
  private dbPath?: string;
  private sessionsIndexPath?: string;
  private db: Database.Database | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private polling = false;
  private seq = 0;
  private sessionCursor: RowCursor = emptyCursor();
  private messageCursor: RowCursor = emptyCursor();
  private partCursor: RowCursor = emptyCursor();
  private readonly messages = new Map<string, OpenCodeMessageMeta>();
  private readonly sessions = new Map<string, OpenCodeSessionMeta>();
  private readonly sessionAgentIds = new Map<string, string>();
  private readonly sessionIndexStatusKeys = new Map<string, string>();
  private readonly partVersions = new Map<string, number>();
  private readonly toolStates = new Map<string, ToolEmissionState>();

  constructor(config: OpenCodeCollectorConfig) {
    this.config = config;
  }

  onEvent(handler: (event: UAEPEvent) => void): void {
    this.handlers.push(handler);
  }

  async start(): Promise<void> {
    this.resolvePaths();
    await this.ensureDb();

    if (this.config.tailOnly) {
      this.primeSessionIndex();
      this.primeDbCursors();
    } else {
      await this.pollOnce();
    }

    const intervalMs = this.config.pollIntervalMs ?? 750;
    this.pollTimer = setInterval(() => {
      void this.pollOnce();
    }, intervalMs);
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.db) {
      this.db.close();
      this.db = null;
    }

    this.handlers.length = 0;
    this.messages.clear();
    this.sessions.clear();
    this.sessionAgentIds.clear();
    this.sessionIndexStatusKeys.clear();
    this.partVersions.clear();
    this.toolStates.clear();
    this.sessionCursor = emptyCursor();
    this.messageCursor = emptyCursor();
    this.partCursor = emptyCursor();
    this.polling = false;
    this.seq = 0;
  }

  private resolvePaths(): void {
    const normalized = normalizeWatchPaths(this.config.watchPaths);
    const candidates = [
      ...(this.config.dbPath ? [this.config.dbPath] : []),
      ...(this.config.sessionsIndexPath ? [this.config.sessionsIndexPath] : []),
      ...normalized,
    ].map((value) => value.trim()).filter(Boolean);

    for (const candidate of candidates) {
      if (!this.dbPath && candidate.endsWith('opencode.db')) {
        this.dbPath = candidate;
        continue;
      }
      if (!this.sessionsIndexPath && candidate.endsWith('sessions.json')) {
        this.sessionsIndexPath = candidate;
        continue;
      }
      if (!existsSync(candidate)) continue;

      const stats = statSync(candidate);
      if (!stats.isDirectory()) continue;

      const dbCandidate = join(candidate, 'opencode.db');
      if (!this.dbPath && existsSync(dbCandidate)) {
        this.dbPath = dbCandidate;
      }

      const indexCandidate = basename(candidate) === 'sessions'
        ? join(candidate, 'sessions.json')
        : join(candidate, 'sessions', 'sessions.json');
      if (!this.sessionsIndexPath && existsSync(indexCandidate)) {
        this.sessionsIndexPath = indexCandidate;
      }
    }
  }

  private async ensureDb(): Promise<Database.Database | null> {
    if (this.db) return this.db;
    if (!this.dbPath || !existsSync(this.dbPath)) return null;

    this.db = new Database(this.dbPath, { readonly: true, fileMustExist: true });
    return this.db;
  }

  private primeSessionIndex(): void {
    const entries = this.readSessionIndexEntries();
    for (const [agentId, entry] of entries) {
      this.upsertIndexEntry(agentId, entry, false);
    }
  }

  private primeDbCursors(): void {
    const db = this.db;
    if (!db) return;

    this.sessionCursor = latestCursorFor(db, 'session');
    this.messageCursor = latestCursorFor(db, 'message');
    this.partCursor = latestCursorFor(db, 'part');
  }

  private async pollOnce(): Promise<void> {
    if (this.polling) return;
    this.polling = true;

    try {
      const db = await this.ensureDb();
      const entries = this.readSessionIndexEntries();
      for (const [agentId, entry] of entries) {
        this.upsertIndexEntry(agentId, entry, true);
      }

      if (!db) return;

      this.pollSessions(db);
      this.pollMessages(db);
      this.pollParts(db);
    } finally {
      this.polling = false;
    }
  }

  private readSessionIndexEntries(): Array<[string, OpenCodeSessionIndexEntry]> {
    if (!this.sessionsIndexPath || !existsSync(this.sessionsIndexPath)) return [];

    try {
      if (!statSync(this.sessionsIndexPath).isFile()) return [];
      const raw = readFileSync(this.sessionsIndexPath, 'utf-8');
      const parsed = safeParseJson<Record<string, OpenCodeSessionIndexEntry>>(raw);
      if (!parsed) return [];
      return Object.entries(parsed).sort((left, right) => (left[1].updatedAt ?? 0) - (right[1].updatedAt ?? 0));
    } catch {
      return [];
    }
  }

  private upsertIndexEntry(agentId: string, entry: OpenCodeSessionIndexEntry, emitEvents: boolean): void {
    const sessionId = asNonEmptyString(entry.sessionId);
    if (!sessionId) return;

    this.sessionAgentIds.set(sessionId, agentId);
    const session = this.getOrCreateSession(sessionId, {
      agentId,
      agentName: normalizeAgentName(entry.acp?.agent) ?? 'OpenCode',
      title: asNonEmptyString(entry.label),
      directory: asNonEmptyString(entry.acp?.cwd) ?? asNonEmptyString(entry.acp?.runtimeOptions?.cwd),
    });

    const ts = toIsoFromMs(entry.acp?.lastActivityAt ?? entry.updatedAt ?? entry.acp?.identity?.lastUpdatedAt);
    if (emitEvents) {
      this.emitSessionStartIfNeeded(session, ts, 'session_index', {
        title: session.title,
        directory: session.directory,
        session_label: entry.label,
        channel: entry.deliveryContext?.channel ?? entry.channel ?? entry.lastChannel,
      });
    }

    const statusKey = [
      entry.acp?.state ?? '',
      entry.acp?.identity?.state ?? '',
      String(entry.updatedAt ?? entry.acp?.lastActivityAt ?? 0),
    ].join('|');

    if (!emitEvents || this.sessionIndexStatusKeys.get(sessionId) === statusKey) return;
    this.sessionIndexStatusKeys.set(sessionId, statusKey);

    this.emitEvent({
      ts,
      source: 'opencode',
      agent_id: session.agentId,
      agent_name: session.agentName ?? 'OpenCode',
      session_id: session.sessionId,
      model_id: session.modelId,
      runtime: OPENCODE_RUNTIME,
      project_id: session.directory,
      type: 'agent.status',
      data: {
        ...mapIndexStateToAgentStatus(entry.acp?.state, entry.acp?.identity?.state),
        backend: entry.acp?.backend,
        mode: entry.acp?.mode,
        channel: entry.deliveryContext?.channel ?? entry.channel ?? entry.lastChannel,
      },
      provenance: {
        collector: this.name,
        ingestion_kind: 'state',
        source_path: this.sessionsIndexPath,
        raw_event_type: 'acp_session_index',
        source_event_id: sessionId,
        transport: 'poll',
      },
    });
  }

  private pollSessions(db: Database.Database): void {
    const rows = db.prepare(`
      SELECT
        rowid,
        id,
        project_id,
        parent_id,
        slug,
        directory,
        title,
        permission,
        time_created,
        time_updated,
        time_compacting,
        time_archived
      FROM session
      WHERE time_updated > ? OR (time_updated = ? AND rowid > ?)
      ORDER BY time_updated ASC, rowid ASC
    `).all(this.sessionCursor.updatedAt, this.sessionCursor.updatedAt, this.sessionCursor.rowId) as OpenCodeSessionRow[];

    for (const row of rows) {
      this.sessionCursor = { updatedAt: row.time_updated, rowId: row.rowid };

      const seed = this.getSessionSeed(db, row.id);
      const session = this.getOrCreateSession(row.id, {
        agentName: seed?.agentName,
        title: row.title,
        slug: row.slug,
        directory: row.directory,
        opencodeProjectId: row.project_id,
        parentSessionId: row.parent_id ?? undefined,
        parentAgentId: row.parent_id ? this.sessionAgentIds.get(row.parent_id) ?? buildSyntheticAgentId(row.parent_id) : undefined,
        modelId: seed?.modelId,
        providerId: seed?.providerId,
        permission: row.permission ?? undefined,
      });

      this.sessionAgentIds.set(row.id, session.agentId);

      if (row.parent_id && !session.subagentLinked) {
        const parentAgentId = this.sessionAgentIds.get(row.parent_id) ?? buildSyntheticAgentId(row.parent_id);
        session.parentAgentId = parentAgentId;
        this.emitEvent({
          ts: toIsoFromMs(row.time_created),
          source: 'opencode',
          agent_id: parentAgentId,
          agent_name: this.sessions.get(row.parent_id)?.agentName ?? 'OpenCode',
          session_id: row.parent_id,
          runtime: OPENCODE_RUNTIME,
          project_id: row.directory,
          type: 'subagent.spawn',
          data: {
            child_agent_id: session.agentId,
            child_session_id: row.id,
            label: row.title,
          },
          provenance: {
            collector: this.name,
            ingestion_kind: 'sqlite',
            source_path: this.dbPath,
            source_offset: row.rowid,
            raw_event_type: 'session',
            source_event_id: row.id,
            transport: 'poll',
          },
        });
        session.subagentLinked = true;
      }

      this.emitSessionStartIfNeeded(session, toIsoFromMs(row.time_created), 'session', {
        title: row.title,
        directory: row.directory,
        session_slug: row.slug,
        opencode_project_id: row.project_id,
        parent_session_id: row.parent_id ?? undefined,
        permission: row.permission ?? undefined,
        parent_agent_id: session.parentAgentId,
      }, row.rowid, row.id);

      if (row.time_compacting) {
        this.emitEvent({
          ts: toIsoFromMs(row.time_compacting),
          source: 'opencode',
          agent_id: session.agentId,
          agent_name: session.agentName ?? 'OpenCode',
          session_id: session.sessionId,
          model_id: session.modelId,
          runtime: OPENCODE_RUNTIME,
          project_id: session.directory,
          type: 'agent.status',
          data: {
            status: 'thinking',
            status_detail: 'compaction',
          },
          provenance: {
            collector: this.name,
            ingestion_kind: 'sqlite',
            source_path: this.dbPath,
            source_offset: row.rowid,
            raw_event_type: 'session.compacting',
            source_event_id: `${row.id}:compacting`,
            transport: 'poll',
          },
        });
      }

      if (row.time_archived && !session.archived) {
        this.emitEvent({
          ts: toIsoFromMs(row.time_archived),
          source: 'opencode',
          agent_id: session.agentId,
          agent_name: session.agentName ?? 'OpenCode',
          session_id: session.sessionId,
          model_id: session.modelId,
          runtime: OPENCODE_RUNTIME,
          project_id: session.directory,
          type: 'session.end',
          data: {
            reason: 'archived',
          },
          provenance: {
            collector: this.name,
            ingestion_kind: 'sqlite',
            source_path: this.dbPath,
            source_offset: row.rowid,
            raw_event_type: 'session',
            source_event_id: row.id,
            transport: 'poll',
          },
        });
        session.archived = true;
      }
    }
  }

  private pollMessages(db: Database.Database): void {
    const rows = db.prepare(`
      SELECT rowid, id, session_id, time_created, time_updated, data
      FROM message
      WHERE time_updated > ? OR (time_updated = ? AND rowid > ?)
      ORDER BY time_updated ASC, rowid ASC
    `).all(this.messageCursor.updatedAt, this.messageCursor.updatedAt, this.messageCursor.rowId) as OpenCodeMessageRow[];

    for (const row of rows) {
      this.messageCursor = { updatedAt: row.time_updated, rowId: row.rowid };
      const data = safeParseJson<OpenCodeMessageData>(row.data);
      if (!data) continue;

      const agentName = normalizeAgentName(data.agent);
      const session = this.getOrCreateSession(row.session_id, {
        agentName,
        modelId: asNonEmptyString(data.modelID) ?? asNonEmptyString(data.model?.modelID),
        providerId: asNonEmptyString(data.providerID) ?? asNonEmptyString(data.model?.providerID),
        directory: asNonEmptyString(data.path?.cwd),
      });

      const previous = this.messages.get(row.id);
      const meta: OpenCodeMessageMeta = {
        id: row.id,
        sessionId: row.session_id,
        role: data.role,
        agentName,
        modelId: asNonEmptyString(data.modelID) ?? asNonEmptyString(data.model?.modelID),
        providerId: asNonEmptyString(data.providerID) ?? asNonEmptyString(data.model?.providerID),
        cwd: asNonEmptyString(data.path?.cwd),
        createdAtMs: data.time?.created ?? row.time_created,
        updatedAtMs: row.time_updated,
        completedAtMs: data.time?.completed,
        userInputEmitted: previous?.userInputEmitted ?? false,
        llmEmissionVersion: previous?.llmEmissionVersion,
      };
      this.messages.set(row.id, meta);

      const messageTs = toIsoFromMs(meta.createdAtMs);
      this.emitSessionStartIfNeeded(session, messageTs, 'message', {
        title: session.title,
        directory: session.directory,
        session_slug: session.slug,
      }, row.rowid, row.id);

      if (data.role === 'user' && !meta.userInputEmitted) {
        const preview = extractUserPreview(data, session.title);
        this.emitEvent({
          ts: messageTs,
          source: 'opencode',
          agent_id: session.agentId,
          agent_name: session.agentName ?? 'OpenCode',
          session_id: session.sessionId,
          model_id: session.modelId,
          runtime: OPENCODE_RUNTIME,
          project_id: session.directory,
          type: 'user.input',
          data: {
            input_preview: preview,
            input_length: preview?.length,
            role: 'user',
            title: session.title,
          },
          provenance: {
            collector: this.name,
            ingestion_kind: 'sqlite',
            source_path: this.dbPath,
            source_offset: row.rowid,
            raw_event_type: 'message.user',
            source_event_id: row.id,
            transport: 'poll',
          },
        });
        meta.userInputEmitted = true;
      }

      if (data.role === 'assistant' && meta.completedAtMs) {
        this.emitAssistantTextIfReady(db, session, meta, row.rowid);
      }
    }
  }

  private pollParts(db: Database.Database): void {
    const rows = db.prepare(`
      SELECT rowid, id, message_id, session_id, time_created, time_updated, data
      FROM part
      WHERE time_updated > ? OR (time_updated = ? AND rowid > ?)
      ORDER BY time_updated ASC, rowid ASC
    `).all(this.partCursor.updatedAt, this.partCursor.updatedAt, this.partCursor.rowId) as OpenCodePartRow[];

    for (const row of rows) {
      this.partCursor = { updatedAt: row.time_updated, rowId: row.rowid };
      const data = safeParseJson<OpenCodePartData>(row.data);
      if (!data?.type) continue;

      const previousVersion = this.partVersions.get(row.id);
      if (previousVersion === row.time_updated) continue;
      const isFirstObservation = previousVersion === undefined;
      this.partVersions.set(row.id, row.time_updated);

      const message = this.getMessageMeta(db, row.message_id);
      const session = this.getOrCreateSession(row.session_id, {
        agentName: message?.agentName,
        modelId: message?.modelId,
        providerId: message?.providerId,
        directory: message?.cwd,
      });

      const ts = toIsoFromMs(row.time_updated || row.time_created);
      this.emitSessionStartIfNeeded(session, ts, 'part', {
        title: session.title,
        directory: session.directory,
        session_slug: session.slug,
      }, row.rowid, row.id);

      switch (data.type) {
        case 'step-start':
          if (isFirstObservation) {
            this.emitEvent({
              ts,
              source: 'opencode',
              agent_id: session.agentId,
              agent_name: session.agentName ?? 'OpenCode',
              session_id: session.sessionId,
              model_id: session.modelId,
              runtime: OPENCODE_RUNTIME,
              span_id: row.message_id,
              project_id: session.directory,
              type: 'agent.status',
              data: {
                status: 'thinking',
                status_detail: 'step-start',
              },
              provenance: {
                collector: this.name,
                ingestion_kind: 'sqlite',
                source_path: this.dbPath,
                source_offset: row.rowid,
                raw_event_type: 'part.step-start',
                source_event_id: row.id,
                transport: 'poll',
              },
            });
          }
          break;

        case 'reasoning':
          this.emitEvent({
            ts,
            source: 'opencode',
            agent_id: session.agentId,
            agent_name: session.agentName ?? 'OpenCode',
            session_id: session.sessionId,
            model_id: session.modelId,
            runtime: OPENCODE_RUNTIME,
            span_id: row.message_id,
            project_id: session.directory,
            type: 'agent.status',
            data: {
              status: 'thinking',
              status_detail: extractFirstMeaningfulLine(data.text) ?? 'reasoning',
            },
            provenance: {
              collector: this.name,
              ingestion_kind: 'sqlite',
              source_path: this.dbPath,
              source_offset: row.rowid,
              raw_event_type: 'part.reasoning',
              source_event_id: row.id,
              transport: 'poll',
            },
          });
          break;

        case 'tool':
          this.emitToolEvents(session, row, data, ts);
          break;

        case 'text':
          this.emitAssistantTextIfReady(db, session, message, row.rowid, row, data);
          break;

        case 'step-finish':
          this.emitStepFinishEvents(session, row, data, ts);
          break;

        case 'file': {
          const preview = asNonEmptyString(data.source?.path) ?? asNonEmptyString(data.filename) ?? asNonEmptyString(data.url);
          this.emitEvent({
            ts,
            source: 'opencode',
            agent_id: session.agentId,
            agent_name: session.agentName ?? 'OpenCode',
            session_id: session.sessionId,
            model_id: session.modelId,
            runtime: OPENCODE_RUNTIME,
            project_id: session.directory,
            type: 'user.input',
            data: {
              input_preview: preview,
              input_length: preview?.length ?? 0,
              role: 'attachment',
            },
            provenance: {
              collector: this.name,
              ingestion_kind: 'sqlite',
              source_path: this.dbPath,
              source_offset: row.rowid,
              raw_event_type: 'part.file',
              source_event_id: row.id,
              transport: 'poll',
            },
          });
          break;
        }

        case 'compaction':
          this.emitEvent({
            ts,
            source: 'opencode',
            agent_id: session.agentId,
            agent_name: session.agentName ?? 'OpenCode',
            session_id: session.sessionId,
            model_id: session.modelId,
            runtime: OPENCODE_RUNTIME,
            project_id: session.directory,
            type: 'agent.status',
            data: {
              status: 'thinking',
              status_detail: data.auto ? 'compaction:auto' : 'compaction',
              overflow: data.overflow ?? false,
            },
            provenance: {
              collector: this.name,
              ingestion_kind: 'sqlite',
              source_path: this.dbPath,
              source_offset: row.rowid,
              raw_event_type: 'part.compaction',
              source_event_id: row.id,
              transport: 'poll',
            },
          });
          break;

        default:
          break;
      }
    }
  }

  private emitAssistantTextIfReady(
    db: Database.Database,
    session: OpenCodeSessionMeta,
    message: OpenCodeMessageMeta | undefined,
    sourceOffset: number,
    partRow?: OpenCodePartRow,
    partData?: OpenCodePartData,
  ): void {
    if (!message || message.role !== 'assistant' || !message.completedAtMs) return;

    let resolvedPart = partRow;
    let resolvedData = partData;
    if (!resolvedPart || !resolvedData) {
      const row = db.prepare(`
        SELECT rowid, id, message_id, session_id, time_created, time_updated, data
        FROM part
        WHERE message_id = ?
          AND json_extract(data, '$.type') = 'text'
        ORDER BY time_updated DESC, rowid DESC
        LIMIT 1
      `).get(message.id) as OpenCodePartRow | undefined;
      if (!row) return;
      const data = safeParseJson<OpenCodePartData>(row.data);
      if (!data) return;
      resolvedPart = row;
      resolvedData = data;
    }

    const versionKey = `${resolvedPart.id}:${resolvedPart.time_updated}`;
    if (message.llmEmissionVersion === versionKey) return;

    message.llmEmissionVersion = versionKey;
    this.emitEvent({
      ts: toIsoFromMs(message.completedAtMs),
      source: 'opencode',
      agent_id: session.agentId,
      agent_name: session.agentName ?? 'OpenCode',
      session_id: session.sessionId,
      model_id: session.modelId,
      runtime: OPENCODE_RUNTIME,
      span_id: message.id,
      project_id: session.directory,
      type: 'llm.end',
      data: {
        text_preview: extractFirstMeaningfulLine(resolvedData.text),
        text_length: typeof resolvedData.text === 'string' ? resolvedData.text.length : 0,
        provider_id: session.providerId,
      },
      provenance: {
        collector: this.name,
        ingestion_kind: 'sqlite',
        source_path: this.dbPath,
        source_offset: resolvedPart.rowid ?? sourceOffset,
        raw_event_type: 'part.text',
        source_event_id: resolvedPart.id,
        transport: 'poll',
      },
    });
  }

  private emitToolEvents(
    session: OpenCodeSessionMeta,
    row: OpenCodePartRow,
    data: OpenCodePartData,
    ts: string,
  ): void {
    const toolName = asNonEmptyString(data.tool) ?? 'unknown';
    const callId = asNonEmptyString(data.callID) ?? row.id;
    const inputSummary = summarizeToolInput(data.state?.input);
    const toolState = this.toolStates.get(row.id) ?? { started: false };

    if (!toolState.started) {
      this.emitEvent({
        ts,
        source: 'opencode',
        agent_id: session.agentId,
        agent_name: session.agentName ?? 'OpenCode',
        session_id: session.sessionId,
        model_id: session.modelId,
        runtime: OPENCODE_RUNTIME,
        span_id: callId,
        project_id: session.directory,
        type: 'tool.start',
        data: {
          tool_name: toolName,
          tool_category: getToolCategory(toolName),
          input_summary: inputSummary,
          status_detail: inputSummary,
        },
        provenance: {
          collector: this.name,
          ingestion_kind: 'sqlite',
          source_path: this.dbPath,
          source_offset: row.rowid,
          raw_event_type: 'part.tool',
          source_event_id: row.id,
          transport: 'poll',
        },
      });
      toolState.started = true;
    }

    const rawStatus = asNonEmptyString(data.state?.status)?.toLowerCase();
    const error = asNonEmptyString(data.state?.error);
    const terminalState = rawStatus === 'completed'
      ? 'completed'
      : (rawStatus === 'error' || error ? 'error' : undefined);

    if (!terminalState || toolState.terminal === terminalState) {
      this.toolStates.set(row.id, toolState);
      return;
    }

    this.emitEvent({
      ts,
      source: 'opencode',
      agent_id: session.agentId,
      agent_name: session.agentName ?? 'OpenCode',
      session_id: session.sessionId,
      model_id: session.modelId,
      runtime: OPENCODE_RUNTIME,
      span_id: callId,
      project_id: session.directory,
      type: terminalState === 'completed' ? 'tool.end' : 'tool.error',
      data: {
        tool_name: toolName,
        tool_category: getToolCategory(toolName),
        output_preview: summarizeToolOutput(data.state?.output),
        error,
      },
      provenance: {
        collector: this.name,
        ingestion_kind: 'sqlite',
        source_path: this.dbPath,
        source_offset: row.rowid,
        raw_event_type: terminalState === 'completed' ? 'part.tool.completed' : 'part.tool.error',
        source_event_id: row.id,
        transport: 'poll',
      },
    });

    toolState.terminal = terminalState;
    this.toolStates.set(row.id, toolState);
  }

  private emitStepFinishEvents(
    session: OpenCodeSessionMeta,
    row: OpenCodePartRow,
    data: OpenCodePartData,
    ts: string,
  ): void {
    const currentTotals = readTokenSnapshot(data.tokens, data.cost);
    const delta = diffTotals(session.lastTotals, currentTotals);
    session.lastTotals = currentTotals;

    if (
      delta.total > 0
      || delta.input > 0
      || delta.output > 0
      || delta.reasoning > 0
      || delta.cacheRead > 0
      || delta.cacheWrite > 0
      || delta.cost > 0
    ) {
      this.emitEvent({
        ts,
        source: 'opencode',
        agent_id: session.agentId,
        agent_name: session.agentName ?? 'OpenCode',
        session_id: session.sessionId,
        model_id: session.modelId,
        runtime: OPENCODE_RUNTIME,
        span_id: row.message_id,
        project_id: session.directory,
        type: 'metrics.usage',
        data: {
          tokens: delta.total,
          input_tokens: delta.input,
          output_tokens: delta.output,
          reasoning_tokens: delta.reasoning,
          cache_read_input_tokens: delta.cacheRead,
          cache_creation_input_tokens: delta.cacheWrite,
          cost: delta.cost,
          provider_id: session.providerId,
          model_id: session.modelId,
        },
        provenance: {
          collector: this.name,
          ingestion_kind: 'sqlite',
          source_path: this.dbPath,
          source_offset: row.rowid,
          raw_event_type: 'part.step-finish',
          source_event_id: row.id,
          transport: 'poll',
        },
      });
    }

    this.emitEvent({
      ts,
      source: 'opencode',
      agent_id: session.agentId,
      agent_name: session.agentName ?? 'OpenCode',
      session_id: session.sessionId,
      model_id: session.modelId,
      runtime: OPENCODE_RUNTIME,
      span_id: row.message_id,
      project_id: session.directory,
      type: 'agent.status',
      data: {
        status: 'idle',
        status_detail: asNonEmptyString(data.reason) ?? 'step-finish',
      },
      provenance: {
        collector: this.name,
        ingestion_kind: 'sqlite',
        source_path: this.dbPath,
        source_offset: row.rowid,
        raw_event_type: 'part.step-finish',
        source_event_id: row.id,
        transport: 'poll',
      },
    });
  }

  private getMessageMeta(db: Database.Database, messageId: string): OpenCodeMessageMeta | undefined {
    const existing = this.messages.get(messageId);
    if (existing) return existing;

    const row = db.prepare(`
      SELECT rowid, id, session_id, time_created, time_updated, data
      FROM message
      WHERE id = ?
      LIMIT 1
    `).get(messageId) as OpenCodeMessageRow | undefined;
    if (!row) return undefined;

    const data = safeParseJson<OpenCodeMessageData>(row.data);
    if (!data) return undefined;

    const meta: OpenCodeMessageMeta = {
      id: row.id,
      sessionId: row.session_id,
      role: data.role,
      agentName: normalizeAgentName(data.agent),
      modelId: asNonEmptyString(data.modelID) ?? asNonEmptyString(data.model?.modelID),
      providerId: asNonEmptyString(data.providerID) ?? asNonEmptyString(data.model?.providerID),
      cwd: asNonEmptyString(data.path?.cwd),
      createdAtMs: data.time?.created ?? row.time_created,
      updatedAtMs: row.time_updated,
      completedAtMs: data.time?.completed,
      userInputEmitted: false,
    };
    this.messages.set(messageId, meta);
    return meta;
  }

  private getSessionSeed(db: Database.Database, sessionId: string): {
    agentName?: string;
    modelId?: string;
    providerId?: string;
    cwd?: string;
  } | undefined {
    const row = db.prepare(`
      SELECT data
      FROM message
      WHERE session_id = ?
      ORDER BY rowid ASC
      LIMIT 1
    `).get(sessionId) as { data: string } | undefined;
    if (!row) return undefined;

    const data = safeParseJson<OpenCodeMessageData>(row.data);
    if (!data) return undefined;

    return {
      agentName: normalizeAgentName(data.agent),
      modelId: asNonEmptyString(data.modelID) ?? asNonEmptyString(data.model?.modelID),
      providerId: asNonEmptyString(data.providerID) ?? asNonEmptyString(data.model?.providerID),
      cwd: asNonEmptyString(data.path?.cwd),
    };
  }

  private getOrCreateSession(
    sessionId: string,
    patch: Partial<Omit<OpenCodeSessionMeta, 'sessionId' | 'agentId' | 'started' | 'archived' | 'subagentLinked' | 'lastTotals'>> & {
      agentId?: string;
    } = {},
  ): OpenCodeSessionMeta {
    let session = this.sessions.get(sessionId);
    if (!session) {
      const agentId = patch.agentId ?? this.sessionAgentIds.get(sessionId) ?? buildSyntheticAgentId(sessionId);
      session = {
        sessionId,
        agentId,
        agentName: patch.agentName,
        title: patch.title,
        slug: patch.slug,
        directory: patch.directory,
        opencodeProjectId: patch.opencodeProjectId,
        modelId: patch.modelId,
        providerId: patch.providerId,
        parentSessionId: patch.parentSessionId,
        parentAgentId: patch.parentAgentId,
        permission: patch.permission,
        started: false,
        archived: false,
        subagentLinked: false,
        lastTotals: emptyTotals(),
      };
      this.sessions.set(sessionId, session);
      this.sessionAgentIds.set(sessionId, agentId);
      return session;
    }

    if (patch.agentId && patch.agentId !== session.agentId && !session.started) {
      session.agentId = patch.agentId;
      this.sessionAgentIds.set(sessionId, patch.agentId);
    }
    session.agentName = patch.agentName ?? session.agentName;
    session.title = patch.title ?? session.title;
    session.slug = patch.slug ?? session.slug;
    session.directory = patch.directory ?? session.directory;
    session.opencodeProjectId = patch.opencodeProjectId ?? session.opencodeProjectId;
    session.modelId = patch.modelId ?? session.modelId;
    session.providerId = patch.providerId ?? session.providerId;
    session.parentSessionId = patch.parentSessionId ?? session.parentSessionId;
    session.parentAgentId = patch.parentAgentId ?? session.parentAgentId;
    session.permission = patch.permission ?? session.permission;

    return session;
  }

  private emitSessionStartIfNeeded(
    session: OpenCodeSessionMeta,
    ts: string,
    rawEventType: string,
    data: Record<string, unknown>,
    sourceOffset?: number,
    sourceEventId?: string,
  ): void {
    if (session.started) return;
    session.started = true;

    this.emitEvent({
      ts,
      source: 'opencode',
      agent_id: session.agentId,
      agent_name: session.agentName ?? 'OpenCode',
      session_id: session.sessionId,
      model_id: session.modelId,
      runtime: OPENCODE_RUNTIME,
      project_id: session.directory,
      type: 'session.start',
      data: {
        ...data,
        parent_agent_id: session.parentAgentId,
        provider_id: session.providerId,
      },
      provenance: {
        collector: this.name,
        ingestion_kind: rawEventType === 'session_index' ? 'state' : 'sqlite',
        source_path: rawEventType === 'session_index' ? this.sessionsIndexPath : this.dbPath,
        source_offset: sourceOffset,
        raw_event_type: rawEventType,
        source_event_id: sourceEventId ?? session.sessionId,
        transport: 'poll',
      },
    });
  }

  private emitEvent(event: Omit<UAEPEvent, 'event_id' | 'seq'>): void {
    const nextEvent: UAEPEvent = {
      ...event,
      event_id: generateEventId(),
      seq: ++this.seq,
    };

    for (const handler of this.handlers) {
      handler(nextEvent);
    }
  }
}
