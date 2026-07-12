---
title: CaptureLiveEvidence errcheck lint — checked discard required
description: golangci-lint errcheck flags `_ = testutils.CaptureLiveEvidence(...)` even with explicit blank assignment. The correct pattern wraps the error or uses a lint-exemption comment. This is not caught by the per-WI hollow gate (no golangci-lint) and surfaces only at the CI gate.
category: antipattern
keywords: [errcheck, golangci-lint, captureliveevidence, blank-assignment, ci-gate, nolint]
related_themes: [gate-mechanics-index, live-evidence-demo-index]
created_at: 2026-07-10T10:45:06.472Z
updated_at: 2026-07-10T10:45:06.472Z
---

## Problem

The CI gate (`golangci-lint run ./...`) flags:

```
azuredevops/internal/acceptancetests/resource_release_definition_permissions_test.go:199:3:
  Error return value of `testutils.CaptureLiveEvidence` is not checked (errcheck)
    _ = testutils.CaptureLiveEvidence("acceptance-resource", url, nil)
```

`errcheck` by default flags even explicit `_ =` blank assignments of error returns. The per-WI quality gate (`go test -tags all -run TestAcc... ./azuredevops/internal/acceptancetests/`) does NOT run golangci-lint, so this pattern passes per-WI but fails at the cycle CI gate.

## Correct pattern

Either:

```go
// Option A: Check and log
if err := testutils.CaptureLiveEvidence("acceptance-resource-<type>", url, nil); err != nil {
    t.Logf("warn: CaptureLiveEvidence: %v", err)
}
```

Or:

```go
// Option B: nolint directive
_ = testutils.CaptureLiveEvidence("acceptance-resource", url, nil) //nolint:errcheck
```

Option A is preferred — aligns with project's error-handling style.

## Impact

This cycle: CI gate blocked, PR not opened. Unifier had already passed its quality gates (which also don't run golangci-lint). The lint failure is a catch at the last gate.

## Sources

- `_logs/2026-06-18T10-27-18_INIT-2026-06-17-release-definition-permissions-coverage/events.jsonl` — line 624 (ci-gate-failed message, errcheck on line 199 of permissions test)
- `brain/cycles/_raw/2026-06-18T10-27-18_INIT-2026-06-17-release-definition-permissions-coverage.md`
