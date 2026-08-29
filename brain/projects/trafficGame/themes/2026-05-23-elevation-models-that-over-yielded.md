---
title: >-
  Three elevation models that over-yielded — 3-level coloring, body-aware
  footprint, route-segment span
description: >-
  The three models tried before the binary one, and why each failed: 3-level
  coloring the topology never needed, a body-aware footprint that read {0,1} at
  a ramp CP and conflicted with both levels, and future-walk span elevations
  that smeared a ramp transition across both. Each was geometrically defensible
  and each over-yielded; throughput 2.905 -> 3.314 v/sim-s when they were
  replaced by one value read by every consumer.
category: antipattern
keywords:
  - elevation
  - ramp
  - grade-separation
  - collision-avoidance
  - over-yielding
  - throughput
  - rejected-alternatives
  - body-aware-footprint
  - route-elevations
created_at: 2026-05-23T00:00:00.000Z
updated_at: 2026-05-23T00:00:00.000Z
related_themes: [2026-05-23-binary-elevation-model, 2026-05-23-grading-frontier-infrastructure]
---

# Three elevation models that over-yielded

Split out of [[2026-05-23-binary-elevation-model]]: that page records the model
that works, this one records what it replaced. All three came first, all three
were driven by the operator from screenshots, and all three shared one failure
mode — a car near a ramp looked like it occupied BOTH levels, so it yielded to
traffic it could never touch.

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
- Commit `7c64b4b` "feat(traffic): elevation-aware collision avoidance + binary elevation model" on the trafficGame `main` (merged via PR #57).

## See also

- [[2026-05-23-binary-elevation-model]] — the model that replaced all three.
- [[2026-05-23-grading-frontier-infrastructure]] — what locks the throughput numbers in.
