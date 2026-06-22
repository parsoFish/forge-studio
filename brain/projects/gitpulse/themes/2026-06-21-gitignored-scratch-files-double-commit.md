---
title: Gitignored scratch files cause double-commit waste per WI
description: >-
  fix_plan.md and AGENT.md are gitignored loop artifacts; dev-loop agents
  attempt plain git add then fail, retry with git add -f, producing a redundant
  chore commit that adds nothing to the branch.
category: antipattern
keywords:
  - fix_plan
  - AGENT.md
  - gitignore
  - chore-commit
  - repeated-actions
created_at: 2026-06-21T00:00:00.000Z
updated_at: 2026-06-21T00:00:00.000Z
---

# Gitignored scratch files cause double-commit waste per WI

## Pattern observed

In the ownership-hotspots-top-flag initiative (4 WIs), the dev-loop agent
ended each WI by doing:

```
git add fix_plan.md AGENT.md && git commit -m "chore: update …"
```

`fix_plan.md` and `AGENT.md` are in `.gitignore`. The `git add` silently
stages nothing; `git commit` either produces an empty commit or fails with
"nothing to commit". The agent detected this and retried with `git add -f`.

This pattern happened 3 of 4 WIs (WI-2, WI-3, WI-4). Each double-attempt
wasted 2 git invocations + 1 failed or empty commit per WI.

## Root cause

The WI spec and/or `fix_plan.md` convention instructs agents to record progress
in `fix_plan.md` + `AGENT.md` at the end of each WI. The dev-loop SKILL.md does
not encode that these files are gitignored, so the agent discovers it through
failure.

## Fix

In the developer-ralph SKILL.md or the per-project AGENT.md, document:
> `fix_plan.md` and `AGENT.md` are `.gitignore`d loop-scratch files.
> Use `git add -f fix_plan.md AGENT.md` OR skip the chore commit entirely
> (these files are not part of the deliverable branch).

Alternatively, remove the "update AGENT.md + commit" step from WI completion
instructions — these files are already read at the start of each Ralph
invocation and do not need to be tracked by git.

## Sources

- `_logs/2026-06-21T04-52-20_INIT-2026-06-21-ownership-hotspots-top-flag/events.jsonl` — events at lines ~150-165 (WI-2), ~260-275 (WI-3), ~390-410 (WI-4) showing double `git add` + commit pattern.
- `/home/parso/forge/brain/cycles/_raw/2026-06-21T04-52-20_INIT-2026-06-21-ownership-hotspots-top-flag.md`
