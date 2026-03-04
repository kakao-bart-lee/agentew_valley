# ADR-0000: Template and Lifecycle Rules

**Status:** Accepted  
**Date:** 2026-03-04  
**Owners:** Architecture Owner, Domain Primary DRI

This document defines the standard naming convention, status lifecycle, and required sections for all migration ADRs.

---

## Naming Rules

- File path: `docs/adr/NNNN-short-kebab-title.md`
- Identifier format: `ADR-NNNN` (zero-padded 4 digits)
- The numeric ID in the filename, title, and metadata must match exactly.
- IDs are allocated sequentially. Do not reuse or renumber existing IDs.
- When a new ADR ID is reserved, update `docs/migration/ownership-and-adr.md` planned ADR mapping before implementation starts.

Example:

- File: `docs/adr/0013-task-cutover-decision.md`
- Title: `# ADR-0013: Task Cutover Decision`

---

## Status Lifecycle

Allowed statuses:

- `Proposed`: Drafted and under review.
- `Accepted`: Approved and authoritative.
- `Rejected`: Reviewed and explicitly not adopted.
- `Deprecated`: Still documented but no longer recommended for new changes.
- `Superseded by ADR-NNNN`: Replaced by a newer accepted ADR.

### Transition Rules

| Current Status | Allowed Next Status | Transition Requirement |
|---|---|---|
| Proposed | Accepted | Approval roles defined in `docs/migration/ownership-and-adr.md` complete sign-off |
| Proposed | Rejected | Review completed and rejection rationale recorded |
| Accepted | Deprecated | New policy invalidates prior decision for future work |
| Accepted | Superseded by ADR-NNNN | Replacement ADR is accepted and cross-linked in both ADRs |
| Deprecated | Superseded by ADR-NNNN | A replacement ADR is accepted and references the deprecated ADR |

Lifecycle constraints:

- Do not delete historical ADRs.
- Do not silently edit historical decisions; add a superseding ADR when decision logic changes.
- Every superseded ADR must link to its replacement, and the replacement must link back.

---

## Required Sections (Per ADR)

Every ADR file must include these sections in order:

1. `Title` (`# ADR-NNNN: ...`)
2. `Status`
3. `Date`
4. `Owners`
5. `Context`
6. `Decision`
7. `Alternatives Considered`
8. `Consequences`
9. `Rollout / Migration Impact`
10. `Validation / Observability`
11. `References`

Optional sections may be added after required sections when needed (for example, `Security Considerations`).

---

## ADR Template

Use the following template for new ADRs:

```markdown
# ADR-NNNN: <Decision Title>

**Status:** Proposed
**Date:** YYYY-MM-DD
**Owners:** <Role/Name>, <Role/Name>
**Related Domains:** <Auth/Task/Webhook/...>
**Related Phase:** <Phase 0-4>

## Context

<Problem statement, constraints, and why this decision is needed now.>

## Decision

<Chosen approach with clear scope boundaries and what is explicitly out of scope.>

## Alternatives Considered

1. <Alternative A> - <why rejected/accepted>
2. <Alternative B> - <why rejected/accepted>

## Consequences

- Positive:
- Negative:
- Neutral/trade-offs:

## Rollout / Migration Impact

- Affected phase(s):
- Feature flags / kill switch impacts:
- Backfill or data integrity implications:
- Rollback trigger updates required:

## Validation / Observability

- Metrics/SLO checks:
- Shadow-mode or parity checks:
- Required test evidence:

## References

- `docs/migration/ownership-and-adr.md`
- Related ADRs: ADR-XXXX, ADR-YYYY
```
