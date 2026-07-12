---
title: Gitignored scratch files — fifth consecutive cycle recurrence; fix still not applied
description: >-
  ralph writes fix_plan.md, AGENT.md, and forge/history/ after every WI in the
  cli-sort-flag cycle — 5th gitpulse cycle in a row; unifier also hit the
  gitignored forge/history/ dir. AGENT.md template has never been updated.
category: antipattern
keywords:
  - fix_plan
  - AGENT.md
  - gitignore
  - repeated-actions
  - scratch-files
related_themes: [2026-07-11-gitignored-scratch-fourth-cycle]
created_at: 2026-07-12T00:00:00.000Z
updated_at: 2026-07-12T00:00:00.000Z
---

# Gitignored scratch files — fifth consecutive cycle

## Pattern

Every WI in this initiative followed the same post-commit sequence:
1. Write `fix_plan.md` (2–3 writes per WI).
2. Write `AGENT.md`.
3. Unifier: `git add forge/history/…/demo.json` → silent fail → retry with `git add -f`.

Each WI burned 2–4 extra Write/Bash calls. Unifier burned 2 git-add calls.

## Recurrence table

| Cycle | Theme page |
|---|---|
| ownership-hotspots (2026-06-21) | `2026-06-21-gitignored-scratch-files-double-commit.md` |
| json-output-flag (2026-06-21) | `2026-06-21-gitignored-scratch-files-recurrence.md` |
| compare-ref-analytics-delta (2026-06-22) | `2026-06-22-gitignored-scratch-file-third-cycle.md` |
| tags-command (2026-07-11) | `2026-07-11-gitignored-scratch-fourth-cycle.md` |
| cli-sort-flag (2026-07-11) | **this file** |

**Five consecutive cycles. Fix has never been applied.**

## Required fix (overdue)

Add to `projects/gitpulse/AGENT.md` (worktree template):
```
## Gitignored files — never git add without -f
fix_plan.md, AGENT.md  — loop-scratch, gitignored
demo/                  — gitignored output directory
forge/history/         — gitignored history cache
```

The pattern of documenting this in the brain without propagating the fix to the AGENT.md template is itself a gap: Brain 3 theme pages are read by planners and reflectors, not by the dev-loop agent at execution time.

## Sources

- `_logs/2026-07-11T17-26-34_INIT-2026-07-11-cli-sort-flag/events.jsonl`
- `/home/parso/forge/brain/cycles/_raw/2026-07-11T17-26-34_INIT-2026-07-11-cli-sort-flag.md`

## See also

- [[2026-07-11-gitignored-scratch-fourth-cycle]] — the prior (fourth) cycle of this recurrence
