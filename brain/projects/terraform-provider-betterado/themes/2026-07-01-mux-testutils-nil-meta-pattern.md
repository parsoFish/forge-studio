---
title: Mux framework test helpers must not call GetProvider().Meta()
description: testutils helpers that call GetProvider().Meta().(*client.AggregatedClient) panic under GetMuxedProviderFactories() because the SDKv2 provider singleton's Meta() is nil in the mux path; replace with getADOClientsFromEnv() pattern.
category: antipattern
keywords: [mux, getmuxedproviderfactories, testutils, nil-meta, getadoclientsfromenv, panic]
related_themes: [framework-migration-index]
created_at: 2026-07-01T00:00:00.000Z
updated_at: 2026-07-01T00:00:00.000Z
---

## Pattern observed

WI-4 (approvalsandchecks migration): `TestAccCheckEnvironment` panicked at `pipelinechecks.go:67`:

```
panic: interface conversion: interface {} is nil, not *client.AggregatedClient
```

Root cause: `getCheckFromState()` called `GetProvider().Meta().(*client.AggregatedClient)`. When the test uses `ProtoV6ProviderFactories: testutils.GetMuxedProviderFactories()`, the SDKv2 provider singleton is never configured by the Terraform test lifecycle — `Meta()` returns nil. The type assertion panics.

Also: `CheckPipelineCheckDestroyed` was calling `getSvcEndpointFromState` (a service-endpoint helper) for check resources — wrong helper entirely.

## Fix (commit 852c4283)

Replace `GetProvider().Meta().*` in `testutils/pipelinechecks.go` with `getADOClientsFromEnv()`, which builds the ADO client directly from `AZDO_ORG_SERVICE_URL` / `AZDO_PERSONAL_ACCESS_TOKEN`. This pattern is already established in `shared_fixtures.go`. Any `CheckXxxDestroyed` helper in a framework-migrated package must use env-var client construction, not `GetProvider().Meta()`.

## Scope

All `testutils/*.go` helpers referenced by framework-migrated acceptance tests. Search pattern: `grep -rn "GetProvider().Meta()" azuredevops/internal/acceptancetests/testutils/`. Every hit is a candidate for this fix.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-policy-branch/events.jsonl` (L2648 iteration 3 summary; L2649 gate.fail `TestAccCheckEnvironment` panic)
- `/home/parso/forge/brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-policy-branch.md`
