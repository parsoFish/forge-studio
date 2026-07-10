---
title: Live acceptance gate output not surfaced in events — agent iterates blind on exit=1
description: gate.fail error events record gate_exit_code but no gate_output; when the gate is a live TF_ACC test, the agent cannot diagnose the failure class and re-runs the full offline check chain repeatedly (122 Bash calls / 5 iterations for one WI).
category: antipattern
created_at: 2026-07-10T10:30:00.000Z
updated_at: 2026-07-10T10:30:00.000Z
---

## Observed behaviour

WI-5 in the betterado coverage-gaps initiative: live acceptance gate (`go test -tags all -run TestAccReleaseDefinition_... ./azuredevops/internal/acceptancetests/`) exited 1 six times. Each `error` event in events.jsonl has:

```json
{
  "event_type": "error",
  "metadata": {
    "work_item_id": "WI-5",
    "gate_passed": false,
    "gate_exit_code": 1,
    "gate_command": "go test -tags all ...",
    "gate_output": null
  }
}
```

`gate_output` is absent/null. The agent had no way to distinguish:
- "go build failed" → fix compilation
- "TestAccX failed: expected Y got Z" → fix HCL or provider logic
- "setup error: network/env" → nothing to fix, retry later

Each of the 5 WI-5 iterations consumed 20–30 Bash calls re-verifying offline gates before hitting the live gate again.

## Impact

5 iterations × ~20-30 Bash calls = 122 total WI-5 Bash calls. Iteration budget exhausted. `status: failed`. Unifier had to perform live AC verification as recovery.

## Fix direction

Capture the first 1–2 KB of gate stdout+stderr as `gate_output` in the `error` event. The gate runner already sees this output — it just isn't written to the event. Even a 500-char capture would let the agent:
1. See "FAIL: error: could not find build definition" → env misconfiguration, skip retrying
2. See "--- FAIL: TestAccX: line 120: got 'null', want 'latest'" → assertion failure, fix the resource logic
3. See "[build failed]" → compilation, fix Go syntax

## Scope

This is a forge-machinery gap (the gate runner in `orchestrator/`), not project-specific. Applies to any project using live TF_ACC tests or any long-running acceptance gate.

## Sources

- `_logs/2026-06-18T07-53-10_INIT-2026-06-17-release-definition-coverage-gaps/events.jsonl` (WI-5 gate.fail × 6, events at 08:22–08:48)
- `/home/parso/forge/brain/cycles/_raw/2026-06-18T07-53-10_INIT-2026-06-17-release-definition-coverage-gaps.md`
