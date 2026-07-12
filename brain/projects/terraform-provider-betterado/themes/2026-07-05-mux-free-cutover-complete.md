---
title: Mux-free cutover complete — pure framework provider achieved
description: The mux scaffold (tf6muxserver + tf5to6server) was removed; main.go now serves only the framework provider. All 16 remaining serviceendpoint types migrated in 5 WIs; provider.go ResourcesMap/DataSourcesMap empty.
category: reference
keywords: [mux-free, cutover, tf6server, providerserver, serviceendpoint, framework-provider, sdkv2-removal]
related_themes: [framework-migration-index]
created_at: 2026-07-09T22:03:49.533Z
updated_at: 2026-07-09T22:03:49.533Z
---

## What happened

Cycle `2026-07-01T08-39-27_INIT-2026-07-01-mux-free-cutover` executed the mux-free cutover:

- **WI-1**: 4 JFrog v2 serviceendpoint types migrated to framework (ArtifactoryV2, DistributionV2, PlatformV2, XRayV2). Started with a build failure — test files referenced `artifactoryRandomServiceEndpointProjectIDpassword`, `artifactoryRandomServiceEndpointProjectID`, and `flattenServiceEndpointArtifactory` which were undefined. Ralph diagnosed and fixed in iteration 0 (correct `gate.expected-fail` behaviour).
- **WI-2**: 12 remaining serviceendpoint types (Kubernetes, Maven, Nexus, NuGet, OctopusDeploy, OpenShift, RunPipeline, ServiceFabric, Snyk, SonarQube, SSH, VisualStudioMarketplace) each got a `*_framework.go` with `New*Resource()`, registered in `framework_provider.go`.
- **WI-3**: Confirmed both maps in `provider.go` empty (no remaining SDKv2 registrations).
- **WI-4**: `main.go` rewritten — imports only `terraform-plugin-framework/providerserver` + `tf6server`; no `tf5to6server`, `tf6muxserver`, or SDKv2 schema.
- **WI-5**: Acceptance test `TestFrameworkProvider_MuxFree` written; live evidence captured to `.forge/live-evidence/acceptance-provider-mux-free.json`.

Delivery: **165 files changed, +7757/-549, 41 commits**.

## Current state

Provider is now a pure terraform-plugin-framework binary. SDKv2 resource/data-source path fully removed from the runtime entry point. `azuredevops/framework.go` shim and `azuredevops.Provider()` factory removed.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-mux-free-cutover/events.jsonl` — `dev-loop.delivered` event (line 2003), WI-1 through WI-5 gate events
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-mux-free-cutover.md`
