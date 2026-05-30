---
initiative_id: INIT-2026-05-24-claude-trail-scaffold
project: claude-harness
project_repo_path: /home/parso/forge/projects/claude-harness
created_at: '2026-05-24T10:59:23.858Z'
iteration_budget: 5
cost_budget_usd: 5
phase: pending
origin: architect
worktree_path: /home/parso/forge/_worktrees/INIT-2026-05-24-claude-trail-scaffold
previous_failure_modes:
  - requeued-from-failed-2026-05-24
  - requeued-from-failed-2026-05-24
  - requeued-from-failed-2026-05-24
  - requeued-from-failed-2026-05-24
  - requeued-from-failed-2026-05-24
  - requeued-from-failed-2026-05-24
features:
  - feature_id: FEAT-1
    title: CLI scaffold + events.jsonl phase rollup
    depends_on: []
  - feature_id: FEAT-2
    title: Brain themes section (filter by initiative_id mention)
    depends_on:
      - FEAT-1
  - feature_id: FEAT-3
    title: Files touched section (git log + diff --name-only)
    depends_on:
      - FEAT-1
---

# INIT-2026-05-24-claude-trail-scaffold — claude-trail scaffold + single-cycle trail

> First cycle of the claude-harness project. See
> [`docs/planning/2026-05-24-claude-harness/PROPOSAL.md`](../../../docs/planning/2026-05-24-claude-harness/PROPOSAL.md)
> and the [seed](../../../docs/planning/2026-05-24-claude-harness/CYCLE-1-SEED.md).

## What this initiative ships

`claude-trail <initiative-id>` — a TypeScript CLI that reads a single
forge cycle's on-disk state (events.jsonl, brain themes, git log) and
emits a markdown trail doc to stdout. Sections in fixed order:

1. `# Trail — <initiative-id>` (title)
2. `## Summary` — one paragraph: outcome + verdict + total cost
3. `## Phases` — chronological per-phase event lists
4. `## Themes consulted` — brain theme paths + one-line summaries
5. `## Files touched` — git diff --name-only across the cycle's commits

## Features

### FEAT-1 — CLI scaffold + events.jsonl phase rollup

Build `src/cli.ts` (entry point), `src/trail.ts` (composes the
markdown), `src/events.ts` (events.jsonl reader + per-phase rollup).
The CLI parses `process.argv` for the positional `<initiative-id>`,
resolves it to a cycle dir under `_logs/<...>`, and emits sections 1+2+3.

**WI-level acceptance** (per WI):
- `npm test` passes for the WI's added tests.
- The WI's created files appear under `src/` or `tests/`.

### FEAT-2 — Brain themes section

Add `src/brain.ts` that walks `brain/` (read by relative path from
the CLI's invocation cwd), finds themes whose body text mentions the
target initiative_id, and emits section 4.

### FEAT-3 — Files touched section

Add `src/git.ts` that runs `git log` + `git diff --name-only`
against the cycle's worktree path (recorded in the cycle's events as
`worktree_path` on the cycle.start event) and emits section 5.

## Acceptance — cycle 1 binary criteria

A single test, one fixture, one golden:

- GIVEN `tests/fixtures/cycle-INIT-FIXTURE-1/` exists with a frozen
  events.jsonl, brain themes slice, and git log JSON dump
- WHEN `node --experimental-strip-types src/cli.ts INIT-FIXTURE-1`
  runs from inside the fixture's enclosing tempdir
- THEN stdout matches `tests/fixtures/INIT-FIXTURE-1.trail.golden.md`
  byte-for-byte

This is the WHOLE bar for cycle 1. Failed cycles, send-back rounds,
multi-cycle aggregation are out of scope.

## Out of scope (deferred to cycle 2/3)

- `--since <cycle-id>` flag (cross-cycle).
- Failure-mode summary across retries.
- PR metadata section.
- Cost-per-skill breakdown.
- Any flags whatsoever — positional only for cycle 1.

## Constraints from the project profile

- TypeScript, `--experimental-strip-types`. No build step.
- `node:test` for tests; no jest / vitest / mocha.
- No runtime dependencies. `devDependencies` for `@types/node` is fine.
- No network calls at runtime.
- One npm package; source under `src/`, tests under `tests/`.
