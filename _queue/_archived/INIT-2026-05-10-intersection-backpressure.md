---
initiative_id: INIT-2026-05-10-intersection-backpressure
project: trafficGame
project_repo_path: projects/trafficGame
created_at: '2026-05-10T16:30:00.000Z'
iteration_budget: 6
cost_budget_usd: 4
phase: pending
worktree_path: /home/parso/forge/_worktrees/INIT-2026-05-10-intersection-backpressure
quality_gate_cmd:
  - npm
  - test
depends_on_initiatives:
  - INIT-2026-05-10-trafficgame-simplification-arch
features:
  - feature_id: FEAT-1
    title: Spill-signal data field + propagation algorithm in IntersectionPolicy
    depends_on: []
  - feature_id: FEAT-2
    title: Virtual-brake integration in CarFollowing for spill-signalled segments
    depends_on:
      - FEAT-1
  - feature_id: FEAT-3
    title: Visual regression on four-way-hub and crossroads for reduced collisions
    depends_on:
      - FEAT-2
---

# Intersection back-pressure for smarter braking before busy intersections

## Context

Cars at full speed (`MAX_SPEED = 450 px/s`) cannot brake quickly enough to avoid collisions when an intersection ahead is congested. The brain's `traffic-physics-and-flow.md` identifies the precise leverage point: today the IDM `vehicleAhead === null` branch in `src/traffic/CarFollowing.ts:53-119` falls back to free-flow acceleration regardless of downstream intersection state. There is no cross-intersection awareness in the simulator today.

This initiative introduces an *intersection back-pressure signal* that propagates congestion measurements **back along the entering roads** of an intersection. Approaching cars synthesise a virtual brake before they're close enough for emergency deceleration — matching the user's framing: *"one car approaching or entering an intersection pushes that information back down the other entering roads causing cars to slow down earlier as they approach a busy intersection"*.

## Decomposition rationale

The brain's `algorithm-heavy-items` antipattern (trafficGame v1 Cycle 3: 48% failure rate on Steiner topology / graph colouring) mandates ≥3 work items: data-shape change → algorithm step → integration. We follow that rule:

1. **FEAT-1 (data shape):** add the `spillSignal` field to `RoadSegmentMetrics` and the propagation algorithm that writes it from `IntersectionPolicy`. Vitest-only.
2. **FEAT-2 (integration):** consume `spillSignal` in `CarFollowing.updateVehicleSpeed()` to synthesise a virtual brake. Vitest-only on the IDM math.
3. **FEAT-3 (proof):** visual regression on canonical jam maps showing reduced collisions and no flow-prediction drift.

## Features

### FEAT-1 — Spill-signal data field + propagation algorithm in IntersectionPolicy

**Acceptance criteria (Given-When-Then):**

- **Given** a `RoadSegmentMetrics` instance, **when** the segment terminates at an intersection whose `IntersectionPolicy.isCongested()` returns true, **then** the `spillSignal` field on every entering segment of that intersection is set to a value in `[0, 1]` proportional to the intersection's congestion level (1 = at the existing 35%-of-MAX_SPEED `isCongested` threshold; further degradation saturates at 1).
- **Given** an intersection with no congestion (`isCongested()` false on every entering segment), **when** propagation runs, **then** every entering segment's `spillSignal` is exactly `0`.
- **Given** a Vitest unit test with two synthetic entering segments and an intersection forced into a known congestion state, **when** propagation runs, **then** both entering segments receive equal non-zero `spillSignal` values, and the value matches a hand-computed reference within a documented epsilon.
- **Given** the existing FIFO-deadlock-free `isInternalPresetIntersection()` skip in `IntersectionPolicy`, **when** propagation visits an internal preset intersection (e.g. roundabout connection point), **then** propagation skips it (preserves the existing roundabout fix; see `traffic-physics-and-flow.md`).

**Files in scope (informational):** `src/traffic/RoadSegmentMetrics.ts` (or wherever the metrics live), `src/traffic/IntersectionPolicy.ts`, plus Vitest specs.

### FEAT-2 — Virtual-brake integration in CarFollowing for spill-signalled segments

**Acceptance criteria (Given-When-Then):**

- **Given** a vehicle on a segment with `spillSignal > 0` and no `vehicleAhead`, **when** `updateVehicleSpeed()` runs, **then** the vehicle decelerates at a rate proportional to `spillSignal` and to the distance-to-intersection-entry, computed as if a virtual lead vehicle existed at the intersection entry. Deceleration must not exceed `MAX_DECELERATION = 600 px/s²`.
- **Given** the same vehicle on a segment with `spillSignal === 0`, **when** `updateVehicleSpeed()` runs, **then** behaviour is byte-identical to the existing free-flow IDM branch (no regression on uncongested approaches; existing IDM Vitest specs continue to pass unmodified).
- **Given** a vehicle approaching a fully spilled intersection (`spillSignal === 1`), **when** measured at the intersection-entry threshold, **then** its speed is at most the existing `IntersectionPolicy.isCongested()` cap (`35% × MAX_SPEED ≈ 158 px/s`) — i.e. the virtual brake at minimum matches today's behaviour-at-the-line, but earlier in the approach.
- **Given** a vehicle with a real `vehicleAhead`, **when** `updateVehicleSpeed()` runs, **then** the existing gap-aware IDM logic is preserved unchanged; the virtual brake is *only* invoked when `vehicleAhead === null`.

**Files in scope (informational):** `src/traffic/CarFollowing.ts`, plus Vitest specs.

### FEAT-3 — Visual regression on four-way-hub and crossroads for reduced collisions

**Acceptance criteria (Given-When-Then):**

- **Given** the `four-way-hub` map with the project's existing reference solution loaded, **when** a 150-vehicle scoring simulation runs at `timeScale=5`, **then** the recorded collision count is strictly less than the pre-FEAT-1 baseline checked into the test fixture, and the `UnifiedScore.flowEfficiency` is no worse than the pre-FEAT-1 baseline minus 5% (i.e. the brake doesn't tank throughput).
- **Given** the `crossroads` map with its reference solution, **when** a Playwright `test:visual` run replays the canonical scoring sim, **then** the visual snapshot at a deterministic in-sim time (e.g. `t=30s` of sim-time) shows no rear-end vehicle stacks at the hub intersection, and matches the checked-in expected snapshot within tolerance.
- **Given** BPR prediction vs simulation comparison, **when** measured on `crossroads` and `four-way-hub` post-FEAT-2, **then** simulation-vs-prediction divergence stays within the existing 0.7%–2.4% range documented in `projects/trafficGame/docs/LEARNINGS.md` (i.e. back-pressure does not invalidate the unified scoring model).
- **Given** the existing Vitest suite, **when** run post-FEAT-2 + FEAT-3, **then** all pre-existing tests pass without modification (the project's `CLAUDE.md` mandate: never modify tests to make them pass).

**Files in scope (informational):** Playwright spec under `tests/`, fixture data updates for the two maps' baselines.

## Quality gate

`sh -c "npm test && npm run test:visual"` — visual gate is mandatory per `canvas-bpr-flow-tests.md` for any vehicle-physics or BPR-touching change.

## Out of scope

- Cross-map back-pressure (a downstream map's congestion influencing an upstream map's flow). That belongs to the world-graph foundation initiative; this initiative is intra-map only.
- Per-map calibration of `spillSignal` thresholds — the brain's `per-map-calibrated-thresholds` decision rules out auto-derived thresholds; constants must be playtest-validated. If FEAT-3 reveals a per-map drift, surface it for human tuning, do not auto-tune.
- Replacing IDM with a different car-following model.
