import type {
  AdapterCapabilities,
  CollectOptions,
  ObservatoryAdapter,
  UAEPEvent,
} from '@agent-observatory/shared';
import { generateEventId } from '@agent-observatory/shared';
import type { Collector, CollectorConfig } from '../base.js';
import { MissionControlWatcher } from './watcher.js';

export interface MissionControlCollectorConfig extends CollectorConfig {
  /** Watch paths for TASK.md or other management files */
  watchPaths: string[];
}

export class MissionControlCollector implements Collector, ObservatoryAdapter {
  readonly name = 'MissionControlCollector';
  readonly type = 'mission_control';
  readonly sourceType = 'mission_control' as const;
  readonly capabilities: AdapterCapabilities = {
    costTracking: true,
    logStreaming: false,
    statusUpdates: true,
    goalParsing: true,
    taskSync: true,
  };

  private readonly watcher: MissionControlWatcher;
  private readonly config: MissionControlCollectorConfig;
  private handlers: Array<(event: UAEPEvent) => void> = [];

  constructor(config: MissionControlCollectorConfig) {
    this.config = config;
    this.watcher = new MissionControlWatcher(config.watchPaths);

    this.watcher.onTasks((tasks) => {
      for (const task of tasks) {
        // Task Sync
        this.emit({
          ts: new Date().toISOString(),
          event_id: generateEventId(),
          source: 'mission_control',
          agent_id: 'observatory',
          session_id: 'mission_control_sync',
          project_id: task.project,
          task_id: task.id,
          goal_id: task.goal_id,
          type: 'task.sync',
          data: task as unknown as Record<string, unknown>,
        });

        // Activity Log for Task Change (Only if not initial sync? For simplicity, log everything now)
        this.emit({
          ts: new Date().toISOString(),
          event_id: generateEventId(),
          source: 'mission_control',
          agent_id: 'observatory',
          session_id: 'mission_control_sync',
          project_id: task.project,
          task_id: task.id,
          goal_id: task.goal_id,
          type: 'activity.new',
          data: {
            id: generateEventId(),
            type: 'task_updated',
            entity_type: 'task',
            entity_id: task.id,
            actor: task.assigned_to || 'system',
            description: `Task "${task.title}" was synced (status: ${task.status})`,
            created_at: Math.floor(Date.now() / 1000),
          } as unknown as Record<string, unknown>,
        });
      }
    });

    this.watcher.onSnapshot((snapshot) => {
      this.emit({
        ts: new Date().toISOString(),
        event_id: generateEventId(),
        source: 'mission_control',
        agent_id: 'observatory',
        session_id: 'mission_control_sync',
        type: 'task.snapshot',
        data: {
          tasks: snapshot.tasks,
          source_paths: snapshot.task_source_paths,
        },
      });

      this.emit({
        ts: new Date().toISOString(),
        event_id: generateEventId(),
        source: 'mission_control',
        agent_id: 'observatory',
        session_id: 'mission_control_sync',
        type: 'goal.snapshot',
        data: {
          goals: snapshot.goals,
          source_paths: snapshot.goal_source_paths,
        },
      });
    });
  }

  onEvent(handler: (event: UAEPEvent) => void): void {
    this.handlers.push(handler);
  }

  async start(): Promise<void> {
    await this.watcher.start();
  }

  async collect(options: CollectOptions): Promise<void> {
    if (options.watchPaths && options.watchPaths.length > 0) {
      await this.start();
      return;
    }
    await this.start();
  }

  async stop(): Promise<void> {
    await this.watcher.stop();
    this.handlers = [];
  }

  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    if (this.config.watchPaths.length === 0) {
      return {
        ok: false,
        message: 'Mission Control adapter has no watch paths configured.',
      };
    }

    return {
      ok: true,
      message: `Watching ${this.config.watchPaths.length} Mission Control path(s).`,
    };
  }

  private emit(event: UAEPEvent): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }
}
