# Migration Source-to-Target Backfill Plan

**Project:** Agent Observatory - Mission Control to Agent Observatory Migration  
**Date:** 2026-03-04  
**Status:** Active

This document defines deterministic source-to-target mappings for migration backfill entities, plus transformation and null-handling rules needed for reproducible execution.

---

## 1. Scope and Assumptions

- In scope entities: `Tasks`, `Reviews`, `Notifications`, `Activities`, `Webhooks`
- Source system: mission-control operational store (legacy)
- Target system: agent-observatory ops domain store
- Timezone normalization: all timestamps converted to UTC before write
- This story covers mapping and transformation policy only; idempotency/upsert policy is defined separately

---

## 2. Entity Mapping Overview

| Entity | Source Table/View | Target Table | Primary Identifier Mapping | Required Partition Key |
|---|---|---|---|---|
| Tasks | `mc_tasks` | `tasks` | `mc_tasks.id -> tasks.task_id` | `workspace_id` |
| Reviews | `mc_reviews` | `reviews` | `mc_reviews.id -> reviews.review_id` | `workspace_id` |
| Notifications | `mc_notifications` | `notifications` | `mc_notifications.id -> notifications.notification_id` | `workspace_id` |
| Activities | `mc_activities` | `activities` | `mc_activities.id -> activities.activity_id` | `workspace_id` |
| Webhooks | `mc_webhooks` | `webhooks` | `mc_webhooks.id -> webhooks.webhook_id` | `workspace_id` |

---

## 3. Field Transformation and Null-Handling Policy

### 3.1 Tasks

| Source Field | Target Field | Transformation Rule | Null-Handling Rule |
|---|---|---|---|
| `id` | `task_id` | Copy as stable string identifier | Skip record if null |
| `workspace_id` | `workspace_id` | Copy; trim surrounding whitespace | Skip record if null |
| `title` | `title` | Trim; collapse internal repeated spaces | Use `"Untitled Task"` when null or empty |
| `description` | `description` | Preserve markdown/plain text as-is | Set to empty string when null |
| `status` | `status` | Normalize to lowercase enum (`pending`, `in_progress`, `done`, `blocked`) | Default to `pending` when null |
| `assignee_id` | `assignee_id` | Copy string ID | Keep null (unassigned) |
| `created_at` | `created_at` | Parse source datetime and convert to UTC | Skip record if null or unparsable |
| `updated_at` | `updated_at` | Parse source datetime and convert to UTC | Use `created_at` when null |
| `updated_by` | `actor` | Prefix with `user:` or `service:` when known | Set to `system` when null |

### 3.2 Reviews

| Source Field | Target Field | Transformation Rule | Null-Handling Rule |
|---|---|---|---|
| `id` | `review_id` | Copy as stable string identifier | Skip record if null |
| `workspace_id` | `workspace_id` | Copy directly | Skip record if null |
| `task_id` | `task_id` | Copy and validate referenced task exists in target scope | Skip record if null |
| `reviewer_id` | `reviewer_id` | Copy principal identifier | Set to `unknown-reviewer` when null |
| `decision` | `decision` | Normalize to enum (`approved`, `changes_requested`, `rejected`, `pending`) | Default to `pending` when null |
| `comment` | `comment` | Preserve text payload | Set to empty string when null |
| `created_at` | `created_at` | Parse source datetime and convert to UTC | Skip record if null or unparsable |
| `updated_at` | `updated_at` | Parse source datetime and convert to UTC | Use `created_at` when null |
| `updated_by` | `actor` | Map principal format (`user:<id>`, `service:<name>`) | Set to `system` when null |

### 3.3 Notifications

| Source Field | Target Field | Transformation Rule | Null-Handling Rule |
|---|---|---|---|
| `id` | `notification_id` | Copy as stable string identifier | Skip record if null |
| `workspace_id` | `workspace_id` | Copy directly | Skip record if null |
| `recipient_id` | `recipient_id` | Copy user/principal identifier | Skip record if null |
| `channel` | `channel` | Normalize channel names (`email`, `in_app`, `webhook`, `sms`) | Default to `in_app` when null |
| `payload` | `payload_json` | Validate JSON; canonicalize key ordering before write | Use `{}` when null; skip if invalid JSON string |
| `delivered_at` | `delivered_at` | Parse source datetime and convert to UTC | Keep null when not delivered |
| `read_at` | `read_at` | Parse source datetime and convert to UTC | Keep null when unread |
| `created_at` | `created_at` | Parse source datetime and convert to UTC | Skip record if null or unparsable |
| `updated_at` | `updated_at` | Parse source datetime and convert to UTC | Use `created_at` when null |
| `updated_by` | `actor` | Map principal format | Set to `system` when null |

### 3.4 Activities

| Source Field | Target Field | Transformation Rule | Null-Handling Rule |
|---|---|---|---|
| `id` | `activity_id` | Copy as stable string identifier | Skip record if null |
| `workspace_id` | `workspace_id` | Copy directly | Skip record if null |
| `entity_type` | `entity_type` | Normalize to lowercase snake_case | Skip record if null |
| `entity_id` | `entity_id` | Copy related business identifier | Skip record if null |
| `event_name` | `event_name` | Normalize to lowercase snake_case | Skip record if null |
| `metadata` | `metadata_json` | Validate JSON and redact disallowed keys (`token`, `secret`) | Use `{}` when null; skip if invalid JSON string |
| `occurred_at` | `occurred_at` | Parse source datetime and convert to UTC | Skip record if null or unparsable |
| `created_at` | `created_at` | Parse source datetime and convert to UTC | Use `occurred_at` when null |
| `updated_at` | `updated_at` | Parse source datetime and convert to UTC | Use `created_at` when null |
| `updated_by` | `actor` | Map principal format | Set to `system` when null |

### 3.5 Webhooks

| Source Field | Target Field | Transformation Rule | Null-Handling Rule |
|---|---|---|---|
| `id` | `webhook_id` | Copy as stable string identifier | Skip record if null |
| `workspace_id` | `workspace_id` | Copy directly | Skip record if null |
| `endpoint_url` | `endpoint_url` | Trim and validate URL scheme (`https` only) | Skip record if null, empty, or invalid URL |
| `event_type` | `event_type` | Normalize event type to lowercase dot notation | Skip record if null |
| `secret_hash` | `secret_hash` | Copy pre-hashed value only; never re-hash plaintext | Set to `null` and flag for rotation when null |
| `is_active` | `is_active` | Parse truthy/falsy source value to boolean | Default to `true` when null |
| `last_delivery_at` | `last_delivery_at` | Parse source datetime and convert to UTC | Keep null when no delivery history |
| `created_at` | `created_at` | Parse source datetime and convert to UTC | Skip record if null or unparsable |
| `updated_at` | `updated_at` | Parse source datetime and convert to UTC | Use `created_at` when null |
| `updated_by` | `actor` | Map principal format | Set to `system` when null |

---

## 4. Unsupported Records Handling and Skip Policy

Records that cannot satisfy minimum target integrity are excluded from target writes using the skip rules below.

### 4.1 Skip Categories

| Skip Code | Condition | Required Action |
|---|---|---|
| `SKIP_MISSING_PRIMARY_ID` | Entity identifier is null/empty | Do not write record; count as skipped |
| `SKIP_MISSING_WORKSPACE` | `workspace_id` is null/empty | Do not write record; count as skipped |
| `SKIP_INVALID_TIMESTAMP` | Required timestamp is unparsable | Do not write record; count as skipped |
| `SKIP_INVALID_JSON` | JSON field is malformed and cannot be parsed | Do not write record; count as skipped |
| `SKIP_INVALID_REFERENCE` | Required foreign reference is missing in scoped backfill set | Do not write record; count as skipped |
| `SKIP_INVALID_WEBHOOK_URL` | Webhook URL is not HTTPS/valid | Do not write record; count as skipped |

### 4.2 Unsupported Record Types

- Hard-deleted source rows without retrievable payload/history
- Records with encrypted fields that cannot be decrypted with approved migration keys
- Records tied to deprovisioned workspaces excluded by the current migration scope
- Records violating legal/compliance hold constraints that require case-by-case review

Unsupported records are skipped and emitted to the backfill exception report for manual triage.

### 4.3 Exception Reporting Requirements

For every skipped record, the backfill job must emit:

- `entity`
- `source_primary_id`
- `workspace_id` (if present)
- `skip_code`
- `skip_reason`
- `observed_at_utc`

The exception report is retained for 30 days and reviewed before phase advancement.

---

## 5. Validation Checklist

- All five in-scope entities have explicit source-to-target mapping definitions
- Every mapped field defines transformation and null-handling behavior
- Unsupported record conditions are explicit and categorized with skip codes
- Skip output includes enough metadata for deterministic manual replay/triage
