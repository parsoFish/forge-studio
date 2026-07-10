---
title: Acceptance test compile-only gate — write and compile in dev-loop, run live at pre-merge
description: WI-5 acceptance test files compiled under go test without TF_ACC=1; gate validated compilation + registration in 3.9s without a live ADO call.
category: pattern
created_at: 2026-06-06T00:00:00.000Z
updated_at: 2026-06-06T00:00:00.000Z
---

## Pattern

For acceptance-test WIs in this provider, the dev-loop gate is a **compile-only** run:

```bash
go test -mod=vendor -tags all -count=1 -timeout 60s \
  -run TestAccDataReleaseDefinition \
  ./azuredevops/internal/service/release/
```

Without `TF_ACC=1` in the environment, the `testAccPreCheck(t)` helper calls `t.Skip("Acceptance tests skipped unless env var TF_ACC set")`. The test binary compiles, registers, and immediately skips — proving:

1. Acceptance test file compiles cleanly against the provider schema.
2. The test function name matches the `-run` pattern (gate rejects `[no tests to run]`).
3. No live ADO credentials or infra required.

WI-5 passed in **1 iteration at 3.9s gate time**.

The live ADO round-trip (`TF_ACC=1 go test ...`) is the **pre-merge acceptance gate**, not the dev-loop gate. Credentials live in gitignored `secrets.env`.

## When this applies

Any WI whose sole output is an acceptance test file (`*_test.go` with `TestAcc*` functions). Confirmed pattern for:
- `data_release_definition_acc_test.go` (this cycle)
- `data_release_definitions_acc_test.go` (this cycle)

## Sources

- `_logs/2026-06-06T04-41-44_INIT-2026-06-05-release-data-sources/events.jsonl` (WI-5 gate events: `gate.expected-fail` iter-0, `gate.pass` iter-1 at 3.9s)
- `/home/parso/forge/brain/cycles/_raw/2026-06-06T04-41-44_INIT-2026-06-05-release-data-sources.md`
