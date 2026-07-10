---
title: Brain theme documenting gitignored-scratch git-add does not fix ralph SKILL.md
description: >-
  The fix_plan.md/AGENT.md gitignored-file commit pattern has recurred across
  3+ consecutive initiatives; a theme page exists in Brain 3 but ralph SKILL.md
  was never updated — theme-page knowledge does not propagate to the dev-loop prompt.
category: antipattern
keywords:
  - ralph
  - SKILL.md
  - fix_plan
  - AGENT.md
  - gitignore
  - brain-propagation
  - repeated-actions
created_at: 2026-07-10T11:08:20.000Z
updated_at: 2026-07-10T11:08:20.000Z
---

# Brain theme documenting gitignored-scratch commit does not fix ralph SKILL.md

## Pattern observed

In every ralph session of the gitpulse code-churn initiative (WI-1 through WI-4), the dev-loop agent ended by:

```
git add fix_plan.md AGENT.md
git commit -m "docs: update AGENT.md …"
```

Both files are in `.gitignore`. The commit either silently produces nothing or the agent self-corrects on failure. This consumed 2+ git invocations per WI (4 WIs = ~8 redundant calls).

**Recurrence count:** This same pattern was documented in theme `2026-06-21-gitignored-scratch-files-double-commit.md` (Brain 3, gitpulse, from the ownership-hotspots initiative immediately prior). It also appeared in `2026-06-21-gitignored-scratch-files-recurrence.md`. The theme pages exist. The fix was specified. But `ralph SKILL.md` was **never updated**.

## Root cause (structural)

Brain 3 theme pages describe project-level antipatterns. Ralph SKILL.md is the dev-loop's actual prompt — it lives in the forge repo, not the project brain. The dev-loop phase loads WI specs + AGENT.md + SKILL.md, **not** Brain 3 theme pages (brain-read policy: dev-loop MUST NOT read the brain). So a fix documented only in a theme page is invisible to the agent.

## Required fix path

To break the recurrence, the fix must land in one of:
1. **Ralph SKILL.md** — add a bullet: "`fix_plan.md` and `AGENT.md` are `.gitignore`d loop-scratch files; do NOT attempt to `git add` them at WI completion."
2. **Per-project AGENT.md** — add the same note to the AGENT.md written into each worktree. This is stamped per-initiative, so the fix propagates without changing the forge-global SKILL.md.

Option 1 is the structural fix (forge machinery); option 2 is a workaround.

## Implication

Brain theme pages cannot fix dev-loop behaviour. They can fix PM and architect behaviour (those phases read the brain). Dev-loop fixes require SKILL.md or AGENT.md edits.

## Sources

- `_logs/2026-06-21T02-08-23_INIT-2026-06-21-gitpulse-code-churn/events.jsonl` — `tool.Bash` events at end of WI-1, WI-2, WI-3, WI-4 showing `git add AGENT.md fix_plan.md`
- `/home/parso/forge/brain/cycles/_raw/2026-06-21T02-08-23_INIT-2026-06-21-gitpulse-code-churn.md`
- `brain/projects/gitpulse/themes/2026-06-21-gitignored-scratch-files-double-commit.md` — original theme from prior cycle (not actioned)
