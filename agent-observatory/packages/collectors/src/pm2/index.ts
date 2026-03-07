import { execSync } from 'node:child_process';
import type { Collector } from '../base.js';
import type { UAEPEvent } from '@agent-observatory/shared';
import { generateEventId } from '@agent-observatory/shared';

interface Pm2ProcessInfo {
  pm_id: number;
  name: string;
  pm2_env: {
    status: string;
    restart_time: number;
    pm_uptime?: number;
    created_at?: number;
  };
}

interface Pm2ProcessSnapshot {
  status: string;
  restartCount: number;
}

export interface Pm2CollectorConfig {
  /** 폴링 간격 (ms). 기본 5000. */
  pollIntervalMs?: number;
}

export class Pm2Collector implements Collector {
  readonly name = 'Pm2Collector';
  readonly sourceType = 'pm2' as const;

  private readonly pollIntervalMs: number;
  private readonly handlers: Array<(event: UAEPEvent) => void> = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private snapshots = new Map<string, Pm2ProcessSnapshot>();
  private seq = 0;

  constructor(config: Pm2CollectorConfig = {}) {
    this.pollIntervalMs = config.pollIntervalMs ?? 5000;
  }

  onEvent(handler: (event: UAEPEvent) => void): void {
    this.handlers.push(handler);
  }

  async start(): Promise<void> {
    // 즉시 한 번 폴링 후 인터벌 시작
    this.poll();
    this.timer = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.snapshots.clear();
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

  private poll(): void {
    let processes: Pm2ProcessInfo[];
    try {
      const output = execSync('pm2 jlist', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      processes = JSON.parse(output) as Pm2ProcessInfo[];
    } catch {
      // pm2 not installed or not running — silently skip
      return;
    }

    const ts = new Date().toISOString();
    const seenKeys = new Set<string>();

    for (const proc of processes) {
      const key = `pm2:${proc.name}:${proc.pm_id}`;
      seenKeys.add(key);

      const agentId = key;
      const agentName = proc.name;
      const sessionId = key;
      const status = proc.pm2_env.status;
      const restartCount = proc.pm2_env.restart_time;

      const prev = this.snapshots.get(key);

      if (!prev) {
        // 새로 발견된 프로세스
        this.snapshots.set(key, { status, restartCount });

        const eventType = status === 'online' ? 'session.start' : 'session.end';
        this.emit({
          ts,
          seq: this.nextSeq(),
          event_id: generateEventId(),
          source: 'pm2',
          agent_id: agentId,
          agent_name: agentName,
          session_id: sessionId,
          type: eventType,
          data: {
            pm2_status: status,
            pm2_id: proc.pm_id,
            restart_time: restartCount,
          },
          metadata: {
            pm2_uptime: proc.pm2_env.pm_uptime,
            pm2_created_at: proc.pm2_env.created_at,
          },
        });
        continue;
      }

      // 상태 변화 감지
      if (prev.status !== status) {
        this.snapshots.set(key, { ...prev, status });

        const eventType = status === 'online' ? 'session.start' : 'session.end';
        this.emit({
          ts,
          seq: this.nextSeq(),
          event_id: generateEventId(),
          source: 'pm2',
          agent_id: agentId,
          agent_name: agentName,
          session_id: sessionId,
          type: eventType,
          data: {
            pm2_status: status,
            pm2_status_prev: prev.status,
            pm2_id: proc.pm_id,
            restart_time: restartCount,
          },
        });
      }

      // 재시작 감지
      if (restartCount > prev.restartCount) {
        this.snapshots.set(key, { ...this.snapshots.get(key)!, restartCount });

        this.emit({
          ts,
          seq: this.nextSeq(),
          event_id: generateEventId(),
          source: 'pm2',
          agent_id: agentId,
          agent_name: agentName,
          session_id: sessionId,
          type: 'tool.start',
          data: {
            tool_name: 'pm2_restart',
            pm2_status: status,
            pm2_id: proc.pm_id,
            restart_time: restartCount,
            restart_delta: restartCount - prev.restartCount,
          },
        });
      }
    }

    // 사라진 프로세스 처리
    for (const [key, prev] of this.snapshots) {
      if (!seenKeys.has(key)) {
        this.snapshots.delete(key);
        const parts = key.split(':');
        const agentId = key;
        const agentName = parts[1] ?? key;
        const sessionId = key;

        if (prev.status === 'online') {
          this.emit({
            ts,
            seq: this.nextSeq(),
            event_id: generateEventId(),
            source: 'pm2',
            agent_id: agentId,
            agent_name: agentName,
            session_id: sessionId,
            type: 'session.end',
            data: {
              pm2_status: 'deleted',
            },
          });
        }
      }
    }
  }
}
