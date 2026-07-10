---
title: Acceptance test hollow gate — SKIP exit-0 = gate pass (TF_ACC not required)
description: The acceptance test quality gate passes on SKIP (exit 0) without TF_ACC; agents re-derive this semantics each cycle instead of reading it from the profile.
category: antipattern
created_at: 2026-07-05
updated_at: 2026-07-05
---

## Pattern

The `betterado` acceptance gate for new framework resources runs:

```
go test -tags all -run TestAccXxx ./azuredevops/internal/acceptancetests/
```

without `TF_ACC` set. `resource.ParallelTest` internally calls `t.Skip(...)` when `TF_ACC` is empty (source: `terraform-plugin-testing` `os.Getenv(EnvTfAcc) == ""`), so the test exits 0 with `--- SKIP: TestAccXxx`. The quality gate reads exit code 0 as PASS.

This is the **hollow gate design**: the WI gate verifies the test *exists and compiles*, not that it runs live. The live run requires a pre-seeded pending approval in the standing demo org and is an operator-gated step, not a dev-loop gate.

## Why this matters

In the pipelinesapproval initiative (WI-6), the agent spent 5 log entries re-deriving this semantics:
- 22:57:09 — "ParallelTest automatically skips when TF_ACC not set"
- 22:57:20 — re-stated same conclusion with source reference
- 22:58:17 — "PreCheck runs immediately and fails when creds missing" (wrong path)
- 22:58:50 — "test is found and skips cleanly; gate passes"

The confusion arose because `PreCheck` runs before `resource.ParallelTest` and can fail loudly on missing env — the agent had to experimentally confirm that the hollow gate design placed the `resource.ParallelTest` call inside a function where `t.Skip` would fire before `PreCheck` in the no-TF_ACC path.

## Fix

Add to `profile.md` gotchas:

> **Hollow acceptance gate**: the per-WI gate for a new acceptance test runs the test WITHOUT `TF_ACC`. `resource.ParallelTest` skips (exit 0) when `TF_ACC` is absent — the gate passes on SKIP. `PreCheck` must NOT be called outside `resource.ParallelTest`/`resource.Test` or it will fail the gate. The pattern: wrap the entire `Steps` config inside `resource.ParallelTest(t, resource.TestCase{...})` — `PreCheck` is a field of `TestCase`, not a top-level call.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-new-api-pipelinesapproval/events.jsonl` — WI-6 dev-loop log entries at 22:57–22:58
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-new-api-pipelinesapproval.md`
