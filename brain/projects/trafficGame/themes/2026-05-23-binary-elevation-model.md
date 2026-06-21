---
title: >-
  Binary elevation model — one elevation per vehicle, three transition rules,
  every consumer reads the same value
description: >-
  After three failed attempts (3-level coloring, body-aware footprint that spans
  both levels, route-segment span elevations), the model that works is binary —
  vehicle.currentElevation is a single point, locked to ramp target on
  transition segments, lifted early at next-waypoint and ramp-CP boundaries.
  Collision, overlap, and IDM leader-finding all read the same value.
  Future-segment elevations evaluated at TARGET, not source-to-target span.
category: decision
keywords:
  - elevation
  - ramp
  - grade-separation
  - collision-avoidance
  - binary-model
  - flicker
  - ramp-cp
  - current-elevation
  - route-elevations
  - target-elevation
created_at: 2026-05-23T00:00:00.000Z
updated_at: 2026-05-23T00:00:00.000Z
related_themes:
  - 2026-05-23-grading-frontier-infrastructure
  - 2026-05-10-traffic-physics-and-flow
---

# Binary elevation model

The trafficGame simulation runs at two elevation levels (ground=0,
elevated=1). The model that survives — after three iterations the
operator drove from screenshots — is **binary**: each vehicle is on
exactly one level at any moment, captured in
`vehicle.currentElevation`. Every consumer of "what level is this car
at" reads that one value. There is no spanning, no fuzzy zone, no
body-aware footprint.

## The three rules that produce currentElevation

`VehicleUpdate.updateVehicleElevation` runs every tick and applies, in
order:

1. **Locked-to-target on a ramp transition segment.** If the CURRENT
   route segment has endpoint elevations that differ
   (`routeElevations[idx] !== routeElevations[idx+1]`), the car is
   physically transitioning — `currentElevation = routeElevations[idx+1]`
   (the target). This **fixes the flicker** that occurs without the
   rule: a car that has just passed the ramp CP would otherwise read
   the ramp CP's source label (ground) until the 30 px early-lift
   kicked in for the next bay waypoint, producing visible up/down/up
   between sequential ticks.
2. **Early lift on a different-elevation next waypoint.** Within 30 px
   of the next route waypoint, if its elevation differs from the
   car's current `routeElevations[idx]`, lift to it. This was the
   pre-existing rule.
3. **Early lift on a ramp CP.** Within 30 px of the next waypoint, if
   the next waypoint matches current elevation BUT the waypoint AFTER
   it differs (the "stub-meets-bay" topology where the shared CP
   carries the source road's elevation label), lift to the
   after-waypoint elevation. This **lifts at the ramp CP itself**,
   not 30 px into the bay past the CP, addressing the operator's
   "cars don't visually jump up until well into the elevated road"
   observation.

## Every consumer reads currentElevation, not routeElevations

The point of the binary model: there is **no second interpretation**
of a car's elevation. Code paths that previously inferred elevation
from `routeElevations[idx]` or computed a multi-level "footprint" now
all read `vehicle.currentElevation` directly:

- **`CollisionAvoidance.currentSegElevation`** returns `{ce, ce}` (a
  degenerate range). Two cars at different `currentElevation` skip the
  pairwise route-crossing check entirely — they pass over/under each
  other without yielding.
- **`OverlapTracker.currentSegElevRange`** does the same. Cars
  geometrically near each other but at different `currentElevation`
  never log an overlap event.
- **`VehicleUpdate.couldRoutesCollide`** for IDM leader-finding skips
  cross-elevation pairs unless one of three escapes triggers (same
  current road, or the follower's `getUpcomingElevation` matches
  within the lookahead horizon).

The walk's FUTURE route segments are evaluated at their **target**
elevation (`routeElevations[idx + k + 1]`), NOT as a source-to-target
span. Without this, an upcoming ramp transition in a car's route
would smear that segment's elevation range across both levels and
spuriously conflict with cross-level traffic geometrically near the
ramp CP. The flicker fix in `updateVehicleElevation` already collapses
the transition into a single-tick boundary, so the walk is consistent
to evaluate at target.

## The IDM leader-lookahead extension

The binary model exposed a follow-up failure: a follower on a ground
entry stub LOSES its IDM leader the moment the leader's
`currentElevation` lifts onto the H lane, because
`couldRoutesCollide` filters them out as cross-elevation. The
`getUpcomingElevation` lookahead extended from **80 px → 400 px** of
route distance walked forward — at MAX_SPEED 450 px/s that's ~0.9 s
of braking headroom, enough for IDM to react smoothly. Without it,
the follower accelerates into the leader's tail at the ramp.

## Why three failed attempts came first

1. **3-level elevation coloring** — `ElevationGraphColorizer` was
   originally designed for 0/1/2. Capped to 0/1 with one accepted
   same-level adjacency on odd cycles. Two levels is enough for every
   topology the operator wants to draw (split-grid, bypass-bays, the
   bypass-shell hand-drawn design).
2. **Body-aware footprint** — `currentSegElevation` initially returned
   the union of route segment endpoints + `currentElevation` + next
   segment's elevation if the front (centre + 19 px) had passed the
   next waypoint. This was conservative and "safe" but produced
   spurious yields near ramps because a car right at the ramp CP
   looked like `{0, 1}` and conflicted with anything at either level.
   Throughput plateau hit ~2.9 v/sim-s.
3. **Route-segment span elevations for future walk** — using
   `{min(elevs[i], elevs[i+1]), max(elevs[i], elevs[i+1])}` for each
   future walk segment made ramp transitions span both levels, which
   was correct geometrically but again over-yielded.

The binary model collapses all three of these into one rule: trust
`currentElevation` for the present, trust `routeElevations[i+1]` for
the future. Throughput went from 2.905 (body-aware peak at s=250) to
**3.314 v/sim-s at s=400 with 0 severe** — locked baseline
preserved exactly at roundabout r=300 = 1.921 v/sim-s.

## Sources

- [`docs/decisions/adr-collision-architecture-2026-05-22.md`](../../../../projects/trafficGame/docs/decisions/adr-collision-architecture-2026-05-22.md) — the parent ADR.
- [`docs/baselines/grading-frontier-cross-theories.md`](../../../../projects/trafficGame/docs/baselines/grading-frontier-cross-theories.md) — the 5-fix list + champion.
- [`src/traffic/CollisionAvoidance.ts`](../../../../projects/trafficGame/src/traffic/CollisionAvoidance.ts), [`src/traffic/OverlapTracker.ts`](../../../../projects/trafficGame/src/traffic/OverlapTracker.ts), [`src/traffic/VehicleUpdate.ts`](../../../../projects/trafficGame/src/traffic/VehicleUpdate.ts).
- Commit `7c64b4b` "feat(traffic): elevation-aware collision avoidance + binary elevation model" on the trafficGame `main` (merged via PR #57).

## See also

- [[2026-05-23-grading-frontier-infrastructure]] — what locks the throughput numbers in.
- [[2026-05-10-traffic-physics-and-flow]] — the surrounding IDM stack.
