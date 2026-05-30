---
initiative_id: INIT-2026-05-17-world-graph-connectivity
project: trafficGame
project_repo_path: projects/trafficGame
created_at: '2026-05-17T00:00:00.000Z'
iteration_budget: 12
cost_budget_usd: 12
phase: pending
origin: architect
worktree_path: /home/parso/forge/_worktrees/INIT-2026-05-17-world-graph-connectivity
quality_gate_cmd:
  - npm
  - test
depends_on_initiatives:
  - INIT-2026-05-10-world-graph-ux
features:
  - feature_id: FEAT-1
    title: Connected world graph data with real connection points
    depends_on: []
  - feature_id: FEAT-2
    title: Neighbour-unlock + connection-point validation
    depends_on:
      - FEAT-1
  - feature_id: FEAT-3
    title: Hub renders the connected world
    depends_on:
      - FEAT-2
---

# World-graph connectivity — connected map-of-maps with neighbour-unlock

## What & why

Today `src/campaign/campaignGraphData.ts` is a 3-node linear chain
(`straight-highway → crossing-flows → crossroads`) with **blank** edge
connection-point ids, and `CampaignGraph.isUnlocked` unlocks a node only
when **all** its directed prerequisites are solved. The operator wants a
**connected world** of the existing maps where edges carry **real** exit/
entry points, and **completing a map unlocks every map connected to it**
(undirected adjacency) — e.g. completing the hub map unlocks the maps
above/below/left/right of it.

## Hard constraints (read before decomposing)

1. **Edit ONLY these 3 production files** (plus their `tests/campaign/`
   specs). One file per feature — no shared files across features:
   - FEAT-1 → `src/campaign/campaignGraphData.ts`
   - FEAT-2 → `src/campaign/CampaignGraph.ts`
   - FEAT-3 → `src/ui/CampaignHub.ts`
2. **Do NOT create any new module/service** (no `WorldGraphService`, no
   `resolveNextNode`, etc.). The change lives in the existing files above.
3. **Do NOT modify `src/main.ts`** — it does not reference the graph or
   unlock logic; the hub already consumes `CAMPAIGN_GRAPH`, so data/unlock
   changes flow through automatically.
4. **Do NOT change scoring** — `UnifiedScore`, `WorldScore`,
   `WorldSimulator`, `starThresholds`, `targetGrade`, and the "solved"
   criterion (`progress[id].stars >= 1`) stay byte-unchanged.
5. Features are a **strict linear chain** FEAT-1 → FEAT-2 → FEAT-3; each
   work item depends on the previous (no parallel siblings sharing a file).

## Features

### FEAT-1 — Connected world graph data (`campaignGraphData.ts` only)

Replace the linear `NODES`/`EDGES` with a **connected** world built from
the existing `MapDefinitions.ts` maps (straight-highway, crossing-flows,
crossroads, four-way-hub, one-per-edge, two-on-left, opposite-pairs, etc. —
no new map defs). Every `WorldEdge` gets a **non-empty**
`fromExitPointId`/`toEntryPointId` derived from the maps' `locations`
(documented derivation). Include one **hub node with ≥4 neighbours**.

**ACs:**
- GIVEN `CAMPAIGN_GRAPH` WHEN built THEN every node is reachable from every
  other treating edges as undirected (one connected component), and at
  least one node has ≥4 distinct neighbours.
- GIVEN any `WorldEdge` in `CAMPAIGN_GRAPH` WHEN inspected THEN
  `fromExitPointId` and `toEntryPointId` are both non-empty strings.
- GIVEN `npm test` WHEN run THEN existing `tests/campaign/` specs pass
  (update only those whose data assumptions genuinely changed) and a new
  `tests/campaign/campaignGraphData.test.ts` asserts the two ACs above.

### FEAT-2 — Neighbour-unlock + connection-point validation (`CampaignGraph.ts` only)

Add an undirected `neighbours(nodeId)` accessor and change `isUnlocked` so
a node is unlocked iff it is the **start node** (designate the existing
`straight-highway` as the start) OR **at least one** of its undirected
neighbours is solved (`stars >= 1` — unchanged criterion). Add constructor
validation: throw `WorldEdgeValidationError` if an edge's
`fromExitPointId`/`toEntryPointId` is empty or not a real location id on
the referenced map (existing unknown-node validation stays).

**ACs:**
- GIVEN the connected graph and the hub node completed (`stars >= 1`) WHEN
  `unlockedNodeIds(progress)` is computed THEN every neighbour of the hub
  is unlocked and a non-adjacent node is not unlocked by that completion
  alone.
- GIVEN empty progress WHEN `unlockedNodeIds` is computed THEN only
  `straight-highway` (the start node) is unlocked.
- GIVEN an edge with an empty or unknown connection-point id WHEN the graph
  is constructed THEN it throws `WorldEdgeValidationError` naming the edge.
- GIVEN `npm test` WHEN run THEN the unlock specs in
  `tests/campaign/CampaignGraph.test.ts` are rewritten to the
  neighbour-unlock semantic and pass.

### FEAT-3 — Hub renders the connected world (`CampaignHub.ts` only)

`CampaignHub` already lists `CAMPAIGN_GRAPH.nodes` with lock state from
`unlockedNodeIds()`. Make it show each node's **connectivity** (its
neighbour ids / adjacency, not just a flat list) so the connected world is
visible; keep select-node and back working.

**ACs:**
- GIVEN the connected `CAMPAIGN_GRAPH` WHEN the hub renders THEN each
  node's neighbour set is shown and lock state reflects neighbour-unlock.
- GIVEN existing hub interactions (select launches the node's map; back)
  WHEN exercised THEN they still work and `npm test` is green with no
  regression outside the hub.
- The before/after demo (review phase) visibly shows the connected
  world-map and a completion unlocking its connected neighbours.

## Out of scope

Scoring/sim/thresholds; new map definitions; cross-map flow coupling;
world-level grade; auto-layout; persistence-format changes; `main.ts`.
