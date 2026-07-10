---
title: ADO Accounts API requires Collections/Me endpoint for org-scoped PATs
description: For org-scoped PATs, app.vssps.visualstudio.com/_apis/accounts returns 401 and vssps.dev.azure.com/{org}/_apis/accounts returns 404; the working path is vssps.dev.azure.com/{org}/_apis/Organization/Collections/Me.
category: antipattern
created_at: 2026-07-04T01:02:34.000Z
updated_at: 2026-07-04T01:02:34.000Z
---

## Problem

WI-3 (accounts live acceptance) exhausted all 5 iterations discovering the correct VSSPS endpoint for an org-scoped PAT.

Endpoints tried:
| URL | Result | Notes |
|---|---|---|
| `app.vssps.visualstudio.com/_apis/accounts?api-version=7.1` | **401** | Global VSSPS rejects org-scoped PAT |
| `vssps.dev.azure.com/davidgparsonson/_apis/accounts?api-version=7.1` | **404** | Org VSSPS doesn't expose /accounts |
| ADO SDK `GetClientByResourceAreaId("8ccfef3d-...")` | **fails at Configure time** | Resource area probe triggers during provider configure, 401 on org-scoped PAT |
| `vssps.dev.azure.com/davidgparsonson/_apis/Organization/Collections/Me` | **200** | Returns account list for org-scoped PAT |

## Correct implementation

```go
// data_accounts.go — use Collections/Me for org-scoped PAT support
orgURL := client.OrganizationURL  // "https://dev.azure.com/davidgparsonson"
orgName := extractOrgName(orgURL)  // "davidgparsonson"
url := fmt.Sprintf("https://vssps.dev.azure.com/%s/_apis/Organization/Collections/Me", orgName)
```

The `BasicAuth` header is built from `AggregatedClient.BasicAuth` which stores the base64(`_:PAT`) header set during `Configure()`. Do NOT use the ADO SDK's `accounts.NewClient()` — it will trigger vssps resource-area discovery that fails for org-scoped PATs.

## Profile API

Profile uses a different VSSPS path that works with the SDK:
`app.vssps.visualstudio.com/_apis/profile/profiles/{id}` with the org-scoped PAT base64-encoded in `Authorization: Basic`.

The profile resource area ID `8ccfef3d-2b87-4e99-8ccb-66e343d2daa8` is NOT registered on `dev.azure.com/{org}` — must use the global vssps host for profile, unlike accounts.

## Impact

Ralph burned 5 iterations and the unifier spent 3 iterations (with direct curl probes) before arriving at the Collections/Me approach. Total re-derivation cost: ~$8 in UWI-2 + 5 ralph iterations.

## Prevention

Add to `profile.md` gotchas section. WI specs for accounts/profile data sources should specify the exact URL + auth pattern to avoid 5-iteration discovery.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-new-api-accounts-profile/events.jsonl` — gate.fail at L3158, L3399, L3656, L3938, L4161 (WI-3 iterations 1-5); UWI-2 iter 3 metadata shows curl probes and final resolution
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-new-api-accounts-profile.md`
