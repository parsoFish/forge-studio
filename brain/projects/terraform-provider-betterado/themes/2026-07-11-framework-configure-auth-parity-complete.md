---
title: Framework Configure() auth parity — all 17 attributes + env fallbacks wired
description: The pure-framework Configure() now resolves PAT/CLI/MSI/OIDC/client-secret/cert credentials with full ARM_*/AZDO_* env-var fallbacks, matching the SDKv2 GetAuthProvider() surface; auth.go helper is the shared unit-testable entry point.
category: reference
keywords: [configure, auth-parity, pat, cli, msi, oidc, client-secret, cert, env-fallback, auth-go]
related_themes: [configure-auth-index, 2026-06-20-framework-configure-stub-mux-timebomb, 2026-06-20-framework-provider-configure-not-stub, 2026-07-10-framework-configure-pat-only-aad-gap, 2026-07-11-az-cli-auth-wrong-tenant-fallback, 2026-07-11-port-fidelity-reviewer-send-back-auth-configure]
created_at: 2026-07-11
updated_at: 2026-07-11
---

## What changed (INIT-2026-07-10-framework-auth-parity, PR #69)

Before: `framework_provider.go:Configure()` read only `org_service_url` + `personal_access_token`, returning `resp.ResourceData = nil` for all non-PAT callers (CLI, MSI, OIDC, client-secret/cert). The 17-attr schema existed but was dead.

After: `Configure()` calls `resolveAuthProvider()` in `azuredevops/internal/provider/auth.go`, which handles:

| Method | Schema attr(s) | Env fallback |
|---|---|---|
| PAT | `personal_access_token` | `AZDO_PERSONAL_ACCESS_TOKEN` |
| Azure CLI | `use_cli` (default true) | `ARM_USE_CLI` |
| MSI | `use_msi` | `ARM_USE_MSI` |
| OIDC | `use_oidc`, `oidc_token`, `oidc_token_file_path`, `oidc_request_url`, `oidc_request_token`, `oidc_azure_service_connection_id` | `ARM_USE_OIDC`, `ARM_OIDC_TOKEN` |
| Client secret | `client_secret`, `client_secret_path`, `client_id`, `tenant_id` | `ARM_CLIENT_SECRET`, `ARM_CLIENT_ID`, `ARM_TENANT_ID` |
| Client cert | `client_certificate`, `client_certificate_path`, `client_certificate_password` | `ARM_CLIENT_CERTIFICATE_PATH` |

No-credential path: `Configure()` appends an `AddError` diagnostic with a human-readable message naming available options (AC-2 — fail fast, no silent nil panic deferred to first resource call).

## Key implementation notes

- `use_cli` defaults to `true` when `ARM_USE_CLI` is unset — matches SDKv2 `DefaultFunc`.
- Boolean framework attrs are `types.Bool` (can be null/unknown); guard with `.IsNull()` before `.ValueBool()` — reviewer send-back caught nil-handling gaps on first pass.
- `auth.go` is importable by unit tests with stub credential constructors (no live ADO call at unit-test time).
- `go vet -tags all ./azuredevops/internal/provider/...` clean; no SDKv2 schema import in `framework_provider.go`.

## Ride-along (AC-8)

- `terraform-registry-manifest.json`: `"protocol_versions": ["6.0"]` (was `["5.0"]`)
- `PROVIDER_VERSION.txt`: `2.0.1`
- `CHANGELOG.md`: `2.0.1` entry under ENHANCEMENTS

## Sources

- `_logs/2026-07-10T23-53-00_INIT-2026-07-10-framework-auth-parity/events.jsonl` — dev-loop.delivered: 20 files, +1429/−42, 14 commits
- `_queue/done/INIT-2026-07-10-framework-auth-parity.md` — full AC set
- `brain/cycles/_raw/2026-07-10T23-53-00_INIT-2026-07-10-framework-auth-parity.md`

## See also

Same saga — framework Configure() auth-parity chain:

- [[2026-06-20-framework-configure-stub-mux-timebomb]]
- [[2026-06-20-framework-provider-configure-not-stub]]
- [[2026-07-10-framework-configure-pat-only-aad-gap]]
- [[2026-07-11-az-cli-auth-wrong-tenant-fallback]]
- [[2026-07-11-port-fidelity-reviewer-send-back-auth-configure]]
