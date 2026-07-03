---
title: Unifier go-build gate catches dead SDKv2 helpers that per-WI gates miss
description: When framework-migration WIs leave shared SDKv2 helper functions with no remaining callers, `go build` fails at the unifier — not at the per-WI quality gate — because the build failure only emerges after ALL callers are removed. This forced a second full dev-loop run in the serviceendpoint cycle.
category: antipattern
created_at: 2026-07-03T22:00:00.000Z
updated_at: 2026-07-03T22:00:00.000Z
---

## Pattern observed

Cycle: `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-serviceendpoint` (terraform-provider-betterado).

Per-WI quality gates run against the package sub-scope after each WI completes. For a migration WI covering 3 endpoint types, the gate is e.g. `go test ./azuredevops/internal/service/serviceendpoint/...` — this succeeds even when dead helper functions remain, because the remaining callers (in other WIs not yet migrated) still reference them.

After run 1 completed all 10 WIs and the unifier ran `go build ./...`, two helpers were now unreferenced by any remaining code:

```
undefined: findServiceEndpointByName   (WI-X's callers all removed; helper not deleted)
undefined: validateScopeLevel          (same)
```

`golangci-lint` caught 3 more: `validateServiceEndpoint`, `dataSourceGenBaseSchema`, `dataSourceGetBaseServiceEndpoint`.

**Unifier gate.fail** → second dev-loop run of all 10 WIs.

## Why per-WI gates can't catch this

A shared helper remains referenced by callers in WIs not yet completed. Its removal only becomes a build error after the LAST caller WI runs. The per-WI gate scope is too narrow to see the whole-module dependency graph.

## The structural gap

The unifier's `go build` is the first whole-module build check in the pipeline. For migration initiatives with shared helpers, this is too late — it costs a full second dev-loop run.

## Mitigation options

1. **PM embeds explicit file-deletion ACs** — names the shared helpers to delete alongside each resource migration, so ralph deletes them when their callers are removed. (Requires PM to analyse caller graphs at decomposition time.)
2. **dev-loop close adds a whole-module build check** — after all WIs complete but before unifier, run `go build ./...` (or `golangci-lint run ./...` on the full package). If it fails, trigger a targeted fix WI before the unifier gate.
3. **Per-WI gate includes a dead-code lint sub-check** — `golangci-lint run --enable=unused ./azuredevops/internal/service/serviceendpoint/...` after each WI. This would catch helpers whose last caller in the WI scope was removed even before later WIs run.

Option 1 is most surgical. Option 2 is a forge-orchestrator change. Option 3 risks false positives on in-progress migrations.

## Frequency

This specific failure (shared helpers, build break) is new in this cycle — prior cycles had dead FILES that compiled silently. The accumulation of per-type dead files into a cross-file dead-helper build break is a severity escalation as the migrated surface grows.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-serviceendpoint/events.jsonl` — unifier gate.fail event, second dev-loop.baseline-green, second dev-loop.delivered events
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-serviceendpoint.md`
