# Migration SLO and Non-Functional Targets

**Project:** Agent Observatory - Mission Control to Agent Observatory Migration  
**Date:** 2026-03-04  
**Status:** Active

This document defines the non-functional targets used to judge migration readiness. Targets are considered release-blocking unless explicitly waived by the migration DRI and incident commander.

---

## Metric Targets

| Metric | Target | Measurement Source | Alert Threshold |
|---|---|---|---|
| API latency (p95) | <= 250 ms for `GET` and `POST` under `/api/v1/*` (excluding explicit long-running endpoints) | Server Prometheus histogram `http_server_request_duration_ms` aggregated by route and method | Warning: p95 > 250 ms for 15 min. Critical: p95 > 350 ms for 30 min |
| WebSocket reconnect time (p95) | <= 5 seconds from disconnect to successful `init` payload | Client reconnect telemetry (`socket_reconnect_duration_ms`) plus server connection logs | Warning: p95 > 5 s for 10 min. Critical: p95 > 10 s for 10 min |
| Event loss rate | <= 0.1% per rolling 1-hour window | Parity check of collector ingress count vs. downstream emitted count, minus deduplicated retries | Warning: > 0.1% for 2 consecutive windows. Critical: > 0.5% in any single window |
| RPO (Recovery Point Objective) | <= 5 minutes of data loss | Backup metadata (`last_successful_snapshot_at`) and restore rehearsal diff timestamp | Warning: snapshot age > 5 min. Critical: snapshot age > 15 min |
| RTO (Recovery Time Objective) | <= 30 minutes to restore core API and event ingest | Disaster-recovery drill records and incident timeline (`service_restore_completed_at - incident_start_at`) | Critical: any drill or incident exceeding 30 min |
| Retention | UAEP raw events: 30 days hot + 365 days cold. Ops/audit records: 365 days minimum | Data store lifecycle reports, partition TTL jobs, and weekly retention audit query | Warning: retention job lag > 24 h. Critical: data purged earlier than policy minimum |

---

## Monthly Error Budget

| SLO Dimension | SLO Target | Monthly Error Budget (30-day month) | Budget Owner |
|---|---|---|---|
| API availability for migration-critical endpoints | 99.9% | 43m 12s unavailable time | Server on-call |
| WebSocket session continuity | 99.5% successful reconnects within target | 0.5% failed reconnect attempts | Realtime on-call |
| Event delivery correctness | 99.9% non-lost events | 0.1% loss allowance | Data pipeline on-call |

Budget is tracked daily and reviewed in the weekly migration sync. Budget consumption over 50% before day 15 is treated as at-risk.

---

## Breach Response Policy

1. **Detect and classify**
   - Declare `At Risk` when burn rate is >= 2x budget over 6 hours.
   - Declare `Breach` when burn rate is >= 5x budget over 1 hour, or when any critical threshold fires for 15+ minutes.
2. **Immediate safeguards**
   - Freeze phase advancement and suspend non-essential deploys.
   - If user impact is ongoing, enable domain flag rollback or global `kill_switch_all_v2`.
3. **Incident handling**
   - Open incident channel within 10 minutes of breach declaration.
   - Assign incident commander, ops scribe, and domain DRI.
   - Provide status updates every 15 minutes until stable.
4. **Recovery and validation**
   - Verify all breached metrics return below warning threshold for at least 60 minutes.
   - Re-run shadow report and parity spot-checks before re-enabling rollout progression.
5. **Post-incident actions**
   - Publish incident review within 2 business days.
   - Record corrective actions with owner and due date.
   - Reduce rollout phase by one level if breach occurred during traffic ramp.
