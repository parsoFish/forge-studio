---
title: PM inventing a nonexistent test name in quality_gate_cmd causes hard no-work failures
description: PM invented TestProvider_HasCorrectResources in quality_gate_cmd; forge no-work guard fired 5 times causing WI-2 to exhaust its iteration budget and the pipeline to dead-end.
category: antipattern
created_at: "2026-06-20"
updated_at: "2026-06-20"
---

## Pattern

When the PM writes a `quality_gate_cmd` with `-run <TestName>` where `<TestName>` does not exist in the repo, forge's gate-tightening guard fires with `[no tests to run]` on every iteration. The WI exhausts its iteration budget without making progress. Dependent WIs are skipped (`prerequisite-failed`). The pipeline dead-ends.

This cycle: PM wrote `quality_gate_cmd: ["go","test","-tags","all","-run","TestProvider_HasCorrectResources","./azuredevops/"]`. That test does not exist. No-work guard fired 5 times on WI-2. WI-3/WI-4 skipped. Initiative requeued.

## Fix

PM MUST grep the target file(s) for the actual test function name before writing any `-run <Test>` gate. For provider-level tests: `grep -n "^func Test" azuredevops/provider_test.go`. Use only names that actually exist, or names that the same WI explicitly creates.

The operator embedded recovery guidance in the manifest YAML (`previous_failure_modes`); that worked for the second PM. But the constraint should live in the brain so the PM never invents a name in the first place.

## Sources

- `_logs/2026-06-19T23-10-22_INIT-2026-06-19-framework-task-group/events.jsonl` — gate.fail events at lines 272, 426, 510, 557, 811 (WI-2, five iterations); event `EV_mqlkspkq_39wss16d` ralph.end status=failed stop_reason=iteration-budget.
- `/home/parso/forge/brain/cycles/_raw/2026-06-19T23-10-22_INIT-2026-06-19-framework-task-group.md`
