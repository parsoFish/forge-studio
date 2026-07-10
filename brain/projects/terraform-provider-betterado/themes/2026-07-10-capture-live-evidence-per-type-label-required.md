---
title: CaptureLiveEvidence must use per-type label — shared label fails unifier gate
description: Dev-loop used the shared label "acceptance-resource" for CaptureLiveEvidence in TestAccTestPlan; review-gate-r2.sh asserts per-type labels — gate failed with "missing per-type capture endpoint"; unifier fixed in iteration 2 with 112 tool calls.
category: antipattern
created_at: 2026-07-10T12:31:01.000Z
updated_at: 2026-07-10T12:31:01.000Z
---

## What happened

INIT-2026-07-01-new-api-test, WI-6 (live-acc) + UWI-2:

Dev-loop wrote `TestAccTestPlan_basic` calling `CaptureLiveEvidence("acceptance-resource", ...)` — the generic shared label used in prior initiatives. After the dev-loop completed, UWI-2 gate (`bash .forge/review-gate-r2.sh`) failed immediately:

```
AssertionError: missing per-type capture endpoint
```

Gate stderr showed the evidence JSON was present at `.forge/live-evidence/acceptance-resource.json` but the gate requires a **per-type** file (e.g. `acceptance-resource-test-plan.json`).

The unifier fixed it in iteration 2 by modifying `resource_test_plan_test.go` (changed the label), re-running the live test, and updating `demo.json` (6 successive edits). Total: 112 tool calls, ~20 min.

## Root cause

The PM's WI-6 AC specified `CaptureLiveEvidence("acceptance-resource", ...)` verbatim — the generic label from profile.md — without specifying the per-type form. The review gate enforces per-type labels but the WI spec didn't propagate that constraint.

## Fix

WI spec for any live-acc WI must explicitly state the per-type label format:

```
CaptureLiveEvidence("acceptance-resource-<type-slug>", <url>, apiResponse)
```

e.g. `"acceptance-resource-test-plan"`, `"acceptance-resource-test-suite"`.

The PM should embed this requirement verbatim in the live-acc WI's acceptance criteria.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-new-api-test/events.jsonl` — `gate.expected-fail` event UWI-2 at 2026-07-03T22:59:47
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-new-api-test.md`
