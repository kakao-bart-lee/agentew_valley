# SPEC-006: Observe-first Reset (P0)

- **Status**: IMPLEMENTING
- **Date**: 2026-03-07
- **Depends on**: `docs/S-005-observatory-domain-redesign.md`

## Why this exists

Agent Observatory accumulated useful task/governance features, but the product drifted away from its clearest value:

> show what Claude Code, OpenClaw, Codex/OMX, and OpenCode are doing right now.

P0 restores that center of gravity without unsafe deletion.

## What P0 changes

### 1. Canonical runtime taxonomy

The envelope is no longer forced to overload `source` with every meaning.

- `source` = ingestion source (`claude_code`, `openclaw`, `omx`, `codex`, `opencode`, ...)
- `runtime` = canonical runtime descriptor
  - `family` (for example `codex`)
  - `orchestrator` (for example `omx`)
  - `client` (for example `jsonl`, `hooks`, `sqlite`, `omx`)

This lets us express:

- Claude Code = `source=claude_code`, `runtime.family=claude_code`
- OpenClaw = `source=openclaw`, `runtime.family=openclaw`
- Codex via OMX = `source=omx`, `runtime.family=codex`, `runtime.orchestrator=omx`
- OpenCode = `source=opencode`, `runtime.family=opencode`

### 2. Provenance + dedupe scaffolding

Every event can now carry `provenance` metadata:

- `ingestion_kind`
- `source_event_id`
- `source_event_fingerprint`
- `source_path`
- `source_offset`
- `raw_event_type`
- `received_at`
- `dedupe_key`

The current implementation stores this scaffolding in SQLite so later collector work can dedupe Claude JSONL and Claude hooks against a shared canonical fingerprint instead of only comparing generated `event_id`.

### 3. Task-context provider seam

Paperclip should become the task control plane, but Observatory still needs a stable way to *show* linked work.

P0 introduces:

- `task_context` on events / agent state / session summaries
- `TaskContextProvider` server boundary
- `HistoryStoreTaskContextProvider` as the default local implementation
- read-only API endpoints:
  - `GET /api/v1/sessions/:id/context`
  - `GET /api/v1/agents/:id/context`

This is the seam future Paperclip overlays should plug into.

### 4. Observe-first shell pruning

The web shell now defaults to **Observe**.

- `Observe` stays primary
- `Overview`, `Work`, `Control`, `Admin` remain reachable
- those legacy surfaces are visually marked as transition surfaces

This keeps existing functionality accessible while clarifying that live runtime activity is the main product.

## Keep / de-emphasize / remove later

| Surface | P0 action | Note |
|---|---|---|
| Observe | keep primary | default landing view |
| Overview | keep but de-emphasize | transition surface |
| Work | keep but de-emphasize | future task overlay / read-only bias |
| Control | keep but de-emphasize | still useful for approvals/audit/adapters |
| Admin | keep isolated | migration/debug only |
| Mission Control center-of-product framing | remove | keep only as underlying legacy implementation details |

## Explicit non-goals for P0

- No Paperclip write/edit/board clone
- No OpenCode collector implementation yet
- No Claude JSONL/hook dedupe behavior change yet
- No deletion of task/governance tables or views yet

## P1 next

1. Claude JSONL parser modernization + hook dedupe
2. OpenClaw transcript + `sessions.json` merge
3. OMX runtime/state/log parity
4. Real OpenCode collector (`opencode.db` + ACP mapping)
5. Richer evidence panel on the Observe detail rail
