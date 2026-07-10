---
title: ADO POST /processes ignores isEnabled=false — process always creates enabled
description: >-
  ADO REST API ignores isEnabled=false on process create — the process always
  comes back enabled. Framework resource must use Computed:true + post-create
  conditional update to pass CreateDisabled acceptance test without idempotency
  regression.
category: pattern
created_at: 2026-07-05T00:00:00.000Z
updated_at: 2026-07-05T00:00:00.000Z
---

## Pattern

`POST /processes` with `isEnabled: false` returns the process with `isEnabled: true`. The API silently ignores the enable/disable flag at create time. Update (`PATCH /processes/{id}`) correctly sets the flag.

**Framework resource solution:**
- Mark `is_enabled` as `Computed: true` in the schema.
- After the `Create` call, check if the desired `is_enabled` differs from the returned value.
- If so, immediately issue an Update call to set the correct value before returning the state.
- Without this, a `CreateDisabled` acceptance test step fails with `After applying this test step, the refresh plan was not empty` — the plan shows `~ is_enabled = true -> false`.

**Gate failure observed:**
```
--- FAIL: TestAccWorkitemtrackingprocessProcess_CreateDisabled (1.62s)
    resource_workitemtrackingprocess_process_test.go:55: Step 1/2 error: After applying this test step, the refresh plan was not empty.
    ~ is_enabled = true -> false
```

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-workitemtrackingprocess/events.jsonl` (gate.fail events at 2026-07-03T12:42, 12:48)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-workitemtrackingprocess.md`
