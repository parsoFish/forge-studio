---
title: Accounts and Profile data source implementation pattern
description: betterado_accounts uses direct HTTP to Collections/Me (org-scoped VSSPS); betterado_profile uses direct HTTP to app.vssps.visualstudio.com/_apis/profile/profiles/{id} with BasicAuth from AggregatedClient.
category: pattern
created_at: 2026-07-04T01:02:34.000Z
updated_at: 2026-07-04T01:02:34.000Z
---

## Pattern

Both `betterado_accounts` and `betterado_profile` bypass the ADO Go SDK clients and make direct HTTP calls using `AggregatedClient.BasicAuth` (base64(`_:PAT`) set during `Configure()`).

### accounts — Collections/Me path

```
GET https://vssps.dev.azure.com/{orgName}/_apis/Organization/Collections/Me
Authorization: Basic <BasicAuth>
```

`orgName` extracted from `AggregatedClient.OrganizationURL` (strip `https://dev.azure.com/`).

Returns JSON with `value[]` array; each entry has `id`, `name`, `uri`, `type`.

### profile — global VSSPS path

```
GET https://app.vssps.visualstudio.com/_apis/profile/profiles/{id}?api-version=3.0
Authorization: Basic <BasicAuth>
```

`id` is the Terraform config attribute (use `"me"` for authenticated user).

Returns `displayName`, `emailAddress`, `publicAlias`, `id`, `coreAttributes.Avatar`.

### Key structural fact

`AggregatedClient.BasicAuth` is a `string` field added during this initiative to hold the pre-computed `Authorization: Basic ...` header value. It is populated in `framework_provider.go` `Configure()` when building the aggregated client.

Do NOT use the SDK's `accounts.NewClient()` or `profile.NewClient()` with `GetClientByResourceAreaId` — both resource area IDs fail on org-scoped PATs at provider Configure time.

## Files

- `azuredevops/internal/service/accounts/data_accounts.go` — `betterado_accounts` framework data source
- `azuredevops/internal/service/profile/data_profile.go` — `betterado_profile` framework data source
- `azuredevops/internal/client/client.go` — `AggregatedClient.BasicAuth` field + `AccountsClient`/`ProfileClient` (kept as nil-safe best-effort fields for evidence capture)
- `azuredevops/internal/provider/framework_provider.go` — sets `BasicAuth` in `Configure()`

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-new-api-accounts-profile/events.jsonl` — UWI-2 iter 3 metadata shows final curl confirmation; report.md file-by-file summary
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-new-api-accounts-profile.md`
