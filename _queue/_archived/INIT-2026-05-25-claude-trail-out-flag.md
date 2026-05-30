---
initiative_id: INIT-2026-05-25-claude-trail-out-flag
project: claude-harness
project_repo_path: /home/parso/forge/projects/claude-harness
created_at: '2026-05-25T17:55:00.000Z'
iteration_budget: 4
cost_budget_usd: 3.0
phase: pending
origin: architect
features:
  - feature_id: FEAT-1
    title: --out <path> flag to write trail to file
    depends_on: []
worktree_path: /home/parso/forge/_worktrees/INIT-2026-05-25-claude-trail-out-flag
---

# INIT-2026-05-25-claude-trail-out-flag — write trail to file

> Cycle 4 of claude-harness. Builds on cycles 1, 2A, 2B, 3.

## What this ships

A `--out <path>` CLI flag. When provided, the trail is written to
the given file path instead of stdout; nothing goes to stdout
except a "wrote trail to <path>" confirmation. Without the flag,
existing stdout behavior is unchanged.

## Constraints

- Post-cycle-1+2A+2B+3 worktree state.
- Gates point at NEW test files.
- node:test, no new deps.
- Existing 53 tests must keep passing.

## Acceptance

`claude-trail INIT-X --out /tmp/trail.md` writes the markdown to
the file + prints `wrote trail to /tmp/trail.md` to stdout +
exits 0. Without `--out`, behavior unchanged.

## Decomposition hint — ONE WI

ONE WI: extend the `--since` arg parsing in `src/cli.ts` to also
handle `--out <path>` (and accept positional initiative-id + zero or
more flag pairs in any order). When `--out` is given, write to the
file via `node:fs/promises.writeFile`. Echo the confirmation line.

NEW `tests/out-flag.test.ts` covering:
- Writes the trail to the given path
- Confirmation line printed to stdout when --out used
- Without --out: stdout has full trail (regression)
- Bad path (read-only / nonexistent dir): exits non-zero with stderr

Gate: `node --test --experimental-strip-types tests/out-flag.test.ts`
— fails at iter 0 (file doesn't exist).
