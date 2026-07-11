---
title: Gitignored scratch files — fourth consecutive cycle recurrence
description: ralph writes fix_plan.md and AGENT.md after every WI commit in the tags-command cycle — the 4th gitpulse cycle in a row with this pattern; SKILL.md and AGENT.md still not updated.
category: antipattern
created_at: 2026-07-11
updated_at: 2026-07-11
---

## Antipattern

After committing real work, ralph writes `fix_plan.md` and `AGENT.md` as scratch tracking files. These are gitignored in the gitpulse repo so the writes succeed, but the attempts to add them with `git add` fail silently and are then retried — burning ~2–4 extra Bash/Write calls per WI.

This occurred in WI-1 (events ~line 117–124) and WI-2 (events ~line 183–189, 249).

## Recurrence history

| Cycle | Theme page |
|---|---|
| ownership-hotspots (2026-06-21) | `2026-06-21-gitignored-scratch-files-double-commit.md` |
| json-output-flag (2026-06-21) | `2026-06-21-gitignored-scratch-files-recurrence.md` |
| compare-ref-analytics-delta (2026-06-22) | `2026-06-22-gitignored-scratch-file-third-cycle.md` |
| tags-command (2026-07-11) | this file |

**Four consecutive cycles. Fix has never been applied.**

## Fix

Add to `projects/gitpulse/AGENT.md` (or enforce in developer-ralph SKILL.md):

> `fix_plan.md`, `AGENT.md`, `demo/`, and `forge/history/` are gitignored in this repo. Do NOT attempt `git add fix_plan.md` or `git add AGENT.md`. Skip the chore commit for these files or use `git add -f` only if intentional.

## Sources

- `_logs/2026-07-11T16-18-59_INIT-2026-07-11-init-2026-07-12-tags-command/events.jsonl` (lines 117–124, 183–189, 249)
- `/home/parso/forge/brain/cycles/_raw/2026-07-11T16-18-59_INIT-2026-07-11-init-2026-07-12-tags-command.md`
