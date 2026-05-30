---
initiative_id: INIT-2026-05-10-trafficgame-jsdoc
project: trafficGame
project_repo_path: /home/parso/forge/projects/trafficGame
created_at: '2026-05-10T13:30:00.000Z'
iteration_budget: 5
cost_budget_usd: 4
phase: pending
quality_gate_cmd:
  - npm
  - test
features:
  - feature_id: FEAT-1
    title: Add JSDoc to manhattanDistance
    depends_on: []
worktree_path: /home/parso/forge/_worktrees/INIT-2026-05-10-trafficgame-jsdoc
---

# Add a JSDoc comment to `manhattanDistance`

## Why

`src/core/Vector2.ts` was recently extended with `manhattanDistance(a, b)` (PR #46/47). The function is correct and tested, but lacks a JSDoc block — every other function in the file (`distance`, `lerp`, `lineSegmentIntersection`, etc.) has at least an inline comment when the behaviour is not obvious from the name. A short JSDoc with the formula, return semantics, and a one-line example improves discoverability for future contributors using IDE hover.

## Scope

Add a JSDoc block immediately above the existing `manhattanDistance` declaration in `src/core/Vector2.ts`. No behaviour changes, no test changes, no other file edits.

## Acceptance

- A `/** ... */` JSDoc block precedes the `manhattanDistance` declaration.
- The block describes: the L1 / Manhattan / taxicab distance semantics, the input parameters, and the return value.
- The block includes at least one `@param` tag for each parameter and one `@returns` tag.
- The block includes a one-line `@example` showing usage with a numeric expected return.
- No other lines in `src/core/Vector2.ts` are modified.
- `npm test` still passes (no functional change → 2561 tests still green).
- TypeScript strict mode passes.

## Out of scope

- JSDoc for any other function in `Vector2.ts` (this initiative is about `manhattanDistance` specifically — extending JSDoc coverage to the whole file is a separate, larger initiative).
- Edits to `tests/`, `docs/`, `README.md`, or `CLAUDE.md`.
- Behavioural changes to `manhattanDistance`.

## Constraints

- The JSDoc block stays under 12 lines.
- No code changes — comment-only edit.
- ~150 LOC max per file (per project CLAUDE.md). `Vector2.ts` is currently 105 lines; +12 keeps it at ~117.
