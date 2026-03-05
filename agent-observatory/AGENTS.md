# Agent Observatory — Phase 3: Governance

## Mission
Implement Phase 3 (Governance) of the Observatory Evolution plan.
Phase 1 (Foundation) and Phase 2 (Structure) are complete and merged.

Read `docs/S-004-observatory-evolution.md` for the full spec.
Read `docs/PAPERCLIP-ANALYSIS.md` for Paperclip architectural reference.

## Current State (Phase 1 + 2 COMPLETE ✅)
Already implemented:
- F-001~F-005: Project grouping, cost tracking, atomic checkout, stale detection, persistent storage
- F-006~F-010: Goal hierarchy, task comments, dependencies, agent health, real-time events
- F-006.5: Checkout release API
- F-004.1: Configurable stale threshold

## Phase 3 — Governance (YOUR TASK)

### F-011: Web-based Approval Gate
- Create `approvals` table:
  ```sql
  CREATE TABLE approvals (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,           -- dangerous_action | budget_override | new_agent
    requested_by TEXT NOT NULL,   -- agent_id
    status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | revision_requested
    payload TEXT,                 -- JSON: context about the request
    decision_note TEXT,
    decided_by TEXT,              -- agent_id or 'user'
    decided_at INTEGER,
    created_at INTEGER NOT NULL
  );
  ```
- REST API endpoints:
  - `GET /api/v2/approvals` — list approvals (filter by status, type)
  - `GET /api/v2/approvals/:id` — get single approval
  - `POST /api/v2/approvals` — create approval request
  - `PATCH /api/v2/approvals/:id` — update status (approve/reject/request_revision + decision_note)
- Frontend:
  - Approval list page with filter tabs (Pending / All)
  - Approval detail: show payload context, Approve/Deny/Request Revision buttons
  - Decision note text area
  - Badge count on nav for pending approvals
- WebSocket: emit `approval.created`, `approval.updated` events
- Activity log: auto-record all approval state transitions

### F-012: Activity Log Enhancement
- Extend existing `activities` table with new columns:
  - `actor_type TEXT` — agent | user | system
  - `entity_type TEXT` — task | agent | approval | goal | session
  - `entity_id TEXT` — reference to the affected entity
- Auto-record all mutating API actions (task upsert, checkout, comment, approval)
- REST API:
  - `GET /api/v2/activities` — list activities with filters (entity_type, entity_id, actor_type, limit, offset)
- Frontend:
  - Activity Timeline page (new route)
  - Filter by entity type, date range
  - Infinite scroll or pagination
  - Timeline entries: icon + actor + action + entity link + timestamp

### F-013: Adapter Registry
- Create `ObservatoryAdapter` interface in shared types:
  ```typescript
  interface ObservatoryAdapter {
    type: string;                    // e.g. 'mission_control', 'claude_code', 'openclaw', 'opencode'
    capabilities: AdapterCapabilities;
    collect(options: CollectOptions): Promise<void>;
    testConnection(): Promise<{ ok: boolean; message?: string }>;
  }
  
  interface AdapterCapabilities {
    costTracking: boolean;
    logStreaming: boolean;
    statusUpdates: boolean;
    goalParsing: boolean;
    taskSync: boolean;
  }
  ```
- Refactor existing MissionControl collector to implement this interface
- Create stub adapters for: ClaudeCode, OpenClaw, OpenCode
- REST API:
  - `GET /api/v2/adapters` — list registered adapters with status
  - `POST /api/v2/adapters/:type/test` — test adapter connection
- Frontend:
  - Adapter settings page showing each adapter's status, capabilities grid, and test button

### Cleanup Tasks (from Phase 2 review)
- Add `.omx/` to `.gitignore`
- Ensure all mock data includes `health_status` field, then make `AgentLiveState.health_status` required again

## Development Rules
1. Run `pnpm install` first.
2. Run `pnpm build` before committing — must pass with zero errors.
3. Commit frequently with clear messages.
4. Write tests for new backend logic (approval API, activity API, adapter registry).
5. After all work is done:
   - `git add -A && git commit` with descriptive message
   - `git push origin feat/observatory-phase3`
   - `openclaw system event --text "Done: Observatory Phase 3 complete — Approval Gate, Activity Log, Adapter Registry implemented." --mode now`
