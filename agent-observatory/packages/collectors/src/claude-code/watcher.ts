/**
 * Claude Code JSONL 파일 감시기.
 *
 * chokidar로 지정 경로 하위의 *.jsonl 파일을 감시하며,
 * tail 방식으로 새로 추가된 줄만 읽어 파싱한다.
 *
 * 오프셋 관리: 파일별 Map<filePath, byteOffset>으로 인메모리 보관.
 */

import { watch, type FSWatcher } from 'chokidar';
import { open, stat } from 'node:fs/promises';
import type { CCParsedRecord } from './parser.js';
import { parseLine } from './parser.js';
import { normalizeWatchPaths } from '../path-utils.js';

/** 파일 변경 시 콜백 */
export type WatcherCallback = (
  filePath: string,
  records: CCParsedRecord[],
  isNewFile: boolean,
) => void;

/** Watcher 설정 */
export interface WatcherConfig {
  /** 감시할 경로 목록 (glob 포함) */
  watchPaths: string[];
  /** 폴링 사용 여부 (NFS 등에서만 true) */
  usePolling?: boolean;
  /** true면 기존 파일은 끝 위치만 기록하고 건너뜀. 새 append분만 수집. 기본 false. */
  tailOnly?: boolean;
}

/**
 * Claude Code JSONL 파일 감시기.
 */
export class ClaudeCodeWatcher {
  private watcher: FSWatcher | null = null;
  private offsets = new Map<string, number>();
  private callback: WatcherCallback | null = null;
  private readonly config: WatcherConfig;

  constructor(config: WatcherConfig) {
    this.config = config;
  }

  /** 파일 변경 콜백 등록 */
  onRecords(cb: WatcherCallback): void {
    this.callback = cb;
  }

  /** 감시 시작 */
  async start(): Promise<void> {
    const targets = normalizeWatchPaths(this.config.watchPaths);

    this.watcher = watch(targets, {
      persistent: true,
      ignoreInitial: false,
      usePolling: this.config.usePolling ?? false,
      ignored: (filePath, stats) => this.shouldIgnore(filePath, stats),
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    this.watcher.on('add', (filePath: string) => {
      if (!this.isJsonlFile(filePath)) return;
      if (this.config.tailOnly) {
        void this.skipToEnd(filePath);
      } else {
        void this.handleFile(filePath, true);
      }
    });

    this.watcher.on('change', (filePath: string) => {
      if (!this.isJsonlFile(filePath)) return;
      void this.handleFile(filePath, false);
    });

    this.watcher.on('unlink', (filePath: string) => {
      if (!this.isJsonlFile(filePath)) return;
      this.offsets.delete(filePath);
    });
  }

  /** 감시 중지 */
  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.offsets.clear();
  }

  /**
   * 기존 파일의 끝 위치만 기록하고 내용은 읽지 않는다.
   * 이후 change 이벤트에서 새 append분만 처리된다.
   */
  private async skipToEnd(filePath: string): Promise<void> {
    try {
      const fileStat = await stat(filePath);
      this.offsets.set(filePath, fileStat.size);
    } catch {
      // 파일 접근 실패 무시
    }
  }

  /**
   * 파일을 오프셋 기반으로 tail 읽기하여 새 줄들을 파싱한다.
   */
  private async handleFile(
    filePath: string,
    isNewFile: boolean,
  ): Promise<void> {
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

      const text = buffer.toString('utf-8');
      const lines = text.split('\n');
      const records: CCParsedRecord[] = [];

      for (const line of lines) {
        const parsed = parseLine(line);
        records.push(...parsed);
      }

      if (this.callback && (records.length > 0 || isNewFile)) {
        this.callback(filePath, records, isNewFile);
      }
    } catch {
      // 파일 읽기 실패는 무시 (삭제된 파일 등)
    }
  }

  private isJsonlFile(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.jsonl');
  }

  private shouldIgnore(filePath: string, stats?: { isFile(): boolean }): boolean {
    return stats?.isFile() === true && !this.isJsonlFile(filePath);
  }
}
