---
title: Acceptance test gate passes on partial delivery — missing UpdatePermissions test not caught
description: WI-4 gate `-run TestAccReleaseDefinitionPermissions` matched the committed SetPermissions test but missed the required UpdatePermissions test; spec required both.
category: antipattern
created_at: 2026-06-06T00:00:00.000Z
updated_at: 2026-06-06T00:00:00.000Z
---

## Antipattern

WI-4 spec required two acceptance tests:
1. `TestAccReleaseDefinitionPermissions_SetPermissions`
2. `TestAccReleaseDefinitionPermissions_UpdatePermissions`

Quality gate: `go test ... -run TestAccReleaseDefinitionPermissions ./azuredevops/internal/service/release/`

The agent committed only `SetPermissions`. The gate `-run TestAccReleaseDefinitionPermissions` matched the single test via prefix — gate passed at iter-1, WI marked complete.

**Neither the gate nor the dev-loop caught the missing `UpdatePermissions` test.** The unifier flagged it in AGENT.md; operator review caught it.

## Root cause

Prefix-match `-run TestAccReleaseDefinitionPermissions` matches any function starting with that string. When two tests are specified and only one is committed, the gate still passes. The gate pattern should have been more specific, OR the spec should have used `creates:` to require both function names exist before the gate runs.

## Consequence

Partial delivery shipped as merged (PR #11). The `UpdatePermissions` code path (re-apply / diff of ACL) lacks live acceptance coverage. Tracked as a follow-up WI.

## Mitigation

Operator confirmed: the SetPermissions path works live. The gap is coverage, not functionality. Acceptable to ship with follow-up tracked.

## Prevention

For acceptance test WIs that require N named functions, either:
1. Gate as `-run TestAccX_SetPermissions$` AND `-run TestAccX_UpdatePermissions$` (exact match with `$` anchor), or
2. Use `creates:` enforcement per-function-name, or
3. Add a `grep` pre-check: `grep -q "func TestAccReleaseDefinitionPermissions_UpdatePermissions" <file>`.

## Sources

- `_logs/2026-06-06T05-30-11_INIT-2026-06-05-release-definition-permissions/events.jsonl` (gate.pass WI=WI-4 iter=1 at 05:52:22; WI-4 spec required both tests)
- `/home/parso/forge/brain/cycles/_raw/2026-06-06T05-30-11_INIT-2026-06-05-release-definition-permissions.md`
