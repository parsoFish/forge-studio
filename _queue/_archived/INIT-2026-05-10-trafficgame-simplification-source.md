---
initiative_id: INIT-2026-05-10-trafficgame-simplification-source
project: trafficGame
project_repo_path: projects/trafficGame
created_at: '2026-05-10T18:00:00.000Z'
iteration_budget: 20
cost_budget_usd: 30
phase: pending
worktree_path: /home/parso/forge/_worktrees/INIT-2026-05-10-trafficgame-simplification-source
quality_gate_cmd:
  - npm
  - test
depends_on_initiatives:
  - INIT-2026-05-10-trafficgame-simplification-tests
features:
  - feature_id: FEAT-1
    title: GameRenderer.ts (641 lines) split into per-concern renderers
    depends_on: []
  - feature_id: FEAT-2
    title: >-
      Game.ts (573 lines) further extraction (input handling +
      state-orchestration)
    depends_on: []
  - feature_id: FEAT-3
    title: >-
      TrafficMap.ts (428 lines) split into TrafficMap (data) + FlowAnalyzer
      (BPR)
    depends_on: []
  - feature_id: FEAT-4
    title: RoadBuilder.ts (497 lines) audit + simplification
    depends_on: []
  - feature_id: FEAT-5
    title: >-
      NetworkOptimizer.ts (460 lines) audit + extraction (don't touch the
      algorithm)
    depends_on: []
---

# Phase 2 — Source consolidation (5 parallel extractions)

## Context

After Phase 1 lands a fast, behavioural test suite, source-side bloat becomes safe to attack. Per [`projects/trafficGame/docs/SIMPLIFICATION_PLAN.md`](../../projects/trafficGame/docs/SIMPLIFICATION_PLAN.md), 9 files exceed 380 lines vs the project's ~150 lines/file mandate.

Five extractions in **declared parallel** (no `depends_on` between features) — they touch disjoint files and the new test suite catches behaviour drift without serialising the work.

**Target after this initiative:** no file >250 LOC unless explicitly justified; total `src/` ≤ 14k LOC (down from ~18k).

**Hard rule:** these are extractions, not rewrites. The brain's `single-source-of-truth` modules (`UnifiedScore`, `FlowCapacitySegment`, `NetworkDemand`) are NOT touched. The Steiner + graph-colouring strategy in `NetworkOptimizer` is NOT rewritten — only its file structure.

## Features

### FEAT-1 — `GameRenderer.ts` split (641 → ~200 lines)

**Acceptance criteria (Given-When-Then):**

- **Given** `src/game/GameRenderer.ts` at ~641 lines, **when** FEAT-1 is complete, **then** it is split into a thin dispatcher (`GameRenderer.ts` ≤ 150 lines) that delegates to per-concern modules: `VehicleRenderer`, `IntersectionRenderer`, `OverlayCompositor`. The existing `RoadRenderer` (`src/rendering/`) is preserved.
- **Given** the post-split tree, **when** `npm test` and `npm run test:visual` run, **then** all tests pass with no rendered-output drift (visual snapshots match within tolerance).
- **Given** any existing reference to `GameRenderer.draw...` from outside `src/game/`, **when** post-split, **then** the call sites are unchanged — splits are internal; the public surface is preserved.

**Files in scope:** `src/game/GameRenderer.ts`, new files under `src/rendering/` or `src/game/renderers/`.

### FEAT-2 — `Game.ts` further extraction (573 → ~200 lines)

**Acceptance criteria (Given-When-Then):**

- **Given** `src/Game.ts` at ~573 lines, **when** FEAT-2 is complete, **then** the file is reduced to ≤ 200 lines via extraction of input-handling into `GameInputController` (sibling of the existing `GameToolManager`) and state-orchestration into `GameOrchestrator` (sibling of the existing `GameSimulationController`).
- **Given** the post-extraction `Game.ts`, **when** inspected, **then** it reads as a wiring file: instantiate, connect, dispatch — not a logic file.
- **Given** all existing tests, **when** run post-extraction, **then** all pass with zero test-file changes (extractions don't change observable behaviour).

**Files in scope:** `src/Game.ts`, new files under `src/game/`.

### FEAT-3 — `TrafficMap.ts` split (428 → ~150 + ~150)

**Acceptance criteria (Given-When-Then):**

- **Given** `src/traffic/TrafficMap.ts` mixes map-gen with BPR flow analysis, **when** FEAT-3 is complete, **then** the file is split into `TrafficMap` (data only — connection points, traffic locations, geometry) ≤ 150 lines and `FlowAnalyzer` (BPR computation against a TrafficMap) ≤ 150 lines.
- **Given** the existing call sites of `TrafficMap`, **when** post-split, **then** they are updated mechanically (renamed methods route to the right module). No behavioural change.
- **Given** the BPR formula in `FlowCapacitySegment.ts`, **when** post-split, **then** `FlowAnalyzer` consumes it unchanged — no parallel capacity formula.

**Files in scope:** `src/traffic/TrafficMap.ts`, new `src/traffic/FlowAnalyzer.ts`, call-site updates.

### FEAT-4 — `RoadBuilder.ts` audit + simplification (497 → ≤ 250)

**Acceptance criteria (Given-When-Then):**

- **Given** `src/game/RoadBuilder.ts` at ~497 lines, **when** audited, **then** the agent identifies whether it has two clear concerns (split candidate) or is one coherent concern (simplification candidate). The audit produces a 1-paragraph rationale in the WI body before changes are made.
- **Given** the audit's recommendation, **when** acted on, **then** the file ends ≤ 250 lines (split or simplified) and all tests pass with no behavioural change.
- **Given** the existing public API of `RoadBuilder`, **when** post-change, **then** call sites are unchanged.

**Files in scope:** `src/game/RoadBuilder.ts`, possibly new sibling files.

### FEAT-5 — `NetworkOptimizer.ts` audit + extraction (460 → ≤ 250)

**Acceptance criteria (Given-When-Then):**

- **Given** `src/network/NetworkOptimizer.ts` at ~460 lines using Steiner + graph-colouring, **when** the audit runs, **then** the agent identifies pure-data structures, helpers, and the strategy core. The strategy itself is NOT touched (load-bearing — the brain's `algorithm-heavy-items` warning).
- **Given** the audit's recommendation, **when** acted on, **then** the strategy file ends ≤ 250 lines via extraction of helpers / types into siblings (`NetworkOptimizerHelpers.ts` and `NetworkOptimizerTypes.ts` already exist — extend them, don't replace).
- **Given** the post-extraction tree, **when** scoring tests run, **then** the pre-sim throughput and the live-sim score still match within the existing 0.7%-2.4% divergence range.

**Files in scope:** `src/network/NetworkOptimizer.ts`, `src/network/NetworkOptimizerHelpers.ts`, `src/network/NetworkOptimizerTypes.ts`.

## Out of scope

- Algorithmic changes (Steiner, graph-colouring, BPR formula, IDM constants). Extract structure, not behaviour.
- New parallel modules (e.g., a second renderer, a second scorer). Brain's load-bearing-modules rule.
- `Vector2.ts`, `PathSmoothing.ts`, and other already-small core files. Don't extract for size's sake.

## Parallelism note

All 5 features have empty `depends_on` arrays. They can be PM'd into work-items that run in parallel — the dev-loop will interleave them on independent worktree branches. The `_graph.md` should show 5 disconnected subgraphs, not a chain.

## Reviewer focus

For each extraction:
1. Diff stat sanity: post-extraction file count and total LOC are ≤ expected.
2. Public-API check: `grep` for the moved symbol's old import paths — should be zero hits outside the file's own module.
3. Test result: full suite + visual gate green, no snapshot drift.
