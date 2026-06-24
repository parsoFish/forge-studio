---
title: Framework provider Configure() no-op stub panics at acceptance-test time
description: BetteradoFrameworkProvider.Configure() was a no-op stub after the mux-entrypoint cycle; WI-3 discovered this when GetProvider().Meta() returned nil under ProtoV6ProviderFactories.
category: antipattern
created_at: "2026-06-20"
updated_at: "2026-06-20"
---

## Pattern

After the mux-entrypoint initiative, `BetteradoFrameworkProvider.Configure()` compiled correctly but did nothing (empty body). This passed all unit tests. At acceptance-test time (`TF_ACC=1`, `ProtoV6ProviderFactories`), resources called `GetProvider().Meta()` and received nil, causing a panic.

**Fix applied in WI-3:** `Configure()` now reads `AZDO_ORG_SERVICE_URL` + `AZDO_PERSONAL_ACCESS_TOKEN` from environment (or config), calls `clients.GetAzdoClient(...)`, and stores the `*client.AggregatedClient` via `resp.ResourceData`. Framework resources extract it in their own `Configure()` via a type assertion.

New `testutils/mux_provider.go` added `GetMuxedProviderFactories()` returning `ProtoV6ProviderFactories` that combines the SDKv2 provider (via `tf5to6server.UpgradeServer`) with the framework provider. All task-group acceptance tests use this factory.

**Rule:** Every new framework provider initiative must verify `Configure()` is non-stub before running live acceptance tests. A no-op `Configure()` is a mux time-bomb.

## Sources

- `_logs/2026-06-19T23-10-22_INIT-2026-06-19-framework-task-group/events.jsonl` — WI-3 iteration events; ralph.end at `EV_mqlnvhs0_svjwwe5r` status=complete.
- `/home/parso/forge/brain/cycles/_raw/2026-06-19T23-10-22_INIT-2026-06-19-framework-task-group.md`
