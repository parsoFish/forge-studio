---
title: Iteration-budget is the sole no-progress backstop after Tier 2 removal — fires cleanly, no false-positives
description: Cycle v3 confirmed that removing wedgedNoProgressIterations (Tier 2) leaves iteration-budget as the only no-progress stop. WI-5 and the unifier both hit iteration-budget cleanly with no "wedged" noise. The tradeoff is less-granular stoppage — budget-exhaustion is coarser than wedge-detection.
category: pattern
created_at: '2026-05-26'
updated_at: '2026-05-26'
---

# Iteration-budget as sole no-progress backstop

## Observation

Cycle v3 was explicitly designed to verify Tier 2 (removal of `wedgedNoProgressIterations`).
The event log contains zero instances of "wedged". Two agents hit `iteration-budget` as stop:

- **WI-5 ralph**: 5 iterations, stop=iteration-budget. All 5 iterations produced different
  bash command sequences (no two alike), so the wedge detector would not have fired anyway.
  The budget stop was correct and timely.
- **Unifier**: 15 iterations, stop=iteration-budget. Unifier produced different bash commands
  each iteration (diagnosis oscillation — see `2026-05-26-unifier-diagnosis-oscillation.md`).
  Again, wedge detector would not have fired.

## The tradeoff

The wedge detector fired on "same output, no progress" — a structural signal. Iteration-budget
fires on "N iterations elapsed" regardless of progress. This means:

- **Benefit**: no false-positives. Prior cycles had wedge false-fires from pattern-matching
  on innocuous repeated outputs. Tier 2 removal was correct.
- **Cost**: a genuinely wedged agent (same root cause, no progress possible) consumes its full
  budget before stopping. WI-5 consumed 5 iterations × 66 reads + 54 bash calls; the unifier
  consumed 15 iterations. If the wedge detector had fired after 3 identical-root-cause iterations,
  the waste would have been smaller.

## Implication for future wedge detection

A replacement wedge detector — if re-introduced — should trigger on **same failing test name
across N consecutive gate failures** rather than on "same output text". This is:
- Precise (same root cause, not same output format).
- Avoids false-positives from output verbosity variation.
- Would have correctly stopped WI-5 after iteration 2 (same "Could not find
  'tests/stats-golden.test.ts'" error) and the unifier after iteration 3 (same failing test set).

A threshold of N=3 consecutive identical gate-failure errors seems appropriate.

## Verification goal met

Tier 2 removal goal: "A clean cycle should never surface the term 'wedged' in events." ✓
Zero "wedged" events in 119 total events.

## Sources

- `_logs/2026-05-26T08-17-13_INIT-2026-05-26-claude-trail-verify-cascade-v3/events.jsonl` — WI-5 ralph.end(stop=iteration-budget), unifier.failed(stop=iteration-budget), zero wedge events
- `brain/_raw/cycles/2026-05-26T08-17-13_INIT-2026-05-26-claude-trail-verify-cascade-v3.md` — cycle archive
