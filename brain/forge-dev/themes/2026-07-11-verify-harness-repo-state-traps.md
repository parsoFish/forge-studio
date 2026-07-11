---
title: "verify-cycle repo-state traps: frozen-SHA replay vs the live remote"
description: Frozen-SHA replay of an already-remote-merged feature is structurally unmergeable, and a --base-sha run leaves local main frozen so later greenfield runs conflict too; gates use greenfield ideas on a synced main.
category: reference
created_at: 2026-07-11
updated_at: 2026-07-11
---

# verify-cycle repo-state traps: frozen-SHA replay vs the live remote

- **Evidence**: Wave-1 gate runs R4/R5 (PRs parsoFish/gitpulse#5, #6 — both unmergeable)

## The two traps

1. **Frozen-SHA replay of an already-remote-merged feature cannot merge.**
   `--base-sha` resets the LOCAL repo only. Replaying a corpus feature whose
   original PR already merged means origin/main contains a different
   implementation of the same feature — the replayed PR conflicts on GitHub
   every time, structurally. The routine tier proves engine execution up to
   the merge; it can only assert an actual `gh pr merge` if the remote is
   reset too (not implemented — deliberate: the reference repo's history is
   worth more than the assertion).

2. **A `--base-sha` run leaves local main frozen; every later greenfield run
   inherits it.** R5 built a genuinely new feature but branched from the
   stale local main R4 left behind → conflict against current origin/main
   anyway. Fix landed: no-`--base-sha` runs now fetch + `--ff-only` sync main
   before starting (loud warning when they can't).

## Standing rules

- **Wave/release gates use the greenfield tier**: a small, verified-absent
  idea against a freshly-synced main (grep the project source for the feature
  FIRST — `--since/--until` was nearly used as "new" when it already shipped;
  the PM decomposing already-done scope is its own antipattern, see
  2026-07-04-pm-decomposes-already-complete-scope).
- Frozen-SHA replays are for engine-regression comparison runs where
  reaching ready-for-review + local-merge assertions suffice.
- After any replay run, restore the project checkout (`git checkout main &&
  git merge --ff-only origin/main`) — or rely on the next greenfield run's
  auto-sync, now that it exists.
- Debris hygiene: a failed gate run can leave open unmergeable PRs — close
  them with `gh pr close N --delete-branch` before the next run.
