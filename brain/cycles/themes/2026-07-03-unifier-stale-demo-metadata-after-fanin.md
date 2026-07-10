---
title: Unifier's demo.json metadata goes stale when fan-in merges bump the version between unifier invocations
description: First unifier wrote demo.json with version 1.2.1 and diffStat 84 files; by the final unifier 3 hours later, the real version was 1.9.1 and diffStat was 172 files — the second unifier had to re-check and correct both.
category: antipattern
created_at: 2026-07-03T00:00:00.000Z
updated_at: 2026-07-03T00:00:00.000Z
---

## Pattern observed

Cycle: `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-workitemtracking`.

**First unifier (UWI-1)** wrote `demo.json` with:
- `PROVIDER_VERSION = 1.2.1` (correct at time)
- `diffStat: 84 files changed, 5281 insertions(+)` (correct at time)

**Fan-in merges** to main during the cycle (other initiatives merged) bumped the main-branch version to 1.9.0; the initiative branch then showed a version bump from 1.9.0 → 1.9.1 and a diff of 172 files.

**Final unifier (UWI-5)** detected the stale values by re-running `git diff --stat main...HEAD` and `cat PROVIDER_VERSION.txt`, then corrected both fields. This consumed iteration 1 entirely — a full ~60-tool-call iteration for metadata correction rather than substantive work.

## Root cause

The unifier does not invalidate or re-validate a prior unifier's `demo.json` at startup. It finds existing `demo.json` content, reads it, trusts the values, and only discovers staleness mid-iteration when it runs git commands for other reasons.

## Fix direction

Unifier startup should always re-run `git diff --stat main...HEAD` and `cat PROVIDER_VERSION.txt` (or equivalent) and compare to values in `demo.json` before proceeding. If stale: update atomically before doing any other work, so iteration budget is not consumed by correction.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-workitemtracking/events.jsonl` (UWI-5 iteration 1 summary: "Stale version references … Corrected in all three files"; EV_mr514adc at line 16197)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-workitemtracking.md`
