# Migration Data Model Boundary Principles

**Project:** Agent Observatory - Mission Control to Agent Observatory Migration  
**Date:** 2026-03-04  
**Status:** Active

This document defines the storage boundary between UAEP telemetry and operations-domain data, plus schema conventions for all new migration-era domain tables.

---

## 1. UAEP Event Store vs Ops Domain Store Boundary

| Concern | UAEP Event Store | Ops Domain Store |
|---|---|---|
| Primary purpose | Capture raw and normalized telemetry/events for observability and replay | Serve product/operational workflows (tasks, reviews, notifications, activities, webhooks) |
| Data shape | Append-only event records with event metadata and payload blobs | Relational entities with business invariants and lifecycle state |
| Mutation model | Immutable writes; corrections are compensating events, not in-place edits | Mutable rows with controlled updates and referential integrity |
| Retention model | Time-based retention tiers (hot/cold/archive) | Domain-policy retention and compliance requirements |
| Read patterns | Stream/time-window queries, replay, analytics | Point lookup, filtered lists, joins, transactional workflows |
| Source of truth for workflow state | Never authoritative for final business state | Authoritative store for product state and user-visible outcomes |

### Boundary Rules

1. Do not use UAEP event payloads as the canonical source for operational state.
2. Keep UAEP telemetry storage append-only; avoid update/delete operations except controlled retention jobs.
3. Persist operational decisions and statuses in ops tables, then emit UAEP events as audit/telemetry side effects.
4. Cross-store links must be by stable IDs (for example, `task_id`, `review_id`, `webhook_id`), never by implicit ordering.

---

## 2. Required Common Columns for Ops Domain Tables

All new ops-domain tables MUST include the following shared columns:

| Column | Required Type | Nullability | Purpose |
|---|---|---|---|
| `workspace_id` | `TEXT` / `UUID` | `NOT NULL` | Tenant boundary and primary partition key for multi-workspace isolation |
| `created_at` | `TIMESTAMP` (UTC) | `NOT NULL` | Immutable row creation timestamp |
| `updated_at` | `TIMESTAMP` (UTC) | `NOT NULL` | Last mutation timestamp; updated on every write |
| `actor` | `TEXT` | `NOT NULL` | Principal responsible for latest mutation (`user:{id}`, `service:{name}`, or `system`) |

### Column Behavior Requirements

1. `created_at` is write-once and must never be overwritten during updates.
2. `updated_at` is mandatory on every mutating write path (application layer or trigger).
3. `actor` must be set explicitly by write paths; fallback value is `system` only for automated jobs.
4. `workspace_id` must be present in all unique/index strategies to prevent cross-workspace collisions.

---

## 3. Naming Conventions for New Domain Tables

1. Use `snake_case` for table names, column names, indexes, and constraints.
2. Use plural nouns for table names (`tasks`, `reviews`, `notifications`).
3. Primary key columns should use `<entity>_id` when natural IDs exist (for example, `task_id`); otherwise `id` is acceptable.
4. Foreign key columns should use `<referenced_entity>_id` naming.
5. Boolean columns should use `is_` / `has_` prefixes (`is_archived`, `has_failed_delivery`).
6. Enum-like status columns should be stored as constrained text values and documented in schema comments or migration notes.

---

## 4. Indexing Conventions for New Domain Tables

1. Always create an index on `workspace_id` plus the most common query discriminator (for example, `status`, `created_at`, `task_id`).
2. Name indexes as `idx_<table>_<column_list>` (for example, `idx_tasks_workspace_created_at`).
3. Use `IF NOT EXISTS` for migration-safe index creation.
4. Use composite indexes in query-order sequence (left-most prefix matches filter/sort patterns).
5. Add unique indexes where business invariants require deduplication (`workspace_id` + external reference keys).
6. Revisit index coverage for backfill and replay paths to prevent full-table scans on migration workloads.

---

## 5. Foreign Key Conventions for New Domain Tables

1. Define explicit foreign keys for all relational dependencies; do not rely on application-only integrity checks.
2. Name FK columns consistently as `<parent>_id` and match parent PK type exactly.
3. Default delete behavior should be `RESTRICT` unless cascade semantics are explicitly required and reviewed.
4. Use `ON UPDATE CASCADE` only when parent identifiers are mutable; otherwise avoid it.
5. Index every foreign key column (or include it in a composite index) to protect join and delete performance.
6. For soft-delete domains, prefer `is_deleted`/`deleted_at` patterns over cascading hard deletes.

---

## 6. New Table Review Checklist

Before merging any new ops-domain table, confirm:

- Boundary placement is correct (ops state not stored in UAEP event payloads)
- Required columns exist: `workspace_id`, `created_at`, `updated_at`, `actor`
- Naming matches `snake_case` + entity ID conventions
- Indexes follow `idx_<table>_<column_list>` and include workspace-aware access paths
- Foreign keys are explicit and indexed
