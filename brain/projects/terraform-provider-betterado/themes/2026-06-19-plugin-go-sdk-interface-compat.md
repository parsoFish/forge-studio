---
title: terraform-plugin-go interface compat — SDK/v2 must match plugin-go minor version
description: terraform-plugin-go@v0.31.0 added GenerateResourceConfig to tfprotov5.ProviderServer; terraform-plugin-sdk/v2@v2.38.1 doesn't implement it, causing a build failure. Bump sdk/v2 to v2.40.1+ to resolve.
category: pattern
keywords: [terraform-plugin-go, terraform-plugin-sdk, mux, interface-compat, generateresourceconfig, go-mod, version-bump]
related_themes: [build-tooling-index]
created_at: 2026-06-19T00:00:00.000Z
updated_at: 2026-06-19T00:00:00.000Z
---

## Pattern

When adding `terraform-plugin-mux` (which pulls `terraform-plugin-go@latest`), a version mismatch can occur:

- `terraform-plugin-go@v0.31.0` added `GenerateResourceConfig` to the `tfprotov5.ProviderServer` interface.
- `terraform-plugin-sdk/v2@v2.38.1` implements an older interface without `GenerateResourceConfig`.
- Build fails: `*schema.GRPCProviderServer does not implement tfprotov5.ProviderServer (missing method GenerateResourceConfig)`.

**Fix**: bump `terraform-plugin-sdk/v2` to a version that implements the extended interface:
```
go get github.com/hashicorp/terraform-plugin-sdk/v2@latest  # resolved to v2.40.1
go mod tidy && go mod vendor
```

**Decision made in this cycle**: bump sdk/v2 rather than pin plugin-go to an older version. Rationale: staying on latest plugin-go is required for mux compatibility; pinning old plugin-go would conflict with framework deps.

Check `go.mod` after adding mux + framework deps — if sdk/v2 is pinned below v2.40.x, expect this build failure.

## Sources

- `_logs/2026-06-19T06-29-05_INIT-2026-06-19-framework-mux-entrypoint/events.jsonl` (EV_mqkk1ucl reasoning at seq 136-143; `go get sdk/v2@latest` at seq 142 → v2.40.1; build pass at seq 148)
- `/home/parso/forge/brain/cycles/_raw/2026-06-19T06-29-05_INIT-2026-06-19-framework-mux-entrypoint.md`
