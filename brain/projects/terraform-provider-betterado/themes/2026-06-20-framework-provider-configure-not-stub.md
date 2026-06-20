---
title: Framework provider Configure() must wire AggregatedClient — not a stub
description: After mux-entrypoint, BetteradoFrameworkProvider.Configure() was a no-op stub. Acceptance tests under ProtoV6ProviderFactories received nil from GetProvider().Meta(), causing panic. Configure() must read AZDO_ORG_SERVICE_URL + AZDO_PERSONAL_ACCESS_TOKEN, create *client.AggregatedClient, and store via resp.ResourceData.
category: pattern
created_at: 2026-06-20T00:00:00.000Z
updated_at: 2026-06-20T00:00:00.000Z
---

## Pattern

`azuredevops/internal/provider/framework_provider.go` — `BetteradoFrameworkProvider.Configure()` — must NOT be a stub.

**Required implementation:**
```go
func (p *BetteradoFrameworkProvider) Configure(ctx context.Context, req provider.ConfigureRequest, resp *provider.ConfigureResponse) {
    orgURL := os.Getenv("AZDO_ORG_SERVICE_URL")
    pat    := os.Getenv("AZDO_PERSONAL_ACCESS_TOKEN")
    conn   := azuredevops.NewAuthProviderPAT(pat)
    client, err := client.GetAzdoClient(conn, orgURL, ...)
    if err != nil {
        resp.Diagnostics.AddError("provider configure", err.Error())
        return
    }
    resp.ResourceData = client
    resp.DataSourceData = client
}
```

Framework resources receive the `*client.AggregatedClient` via their own `Configure(ctx, req resource.ConfigureRequest, resp *resource.ConfigureResponse)`:
```go
func (r *TaskGroupResource) Configure(_ context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
    if req.ProviderData == nil {
        return
    }
    client, ok := req.ProviderData.(*client.AggregatedClient)
    // ...
    r.client = client
}
```

**Why this bit us:** The mux-entrypoint cycle left `Configure()` as a stub (intentionally minimal). When acceptance tests switched from `Providers: testutils.GetProviders()` to `ProtoV6ProviderFactories: testutils.GetMuxedProviderFactories()`, the framework provider was invoked — and returned nil client data. Tests failed with nil-pointer in `getDirectClient()`.

## Mux acceptance test helper

`azuredevops/internal/acceptancetests/testutils/mux_provider.go` — `GetMuxedProviderFactories()` returns `resource.ProviderFunc` that builds a proto-v6 mux server:
```go
muxServer, _ := tf6muxserver.NewMuxServer(ctx,
    tf5to6server.UpgradeServer(ctx, azuredevops.Provider().GRPCProviderFunc()),
    providerserver.NewProtocol6(azuredevops.NewFrameworkProvider()),
)
return map[string]func() (tfprotov6.ProviderServer, error){
    "betterado": muxServer.ProviderServer,
}
```
All task-group acceptance tests use `ProtoV6ProviderFactories: testutils.GetMuxedProviderFactories()`.

## Sources

- `_logs/2026-06-19T23-10-22_INIT-2026-06-19-framework-task-group/events.jsonl` (WI-3 gate.fail at EV_mqlnats4; iteration 1 summary reasoning at EV_mqlnaox4 detail field `last_assistant_text`)
- `/home/parso/forge/brain/cycles/_raw/2026-06-19T23-10-22_INIT-2026-06-19-framework-task-group.md`
- `projects/terraform-provider-betterado/azuredevops/internal/provider/framework_provider.go`
- `projects/terraform-provider-betterado/azuredevops/internal/acceptancetests/testutils/mux_provider.go`
