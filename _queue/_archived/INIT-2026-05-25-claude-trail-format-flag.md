---
initiative_id: INIT-2026-05-25-claude-trail-format-flag
project: claude-harness
project_repo_path: /home/parso/forge/projects/claude-harness
created_at: '2026-05-25T18:43:00.000Z'
iteration_budget: 4
cost_budget_usd: 3.0
phase: pending
origin: architect
features:
  - feature_id: FEAT-1
    title: --format json flag for machine-readable output
    depends_on: []
worktree_path: /home/parso/forge/_worktrees/INIT-2026-05-25-claude-trail-format-flag
---

# INIT-2026-05-25-claude-trail-format-flag — --format flag

> Cycle 7. Builds on cycles 1, 2A, 2B, 3, 4, 5.

## What this ships

A `--format json|markdown` CLI flag (default markdown — current
behavior). When `--format json`, output is a JSON object with the
trail's data (instead of markdown).

JSON shape:
```
{
  "initiativeId": "INIT-X",
  "outcome": "complete",
  "verdict": "complete",
  "totalCostUsd": 0.24,
  "phases": [
    { "phase": "architect", "events": [...] },
    ...
  ],
  "themes": [{ "path": "...", "summary": "..." }],
  "filesTouched": [...],
  "commits": [{ "sha": "...", "subject": "..." }],
  "pr": { "url": "...", "title": "...", "state": "..." } | null,
  "costByPhase": { "phase": cost }
}
```

## Constraints

- Post-cycle-1..5 worktree state.
- Gate points at NEW test file.
- node:test, no new deps.
- Existing 63 tests must keep passing (default behavior unchanged).

## Acceptance

`claude-trail INIT-X --format json` writes JSON to stdout. Without
the flag (or `--format markdown`), existing markdown behavior.

## Decomposition hint — ONE WI

ONE WI: extend cli.ts to parse `--format`. When json, skip the
render functions and emit a JSON object built from the same data
sources (events, themes, files, commits, pr meta).

NEW `tests/format-flag.test.ts`:
- Spawns CLI with `--format json`, parses stdout as JSON,
  asserts top-level keys.
- Spawns CLI without flag, asserts stdout starts with `# Trail`.

Gate: `node --test --experimental-strip-types tests/format-flag.test.ts`.
