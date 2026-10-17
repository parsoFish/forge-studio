---
title: GW_RESOURCE_PREFIX is a resource scope marker, not a credential — never wire it as a GitHub Actions secret
description: WI-2 set GW_RESOURCE_PREFIX via secrets.GW_RESOURCE_PREFIX in the workflow; the secret does not exist and the live apply job fails; a resource-scope prefix is config, not a credential.
category: antipattern
keywords: [GW_RESOURCE_PREFIX, github-actions, secret, workflow-env, resource-marker, ci-wiring, live-apply, send-back]
created_at: 2026-10-13T00:00:00Z
updated_at: 2026-10-13T00:00:00Z
related_themes: [2026-10-12-forge-resource-prefix-missing-in-ci-workflow, 2026-10-13-reset-and-containment-via-api-state]
---

## What happened

I3a WI-2 fixed `.github/workflows/gitweave-apply.yaml` to add `GW_RESOURCE_PREFIX` to the `env:` block of the live apply job. The implementation used:

```yaml
env:
  GW_RESOURCE_PREFIX: ${{ secrets.GW_RESOURCE_PREFIX }}
```

`secrets.GW_RESOURCE_PREFIX` does not exist in the repository's GitHub Actions secrets — and it should not, because `GW_RESOURCE_PREFIX` is a string prefix like `gw-i3a-` used to scope which resources a test run owns. It is not a credential (no token, no key, no password).

The job ran, the expression resolved to the empty string, and the job failed with `GW_RESOURCE_PREFIX must be set and non-empty`. This triggered send-back round 2, adding WI-6 to rewire the value correctly.

## Rule

`GW_RESOURCE_PREFIX` is config, not a credential. The operator-ruled value is `gw-`. Wire it as a **repo Actions variable** in the workflow `env:` block:

```yaml
env:
  GW_RESOURCE_PREFIX: ${{ vars.GW_RESOURCE_PREFIX }}
```

The variable is set in the repository's GitHub Actions variables (Settings → Secrets and variables → Actions → Variables), not in Secrets. Never use `${{ secrets.GW_RESOURCE_PREFIX }}`.

Credentials (`GW_APP_ID`, `GW_APP_INSTALLATION_ID`, `GW_APP_PRIVATE_KEY`) → secrets. Scope markers → plain values or config files.

## Operator answers

GitWeave-specific: confirmed stays as project theme only. `GW_RESOURCE_PREFIX=gw-` is operator-ruled and stored as a repo Actions variable (`vars.GW_RESOURCE_PREFIX`). Credentials (`GW_APP_ID`, `GW_APP_INSTALLATION_ID`, `GW_APP_PRIVATE_KEY`) → secrets; scope markers → vars. (Q3 + free-form, 2026-10-13 feedback.)

## See also

- [[2026-10-12-forge-resource-prefix-missing-in-ci-workflow]] — prior cycle where FORGE_RESOURCE_PREFIX was missing; this is the successor problem with GW_RESOURCE_PREFIX
- [[2026-10-13-reset-and-containment-via-api-state]] — other send-back 2 finding

## Sources

- `_logs/2026-10-12T05-14-21_INIT-2026-10-11-i3a-green-apply-path/events.jsonl` (send-back round 2 rationale at 2026-10-12T11:00)
- `brain/cycles/_raw/2026-10-12T05-14-21_INIT-2026-10-11-i3a-green-apply-path.md`
