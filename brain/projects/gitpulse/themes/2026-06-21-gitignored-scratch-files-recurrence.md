---
title: Gitignored scratch-file double-commit antipattern recurred after prior-cycle documentation
description: >-
  git add fix_plan.md AGENT.md failed silently then retried with -f in BOTH WIs of the
  json-output-flag initiative, despite the antipattern being documented after the prior cycle.
  The SKILL.md fix was never applied.
category: antipattern
keywords:
  - fix_plan
  - AGENT.md
  - gitignore
  - chore-commit
  - repeated-actions
  - skill-fix-not-applied
created_at: 2026-06-21T00:00:00.000Z
updated_at: 2026-06-21T00:00:00.000Z
---

# Gitignored scratch-file double-commit: recurrence

## Pattern

Two consecutive cycles (ownership-hotspots-top-flag, json-output-flag) both exhibited the same repeated action: `git add fix_plan.md AGENT.md` (no `-f`) → silent failure or "nothing to commit" → retry with `git add -f`. In the json-output-flag cycle:
- WI-1: `git add fix_plan.md AGENT.md` → retry `git add -f fix_plan.md AGENT.md`
- WI-2: `git add fix_plan.md AGENT.md` → retry `git add -f fix_plan.md AGENT.md`

The pattern was documented in `2026-06-21-gitignored-scratch-files-double-commit.md` after the prior cycle, but the recommended SKILL.md fix was not applied before this cycle ran.

## Additional discovery: demo/ also gitignored

WI-2 attempted `git add test/acceptance/run.ts demo/pulse-capture.md`. The `demo/` directory is gitignored. Commit was rejected; agent self-corrected and retried with only `test/acceptance/run.ts`. Two git invocations wasted; the data structure of gitignored directories is wider than just `fix_plan.md` + `AGENT.md`.

## Root cause

The developer-ralph SKILL.md and/or the project AGENT.md template does not encode which files/directories are gitignored. The agent must discover gitignore boundaries through failure at commit time.

## Required fix

In developer-ralph SKILL.md:
```
# Gitignored files — never git add without -f
fix_plan.md, AGENT.md  — loop-scratch, gitignored
demo/                  — gitignored output directory
```

OR in the per-project `AGENT.md` that the agent reads at Ralph start:
```
## Gitignored files
- fix_plan.md, AGENT.md — use git add -f or skip chore commit
- demo/ — gitignored; do not commit
```

## Sources

- `_logs/2026-06-21T08-01-50_INIT-2026-06-21-json-output-flag/events.jsonl` — `git add fix_plan.md AGENT.md` events at WI-1 and WI-2 (seq 29–31 WI-1, seq 16–19 WI-2); `git add … demo/pulse-capture.md` WI-2 seq 15
- `/home/parso/forge/brain/cycles/_raw/2026-06-21T08-01-50_INIT-2026-06-21-json-output-flag.md`
- Prior cycle: `_logs/2026-06-21T04-52-20_INIT-2026-06-21-ownership-hotspots-top-flag/events.jsonl`
