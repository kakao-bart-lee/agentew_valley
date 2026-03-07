/**
 * AISWorktreeCollector — /tmp/ais_workspaces/<DIR>/agent.log 수집기.
 *
 * AIS Pulse orchestrator가 생성한 워크트리 세션을 관찰하여
 * UAEPEvent로 변환한다.
 *
 * 이벤트 흐름:
 *   agent.log 발견 → session.start + agent.status
 *   agent.log 변경 → agent.status (상태 변화 시만 emit)
 *   디렉토리 제거  → session.end
 */

import { watch, type FSWatcher } from 'chokidar';
import { readFile, stat } from 'node:fs/promises';
import { dirname, basename } from 'node:path';
import type { UAEPEvent, AgentSourceType } from '@agent-observatory/shared';
import { generateEventId } from '@agent-observatory/shared';
import type { Collector, CollectorConfig } from '../base.js';
import { normalizeWatchPaths } from '../path-utils.js';
import { parseWorktreeSession, type AisWorktreeSession } from './parser.js';

export interface AISWorktreeCollectorConfig extends CollectorConfig {
    /** true면 기존 agent.log는 건너뛰고 신규 변화만 수집. 기본 false. */
    tailOnly?: boolean;
}

interface SessionState {
    session: AisWorktreeSession;
    lastStatus: string;
    lastTask: string;
    lastBlockerCount: number;
}

export class AISWorktreeCollector implements Collector {
    readonly name = 'AISWorktreeCollector';
    readonly sourceType: AgentSourceType = 'custom';

    private readonly config: AISWorktreeCollectorConfig;
    private watcher: FSWatcher | null = null;
    private handlers: Array<(event: UAEPEvent) => void> = [];
    /** logPath → SessionState */
    private sessions = new Map<string, SessionState>();

    constructor(config: AISWorktreeCollectorConfig) {
        this.config = config;
    }

    onEvent(handler: (event: UAEPEvent) => void): void {
        this.handlers.push(handler);
    }

    async start(): Promise<void> {
        const targets = normalizeWatchPaths(this.config.watchPaths);

        this.watcher = watch(targets, {
            persistent: true,
            ignoreInitial: false,
            usePolling: false,
            // agent.log 파일만 감시
            ignored: (_filePath: string, stats?: { isFile(): boolean }) =>
                stats?.isFile() === true && basename(_filePath) !== 'agent.log',
            depth: 2,
            awaitWriteFinish: {
                stabilityThreshold: 300,
                pollInterval: 100,
            },
        });

        this.watcher.on('add', (filePath: string) => {
            if (basename(filePath) !== 'agent.log') return;
            if (!this.config.tailOnly) {
                void this.handleLogFile(filePath, true);
            } else {
                // tailOnly: 컨텍스트만 초기화, 이벤트 미발행
                void this.skipInitial(filePath);
            }
        });

        this.watcher.on('change', (filePath: string) => {
            if (basename(filePath) !== 'agent.log') return;
            void this.handleLogFile(filePath, false);
        });

        this.watcher.on('unlink', (filePath: string) => {
            if (basename(filePath) !== 'agent.log') return;
            this.handleLogRemoved(filePath);
        });
    }

    async stop(): Promise<void> {
        if (this.watcher) {
            await this.watcher.close();
            this.watcher = null;
        }
        this.sessions.clear();
        this.handlers = [];
    }

    private emit(event: UAEPEvent): void {
        for (const handler of this.handlers) {
            handler(event);
        }
    }

    private worktreePathFromLog(logPath: string): string {
        return dirname(logPath);
    }

    private directoryNameFromLog(logPath: string): string {
        return basename(dirname(logPath));
    }

    /** tailOnly 모드: 초기 파일은 스킵하되 state는 초기화 */
    private async skipInitial(logPath: string): Promise<void> {
        try {
            const content = await readFile(logPath, 'utf8');
            const worktreePath = this.worktreePathFromLog(logPath);
            const dirName = this.directoryNameFromLog(logPath);
            const session = parseWorktreeSession(worktreePath, dirName, content);
            if (session) {
                this.sessions.set(logPath, {
                    session,
                    lastStatus: session.status,
                    lastTask: session.currentTask,
                    lastBlockerCount: session.blockers.length,
                });
            }
        } catch {
            // 파일 접근 실패 무시
        }
    }

    private async handleLogFile(logPath: string, isNew: boolean): Promise<void> {
        try {
            const content = await readFile(logPath, 'utf8');
            const fileStat = await stat(logPath);
            const worktreePath = this.worktreePathFromLog(logPath);
            const dirName = this.directoryNameFromLog(logPath);
            const session = parseWorktreeSession(worktreePath, dirName, content);

            if (!session) return;

            const existing = this.sessions.get(logPath);
            const now = fileStat.mtime.toISOString();
            const agentSource: AgentSourceType =
                session.agent === 'claude' ? 'claude_code' : 'codex';

            if (isNew || !existing) {
                // session.start
                this.emit({
                    ts: now,
                    event_id: generateEventId(),
                    source: agentSource,
                    agent_id: this.buildAgentId(session.issueIdentifier),
                    agent_name: session.title,
                    session_id: session.sessionId,
                    type: 'session.start',
                    task_context: {
                        issue_identifier: session.issueIdentifier,
                        title: session.title,
                        ...(session.branchName ? { status: session.branchName } : {}),
                    },
                    data: {
                        worktree_path: session.worktreePath,
                        branch_name: session.branchName,
                        agent_type: session.agent,
                        thinking_state: session.thinkingState,
                    },
                    provenance: {
                        collector: 'AISWorktreeCollector',
                        ingestion_kind: 'state',
                        source_path: logPath,
                    },
                });

                // 초기 agent.status
                this.emitAgentStatus(session, agentSource, now, logPath);

                this.sessions.set(logPath, {
                    session,
                    lastStatus: session.status,
                    lastTask: session.currentTask,
                    lastBlockerCount: session.blockers.length,
                });
            } else {
                // 변화 감지: status, task, blocker 중 하나라도 달라지면 emit
                const changed =
                    existing.lastStatus !== session.status ||
                    existing.lastTask !== session.currentTask ||
                    existing.lastBlockerCount !== session.blockers.length;

                if (changed) {
                    this.emitAgentStatus(session, agentSource, now, logPath);
                    this.sessions.set(logPath, {
                        session,
                        lastStatus: session.status,
                        lastTask: session.currentTask,
                        lastBlockerCount: session.blockers.length,
                    });
                }
            }
        } catch {
            // 파일 읽기 실패 무시
        }
    }

    private handleLogRemoved(logPath: string): void {
        const existing = this.sessions.get(logPath);
        if (!existing) return;

        const { session } = existing;
        const agentSource: AgentSourceType =
            session.agent === 'claude' ? 'claude_code' : 'codex';

        this.emit({
            ts: new Date().toISOString(),
            event_id: generateEventId(),
            source: agentSource,
            agent_id: this.buildAgentId(session.issueIdentifier),
            agent_name: session.title,
            session_id: session.sessionId,
            type: 'session.end',
            task_context: {
                issue_identifier: session.issueIdentifier,
                title: session.title,
            },
            data: { reason: 'directory_removed' },
            provenance: {
                collector: 'AISWorktreeCollector',
                ingestion_kind: 'state',
                source_path: logPath,
            },
        });

        this.sessions.delete(logPath);
    }

    private emitAgentStatus(
        session: AisWorktreeSession,
        agentSource: AgentSourceType,
        ts: string,
        logPath: string,
    ): void {
        // AIS 상태 → UAEP status 매핑
        const status =
            session.status === 'attention'
                ? 'waiting_permission'
                : session.thinkingState === 'planning' || session.thinkingState === 'investigating'
                  ? 'thinking'
                  : 'acting';

        this.emit({
            ts,
            event_id: generateEventId(),
            source: agentSource,
            agent_id: this.buildAgentId(session.issueIdentifier),
            agent_name: session.title,
            session_id: session.sessionId,
            type: 'agent.status',
            task_context: {
                issue_identifier: session.issueIdentifier,
                title: session.title,
            },
            data: {
                status,
                status_detail: session.currentTask,
                thinking_state: session.thinkingState,
                blockers: session.blockers,
                branch_name: session.branchName,
                worktree_path: session.worktreePath,
            },
            provenance: {
                collector: 'AISWorktreeCollector',
                ingestion_kind: 'state',
                source_path: logPath,
            },
        });
    }

    /** issueIdentifier 기반 agent_id 생성. 예: ENG-123 → ais-eng-123 */
    private buildAgentId(issueIdentifier: string): string {
        return `ais-${issueIdentifier.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    }
}

export type { AisWorktreeSession, AisThinkingState, AisAgentType } from './parser.js';
export { parseWorktreeSession, stripAnsi, extractIssuePrompt, extractBlockers, readBranchName } from './parser.js';
