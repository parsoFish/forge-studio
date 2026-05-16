# benchmarks/e2e/ — chain SEED + human-simulator (NOT a standalone bench)

> **There is no e2e rubric and no standalone e2e benchmark.** An end-to-end
> test is **a seed fed into the front of the chain** — see
> `benchmarks/chained/` and brain theme `chained-phase-benchmarks`.

This directory no longer owns a fixture-as-scored-unit or a bespoke rubric.
The former `score.ts` / `scoring.ts` / `cases.json` / `sdk.ts` (the
standalone `runCycle` wiring + a bespoke gate + merged/converged/spec/cost
rubric) were the isolated-e2e-with-its-own-benchmarks anti-pattern and were
deleted (Phase 5 / 1.6). What the old criteria wanted is already covered by
the per-phase rubrics run on chained (generated) inputs.

What survives here is reusable plumbing only:

```
benchmarks/e2e/
├── simulator.ts        # human-simulator agent (the chained harness's
│                       #   getVerdict provider) + runSpecChecks + TargetSpec
├── simulator.test.ts   # unit tests for the simulator
└── fixtures/
    └── slugifier-basic/  # seed reused by the chained harness
        ├── branch-state/   # seed worktree (initial main branch)
        ├── manifest.md     # an architect-shaped initiative manifest
        └── target-spec.json
```

The smart `gh` shim, `reconstructGateStateFromEventLog`, the brain-mask, and
the recorder shims were lifted to `benchmarks/_lib/` (`gh-shim.ts`,
`brain-mask.ts`, `recorder-shims.ts`) so the chained sequencer shares them.

## How an e2e test runs now

The chained harness (`benchmarks/chained/`) takes one **seed** (an
architect-level prompt), runs the architect bench → `runCycle`
(PM → dev-loop → review-Ralph → merge → reflection), and scores each phase's
**generated** output with that phase's **existing** `scoring.ts:caseScore`.
The `slugifier-basic` intent is one such seed; the `simulator.ts` here is
the verdict provider injected into `runCycle` for the review rounds.

Adding an e2e case = adding a **seed** to `benchmarks/chained/`, never a
rubric or a fixture here.
