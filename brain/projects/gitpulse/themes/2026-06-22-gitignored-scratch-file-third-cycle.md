---
title: Gitignored scratch-file retry — third consecutive cycle; AGENT.md fix still not applied
description: >-
  git add fix_plan.md AGENT.md without -f failed in ALL 4 WIs and the unifier
  (≥10 wasted invocations) for the third cycle in a row. The AGENT.md encoding
  fix recommended after cycle 2 has not been applied.
category: antipattern
keywords:
  - fix_plan
  - AGENT.md
  - gitignore
  - chore-commit
  - repeated-actions
  - skill-fix-not-applied
  - forge/history
created_at: 2026-06-22T00:00:00.000Z
updated_at: 2026-06-22T00:00:00.000Z
---

# Gitignored scratch-file retry — third consecutive cycle

## Pattern

Every WI (WI-1 seq 21→22, WI-2 seq 22→23, WI-3 ~seq 283→286, WI-4 ~seq 461→464) and the unifier (seq 41→47) followed the same sequence:

1. `git add fix_plan.md AGENT.md` (no `-f`) → silent fail or "nothing to commit"
2. Retry with `git add -f fix_plan.md AGENT.md`

The unifier additionally staged `forge/history/<init>/demo/` with plain `git add`, inspected `.gitignore` and `git ls-files`, then retried with `git add -f`.

Total wasted git invocations across this initiative: ≥10.

## Third-cycle recurrence

| Cycle | WIs affected |
|---|---|
| 2026-06-21 ownership-hotspots-top-flag | WI-4 (demo/) |
| 2026-06-21 json-output-flag | WI-1, WI-2 |
| 2026-06-22 compare-ref-analytics-delta | WI-1, WI-2, WI-3, WI-4, unifier |

The antipattern was documented after cycle 1 (`2026-06-21-gitignored-scratch-files-double-commit.md`) and again after cycle 2 (`2026-06-21-gitignored-scratch-files-recurrence.md`). The AGENT.md encoding fix was recommended in both — it has not been applied.

## Gitignored surface

At minimum:
- `fix_plan.md` — loop scratch
- `AGENT.md` — loop scratch (when it's the per-worktree version)
- `demo/` — gitignored output directory
- `forge/history/` — gitignored in the project `.gitignore`

## Required fix (still pending from prior cycles)

Add to the per-worktree `AGENT.md` template:

```
## Gitignored files
- fix_plan.md, AGENT.md — use `git add -f` or skip chore commit
- demo/           — gitignored output; use `git add -f` if committing
- forge/history/  — gitignored; use `git add -f` if committing
```

## Sources

- `_logs/2026-06-22T08-23-03_INIT-2026-06-22-compare-ref-analytics-delta/events.jsonl` — seq 21–22 (WI-1), seq 22–23 (WI-2), seq ~283–286 (WI-3), seq ~461–464 (WI-4), seq 41–47 (unifier)
- `/home/parso/forge/brain/cycles/_raw/2026-06-22T08-23-03_INIT-2026-06-22-compare-ref-analytics-delta.md`
- Prior cycles: `brain/projects/gitpulse/themes/2026-06-21-gitignored-scratch-files-recurrence.md`
