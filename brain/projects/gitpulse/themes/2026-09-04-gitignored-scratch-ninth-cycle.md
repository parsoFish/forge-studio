---
title: "Gitignored scratch files — ninth consecutive gitpulse cycle; template still unpatched"
description: >-
  ralph.uncommitted-work-swept fired for all 3 WIs in the include-path-filter cycle (fix_plan.md,
  AGENT.md untracked). Ninth consecutive gitpulse cycle with this recurrence. projects/gitpulse
  has no AGENT.md worktree template; the forge autocommit safety net is the only guard.
category: antipattern
keywords:
  - fix_plan
  - AGENT.md
  - gitignore
  - scratch-files
  - uncommitted-work-swept
  - repeated-actions
  - recurrence
  - nine-cycles
related_themes: [2026-08-31-gitignored-scratch-eighth-cycle, 2026-09-04-include-path-filter-delivery, 2026-09-05-gitignored-scratch-tenth-cycle]
created_at: 2026-09-04T16:06:03.000Z
updated_at: 2026-09-04T16:06:03.000Z
recurrence: gitignored-scratch-files
---

# Gitignored scratch files — ninth consecutive cycle

## Pattern

All 3 WIs (WI-1, WI-2, WI-3) exited iteration 1 with uncommitted `fix_plan.md` and `AGENT.md`. `ralph.uncommitted-work-swept` fired 3 times. The forge autocommit safety net handled all 3; zero delivery impact. However, `projects/gitpulse/AGENT.md` does not exist (checked post-merge) — there is no worktree template to patch.

## Recurrence table

| Cycle | Theme page |
|---|---|
| ownership-hotspots (2026-06-21) | `2026-06-21-gitignored-scratch-files-double-commit.md` |
| json-output-flag (2026-06-21) | `2026-06-21-gitignored-scratch-files-recurrence.md` |
| compare-ref-analytics-delta (2026-06-22) | `2026-06-22-gitignored-scratch-file-third-cycle.md` |
| tags-command (2026-07-11) | `2026-07-11-gitignored-scratch-fourth-cycle.md` |
| cli-sort-flag (2026-07-12) | `2026-07-12-gitignored-scratch-fifth-cycle.md` |
| no-merges-flag (2026-08-28) | `2026-08-28-gitignored-scratch-sixth-cycle.md` |
| author-filter-flag (2026-08-31) | `2026-08-31-gitignored-scratch-seventh-cycle.md` |
| tag-range-filter (2026-08-31) | `2026-08-31-gitignored-scratch-eighth-cycle.md` |
| include-path-filter (2026-09-04) | **this file** |

**Nine consecutive cycles. Template has never been created.**

## Required fix (critically overdue — nine cycles)

`projects/gitpulse/AGENT.md` does not exist at all. Create it and stamp the gitignored-file warning in the worktree template (the file is stamped at worktree init by forge):

```
## Gitignored files — never `git add` without `-f`
fix_plan.md   — loop scratch, gitignored
AGENT.md      — loop scratch, gitignored
demo/         — gitignored output directory
forge/history/ — gitignored history cache
```

The brain documents the problem; ralph sessions have brainReads=0. Fix MUST be in the template, not the brain.

## Scope this cycle

WI-1 (sweeps: 1) + WI-2 (sweeps: 1) + WI-3 (sweeps: 1) = 3 `ralph.uncommitted-work-swept` events.

## Sources

- `_logs/2026-09-04T15-35-29_INIT-2026-09-04-include-path-filter-flag/events.jsonl` — `ralph.uncommitted-work-swept` WI-1 iter=1, WI-2 iter=1, WI-3 iter=1
- `/home/parso/forge-m5-a/brain/cycles/_raw/2026-09-04T15-35-29_INIT-2026-09-04-include-path-filter-flag.md`

## See also

- [[2026-08-31-gitignored-scratch-eighth-cycle]] — prior (eighth) cycle of this recurrence
- [[2026-09-04-include-path-filter-delivery]] — the initiative this sweep occurred in
