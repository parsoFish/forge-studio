---
title: Unifier branch-divergence detection should gate-check before iteration work
description: Unifier ran 15 iterations ($12.7) before detecting branch-divergence invariant at final gate; running the sync check first would short-circuit immediately.
category: antipattern
created_at: 2026-07-03
updated_at: 2026-07-03
---

# Unifier branch-divergence detection should gate-check before iteration work

## Problem

When the unifier (UWI-1) started, `main` had diverged from `merge-base` because another initiative merged while this dev-loop was running. The invariant `main_head == merge-base` is a hard exit condition (`unifier.gate.branches-not-in-sync`). However, the gate check was evaluated **at the end** of the unifier's iteration loop. The unifier ran 15 full iterations, producing $12.7 of work, before hitting the gate and failing.

Event: `EV_mr48qxh7_tqbqdmtf` — `failure_class: dev-loop-unifier-branch-divergence` after 2018 seconds, 15 iterations.

## Impact

$12.7 wasted. Operator had to requeue with `resume_from: unifier`. Second unifier run (fresh dev-loop run, no divergence) completed in 4 iterations.

## Fix

Run the branch-sync sub-check as the **first gate** when the unifier starts, before any iteration work begins. If `main != merge-base`, emit `unifier.gate.branches-not-in-sync` immediately and fail fast — cost is 0 iterations.

This is true for any project — it's a forge orchestrator concern, not a betterado-specific concern.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-feed/events.jsonl` — `EV_mr48qxh7_tqbqdmtf` (branch-divergence error) + `EV_mr48qyet_1scj1y04` (unifier.failed, 15 iterations)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-feed.md`
