#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const dbPath = process.env.OBSERVATORY_DB_PATH || path.join(process.cwd(), 'tmp', 'observatory-dummy.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT UNIQUE NOT NULL,
    ts TEXT NOT NULL,
    type TEXT NOT NULL,
    source TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    span_id TEXT,
    parent_span_id TEXT,
    team_id TEXT,
    data TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    source TEXT NOT NULL,
    team_id TEXT,
    project_id TEXT,
    model_id TEXT,
    start_time TEXT NOT NULL,
    end_time TEXT,
    total_events INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    total_cost_usd REAL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'inbox',
    priority TEXT DEFAULT 'medium',
    project TEXT,
    assigned_to TEXT,
    checkout_agent_id TEXT,
    checkout_at INTEGER,
    created_by TEXT,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    updated_at INTEGER NOT NULL,
    due_date INTEGER,
    tags TEXT,
    metadata TEXT
  );

  CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    actor TEXT,
    description TEXT,
    data TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    recipient TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT,
    source_type TEXT,
    source_id TEXT,
    read_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_profiles (
    agent_id TEXT PRIMARY KEY,
    agent_name TEXT NOT NULL,
    budget_monthly_cents INTEGER,
    updated_at TEXT NOT NULL
  );
`);

const now = new Date();
const nowSeconds = Math.floor(now.getTime() / 1000);
const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

const agents = [
  { id: 'moonlit-core', name: 'Moonlit Core', team: 'moonlit', project: 'moonlit', model: 'claude-sonnet-4-6', budget: 1500 },
  { id: 'moonlit-qa', name: 'Moonlit QA', team: 'moonlit', project: 'moonlit', model: 'gpt-5-mini', budget: 900 },
  { id: 'sunrise-build', name: 'Sunrise Build', team: 'sunrise', project: 'sunrise', model: 'claude-sonnet-4-6', budget: 1200 },
  { id: 'beacon-ops', name: 'Beacon Ops', team: 'beacon', project: 'beacon', model: 'gpt-5-mini', budget: 800 },
];

const sessions = [
  { id: `${month}-moonlit-core`, agentId: 'moonlit-core', project: 'moonlit', team: 'moonlit', model: 'claude-sonnet-4-6', tokens: 180_000, cost: 13.2, hoursAgo: 72 },
  { id: `${month}-moonlit-qa`, agentId: 'moonlit-qa', project: 'moonlit', team: 'moonlit', model: 'gpt-5-mini', tokens: 120_000, cost: 8.6, hoursAgo: 36 },
  { id: `${month}-sunrise-build`, agentId: 'sunrise-build', project: 'sunrise', team: 'sunrise', model: 'claude-sonnet-4-6', tokens: 95_000, cost: 6.4, hoursAgo: 18 },
  { id: `${month}-beacon-ops`, agentId: 'beacon-ops', project: 'beacon', team: 'beacon', model: 'gpt-5-mini', tokens: 44_000, cost: 3.2, hoursAgo: 8 },
];

const tasks = [
  {
    id: 'task-moonlit-stale',
    title: 'Reconcile cost rollup with dashboard summary',
    description: 'Investigate the mismatch between model and project allocations before the next review.',
    status: 'in_progress',
    priority: 'high',
    project: 'moonlit',
    assigned_to: 'moonlit-core',
    checkout_agent_id: 'moonlit-core',
    checkout_at: nowSeconds - 7_500,
    created_at: nowSeconds - 86_400,
    started_at: nowSeconds - 7_500,
    updated_at: nowSeconds - 7_200,
    tags: ['analytics', 'phase1'],
  },
  {
    id: 'task-moonlit-review',
    title: 'Validate stale-task badge rendering',
    description: 'Check the kanban card state transitions against the new API payload.',
    status: 'review',
    priority: 'medium',
    project: 'moonlit',
    assigned_to: 'moonlit-qa',
    created_at: nowSeconds - 48_000,
    updated_at: nowSeconds - 2_000,
    tags: ['frontend'],
  },
  {
    id: 'task-sunrise-build',
    title: 'Wire OBSERVATORY_DB_PATH into deploy manifest',
    status: 'assigned',
    priority: 'high',
    project: 'sunrise',
    assigned_to: 'sunrise-build',
    created_at: nowSeconds - 24_000,
    updated_at: nowSeconds - 1_200,
    tags: ['infra'],
  },
  {
    id: 'task-beacon-inbox',
    title: 'Draft budget warning copy for operators',
    status: 'inbox',
    priority: 'low',
    project: 'beacon',
    created_at: nowSeconds - 14_000,
    updated_at: nowSeconds - 900,
    tags: ['ux'],
  },
];

const activities = [
  {
    id: 'activity-task-sync-1',
    type: 'task_updated',
    entity_type: 'task',
    entity_id: 'task-moonlit-stale',
    actor: 'system',
    description: 'Task "Reconcile cost rollup with dashboard summary" was synced (status: in_progress)',
    data: { source: 'dummy-data' },
    created_at: nowSeconds - 7_100,
  },
  {
    id: 'activity-checkout-1',
    type: 'task_checkout',
    entity_type: 'task',
    entity_id: 'task-moonlit-stale',
    actor: 'moonlit-core',
    description: 'Task "task-moonlit-stale" was checked out by moonlit-core',
    data: { checkout_agent_id: 'moonlit-core' },
    created_at: nowSeconds - 7_000,
  },
  {
    id: 'activity-budget-warning',
    type: 'budget_alert',
    entity_type: 'agent',
    entity_id: 'moonlit-core',
    actor: 'system',
    description: 'Moonlit Core crossed 80% of the monthly budget.',
    data: { severity: 'warning' },
    created_at: nowSeconds - 1_800,
  },
];

const notifications = [
  {
    id: 'notification-review',
    recipient: 'observatory',
    type: 'status_change',
    title: 'Task Ready for Review',
    message: 'Validate stale-task badge rendering is ready for review.',
    source_type: 'task',
    source_id: 'task-moonlit-review',
    created_at: nowSeconds - 1_800,
  },
];

const insertEvent = db.prepare(`
  INSERT OR REPLACE INTO events (event_id, ts, type, source, agent_id, session_id, span_id, parent_span_id, team_id, data)
  VALUES (@event_id, @ts, @type, @source, @agent_id, @session_id, @span_id, @parent_span_id, @team_id, @data)
`);

const insertSession = db.prepare(`
  INSERT OR REPLACE INTO sessions (
    session_id, agent_id, agent_name, source, team_id, project_id, model_id,
    start_time, end_time, total_events, total_tokens, total_cost_usd
  )
  VALUES (
    @session_id, @agent_id, @agent_name, @source, @team_id, @project_id, @model_id,
    @start_time, @end_time, @total_events, @total_tokens, @total_cost_usd
  )
`);

const insertTask = db.prepare(`
  INSERT OR REPLACE INTO tasks (
    id, title, description, status, priority, project, assigned_to, checkout_agent_id, checkout_at,
    created_by, created_at, started_at, updated_at, due_date, tags, metadata
  )
  VALUES (
    @id, @title, @description, @status, @priority, @project, @assigned_to, @checkout_agent_id, @checkout_at,
    @created_by, @created_at, @started_at, @updated_at, @due_date, @tags, @metadata
  )
`);

const insertActivity = db.prepare(`
  INSERT OR REPLACE INTO activities (id, type, entity_type, entity_id, actor, description, data, created_at)
  VALUES (@id, @type, @entity_type, @entity_id, @actor, @description, @data, @created_at)
`);

const insertNotification = db.prepare(`
  INSERT OR REPLACE INTO notifications (
    id, recipient, type, title, message, source_type, source_id, read_at, created_at
  )
  VALUES (
    @id, @recipient, @type, @title, @message, @source_type, @source_id, @read_at, @created_at
  )
`);

const insertAgentProfile = db.prepare(`
  INSERT OR REPLACE INTO agent_profiles (agent_id, agent_name, budget_monthly_cents, updated_at)
  VALUES (@agent_id, @agent_name, @budget_monthly_cents, @updated_at)
`);

const txn = db.transaction(() => {
  for (const agent of agents) {
    insertAgentProfile.run({
      agent_id: agent.id,
      agent_name: agent.name,
      budget_monthly_cents: agent.budget,
      updated_at: now.toISOString(),
    });
  }

  for (const session of sessions) {
    const agent = agents.find((entry) => entry.id === session.agentId);
    const startTime = new Date(now.getTime() - session.hoursAgo * 60 * 60 * 1000);
    const endTime = new Date(startTime.getTime() + 35 * 60 * 1000);

    insertSession.run({
      session_id: session.id,
      agent_id: session.agentId,
      agent_name: agent.name,
      source: 'claude_code',
      team_id: session.team,
      project_id: session.project,
      model_id: session.model,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      total_events: 2,
      total_tokens: session.tokens,
      total_cost_usd: session.cost,
    });

    insertEvent.run({
      event_id: `evt-${session.id}-start`,
      ts: startTime.toISOString(),
      type: 'session.start',
      source: 'claude_code',
      agent_id: session.agentId,
      session_id: session.id,
      span_id: null,
      parent_span_id: null,
      team_id: session.team,
      data: JSON.stringify({
        model_id: session.model,
        project_id: session.project,
        budget_monthly_cents: agent.budget,
      }),
    });

    insertEvent.run({
      event_id: `evt-${session.id}-usage`,
      ts: new Date(startTime.getTime() + 10 * 60 * 1000).toISOString(),
      type: 'metrics.usage',
      source: 'claude_code',
      agent_id: session.agentId,
      session_id: session.id,
      span_id: null,
      parent_span_id: null,
      team_id: session.team,
      data: JSON.stringify({
        tokens: session.tokens,
        cost: session.cost,
        model_id: session.model,
        project_id: session.project,
      }),
    });
  }

  for (const task of tasks) {
    insertTask.run({
      id: task.id,
      title: task.title,
      description: task.description || null,
      status: task.status,
      priority: task.priority,
      project: task.project || null,
      assigned_to: task.assigned_to || null,
      checkout_agent_id: task.checkout_agent_id || null,
      checkout_at: task.checkout_at || null,
      created_by: 'dummy-data',
      created_at: task.created_at,
      started_at: task.started_at || null,
      updated_at: task.updated_at,
      due_date: null,
      tags: JSON.stringify(task.tags || []),
      metadata: JSON.stringify({ source: 'dummy-data' }),
    });
  }

  for (const activity of activities) {
    insertActivity.run({
      ...activity,
      data: JSON.stringify(activity.data || {}),
    });
  }

  for (const notification of notifications) {
    insertNotification.run({
      ...notification,
      read_at: null,
    });
  }
});

txn();
db.close();

console.log(`Dummy Observatory data written to ${dbPath}`);
