---
title: "Gitignored scratch files — eighth consecutive gitpulse cycle; AGENT.md template still unpatched"
description: >-
  ralph.uncommitted-work-swept fired for WI-1 and WI-2 in the tag-range-filter cycle (fix_plan.md,
  AGENT.md untracked). Eighth consecutive gitpulse cycle with this recurrence. projects/gitpulse/AGENT.md
  worktree template has never been patched despite seven prior theme pages.
category: antipattern
keywords:
  - fix_plan
  - AGENT.md
  - gitignore
  - scratch-files
  - uncommitted-work-swept
  - repeated-actions
  - recurrence
  - eight-cycles
related_themes: [2026-08-31-gitignored-scratch-seventh-cycle, 2026-08-31-tag-range-filter-delivery]
created_at: 2026-08-31T22:30:00.000Z
updated_at: 2026-08-31T22:30:00.000Z
recurrence: gitignored-scratch-files
---

# Gitignored scratch files — eighth consecutive cycle

## Pattern

WI-1 and WI-2 exited their iterations with uncommitted `fix_plan.md` and `AGENT.md`. `ralph.uncommitted-work-swept` fired twice. WI-3 did not trigger a sweep. The forge autocommit safety net handled it; no delivery impact.

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
| tag-range-filter (2026-08-31) | **this file** |

**Eight consecutive cycles. Fix has never been applied.**

## Required fix (critically overdue — eight cycles)

Patch `projects/gitpulse/AGENT.md` worktree template (stamped at worktree init):

```
## Gitignored files — never `git add` without `-f`
fix_plan.md   — loop scratch, gitignored
AGENT.md      — loop scratch, gitignored
demo/         — gitignored output directory
forge/history/ — gitignored history cache
```

The brain documents the problem; the PM reads the brain; the dev-loop ralph sessions never read the brain (brainReads=0 across all WIs in this cycle). Fix must land in the template file, not the brain.

## Scope this cycle

WI-1 (sweeps: 1) + WI-2 (sweeps: 1) = 2 `ralph.uncommitted-work-swept` events. WI-3: 0 sweeps.

## Sources

- `_logs/2026-08-31T21-40-58_INIT-2026-08-31-init-tag-range-filter/events.jsonl` — `ralph.uncommitted-work-swept` WI-1 iter=1, WI-2 iter=1
- `/home/parso/forge-m3-a/brain/cycles/_raw/2026-08-31T21-40-58_INIT-2026-08-31-init-tag-range-filter.md`

## See also

- [[2026-08-31-gitignored-scratch-seventh-cycle]] — prior (seventh) cycle of this recurrence
- [[2026-08-31-tag-range-filter-delivery]] — the initiative this sweep occurred in
