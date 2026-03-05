# Agent Observatory — Phase 1 Development Task

## Mission
Implement Phase 1 (Foundation) of the Observatory Evolution plan as defined in `docs/S-004-observatory-evolution.md`.

## Context
- This is a Node.js/TypeScript monorepo (pnpm) with `packages/server` (API) and `packages/web` (React + Vite frontend).
- The server uses SQLite (via `packages/server/src/core/history-store.ts` and `lib/mc-db.ts`).
- The web UI uses React + Tailwind CSS + Shadcn UI + Recharts.
- Read `docs/PAPERCLIP-ANALYSIS.md` for architectural reference from the Paperclip project.
- Read `BLACKBOARD.md` for current project status.

## Phase 1 Features to Implement

### F-001: Project-based View & Grouping
- Update `TASK.md` parser in MissionControlCollector to recognize `(project-name)` prefix tags.
- Add `project` column to SQLite `tasks` table.
- Add a "Group by: Agent | Project | Status" toggle on the kanban board UI.
- Add project filter dropdown.

### F-002: Multi-dimensional Cost Tracking
- Add `project_id` column to `sessions` table in HistoryStore.
- Implement `getCostByProject()`, `getCostByAgent()`, `getCostByModel()` methods.
- Add Cost Summary card to dashboard.

### F-003: Atomic Task Checkout
- Add `checkout_agent_id`, `checkout_at` columns to `tasks` table.
- Implement atomic UPDATE pattern: `UPDATE tasks SET checkout_agent_id=? WHERE id=? AND (checkout_agent_id IS NULL OR checkout_agent_id=?)`.
- Return 409 on conflict.
- Show 🔒 icon on checked-out tasks in kanban.

### F-004: Stale Task Detection & Budget Alert
- Query tasks where `status='in_progress' AND started_at < now()-1hour` → mark as "Stale".
- Add `budget_monthly_cents` field per agent.
- Dashboard warning badge when 80% budget reached.
- Red alert at 100%.

### F-005: SQLite Persistent Storage
- Support `OBSERVATORY_DB_PATH` env var for persistent DB location.
- Fallback to in-memory if not set.

### F-011 (Bonus): Dummy Data Enhancement
- Extend `scripts/generate-dummy-data.js` to also generate cost events, activity logs, and project-tagged tasks.

## Development Rules
- Run `pnpm install` first.
- Run `pnpm typecheck` before committing to ensure no TS errors.
- Commit frequently with clear messages.
- After all features, push the branch `feat/observatory-phase1`.

## Completion
When finished, run:
```
openclaw system event --text "Done: Observatory Phase 1 complete — Project grouping, cost tracking, atomic checkout, stale task detection, persistent DB implemented." --mode now
```
