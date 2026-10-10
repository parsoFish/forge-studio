---
title: All WIs re-run on send-back even when already complete
description: Every send-back restarts the dev-loop from WI-1; already-complete WIs re-execute with 0 commits, burning iteration budget and session init cost.
category: antipattern
keywords: [send-back, dev-loop, wi-rerun, redundant, iteration, cost, zero-commit, review-loop, gate-fix]
created_at: 2026-10-10T08:47:25Z
updated_at: 2026-10-10T08:47:25Z
related_themes: [2026-10-10-adversarial-review-stale-findings-after-send-back]
---

# All WIs re-run on send-back even when already complete

## What happened

gitweave I1 had 4 dev-loop runs (3 send-backs). After each send-back, the orchestrator restarted the dev-loop from WI-1. Already-complete WIs (gate already green, branch diff already committed) re-ran, passed their gates immediately at iteration 0, and delivered 0 commits. The pattern:

- Dev-loop run 2: WI-1 through WI-5 each ran and produced 0 commits. Only WI-6 (new) produced work.
- Dev-loop run 3: WI-1 through WI-6 produced 0 commits. Only WI-7 (new) produced work.
- Dev-loop run 4: WI-1 through WI-7 produced 0 commits. Only WI-8 (new) produced work.

Total redundant WI sessions: ~18. Each session still pays session-init cost (~$0.05-0.10 per WI) plus the gate run. Total wasted overhead: estimated $1-2 of the $12.31 dev-loop total.

## Why it matters

The dev-loop runner does not skip WIs whose gate is already green and whose WI branch diff is non-empty from a prior run. This is a forge-machinery gap. On small initiatives (5-8 WIs) with shallow send-backs the waste is modest, but on large initiatives (10+ WIs, 3+ send-backs) it compounds.

## What would fix it

Before re-running a WI in a send-back cycle, the runner checks: (a) does the gate pass already, AND (b) does the WI branch diff contain commits? If both: skip this WI, log `wi.skipped-already-green`, move to the next. This is functionally equivalent to `make`'s up-to-date check.

## See also

- [[2026-10-10-adversarial-review-stale-findings-after-send-back]] — companion forge-machinery gap: review also re-runs unreliably across send-back rounds

## Sources

- `_logs/2026-10-10T01-55-59_INIT-2026-10-10-i1-honest-baseline/events.jsonl` (dev-loop.delivered events for WI-1 through WI-7 with files_changed=0 on runs 2-4)
- `brain/cycles/_raw/2026-10-10T01-55-59_INIT-2026-10-10-i1-honest-baseline.md`
