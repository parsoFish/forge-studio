---
initiative_id: INIT-2026-05-09-trafficGame-distribute-flow
project: trafficGame
project_repo_path: /tmp/trafficGame
created_at: 2026-05-09T14:00:00Z
iteration_budget: 50
cost_budget_usd: 25
phase: done
features:
  - feature_id: FEAT-1
    title: Distribute traffic flow across N lanes
    depends_on: []
---

# Initiative: trafficGame — distribute traffic flow

The traffic simulation needs a flow-distribution helper that splits a
single-lane volume across N parallel lanes per a configurable weight vector.

## Features

### FEAT-1 — `distributeFlow(volume, weights)`

`src/flow.ts` exports `distributeFlow(volume: number, weights: number[]): number[]`
that returns a vector of per-lane volumes:

- Sum of output equals input volume (within float rounding).
- Output respects weight ratios (no clamp to integer).
- Negative volume → throws.
- Empty weights array → throws.
- Zero-sum weights → throws (degenerate ratio).
- Non-finite weights (NaN / Infinity) → throws.

Tests in `tests/distribute-flow.test.ts` cover all six cases.
