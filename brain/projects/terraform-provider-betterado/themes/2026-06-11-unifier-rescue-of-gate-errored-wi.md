---
title: Unifier rescue of gate-errored WI — authors missing implementation
description: When ralph exits with gate-errored (0 iterations, no code), the unifier detects the missing implementation and authors it as UWI-1 recovery — preventing an empty acceptance test slot on the branch.
category: pattern
keywords: [unifier, gate-errored, tf-acc, missing-implementation, acceptance-test-authoring, recovery, uwi]
related_themes: [cycle-recovery-index]
created_at: 2026-06-11T12:30:00Z
updated_at: 2026-06-11T12:30:00Z
---

# Unifier rescue of gate-errored WI

## Pattern

In `INIT-2026-06-08-release-definition-approval-options-gates-comple`, ralph exited WI-2 with `status: failed, stop_reason: gate-errored` (0 iterations — `TF_ACC` absent). The acceptance test function `TestAccReleaseDefinition_approvalsAndGates` was never written.

The first unifier invocation (UWI-1) detected the absence and authored:
- `TestAccReleaseDefinition_approvalsAndGates` (124 lines) in `resource_release_definition_test.go` under `acceptancetests/`
- `hclReleaseDefinitionApprovalsAndGates` HCL fixture
- Verified `go build ./azuredevops/internal/acceptancetests/...` clean before committing

Cost: $1.15. Without this rescue, the branch would have contained zero acceptance test coverage for approvals and gates.

## Why it works

The unifier has read access to the branch diff and work-item specs. It can detect "WI-N spec says write TestAcc… but function is absent from diff" and write it. It is not gated on live credentials — it only needs `go build` to confirm the function compiles.

## Caveat: live verification still deferred

The unifier authored the test but could not *run* it without `TF_ACC`. Live ADO verification remained deferred. The second unifier run (UWI-2) attempted to verify live but wedged before completing.

## Contrast

This rescue pattern only works when the gap is "function is missing entirely". If ralph had partially written a broken implementation, the unifier would need to detect and fix it — which is a more fragile rescue path.

## Sources

- `_logs/2026-06-08T11-43-56_INIT-2026-06-08-release-definition-approval-options-gates-comple/events.jsonl` — L84 `unifier.start`, L225 `unifier.branch-pushed`, L226 `unifier.end` (`status: complete, cost_usd: 1.15`)
- `brain/cycles/_raw/2026-06-08T11-43-56_INIT-2026-06-08-release-definition-approval-options-gates-comple.md`
