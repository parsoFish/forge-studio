---
title: Derive status, don't store it — the constructive cure for declared-data-fails-open
description: A read-only aggregate (a dashboard, a card, a health strip) that computes each object's status from the source-of-truth run model — and gives the object type NO status field of its own — cannot fail open, because a wrong implementation has nowhere to read a stale value from. The inverse of the declared-data-fails-open trap.
category: pattern
keywords:
  - derive-dont-declare
  - derive-status-dont-store
  - declared-data-fails-open
  - single-source-of-truth
  - run-model
  - home-dashboard
  - no-new-polling
created_at: 2026-08-14
updated_at: 2026-08-14
related_themes:
  - declared-data-fails-open
  - per-kb-health-honesty-na-invariant
---

# Derive status, don't store it

The campaign's #1 recurring defect is [[declared-data-fails-open]]: a field is declared, parsed, surfaced, and enforced nowhere, and the test suite passes because the acceptance test builds the carrier object by hand. R6-07 (the Home dashboard, batch F) shipped the **constructive inverse** — a design that makes the class structurally impossible for its surface:

- Home renders every active flow/agent/project/KB as a hex with a live status. That status is **derived** at render time: `deriveFlowStatus(id) = runs.filter(r => r.flowId === id || r.flowLineage.includes(id))`, `deriveAgentStatus` walks `run.phases`. Both byte-match the per-surface monitors' own derivations.
- Critically, the `Flow` / `Agent` / `Project` / `Kb` objects **carry no `.status` field at all.** There is no stored value to drift. A wrong implementation of the derivation has *nowhere to read a stale status from* — it must recompute from the run model or render nothing.
- The aggregate reused the monitors' existing run-model/bridge reads — **no new polling path** (zero `setInterval`, zero `new WebSocket`, zero raw `/api`; the request-path-sinks baseline was unchanged). The acceptance was proven against a real ≥2-project on-disk fixture, not a hand-built row.

## The rule

When a surface must show a status/health/state that another surface already owns:

1. **Derive it from the shared source of truth** (the run model, the bridge read) at the point of render. Do not add a `.status` field to the object and populate it from somewhere.
2. **Byte-match the owning surface's derivation** — extract the shared function; two copies drift ([[declared-data-fails-open]]'s `FALLBACK_SESSION_KINDS` and `FlowCard`-ignores-`flowLineage` instances).
3. **Reuse the existing reads** — a new aggregate should add no new fetch loop. If it seems to need one (e.g. a list-level health that requires per-item server work), that is a real cost to surface as report-don't-patch, not to smuggle in as N background polls.

A stored status is a liability the moment a second writer or a missing writer exists. A derived status is correct-by-construction as long as its one source is.
