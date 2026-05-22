---
title: Grading-frontier infrastructure — parametric sweeps + locked baselines + curated screenshots as the tight-loop layer for map-design ideation
description: scripts/grading/runSweep.mjs is the reusable parallel sweep library; ~30 lines per new theory. docs/baselines/ locks the headline numbers. docs/baselines/screenshots/ is the curated visual reference. Together they make "is this design better" a measurable score-delta, not a prose argument.
category: pattern
keywords: [grading, sweep, parametric, baselines, frontier, parallel, playwright, runsweep, map-design, ideation, fanout]
created_at: 2026-05-23T00:00:00Z
updated_at: 2026-05-23T00:00:00Z
related_themes: [2026-05-23-binary-elevation-model, 2026-05-10-test-stack-and-gates, canvas-bpr-flow-tests]
---

# Grading-frontier infrastructure

The trafficGame simulation has a holistic measurable outcome —
**throughput in vehicles per simulation-second** with the constraint
**0 severe overlaps** (no two cars within 20 px at the same elevation).
Once that pair existed as a single number per run, scientific
exploration of map-design theories became cheap, and the project's
tight loop shifted from "guess and look" to "sweep and lock."

The infrastructure is three pieces:

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

## 2. `docs/baselines/` — the locks

Three per-theory frontier docs:

- `grading-frontier-roundabouts.md` — square ring radii. Locks
  `r=300 → 1.921 v/sim-s, 0 severe` as the anti-collision baseline.
- `grading-frontier-grids.md` — `#` grid lane spacings. Locks
  `s=60 → 1.236 v/sim-s, 0 severe` as the plain-grid baseline.
- `grading-frontier-cross-theories.md` — 7+ design hypotheses
  measured against each other (ring segments, ring offset, hybrid
  grid+roundabout, grid+elevation, elevated split-grid, bypass-bays,
  roundabout+elevation). Carries the current frontier headline:
  **elevated split-grid s=400 = 3.314 v/sim-s, 0 severe (+72%)**.

Every commit on the collision/elevation arc was checked against the
two locked baselines. Drifting outside ±1% of the locked numbers
required a deliberate explanation; otherwise the change reverted.

## 3. `docs/baselines/screenshots/INDEX.md` — the visual reference

Mid-simulation screenshots (≈20–25 sim-s, time-scale 20×) of the
notable designs. Each shot is tagged with its sweep throughput and
severe-overlap count. Includes both frontier champions and **negative
examples** (e.g., `polygon-N12-r200` at 0.414 v/s with 14 severe
overlaps; the pre-fix elevation-deadlock at `elev-grid-s60-snapshot`).

Visual evidence is load-bearing here: the numerical scores show **what**
moved; the screenshots show **why** (e.g., the entry-jam screenshot
made the IDM elevation-lookahead extension obvious).

## Why this layer works

The grading-frontier layer is the project-local instance of forge's
[eval-driven development](../../../forge/themes/eval-driven-development.md)
principle. Before it existed, the operator had to:

- Hand-draw each design
- Eyeball the sim
- Argue prose about which design "felt better"

After it exists, the operator (or an agent) can:

- Spawn 8 parallel sweeps over a parameter space
- See the score-delta in `sweep.md`
- Compare against the locked baseline in `docs/baselines/`
- Visually confirm via `docs/baselines/screenshots/`

The elevated split-grid champion (3.314 v/sim-s, +72%) was found by
this loop — operator hypothesis → parametric sweep → measured
result → re-sweep at the peak → locked. Total wall-clock per
hypothesis: minutes, not hours.

## Anti-pattern: don't grade without visualising

A few times the score went up but the screenshot revealed false
positives — e.g., the early "body-aware footprint" approach had
`s=120 = 2.286 v/s with 18 severe overlaps` that read as a high
number but was actually counting grade-separated cars as crashes.
Always pair the number with the screenshot. The screenshot index is
load-bearing for that reason.

## Sources

- [`scripts/grading/runSweep.mjs`](../../../../projects/trafficGame/scripts/grading/runSweep.mjs) — the library.
- [`scripts/grading/README.md`](../../../../projects/trafficGame/scripts/grading/README.md) — the "add a theory" guide.
- [`docs/baselines/`](../../../../projects/trafficGame/docs/baselines/) — the locks.
- Commit `146cf5c` "feat(grading): parametric sweep harness + locked design-frontier baselines" on trafficGame `main`.

## Related

- [Theme: Binary elevation model](./2026-05-23-binary-elevation-model.md) — what the harness measured.
- [Theme: Test stack and gates](./2026-05-10-test-stack-and-gates.md) — unit tests verify correctness; sweeps verify holistic performance.
- [Forge theme: Eval-driven development](../../../forge/themes/eval-driven-development.md) — the principle this implements.
