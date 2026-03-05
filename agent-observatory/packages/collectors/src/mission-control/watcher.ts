import { watch, type FSWatcher } from 'chokidar';
import { readFile } from 'node:fs/promises';
import { generateEventId } from '@agent-observatory/shared';

export interface TaskParsed {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  assigned_to?: string;
  updated_at: number;
}

export type TaskWatcherCallback = (tasks: TaskParsed[]) => void;

export class MissionControlWatcher {
  private watcher: FSWatcher | null = null;
  private readonly watchPaths: string[];
  private callback: TaskWatcherCallback | null = null;

  constructor(watchPaths: string[]) {
    this.watchPaths = watchPaths;
  }

  onTasks(cb: TaskWatcherCallback): void {
    this.callback = cb;
  }

  async start(): Promise<void> {
    const globs = this.watchPaths.map((p) =>
      p.endsWith('.md') ? p : `${p}/**/TASK.md`,
    );

    this.watcher = watch(globs, {
      persistent: true,
      ignoreInitial: false,
    });

    this.watcher.on('add', (filePath: string) => void this.handleFile(filePath));
    this.watcher.on('change', (filePath: string) => void this.handleFile(filePath));
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  private async handleFile(filePath: string): Promise<void> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const tasks = this.parseMarkdown(content);
      if (this.callback) {
        this.callback(tasks);
      }
    } catch (err) {
      console.warn(`[MC-Watcher] Failed to handle file ${filePath}:`, err);
    }
  }

  private parseMarkdown(content: string): TaskParsed[] {
    const tasks: TaskParsed[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      // Basic markdown task parser: - [ ] Title @assignee #priority status:done
      const taskMatch = line.match(/^\s*-\s*\[([ xX])\]\s*(.+)$/);
      if (taskMatch) {
        const isDone = taskMatch[1].toLowerCase() === 'x';
        let rawTitle = taskMatch[2];

        // Extract priority (#high, #medium, #low, #urgent)
        const priorityMatch = rawTitle.match(/#(\w+)/);
        const priority = priorityMatch ? priorityMatch[1] : 'medium';
        rawTitle = rawTitle.replace(/#\w+/, '').trim();

        // Extract assignee (@name)
        const assigneeMatch = rawTitle.match(/@(\w+)/);
        const assignee = assigneeMatch ? assigneeMatch[1] : undefined;
        rawTitle = rawTitle.replace(/@\w+/, '').trim();

        // Extract explicit status (status:in_progress)
        const statusMatch = rawTitle.match(/status:(\w+)/);
        let status = statusMatch ? statusMatch[1] : (isDone ? 'done' : 'inbox');
        rawTitle = rawTitle.replace(/status:\w+/, '').trim();

        // Generate a stable ID based on title for now (should be improved)
        const id = Buffer.from(rawTitle).toString('base64').slice(0, 16);

        tasks.push({
          id,
          title: rawTitle,
          status,
          priority,
          assigned_to: assignee,
          updated_at: Math.floor(Date.now() / 1000),
        });
      }
    }
    return tasks;
  }
}
