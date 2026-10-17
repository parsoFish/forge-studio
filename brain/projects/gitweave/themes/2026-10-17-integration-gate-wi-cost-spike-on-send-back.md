---
title: Integration-gate WI (all-tests-green) becomes a cost spike on send-back when new test files land
description: WI-10 ("python3 -m pytest tests/ passes") ran 5 times across 4 send-back dev-loop runs, peaking at 5 iterations / $7.82 when review-fix WIs had added ~150 new tests since the prior run.
category: antipattern
keywords: [wi-10, integration-gate, full-test-suite, send-back, cost-spike, pytest, already-complete, dev-loop, iteration-budget, review-fix]
created_at: 2026-10-17T00:32:15Z
updated_at: 2026-10-17T00:32:15Z
related_themes: [2026-10-17-review-fix-wis-signal-upfront-coverage-gaps, 2026-10-11-plan-engine-all-three-state-branches-required]
---

## What happened

WI-10's acceptance criterion: "Given the repository on main after I3b merges, when `python3 -m pytest tests/` runs, then zero test failures." It was the final WI in every dependency chain.

Across 5 dev-loop runs:

| Run | Date | Iterations | Cost |
|-----|------|-----------|------|
| 1 | 2026-10-14T13:25 | 3 | $1.17 |
| 2 | 2026-10-15T23:45 | 5 | $7.82 |
| 3 | 2026-10-16T07:59 | 1 | $0.26 |
| 4 | 2026-10-16T11:59 | 1 | $0.55 |
| 5 | 2026-10-16T13:43 | 1 | $0.30 |

Run 2 was expensive because WI-14 had just been implemented, adding ~150 new tests including 8 new test files. Every iteration ran the full 726-item `pytest tests/` suite. At 3–5 min per run, 5 iterations cost $7.82 and took ~2 hours.

## Why it spikes

The integration gate WI resets from scratch on each send-back, even though WI-1 through WI-9 are `already-complete`. When review-fix WIs add new test files, WI-10 must fix ALL new failures in a single contiguous session — it cannot carry intermediate progress across iterations on a hot cache.

## Rule

For a project with an integration WI that runs the full test suite:
- Structure review-fix WIs to declare `depends_on: [WI-10]` so WI-10 runs AFTER them, not before. (In I3b, WI-14/15/16 did depend on earlier WIs, and WI-10 re-ran at the end — but re-ran from a clean slate each time.)
- Limit the "all tests green" WI to post-gate cleanup only; other WIs should each carry their own per-file test run in their quality_gate_cmd.
- When the full test suite exceeds ~500 items, the integration WI becomes a multi-iteration liability; WI ACs should prefer targeted gates (`-k TestXyz` or a module) with WI-10 as a final smoke.

## See also

- [[2026-10-17-review-fix-wis-signal-upfront-coverage-gaps]] — why there were repeated send-back runs
- [[2026-10-11-plan-engine-all-three-state-branches-required]] — another integration-ordering lesson from this project

## Sources

- `_logs/2026-10-12T05-14-21_INIT-2026-10-11-i3b-self-service/events.jsonl` (WI-10 ralph.end events at 2026-10-14T13:25 iter=3, 2026-10-15T23:45 iter=5 cost=$7.8153, 2026-10-16 runs each iter=1)
- `brain/cycles/_raw/2026-10-12T05-14-21_INIT-2026-10-11-i3b-self-service.md`
