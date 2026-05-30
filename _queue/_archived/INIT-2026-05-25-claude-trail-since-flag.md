---
initiative_id: INIT-2026-05-25-claude-trail-since-flag
project: claude-harness
project_repo_path: /home/parso/forge/projects/claude-harness
created_at: '2026-05-25T17:46:00.000Z'
iteration_budget: 4
cost_budget_usd: 3.0
phase: pending
origin: architect
features:
  - feature_id: FEAT-1
    title: --since flag for multi-cycle trail
    depends_on: []
worktree_path: /home/parso/forge/_worktrees/INIT-2026-05-25-claude-trail-since-flag
---

# INIT-2026-05-25-claude-trail-since-flag — multi-cycle history flag

> Cycle 3 of claude-harness. Builds on cycles 1, 2A, 2B (events/cost/
> git sections shipped). Adds `--since <cycle-id>` flag so claude-trail
> can produce a multi-cycle history for an initiative that spanned
> retries.

## What this ships

A `--since <cycle-id>` CLI flag that:
- Discovers cycle dirs matching the initiative ID across `_logs/`.
- Filters to cycles whose timestamp is `>= <cycle-id>`'s timestamp.
- Aggregates events from all matching cycles into a combined trail.
- Adds a new `## Cycles included` section at the top listing each
  cycle ID + timestamp.
- All other sections (Summary, Phases, Cost, Git activity, Themes,
  Files) aggregate across the included cycles.

## Constraints

- Post-cycle-1+2A+2B worktree.
- Gates point at NEW test files.
- node:test, no new deps.
- Existing 46+ tests must keep passing.

## Acceptance

`claude-trail INIT-X --since 2026-05-24T12-00-00Z_INIT-X` against
a fixture with 2 cycle dirs produces a trail with `## Cycles
included` listing both, and aggregated phase/cost/etc data from
both cycles.

## Decomposition hint — ONE WI (single-scope per cycle-2C-lesson)

ONE WI: add `--since` flag handling to `src/cli.ts`. The flag
parsing + cycle dir discovery + aggregation goes in
`src/cli.ts` directly (small enough). NEW
`tests/since-flag.test.ts` that:
- Sets up a tmpdir with 2 cycle dirs for INIT-X.
- Spawns CLI with `--since` against the older cycle.
- Asserts stdout contains `## Cycles included` with both cycle IDs.

Gate:
`node --test --experimental-strip-types tests/since-flag.test.ts` —
fails on clean tree (file doesn't exist).

If a second WI is genuinely needed (e.g. extract aggregation helper
to `src/aggregate.ts`), PM may add WI-2 depends_on WI-1. Default:
one WI.
