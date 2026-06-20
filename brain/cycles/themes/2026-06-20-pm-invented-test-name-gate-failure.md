---
title: PM inventing non-existent test names for quality_gate_cmd causes repeated no-work guard failures
description: The PM invented TestProvider_HasCorrectResources as the quality_gate_cmd for a provider-registration WI. The test does not exist; go test returned [no tests to run] every iteration; the no-work guard fired 5 times and exhausted the iteration budget.
category: antipattern
created_at: 2026-06-20T00:00:00.000Z
updated_at: 2026-06-20T00:00:00.000Z
---

## What happened

In cycle `2026-06-19T23-10-22_INIT-2026-06-19-framework-task-group` (project: terraform-provider-betterado), WI-2 was:

> Register `NewTaskGroupResource()` in `framework_provider.go`; remove SDKv2 registration.

The PM assigned:
```
quality_gate_cmd: go test -tags all -count=1 -run TestProvider_HasCorrectResources ./azuredevops/
```

`TestProvider_HasCorrectResources` does not exist. The real tests are `TestProvider_HasChildResources`, `TestProvider_HasChildDataSources`, `TestProvider_SchemaIsValid` in `azuredevops/provider_test.go`.

Gate result: `[no tests to run]` every iteration → forge's no-work guard rejected with exit code -2 → 5 iterations consumed → WI-2 `stop_reason: iteration-budget` → WI-3, WI-4, WI-5 skipped.

## Cost

~$8 dev-loop spend on 5 zero-progress iterations, plus a forced requeue of the initiative.

## Rule

**Before using a `-run <TestName>` in a `quality_gate_cmd`, the PM must verify the test exists.** Two options:
1. Use a test the WI creates (the gate will correctly fail before the WI does work, pass after).
2. Use an existing test by name — grep `azuredevops/provider_test.go` and similar for the real name.

Never guess a plausible-sounding test name.

## Operator recovery mechanism

When a `quality_gate_cmd` fires the no-work guard every iteration, the initiative will exhaust budget on WI-N and skip all downstream WIs. The fix is to requeue the initiative and embed corrected test names in the manifest's `operator recovery guidance` section (the operator did this for the second pass; second PM succeeded).

## Sources

- `_logs/2026-06-19T23-10-22_INIT-2026-06-19-framework-task-group/events.jsonl` (WI-2 gate.fail × 5: events at lines 267, 426, 557, 751, 884; WI-2 ralph.end stop_reason=iteration-budget at EV_mqlkspkq)
- `/home/parso/forge/brain/cycles/_raw/2026-06-19T23-10-22_INIT-2026-06-19-framework-task-group.md`
- `/home/parso/forge/_queue/done/INIT-2026-06-19-framework-task-group.md` (operator recovery guidance section)
