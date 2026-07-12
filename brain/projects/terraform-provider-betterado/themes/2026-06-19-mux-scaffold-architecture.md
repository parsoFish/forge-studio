---
title: terraform-plugin-mux scaffold — architecture for coexisting SDKv2 + framework providers
description: The mux scaffold wraps the SDKv2 provider via tf5to6server.UpgradeServer, muxes it with the framework provider via tf6muxserver.NewMuxServer, and serves via tf6server.Serve. Extension points are in azuredevops/internal/provider/framework_provider.go.
category: pattern
keywords: [terraform-plugin-mux, tf5to6server, tf6muxserver, sdkv2, framework-provider, extension-point, mux-scaffold]
related_themes: [framework-migration-index]
created_at: 2026-06-19T00:00:00.000Z
updated_at: 2026-06-19T00:00:00.000Z
---

## Architecture

Three files constitute the mux scaffold:

### `main.go` (rewritten)
```go
muxServer, err := tf6muxserver.NewMuxServer(ctx,
    tf5to6server.UpgradeServer(ctx, azuredevops.Provider().GRPCProviderFunc()),
    azuredevops.NewFrameworkProvider,
)
tf6server.Serve(providerName, muxServer.ProviderServer)
```

### `azuredevops/framework.go` (thin re-export)
```go
package azuredevops
func NewFrameworkProvider() provider.Provider {
    return internalprovider.New()
}
```
Exists solely to bridge Go's `internal/` package rule (see `2026-06-19-go-internal-package-main-cannot-import.md`).

### `azuredevops/internal/provider/framework_provider.go`
Minimal `BetteradoFrameworkProvider` implementing `provider.Provider`:
- `Metadata`, `Schema`, `Configure` (wires same ADO client factory).
- `Resources()` — marked `// FRAMEWORK EXTENSION POINT`.
- `DataSources()` — marked `// FRAMEWORK EXTENSION POINT`.

**Extension pattern**: new framework resources register here. No changes to `main.go` or `framework.go` are needed for subsequent resource additions.

### SDKv2 passthrough verification
`TestAccMuxSdkv2Passthrough` in `azuredevops/internal/acceptancetests/resource_mux_sdkv2_passthrough_test.go`:
- Builds the mux binary locally.
- Runs `terraform plan` against `betterado_release_folder` (an SDKv2 resource) via the mux binary.
- Asserts plan succeeds, no schema errors.
- Calls `CaptureLiveEvidence("acceptance-resource", vsrm URL, ...)` → `.forge/live-evidence/acceptance-resource.json`.

## Sources

- `_logs/2026-06-19T06-29-05_INIT-2026-06-19-framework-mux-entrypoint/events.jsonl` (file.add events for all three files; gate.pass WI-1 and WI-2; TestAccMuxSdkv2Passthrough pass at EV_mqkko01f)
- `/home/parso/forge/brain/cycles/_raw/2026-06-19T06-29-05_INIT-2026-06-19-framework-mux-entrypoint.md`
- `projects/terraform-provider-betterado/main.go`
- `projects/terraform-provider-betterado/azuredevops/framework.go`
- `projects/terraform-provider-betterado/azuredevops/internal/provider/framework_provider.go`
