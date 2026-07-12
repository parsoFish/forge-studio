---
title: Acceptance test WI split — write-then-run pattern
description: When a live-acceptance WI runs without TF_ACC creds, split it into two WIs — write-WI (no creds) + run-WI (requires creds). This avoids gate-errored at iteration 0 before any code is produced.
category: pattern
keywords: [tf_acc, write-then-run, acceptance-test-split, live-acceptance, offline-gate, wi-decomposition]
related_themes: [gate-mechanics-index]
created_at: 2026-06-11T12:30:00Z
updated_at: 2026-06-11T12:30:00Z
---

# Acceptance test WI split — write-then-run pattern

## Problem

In `INIT-2026-06-08-release-definition-approval-options-gates-comple`, WI-2 had a gate of `go test -tags all -run TestAccReleaseDefinition_approvalsAndGates ./azuredevops/internal/acceptancetests/`. The gate errored immediately at iteration 0 (`gate_exit_code: -5`, `reject_reason: live-env-missing`) because `TF_ACC` was absent. Ralph ran 0 iterations. The unifier had to rescue by writing `TestAccReleaseDefinition_approvalsAndGates` (124 lines) as UWI-1 — work that ralph should have done.

## Root cause

A live-acceptance gate requires credentials to pass **at all** — even the "expected-fail → write code" iteration 0 flow needs the test to at least run. When credentials are absent, the gate returns exit code -5 before the agent can produce any work.

## Pattern

Split live-acceptance WIs into two:

| WI | Gate | Credentials needed |
|---|---|---|
| **Write-WI** | `go build ./azuredevops/internal/acceptancetests/...` (compile-only) | No |
| **Run-WI** | `go test -tags all -run TestAcc... ./azuredevops/internal/acceptancetests/` | Yes (TF_ACC + ADO creds) |

The write-WI succeeds even without creds (gates on compilation). The run-WI is deferred until creds are confirmed present.

## Operator-confirmed

User feedback: "Decomposition was fine; the failure mode was environment sequencing, not sizing... The fix is ensuring live-acceptance WIs only run when credentials are confirmed present."

## Contrast

The prior cycle (`release-data-sources-completion`) worked because its live-acc WI-2 had implementation already done in WI-1 — it only needed to *run* tests. When an agent must *write* AND *run* a live test in one WI, absent creds abort before any writing happens.

## Sources

- `_logs/2026-06-08T11-43-56_INIT-2026-06-08-release-definition-approval-options-gates-comple/events.jsonl` — WI-2 `gate.errored` event (`gate_exit_code: -5`, `reject_reason: live-env-missing`, `iteration: 0`)
- `_logs/2026-06-08T11-43-56_INIT-2026-06-08-release-definition-approval-options-gates-comple/user-feedback.md`
- `brain/cycles/_raw/2026-06-08T11-43-56_INIT-2026-06-08-release-definition-approval-options-gates-comple.md`
