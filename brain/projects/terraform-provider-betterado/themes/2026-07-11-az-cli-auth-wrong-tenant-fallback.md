---
title: az CLI present but wrong tenant — documented t.Skip fallback for ADO CLI auth
description: When `az` is installed but logged into a different tenant (AADSTS9002313), live CLI auth against ADO cannot be exercised; the correct fallback is t.Skip + credential-construction unit proof for all auth methods; manifest must document this probe and the fallback path explicitly.
category: pattern
keywords: [az-cli, wrong-tenant, aadsts9002313, t-skip-fallback, credential-construction, pat-masks-cli]
related_themes: [configure-auth-index, 2026-06-20-framework-configure-stub-mux-timebomb, 2026-06-20-framework-provider-configure-not-stub, 2026-07-10-framework-configure-pat-only-aad-gap, 2026-07-11-framework-configure-auth-parity-complete, 2026-07-11-port-fidelity-reviewer-send-back-auth-configure]
created_at: 2026-07-11
updated_at: 2026-07-11
---

## Context

AC-4 of INIT-2026-07-10-framework-auth-parity required testing Azure CLI auth against real ADO (non-PAT path). The runner had `az` installed, but it was logged into a different Azure tenant — `az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798` returns AADSTS9002313 (wrong tenant, not the `davidgparsonson` ADO org).

## Correct fallback pattern

The manifest documented the probe and fallback explicitly (operator note in resolved design decisions):

1. **Probe once cheaply:** `az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798` — non-zero exit → CLI unavailable.
2. **Fallback:** `t.Skip("Azure CLI not available for ADO tenant")` + unit proof that credential *construction* succeeds for all 5 methods (PAT, CLI, MSI, client-secret, OIDC) using stubs/fakes.
3. **Do NOT iterate on live CLI-auth failures** — AADSTS9002313 is a tenant configuration issue, not a code bug.

WI-3 applied this pattern without iteration waste: the acceptance test file was created with the documented `t.Skip`, all sub-checks passed, gate passed at iter 1.

## Key gotcha: PAT masks CLI path

The acceptance harness sources `secrets.env` which sets `AZDO_PERSONAL_ACCESS_TOKEN` globally. A live CLI auth test MUST explicitly unset this env var in the test process or the PAT path will silently satisfy the credential check and the CLI path is never exercised. The manifest documented this; WI-3 implemented it.

## Sources

- `_logs/2026-07-10T23-53-00_INIT-2026-07-10-framework-auth-parity/events.jsonl` — WI-3 gate events, `gate.pass` at iter 1
- `_queue/done/INIT-2026-07-10-framework-auth-parity.md` — AC-4 runner environment note + resolved design decisions
- `brain/cycles/_raw/2026-07-10T23-53-00_INIT-2026-07-10-framework-auth-parity.md`

## See also

Same saga — framework Configure() auth-parity chain:

- [[2026-06-20-framework-configure-stub-mux-timebomb]]
- [[2026-06-20-framework-provider-configure-not-stub]]
- [[2026-07-10-framework-configure-pat-only-aad-gap]]
- [[2026-07-11-framework-configure-auth-parity-complete]]
- [[2026-07-11-port-fidelity-reviewer-send-back-auth-configure]]
