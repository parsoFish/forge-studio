---
initiative_id: INIT-2026-05-25-claude-trail-git-enrich
project: claude-harness
project_repo_path: /home/parso/forge/projects/claude-harness
created_at: '2026-05-25T16:36:00.000Z'
iteration_budget: 4
cost_budget_usd: 3.0
phase: pending
origin: architect
features:
  - feature_id: FEAT-1
    title: Enriched git section with commits sub-block
    depends_on: []
worktree_path: /home/parso/forge/_worktrees/INIT-2026-05-25-claude-trail-git-enrich
---

# INIT-2026-05-25-claude-trail-git-enrich — git enrichment

> Cycle 2B retry. Builds on cycle 2A. PREVIOUS ATTEMPT FAILED because
> WI-2's gate verified only the renderer (unit test), not the CLI
> wiring + golden. Unifier correctly identified the gap but couldn't
> close it. This retry uses an INTEGRATION-LEVEL gate on WI-2 so the
> WI's gate doesn't pass until cli.ts is actually wired.

## What this ships

Replace `## Files touched` in claude-trail with `## Git activity`
containing `### Commits` (oneline-style) + `### Files touched`.

## Constraints

- Worktree has post-cycle-1+2A files: src/{events,trail,brain,git,
  cli}.ts + tests/{events,brain,git,trail,cli,events-cost,trail-cost}
  .test.ts.
- **Your gates MUST point at NEW test files.** Pointing at any
  existing test → iter-0 gate-too-loose.
- **WI gates MUST exercise the AC, not a fragment of it.** If the
  AC says "CLI stdout matches golden with Git activity section", the
  gate must actually RUN the CLI + diff the golden. Renderer-only
  unit tests are insufficient.
- TypeScript, --experimental-strip-types, node:test, no new deps.
- Update tests/fixtures/INIT-FIXTURE-1.trail.golden.md.
- Existing tests must keep passing.

## Acceptance

`## Git activity` section in the trail, two sub-blocks (Commits +
Files touched), golden updated, CLI output matches byte-for-byte.

## Decomposition hint (PM should follow EXACTLY)

Three small WIs:

- **WI-1**: extend `src/git.ts` with `getCommits(jsonPath):
  {sha:string; subject:string}[]`. NEW test
  `tests/git-commits.test.ts` covering parse/empty/short-sha.
  Gate: `node --test --experimental-strip-types tests/git-commits.test.ts`.

- **WI-2** (depends_on WI-1): add `renderGitActivity` to
  `src/trail.ts` AND wire it into `src/cli.ts` replacing
  `renderFilesTouchedSection`. Add commits.json to the fixture.
  Update `tests/fixtures/INIT-FIXTURE-1.trail.golden.md` so `##
  Files touched` becomes `## Git activity` with both sub-blocks.
  Create a NEW integration test
  `tests/trail-git-activity-integration.test.ts` that:
  1. Spawns the CLI against the fixture,
  2. Asserts stdout contains the literal string `## Git activity`
     (NOT `## Files touched`),
  3. Asserts both sub-block headers `### Commits` and
     `### Files touched` appear,
  4. Asserts the existing `tests/fixtures/INIT-FIXTURE-1.trail.golden.md`
     content matches stdout byte-for-byte.
  **Gate: `node --test --experimental-strip-types tests/trail-git-activity-integration.test.ts`**
  — fails on clean tree because the file doesn't exist yet, AND
  even once it exists it'll fail until cli.ts is wired (because
  current cli emits `## Files touched`). Only passes when ALL of:
  test file present + cli wired + golden updated. This is the
  SHARP-GATE integration pattern.
