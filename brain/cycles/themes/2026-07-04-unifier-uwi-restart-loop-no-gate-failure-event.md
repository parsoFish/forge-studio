---
title: Unifier UWI restart loop — no gate-failure event between restarts
description: Unifier restarted 16× for a single UWI pair over ~80 min with no gate-failure event surfaced; each restart paid full session-init cost with no diagnostic signal to the orchestrator or operator.
category: antipattern
created_at: 2026-07-04
updated_at: 2026-07-04
---

# Unifier UWI restart loop — no gate-failure event between restarts

## What happened

In the policy/checks migration cycle, UWI-6/7 triggered 16 `unifier.start` events between 2026-07-03T12:49 and ~14:09 before finally clearing. Each restart took ~4–5 minutes. Between restarts, the `dev-loop.delivered` snapshot was re-emitted with identical stats (261 files, 18,217 insertions) — the branch content was not changing. The unifier exited without marking the UWI complete; the orchestrator retried immediately.

No `uwi.gate-failed` or `uwi.failed` event appeared between restarts. The operator had no diagnostic signal: was it a flaky live-acceptance test? a lint check? a race on the remote branch? The log shows only start→delivered→start→delivered… with no failure classification.

## Cost

~$8–16 in retry overhead ($0.5–1 per unifier session × 16 restarts). ~80 minutes wall-clock blocked.

## Root cause

Unifier exits with `status: complete` from its own perspective (it ran, gate did not pass, it stopped), but the orchestrator interprets a non-final-state UWI as "pending" and retries. No structured failure event is emitted to capture what gate condition was not met.

## Fix direction

1. Emit a `uwi.gate-failed` event (with gate name + output excerpt) whenever a unifier session ends with an unresolved UWI — makes the failure class visible in the event log and to the operator.
2. Cap restarts per UWI pair (e.g. ≤5) with an explicit `uwi.terminal` classification when the cap is hit, rather than spinning indefinitely.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-policy-branch/events.jsonl` — `unifier.start` events 2026-07-03T12:49–14:09 (16 occurrences for UWI-6/7)
- `/home/parso/forge/brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-policy-branch.md`
