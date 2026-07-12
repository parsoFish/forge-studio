---
title: 'Provider Configure() & auth parity'
description: 'Topical index — Provider Configure() wiring and auth parity (PAT/AAD/CLI/MSI/OIDC/cert): az-cli token probe, wrong-tenant fallback, in-process provider injection, the PAT-only AAD gap.'
category: reference
keywords: [configure, auth, index, topical-hub]
related_themes: [framework-migration-index, ado-api-shapes-index]
created_at: 2026-07-12T00:00:00.000Z
updated_at: 2026-07-12T00:00:00.000Z
---

> **Topical index node.** Provider Configure() wiring and auth parity (PAT/AAD/CLI/MSI/OIDC/cert): az-cli token probe, wrong-tenant fallback, in-process provider injection, the PAT-only AAD gap.

## Member themes (7)

- [[2026-06-20-framework-provider-configure-not-stub]] — After mux-entrypoint, BetteradoFrameworkProvider.Configure() was a no-op stub. Acceptance tests under ProtoV6ProviderFactories received nil from GetProvider().Meta(), causing panic. Configure() must read AZDO_ORG_SERVICE_URL + AZDO_PERSONAL_ACCESS_TOKEN, create *client.AggregatedClient, and store via resp.ResourceData.
- [[2026-07-03-configfile-in-process-provider-injection-pattern]] — terraform-plugin-testing does NOT prepend the required_providers terraform block when ConfigFile is used instead of Config; TF_REATTACH_PROVIDERS is used for binary injection but the source block must still be in the HCL file, or use Config string instead.
- [[2026-07-10-framework-configure-pat-only-aad-gap]] — After the mux-free cutover the framework Configure() only wires PAT auth; AAD/OIDC/MSI/CLI schema attributes are accepted but non-functional — a pre-existing gap deferred as a follow-up initiative before any public 2.0.0 release.
- [[2026-07-11-az-cli-ado-token-probe-pattern]] — Probe az account get-access-token with the ADO audience once; non-zero exit means CLI unavailable — take the documented fallback immediately, never iterate against live CLI failures.
- [[2026-07-11-az-cli-auth-wrong-tenant-fallback]] — When `az` is installed but logged into a different tenant (AADSTS9002313), live CLI auth against ADO cannot be exercised; the correct fallback is t.Skip + credential-construction unit proof for all auth methods; manifest must document this probe and the fallback path explicitly.
- [[2026-07-11-framework-configure-auth-parity-complete]] — The pure-framework Configure() now resolves PAT/CLI/MSI/OIDC/client-secret/cert credentials with full ARM_*/AZDO_* env-var fallbacks, matching the SDKv2 GetAuthProvider() surface; auth.go helper is the shared unit-testable entry point.
- [[2026-07-11-port-fidelity-reviewer-send-back-auth-configure]] — When porting Configure() credential logic from SDKv2 to framework, reviewer comparison against legacy provider.go caught nil-handling gaps for boolean attrs (use_cli, use_msi, use_oidc) and other MEDIUM findings; one send-back round resolved all 5 findings without restructuring.

## See also

- [[framework-migration-index]] — Framework migration (SDKv2 → plugin-framework).
- [[ado-api-shapes-index]] — ADO REST API shapes & quirks.
