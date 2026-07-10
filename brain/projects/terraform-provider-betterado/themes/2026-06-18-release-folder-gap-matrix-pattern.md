---
title: release_folder gap matrix and sentinel test pattern
description: The release_folder resource gap matrix (docs/release-folder-gap-matrix.md) + TestReleaseFolderGapMatrixAudit sentinel establishes the same API-coverage discipline as release_definition. WI-1 produced the matrix in 1 iteration; WI-2 added the live acc test TestAccReleaseFolder in 1 iteration. Both used the expected-fail gate pattern correctly.
category: reference
created_at: 2026-07-10T10:39:32.000Z
updated_at: 2026-07-10T10:39:32.000Z
---

## What was delivered

**WI-1** (1 iteration, 2 files, +145 lines):
- `docs/release-folder-gap-matrix.md` — field-by-field matrix of ADO SDK `Folder` struct vs `betterado_release_folder` schema. Columns: field name, SDK type, schema status {mapped | partial | missing}, writable?, notes.
- `azuredevops/internal/service/release/doc_audit_test.go` — `TestReleaseFolderGapMatrixAudit` sentinel test asserting the matrix file exists and has expected section headers.

**WI-2** (1 iteration, 1 file, +116 lines):
- `azuredevops/internal/acceptancetests/resource_release_folder_test.go` — `TestAccReleaseFolder` acceptance test: create folder with non-default `description`, read back, idempotency check (`ExpectNonEmptyPlan: false`), destroy + `CheckDestroy` using `GetFolders`.

Quality gate pattern: per project convention, the per-WI gate runs the test file via `go test -tags all -run TestXxx ./pkg/` WITHOUT `TF_ACC`. The gate fires `gate.expected-fail` at iter 0 (test absent → `[no tests to run]`), then `gate.pass` at iter 1 after the file is written. The acceptance test itself skips cleanly (no TF_ACC → the `resource.ParallelTest` path skips internally).

## ADO Folder struct coverage

The `Folder` struct in `vendor/.../release/models.go` has ~8 fields. After WI-1 analysis, the matrix confirmed that the current `betterado_release_folder` schema covers all writable fields. No writable gaps were found requiring WI-2 implementation changes — the WI-2 scope shifted to the acceptance test only.

## Sources

- `_logs/2026-06-18T09-50-09_INIT-2026-06-17-release-folder-coverage/events.jsonl` — WI-1 gate.pass (09:56:43), WI-2 gate.pass (10:00:51), dev-loop.delivered WI-1 (2 files, +145) and WI-2 (1 file, +116)
- `brain/cycles/_raw/2026-06-18T09-50-09_INIT-2026-06-17-release-folder-coverage.md`
- `projects/terraform-provider-betterado/azuredevops/internal/service/release/doc_audit_test.go`
- `projects/terraform-provider-betterado/docs/release-folder-gap-matrix.md`
