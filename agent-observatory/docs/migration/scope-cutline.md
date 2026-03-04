# Migration Scope Cutline

**Project:** Agent Observatory — Mission Control to Agent Observatory Migration
**Date:** 2026-03-04
**Status:** Active

This document defines the fixed scope boundary for the current migration release. All parity goals and release boundaries are explicit and frozen at this cutline.

---

## Sections

### Parity

Features that must behave **identically** to the legacy mission-control system. Any behavioral difference is a regression.

- Task list retrieval (pagination, filters, sort)
- Task detail view (status, assignee, metadata)
- Webhook delivery and retry logic
- Authentication session management (login, logout, token refresh)
- Scheduler job status and history
- GitHub Sync repository and commit event ingestion
- Super Admin user management and audit log access

### Equivalent

Features that achieve the **same user outcome** but may use a different implementation or data shape. Acceptable divergence must be documented.

- Notification delivery: mission-control used polling; agent-observatory uses WebSocket push. Latency SLO must still be met.
- Activity feed: event schema differs; UI adapter normalises to the same display model.
- Pipeline run tracking: new domain model replaces legacy pipeline_runs table; all status transitions remain reachable.

### New

Features that exist **only in agent-observatory** and have no mission-control counterpart. These are additive and not required for parity sign-off.

- UAEP event store and telemetry ingestion
- Shadow-mode comparator and drift reporting
- Domain-level feature flags (auth_v2, tasks_v2, webhooks_v2, kill_switch_all_v2)
- Real-time agent session log streaming
- Model usage and cache metrics dashboard

---

## Domain Classification Table

| Domain | Classification | Notes |
|---|---|---|
| Auth | Parity | Session semantics must be identical; token format may change if clients are updated simultaneously |
| Task | Parity | All CRUD operations and state machine transitions must match |
| Webhook | Parity | Delivery guarantees and retry behaviour must be preserved |
| Scheduler | Parity | Job definitions and execution history must transfer without data loss |
| Pipeline | Equivalent | Domain model restructured; status transitions and outcome codes preserved |
| GitHub Sync | Parity | Repository and commit ingestion events must not be dropped |
| Super Admin | Parity | User management actions and audit entries must be complete |
| Notification | Equivalent | Delivery mechanism changes from polling to WebSocket push |
| Activity Feed | Equivalent | Event schema normalised through UI adapter layer |
| UAEP Telemetry | New | No mission-control counterpart; additive only |
| Shadow Mode | New | Migration observability tooling; not a user-facing feature |
| Feature Flags | New | Rollout control plane; no mission-control equivalent |

---

## In-Scope for Current Release

The following work is **in scope** and must be complete before the current release ships:

1. All **Parity** domains listed above reach ≥ 99% behavioural match in shadow mode.
2. All **Equivalent** domains have documented divergence rationale and pass SLO targets defined in `slo-targets.md`.
3. Backfill plan executed for Tasks, Reviews, Notifications, Activities, and Webhooks (see `backfill-plan.md`).
4. Domain feature flags deployed and tested for auth_v2, tasks_v2, and webhooks_v2.
5. Global kill switch (kill_switch_all_v2) functional and tested.
6. Phase 0 through Phase 2 exit criteria met (see `phase-exit-criteria.md`).

## Out-of-Scope for Current Release

The following are **explicitly excluded** from the current release:

1. Migration of archived (soft-deleted) records older than 365 days.
2. Migration of legacy pipeline_runs records — only active and recent (< 90 days) pipelines are in scope.
3. UAEP telemetry historical backfill (new data only from cutover date).
4. Super Admin bulk-import tooling (existing users only; no CSV import feature parity).
5. Phase 3 (full traffic cutover) and Phase 4 (legacy decommission) — planned for a subsequent release.
6. Real-time collaboration features (not present in mission-control; future roadmap only).
