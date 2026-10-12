---
title: CI workflow missing FORGE_RESOURCE_PREFIX causes gw apply (live) to fail post-merge
description: The .github/workflows/gitweave-apply.yml (or equivalent) never sets FORGE_RESOURCE_PREFIX; gw apply uses it to scope resources and silently fails without it, causing post-merge red on the live acceptance job.
category: antipattern
keywords: [forge-resource-prefix, ci-workflow, gw-apply, env-var, post-merge-red, github-actions, live-acceptance, I3]
created_at: 2026-10-12T00:00:00Z
updated_at: 2026-10-12T00:00:00Z
related_themes: [2026-10-11-acceptance-tests-require-live-credentials]
---

## What happened

After I2 merged (SHA `e516ce84f`), the `gw apply (live)` CI job turned red. Root cause: the workflow definition never sets `FORGE_RESOURCE_PREFIX`. The `gw apply` command uses this env var to scope/filter resources during apply; without it the live run fails.

This is distinct from an idempotency bug in the code — the apply logic is correct but the CI invocation is incomplete.

A second post-merge red: the "Apply Configuration" job still invokes the April spike `apply-overlays.py` script with a directory argument it cannot handle. That script was never wired into the new `gw` CLI; the job is a pre-I2 artefact.

## What I3 must fix

1. Add `FORGE_RESOURCE_PREFIX` (or the I3-planned GitWeave-owned resource marker) to the `gw apply (live)` workflow job's env block.
2. Remove or rewire the "Apply Configuration" job so it no longer invokes the stubbed `apply-overlays.py` with a directory.

## Rule

Before marking any initiative complete, verify each CI job name against the live workflow run — not just that the tests pass locally. A job that existed before the initiative can still turn red from a missing env var.

## See also

- [[2026-10-11-acceptance-tests-require-live-credentials]] — acceptance tests did pass in-tree; this is a CI wiring issue

## Sources

- `_logs/2026-10-11T02-16-05_INIT-2026-10-11-i2-apply-engine-terraform-retired/user-feedback.md` (operator correction 2026-10-12)
- `brain/cycles/_raw/2026-10-11T02-16-05_INIT-2026-10-11-i2-apply-engine-terraform-retired.md`
