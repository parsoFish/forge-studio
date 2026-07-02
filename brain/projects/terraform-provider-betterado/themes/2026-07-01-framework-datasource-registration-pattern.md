---
title: Framework data-source registration pattern — DataSources() in framework_provider.go
description: First-mover pattern for registering framework datasource.DataSource implementations in DataSources() — the release family (5 data-sources) establishes the template that all future data-source migrations copy.
category: pattern
created_at: 2026-07-01T00:00:00.000Z
updated_at: 2026-07-01T00:00:00.000Z
---

## Pattern

`framework_provider.go`'s `DataSources()` was empty before this initiative. The release family established the first registrations:

```go
func (p *BetteradoFrameworkProvider) DataSources(_ context.Context) []func() datasource.DataSource {
    return []func() datasource.DataSource{
        release.NewReleaseDefinitionDataSource,
        release.NewReleaseDefinitionHistoryDataSource,
        release.NewReleaseDefinitionRevisionDataSource,
        release.NewReleaseDefinitionsDataSource,
        release.NewReleaseFolderDataSource,
    }
}
```

## File layout per data-source

- Implementation: `azuredevops/internal/service/<pkg>/datasource_<name>_framework.go`
- Implements `datasource.DataSource` (not `schema.Resource`)
- `Metadata()` sets `resp.TypeName = req.ProviderTypeName + "_<name>"` where `ProviderTypeName` is `"betterado"` (from `Metadata()` in `BetteradoFrameworkProvider`)
- `Schema()` mirrors the SDKv2 schema — same attributes, adapted to framework schema types
- `Read()` calls the existing client API method; 404 returns a diagnostic error (data-source must find or fail)
- SDKv2 registration removed from `provider.go`'s `DataSourcesMap` in the SAME WI

## Acceptance test factory

Data-source acceptance tests use `ProtoV6ProviderFactories: testutils.GetMuxedProviderFactories()` (NOT the SDKv2 factory). `CheckDestroy` and evidence capture use `getDirectClient()` to build `*client.AggregatedClient` from env vars directly.

## `provider_test.go` update required

When removing an SDKv2 data-source, update `TestProvider_HasChildDataSources` to remove the name from the expected set.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-release-folder-permissions/events.jsonl` (lines 1820-1823: WI-3 complete, 11 files, datasource_*_framework.go files listed in output_refs)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-release-folder-permissions.md`
