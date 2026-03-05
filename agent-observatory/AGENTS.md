# Agent Observatory — Phase 2 & 3 Continuous Development

## Mission
Implement Phase 2 (Structure) and Phase 3 (Governance) of the Observatory Evolution plan.
Read `docs/S-004-observatory-evolution.md` for the full spec.
Read `docs/PAPERCLIP-ANALYSIS.md` for Paperclip architectural reference.

## Current State (Phase 1 COMPLETE ✅)
Phase 1 is merged into main. The following features are already implemented:
- F-001: Project-based View & Grouping (Group by Status/Agent/Project toggle)
- F-002: Multi-dimensional Cost Tracking (getCostByProject/Agent/Model)
- F-003: Atomic Task Checkout (POST /api/v2/tasks/:id/checkout, 409 conflict)
- F-004: Stale Task Detection & Budget Alert (80%/100% thresholds)
- F-005: SQLite Persistent Storage (OBSERVATORY_DB_PATH env var)
- Dummy Data Generator with cost events, activities, project tags

## Phase 2 — Structure (YOUR CURRENT TASK)

### F-006: Goal Hierarchy
- Create `goals` table (id, title, description, level, parent_id, status)
- Parse GOALS.md files as Source of Truth
- Add `goal_id` FK to tasks table
- Frontend: Goal → Project → Task drill-down view
- Dashboard: "Goal Progress" widget (completion bar per goal)

### F-007: Task Comments
- Create `task_comments` table (id, task_id, author_agent_id, body, created_at)
- REST API: GET/POST /api/v2/tasks/:id/comments
- Frontend: Comment thread in task detail panel
- Principle: "Tasks are the communication channel"

### F-008: Issue Relations & Dependencies
- Create `task_relations` table (id, type, task_id, related_task_id)
- Relation types: blocks, blocked_by, related
- Parse `depends:T-001` syntax from TASK.md
- Frontend: Dependency arrows or blocked flag display
- Auto-clear blocked flag when blocking task completes

### F-009: Agent Health & Context Monitoring
- Agent runtime state tracking (total_tokens, total_cost, last_error, last_run_status)
- Context Window usage gauge (when ACP session data is available)
- Tool Call success/failure rate gauge (last N calls)
- Agent card health badge (🟢 normal / 🟡 caution / 🔴 error)

### F-010: Real-time Event Enhancement
- Extend WebSocket event types: task.updated, task.checkout, agent.status, cost.alert, activity.logged
- React Query cache invalidation on WebSocket events (selective invalidateQueries)
- Auto-reconnect on disconnect + polling fallback

### F-006.5: Checkout Release API (from Phase 1 review)
- DELETE /api/v2/tasks/:id/checkout — release checkout lock
- Auto-release on task status change to 'done' or 'review'

### F-004.1: Configurable Stale Threshold (from Phase 1 review)
- Support OBSERVATORY_STALE_THRESHOLD_HOURS env var (default: 1)

## Phase 3 — Governance (AFTER Phase 2)

### F-011: Web-based Approval Gate
- `approvals` table (id, type, requested_by, status, payload, decision_note, decided_at)
- Types: dangerous_action, budget_override, new_agent
- States: pending → approved / rejected / revision_requested
- Frontend: Approval list + Approve/Deny/Comment buttons
- Telegram notification integration

### F-012: Activity Log Enhancement
- Extend activities table: actor_type (agent/user/system), entity_type, entity_id
- Auto-record all mutating actions
- Frontend: Activity timeline page + entity filters

### F-013: Adapter Registry
- Refactor Collectors to ObservatoryAdapter interface
- Interface: type, capabilities, collect(), testConnection()
- Capabilities: { costTracking, logStreaming, statusUpdates }
- Register: MissionControl, ClaudeCode, OpenClaw, OpenCode adapters

## Development Rules
1. Run `pnpm install` first.
2. Run `pnpm build` before committing — must pass with zero errors.
3. Commit frequently with clear messages (one commit per feature is fine).
4. Write tests for new backend logic (API endpoints, store methods).
5. Push the branch when done.
6. When Phase 2 is complete, signal completion with:
   ```
   openclaw system event --text "Done: Observatory Phase 2 complete — Goals, Comments, Dependencies, Health Monitoring, Real-time Events implemented." --mode now
   ```
7. After Phase 2 review/merge, proceed to Phase 3 with the same pattern.
