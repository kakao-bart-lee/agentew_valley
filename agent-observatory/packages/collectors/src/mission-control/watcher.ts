import { watch, type FSWatcher } from 'chokidar';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { readFile } from 'node:fs/promises';
import { normalizeWatchPaths } from '../path-utils.js';

export interface TaskParsed {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  project?: string;
  goal_id?: string;
  assigned_to?: string;
  dependencies: string[];
  source_path: string;
  updated_at: number;
}

export interface GoalParsed {
  id: string;
  title: string;
  description?: string;
  level: number;
  parent_id?: string;
  status: 'planned' | 'active' | 'blocked' | 'done' | 'archived';
  source_path: string;
}

export interface MissionControlSnapshot {
  tasks: TaskParsed[];
  goals: GoalParsed[];
  task_source_paths: string[];
  goal_source_paths: string[];
}

export type TaskWatcherCallback = (tasks: TaskParsed[]) => void;
export type SnapshotWatcherCallback = (snapshot: MissionControlSnapshot) => void;

function normalizeTaskStatus(value: string | undefined, fallback: string): string {
  const normalized = (value ?? fallback).trim().toLowerCase().replace(/\s+/g, '_');
  if (normalized === 'todo') return 'inbox';
  if (normalized === 'started') return 'in_progress';
  return normalized || fallback;
}

function normalizeGoalStatus(value: string | undefined): GoalParsed['status'] {
  const normalized = (value ?? 'active').trim().toLowerCase().replace(/\s+/g, '_');
  if (normalized === 'completed') return 'done';
  if (normalized === 'in_progress') return 'active';
  if (normalized === 'cancelled') return 'archived';
  if (normalized === 'blocked') return 'blocked';
  if (normalized === 'planned') return 'planned';
  if (normalized === 'archived') return 'archived';
  if (normalized === 'done') return 'done';
  return 'active';
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'goal';
}

function extractDependencies(text: string): string[] {
  return Array.from(text.matchAll(/\bdepends:([A-Za-z0-9._-]+)/g), (match) => match[1] ?? '')
    .filter(Boolean);
}

function parseValue(block: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const match = block.match(new RegExp(`^-\\s*${label}\\s*:\\s*(.+)$`, 'im'));
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return undefined;
}

function stripInlineTags(value: string): string {
  return value
    .replace(/\bdepends:[A-Za-z0-9._-]+\b/g, ' ')
    .replace(/\bgoal:[A-Za-z0-9._-]+\b/g, ' ')
    .replace(/\bstatus:[A-Za-z_]+\b/gi, ' ')
    .replace(/(?:^|\s)#(low|medium|high|urgent|critical)\b/gi, ' ')
    .replace(/(?:^|\s)@([a-zA-Z0-9._-]+)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export class MissionControlWatcher {
  private watcher: FSWatcher | null = null;
  private readonly watchPaths: string[];
  private taskCallback: TaskWatcherCallback | null = null;
  private snapshotCallback: SnapshotWatcherCallback | null = null;
  private readonly tasksByPath = new Map<string, TaskParsed[]>();
  private readonly goalsByPath = new Map<string, GoalParsed[]>();

  constructor(watchPaths: string[]) {
    this.watchPaths = watchPaths;
  }

  onTasks(cb: TaskWatcherCallback): void {
    this.taskCallback = cb;
  }

  onSnapshot(cb: SnapshotWatcherCallback): void {
    this.snapshotCallback = cb;
  }

  async start(): Promise<void> {
    const targets = normalizeWatchPaths(this.watchPaths);

    this.watcher = watch(targets, {
      persistent: true,
      ignoreInitial: false,
      ignored: (filePath, stats) => this.shouldIgnore(filePath, stats),
    });

    this.watcher.on('add', (filePath: string) => {
      if (!this.isTargetFile(filePath)) return;
      void this.handleFile(filePath);
    });
    this.watcher.on('change', (filePath: string) => {
      if (!this.isTargetFile(filePath)) return;
      void this.handleFile(filePath);
    });
    this.watcher.on('unlink', (filePath: string) => {
      if (!this.isTargetFile(filePath)) return;
      this.handleRemove(filePath);
    });
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.tasksByPath.clear();
    this.goalsByPath.clear();
  }

  private async handleFile(filePath: string): Promise<void> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const kind = basename(filePath).toUpperCase();
      if (kind === 'GOALS.MD') {
        this.goalsByPath.set(filePath, this.parseGoalsMarkdown(content, filePath));
      } else {
        const tasks = this.parseTaskMarkdown(content, filePath);
        this.tasksByPath.set(filePath, tasks);
        this.taskCallback?.(tasks);
      }
      this.emitSnapshot();
    } catch (err) {
      console.warn(`[MC-Watcher] Failed to handle file ${filePath}:`, err);
    }
  }

  private handleRemove(filePath: string): void {
    this.tasksByPath.delete(filePath);
    this.goalsByPath.delete(filePath);
    this.emitSnapshot();
  }

  private emitSnapshot(): void {
    this.snapshotCallback?.({
      tasks: Array.from(this.tasksByPath.values()).flat(),
      goals: Array.from(this.goalsByPath.values()).flat(),
      task_source_paths: Array.from(this.tasksByPath.keys()),
      goal_source_paths: Array.from(this.goalsByPath.keys()),
    });
  }

  private isTargetFile(filePath: string): boolean {
    const kind = basename(filePath).toUpperCase();
    return kind === 'TASK.MD' || kind === 'GOALS.MD';
  }

  private shouldIgnore(filePath: string, stats?: { isFile(): boolean }): boolean {
    return stats?.isFile() === true && !this.isTargetFile(filePath);
  }

  private parseTaskMarkdown(content: string, filePath: string): TaskParsed[] {
    const cardTasks = this.parseTaskCards(content, filePath);
    const checkboxTasks = this.parseCheckboxTasks(content, filePath);
    const deduped = new Map<string, TaskParsed>();
    for (const task of [...cardTasks, ...checkboxTasks]) {
      deduped.set(task.id, task);
    }
    return Array.from(deduped.values());
  }

  private parseTaskCards(content: string, filePath: string): TaskParsed[] {
    const tasks: TaskParsed[] = [];
    const matches = Array.from(
      content.matchAll(/^###\s+([A-Za-z][A-Za-z0-9._-]*):\s*(.+)$/gm),
    );
    const now = Math.floor(Date.now() / 1000);

    for (const [index, match] of matches.entries()) {
      const id = match[1]?.trim();
      const rawTitle = match[2]?.trim();
      const start = match.index ?? 0;
      const end = matches[index + 1]?.index ?? content.length;
      if (!id || !rawTitle) {
        continue;
      }

      const block = content.slice(start, end);
      const projectMatch = rawTitle.match(/^\(([^)]+)\)\s*/);
      const project = projectMatch?.[1]?.trim() || parseValue(block, ['Project']);
      const titleSansProject = projectMatch
        ? rawTitle.slice(projectMatch[0].length).trim()
        : rawTitle;
      const owner = parseValue(block, ['Owner', 'Assignee']);
      const priority = (parseValue(block, ['Priority']) ?? titleSansProject.match(/#(low|medium|high|urgent|critical)\b/i)?.[1] ?? 'medium')
        .toLowerCase();
      const status = normalizeTaskStatus(
        parseValue(block, ['Status']) ?? titleSansProject.match(/\bstatus:([a-z_]+)\b/i)?.[1],
        'inbox',
      );
      const description = parseValue(block, ['Description', 'Goal \\(1 sentence\\)', 'Goal']);
      const goalId = parseValue(block, ['Goal ID']) ?? block.match(/\bgoal:([A-Za-z0-9._-]+)\b/i)?.[1];
      const dependencies = extractDependencies(block);

      tasks.push({
        id,
        title: stripInlineTags(titleSansProject),
        description,
        status,
        priority,
        project: project?.trim() || undefined,
        goal_id: goalId?.trim() || undefined,
        assigned_to: owner?.trim() || undefined,
        dependencies,
        source_path: filePath,
        updated_at: now,
      });
    }

    return tasks;
  }

  private parseCheckboxTasks(content: string, filePath: string): TaskParsed[] {
    const tasks: TaskParsed[] = [];
    const lines = content.split('\n');
    const now = Math.floor(Date.now() / 1000);

    for (const [index, line] of lines.entries()) {
      const taskMatch = line.match(/^\s*-\s*\[([ xX])\]\s*(.+)$/);
      if (!taskMatch) {
        continue;
      }

      const isDone = taskMatch[1].toLowerCase() === 'x';
      let rawTitle = taskMatch[2].trim();

      const projectMatch = rawTitle.match(/^\(([^)]+)\)\s*/);
      const project = projectMatch?.[1]?.trim() || undefined;
      if (projectMatch) {
        rawTitle = rawTitle.slice(projectMatch[0].length).trim();
      }

      const priorityMatch = rawTitle.match(/(?:^|\s)#(low|medium|high|urgent|critical)\b/i);
      const priority = priorityMatch ? priorityMatch[1].toLowerCase() : 'medium';
      rawTitle = rawTitle.replace(/(?:^|\s)#(low|medium|high|urgent|critical)\b/i, ' ').trim();

      const assigneeMatch = rawTitle.match(/(?:^|\s)@([a-zA-Z0-9._-]+)/);
      const assignee = assigneeMatch ? assigneeMatch[1] : undefined;
      rawTitle = rawTitle.replace(/(?:^|\s)@([a-zA-Z0-9._-]+)/, ' ').trim();

      const statusMatch = rawTitle.match(/(?:^|\s)status:([a-z_]+)/i);
      const status = normalizeTaskStatus(statusMatch?.[1], isDone ? 'done' : 'inbox');
      rawTitle = rawTitle.replace(/(?:^|\s)status:([a-z_]+)/i, ' ').trim();

      const goalId = rawTitle.match(/\bgoal:([A-Za-z0-9._-]+)\b/i)?.[1];
      const dependencies = extractDependencies(rawTitle);
      rawTitle = stripInlineTags(rawTitle);

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
        goal_id: goalId?.trim() || undefined,
        assigned_to: assignee,
        dependencies,
        source_path: filePath,
        updated_at: now,
      });
    }

    return tasks;
  }

  private parseGoalsMarkdown(content: string, filePath: string): GoalParsed[] {
    const goals: GoalParsed[] = [];
    const matches = Array.from(content.matchAll(/^(#{1,6})\s+(.+)$/gm));
    const stack: Array<{ depth: number; id: string }> = [];

    for (const [index, match] of matches.entries()) {
      const depth = match[1]?.length ?? 0;
      const rawHeading = match[2]?.trim() ?? '';
      if (!rawHeading || /^goals?$/i.test(rawHeading)) {
        continue;
      }

      const start = match.index ?? 0;
      const end = matches[index + 1]?.index ?? content.length;
      const block = content.slice(start, end);
      const explicitId = rawHeading.match(/^([A-Za-z][A-Za-z0-9._-]*):\s*(.+)$/);
      const title = explicitId ? explicitId[2].trim() : rawHeading;
      const id = explicitId?.[1]?.trim()
        ?? `${slugify(filePath)}-${slugify(title)}`;

      while (stack.length > 0 && stack[stack.length - 1]!.depth >= depth) {
        stack.pop();
      }

      const description = block
        .split('\n')
        .slice(1)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !/^status\s*:/i.test(line) && !/^-?\s*status\s*:/i.test(line))
        .slice(0, 2)
        .join(' ')
        .replace(/^- /g, '')
        || undefined;

      goals.push({
        id,
        title,
        description,
        level: Math.max(depth - 1, 0),
        parent_id: stack[stack.length - 1]?.id,
        status: normalizeGoalStatus(
          block.match(/^-?\s*status\s*:\s*(.+)$/im)?.[1],
        ),
        source_path: filePath,
      });

      stack.push({ depth, id });
    }

    return goals;
  }
}
