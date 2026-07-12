---
title: terrafmt-check only covers azuredevops/ test files, not examples/ or docs/
description: make terrafmt-check targets ./azuredevops/**/*_test.go only; HCL in examples/resources/ and docs/resources/ is not validated by CI or the per-WI quality gate.
category: antipattern
keywords: [terrafmt-check, makefile, examples-dir, docs-dir, hcl-formatting, ci-gate-gap]
related_themes: [build-tooling-index]
created_at: 2026-06-18
updated_at: 2026-06-18
---

## Problem

`make terrafmt-check` (used in both per-WI offline gates and the delivery CI gate) validates HCL formatting only inside `./azuredevops` test files. The `examples/resources/<resource>/resource.tf` and `docs/resources/<resource>.md` files — which WI-3 adds/modifies — are NOT checked.

WI-3 (task-group-coverage, 2026-06-18) added `examples/resources/betterado_task_group/resource.tf`. Ralph ran `make terrafmt-check` and found exit-0, then noted: _"The `terrafmt-check` script only checks `./azuredevops` test files, not `examples/` or `docs/`."_ That HCL is therefore unvalidated by CI.

## Impact

Malformed HCL in `examples/` or `docs/` can land on `main` without any CI signal. Users running `terraform fmt` against the examples would see diff; `make docs` regeneration could fail silently.

## Fix direction

Extend `Makefile` `terrafmt-check` target (or add a companion check) to run `terrafmt fmt -check ./examples/...` and `terrafmt fmt -check ./docs/...`. This is a low-cost addition — the files are small and the tool is already present.

## Sources

- `_logs/2026-06-18T09-23-23_INIT-2026-06-17-task-group-coverage/events.jsonl` (WI-3 area L342: ralph discovers the terrafmt scope gap)
- `brain/cycles/_raw/2026-06-18T09-23-23_INIT-2026-06-17-task-group-coverage.md`
