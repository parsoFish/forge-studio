---
title: Azure CLI ADO token probe — single cheap check before iterating
description: Probe az account get-access-token with the ADO audience once; non-zero exit means CLI unavailable — take the documented fallback immediately, never iterate against live CLI failures.
category: pattern
created_at: 2026-07-11
updated_at: 2026-07-11
---

## Pattern

When an AC requires Azure CLI authentication against ADO and the runner environment is uncertain:

```bash
az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798
```

- Exit 0 → CLI is authenticated for the ADO audience → proceed with live CLI test path.
- Non-zero (e.g. `AADSTS9002313: wrong tenant`) → take the documented fallback immediately.

**Never** treat binary presence (`which az`) as authentication availability. The `az` binary can be installed but logged into a different tenant, failing only at token-minting time.

## Fallback (AC-4 in framework-auth-parity)

When the probe exits non-zero:
1. `t.Skip("Azure CLI not available for ADO audience on this runner: <err message>")`
2. Deliver credential-construction unit-proof for all auth method variants (PAT, CLI, MSI, OIDC, client-secret) — no live ADO call required.
3. Document the constraint in a `t.Skip` body so future runners know what to fix (`az login --scope 499b84ac-.../default`).

## Why it works

- Single probe cost: one `az` invocation, ~1s.
- No wasted iterations against `AADSTS9002313` failures.
- The fallback unit-proof is meaningful — it verifies all credential constructors compile and don't panic, which is the real concern for a pure port.
- WI-3 in INIT-2026-07-10-framework-auth-parity executed this in exactly 1 iteration.

## Pre-condition

Manifest runner-note must tell Ralph:
> "Probe cheaply once: `az account get-access-token --resource 499b84ac-...` — non-zero exit ⇒ take the documented-`t.Skip` + unit-proof fallback path immediately; do not iterate on live CLI-auth failures."

Without this instruction ralph would iterate.

## Sources

- `_logs/2026-07-10T23-53-00_INIT-2026-07-10-framework-auth-parity/events.jsonl` — WI-3 dev-loop, 1 iteration, gate.expected-fail → gate.pass
- `brain/cycles/_raw/2026-07-10T23-53-00_INIT-2026-07-10-framework-auth-parity.md`
