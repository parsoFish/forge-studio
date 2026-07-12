---
title: Rate-limit crash on WI-N cascades all dependent WIs to prerequisite-failed
description: >-
  WI-6 (environment_resource_kubernetes) crashed exit-1 mid-iteration due to a
  Claude rate-limit hit; the dev-loop marked it failed(0 iters, 0 files), which
  caused WI-7/8/9/10/11 to be skipped immediately via prerequisite-failed — a 6-WI
  cascade from a single rate-limit event. The gate had already passed for WI-6
  (acceptance test passed at 12:49:20); the failure was pure infrastructure, not code.
category: antipattern
keywords: [rate-limit, crash, prerequisite-failed, cascade, dev-loop, dependent-wi-skip, gate-already-passed]
related_themes: [cycle-recovery-index]
created_at: 2026-07-01T00:00:00.000Z
updated_at: 2026-07-01T00:00:00.000Z
---

## Pattern observed

Cycle: `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-taskagent` (terraform-provider-betterado, taskagent package migration).

**Sequence:**
1. `[2026-07-03T12:49:09]` WI-6 agent emits "You've hit your limit · resets 12:10am" and crashes (exit code 1).
2. `dev-loop.agent-crash-retry` fired twice (max_retries=2), both retries immediately hit the rate limit.
3. `ralph.end` for WI-6: `status=failed, iterations=0, stop_reason=crashed, files_changed=0`.
4. `[12:49:44]` WI-7 `ralph.skipped` reason=prerequisite-failed. WI-8, WI-9, WI-10, WI-11 all skipped in the same second.
5. Dev-loop outer end: `complete=5, failed=6` (WI-6 + 5 skips).

**Critical detail:** WI-6's acceptance gate HAD passed at `[2026-07-03T12:49:20]` (`gate_exit_code=0`, `TestAccEnvironmentResourceKubernetes` green). The WI-6 work was complete in the branch; the code was sound. The crash was pure rate-limit infrastructure. But `status=failed` triggered the skip cascade.

**Recovery:** Next dev-loop run re-ran all 11 WIs from scratch (the orchestrator restarted with `resumed=false`). WI-1 through WI-5 re-verified their gates in 1 iteration each (gate already-passing, fast). WI-6 re-ran and completed in 1 iteration. Total extra cost: ~4-6 extra WI sessions.

## Why this matters

A single rate-limit event at WI-N blocked 5 subsequent WIs. The cascade multiplied the failure impact by 6× with no code defect. The gate had already cleared — the delivery was real.

This is a forge-level issue (the orchestrator marks failed and skips dependents without checking whether the gate had passed before the crash), but the operational impact and recovery pattern are project-visible here.

## Recovery path observed

- Do not treat `status=failed, stop_reason=crashed` as equivalent to "code is broken."
- Check `dev-loop.delivered` files_changed + the gate pass event before the crash. If gate passed and files_changed > 0 committed, the WI is effectively complete; the crash was post-gate.
- The dev-loop re-run re-derived and re-verified all prior WIs; no special triage needed — just re-queue.

## Rule

When reviewing a dev-loop that ends `complete=N, failed=M` with a `crashed` WI in the middle of a serial depends-on chain, check:
1. Was the failed WI's gate already green at crash time?
2. Were the dependent WIs skipped only due to the `prerequisite-failed` cascade?

If both yes, the downstream WIs are blocked by a cascade, not a real code failure — re-run is the right action.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-taskagent/events.jsonl` — WI-6 crash at `EV_mr4wgsf8` (rate-limit), gate pass at `12:49:20`, prerequisite-failed skips at `12:49:44`
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-taskagent.md`
