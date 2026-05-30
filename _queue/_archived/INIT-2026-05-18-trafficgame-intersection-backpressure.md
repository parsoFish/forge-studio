---
initiative_id: INIT-2026-05-18-trafficgame-intersection-backpressure
project: trafficGame
project_repo_path: projects/trafficGame
created_at: '2026-05-18T12:26:53.324Z'
iteration_budget: 30
cost_budget_usd: 20
phase: pending
origin: architect
quality_gate_cmd:
  - npm
  - test
features:
  - feature_id: FEAT-1
    title: Read-only backpressure accessor
    depends_on: []
  - feature_id: FEAT-2
    title: Virtual stop-line deceleration
    depends_on:
      - FEAT-1
  - feature_id: FEAT-3
    title: Wire backpressure magnitude
    depends_on:
      - FEAT-2
  - feature_id: FEAT-4
    title: Anti-collision invariant + jam-clears proof
    depends_on:
      - FEAT-3
worktree_path: /home/parso/forge/_worktrees/INIT-2026-05-18-trafficgame-intersection-backpressure
---

# trafficGame — intersection backpressure (no hitbox collisions)

## Why
Cars free-flow at MAX_SPEED to a contended intersection, get a binary
1-tick freeze when `IntersectionPolicy.canVehicleEnter` denies entry,
then lurch into crossing traffic (hitbox overlap). `RoadSegmentMetrics`
already propagates downstream congestion upstream
(`CONGESTION_PROPAGATION_FACTOR=0.6`) but it is NOT wired into
car-following. Desired: a bad network jams slowly and clears one car at
a time via backpressure — never a hitbox overlap.

## Constraints
Touch only src/traffic/ and its tests. Do NOT edit scoring or campaign
(UnifiedScore, WorldSimulator, star thresholds, CampaignGraph,
campaignGraphData). Do NOT change VEHICLE_PHYSICS constants. TypeScript
strict, ~150 LOC/file, TDD, tick-based assertions (no time-based waits).
Quality gate: `npm test` AND `npm run test:visual`.

## Features — exactly these 4, do NOT add or invent any others

### FEAT-1 — read-only backpressure accessor
Files in scope: src/traffic/RoadSegmentMetrics.ts,
tests/traffic/RoadSegmentMetrics.test.ts.
Add `getBackpressure(roadId): number` returning the already-propagated
congestion in [0,1]; 0 for unknown/free-flow. No behaviour change.
AC: GIVEN a congested fixed test map WHEN getBackpressure(road) is
called THEN it returns the propagated value AND existing traffic tests
pass unchanged.

### FEAT-2 — virtual stop-line deceleration (depends FEAT-1)
Files in scope: src/traffic/CarFollowing.ts, src/traffic/VehicleUpdate.ts,
tests/traffic/CarFollowing.test.ts.
Before the `vehicleAhead===null` branch, synthesize a virtual leader at
the stop-line when the next intersection denies entry so IDM decelerates
smoothly to <= jam speed instead of freeze/lurch; already-at-stop-line
holds <= jam speed.
AC: GIVEN a vehicle approaching a denied intersection on a fixed map
WHEN it ticks THEN speed decreases monotonically within IDM limits to
<= jam speed at the stop-line AND existing tests pass AND no
VEHICLE_PHYSICS edit.

### FEAT-3 — wire backpressure magnitude (depends FEAT-2)
Files in scope: src/traffic/CarFollowing.ts,
src/traffic/VehicleSimulation.ts, tests/traffic/VehicleSimulation.test.ts.
Feed FEAT-1 getBackpressure into FEAT-2's virtual target so a saturated
intersection propagates graduated deceleration up feeding roads; the
queue drains one car at a time via the existing FIFO. Rollback:
getBackpressure==0 reverts to FEAT-2-only behaviour.
AC: GIVEN a saturating poorly-designed test map WHEN run to steady state
THEN feeding roads show a smooth descending speed profile (not
freeze/lurch) and the jam clears one car at a time AND BPR
predicted-vs-simulated divergence on crossroads stays <=5%.

### FEAT-4 — anti-collision invariant + jam-clears proof (depends FEAT-3)
Files in scope: tests/traffic/Backpressure.invariant.test.ts,
tests/e2e/backpressure.spec.ts.
AC: GIVEN any test map including a deliberately bad design WHEN a
150-vehicle run executes THEN a committed deterministic test asserts no
two vehicles overlap a hitbox at an intersection at any tick AND
throughput is strictly positive (the jam clears, no deadlock) AND
`npm run test:visual` on four-way-hub and crossroads shows no flow
regression.
