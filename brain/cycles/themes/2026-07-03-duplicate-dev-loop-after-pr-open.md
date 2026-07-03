---
title: Duplicate dev-loop run triggered after PR already open
description: A second full dev-loop pass ran after PR #59 was opened; re-executed all 4 WIs and produced zero new commits on 3 of them; wasted ~18 min + tokens with no value.
category: antipattern
created_at: 2026-07-03
updated_at: 2026-07-03
---

## What happened

In the wiki-migration cycle, the dev-loop + unifier completed at 2026-07-03T09:14. PR #59 was opened at 2026-07-03T10:49. At 2026-07-03T10:31 — 18 minutes before the PR opened but after the first dev-loop completed — a **second dev-loop session** was started (a new `developer-loop.start` event, separate from the first).

The second pass re-executed WI-1 (1 iter, 68-line commit to add a re-check test), WI-2 (1 iter, **0 commits, 0/0/0 diff**), WI-3 (1 iter), and WI-4 (1 iter). A second unifier ran with `pending_uwis: []` (already complete) and exited in 0 iterations.

The final `dev-loop.delivered` diff showed 61 files / 1987 ins / 841 del (cumulative), up from 20 files / 1681 ins at the first unifier exit — the second pass re-ran the unifier totals.

## Why it's a forge issue

The orchestrator or a manual resume triggered a new dev-loop session on an initiative that had already completed all WIs and was mid-flight toward PR open. The second dev-loop had no pending work and the WI gates all passed at iteration 0 or 1 on cached results. No new value was added, but ~$0 of cost was accumulated and 18 minutes were spent.

## Fix direction

Guard condition: if all WIs are in `complete` state AND a PR URL exists in the event log for this initiative, do NOT start a new dev-loop session. The unifier should also not re-execute if its gates already pass (already implemented as `pending_uwis: []` → 0-iteration exit).

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-wiki/events.jsonl` — second dev-loop start at 2026-07-03T10:31 (EV_mr4smpnv); zero-delta WI-2 dev-loop.delivered at 2026-07-03T10:39 (EV_mr4swti0)
- `/home/parso/forge/brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-wiki.md`
