---
title: One git-truth seam + pure aggregation
description: >-
  All git access goes through src/git.ts; analytics aggregation is pure and
  unit-tested, with read-back acceptance against a deterministic fixture repo.
category: pattern
keywords:
  - git-log
  - numstat
  - pure-aggregation
  - read-back
  - deterministic-fixture
  - zero-dependency
created_at: 2026-06-21T00:00:00.000Z
updated_at: 2026-06-21T00:00:00.000Z
---

# One git-truth seam + pure aggregation

gitpulse's analytics are only trustworthy if their numbers match what `git log`
actually reports. Two disciplines keep them honest:

1. **One git-truth seam.** Every history read goes through `src/git.ts`
   (`execFileSync('git', ['-C', repo, 'log', '--no-merges', '--numstat', …])`),
   which validates the repo (`git rev-parse`) and parses into immutable `Commit[]`.
   Binary files report `-` for insertions/deletions — count them as a touched file
   with 0 added/removed, never throw or drop the commit. No other module spawns git.

2. **Pure, unit-tested aggregation.** Everything in `src/stats.ts` (and successor
   analytics: churn, ownership, hotspots) takes `Commit[]` and returns immutable
   summaries with no I/O, so the unit gate (`npm test`) pins each rule against
   hand-built fixtures without spawning git.

The proof that the wired-up artifact is correct is the **read-back acceptance
gate** (`npm run acceptance`): it builds a deterministic temp git repo (fixed
`GIT_AUTHOR_DATE`, author names, sentinel files/commits), runs the BUILT CLI (or
dashboard) against it, and asserts the exact analytics — non-default sentinels so a
silent drop/miscount is caught (C9). Ranked output is sorted by metric descending,
ties broken by name ascending, so reports + demos are reproducible.

## Sources

- `projects/gitpulse/src/git.ts`, `src/stats.ts` — the seam + the pure core.
- `projects/gitpulse/test/acceptance/run.ts` — the deterministic read-back gate.
- `projects/gitpulse/.forge/skills/git-log-analysis/SKILL.md` — the encoded rules.
