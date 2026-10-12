---
title: gw apply CI workflow missing FORGE_RESOURCE_PREFIX causes post-merge red; acceptance tests need the env var to run clean
description: Post-merge red on `gw apply (live)` was not an idempotency bug — the CI workflow never sets FORGE_RESOURCE_PREFIX; acceptance tests passed in WI-15's gate (547 passed including 5 acceptance tests against dave-parso).
category: antipattern
keywords: [acceptance-tests, live-credentials, gw-apply, forge-resource-prefix, ci-workflow, post-merge-red, GW_APP_ID, tests/acceptance, WI-12, WI-15]
created_at: 2026-10-12T00:00:00Z
updated_at: 2026-10-12T00:00:00Z
related_themes: [2026-10-11-plan-engine-all-three-state-branches-required, sharp-edges, 2026-10-12-forge-resource-prefix-missing-in-ci-workflow]
---

## What happened

WI-12 and WI-13 were dependency-blocked by WI-6 failing. **They never ran at gate time.** After WI-6 was fixed in dev-loop run 2, the acceptance tests **passed** in WI-15's gate:

- `python3 -m pytest tests/` → 547 passed, including:
  - `tests/acceptance/test_gw_reset_before_apply.py` ×2
  - `tests/acceptance/test_gw_workflow.py` ×3 (against throwaway org `dave-parso`)

**Post-merge CI red** on SHA `e516ce84f` has two causes unrelated to idempotency:
1. **"Apply Configuration" job** — the April spike `apply-overlays.py` script was still wired into that workflow job; it receives a directory argument it can't handle. Pre-I2 artefact. Tagged for I3.
2. **"gw apply (live)" job** — the workflow never sets `FORGE_RESOURCE_PREFIX`. The `gw apply` command uses this env var to scope/filter resources during apply. Without it, the live run fails. Tagged for I3.

## What this means for gitweave

- `tests/acceptance/` **do** work against `dave-parso` when `GW_*` credentials are set. The acceptance contract is satisfied in tree.
- The CI workflow must set `FORGE_RESOURCE_PREFIX` (or the GitWeave-owned successor marker planned for I3) before invoking `gw apply (live)`.
- The April "Apply Configuration" job must be removed or rewired in I3 (stubbed apply-overlays.py invocation pattern).

## See also

- [[2026-10-11-plan-engine-all-three-state-branches-required]] — WI-6 failure that blocked WI-12/13
- [[2026-10-12-forge-resource-prefix-missing-in-ci-workflow]] — dedicated theme for the CI env-var gap

## Sources

- `_logs/2026-10-11T02-16-05_INIT-2026-10-11-i2-apply-engine-terraform-retired/events.jsonl` (WI-15 gate pass, post-merge CI event)
- `brain/cycles/_raw/2026-10-11T02-16-05_INIT-2026-10-11-i2-apply-engine-terraform-retired.md`
- `_logs/2026-10-11T02-16-05_INIT-2026-10-11-i2-apply-engine-terraform-retired/user-feedback.md` (operator correction 2026-10-12)
