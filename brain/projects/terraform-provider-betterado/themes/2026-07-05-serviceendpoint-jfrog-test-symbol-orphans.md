---
title: JFrog serviceendpoint test files reference undefined symbols after SDKv2 deletion
description: When the JFrog v2 serviceendpoint SDKv2 source was deleted, its unit test files still referenced helper variables and flatten functions by the old name; the package failed to build until Ralph added aliases.
category: antipattern
created_at: 2026-07-09T22:03:49.533Z
updated_at: 2026-07-09T22:03:49.533Z
---

## What happened

WI-1 in cycle `2026-07-01T08-39-27_INIT-2026-07-01-mux-free-cutover`. The per-WI quality gate ran:

```
go test -tags all -run TestServiceEndpointJFrog ./azuredevops/internal/service/serviceendpoint/
```

Expected-fail fired with a build failure (gate.expected-fail, line 62 in events.jsonl). Root cause: the test files for `betterado_serviceendpoint_jfrog_artifactory_v2`, `_distribution_v2`, `_platform_v2`, `_xray_v2` referenced:
- `artifactoryRandomServiceEndpointProjectIDpassword` (undefined — old SDKv2 helper variable name without V2 suffix)
- `artifactoryRandomServiceEndpointProjectID` (same)
- `flattenServiceEndpointArtifactory` (undefined — old name; current code had `flattenServiceEndpointArtifactoryV2`)

These symbols lived in the SDKv2 source that prior migrations deleted. The test files were not updated when the helpers were renamed/deleted. Ralph added aliases to fix the build.

## Pattern

This is a variant of the recurring "SDKv2 dead files" antipattern (see `2026-07-03-sdkv2-dead-files-serviceendpoint-7th-cycle-second-devloop-run`), but in the test files rather than the source files. When renaming or deleting SDKv2 helper functions, ALL test files that reference those symbols must be updated in the same WI.

## Fix

WI ACs for migration work should include: "run `go build -tags all ./azuredevops/internal/service/<package>/` — zero errors" AND "run `go test -tags all ./azuredevops/internal/service/<package>/` — zero build failures". The `gate.expected-fail` mechanism correctly caught this before the agent committed bad code; the fix was in-iteration.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-mux-free-cutover/events.jsonl` — line 62: `gate.expected-fail` with full stderr listing undefined symbols
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-mux-free-cutover.md`
