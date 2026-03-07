import { describe, it, expect } from 'vitest';
import {
    parseWorktreeSession,
    stripAnsi,
    extractIssuePrompt,
    extractBlockers,
    inferThinkingState,
    inferAgent,
    readBranchName,
} from '../ais-worktree/parser.js';

const ISSUE_LOG = `OpenAI Codex
Resolve issue ENG-123: Implement authentication middleware. Instructions in WORKFLOW.md
Planning the implementation approach for the authentication layer.
Writing middleware code for JWT validation.
`;

const BLOCKER_LOG = `Claude Code
Resolve issue ENG-456: Fix database migration. Instructions in WORKFLOW.md
Running migration scripts.
Error: connection refused to database host
Failed: migration rollback did not complete
`;

const ANSI_LOG = '\u001B[32mDone\u001B[0m \u001B[33mBuilding...\u001B[0m\nActual content line\n';

describe('parser — stripAnsi', () => {
    it('removes ANSI escape sequences', () => {
        const result = stripAnsi(ANSI_LOG);
        expect(result).not.toContain('\u001B');
        expect(result).toContain('Done');
        expect(result).toContain('Building...');
    });
});

describe('parser — extractIssuePrompt', () => {
    it('extracts issueIdentifier and title from log', () => {
        const result = extractIssuePrompt(ISSUE_LOG);
        expect(result).not.toBeNull();
        expect(result!.issueIdentifier).toBe('ENG-123');
        expect(result!.title).toBe('Implement authentication middleware');
    });

    it('returns null when no issue prompt found', () => {
        expect(extractIssuePrompt('just some log output')).toBeNull();
    });
});

describe('parser — inferAgent', () => {
    it('detects claude from log', () => {
        expect(inferAgent('Claude Code\nsome output')).toBe('claude');
    });

    it('detects codex from log (no claude mention)', () => {
        expect(inferAgent('OpenAI Codex\nsome output')).toBe('codex');
    });
});

describe('parser — inferThinkingState', () => {
    it('returns validating for test/review keywords', () => {
        const lines = ['Running test suite for authentication'];
        expect(inferThinkingState(lines, 'Fix auth')).toBe('validating');
    });

    it('returns planning for plan/design/spec keywords', () => {
        const lines = ['Planning the implementation approach'];
        expect(inferThinkingState(lines, 'New feature spec')).toBe('planning');
    });

    it('returns investigating for debug/investigate keywords', () => {
        const lines = ['Investigating root cause of the failure'];
        expect(inferThinkingState(lines, 'Debug issue')).toBe('investigating');
    });

    it('defaults to coding', () => {
        const lines = ['Writing the middleware code'];
        expect(inferThinkingState(lines, 'Implement feature')).toBe('coding');
    });
});

describe('parser — extractBlockers', () => {
    it('extracts error/failed lines as blockers', () => {
        const lines = BLOCKER_LOG.split('\n').filter(Boolean);
        const blockers = extractBlockers(lines);
        expect(blockers.length).toBeGreaterThan(0);
        expect(blockers.some((b) => b.includes('connection refused'))).toBe(true);
    });

    it('returns empty array when no blockers', () => {
        const lines = ['Writing code', 'Running tests', 'All good'];
        expect(extractBlockers(lines)).toHaveLength(0);
    });

    it('limits to 3 most recent blockers', () => {
        const lines = [
            'Error: first error',
            'Error: second error',
            'Error: third error',
            'Error: fourth error',
        ];
        expect(extractBlockers(lines)).toHaveLength(3);
    });

    it('truncates lines longer than 100 chars', () => {
        const longError = 'Error: ' + 'x'.repeat(200);
        const blockers = extractBlockers([longError]);
        expect(blockers[0].length).toBeLessThanOrEqual(101); // 100 + '…'
    });
});

describe('parser — parseWorktreeSession', () => {
    it('parses a full session from log content', () => {
        const session = parseWorktreeSession('/tmp/ais_workspaces/ENG-123', 'ENG-123', ISSUE_LOG);
        expect(session).not.toBeNull();
        expect(session!.issueIdentifier).toBe('ENG-123');
        expect(session!.title).toBe('Implement authentication middleware');
        expect(session!.agent).toBe('codex');
        expect(session!.sessionId).toBe('ais-ENG-123');
        expect(session!.status).toBe('running');
    });

    it('uses directory name as fallback when no issue prompt', () => {
        const log = 'Just some random agent output\nDoing work\n';
        const session = parseWorktreeSession('/tmp/ais_workspaces/my-session', 'my-session', log);
        expect(session).not.toBeNull();
        expect(session!.issueIdentifier).toBe('my-session');
    });

    it('returns null for empty log', () => {
        expect(parseWorktreeSession('/tmp/ais_workspaces/x', 'x', '')).toBeNull();
        expect(parseWorktreeSession('/tmp/ais_workspaces/x', 'x', '\n\n')).toBeNull();
    });

    it('sets status to attention when blockers present', () => {
        const session = parseWorktreeSession('/tmp/ais_workspaces/ENG-456', 'ENG-456', BLOCKER_LOG);
        expect(session).not.toBeNull();
        expect(session!.status).toBe('attention');
        expect(session!.blockers.length).toBeGreaterThan(0);
    });

    it('detects claude agent type', () => {
        const claudeLog = `Claude Code\nResolve issue ENG-789: Fix bug. Instructions in WORKFLOW.md\nWorking on it.\n`;
        const session = parseWorktreeSession('/tmp/ais_workspaces/ENG-789', 'ENG-789', claudeLog);
        expect(session!.agent).toBe('claude');
    });
});
