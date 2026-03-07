/**
 * AIS Worktree 파서 — /tmp/ais_workspaces/<DIR>/agent.log 파싱.
 *
 * ais-pulse/src/lib/ais-status.ts 로직을 Collector 패턴으로 이식.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ISSUE_PROMPT_PATTERN =
    /Resolve issue ([A-Z]+-\d+): (.+?)\. Instructions in WORKFLOW\.md/m;

const ANSI_ESCAPE_PATTERN =
    /[\u001B\u009B][[\]()#;?]*(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007|(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~])/g;

export type AisThinkingState = 'planning' | 'coding' | 'validating' | 'investigating';
export type AisSessionStatus = 'running' | 'attention';
export type AisAgentType = 'codex' | 'claude';

export interface AisWorktreeSession {
    sessionId: string;
    issueIdentifier: string;
    title: string;
    agent: AisAgentType;
    branchName: string | null;
    worktreePath: string;
    status: AisSessionStatus;
    thinkingState: AisThinkingState;
    currentTask: string;
    blockers: string[];
}

/** agent.log 전체 내용 → AisWorktreeSession. 파싱 불가 시 null. */
export function parseWorktreeSession(
    worktreePath: string,
    directoryName: string,
    logContent: string,
): AisWorktreeSession | null {
    const sanitized = stripAnsi(logContent);
    const lines = splitLines(sanitized);

    if (lines.length === 0) return null;

    const parsed = extractIssuePrompt(sanitized);
    const issueIdentifier = parsed?.issueIdentifier ?? directoryName;
    const title = parsed?.title ?? 'Agent session';
    const agent = inferAgent(logContent);
    const blockers = extractBlockers(lines);
    const thinkingState = inferThinkingState(lines, title);
    const currentTask = deriveCurrentTask(lines, title);

    return {
        sessionId: `ais-${directoryName}`,
        issueIdentifier,
        title,
        agent,
        branchName: readBranchName(worktreePath),
        worktreePath,
        status: blockers.length > 0 ? 'attention' : 'running',
        thinkingState,
        currentTask,
        blockers,
    };
}

export function stripAnsi(content: string): string {
    return content.replaceAll(ANSI_ESCAPE_PATTERN, '');
}

export function extractIssuePrompt(
    content: string,
): { issueIdentifier: string; title: string } | null {
    const match = ISSUE_PROMPT_PATTERN.exec(content);
    if (!match) return null;
    return { issueIdentifier: match[1], title: match[2].trim() };
}

export function inferAgent(logContents: string): AisAgentType {
    return /claude/i.test(logContents) ? 'claude' : 'codex';
}

export function inferThinkingState(
    logLines: string[],
    title: string,
): AisThinkingState {
    const meaningful = logLines.filter((l) => !isMetadataLine(l));
    const haystack = `${title}\n${meaningful.join('\n')}`.toLowerCase();

    if (/\b(validate|verification|review|test|qa)\b/.test(haystack)) return 'validating';
    if (/\b(plan|design|map|spec|schema|contract)\b/.test(haystack)) return 'planning';
    if (/\b(investigat\w*|debug|triage|inspect|root cause)\b/.test(haystack)) return 'investigating';
    return 'coding';
}

export function extractBlockers(logLines: string[]): string[] {
    return logLines
        .filter((line) => /(blocker|attention required|error:|failed|blocked)/i.test(line))
        .filter((line) => !line.trim().startsWith('{') && !line.trim().startsWith('[') && line.length < 500)
        .map((line) => {
            const cleaned = line
                .replace(/^(blocker|attention required|error|failed):\s*/i, '')
                .trim();
            return cleaned.length > 100 ? `${cleaned.slice(0, 100)}…` : cleaned;
        })
        .filter(Boolean)
        .slice(-3);
}

export function readBranchName(worktreePath: string): string | null {
    const gitFilePath = join(worktreePath, '.git');
    if (!existsSync(gitFilePath)) return null;

    try {
        const gitFile = readFileSync(gitFilePath, 'utf8');
        const gitDirMatch = /^gitdir:\s*(.+)\s*$/m.exec(gitFile);
        if (!gitDirMatch) return null;

        const headPath = join(gitDirMatch[1].trim(), 'HEAD');
        if (!existsSync(headPath)) return null;

        const head = readFileSync(headPath, 'utf8').trim();
        const refMatch = /^ref:\s+refs\/heads\/(.+)$/.exec(head);
        return refMatch ? refMatch[1] : head;
    } catch {
        return null;
    }
}

function deriveCurrentTask(logLines: string[], title: string): string {
    const candidate = [...logLines].reverse().find((l) => !isMetadataLine(l));
    return candidate ?? `Advancing ${title.replace(/^\[[^\]]+\]\s*/, '').toLowerCase()}.`;
}

function splitLines(content: string): string[] {
    const lines = content.replaceAll('\r\n', '\n').split('\n');
    while (lines.at(-1) === '') lines.pop();
    return lines;
}

function isMetadataLine(line: string): boolean {
    return (
        line.trim().length === 0 ||
        /^resolve issue /i.test(line) ||
        /^openai codex/i.test(line) ||
        /^claude code/i.test(line) ||
        /^(user|codex|claude)$/i.test(line)
    );
}
