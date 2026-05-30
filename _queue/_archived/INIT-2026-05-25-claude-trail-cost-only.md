---
initiative_id: INIT-2026-05-25-claude-trail-cost-only
project: claude-harness
project_repo_path: /home/parso/forge/projects/claude-harness
created_at: '2026-05-25T15:30:00.000Z'
iteration_budget: 4
cost_budget_usd: 3.0
phase: pending
origin: architect
features:
  - feature_id: FEAT-1
    title: Per-phase cost rollup section
    depends_on: []
worktree_path: /home/parso/forge/_worktrees/INIT-2026-05-25-claude-trail-cost-only
---

# INIT-2026-05-25-claude-trail-cost-only — claude-trail per-phase cost section

> Cycle 2 of claude-harness (scope-down from earlier 3-section
> initiative — operator note: smaller cycles ship; integration WIs
> consistently wedge). Just one section, end-to-end, with golden update.

## What this ships

A new `## Cost rollup` section in claude-trail's output, between
`## Phases` and `## Themes consulted`. Sums `cost_usd` from
events.jsonl per phase; emits per-phase bullet + total. Skips when no
event carries `cost_usd`.

## Constraints

- Worktree already has src/{events,trail,brain,git,cli}.ts +
  tests/{events,brain,git,trail,cli}.test.ts from cycle 1's merge.
  **Your WI gates MUST point at NEW test files** (e.g.
  `tests/events-cost.test.ts`) — pointing at any existing
  cycle-1 test file → iter-0 gate-too-loose.
- TypeScript, --experimental-strip-types, node:test, no new deps.
- Update tests/fixtures/INIT-FIXTURE-1.trail.golden.md to include the
  new section (between Phases and Themes).
- Existing cycle-1 tests must keep passing — no regression.

## Acceptance

The new section appears in the golden. The CLI's stdout against the
existing fixture (augmented with cost_usd on a few events) matches
the updated golden byte-for-byte.

## Decomposition hint (PM should follow)

Two small WIs:
- **WI-1**: extend `src/events.ts` with `costByPhase(events): Map<phase, number>`. NEW test file `tests/events-cost.test.ts` covering: per-phase sum, zero-cost events skipped, empty input returns empty Map. Gate: `node --test --experimental-strip-types tests/events-cost.test.ts`.
- **WI-2** (depends_on WI-1): extend `src/trail.ts` with `renderCostSection(costMap): string`; wire into `src/cli.ts`; update fixture's events.jsonl with cost_usd fields; update golden. NEW test file `tests/trail-cost.test.ts` covering: section structure, total line, skip-when-empty. Gate: `node --test --experimental-strip-types tests/trail-cost.test.ts`.
