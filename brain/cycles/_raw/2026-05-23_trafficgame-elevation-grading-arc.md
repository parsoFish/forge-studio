---
cycle_id: 2026-05-23_trafficgame-elevation-grading-arc
project: trafficGame
date_range: 2026-05-19 → 2026-05-23
type: operator-driven-conversational
related_pr: 57
related_themes:
  - 2026-05-23-binary-elevation-model
  - 2026-05-23-grading-frontier-infrastructure
  - holistic-metrics-onboarding
  - parametric-design-search
  - exploration-vs-implementation-initiatives
---

# Cycle archive — trafficGame collision/elevation + grading-frontier arc

This is a **retrospective archive** for an arc that did not run as a
forge cycle. It started as an implementation initiative
(`INIT-2026-05-19-trafficgame-backpressure-live`) and grew, through
operator-driven sessions, into a complete rebuild of the simulation's
collision and elevation systems plus the introduction of a parametric
grading harness for map-design theories.

PR #57 was merged on 2026-05-23 carrying 31 + 3 commits (~3000 LOC net).
This archive captures the trajectory, the decision points, and the
counterfactual structure of how the work could have been done as a
forge exploration cycle.

## Origin and scope-creep

**Original scope** (manifest `INIT-2026-05-19-trafficgame-backpressure-live.md`):
"wire backpressure foundation (PR #55) into the live sim + anti-collision
invariant proof." Two features, files in scope: `src/traffic/{CarFollowing,
VehicleSimulation,VehicleUpdate}.ts` + tests. iteration budget 14.

**Actual scope landed**:
- Complete rebuild of intersection-handling (FIFO-cell model → geometric
  back-edge walk in new `CollisionAvoidance.ts`).
- New `OverlapTracker.ts` for in-sim severe-overlap measurement.
- Binary elevation model (`vehicle.currentElevation` as single source of
  truth) with three-rule update in `VehicleUpdate.updateVehicleElevation`.
- Dead-code removal: `IntersectionManager`, `IntersectionPolicy`,
  `NetworkEvaluation`, `PredictiveHeatmap`, `RoadSegmentMetrics` plus
  tests (5 source files, 2 test files).
- `ElevationGraphColorizer` capped to 2 levels.
- New `scripts/grading/` directory: parallel sweep harness +
  `runSweep.mjs` library + 8 per-theory sweep scripts +
  `capture-notable.mjs` + README.
- `docs/baselines/`: three locked frontier docs + curated screenshot
  index + 14 PNG screenshots.
- ADR `docs/decisions/adr-collision-architecture-2026-05-22.md`.

How the scope grew: each fix exposed the next structural problem.
The "wire backpressure into live sim" goal required the
intersection-handling code; understanding its failure modes required
parametric sweeps; finding the right parameter ranges required a
sweep harness; comparing sweeps across designs required locked
baselines; explaining design wins required visual confirmation.

## Trajectory (rough sequence of decisions)

1. **Wire backpressure live** (the actual initiative scope). Done by
   commit `7f8d...` (the original feat commit).
2. **Backpressure feedback wedge**: cars on the H lane backpressure
   themselves into a self-feedback loop. Fixed by `9091f05` "break
   backpressure self-feedback — read DOWNSTREAM, not self."
3. **FIFO-cell deadlocks on saturated intersections**. Operator
   observed via screenshots. Fixed iteratively, then ultimately
   replaced by the geometric back-edge walk approach.
4. **Geometric back-edge walk**: route-crossing detection from the
   car's BACK edge, two-leader IDM, predictive merge detection.
   Replaces FIFO cells entirely. Tuned over multiple commits with
   constants like `BACK_EXTENSION = 28`, `MERGE_LOOKAHEAD_S = 0.35`.
5. **Locked anti-collision baseline at roundabout r=300 = 1.921 v/sim-s**.
   The grading harness was first built to lock THIS number — see
   `scripts/grading/sweep-roundabouts.mjs`.
6. **Multi-theory grading**: # grid baseline (1.236 v/s), polygonal
   rings (negative example — N=12 = 14 severes), offset ring (+90%
   over centred), hybrid, grid+elevation (BLOCKED 4/12 flows).
7. **Operator hypothesis — elevation must work**. "I'm almost
   certain you could use elevation to make good crossroads maps."
   Three iterations:
   - First attempt: H lanes elevated as single segments. BLOCKED —
     4/12 flows (no path between H and V without ramps).
   - Second attempt: SPLIT each lane at intersection points so
     shared CPs become ramps (rampElevations [0,1]). Network
     connected but throughput collapsed to 0.222 v/sim-s at s=60.
     Diagnosis: collision-avoidance + overlap-tracking were
     elevation-blind; cars at distinct elevations yielded to each
     other geometrically.
   - Third attempt: make `CollisionAvoidance.findRouteCrossing` and
     `OverlapTracker.recordTick` elevation-aware via
     `vehicle.routeElevations[]`. First pass: body-aware footprint
     spanning both elevations. Worked but plateaued at 2.905 v/s.
   - Fourth attempt: binary elevation model with three rules and the
     IDM elevation-lookahead extension (80 → 400 px). Frontier hit
     3.314 v/s at s=400, 0 severe, +72% over the locked roundabout
     baseline.
8. **Operator hypothesis — bypass-bay design**. Hand-drawn topology
   with ground crossroads + 2 elevated horizontal bypass bays.
   Sweep showed 3.030 v/s at bayY=325, bayW=200 — strong but 8.5%
   behind the split-grid because bay-endpoint kinks impose
   turn-speed-limit cycles per cross-direction trip.

## Decision points (what required operator judgment)

These are the places where the work would NOT have run autonomously
under the current forge pipeline:

- **Choosing FIFO → geometric back-edge walk** as the architectural
  direction. This was a "tear down and rebuild" move that no AC-based
  spec would have authorised.
- **The hypothesis that elevation must work**. Pure operator
  intuition. The brain themes pre-2026-05-23 said "elevation gives no
  measurable lift on crossroads" (it didn't, on the original
  single-segment design). The pivot to splitting at intersections was
  operator-driven.
- **Naming the failure modes** ("cars don't visually jump up until
  well into the elevated road" → ramp-CP early-lift; "cars flickering
  up and down" → flicker fix on transition segments; "cars at
  different levels yielding to each other" → binary model; "entry
  jam" → IDM elevation-lookahead extension). Each was a verbal
  diagnosis from screenshots.
- **Recognising when to stop**. The bypass-bay sweep peaked at 3.030
  v/s, 8.5% behind the split-grid. Operator decided not to push
  further on bypass-bays and to merge.

## Automatable steps (what the cycle could have run)

- Every parametric sweep (8 theories × ~10 parameter values each).
- Every regression check against the two locked baselines.
- Every screenshot capture.
- Every update to `docs/baselines/grading-frontier-*.md`.
- The PR description rewrite to reflect expanded scope.
- The brain theme writes (this archive + the 5 themes).

## Counterfactual — how forge could have done this

See [exploration-vs-implementation-initiatives](../../forge/themes/exploration-vs-implementation-initiatives.md)
for the proposed shape. Key elements:

- An "exploration" initiative type with `metric_command` and
  `locked_baselines` fields in the manifest.
- PM produces sweep-batch WIs (coarse → fine → regression check →
  screenshot+doc) instead of feature-decomposition WIs.
- Dev-loop runs the sweep harness rather than writing code.
- Reviewer compares score-deltas, visually inspects screenshots,
  approves or asks for next-direction exploration.

The trafficGame arc would have decomposed roughly to ~7 exploration
initiatives (one per theory: roundabouts, grids, ring-segments,
ring-offset, hybrid, grid-elevation-split, bypass-bays), each with
2–4 sweep batches. Total agentic budget: probably 30–50 dev-loop
iterations across the arc. Operator load: hypothesis-formation +
approval, not every parametric sweep.

## Quantitative summary

- Locked anti-collision baseline: `roundabout r=300 = 1.921 v/sim-s,
  0 severe overlaps` (preserved exactly through all changes).
- Locked plain-grid baseline: `# grid s=60 = 1.236 v/sim-s, 0 severe`
  (1.223 v/s post-fixes, within ±1% noise).
- New frontier champion: `elevated split-grid s=400 = 3.314 v/sim-s,
  0 severe` (+72% over roundabout).
- Second-best new design: `bypass-bays bayY=325 bayW=200 = 3.030 v/sim-s,
  0 severe` (+57% over roundabout).
- Tests passing: 788 traffic + network + scoring tests after all
  changes (3 originally-failing `ElevationGraphColorizer` tests
  updated to match the 2-level cap).

## What the operator wants to capture forward

Per the operator's wrap-up framing:

1. **How traffic flow should work** → captured in
   [binary-elevation-model](../../projects/trafficGame/themes/2026-05-23-binary-elevation-model.md).
2. **How important holistic metrics are for agentic / forge
   development** → captured in
   [holistic-metrics-onboarding](../../forge/themes/holistic-metrics-onboarding.md)
   (introduces C7 as a new contract clause) and
   [parametric-design-search](../../forge/themes/parametric-design-search.md)
   (the harness pattern).
3. **Theories on initiatives and work that could have gotten us here
   through forge cycles** → captured in
   [exploration-vs-implementation-initiatives](../../forge/themes/exploration-vs-implementation-initiatives.md).
