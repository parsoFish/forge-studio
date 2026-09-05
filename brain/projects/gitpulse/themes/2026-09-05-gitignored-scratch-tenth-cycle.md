---
title: "Gitignored scratch files — tenth consecutive gitpulse cycle; projects/gitpulse/AGENT.md still absent"
description: >-
  ralph.uncommitted-work-swept fired for all 3 WIs in the --markdown cycle (fix_plan.md, AGENT.md
  untracked). Tenth consecutive gitpulse cycle. projects/gitpulse/AGENT.md does not exist. The
  autocommit safety net is the only guard; ten data points with zero delivery impact.
category: antipattern
keywords:
  - fix_plan
  - AGENT.md
  - gitignore
  - scratch-files
  - uncommitted-work-swept
  - repeated-actions
  - recurrence
  - ten-cycles
related_themes: [2026-09-04-gitignored-scratch-ninth-cycle, 2026-09-05-markdown-output-flag-delivery]
created_at: 2026-09-05T02:00:00.000Z
updated_at: 2026-09-05T02:00:00.000Z
recurrence: gitignored-scratch-files
---

# Gitignored scratch files — tenth consecutive cycle

## Pattern

All 3 WIs (WI-1, WI-2, WI-3) exited iteration 1 with uncommitted `fix_plan.md` and `AGENT.md`. `ralph.uncommitted-work-swept` fired 3 times; forge autocommit swept them. brainReads=0 across all sessions — the brain has not been a delivery vehicle for this fix.

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
| include-path-filter (2026-09-04) | `2026-09-04-gitignored-scratch-ninth-cycle.md` |
| markdown-output-flag (2026-09-05) | **this file** |

**Ten consecutive cycles. Template has never been created.**

## Required fix (critically overdue — ten cycles)

Create `projects/gitpulse/AGENT.md` and include the gitignored-file warning so forge stamps it at worktree init:

```
## Gitignored files — never `git add` without `-f`
fix_plan.md   — loop scratch, gitignored
AGENT.md      — loop scratch, gitignored
demo/         — gitignored output directory
forge/history/ — gitignored history cache
```

The brain has documented this ten times. ralph sessions have brainReads=0. Fix MUST be in the template, not the brain.

## Scope this cycle

WI-1 (sweeps: 1) + WI-2 (sweeps: 1) + WI-3 (sweeps: 1) = 3 `ralph.uncommitted-work-swept` events. Zero delivery impact.

## Sources

- `_logs/2026-09-05T01-20-18_INIT-2026-09-05-init-2026-09-05-markdown-output-flag/events.jsonl` — `ralph.uncommitted-work-swept` WI-1 iter=1, WI-2 iter=1, WI-3 iter=1
- `/home/parso/forge-m5-a/brain/cycles/_raw/2026-09-05T01-20-18_INIT-2026-09-05-init-2026-09-05-markdown-output-flag.md`

## See also

- [[2026-09-04-gitignored-scratch-ninth-cycle]] — prior (ninth) cycle of this recurrence
- [[2026-09-05-markdown-output-flag-delivery]] — the initiative this sweep occurred in
