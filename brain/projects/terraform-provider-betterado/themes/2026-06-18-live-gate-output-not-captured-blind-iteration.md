---
title: Live gate output not captured in events — agent iterates blind on live test failures
description: When the WI live acceptance gate (TF_ACC=1) exits non-zero, no gate_output is written to events.jsonl; the agent cannot distinguish "compilation error" from "live ADO call failed" from "test assertion failed" and must re-run from scratch each iteration.
category: antipattern
created_at: 2026-07-10T10:30:00.000Z
updated_at: 2026-07-10T10:30:00.000Z
---

## Problem

WI-5 live acceptance gate (`go test -tags all -run TestAccReleaseDefinition_basic|...|... ./azuredevops/internal/acceptancetests/`) fired exit=1 six times. The `error` events in events.jsonl have `gate_exit_code: 1` but `gate_output` is absent. The agent's only signal: "gate failed". With no failure message, each iteration re-ran all offline gates (go build, go vet, gofmt, terrafmt), made a small speculative fix, and re-hit the live gate. 5 full iterations were consumed without resolving the live failure.

The unifier (UWI-1, 1 iteration) passed all ACs in its live verification — meaning the work was correct; the live test failures were transient or environment-related.

## Counts

- WI-5 gate.fail events: 6
- WI-5 iterations: 5 (exhausted budget)
- WI-5 Bash calls: 122
- Outcome: `status: failed` but all 13 ACs `verdict: met` (unifier verified)

## Consequence

Per the reflector's delivery rule: `dev-loop.delivered` diff-stat is authoritative; per-WI status is stale on iteration-budget exhaustion. The PR was opened and all live tests passed in the unifier. But the budget exhaustion forced the unifier to do live acceptance work that should have been WI-5's own gate.

## What would help

Capturing the first 500 chars of gate output as a structured field in the `error` event would let the agent distinguish:
- `FAIL: setup error: ...` (env/network) → wait / retry
- `FAIL: TestX --- FAIL: expected X got Y` (assertion) → fix HCL/code
- `./azuredevops/internal/acceptancetests/ [build failed]` → compile error → fix Go

Without this, every live gate failure looks identical. The agent re-derives the same offline checks repeatedly.

## Sources

- `_logs/2026-06-18T07-53-10_INIT-2026-06-17-release-definition-coverage-gaps/events.jsonl` (WI-5 gate.fail events at 08:22, 08:40, 08:43, 08:44, 08:46, 08:48)
- `/home/parso/forge/brain/cycles/_raw/2026-06-18T07-53-10_INIT-2026-06-17-release-definition-coverage-gaps.md`
