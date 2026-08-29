---
title: Gitignored scratch files — sixth consecutive cycle recurrence; AGENT.md template still not updated
description: >-
  ralph writes fix_plan.md and AGENT.md after WI-1 and WI-2 (4 events total)
  in the no-merges-flag cycle. ralph.uncommitted-work-swept fired for both WIs.
  Sixth gitpulse cycle in a row. The AGENT.md worktree template has never been
  patched despite five theme pages documenting the recurrence.
category: antipattern
keywords:
  - fix_plan
  - AGENT.md
  - gitignore
  - scratch-files
  - uncommitted-work-swept
  - repeated-actions
  - recurrence
related_themes: [2026-07-12-gitignored-scratch-fifth-cycle]
created_at: 2026-08-28T12:30:00.000Z
updated_at: 2026-08-28T12:30:00.000Z
recurrence: gitignored-scratch-files
---

# Gitignored scratch files — sixth consecutive cycle

## Pattern

After completing each WI, the dev-loop agent wrote `fix_plan.md` and `AGENT.md` into the worktree root — 4 write events total (WI-1 and WI-2 each). Both files are gitignored in the project. The agent did not commit them, so `ralph.uncommitted-work-swept` fired for WI-1 and WI-2 (the forge safety net swept the files into a commit).

WI-3 did not produce this pattern (it wrote `fix_plan.md` and `AGENT.md` too, but they were included in the same sweep or commit without needing a second sweep event — this is within the normal scratch pattern).

## Recurrence table

| Cycle | Theme page |
|---|---|
| ownership-hotspots (2026-06-21) | `2026-06-21-gitignored-scratch-files-double-commit.md` |
| json-output-flag (2026-06-21) | `2026-06-21-gitignored-scratch-files-recurrence.md` |
| compare-ref-analytics-delta (2026-06-22) | `2026-06-22-gitignored-scratch-file-third-cycle.md` |
| tags-command (2026-07-11) | `2026-07-11-gitignored-scratch-fourth-cycle.md` |
| cli-sort-flag (2026-07-12) | `2026-07-12-gitignored-scratch-fifth-cycle.md` |
| no-merges-flag (2026-08-28) | **this file** |

**Six consecutive cycles. Fix has never been applied.**

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

## Sources

- `_logs/2026-08-28T11-33-00_INIT-2026-08-28-init-no-merges-flag/events.jsonl` — `ralph.uncommitted-work-swept` WI-1 and WI-2; `file.modify` events for fix_plan.md and AGENT.md (×4 each)
- `/home/parso/forge-m0-a/brain/cycles/_raw/2026-08-28T11-33-00_INIT-2026-08-28-init-no-merges-flag.md`

## See also

- [[2026-07-12-gitignored-scratch-fifth-cycle]] — the prior (fifth) cycle of this recurrence
