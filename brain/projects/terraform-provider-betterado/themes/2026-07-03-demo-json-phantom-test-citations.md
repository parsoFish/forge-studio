---
title: WI-6 ralph invents test function names in demo.json — unifier catches via go build gate
description: When ralph writes demo.json checkpoints citing live-evidence test names, it invents plausible but non-existent function names; the unifier CI gate (`go build ./...` + citation check) is the catch, not the per-WI gate.
category: antipattern
created_at: 2026-07-03T00:00:00.000Z
updated_at: 2026-07-03T00:00:00.000Z
---

## What happened

WI-6 (docs regeneration + CHANGELOG + demo) completed in 1 iteration and marked itself complete. The operator send-back verdict (2026-07-03T10:14Z) notes:

> "7 phantom citations corrected, all cited test names now resolve to real functions"

The unifier CI gate (UWI-4) required:
1. `demo.json` contains `liveEvidence` with a non-empty `url`
2. No orphaned SDKv2 git files (`git ls-files azuredevops/internal/service/git | grep -vE 'framework|helper'`)
3. `go build ./...`

Gate failed iteration 1 of UWI-4; unifier spent ~10 min (55 tool calls, L4062–L4394) fixing the phantom citations and orphaned-file check before the gate cleared.

## Why this happens

Ralph generates demo.json `checkpoint.evidence.testName` fields by reasoning about what the test would be named, rather than reading the actual acceptance-test file. For a package with 15+ test functions, invented names like `TestAccGitRepository_WithDefaultBranch` (capitalisation difference) or `TestAccGitRepositories` (wrong suffix) pass a simple string plausibility check but fail `grep` / `go build` citation validation.

## Prevention

1. **Per-WI gate for WI-6 (docs/demo)** should include a citation validator: `grep -c "func ${TEST_NAME}" azuredevops/internal/acceptancetests/ -r` for each cited name in demo.json.
2. **ralph should read the acceptance test file** before writing `testName` fields into demo.json checkpoints — scan `*_test.go` for `func TestAcc<Name>` and use exact names.
3. Alternatively: the unifier gate already catches this; the cost is just UWI-4 fixing overhead (~$1–2, 55 tool calls). Acceptable if the per-WI gate is hard to add.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-git/events.jsonl` (L4063: UWI-4 gate.fail; L4394: final delivered)
- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-git/artifacts/verdict.json` ("7 phantom citations corrected")
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-git.md`
