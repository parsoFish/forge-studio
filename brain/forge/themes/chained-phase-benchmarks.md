---
title: An e2e test is a seed at the front of the chain — not a benchmark with its own rubric
description: Keep the isolated per-phase benches. "Chained" means each phase bench's generated output is the next phase bench's input, scored by the existing per-phase pure rubrics. An end-to-end test is a SEED fed into the architect bench, never a standalone fixture+rubric. Eliminate benchmarks/e2e's bespoke rubric; keep only its plumbing in _lib. Plus 3 isolated-bench drift corrections.
category: decision
keywords: [benchmarks, chained, e2e-as-seed, no-standalone-e2e-rubric, phase-isolation, drift, false-green, false-red, runCycle-as-engine, scoring-pure, simplification]
created_at: 2026-05-16T00:00:00Z
updated_at: 2026-05-16T00:00:00Z
related_themes: [phase-isolation-benchmarks, eval-driven-development, forge-current-architecture-as-built, brain-read-policy]
---

# An e2e test is a seed, not a separate benchmark

The operator's correction, load-bearing: a chained benchmark must
**purely tie the existing per-phase benchmarks together** and must NOT
introduce an end-to-end benchmark that owns its own fixtures or scoring.

**The model.** An end-to-end test is **one seed** (an architect-level
intent/prompt) fed into the **front** of the chain. The chain *is* the
existing per-phase benches in sequence: the architect bench scores the
generated manifest with `benchmarks/architect/scoring.ts`; that manifest
is the **input** to the project-manager bench (replacing its golden
fixture), scored with `benchmarks/project-manager/scoring.ts`; its WIs
feed the developer-loop bench; that branch feeds the review-loop bench;
that merged state feeds the reflection bench — each scored by its
**existing pure** `caseScore`. There is **no separate e2e rubric** and
**no chained-only fixture**. The overall-cycle signal is just "every
per-phase rubric passed on chained (generated) inputs"; a chain break at
phase N is simply phase N's existing bench failing on phase N-1's
output.

**Eliminate the standalone e2e benchmark.** `benchmarks/e2e/` today owns
a `slugifier-basic` fixture **and** a bespoke rubric (gate
`cycle_completed` + merged/converged/spec_satisfied/cost/no_regression).
That is the anti-pattern. Delete `benchmarks/e2e/scoring.ts` and the
fixture's status as a self-scored unit; the slugifier intent becomes one
chain *seed*. Only its **plumbing** survives, relocated to
`benchmarks/_lib/`: the smart gh-shim,
`reconstructGateStateFromEventLog`, the recorder shims, a lifted
`brain-mask.ts`. The sequencing **engine** is the real product path
(`runCycle` already runs PM→dev→review→reflect; the chain only prepends
a real architect invocation + a `cpSync` `pending/`→`in-flight/`).
`runCycle` is the engine, not a rubric — all scoring stays in the six
existing per-phase rubrics. One rubric set, two input sources
(golden for isolated edge cases via `--source` switch; chained for the
e2e seed).

**Drift corrections (independent, correctness):** (1) project-manager
`sdk.ts` cwd→worktree + budget 0.75→2.5 (F-37/F-42, false-red);
(2) drop review-loop's `brainConsulted` 0.10 (F-41 — reviewer correctly
no longer reads brain, [[brain-read-policy]]; false-red); (3) replace
review-loop's one-shot `sdkQuery` with the real `runReviewer` path
(false-green). The removed F-36 path validator was never benched.
Closure goals G11 (bench fidelity) + G12 (chained = existing benches
only; no `benchmarks/e2e/scoring.ts` or any chained-only rubric).

## Sources

- [`benchmark-alignment.md`](../../../_logs/2026-05-16_trafficgame-arc-reflection/benchmark-alignment.md) — §A drift table, §C corrected design, G11/G12.
- [`2026-05-16_trafficgame-arc-reflection.md`](../../_raw/cycles/2026-05-16_trafficgame-arc-reflection.md) — cycle archive: the F-24…F-44 changes that caused the drift.

## Related

- [Theme: Phase isolation benchmarks](./phase-isolation-benchmarks.md) — the isolation the chain preserves (chain reuses the same rubrics).
- [Theme: Eval-driven development](./eval-driven-development.md) — why bench fidelity is load-bearing.
- [Theme: Brain-read policy](./brain-read-policy.md) — why the review-loop brain criterion must go.
