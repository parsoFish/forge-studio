---
initiative_id: INIT-2026-05-10-trafficgame-simplification-tests
project: trafficGame
project_repo_path: projects/trafficGame
created_at: '2026-05-10T18:00:00.000Z'
iteration_budget: 15
cost_budget_usd: 25
phase: pending
worktree_path: /home/parso/forge/_worktrees/INIT-2026-05-10-trafficgame-simplification-tests
quality_gate_cmd:
  - npm
  - run
  - build
features:
  - feature_id: FEAT-1
    title: >-
      Quarantine existing tests under tests/_legacy/ and write minimal behaviour
      layer
    depends_on: []
  - feature_id: FEAT-2
    title: 'Write visual-smoke layer (Playwright, one spec per surface)'
    depends_on:
      - FEAT-1
  - feature_id: FEAT-3
    title: Write integration layer + cherry-pick load-bearing legacy assertions
    depends_on:
      - FEAT-2
---

# Phase 1 — Test suite rip-and-redraw

## Context

Per [`projects/trafficGame/docs/SIMPLIFICATION_PLAN.md`](../../projects/trafficGame/docs/SIMPLIFICATION_PLAN.md): the test suite is **18,000 LOC across 106 files for 18,000 LOC of source** — a ~1:1 test-to-source ratio that signals over-testing of implementation detail. UI tests average 665 lines per file (mirroring the rendering surface line-for-line). 16 game-tests files at 7,208 lines. This bloat is the gate that broke during the canvas-overlay debug session today: `npm test` ran the entire suite (~9s) per dev-loop iteration, and any unrelated flake or coupled test broke the gate.

This initiative rips the existing suite back to a minimal behaviour-focused base.

**Target totals after this initiative:** ≤500 tests, ≤6,000 LOC of test code, `npm test` runtime under 5s.

## Important: gate semantics during this initiative

Because the work is *deleting and rewriting tests*, the conventional `npm test` gate doesn't make sense per-iteration — the suite is in flux. The initiative-level `quality_gate_cmd` is `npm run build` (TypeScript compile + Vite build), which catches syntactical / type errors without depending on test stability. The PM phase **may** elevate per-WI gates to `npm test` for FEATs 2 and 3 once the new layers exist; that's a PM decision based on WI scope.

The reviewer at PR boundary verifies the post-rewrite suite actually catches the regressions the user cares about.

## Features

### FEAT-1 — Quarantine existing tests + write minimal behaviour layer

**Acceptance criteria (Given-When-Then):**

- **Given** the existing `projects/trafficGame/tests/` directory with 106 test files (~18k LOC), **when** FEAT-1 work completes, **then** the directory has been moved verbatim to `projects/trafficGame/tests/_legacy/` (no content lost; restorable on rollback).
- **Given** an empty top-level `tests/` directory, **when** new behaviour-layer specs are authored under `tests/`, **then** they cover at minimum: scoring math (`UnifiedScore.flowEfficiency`, letter grades, capacity formulas), vehicle physics (IDM constants, free-flow vs gap-aware branches in `CarFollowing.updateVehicleSpeed`), BPR flow prediction (volume-delay function, demand analysis), and network demand (A* loop in `NetworkDemand`). Total new behaviour-layer specs ≤ 200 tests.
- **Given** the new behaviour layer exists, **when** `npm test` runs, **then** it completes in **under 3 seconds** and all tests pass.
- **Given** the existing 9 levels in `CampaignLevels.ts`, **when** the behaviour layer is examined, **then** there is at least one test asserting the locked physics constants from `VEHICLE_PHYSICS` have not drifted (regression guard for the brain's "don't scale individual physics constants" mandate).
- **Given** `npm run build`, **when** FEAT-1 work is complete, **then** the build passes (TypeScript strict, no `any`, no missing imports).

**Files in scope (informational):** `tests/` (entire tree — destructive move), new files under `tests/core/`, `tests/scoring/`, `tests/traffic/`, `tests/network/`.

### FEAT-2 — Visual-smoke layer (Playwright)

**Acceptance criteria (Given-When-Then):**

- **Given** the 9 campaign levels + the sandbox, **when** new Playwright specs are authored under `tests/visual/`, **then** there is exactly one spec per surface (10 specs total). Each spec asserts: the level renders, accepts pointer input on a known control, runs a sim to completion (≤30s sim-time), and displays a numeric score.
- **Given** `npm run test:visual`, **when** FEAT-2 is complete, **then** all visual specs pass and the run completes in **under 60 seconds** total.
- **Given** the existing visual test fixtures and reference screenshots, **when** the new specs are written, **then** they reuse the existing reference screenshots where appropriate (don't regenerate from scratch — those are calibrated).
- **Given** an intentional regression introduced as a sanity check (e.g., temporarily swap `MAX_SPEED` to 100), **when** the visual layer runs, **then** at least one spec flags the regression.

**Files in scope (informational):** `tests/visual/` (new), reference fixtures preserved.

### FEAT-3 — Integration layer + cherry-pick load-bearing legacy assertions

**Acceptance criteria (Given-When-Then):**

- **Given** the system boundaries (solution import/export, save/load, campaign progression), **when** integration specs are authored under `tests/integration/`, **then** they cover: `ReferenceSolution` round-trip serialisation, save/load of a campaign progress object, level unlock graph traversal, and at least one cross-module flow (e.g., `RoadBuilder` produces a valid `RoadNetwork` that `UnifiedScore` can grade). Total integration specs ≤ 50.
- **Given** `tests/_legacy/`, **when** the cherry-pick step runs, **then** any legacy assertion that has historically caught a real regression (calibration drift in `tests/traffic/`, BPR validation in `tests/network/`, the `GameLineCount` enforcement) is preserved by re-implementing it in the new layer or being kept as-is. The reviewer must explicitly call out which legacy tests were preserved and why.
- **Given** all three layers (behaviour + visual + integration) are in place, **when** `tests/_legacy/` is deleted, **then** `npm test` and `npm run test:visual` both still pass and runtime targets are met (`npm test` < 5s, `npm run test:visual` < 60s).
- **Given** the post-rewrite total, **when** counted, **then** total test files ≤ 50, total test LOC ≤ 6,000, total tests ≤ 500.

**Files in scope (informational):** `tests/integration/` (new), selective restoration from `tests/_legacy/` to permanent locations, deletion of `tests/_legacy/`.

## Out of scope

- Touching anything under `src/` — this initiative does not change the codebase being tested. Source-side cleanup is INIT-2026-05-10-trafficgame-simplification-source.
- Re-tuning calibrated thresholds. The brain's `per-map-calibrated-thresholds` decision rules out auto-derived thresholds; preserve them in the new layer verbatim.
- Adding new test framework dependencies (Jest, Mocha, Cypress, etc.). Keep Vitest + Playwright as-is.

## Reviewer focus

When verifying this initiative at PR boundary:

1. Run the existing canvas-overlay debug case manually (open menu, hover button 5+ times) — does the new visual layer catch the cumulative-darken regression? It should.
2. Cherry-pick check: does the diff add back any specific legacy tests, and do their commit messages explain why each was kept?
3. Coverage check: any major source module (>200 LOC) with zero tests in the new layer is a smell — flag for the next initiative.
