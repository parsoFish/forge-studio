---
initiative_id: INIT-2026-05-10-trafficgame-manhattan-v4
project: trafficGame
project_repo_path: /home/parso/forge/projects/trafficGame
created_at: '2026-05-10T12:55:00.000Z'
iteration_budget: 8
cost_budget_usd: 5
phase: pending
quality_gate_cmd:
  - npm
  - test
features:
  - feature_id: FEAT-1
    title: Add manhattanDistance utility to Vector2
    depends_on: []
worktree_path: /home/parso/forge/_worktrees/INIT-2026-05-10-trafficgame-manhattan-v4
---

# Add `manhattanDistance` to Vector2

## Why

`src/core/Vector2.ts` has a complete suite of vector utilities (`distance`,
`distanceSquared`, `magnitude`, `lerp`, `equals`, `dot`, `normalize`,
`lineSegmentIntersection`) — but no L1 / Manhattan / taxicab distance. L1
distance is a common need in grid- and path-aware game code (heuristics,
quick proximity checks where Euclidean is overkill). Adding it rounds out the
core math API alongside the existing distance functions.

## Scope

A single pure function `manhattanDistance(a: Vector2, b: Vector2): number`
exported from `src/core/Vector2.ts`, plus tests in
`tests/core/Vector2.test.ts` under a new `describe('manhattanDistance', ...)`
block.

## Acceptance

- `manhattanDistance({x:0,y:0}, {x:3,y:4})` returns `7`.
- `manhattanDistance(v, v)` returns `0` for any `v`.
- `manhattanDistance({x:-1,y:-1}, {x:1,y:1})` returns `4` (negative inputs handled via absolute value).
- The function is `export`ed from `src/core/Vector2.ts`.
- New tests live in `tests/core/Vector2.test.ts` and follow the existing `describe`/`it` style of that file.
- `npm test` passes — all 2558 prior tests still green; new tests pass.
- TypeScript strict mode passes (no `any`, no implicit-any escape hatches).

## Out of scope

- Any other Vector2 utilities (Chebyshev distance, angle, rotation, etc.).
- Edits to any `src/` file other than `src/core/Vector2.ts`.
- Documentation updates outside the function's own JSDoc / inline comment (no
  changes to `docs/`, `README.md`, `CLAUDE.md`).
- Visual / Playwright / canvas-rendering tests.

## Constraints

- Pure function — no mutation of inputs, no side effects, no `Math.random`.
- ~150 LOC max per file (per project CLAUDE.md). `Vector2.ts` is currently 101
  lines; the addition stays well under the cap.
- Match the existing code style of `Vector2.ts` (no class, plain `export
  function`).
