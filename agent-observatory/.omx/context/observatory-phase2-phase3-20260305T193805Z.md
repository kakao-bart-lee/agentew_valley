Task statement
- Implement Phase 2 (Structure) and Phase 3 (Governance) of the Agent Observatory evolution plan.

Desired outcome
- Ship backend, frontend, tests, and realtime support for goals, comments, task relations, agent health, enhanced events, approvals, activity log enrichment, and adapter registry changes.

Known facts/evidence
- Core persistence is SQLite in `packages/server/src/core/history-store.ts`.
- API routing lives in `packages/server/src/delivery/api.ts`.
- Realtime delivery uses Socket.IO in `packages/server/src/delivery/websocket.ts`.
- Frontend surfaces are split across dashboard and mission-control views in `packages/web/src/views`.
- Phase 1 features already exist, including tasks, checkout, stale detection, budget alerts, and persistent DB support.

Constraints
- Must run `pnpm install` first, but network access is restricted in this environment.
- Must run tests/build before finishing if environment allows.
- Must not revert unrelated user changes.
- Must use `apply_patch` for file edits.

Unknowns/open questions
- Exact frontend composition for new governance pages versus extending existing dashboard tabs.
- Whether existing collectors already expose enough signal for tool success/failure and context-window usage.
- How much of Phase 3 is feasible in one pass after Phase 2 lands.

Likely codebase touchpoints
- `packages/server/src/core/history-store.ts`
- `packages/server/src/delivery/api.ts`
- `packages/server/src/delivery/websocket.ts`
- `packages/server/src/core/state-manager.ts`
- `packages/server/src/core/event-bus.ts`
- `packages/server/src/__tests__/*`
- `packages/shared/src/types/*`
- `packages/collectors/src/*`
- `packages/web/src/lib/api.ts`
- `packages/web/src/hooks/useSocket.ts`
- `packages/web/src/views/Dashboard/*`
- `packages/web/src/views/MissionControl/*`
