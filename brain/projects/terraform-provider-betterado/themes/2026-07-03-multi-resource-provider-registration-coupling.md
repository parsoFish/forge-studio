---
title: Multi-resource framework migration — provider registration files always couple WIs
description: When migrating 2+ resources in one initiative, any decomposition that puts each resource's migration in a separate WI will always fail the hidden-coupling check because all WIs must edit provider.go and framework_provider.go for deregistration/registration. Batch registration edits into one shared WI.
category: antipattern
created_at: 2026-07-03T00:00:00.000Z
updated_at: 2026-07-03T00:00:00.000Z
---

## Pattern observed

Cycle: `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-servicehook` (terraform-provider-betterado, servicehook framework migration).

PM run 1 emitted 4 WIs (gap-matrix WI-1, migrate-webhook WI-2, migrate-storage-queue WI-3, docs WI-4). The hidden-coupling checker fired on 3 pairs:
- WI-1 ↔ WI-3: shared `azuredevops/internal/service/servicehook/pipelines_publisher.go`
- WI-1 ↔ WI-2: shared `azuredevops/internal/service/servicehook/tfs_publisher.go`
- WI-2 ↔ WI-3: shared `azuredevops/internal/provider/framework_provider.go`, `azuredevops/provider.go`, `azuredevops/provider_test.go`

Cost: $1.70 wasted.

## Why this is structural

Framework migration checklist clause 1 requires deregistering each resource from SDKv2 ResourcesMap in the **same WI** that adds it to the framework provider. This means every per-resource WI MUST touch `provider.go` and `framework_provider.go`. When there are 2+ resources, ANY decomposition that keeps them in separate WIs will share these files.

PM run 3 (which succeeded) resolved this by:
1. Keeping the gap-matrix WI separate (no provider files touched).
2. Making WI-2 (storage-queue framework impl) and WI-3 (webhook-tfs framework impl) each scope their own resource file + the shared provider files explicitly.
3. Sequencing WI-3 to depend on WI-2 (serial, not parallel) so the provider edits don't conflict.

## Rule for PM on multi-resource migration initiatives

When an initiative migrates N ≥ 2 resources to the framework:
- Option A (serial): each resource WI depends on the prior one; each touches the shared provider files in sequence. The coupling checker allows this because the files are sequential, not parallel.
- Option B (batch): add a dedicated "register/deregister both resources" WI that owns `provider.go` + `framework_provider.go`, and keep per-resource WIs to framework-impl files only.

Option A (serial dependency chain) is simpler and what PM run 3 used successfully.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-servicehook/events.jsonl` (hidden_coupling_violations in PM run 1 end event, pm.work-item-emitted events for run 3)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-servicehook.md`
