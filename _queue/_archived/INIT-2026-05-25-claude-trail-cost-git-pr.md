---
initiative_id: INIT-2026-05-25-claude-trail-cost-git-pr
project: claude-harness
project_repo_path: /home/parso/forge/projects/claude-harness
created_at: '2026-05-25T00:00:00.000Z'
iteration_budget: 5
cost_budget_usd: 5
phase: pending
origin: architect
worktree_path: /home/parso/forge/_worktrees/INIT-2026-05-25-claude-trail-cost-git-pr
previous_failure_modes:
  - requeued-from-failed-2026-05-24
features:
  - feature_id: FEAT-1
    title: Per-phase cost section
    depends_on: []
  - feature_id: FEAT-2
    title: Enriched git section (commit messages + diff stat)
    depends_on: []
  - feature_id: FEAT-3
    title: PR metadata section
    depends_on: []
---

# INIT-2026-05-25-claude-trail-cost-git-pr — claude-trail cost / git / PR rollup

> Cycle 2 of the claude-harness project. Cycle 1 shipped claude-trail
> v1 (5 sections: title / summary / phases / themes / files touched).
> Cycle 2 extends it with three new dimensions for forge debugging.
> See seed: [docs/planning/2026-05-24-claude-harness/CYCLE-2-SEED.md].

## What this initiative ships

Three new sections added to `claude-trail`'s output, all reading
on-disk state only (no network), all covered by the existing
golden-file integration test pattern that cycle 1 established.

## Features

### FEAT-1 — Per-phase cost section

Sum `cost_usd` from events.jsonl per phase. Emit a new section
`## Cost rollup` between `## Phases` and `## Themes consulted`. Each
phase listed as a bullet with its total cost; a final "Total"
line summing all phases. Skip the section entirely when zero events
carry `cost_usd` (most fixtures won't have cost data).

**Implementation hint**: extend `rollupByPhase` in `src/events.ts`
to also produce a `costByPhase` Map; render in a new
`renderCostSection` exported from `src/trail.ts`.

### FEAT-2 — Enriched git section

Cycle 1's `## Files touched` shows only paths. Replace with two
nested sub-blocks under a renamed `## Git activity` section:
- `### Commits` — bullet list of `<short-sha> <subject>` (output of
  `git log --oneline <base>...HEAD`).
- `### Files touched` — the existing per-file list (unchanged
  format).

**Implementation hint**: add `getCommits(worktreePath, base, head)`
to `src/git.ts` returning `{ sha: string; subject: string }[]`.
The renderer composes the two sub-blocks. Update the golden file to
include the new commits sub-block.

### FEAT-3 — PR metadata section

Read `<worktree>/.forge/_pr-metadata.json` (the gh-shim writes this
in production; absent for cycles that don't reach review). When
present, emit a new section `## PR` between `## Git activity` and
`## Themes consulted` with the PR URL, title, and state
(`open`/`merged`). Skip the section entirely when the file doesn't
exist.

**Implementation hint**: new `src/pr.ts` with
`readPrMetadata(worktreePath): GhMetadata | null` (mirror the shape
in forge's `orchestrator/gh-shim.ts:GhMetadata`); `renderPrSection`
in `src/trail.ts`.

## Acceptance — cycle 2 binary criteria

Integration test (`tests/trail.test.ts`, extended) against an updated
fixture under `tests/fixtures/cycle-INIT-FIXTURE-1/`:
- Add cost data to the fixture's `events.jsonl` (a few events with
  `cost_usd` populated per phase).
- Add a `_pr-metadata.json` to the fixture.
- Add a git-log JSON dump that includes commit subjects.
- Update `tests/fixtures/INIT-FIXTURE-1.trail.golden.md` so the new
  sections appear in their expected positions.
- The CLI's stdout against the fixture matches the golden
  byte-for-byte.

Plus the existing cycle-1 ACs continue to pass — no regression in
the 5 original sections.

## Out of scope (deferred to cycle 3)

- `--since <cycle-id>` flag (cross-cycle).
- Failure-mode summary across retries.
- Per-skill cost breakdown (only per-phase for cycle 2).
- Multi-cycle initiative trails.

## Constraints from the project profile

- TypeScript, `--experimental-strip-types`. No build step.
- `node:test` for tests; no jest / vitest / mocha.
- No runtime dependencies.
- No network calls at runtime.
- All gates `node --test --experimental-strip-types tests/<x>.test.ts`
  pointing at a SPECIFIC test file that doesn't exist yet (so iter-0
  gate fails per the post-cycle-1 contract).
- Don't break cycle 1's existing golden — update consistently as the
  sections evolve.
