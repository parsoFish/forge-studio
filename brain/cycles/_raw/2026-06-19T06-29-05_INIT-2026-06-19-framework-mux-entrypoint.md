---
source_type: cycle
source_url: _logs/2026-06-19T06-29-05_INIT-2026-06-19-framework-mux-entrypoint/events.jsonl
source_title: Cycle 2026-06-19T06-29-05 — Initiative INIT-2026-06-19-framework-mux-entrypoint
cycle_id: 2026-06-19T06-29-05_INIT-2026-06-19-framework-mux-entrypoint
initiative_id: INIT-2026-06-19-framework-mux-entrypoint
project: terraform-provider-betterado
ingested_at: 2026-06-19T23:30:00.000Z
ingested_by: reflector
retention: load-bearing
cited_by:
  - brain/cycles/themes/2026-06-19-unifier-cwd-forge-root-exploration.md
  - projects/terraform-provider-betterado/forge/brain/themes/2026-06-19-go-internal-package-main-cannot-import.md
  - projects/terraform-provider-betterado/forge/brain/themes/2026-06-19-go-module-vendor-write-code-before-tidy.md
  - projects/terraform-provider-betterado/forge/brain/themes/2026-06-19-mux-scaffold-architecture.md
  - projects/terraform-provider-betterado/forge/brain/themes/2026-06-19-plugin-go-sdk-interface-compat.md
---

## Summary

Initiative: add `terraform-plugin-mux` scaffold enabling framework + SDKv2 providers to coexist in one binary — prerequisite for migrating `betterado_release_definition` and `betterado_task_group` to terraform-plugin-framework.

**Deliverables** (verified by `dev-loop.delivered`): 1424 files changed, 117389 insertions, 49998 deletions; 13 commits.
- `go.mod` / `go.sum` / `vendor/`: added `terraform-plugin-framework@v1.19.0`, `terraform-plugin-mux@v0.23.1`; promoted `terraform-plugin-go@v0.31.0` to direct; bumped `terraform-plugin-sdk/v2` v2.38.1 → v2.40.1 (interface compat).
- `azuredevops/internal/provider/framework_provider.go`: minimal framework `Provider` stub with `// FRAMEWORK EXTENSION POINT` markers.
- `azuredevops/framework.go`: thin public re-export for root `main.go` (Go `internal/` visibility fix).
- `main.go`: rewritten — `tf5to6server.UpgradeServer` → `tf6muxserver.NewMuxServer` → `tf6server.Serve`.
- `azuredevops/internal/acceptancetests/resource_mux_sdkv2_passthrough_test.go`: live acc test `TestAccMuxSdkv2Passthrough` (plan against `betterado_release_folder` using locally-built mux binary + `CaptureLiveEvidence`).
- `.forge/live-evidence/acceptance-resource.json`: real vsrm.dev.azure.com REST GET.

**Phases**: PM (1 iter, $0.68) → dev-loop WI-1 (1 iter) + WI-2 (1 iter) → unifier (2 iters, $2.20) → CI gate pass → PR #28 opened.

**Key observations**:
1. `go get`-before-code self-corrected within iter 0 (no rework loop).
2. Go `internal/` visibility blocked `main.go → azuredevops/internal/provider`; fixed with `azuredevops/framework.go` re-export.
3. `plugin-go@v0.31.0` introduced `GenerateResourceConfig` to `tfprotov5.ProviderServer`; required opportunistic SDK bump to v2.40.1.
4. `golangci-lint run ./...` on full codebase takes 6-8 minutes; agent used `--new-from-rev HEAD` workaround.
5. Unifier UWI-3 spent ~30 tool calls probing forge machinery from forge-root cwd.

**CI**: `make test && golangci-lint run --new-from-rev=main ./azuredevops/... && make terrafmt-check` → 0 issues.
**PR**: https://github.com/parsoFish/terraform-provider-betterado/pull/28

## Event log reference

Full event log: `_logs/2026-06-19T06-29-05_INIT-2026-06-19-framework-mux-entrypoint/events.jsonl`
