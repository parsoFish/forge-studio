---
title: Live-acc WI gate-errors before ralph runs when TF_ACC absent
description: A live-acceptance WI whose quality_gate_cmd requires TF_ACC will gate-error (exit -5, live-env-missing) at iteration 0 if secrets.env is not exported — ralph runs 0 iterations and produces no work.
category: antipattern
created_at: 2026-06-11T12:30:00Z
updated_at: 2026-06-11T12:30:00Z
---

# Live-acc WI gate-errors before ralph runs when TF_ACC absent

## What happens

Gate runs before ralph starts iteration 0 to establish expected-fail baseline. If `TF_ACC` is absent, `go test -tags all -run TestAcc...` exits with `-5` (`live-env-missing`). The orchestrator records `gate.errored` and exits ralph with `status: failed, stop_reason: gate-errored`. Ralph ran **0 iterations** and produced **no output**.

## Evidence

- `INIT-2026-06-08-release-definition-approval-options-gates-comple` WI-2: `gate_exit_code: -5`, `reject_reason: live-env-missing`, `iteration: 0`. `ralph.end` with `cost_usd: 0.00`.
- The unifier (UWI-1) had to rescue by authoring `TestAccReleaseDefinition_approvalsAndGates` (124 lines) — work ralph should have done.

## This is a project-level antipattern

The same pattern recurred in `release-data-sources-completion`. Operator confirmed: "a live-acceptance WI in an env without exported `secrets.env` gate-errors before the agent can produce any work, regardless of how the WI boundary is drawn."

## Signal to watch

If a WI's `quality_gate_cmd` contains `TF_ACC` or `go test -run TestAcc` and the cycle env does not have `TF_ACC=1` + `AZDO_ORG_SERVICE_URL` + `AZDO_PERSONAL_ACCESS_TOKEN`, expect `gate.errored` at iteration 0.

## Fix

Either: (a) export `secrets.env` before starting the cycle, or (b) decompose into write-WI (compile gate) + run-WI (live gate). See `2026-06-11-acceptance-test-wi-split-write-then-run.md`.

## Sources

- `_logs/2026-06-08T11-43-56_INIT-2026-06-08-release-definition-approval-options-gates-comple/events.jsonl` — L80 `gate.errored` (`gate_exit_code: -5`, WI-2 iteration 0), L81 `ralph.end` (`status: failed`, `cost_usd: 0`)
- `_logs/2026-06-08T11-43-56_INIT-2026-06-08-release-definition-approval-options-gates-comple/user-feedback.md`
- `brain/cycles/_raw/2026-06-08T11-43-56_INIT-2026-06-08-release-definition-approval-options-gates-comple.md`
