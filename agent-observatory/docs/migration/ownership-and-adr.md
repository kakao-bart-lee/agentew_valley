# Migration Domain Ownership and ADR Mapping

**Project:** Agent Observatory - Mission Control to Agent Observatory Migration  
**Date:** 2026-03-04  
**Status:** Active

This document defines domain ownership, escalation paths, and ADR planning so migration decisions and incident response remain explicit and auditable.

---

## Domain Ownership Matrix

| Migration Domain | Primary DRI | Secondary DRI | Operational On-Call | Decision Scope |
|---|---|---|---|---|
| Auth | Identity & Access Lead | Server Platform Lead | Server On-Call | Session/token behavior parity, auth rollout gates |
| Task | Workflow Domain Lead | Data Platform Lead | Workflow On-Call | Task CRUD/state-machine parity, cutover readiness |
| Webhook | Integrations Lead | Workflow Domain Lead | Integrations On-Call | Delivery guarantees, retry/backoff policy, endpoint compatibility |
| Scheduler | Platform Reliability Lead | Workflow Domain Lead | SRE On-Call | Job reliability, scheduling latency, replay safety |
| Pipeline | Execution Domain Lead | Platform Reliability Lead | Workflow On-Call | Equivalent behavior approval for pipeline model changes |
| GitHub Sync | Integrations Lead | Data Platform Lead | Integrations On-Call | Ingestion completeness and external API drift handling |
| Super Admin | Admin Experience Lead | Identity & Access Lead | Server On-Call | Privileged action parity and audit completeness |
| Notifications | Engagement Domain Lead | Integrations Lead | Workflow On-Call | Push/polling equivalent outcomes and delivery SLO compliance |
| Activities | Observability Domain Lead | Workflow Domain Lead | Server On-Call | Activity-feed event normalization and ordering consistency |
| Backfill and Data Integrity | Data Platform Lead | Platform Reliability Lead | Data Ops On-Call | Source-to-target mapping, idempotency, checksum/parity sign-off |
| Shadow Mode and Comparator | Release Engineering Lead | Observability Domain Lead | SRE On-Call | Comparison-only operation, drift thresholds, report readiness |
| Feature Flags and Kill Switch | Release Engineering Lead | Server Platform Lead | SRE On-Call | Phase enablement, per-domain gating, emergency shutdown controls |

---

## Escalation Chain

### Incident Escalation

| Trigger | First Escalation | Second Escalation | Final Escalation |
|---|---|---|---|
| Sev-3 migration issue (no active data risk) | Domain Primary DRI | Domain Secondary DRI | Release Engineering Lead |
| Sev-2 migration issue (customer-impacting degradation) | Domain Primary DRI + Operational On-Call | Release Engineering Lead + Server On-Call Lead | Migration Program Manager |
| Sev-1 migration issue (data integrity/security/major outage) | Domain Primary DRI + Incident Commander (SRE) | Release Engineering Lead + Migration Program Manager | Engineering Director + Product Director |

### Escalation SLOs

- Initial acknowledgement: Sev-1 <= 5 minutes, Sev-2 <= 15 minutes, Sev-3 <= 60 minutes.
- Cross-team escalation handoff: <= 15 minutes after initial acknowledgement when issue spans domains.
- Go/no-go gate blocker escalation: immediate escalation to Migration Program Manager and Release Engineering Lead.

---

## Approval Roles

| Decision Type | Required Approvers | Optional Reviewers |
|---|---|---|
| Domain parity sign-off (Phase 1/2) | Domain Primary DRI, Release Engineering Lead, QA Lead | Product Manager |
| Cutover progression (Phase 2 -> 3, 3 -> 4) | Migration Program Manager, Release Engineering Lead, Server On-Call Lead | Support Lead, Security Lead |
| Rollback execution | Incident Commander (SRE), Release Engineering Lead | Domain Primary DRI |
| ADR acceptance (domain architecture changes) | Domain Primary DRI, Architecture Owner | Release Engineering Lead, Data Platform Lead |

---

## Planned ADR Identifier Map

ADR documents will use the `docs/adr/` namespace and a zero-padded numeric sequence (`0000`, `0001`, ...). The template and lifecycle policy are defined in US-015.

| Migration Domain | Planned ADR ID | Planned ADR Title | Owner Role | Target Phase |
|---|---|---|---|---|
| Auth | ADR-0001 | Auth v2 Session and Token Compatibility Strategy | Identity & Access Lead | Phase 1 |
| Task | ADR-0002 | Task Domain Parity and State Transition Contract | Workflow Domain Lead | Phase 1 |
| Webhook | ADR-0003 | Webhook Delivery and Retry Compatibility Policy | Integrations Lead | Phase 1 |
| Scheduler | ADR-0004 | Scheduler Replay and Job Reliability Boundaries | Platform Reliability Lead | Phase 1 |
| Pipeline | ADR-0005 | Pipeline Equivalent-Behavior Model and Cutover Criteria | Execution Domain Lead | Phase 2 |
| GitHub Sync | ADR-0006 | GitHub Sync Ingestion Idempotency and Drift Handling | Integrations Lead | Phase 1 |
| Super Admin | ADR-0007 | Super Admin Privilege and Audit Parity Requirements | Admin Experience Lead | Phase 2 |
| Notifications | ADR-0008 | Notification Delivery Equivalence (Polling -> WebSocket) | Engagement Domain Lead | Phase 2 |
| Activities | ADR-0009 | Activity Feed Normalization and Ordering Guarantees | Observability Domain Lead | Phase 2 |
| Backfill and Data Integrity | ADR-0010 | Backfill Conflict Resolution and Data Integrity Controls | Data Platform Lead | Phase 1 |
| Shadow Mode and Comparator | ADR-0011 | Shadow Comparator Scope and Drift Tolerance Policy | Release Engineering Lead | Phase 2 |
| Feature Flags and Kill Switch | ADR-0012 | Migration Rollout Flagging and Emergency Kill-Switch Rules | Release Engineering Lead | Phase 2 |

---

## Operating Notes

- Ownership changes must be reflected in this document before the next phase-gate review.
- Any new migration domain added to scope must include both a DRI assignment and planned ADR ID before implementation starts.
- If escalation spans multiple domains, the Release Engineering Lead acts as the temporary single-threaded owner until a final decision is recorded.
