---
initiative_id: INIT-2026-05-25-claude-trail-help-flag
project: claude-harness
project_repo_path: /home/parso/forge/projects/claude-harness
created_at: '2026-05-25T19:41:00.000Z'
iteration_budget: 4
cost_budget_usd: 3.0
phase: pending
origin: architect
features:
  - feature_id: FEAT-1
    title: --help and --version flags
    depends_on: []
worktree_path: /home/parso/forge/_worktrees/INIT-2026-05-25-claude-trail-help-flag
---

# INIT-2026-05-25-claude-trail-help-flag — --help + --version flags

> Cycle 9. Builds on cycles 1, 2A, 2B, 3, 4, 5, 7.

## What this ships

Two CLI flags:
- `claude-trail --help` (or `-h`): prints usage text to stdout
  listing all supported flags + an example invocation; exits 0.
- `claude-trail --version` (or `-V`): prints version from
  `package.json`; exits 0.

Both must come BEFORE any other arg parsing so they short-circuit
without requiring an initiative-id.

## Constraints

- Post-cycle-1..7 worktree.
- Gate at NEW test file.
- node:test, no new deps.
- Existing 81 tests must keep passing.

## Acceptance

`claude-trail --help` shows usage. `claude-trail --version` shows
package version. Both exit 0 without an initiative-id.

## Decomposition hint — ONE WI

ONE WI:
1. Extend cli.ts arg parser to handle `--help` / `-h` and
   `--version` / `-V` early-exit branches.
2. Add usage text constant. Lift version from
   `JSON.parse(readFileSync('./package.json')).version`.
3. NEW `tests/help-version-flag.test.ts`: spawn CLI with --help,
   assert exit 0 and stdout contains "Usage:" and a list of flags.
   Same for --version asserting stdout matches semver-ish.

Gate: `node --test --experimental-strip-types tests/help-version-flag.test.ts`.
