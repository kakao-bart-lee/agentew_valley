import { watch, type FSWatcher } from 'chokidar';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export interface TaskParsed {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  project?: string;
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
      const tasks = this.parseMarkdown(content, filePath);
      if (this.callback) {
        this.callback(tasks);
      }
    } catch (err) {
      console.warn(`[MC-Watcher] Failed to handle file ${filePath}:`, err);
    }
  }

  private parseMarkdown(content: string, filePath: string): TaskParsed[] {
    const tasks: TaskParsed[] = [];
    const lines = content.split('\n');
    const now = Math.floor(Date.now() / 1000);

    for (const [index, line] of lines.entries()) {
      // Basic markdown task parser: - [ ] Title @assignee #priority status:done
      const taskMatch = line.match(/^\s*-\s*\[([ xX])\]\s*(.+)$/);
      if (taskMatch) {
        const isDone = taskMatch[1].toLowerCase() === 'x';
        let rawTitle = taskMatch[2].trim();

        const projectMatch = rawTitle.match(/^\(([^)]+)\)\s*/);
        const project = projectMatch?.[1]?.trim() || undefined;
        if (projectMatch) {
          rawTitle = rawTitle.slice(projectMatch[0].length).trim();
        }

        // Extract priority (#high, #medium, #low, #urgent)
        const priorityMatch = rawTitle.match(/(?:^|\s)#(low|medium|high|urgent|critical)\b/i);
        const priority = priorityMatch ? priorityMatch[1].toLowerCase() : 'medium';
        rawTitle = rawTitle.replace(/(?:^|\s)#(low|medium|high|urgent|critical)\b/i, ' ').trim();

        // Extract assignee (@name)
        const assigneeMatch = rawTitle.match(/(?:^|\s)@([a-zA-Z0-9._-]+)/);
        const assignee = assigneeMatch ? assigneeMatch[1] : undefined;
        rawTitle = rawTitle.replace(/(?:^|\s)@([a-zA-Z0-9._-]+)/, ' ').trim();

        // Extract explicit status (status:in_progress)
        const statusMatch = rawTitle.match(/(?:^|\s)status:([a-z_]+)/i);
        let status = statusMatch ? statusMatch[1] : (isDone ? 'done' : 'inbox');
        rawTitle = rawTitle.replace(/(?:^|\s)status:([a-z_]+)/i, ' ').trim();

        // File path + line number keeps IDs stable across syncs and avoids cross-file collisions.
        const id = createHash('sha1')
          .update(`${filePath}:${index + 1}:${project ?? ''}:${rawTitle}`)
          .digest('hex')
          .slice(0, 16);

        tasks.push({
          id,
          title: rawTitle,
          status,
          priority,
          project,
          assigned_to: assignee,
          updated_at: now,
        });
      }
    }
    return tasks;
  }
}
