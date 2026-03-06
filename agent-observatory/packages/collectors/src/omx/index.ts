import { watch, type FSWatcher } from 'chokidar';
import { open, readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Collector, CollectorConfig } from '../base.js';
import { normalizeWatchPaths } from '../path-utils.js';
import type { UAEPEvent } from '@agent-observatory/shared';
import { generateEventId } from '@agent-observatory/shared';

interface OMXSessionState {
  session_id?: string;
  started_at?: string;
  cwd?: string;
  pid?: number;
  platform?: string;
}

interface OMXTeamState {
  active?: boolean;
  mode?: string;
  current_phase?: string;
  task_description?: string;
  team_name?: string;
  agent_count?: number;
  completed_at?: string;
}

type OMXLogRecord = Record<string, unknown> & {
  timestamp?: string;
  type?: string;
  event?: string;
  thread_id?: string;
  turn_id?: string;
  input_preview?: string;
  output_preview?: string;
};

export interface OMXCollectorConfig extends CollectorConfig {}

export class OMXCollector implements Collector {
  readonly name = 'OMXCollector';
  readonly sourceType = 'omx' as const;

  private readonly config: OMXCollectorConfig;
  private readonly handlers: Array<(event: UAEPEvent) => void> = [];
  private watcher: FSWatcher | null = null;
  private offsets = new Map<string, number>();
  private seenSessions = new Set<string>();
  private sessionState: OMXSessionState = {};
  private teamState: OMXTeamState = {};
  private seq = 0;

  constructor(config: OMXCollectorConfig) {
    this.config = config;
  }

  onEvent(handler: (event: UAEPEvent) => void): void {
    this.handlers.push(handler);
  }

  async start(): Promise<void> {
    const watchTargets = normalizeWatchPaths(this.config.watchPaths);

    this.watcher = watch(watchTargets, {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    this.watcher.on('add', (filePath) => void this.handlePath(filePath, true));
    this.watcher.on('change', (filePath) => void this.handlePath(filePath, false));
    this.watcher.on('unlink', (filePath) => {
      this.offsets.delete(filePath);
    });
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    this.offsets.clear();
    this.seenSessions.clear();
    this.handlers.length = 0;
  }

  private emit(event: UAEPEvent): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }

  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  private buildAgent(agentKey?: string, sessionId?: string): { agentId: string; agentName: string; sessionId: string } {
    const resolvedSessionId =
      sessionId ??
      this.sessionState.session_id ??
      (agentKey ? `omx-${agentKey}` : 'omx-session');
    const resolvedAgentId = agentKey ? `omx:${agentKey}` : `omx:${resolvedSessionId}`;
    const resolvedAgentName = this.teamState.active
      ? `OMX (${this.teamState.team_name ?? this.teamState.mode ?? 'team'})`
      : 'OMX';

    return {
      agentId: resolvedAgentId,
      agentName: resolvedAgentName,
      sessionId: resolvedSessionId,
    };
  }

  private ensureSessionStarted(
    sessionId: string,
    agentId: string,
    agentName: string,
    ts: string,
    data?: Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ): void {
    if (this.seenSessions.has(sessionId)) return;
    this.seenSessions.add(sessionId);
    this.emit({
      ts,
      seq: this.nextSeq(),
      event_id: generateEventId(),
      source: 'omx',
      agent_id: agentId,
      agent_name: agentName,
      session_id: sessionId,
      project_id: this.sessionState.cwd,
      type: 'session.start',
      data,
      metadata,
    });
  }

  private async handlePath(filePath: string, isNewFile: boolean): Promise<void> {
    const fileName = basename(filePath);

    if (fileName === 'session.json') {
      await this.handleSessionState(filePath);
      return;
    }

    if (fileName === 'team-state.json') {
      await this.handleTeamState(filePath);
      return;
    }

    if (!filePath.endsWith('.jsonl')) return;

    if (this.config.tailOnly && isNewFile) {
      await this.skipToEnd(filePath);
      return;
    }

    await this.handleLogFile(filePath);
  }

  private async skipToEnd(filePath: string): Promise<void> {
    try {
      const fileStat = await stat(filePath);
      this.offsets.set(filePath, fileStat.size);
    } catch {
      // ignore
    }
  }

  private async handleSessionState(filePath: string): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf-8')) as OMXSessionState;
      this.sessionState = parsed;
      const { agentId, agentName, sessionId } = this.buildAgent(parsed.session_id, parsed.session_id);
      const ts = parsed.started_at ?? new Date().toISOString();

      this.ensureSessionStarted(sessionId, agentId, agentName, ts, {
        cwd: parsed.cwd,
        pid: parsed.pid,
        platform: parsed.platform,
      });

      this.emit({
        ts: new Date().toISOString(),
        seq: this.nextSeq(),
        event_id: generateEventId(),
        source: 'omx',
        agent_id: agentId,
        agent_name: agentName,
        session_id: sessionId,
        project_id: parsed.cwd,
        type: 'agent.status',
        data: {
          status: 'idle',
        },
        metadata: {
          cwd: parsed.cwd,
          pid: parsed.pid,
          platform: parsed.platform,
          state_file: filePath,
        },
      });
    } catch {
      // ignore malformed session state
    }
  }

  private async handleTeamState(filePath: string): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf-8')) as OMXTeamState;
      this.teamState = parsed;
      const { agentId, agentName, sessionId } = this.buildAgent(parsed.team_name ?? parsed.mode, this.sessionState.session_id);
      const ts = new Date().toISOString();

      this.ensureSessionStarted(sessionId, agentId, agentName, ts, {
        team_name: parsed.team_name,
        mode: parsed.mode,
      });

      this.emit({
        ts,
        seq: this.nextSeq(),
        event_id: generateEventId(),
        source: 'omx',
        agent_id: agentId,
        agent_name: agentName,
        session_id: sessionId,
        project_id: this.sessionState.cwd,
        type: 'agent.status',
        data: {
          status: parsed.active ? 'acting' : 'idle',
        },
        metadata: {
          current_phase: parsed.current_phase,
          task_description: parsed.task_description,
          team_name: parsed.team_name,
          agent_count: parsed.agent_count,
          completed_at: parsed.completed_at,
          state_file: filePath,
        },
      });
    } catch {
      // ignore malformed team state
    }
  }

  private async handleLogFile(filePath: string): Promise<void> {
    try {
      const fileStat = await stat(filePath);
      const currentSize = fileStat.size;
      const offset = this.offsets.get(filePath) ?? 0;

      if (currentSize <= offset) return;

      const bytesToRead = currentSize - offset;
      const buffer = Buffer.alloc(bytesToRead);

      const fh = await open(filePath, 'r');
      try {
        await fh.read(buffer, 0, bytesToRead, offset);
      } finally {
        await fh.close();
      }

      this.offsets.set(filePath, currentSize);

      const lines = buffer.toString('utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        let record: OMXLogRecord;
        try {
          record = JSON.parse(line) as OMXLogRecord;
        } catch {
          continue;
        }

        if (basename(filePath).startsWith('hooks-')) {
          this.emitHookRecord(record, filePath);
        } else if (basename(filePath).startsWith('turns-')) {
          this.emitTurnRecord(record, filePath);
        }
      }
    } catch {
      // ignore transient read errors
    }
  }

  private emitHookRecord(record: OMXLogRecord, filePath: string): void {
    const ts = typeof record.timestamp === 'string' ? record.timestamp : new Date().toISOString();
    const { agentId, agentName, sessionId } = this.buildAgent(undefined, this.sessionState.session_id);

    this.ensureSessionStarted(sessionId, agentId, agentName, ts, { file_path: filePath }, { hook_event: record.event });

    if (record.event === 'session-start') {
      return;
    }

    if (record.event === 'session-idle' || record.event === 'turn-complete') {
      this.emit({
        ts,
        seq: this.nextSeq(),
        event_id: generateEventId(),
        source: 'omx',
        agent_id: agentId,
        agent_name: agentName,
        session_id: sessionId,
        project_id: this.sessionState.cwd,
        type: 'agent.status',
        data: {
          status: 'idle',
        },
        metadata: {
          hook_event: record.event,
          file_path: filePath,
        },
      });
    }
  }

  private emitTurnRecord(record: OMXLogRecord, filePath: string): void {
    const ts = typeof record.timestamp === 'string' ? record.timestamp : new Date().toISOString();
    const sessionKey =
      typeof record.thread_id === 'string'
        ? record.thread_id
        : this.sessionState.session_id;
    const { agentId, agentName, sessionId } = this.buildAgent(sessionKey, sessionKey);

    this.ensureSessionStarted(sessionId, agentId, agentName, ts, { file_path: filePath }, {
      log_type: record.type,
      thread_id: record.thread_id,
    });

    if (typeof record.input_preview === 'string' && record.input_preview.length > 0) {
      this.emit({
        ts,
        seq: this.nextSeq(),
        event_id: generateEventId(),
        source: 'omx',
        agent_id: agentId,
        agent_name: agentName,
        session_id: sessionId,
        project_id: this.sessionState.cwd,
        type: 'user.input',
        data: {
          input_preview: record.input_preview,
        },
        metadata: {
          file_path: filePath,
          turn_id: record.turn_id,
          thread_id: record.thread_id,
          log_type: record.type,
        },
      });
    }

    if (typeof record.output_preview === 'string' && record.output_preview.length > 0) {
      this.emit({
        ts,
        seq: this.nextSeq(),
        event_id: generateEventId(),
        source: 'omx',
        agent_id: agentId,
        agent_name: agentName,
        session_id: sessionId,
        project_id: this.sessionState.cwd,
        type: 'llm.end',
        data: {
          text_length: record.output_preview.length,
          output_preview: record.output_preview,
        },
        metadata: {
          file_path: filePath,
          turn_id: record.turn_id,
          thread_id: record.thread_id,
          log_type: record.type,
        },
      });
    }
  }
}
