---
title: >-
  Grading-frontier harness — one parallel sweep library turns a map-design
  theory into a throughput number in ~30 lines and ~10 seconds
description: >-
  scripts/grading/runSweep.mjs is the reusable parallel sweep library: ~30 lines
  per new theory, one headless browser and 8 Playwright contexts, throughput in
  vehicles per simulation-second with a 0-severe-overlap constraint. What is
  done with those numbers is recorded separately.
category: pattern
keywords:
  - grading
  - sweep
  - parametric
  - baselines
  - frontier
  - parallel
  - playwright
  - runsweep
  - map-design
  - ideation
  - fanout
created_at: 2026-05-23T00:00:00.000Z
updated_at: 2026-05-23T00:00:00.000Z
related_themes: [2026-05-10-test-stack-and-gates, 2026-05-23-binary-elevation-model, canvas-bpr-flow-tests, 2026-05-23-grading-frontier-baselines-and-screenshots]
---

# Grading-frontier harness

The trafficGame simulation has a holistic measurable outcome —
**throughput in vehicles per simulation-second** with the constraint
**0 severe overlaps** (no two cars within 20 px at the same elevation).
Once that pair existed as a single number per run, scientific
exploration of map-design theories became cheap, and the project's
tight loop shifted from "guess and look" to "sweep and lock."

The infrastructure is three pieces. This page records the first — the
measurement library. The locks, the screenshot index and the loop they enable
are in [[2026-05-23-grading-frontier-baselines-and-screenshots]].

## 1. `scripts/grading/runSweep.mjs` — the reusable parallel library

A new map-design theory is **~30 lines**:

```js
import { runSweep, drawRoad, setElevation } from './runSweep.mjs';

await runSweep({
  label: 'your-theory',
  description: 'What you tested',
  params: [50, 100, 150, 200],
  paramName: 'someParam',
  drawDesign: async (page, canvas, param) => {
    await drawRoad(page, canvas, x1, y1, x2, y2);
    // ... draw the design for this parameter value
  },
});
```

The library handles everything else:

- **One headless browser, N parallel Playwright contexts** (default 8
  workers). Workers pull from a shared queue.
- **Dev-server wiring**: each context navigates to
  `http://localhost:5173/?testMap=crossroads`, calls the caller's
  `drawDesign` against the canvas, validates that all 12 required
  flows connect (otherwise reports `SKIPPED`).
- **In-sim measurement**: starts the sim at `TIME_SCALE × 20` and
  reads the `OverlapTracker` stats every 200 ms until
  `SIM_DURATION_S × 60` ticks have been observed (60 sim-s default).
- **Output**: `/tmp/grading-<label>/sweep.csv`, `sweep.md`,
  `raw/<param>.json` — markdown report includes "best severe-clean"
  and "worst configuration" sections.

A typical sweep (10 parameters × 60 sim-s × 20× speed, 8 parallel
workers) takes **~10 s wall-clock**.

## Sources

- [`scripts/grading/runSweep.mjs`](../../../../projects/trafficGame/scripts/grading/runSweep.mjs) — the library.
- [`scripts/grading/README.md`](../../../../projects/trafficGame/scripts/grading/README.md) — the "add a theory" guide.
- Commit `146cf5c` "feat(grading): parametric sweep harness + locked design-frontier baselines" on trafficGame `main`.

## See also

- [[2026-05-23-grading-frontier-baselines-and-screenshots]] — what the numbers are compared against, and why a number needs a picture.
- [[2026-05-23-binary-elevation-model]] — what the harness measured.
- [[2026-05-10-test-stack-and-gates]] — unit tests verify correctness; sweeps verify holistic performance.
- [[canvas-bpr-flow-tests]] — trafficgame — canvas + bpr flow regressions need visual tests.
