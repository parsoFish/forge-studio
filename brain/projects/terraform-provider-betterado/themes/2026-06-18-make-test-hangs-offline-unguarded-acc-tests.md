---
title: make test hangs offline — unguarded acceptance tests make live ADO connections
description: The GNUmakefile `test` target runs `go test -v ./...`, which includes acceptancetests/. At least two upstream tests lack a TF_ACC build-tag guard and attempt live ADO calls offline, causing multi-minute hangs. Use package-scoped commands for offline CI verification.
category: antipattern
keywords: [make-test, tf_acc-guard, offline-ci, acceptance-tests, gnumakefile, hang]
related_themes: [build-tooling-index]
created_at: 2026-07-10T10:39:32.000Z
updated_at: 2026-07-10T10:39:32.000Z
---

## Problem

`make test` expands to `go test -v ./...` (see `GNUmakefile` `test:` target). This includes the `acceptancetests` package. Two pre-existing tests:

- `TestAccGroupsDataSource_ProjectID_FiltersOutCollectionGroups` (in `data_groups_test.go`)
- `TestAccGroupDataSource_ReadersResolvesWithProjectID` (same file)

do NOT guard on `TF_ACC` via a build tag or early `t.Skip`. They call `PreCheck` and initiate real Terraform + ADO connections even when `TF_ACC` is unset. Without `AZDO_ORG_SERVICE_URL` / `AZDO_PERSONAL_ACCESS_TOKEN`, the connections hang or panic-timeout.

## Impact on dev-loop

WI-3 (INIT-2026-06-17-release-folder-coverage) launched `make test` as part of CI-equivalent verification. The command hung for ~7 minutes. Ralph spent ~17 min (44 bash calls, 15 test runs) investigating: probing the temp output file, reading the Makefile, re-reading the test source, verifying the test existed on `main`, before concluding it was pre-existing and switching to package-scoped `go test -tags all -count=1 ./azuredevops/internal/service/release/...`.

The WI-3 quality gate (package-scoped) had already passed at iter 0; the `make test` investigation was extra work within iter 1 that consumed ~17 minutes unnecessarily.

## Fix

**Preferred:** Add to profile.md gotchas:
> `make test` (`go test -v ./...`) hangs offline without TF_ACC due to `data_groups_test.go` tests that don't guard on TF_ACC. For offline CI verification, run package-scoped commands: `go test -tags all -count=1 ./azuredevops/internal/service/<pkg>/...` instead.

**Structural:** Those tests should add `if os.Getenv("TF_ACC") == "" { t.Skip("acceptance test") }` before the PreCheck call — but that is upstream code (microsoft/terraform-provider-azuredevops fork) and may be undesirable to patch.

## Sources

- `_logs/2026-06-18T09-50-09_INIT-2026-06-17-release-folder-coverage/events.jsonl` — WI-3 bash calls seq 6–51 (10:01:11–10:17:32), reasoning events 10:03:22–10:16:44
- `brain/cycles/_raw/2026-06-18T09-50-09_INIT-2026-06-17-release-folder-coverage.md`
