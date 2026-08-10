---
title: ADR-042 ask-first parks recur on per-agent runners — the generic interactive-surface primitive dissolves the pressure
description: A new orchestrator/ runtime executor (a GATE_KIND row, an interactive *-runner.ts) is ADR-042 ask-first and it parked three times in batch D (R4-18, R4-19-F2 mislabelled, R4-21). Three parks for structurally the same ask is the signal to generalise — the operator-directed generic, operator-authorable interactive-surface primitive (input/output-artifact-like, multi-instance) is the principled generalisation that dissolves the per-agent-runner cap pressure.
category: decision
keywords:
  - adr-042
  - surface-cap
  - ask-first-park
  - per-agent-runner
  - gate-kind-row
  - generic-interactive-surface
  - operator-authorable
  - runnable-primitive
  - recurrence-is-the-signal
created_at: 2026-08-10
updated_at: 2026-08-10
related_themes:
  - new-session-kind-needs-ui-wiring
  - orchestrator-owned-execution-beats-heuristic-verification
  - forge-ui-data-attribute-contract-discipline
---

# ADR-042 parks recur on per-agent runners — generalise to one primitive

A new `orchestrator/` runtime executor — a `GATE_KIND` registry row, an interactive `*-runner.ts` — grows the capped surface, so under [ADR 042](../../../docs/decisions/042-surface-cap-scope-and-testability.md) it is **ask-first**, not disclose-not-park. That is correct per-instance. But in **batch D the identical ask parked three times**:

- **R4-18** — a new interactive runner / gate-kind executor.
- **R4-19-F2** — the same shape, initially **mislabelled** as something other than a new executor; it was one.
- **R4-21** — a new interactive session kind whose runner is again a new `orchestrator/` executor (see [[new-session-kind-needs-ui-wiring]]).

Three parks for one structural ask is not three decisions — it is one missing abstraction surfacing three times. **Recurrence is the signal to generalise.**

## The decision — one operator-authorable primitive, not N runners

The principled generalisation is a **single generic, operator-authorable interactive-surface primitive**, sized like the existing input/output-artifact primitives:

- **Artifact-like** — modelled on the input/output-artifact primitives already inside the cap, so it adds one general seam rather than one executor per kind.
- **Operator-authorable** — new interactive surfaces are authored as data/registry entries on the primitive, the way OOTB artifacts are, **not** as new hand-written per-agent runner files under `orchestrator/`.
- **Multi-instance** — one primitive backs many concrete interactive kinds, so a fourth kind is a registry entry, not a fourth ADR-042 park.

This dissolves the per-agent-runner cap pressure at the root: with the primitive in place, adding an interactive kind stops being an `orchestrator/`-surface ask at all — it becomes authoring on an already-ratified seam, exactly the artifact-migration direction ADR-024's R4-01 opened (moving phases onto the generic runnable primitive rather than bespoke invocation prose). It keeps the `PhaseAgentSpec` overlay seam clean and honours the cap's intent (bound the hot path) without re-litigating it per kind.

## Standing rule

- One new interactive `orchestrator/` executor → ask-first, as ADR-042 says.
- The **second** structurally-identical ask → stop and propose the primitive, not a third runner. Batch D reached three before this page existed.

## Sources

- [`docs/decisions/042-surface-cap-scope-and-testability.md`](../../../docs/decisions/042-surface-cap-scope-and-testability.md) — the surface-cap scope and the ask-first boundary.
- [`docs/decisions/024-phases-as-subagents-invoking-skills.md`](../../../docs/decisions/024-phases-as-subagents-invoking-skills.md) — the generic runnable-primitive / artifact-migration direction (R4-01).
- `_wave5/ledger.md` (gitignored campaign state) — R4-18, R4-19-F2 (mislabelled), R4-21 park points, batch D region.

## See also

- [[new-session-kind-needs-ui-wiring]] — the R4-21 runner layer, the third recurrence.
- [[orchestrator-owned-execution-beats-heuristic-verification]] — why the executor belongs in the orchestrator at all, once generalised.
