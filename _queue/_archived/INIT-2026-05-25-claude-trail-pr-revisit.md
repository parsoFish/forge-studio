---
initiative_id: INIT-2026-05-25-claude-trail-pr-revisit
project: claude-harness
project_repo_path: /home/parso/forge/projects/claude-harness
created_at: '2026-05-25T18:00:00.000Z'
iteration_budget: 4
cost_budget_usd: 3.0
phase: pending
origin: architect
features:
  - feature_id: FEAT-1
    title: PR metadata section (revisit)
    depends_on: []
worktree_path: /home/parso/forge/_worktrees/INIT-2026-05-25-claude-trail-pr-revisit
---

# INIT-2026-05-25-claude-trail-pr-revisit — PR section retry

> Cycle 5 = retry of 2C. Same scope: PR metadata section. Cycle 2C
> failed 3× because dev-loop's WI gate verified only the renderer,
> not the cli.ts wiring. Retry uses the SAME 1-WI shape that worked
> for cycles 3 + 4 (–since flag, –out flag), and an integration-test
> gate that exercises full CLI output.

## What this ships

A `## PR` section in claude-trail's output, between
`## Git activity` and `## Themes consulted`. Reads
`.forge/_pr-metadata.json` from cwd. Skips section if absent.

## Constraints

- Post-cycle-1/2A/2B/3/4 worktree state.
- Gate points at NEW test file.
- node:test, no new deps.
- Update tests/fixtures/INIT-FIXTURE-1.trail.golden.md.
- Existing 60 tests must keep passing.

## Acceptance

`## PR` section in trail. CLI stdout matches updated golden
byte-for-byte against a fixture that includes
`_pr-metadata.json`.

## Decomposition hint — STRICTLY ONE WI

ONE WI. PM MUST NOT split this. The previous 2C attempts that split
into reader+integration WIs all wedged because the per-WI gates
tested fragments not integration.

The one WI does all of:
1. NEW `src/pr.ts` with `readPrMetadata(cwd)` returning
   `{url,title,state}|null`.
2. NEW `renderPrSection(meta)` in `src/trail.ts` (export from
   trail.ts).
3. Wire `pr` + `renderPrSection` into `src/cli.ts` between Git
   activity and Themes sections.
4. Add `tests/fixtures/cycle-INIT-FIXTURE-1/.forge/_pr-metadata.json`
   to fixture.
5. Update `tests/fixtures/INIT-FIXTURE-1.trail.golden.md` to
   include the new `## PR` section in the correct position.
6. NEW `tests/pr-integration.test.ts`:
   - Spawn the CLI against the fixture.
   - Assert stdout contains `## PR` between `## Git activity` and
     `## Themes consulted`.
   - Assert stdout matches the updated golden byte-for-byte.

Gate: `node --test --experimental-strip-types tests/pr-integration.test.ts`
— fails at iter 0 (test file doesn't exist), then fails until ALL 6
steps are done (because the integration test requires both code
wiring AND golden update). Only passes when the full chain is in
place. This is the SHARP-GATE integration pattern.
