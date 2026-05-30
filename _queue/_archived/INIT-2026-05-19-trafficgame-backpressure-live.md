---
initiative_id: INIT-2026-05-19-trafficgame-backpressure-live
project: trafficGame
project_repo_path: projects/trafficGame
created_at: '2026-05-19T11:55:01.810Z'
iteration_budget: 14
cost_budget_usd: 9
phase: pending
origin: architect
quality_gate_cmd:
  - npm
  - test
features:
  - feature_id: FEAT-1
    title: Feed backpressure magnitude into car-following via the sim
    depends_on: []
  - feature_id: FEAT-2
    title: Anti-collision invariant + jam-clears proof
    depends_on:
      - FEAT-1
worktree_path: /home/parso/forge/_worktrees/INIT-2026-05-19-trafficgame-backpressure-live
---

# trafficGame — wire backpressure into the live sim + anti-collision proof

## Why
PR #55 (merged to main) landed the foundation: `RoadSegmentMetrics.getBackpressure(roadId)`
and a virtual stop-line IDM deceleration in `src/traffic/CarFollowing.ts`. STILL MISSING:
the backpressure magnitude is not fed into the live simulation, and there is no
anti-collision proof. This initiative finishes exactly that, on top of the
already-merged foundation (assume getBackpressure + virtual stop-line exist on main).

## Constraints
Touch only src/traffic/ and its tests. Do NOT edit scoring/campaign. Do NOT change
VEHICLE_PHYSICS. TypeScript strict, ~150 LOC/file, TDD, tick-based assertions. Quality
gate: `npm test`. Do NOT git-add anything under .forge/ (gitignored scratch).

## Features — exactly these 2, do NOT add or invent any others

### FEAT-1 — feed backpressure magnitude into car-following via the simulation
Files in scope: src/traffic/VehicleSimulation.ts, src/traffic/CarFollowing.ts,
src/traffic/VehicleUpdate.ts, tests/traffic/VehicleSimulation.test.ts.
In the per-vehicle update, look up `RoadSegmentMetrics.getBackpressure(vehicle.currentRoadId)`
and feed it into the existing virtual stop-line target so a saturated intersection
propagates a graduated deceleration up its feeding roads; the queue drains one car at a
time via the existing FIFO. Rollback: getBackpressure==0 ⇒ behaviour byte-identical to
the current (foundation-only) path.
AC: GIVEN a saturating poorly-designed fixed test map WHEN the simulation runs to steady
state THEN feeding roads show a smooth descending speed profile (not freeze/lurch) and
the jam drains one car at a time AND GIVEN getBackpressure==0 WHEN a vehicle approaches
THEN behaviour is byte-identical to the foundation-only path.

### FEAT-2 — anti-collision invariant + jam-clears proof (depends FEAT-1)
Files in scope: tests/traffic/Backpressure.invariant.test.ts.
AC: GIVEN any test map including a deliberately bad design WHEN a 150-vehicle run executes
THEN a committed deterministic test asserts no two vehicles ever overlap a hitbox at an
intersection at any tick AND throughput stays strictly positive with no permanent deadlock.
