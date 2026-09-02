---
title: >-
  Locked baselines and curated screenshots — why a sweep number is not
  trustworthy without a picture
description: >-
  docs/baselines/ locks the headline numbers (roundabout r=300 = 1.921 v/sim-s,
  plain grid s=60 = 1.236, frontier elevated split-grid s=400 = 3.314, all
  0 severe) and every commit on the collision arc was checked against them.
  docs/baselines/screenshots/ is the curated visual reference, including
  negative examples — because a score can rise while the screenshot shows the
  run was counting grade-separated cars as crashes.
category: pattern
keywords:
  - grading
  - baselines
  - frontier
  - screenshots
  - visual-evidence
  - eval-driven-development
  - map-design
  - ideation
  - false-positive
created_at: 2026-05-23T00:00:00.000Z
updated_at: 2026-05-23T00:00:00.000Z
related_themes: [2026-05-23-grading-frontier-infrastructure, 2026-05-23-binary-elevation-model, 2026-05-10-test-stack-and-gates]
---

# Locked baselines and curated screenshots

Split out of [[2026-05-23-grading-frontier-infrastructure]]: that page records
the sweep harness that produces a number, this one records what the number is
compared against and why it is never read on its own. These are pieces 2 and 3
of the three-piece grading layer.

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
[eval-driven development](../../../cycles/themes/eval-driven-development.md)
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

- [`docs/baselines/`](../../../../projects/trafficGame/docs/baselines/) — the locks.
- [`projects/trafficGame/scripts/grading/runSweep.mjs`](../../../../projects/trafficGame/scripts/grading/runSweep.mjs) — the library that produces the numbers.
- Commit `146cf5c` "feat(grading): parametric sweep harness + locked design-frontier baselines" on trafficGame `main`.

## See also

- [[2026-05-23-grading-frontier-infrastructure]] — the harness that produces the numbers locked here.
- [[2026-05-23-binary-elevation-model]] — the decision these baselines guarded.
- [[2026-05-10-test-stack-and-gates]] — unit tests verify correctness; sweeps verify holistic performance.
