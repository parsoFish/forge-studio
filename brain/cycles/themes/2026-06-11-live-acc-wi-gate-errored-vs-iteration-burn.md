---
title: live-acc WI requires_env guard miss — full iteration budget burned
description: When the `requires_env` guard fails to intercept a live-acc WI gate, ralph iterates to budget exhaustion against an unwinnable gate; cost multiplier is (iteration_budget × gate_run_cost) vs gate.errored at iter-0.
category: antipattern
created_at: 2026-06-11T00:00:00.000Z
updated_at: 2026-07-10T10:08:05.000Z
---

# live-acc WI requires_env guard miss — full iteration budget burned

## What happened

Run 2 of `INIT-2026-06-08-release-definition-artifact-trigger-enhancements` (2026-06-11T12):

- PM re-decomposed to 1 WI with gate: `go test -tags all -run TestAccReleaseDefinition_triggerEnhancements -count=1 ./azuredevops/internal/acceptancetests/`
- `TF_ACC` not set. Gate requires live ADO.
- The `requires_env` guard (in `orchestrator/phases/developer-loop.ts`, commit `94beb85`) reads `project.json`'s `acceptance_gate.match: "acceptancetests"`. The gate command path contains `acceptancetests` — guard should have fired gate.errored at iteration 0.
- Guard did NOT fire. Ralph ran 5 full iterations, each ending `gate.fail` exit code 1.
- `ralph.end`: status=failed, stop_reason=iteration-budget, cost_usd=1.67104585.
- Total waste: $1.67 vs $0.00 if gate.errored had fired at iter-0.

The analogous correct behaviour from run 1 (WI-3): guard fired gate.errored at iter-0, exit code -5, `live-env-missing`, $0 cost.

## Root cause hypothesis

Guard may have been conditional on a code path introduced after the PM re-decomposition produced a different WI shape (1 WI vs 3 WIs). Alternatively, the env detection logic silently passed when `AZDO_ORG_SERVICE_URL` or `AZDO_PERSONAL_ACCESS_TOKEN` were partially set but `TF_ACC` was not. Exact failure mode unconfirmed.

## Cost model

```
guard fires correctly:  0 iterations × $0 = $0 waste
guard misses:           N iterations × (gate_run_cost / iter) = N × cost waste
```

For this cycle: 5 × ~$0.33 ≈ $1.67 wasted.

## Signal

Any live-acc WI (gate command matching `acceptance_gate.match`) that runs more than 0 iterations without `TF_ACC` set is a guard miss. Check the `ralph.end` `stop_reason` field: `iteration-budget` on a live-acc WI = guard failed.

## Sources

- `_logs/2026-06-08T11-54-58_INIT-2026-06-08-release-definition-artifact-trigger-enhancements/events.jsonl` (L9009: gate.fail; L9010: ralph.end iterations=5 stop_reason=iteration-budget cost_usd=1.67)
- `brain/cycles/_raw/2026-06-08T11-54-58_INIT-2026-06-08-release-definition-artifact-trigger-enhancements.md`
