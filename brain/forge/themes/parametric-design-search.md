---
title: Parametric design search — the ideation-fanout pattern any project with a measurable outcome can use
description: trafficGame's runSweep.mjs library is ~250 lines of reusable infrastructure that turned every map-design hypothesis from prose into a ~30-line script + 10s wall-clock sweep. Pattern generalises to any project where a parameter space and a holistic metric exist; forge should expose a project-agnostic harness skeleton.
category: pattern
keywords: [parametric, sweep, ideation, fanout, parallel, playwright, runsweep, holistic-metric, exploration, harness, agentic-loop]
created_at: 2026-05-23T00:00:00Z
updated_at: 2026-05-23T00:00:00Z
related_themes: [holistic-metrics-onboarding, exploration-vs-implementation-initiatives, eval-driven-development]
---

# Parametric design search

When a project has a parameter space (variables you can tune) and a
holistic metric (a measurable outcome), the agentic loop that
designs improvements collapses to:

1. Define the parameter range
2. Sweep it in parallel
3. Read the score-delta vs the locked baseline
4. Lock the new champion

trafficGame's `scripts/grading/runSweep.mjs` is the concrete
instantiation. The pattern generalises.

## The pattern

```
function runSweep({
  label,           // names the output directory
  description,     // human-readable header in the report
  params,          // the parameter values to sweep
  paramName,       // for the report columns
  drawDesign,      // (page, canvas, param) => Promise<void>
                   // — what to actually do for each parameter value
}) {
  // 1. Spin up N parallel workers (default 8)
  // 2. Each worker pulls from a shared queue
  // 3. For each parameter value:
  //      - call drawDesign(page, canvas, param)
  //      - validate prerequisites (e.g., flows connect)
  //      - run the measurement
  //      - capture per-run JSON to raw/<param>.json
  // 4. Aggregate into sweep.csv + sweep.md
  // 5. Markdown includes "best" and "worst" sections
}
```

Adding a new theory is **~30 lines** (parameter range + draw
function). The pattern's reusable parts are ~250 lines (the worker
pool, dev-server wiring, output formatting, validation).

## Why this is a tight loop

The wall-clock budget per hypothesis is **minutes**, not hours:

- 10 parameter values × 60 simulation-seconds × 20× time-scale =
  600 sim-seconds simulated
- 8 parallel workers, ~10 s wall-clock total

A human running designs by hand would do maybe 2–3 per hour. The
agentic loop running parametric sweeps does **8 per minute**. This
opens up styles of ideation that aren't viable in the slow loop:

- **Coarse-then-fine sweep**: try `s ∈ {50, 100, 150, 200, 300, 400}`
  first, then narrow to `s ∈ [350, 450]` around the peak.
- **Cross-parameter combo**: hold one parameter at its best, vary
  another, repeat.
- **Negative-example collection**: include known-bad configurations
  (e.g., polygon-N=12 with 14 severe overlaps) so the screenshot
  index documents failure modes.
- **Regression-budget enforcement**: every PR re-runs the locked
  baselines to verify ±1%.

## Generalisation to other projects

The pattern doesn't care that trafficGame's parameter space is "road
geometry" and its metric is "vehicles per simulation-second." Any
project with:

- A **parameter space** (continuous or discrete)
- A **measurement command** (produces a scalar or pair of scalars
  in a bounded time budget)
- A **reproducible testbed** (same conditions every run)

can use this loop. Concrete examples:

- **A web app**: parameter = response cache TTL; metric = p95
  end-to-end latency on a fixed request mix.
- **A compiler**: parameter = inlining threshold; metric = (runtime,
  binary size) on a fixed benchmark suite.
- **An ML training pipeline**: parameter = learning rate; metric =
  validation accuracy at fixed compute budget.
- **A scheduler**: parameter = quantum length; metric = (throughput,
  tail latency) under a fixed workload.

## What forge should provide

A project-agnostic harness skeleton:

- A **parallel worker pool** with a shared queue
- A **measurement protocol** (start the system, capture the scalar,
  tear down cleanly)
- An **output format** (CSV + markdown + raw JSON per run) that the
  reviewer skill can consume to compute deltas

The per-project bits are:

- How to start the system under test (`page.goto` in trafficGame's
  case)
- The parameter draw function
- The measurement extractor (read the scalar from the running system)

This is roughly the shape of forge's `benchmarks/<phase>/` runners
but at the project level rather than the agent-phase level. A new
forge skill — call it `project-sweep` — could be the project-agnostic
runner.

## Anti-pattern: don't sweep without a regression budget

A sweep that finds a new champion is only valuable if it doesn't
secretly regress something else. trafficGame's discipline: every
collision/elevation iteration was checked against:

- `roundabout r=300 = 1.921 v/sim-s` (anti-collision lock)
- `# grid s=60 = 1.236 v/sim-s` (plain-grid lock)

Both within ±1%, every commit. The new champion (elevated split-grid
s=400 = 3.314 v/sim-s) is meaningful BECAUSE the locks held. Without
the regression budget, a "champion" might just be a regression on
something invisible.

## Anti-pattern: don't sweep without visualising

A few times the score went up but the screenshot revealed it was
counting noise — e.g., grade-separated cars logged as severe overlaps
before the binary elevation model. The visual confirmation step is
non-optional. The screenshot index is part of the deliverable, not an
afterthought.

## Sources

- [`projects/trafficGame/scripts/grading/runSweep.mjs`](../../../projects/trafficGame/scripts/grading/runSweep.mjs) — the reference implementation.
- [`projects/trafficGame/scripts/grading/README.md`](../../../projects/trafficGame/scripts/grading/README.md) — the "add a theory" guide.
- PR #57 — 8 theories graded against each other inside this loop.

## Related

- [Theme: Holistic metrics onboarding](./holistic-metrics-onboarding.md) — what the harness measures.
- [Theme: Exploration vs implementation initiatives](./exploration-vs-implementation-initiatives.md) — what kind of initiative this is.
- [Theme: Eval-driven development](./eval-driven-development.md) — the principle.
