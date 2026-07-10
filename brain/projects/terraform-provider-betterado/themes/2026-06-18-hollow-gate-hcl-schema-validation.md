---
title: Hollow acceptance gate still catches HCL schema errors — not purely compile-only
description: The betterado hollow gate (go test without TF_ACC) is not purely a compile check. resource.ParallelTest internally runs terraform plan, so Terraform schema validation fires. Incorrect block names in HCL fixtures cause plan-time failures even without live ADO credentials.
category: pattern
created_at: 2026-07-10T10:45:06.472Z
updated_at: 2026-07-10T10:45:06.472Z
---

## Observation

The hollow gate pattern (per profile.md gotcha): `go test -tags all -run TestAccX ./azuredevops/internal/acceptancetests/` without `TF_ACC`. When `TF_ACC` is absent, `resource.ParallelTest` skips the live ADO steps — BUT it still runs a `terraform plan` phase internally. This means:

- **Terraform schema validation is enforced** — wrong block names, missing required blocks, unsupported block types all fail even without credentials.
- **Not purely compile-only** — calling the gate "compile-only" or "exist-check" is misleading.

## Implication

If the HCL fixture in an acceptance test uses wrong block names (e.g. `environment {}` instead of `stages {}` for `betterado_release_definition`), the hollow gate exits non-zero with a Terraform diagnostic, not a Go compile error.

This is actually valuable — it catches fixture correctness before live runs. But it means the agent must fix the HCL fixture, not just ensure Go compilation succeeds.

## Dev-loop signal

When the hollow gate fails with `"Insufficient ... blocks"` or `"Blocks of type X are not expected here"`, the fix is in the HCL test template string, not in the Go source. Agents that respond by re-running `go build`/`go vet` are checking the wrong layer.

## Sources

- `_logs/2026-06-18T10-27-18_INIT-2026-06-17-release-definition-permissions-coverage/events.jsonl` — WI-3 gate.fail events lines 332, 355, 414, 437, 456; agent ran go-build/go-vet per iteration without fixing the HCL template
- `brain/cycles/_raw/2026-06-18T10-27-18_INIT-2026-06-17-release-definition-permissions-coverage.md`
