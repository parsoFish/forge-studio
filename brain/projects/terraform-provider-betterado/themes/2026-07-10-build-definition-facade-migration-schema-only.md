---
title: Facade migration — schema present, expand/flatten not wired, invisible to all gates
description: build_definition framework migration passed all automated gates but expand/flatten was unwired; apply had zero API effect; caught only by operator review.
category: antipattern
created_at: 2026-07-10
updated_at: 2026-07-10
---

## Pattern

When migrating `betterado_build_definition` from SDKv2 to terraform-plugin-framework (PR #49), the new framework resource registered correctly, the schema declared all attributes, the unit test (`TestBuildDefinitionFramework_Schema`) passed, `make test` passed, golangci-lint was clean, GitHub CI was green. But `expandBuildDefinitionFw` was incomplete: fields were present in the schema but never wired into the API call arguments. `apply` succeeded with zero API effect — the resource appeared to create/update but no data was written.

**Invisible to all automated gates:** unit test only checks schema shape; ci_gate checks compile + unit test; acceptance test (live TF_ACC) was hollow (compile-only, no TF_ACC env). The defect required an operator to manually trace `expandBuildDefinitionFw` against the schema attribute list.

## Trigger conditions

- Large resource with many nested attributes (13 top-level attrs, nested `repository`, `variable`, `ci_trigger`, `pull_request_trigger`)
- WI scope says "schema declares all attrs + no error diagnostics" — passes without verifying expand/flatten
- Live acceptance gate is hollow (compile-only, no TF_ACC)

## Mitigation

Per-resource migration WI acceptance criteria MUST include:
- "expandXxxFw covers every schema attr that is Required or Optional"
- "ReadXxx populates every Computed/Optional attr from the API response"
- OR: live acceptance test with TF_ACC that reads back every attribute

A reviewer tracing expand/flatten is the fallback but the gate should fail first.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-build/events.jsonl` (WI-3 iteration, line ~532)
- `/home/parso/forge/brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-build.md` finding #6
- User feedback in retro: `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-build/retro.md` Q2
