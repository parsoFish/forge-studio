---
initiative_id: INIT-2026-05-10-world-graph-foundation
project: trafficGame
project_repo_path: projects/trafficGame
created_at: '2026-05-10T16:30:00.000Z'
iteration_budget: 5
cost_budget_usd: 4
phase: pending
worktree_path: /home/parso/forge/_worktrees/INIT-2026-05-10-world-graph-foundation
quality_gate_cmd:
  - npm
  - test
depends_on_initiatives:
  - INIT-2026-05-10-trafficgame-simplification-arch
features:
  - feature_id: FEAT-1
    title: CampaignGraph + WorldEdge types + serialise / deserialise
    depends_on: []
  - feature_id: FEAT-2
    title: WorldSimulator step propagating measured exit throughput
    depends_on:
      - FEAT-1
  - feature_id: FEAT-3
    title: WorldScore aggregator over linked sub-graph
    depends_on:
      - FEAT-2
---

# World-graph data model and cross-map flow simulator (headless foundation)

## Context

Today the campaign is a linear typed array (`src/campaign/CampaignLevels.ts`) where each level is solved in isolation; `CampaignLevel` carries a `mapId` but no notion of upstream/downstream maps. There is no cross-map flow propagation. The brain's `campaign-mode-state.md` and `traffic-location-data-model.md` together identify the natural seam: `TrafficLocation` already separates entry from exit and tags them with edge orientation (top/bottom/left/right). A graph between maps is a graph **between existing data structures**, not a new concept.

This initiative establishes the headless foundation: data model, serialisation, the simulator step that propagates flow across edges, and a `WorldScore` aggregator on top of `UnifiedScore`. The follow-up initiative (`INIT-2026-05-10-world-graph-ux`) surfaces it in the campaign hub. Splitting foundation from UX matches the brain's `algorithm-heavy-items` decomposition discipline and lets foundation ship behind a Vitest-only gate (faster, cheaper iteration).

## Cross-map signal

Per the user's choice: **measured exit throughput**. The downstream entry flow rate at a `WorldEdge` equals the upstream map's measured exit throughput at the linked exit point in the player's current solution. Falls out of physics; integrates with the existing `FlowConfig` per-location flow rate; avoids coupling world flow to per-map star-threshold tuning.

## Demonstrator pair

`crossroads` (upstream) → `straight-highway` (downstream). Per the brain: `crossroads` has known-best solutions and `straight-highway` is the easiest receiving map to read. This pair is wired into the live campaign in `INIT-2026-05-10-world-graph-ux`. **In this initiative, the demonstrator only exists in fixtures and tests** — it does not ship in `CampaignLevels.ts`.

## Decomposition rationale

Three features in dependency order:

1. **FEAT-1 (data shape):** types + persistence, no behaviour.
2. **FEAT-2 (algorithm):** the simulator step that propagates measured throughput.
3. **FEAT-3 (integration):** `WorldScore` on top of the simulator's stable state, sharing `UnifiedScore`'s formula (no parallel scoring).

## Features

### FEAT-1 — `CampaignGraph` + `WorldEdge` types + serialise / deserialise

**Acceptance criteria (Given-When-Then):**

- **Given** a list of `CampaignLevel`s and a list of `WorldEdge` records of shape `{ fromLevelId, fromExitPointId, toLevelId, toEntryPointId }`, **when** a `CampaignGraph` is constructed and then JSON-encoded via the same serialisation surface used by `src/solutions/ReferenceSolution.ts`, **then** the resulting JSON round-trips byte-equal back to the original `CampaignGraph` through the matching deserialiser.
- **Given** a `WorldEdge` whose `fromLevelId` or `toLevelId` is not present in the supplied level list, **when** construction is attempted, **then** construction throws a typed validation error naming the offending edge.
- **Given** a `WorldEdge` whose `fromExitPointId` is not an `'exit'` connection point on the source map, or `toEntryPointId` is not an `'entry'` connection point on the destination map, **when** construction is attempted, **then** construction throws a typed validation error.
- **Given** a graph with a self-loop (`fromLevelId === toLevelId`) or a duplicate edge, **when** construction is attempted, **then** construction throws.
- **Given** a Vitest unit test, **when** a graph with three levels and two edges (`crossroads → straight-highway` only, plus an unconnected third level) is constructed, **then** traversal helpers report `crossroads` as a source (zero incoming edges), `straight-highway` as having one incoming edge, and the third level as isolated (zero incoming, zero outgoing).

**Files in scope (informational):** `src/campaign/CampaignGraph.ts` (new), `src/campaign/WorldEdge.ts` (new) or merged, `src/campaign/CampaignTypes.ts` (extended), Vitest specs.

### FEAT-2 — `WorldSimulator` step propagating measured exit throughput

**Acceptance criteria (Given-When-Then):**

- **Given** a `CampaignGraph` containing the demonstrator edge `crossroads → straight-highway` and persisted reference solutions for both maps, **when** `WorldSimulator.step()` runs one full world iteration, **then** `straight-highway`'s entry flow rate at the linked entry point equals the measured exit throughput at the linked exit point on `crossroads` (same iteration), within a documented epsilon.
- **Given** a graph node with no incoming edges, **when** `WorldSimulator.step()` runs, **then** that node's per-`TrafficLocation` entry flow rate falls back to the existing `FlowConfig` default (`0.5 v/s`), preserving today's behaviour for unlinked maps.
- **Given** `WorldSimulator.iterateUntilStable(graph, solutions)` runs, **when** complete, **then** it returns after at most `K` iterations (where `K` is a documented constant ≤ 10) with per-map flow rates whose iteration-to-iteration delta is below a documented `ε`. The result is deterministic for a fixed `(graph, solutions, seed)` triple.
- **Given** the simulator's per-map step, **when** invoked on a single map, **then** it reuses the existing per-map sim path — `WorldSimulator` does not introduce a parallel single-map sim; it composes the existing one (no new copy of vehicle physics, scoring, or BPR).
- **Given** a Vitest test forcing the upstream map's measured throughput to a known value, **when** `step()` runs, **then** the downstream map's recorded entry flow rate exactly matches that value (within ε).

**Files in scope (informational):** `src/campaign/WorldSimulator.ts` (new), Vitest specs. Must NOT modify the existing per-map sim or `UnifiedScore` formula.

### FEAT-3 — `WorldScore` aggregator over the linked sub-graph

**Acceptance criteria (Given-When-Then):**

- **Given** a stable `WorldSimulator` state on the demonstrator graph, **when** `WorldScore.compute(graph, simulatorState)` runs, **then** it returns a structured score containing per-map `UnifiedScore` results plus a world-level `flowEfficiency` aggregating across all linked maps weighted by their measured throughputs, plus a world-level letter grade using the same S/A/B/C/D/F thresholds as `UnifiedScore`.
- **Given** any single map in the graph, **when** inspected via `WorldScore`, **then** that map's `UnifiedScore` is identical (numeric equality within float tolerance) to what `UnifiedScore` would produce standalone on that map *with the simulator-propagated entry flow rate*. There must be no parallel scoring path; `WorldScore` consumes `UnifiedScore`.
- **Given** the demonstrator graph with two valid solutions A (poor) and B (good) for the upstream map, **when** the upstream solution swaps A → B (more throughput), **then** the world-level `flowEfficiency` is strictly higher and the downstream map's `UnifiedScore.flowEfficiency` is no lower (monotonicity check on the cross-map signal).
- **Given** a Vitest test on the demonstrator pair, **when** the downstream map's reference solution is degraded (lower throughput) while the upstream is unchanged, **then** the world-level `flowEfficiency` decreases, and the upstream map's `UnifiedScore` is unchanged (no spurious upstream coupling).

**Files in scope (informational):** `src/scoring/WorldScore.ts` (new), Vitest specs. Must NOT add a parallel capacity formula or BPR implementation — reuse `FlowCapacitySegment` and `UnifiedScore`.

## Quality gate

`npm test` — Vitest only. Foundation is fully headless. Visual coverage is the UX initiative's job.

## Out of scope

- Any UI / canvas rendering — strictly out of scope. The campaign hub is unchanged in this initiative.
- Wiring the demonstrator edge into `CampaignLevels.ts` (the live campaign data) — that's INIT-2026-05-10-world-graph-ux's job. Foundation tests use fixtures only.
- Changing the per-map `UnifiedScore` formula or `FlowCapacitySegment` capacity formula — those are load-bearing single-source-of-truth modules per the MVP architecture snapshot.
- Persisting per-player world state (which solutions they've saved per map) — `ReferenceSolution` already exists for serialise / deserialise; reuse it. Player-level persistence belongs to a future initiative if needed.
- Auto-deriving world-level star thresholds. Per `per-map-calibrated-thresholds.md`, world-level grade tuning is a playtest concern, not an algorithmic one.
