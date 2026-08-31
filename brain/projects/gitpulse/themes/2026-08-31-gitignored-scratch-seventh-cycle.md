---
title: Gitignored scratch files — seventh consecutive cycle recurrence; template still unpatched
description: >-
  ralph.uncommitted-work-swept fired for all 3 WIs in the author-filter cycle (WI-1, WI-2, WI-3).
  fix_plan.md and AGENT.md written untracked in every WI. Seventh consecutive gitpulse cycle.
  AGENT.md worktree template has never been patched despite six prior theme pages.
category: antipattern
keywords:
  - fix_plan
  - AGENT.md
  - gitignore
  - scratch-files
  - uncommitted-work-swept
  - repeated-actions
  - recurrence
  - seven-cycles
related_themes: [2026-08-28-gitignored-scratch-sixth-cycle, 2026-08-31-gitignored-scratch-eighth-cycle]
created_at: 2026-08-31T02:15:00.000Z
updated_at: 2026-08-31T02:15:00.000Z
recurrence: gitignored-scratch-files
---

# Gitignored scratch files — seventh consecutive cycle

## Pattern

After completing each WI, the dev-loop agent wrote `fix_plan.md` and `AGENT.md` into the worktree root untracked. `ralph.uncommitted-work-swept` fired for WI-1, WI-2, and WI-3 — all three. The forge autocommit safety net swept the files. The agent did not commit them voluntarily.

## Recurrence table

| Cycle | Theme page |
|---|---|
| ownership-hotspots (2026-06-21) | `2026-06-21-gitignored-scratch-files-double-commit.md` |
| json-output-flag (2026-06-21) | `2026-06-21-gitignored-scratch-files-recurrence.md` |
| compare-ref-analytics-delta (2026-06-22) | `2026-06-22-gitignored-scratch-file-third-cycle.md` |
| tags-command (2026-07-11) | `2026-07-11-gitignored-scratch-fourth-cycle.md` |
| cli-sort-flag (2026-07-12) | `2026-07-12-gitignored-scratch-fifth-cycle.md` |
| no-merges-flag (2026-08-28) | `2026-08-28-gitignored-scratch-sixth-cycle.md` |
| author-filter-flag (2026-08-31) | **this file** |

**Seven consecutive cycles. Fix has never been applied.**

## Required fix (critically overdue)

The `projects/gitpulse/AGENT.md` worktree template (stamped at worktree init) must include:

```
## Gitignored files — never `git add` without `-f`
fix_plan.md   — loop scratch, gitignored
AGENT.md      — loop scratch, gitignored
demo/         — gitignored output directory
forge/history/ — gitignored history cache
```

This is a brain-to-agent-template propagation gap: the theme pages document the problem; the planner reads them; the dev-loop agent never does. The fix must be applied to the template file, not the brain.

## Scope of sweep this cycle

All 3 WIs (WI-1, WI-2, WI-3) — `ralph.uncommitted-work-swept` ×3. WI count tracks the number of sweep events per initiative.

## Sources

- `_logs/2026-08-31T01-33-01_INIT-2026-08-31-init-2026-08-31-author-filter-flag/events.jsonl` — `ralph.uncommitted-work-swept` WI-1, WI-2, WI-3; `dev-loop.scratch-stripped` WI-1, WI-2, WI-3
- `/home/parso/forge-m2-b/brain/cycles/_raw/2026-08-31T01-33-01_INIT-2026-08-31-init-2026-08-31-author-filter-flag.md`

## See also

- [[2026-08-28-gitignored-scratch-sixth-cycle]] — prior (sixth) cycle of this recurrence
- [[2026-08-31-gitignored-scratch-eighth-cycle]] — next (eighth) cycle of this recurrence
