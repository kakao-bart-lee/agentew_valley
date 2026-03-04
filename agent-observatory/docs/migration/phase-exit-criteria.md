# Migration Phase Exit and Rollback Criteria

**Project:** Agent Observatory - Mission Control to Agent Observatory Migration  
**Date:** 2026-03-04  
**Status:** Active

This document defines objective gate criteria for moving between migration phases and explicit rollback triggers when reliability or parity regresses.

---

## Phase Definitions

- **Phase 0 - Foundation:** guardrails, baselines, and rehearsal tooling prepared.
- **Phase 1 - Rehearsal:** backfill and replay validated in dry-run/staging.
- **Phase 2 - Shadow:** production read-only comparison with no user-facing cutover.
- **Phase 3 - Controlled Cutover:** partial production traffic served by v2 paths.
- **Phase 4 - Full Cutover and Decommission:** full production cutover and legacy retirement.

---

## Phase Exit Definition of Done and Rollback Triggers

| Phase | Numeric Exit DoD (all required) | Numeric Rollback Trigger (any one triggers rollback/phase freeze) |
|---|---|---|
| **Phase 0** | 1) `100%` of required migration docs approved (`scope-cutline.md`, `slo-targets.md`, `data-model-principles.md`, `backfill-plan.md`, `shadow-mode-enablement.md`). 2) `100%` of required rehearsal entities configured (`tasks`, `reviews`, `notifications`, `activities`, `webhooks`). 3) `0` open Severity-1 migration defects. 4) Baseline API p95 <= `250 ms` for `7` consecutive days. | 1) Any required document missing approval (`< 100%`). 2) Any required rehearsal entity missing (`< 5/5`). 3) Any Severity-1 defect opened during sign-off window. 4) Baseline API p95 > `350 ms` for `30` continuous minutes. |
| **Phase 1** | 1) Row-count parity = `100%` across all `5/5` required entities in rehearsal output. 2) Checksum diff count = `0` for all required entities. 3) Idempotent replay passes on `2` consecutive reruns with identical outputs. 4) Open Severity-1 migration defects = `0`. | 1) Any required entity parity < `99.5%`. 2) Any required entity checksum diff > `0`. 3) Consecutive replay outputs diverge in any required entity. 4) Any Severity-1 data-integrity incident. |
| **Phase 2** | 1) Shadow compare match rate >= `99.0%` for `7` consecutive days on migration-critical endpoints. 2) `missing_legacy + missing_new <= 0.10%` per rolling 24-hour window. 3) Event loss rate <= `0.10%`. 4) Severity-1 incidents = `0`, Severity-2 incidents <= `1` during phase window. | 1) Shadow match rate < `98.0%` in any 24-hour window. 2) `missing_legacy + missing_new > 0.50%` in any 24-hour window. 3) Event loss rate > `0.50%` in any 1-hour window. 4) Any Severity-1 migration incident. |
| **Phase 3** | 1) v2 serves at least `50%` of production traffic for `7` consecutive days. 2) Error-rate delta (v2 - v1) <= `0.20` percentage points across migration-critical endpoints. 3) API p95 <= `250 ms` and WebSocket reconnect p95 <= `5 s`. 4) Global kill-switch drill completes in <= `2` minutes and verified `2/2` times. | 1) Error-rate delta (v2 - v1) > `1.00` percentage point for `15` continuous minutes. 2) API p95 > `350 ms` for `30` minutes. 3) WebSocket reconnect p95 > `10 s` for `10` minutes. 4) Kill-switch activation fails or exceeds `5` minutes once. |
| **Phase 4** | 1) v2 serves `100%` production traffic for `14` consecutive days. 2) Legacy write paths disabled `100%`; no unauthorized writes detected (`0` violations). 3) Severity-1 incidents = `0`, Severity-2 incidents <= `2` across the 14-day window. 4) Decommission checklist completion = `100%` (legacy jobs, alerts, and credentials removed). | 1) Any Severity-1 migration incident in first `14` days post-cutover. 2) Data integrity mismatch > `0.10%` on any daily reconciliation. 3) RTO > `30` minutes during any migration-related incident. 4) Unauthorized legacy writes > `0` after decommission lock. |

---

## Required Evidence Checklist (Per Phase)

Use this checklist at each gate review. All fields are mandatory.

### Phase 0 Evidence
- [ ] Test run id: `________________`
- [ ] Metrics snapshot: `________________` (dashboard link + timestamp)
- [ ] Incident count (window: last 7 days): `Sev1=__  Sev2=__  Sev3=__`

### Phase 1 Evidence
- [ ] Test run id: `________________`
- [ ] Metrics snapshot: `________________` (rehearsal parity/checksum report link + timestamp)
- [ ] Incident count (window: rehearsal cycle): `Sev1=__  Sev2=__  Sev3=__`

### Phase 2 Evidence
- [ ] Test run id: `________________`
- [ ] Metrics snapshot: `________________` (shadow report + SLO dashboard link + timestamp)
- [ ] Incident count (window: last 7 days): `Sev1=__  Sev2=__  Sev3=__`

### Phase 3 Evidence
- [ ] Test run id: `________________`
- [ ] Metrics snapshot: `________________` (traffic split, error delta, latency dashboard link + timestamp)
- [ ] Incident count (window: cutover window): `Sev1=__  Sev2=__  Sev3=__`

### Phase 4 Evidence
- [ ] Test run id: `________________`
- [ ] Metrics snapshot: `________________` (100% cutover and reconciliation dashboard link + timestamp)
- [ ] Incident count (window: post-cutover 14 days): `Sev1=__  Sev2=__  Sev3=__`

---

## Go or No-Go Approval Template

```md
# Migration Phase Gate Decision

- Phase: [0 | 1 | 2 | 3 | 4]
- Decision Date (UTC): [YYYY-MM-DD]
- Decision: [GO | NO-GO | ROLLBACK]

## Gate Evidence
- Test run id: [required]
- Metrics snapshot: [required link + timestamp]
- Incident count: [required: Sev1 / Sev2 / Sev3 + time window]
- Exceptions/Waivers: [none or explicit waiver id]

## Sign-off
- Migration Program Manager: [name] [approve/reject] [date]
- Release Owner: [name] [approve/reject] [date]
- Server On-call Lead: [name] [approve/reject] [date]
- SRE / Incident Commander: [name] [approve/reject] [date]
- Product/Support Representative: [name] [approve/reject] [date]

## Notes
- Risks:
- Follow-ups:
```

