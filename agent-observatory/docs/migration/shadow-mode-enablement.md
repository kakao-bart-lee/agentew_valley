# Shadow Mode Phase Enablement

**Project:** Agent Observatory — Mission Control Migration  
**Date:** 2026-03-04  
**Status:** Active

This document defines how shadow mode is gated by environment flags and how to enable it safely in Phase 2 and Phase 3.

## Shadow Mode Flags

| Env Var | Default | Purpose |
|---|---|---|
| `OBSERVATORY_SHADOW_MODE_ENABLED` | `false` | Master switch for `/api/v1/migration/shadow-report` |
| `OBSERVATORY_SHADOW_MODE_READ_ONLY` | `true` | Enforces comparison-only operation for shadow mode |

## Behavior Contract

1. If `OBSERVATORY_SHADOW_MODE_ENABLED=false`, the API returns `503` with `SHADOW_MODE_DISABLED`.
2. If `OBSERVATORY_SHADOW_MODE_ENABLED=true` and `OBSERVATORY_SHADOW_MODE_READ_ONLY=false`, the API returns `503` with `SHADOW_MODE_READ_ONLY_REQUIRED`.
3. Shadow mode is considered active only when enabled and read-only. No write/mutation behavior is allowed in this mode.

## Phase 2 Enablement (Read-Only Parity Validation)

Use Phase 2 to compare legacy vs new responses while production traffic remains controlled.

```bash
OBSERVATORY_SHADOW_MODE_ENABLED=true
OBSERVATORY_SHADOW_MODE_READ_ONLY=true
```

Required checks:
- Confirm `/api/v1/migration/shadow-report` returns `200` and exposes `pass_count`, `fail_count`, `top_diffs`.
- Verify parity trend and top drift paths before expanding any domain rollout.

## Phase 3 Enablement (Cutover Guardrail)

Keep shadow mode on during Phase 3 progressive traffic cutover to detect regressions early.

```bash
OBSERVATORY_SHADOW_MODE_ENABLED=true
OBSERVATORY_SHADOW_MODE_READ_ONLY=true
```

Required checks:
- Continue read-only comparison during traffic ramp steps.
- Treat rising `fail_count` or repeated top diffs as rollback signals per migration SLO/error-budget policy.
- Keep `OBSERVATORY_SHADOW_MODE_READ_ONLY=true` throughout cutover; disabling read-only invalidates shadow reporting by design.
