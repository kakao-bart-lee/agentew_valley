import { homedir } from 'node:os';
import { resolve } from 'node:path';

export function expandHomePath(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return resolve(homedir(), path.slice(2));
  return path;
}

export function normalizeWatchPaths(paths: string[]): string[] {
  return paths.map((path) => expandHomePath(path.trim())).filter(Boolean);
}
