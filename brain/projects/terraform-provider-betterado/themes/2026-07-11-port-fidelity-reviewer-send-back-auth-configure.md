---
title: Port-fidelity reviewer send-back on Configure() attribute nil-handling
description: When porting Configure() credential logic from SDKv2 to framework, reviewer comparison against legacy provider.go caught nil-handling gaps for boolean attrs (use_cli, use_msi, use_oidc) and other MEDIUM findings; one send-back round resolved all 5 findings without restructuring.
category: pattern
keywords: [configure, port-fidelity, nil-handling, use_cli, use_msi, use_oidc, reviewer-send-back, auth-parity]
related_themes: [configure-auth-index, 2026-06-20-framework-configure-stub-mux-timebomb, 2026-06-20-framework-provider-configure-not-stub, 2026-07-10-framework-configure-pat-only-aad-gap, 2026-07-11-framework-configure-auth-parity-complete, 2026-07-11-az-cli-auth-wrong-tenant-fallback]
created_at: 2026-07-11
updated_at: 2026-07-11
---

## Context

INIT-2026-07-10-framework-auth-parity ported credential resolution from the SDKv2 `GetAuthProvider()` function in `provider.go` into the pure-framework `Configure()` in `framework_provider.go`. The framework Configure() accepts 17 auth attributes (PAT, CLI, MSI, OIDC, client-secret/cert + env-var fallbacks).

## Reviewer findings (send-back round 1)

After Cycle 2 PR opened, operator review compared the ported logic field-for-field against the legacy `provider.go`:

- **HIGH:** `use_cli` (*bool) nil-handling — the framework schema returns `types.Bool` which can be null; the port did not guard for null before dereferencing, diverging from the SDKv2 `DefaultFunc` path.
- **4 MEDIUM:** Other attribute nil/default handling gaps across the 17-attr set.

Operator note: "keep changes surgical, do NOT restructure."

## Resolution

Unifier Cycle 3 (2 iters, $2.96) addressed all 5 findings. No second send-back. Final diff: 20 files, +1429/−42, 14 commits.

## Lesson

When porting a credential-resolution function with many attributes and env-var fallback chains:

1. The architect/PM spec should include an explicit AC: "diff the new Configure() attr-by-attr against `GetAuthProvider()` in `provider.go` and verify nil/default parity for all boolean flags."
2. Boolean framework attrs (`types.Bool`) can be null (unset) vs false — guard with `.IsNull()` or `.IsUnknown()` before `.ValueBool()`. The SDKv2 `DefaultFunc` path never returns nil for configured defaults; the framework path can.
3. A single reviewer pass catching 5 parity gaps is cheaper than discovering them at live acceptance time ($2.96 unifier vs a full extra dev-loop run).

## Sources

- `_logs/2026-07-10T23-53-00_INIT-2026-07-10-framework-auth-parity/events.jsonl` — `reviewer.verdict.send-back` event (EV_mrfnx88l), UWI-2/UWI-3 items
- `brain/cycles/_raw/2026-07-10T23-53-00_INIT-2026-07-10-framework-auth-parity.md`

## See also

Same saga — framework Configure() auth-parity chain:

- [[2026-06-20-framework-configure-stub-mux-timebomb]]
- [[2026-06-20-framework-provider-configure-not-stub]]
- [[2026-07-10-framework-configure-pat-only-aad-gap]]
- [[2026-07-11-framework-configure-auth-parity-complete]]
- [[2026-07-11-az-cli-auth-wrong-tenant-fallback]]
