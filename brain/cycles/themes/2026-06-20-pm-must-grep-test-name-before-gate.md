---
title: PM must grep for real test function name before writing a -run gate
description: PM invented a plausible but nonexistent test name in quality_gate_cmd; forge no-work guard fired 5 times; pipeline dead-ended. Operator confirmed this should be a hard brain constraint, not just manifest guidance.
category: antipattern
created_at: "2026-06-20"
updated_at: "2026-06-20"
---

## Pattern

The PM skill invents a plausible-sounding test name for `quality_gate_cmd` without verifying it exists. Forge's gate-tightening guard treats `[no tests to run]` as a hard rejection (exit code -2, reason `no-work-indicator`). The WI exhausts its iteration budget on no-ops. All dependent WIs are skipped.

This is a forge-machinery lesson (not project-specific): the guard fires the same way on any project.

**Evidence:** `INIT-2026-06-19-framework-task-group` — PM wrote `TestProvider_HasCorrectResources`; 5 gate failures on WI-2; forced requeue. Operator confirmed in feedback: "Yes — add a PM discipline rule: gate test names must be verified to exist in the repo before use."

## Constraint

Before writing any `quality_gate_cmd` with `-run <TestName>`, the PM MUST:

1. `grep -rn "^func <TestName>" <package>/` — confirm the function exists.
2. If the WI creates a new test, the gate `-run` value must match exactly the new test function name declared in the WI spec.
3. NEVER use a name that is neither present in the repo nor explicitly created by the same WI.

The no-work guard is intentional and will not be softened — the PM is the correct fix point.

## Sources

- `_logs/2026-06-19T23-10-22_INIT-2026-06-19-framework-task-group/events.jsonl` — gate.fail events at lines 272, 426, 510, 557, 811; `_queue/done/INIT-2026-06-19-framework-task-group.md` operator recovery guidance section.
- `/home/parso/forge/brain/cycles/_raw/2026-06-19T23-10-22_INIT-2026-06-19-framework-task-group.md`
