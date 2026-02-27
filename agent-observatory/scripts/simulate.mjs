#!/usr/bin/env node
/**
 * Agent Observatory — 리얼타임 대시보드 시뮬레이터
 *
 * 실제 Claude Code JSONL 로그에서 도구 사용 패턴을 읽어
 * Observatory 서버에 주입하여 대시보드를 실시간으로 시연합니다.
 *
 * Usage:
 *   node scripts/simulate.mjs [--server http://localhost:3001] [--speed 2]
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

// ── 설정 ──────────────────────────────────────────────────────────────────

const API_BASE = process.env.OBSERVATORY_SERVER || 'http://localhost:3001';
const SPEED_FACTOR = parseFloat(process.env.SPEED || '3');  // 빠르게 재생
const MIN_TOOL_DELAY = 400;   // ms
const MAX_TOOL_DELAY = 2000;  // ms

// ── 에이전트 프로필 ────────────────────────────────────────────────────────

const AGENT_PROFILES = [
  {
    name: 'Claude Code (Main)',
    source: 'claude_code',
    color: '#f97316',
    persona: 'orchestrator',
  },
  {
    name: 'Claude Code (Refactoring)',
    source: 'claude_code',
    color: '#f97316',
    persona: 'refactorer',
  },
  {
    name: 'Claude Code (Test Writer)',
    source: 'claude_code',
    color: '#f97316',
    persona: 'tester',
  },
  {
    name: 'OpenClaw Agent',
    source: 'openclaw',
    color: '#8b5cf6',
    persona: 'analyzer',
  },
  {
    name: 'Claude Code (Architect)',
    source: 'claude_code',
    color: '#f97316',
    persona: 'architect',
  },
];

// ── 도구 카테고리 → 입력 요약 ──────────────────────────────────────────────

const TOOL_DESCRIPTIONS = {
  Read:      ['Reading source file...', 'Analyzing config...', 'Checking types...', 'Reviewing implementation...'],
  Write:     ['Writing new module...', 'Creating test file...', 'Generating schema...', 'Writing config...'],
  Edit:      ['Fixing bug in handler...', 'Refactoring component...', 'Updating types...', 'Adding validation...'],
  Bash:      ['Running tests...', 'Building project...', 'Installing deps...', 'Linting code...', 'Running migrations...'],
  Glob:      ['Searching TypeScript files...', 'Finding test files...', 'Locating configs...'],
  Grep:      ['Searching for imports...', 'Finding references...', 'Locating patterns...'],
  Task:      ['Spawning sub-agent...', 'Delegating research task...', 'Parallelizing work...'],
  TaskCreate: ['Planning next steps...', 'Breaking down feature...', 'Creating sub-tasks...'],
  TaskUpdate: ['Marking task complete...', 'Updating progress...', 'Logging status...'],
  Skill:     ['Loading skill...', 'Executing workflow...'],
  WebFetch:  ['Fetching documentation...', 'Reading API docs...'],
  WebSearch: ['Searching for examples...', 'Looking up patterns...'],
};

const TOOL_CATEGORIES = {
  Read:      'file_read',
  Write:     'file_write',
  Edit:      'file_write',
  Bash:      'command',
  Glob:      'file_read',
  Grep:      'search',
  Task:      'other',
  TaskCreate: 'planning',
  TaskUpdate: 'planning',
  Skill:     'other',
  WebFetch:  'web',
  WebSearch:  'web',
};

// ── JSONL 파싱 ─────────────────────────────────────────────────────────────

function loadToolSequencesFromJSONL() {
  const claudeDir = join(homedir(), '.claude', 'projects');
  const sequences = [];

  // 가장 활동적인 프로젝트 디렉토리 순으로 탐색
  let files = [];
  try {
    for (const proj of readdirSync(claudeDir)) {
      const projPath = join(claudeDir, proj);
      try {
        for (const f of readdirSync(projPath)) {
          if (f.endsWith('.jsonl')) {
            const fullPath = join(projPath, f);
            try {
              const size = statSync(fullPath).size;
              if (size > 5000) files.push({ path: fullPath, size });
            } catch {}
          }
        }
      } catch {}
    }
  } catch {}

  // 크기 순 정렬, 상위 10개 파일에서 시퀀스 추출
  files.sort((a, b) => b.size - a.size);
  files = files.slice(0, 10);

  for (const { path } of files) {
    const toolSeq = [];
    try {
      const lines = readFileSync(path, 'utf8').split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const d = JSON.parse(line);
          if (d.type === 'assistant') {
            for (const item of d.message?.content || []) {
              if (item.type === 'tool_use' && item.name) {
                const inputStr = JSON.stringify(item.input || {});
                toolSeq.push({
                  tool: item.name,
                  inputSummary: extractInputSummary(item.name, item.input || {}),
                });
              }
            }
          }
        } catch {}
      }
    } catch {}

    if (toolSeq.length >= 5) {
      sequences.push(toolSeq);
    }
  }

  return sequences;
}

function extractInputSummary(toolName, input) {
  if (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') {
    const p = input.file_path || input.path || '';
    if (p) return p.split('/').slice(-2).join('/');
  }
  if (toolName === 'Bash') {
    const cmd = input.command || '';
    return cmd.slice(0, 50).replace(/\n/g, ' ');
  }
  if (toolName === 'Glob') return input.pattern || '';
  if (toolName === 'Grep') return input.pattern || '';
  if (toolName === 'Task' || toolName === 'TaskCreate') {
    return (input.description || input.subject || '').slice(0, 60);
  }
  const descs = TOOL_DESCRIPTIONS[toolName] || [];
  return descs[Math.floor(Math.random() * descs.length)] || '';
}

// ── HTTP 이벤트 주입 ───────────────────────────────────────────────────────

async function injectEvent(payload) {
  const body = {
    event_id: `sim-${randomUUID()}`,
    ts: new Date().toISOString(),
    source: payload.source || 'claude_code',
    ...payload,
  };
  delete body.source_field;  // cleanup

  try {
    const res = await fetch(`${API_BASE}/api/v1/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`  ⚠ Event inject failed: HTTP ${res.status}`);
    }
  } catch (e) {
    console.error(`  ✗ Server connection error: ${e.message}`);
    process.exit(1);
  }
}

// ── 에이전트 시뮬레이션 ────────────────────────────────────────────────────

let totalEvents = 0;
let totalSessions = 0;

async function delay(ms) {
  return new Promise(r => setTimeout(r, ms / SPEED_FACTOR));
}

async function simulateAgent(profile, toolSequence, loopCount = 0) {
  const agentId = `sim-${profile.source}-${randomUUID().slice(0, 8)}`;
  const sessionId = `sess-${randomUUID().slice(0, 12)}`;
  const agentName = loopCount > 0
    ? `${profile.name} #${loopCount + 1}`
    : profile.name;

  console.log(`  🚀 [${agentName}] 세션 시작 (${toolSequence.length}개 도구)`);

  // session.start
  await injectEvent({
    type: 'session.start',
    agent_id: agentId,
    agent_name: agentName,
    session_id: sessionId,
    source: profile.source,
    data: { cwd: '/workspace/project' },
  });
  totalEvents++;
  totalSessions++;

  // 약간의 thinking 시간
  await delay(300 + Math.random() * 500);

  // 도구 시퀀스 재생
  for (const { tool, inputSummary } of toolSequence) {
    const spanId = randomUUID();
    const category = TOOL_CATEGORIES[tool] || 'other';
    const desc = inputSummary || (TOOL_DESCRIPTIONS[tool] || ['processing...'])[
      Math.floor(Math.random() * (TOOL_DESCRIPTIONS[tool]?.length || 1))
    ];

    // tool.start
    await injectEvent({
      type: 'tool.start',
      agent_id: agentId,
      session_id: sessionId,
      source: profile.source,
      span_id: spanId,
      data: {
        tool_name: tool,
        tool_category: category,
        tool_input_summary: desc.slice(0, 80),
      },
    });
    totalEvents++;

    const toolDuration = MIN_TOOL_DELAY + Math.random() * (MAX_TOOL_DELAY - MIN_TOOL_DELAY);
    await delay(toolDuration);

    // tool.end
    await injectEvent({
      type: 'tool.end',
      agent_id: agentId,
      session_id: sessionId,
      source: profile.source,
      span_id: spanId,
      data: { tool_name: tool, tool_category: category },
    });
    totalEvents++;

    // 가끔 thinking 상태 (tool 사이)
    if (Math.random() < 0.3) {
      await delay(200 + Math.random() * 400);
    }
  }

  // session.end
  await injectEvent({
    type: 'session.end',
    agent_id: agentId,
    session_id: sessionId,
    source: profile.source,
    data: {},
  });
  totalEvents++;

  console.log(`  ✅ [${agentName}] 세션 완료`);
  return { agentId, sessionId };
}

// ── 연속 시뮬레이션 루프 ───────────────────────────────────────────────────

async function runContinuousSimulation(toolSequences) {
  console.log(`\n📡 Observatory 서버: ${API_BASE}`);
  console.log(`⚡ 재생 속도: ${SPEED_FACTOR}x`);
  console.log(`📊 로드된 시퀀스: ${toolSequences.length}개\n`);

  // 서버 연결 확인
  try {
    const res = await fetch(`${API_BASE}/api/v1/config`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log('✓ 서버 연결 확인\n');
  } catch (e) {
    console.error(`✗ 서버 연결 실패: ${e.message}`);
    console.error(`  먼저 서버를 시작해주세요: PORT=3001 node packages/server/dist/index.js`);
    process.exit(1);
  }

  let round = 0;

  // Ctrl+C 처리
  process.on('SIGINT', () => {
    console.log(`\n\n🛑 시뮬레이션 종료`);
    console.log(`   총 세션: ${totalSessions}`);
    console.log(`   총 이벤트: ${totalEvents}`);
    process.exit(0);
  });

  while (true) {
    round++;
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🔄 라운드 ${round} — 에이전트 활동 시뮬레이션`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    // 이번 라운드에 활성화할 에이전트 수 (2~4개)
    const agentCount = 2 + Math.floor(Math.random() * 3);
    const selectedProfiles = AGENT_PROFILES
      .sort(() => Math.random() - 0.5)
      .slice(0, agentCount);

    // 각 에이전트에게 시퀀스 배분
    const agentTasks = selectedProfiles.map((profile, i) => {
      const seqIdx = (round * agentCount + i) % toolSequences.length;
      const seq = toolSequences[seqIdx];
      // 10~20개 도구로 잘라서 사용
      const len = 10 + Math.floor(Math.random() * 11);
      const start = Math.floor(Math.random() * Math.max(1, seq.length - len));
      const subSeq = seq.slice(start, start + len);
      return { profile, seq: subSeq };
    });

    // 에이전트들을 순차 시작하되, 겹치게 실행 (스태거드 시작)
    const promises = agentTasks.map(({ profile, seq }, i) => {
      return new Promise(async (resolve) => {
        // 에이전트마다 0~1.5초 랜덤 딜레이로 시작
        await delay(i * 500 + Math.random() * 500);
        try {
          await simulateAgent(profile, seq, round - 1);
        } catch (e) {
          console.warn(`  ⚠ ${profile.name}: ${e.message}`);
        }
        resolve();
      });
    });

    await Promise.all(promises);

    console.log(`\n📈 누적 통계 — 세션: ${totalSessions}, 이벤트: ${totalEvents}`);
    console.log(`   🌐 대시보드: http://localhost:5173`);

    // 라운드 사이 휴식 (3~6초)
    const pause = 3000 + Math.random() * 3000;
    console.log(`   ⏸  다음 라운드까지 ${(pause / SPEED_FACTOR / 1000).toFixed(1)}초 대기...\n`);
    await delay(pause);
  }
}

// ── 메인 ──────────────────────────────────────────────────────────────────

console.log('🔭 Agent Observatory Simulator');
console.log('================================\n');
console.log('📂 실제 Claude Code 세션 로그에서 도구 사용 패턴 로딩...');

let sequences = loadToolSequencesFromJSONL();

if (sequences.length === 0) {
  console.log('  ⚠ JSONL 파일 없음 — 기본 시퀀스 사용');
  // 기본 시퀀스 (JSONL 없을 때 fallback)
  sequences = [
    [
      { tool: 'Read', inputSummary: 'src/components/Dashboard.tsx' },
      { tool: 'Grep', inputSummary: 'useState.*agent' },
      { tool: 'Read', inputSummary: 'src/stores/agentStore.ts' },
      { tool: 'Edit', inputSummary: 'Adding real-time state sync' },
      { tool: 'Bash', inputSummary: 'pnpm test' },
      { tool: 'Read', inputSummary: 'src/hooks/useSocket.ts' },
      { tool: 'Edit', inputSummary: 'Fix WebSocket reconnect logic' },
      { tool: 'Write', inputSummary: 'src/__tests__/socket.test.ts' },
      { tool: 'Bash', inputSummary: 'pnpm build' },
    ],
    [
      { tool: 'Bash', inputSummary: 'git log --oneline -20' },
      { tool: 'Read', inputSummary: 'packages/server/src/app.ts' },
      { tool: 'Write', inputSummary: 'packages/server/src/delivery/collector-gateway.ts' },
      { tool: 'Edit', inputSummary: 'Add ACK handling' },
      { tool: 'Read', inputSummary: 'packages/shared/src/types/index.ts' },
      { tool: 'Edit', inputSummary: 'Update CollectorRegistration type' },
      { tool: 'Bash', inputSummary: 'pnpm -r test' },
      { tool: 'Bash', inputSummary: 'pnpm build:shared' },
    ],
  ];
}

console.log(`  ✓ ${sequences.length}개 시퀀스, 총 ${sequences.reduce((s, q) => s + q.length, 0)}개 도구 이벤트\n`);

runContinuousSimulation(sequences).catch(console.error);
