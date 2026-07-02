---
title: Framework permissions resource — ACL values must be lowercase in HCL config
description: betterado_release_definition_permissions framework resource stores plan values verbatim (no post-Create Read); HCL test config must use lowercase "allow"/"deny"/"notset" matching PermissionTypeValues constants or TestCheckResourceAttr assertions fail.
category: pattern
created_at: 2026-07-01T00:00:00.000Z
updated_at: 2026-07-01T00:00:00.000Z
---

## Pattern

`betterado_release_definition_permissions` in the framework implementation stores plan values directly in state during Create (no post-Create Read call). `GetPrincipalPermissions` returns lowercase decoded values (`"allow"`, `"deny"`, `"notset"`) matching `PermissionTypeValues` constants.

**Wrong (Title-case, as initially written in acceptance test):**
```hcl
permissions = {
  ViewReleases = "Allow"
  EditRelease  = "Deny"
}
```

`TestCheckResourceAttr` assertions for `permissions.ViewReleases` → `"allow"` fail: `expected "allow", got "Allow"`.

**Correct (lowercase, matching PermissionTypeValues):**
```hcl
permissions = {
  ViewReleases = "allow"
  EditRelease  = "deny"
}
```

With lowercase config, Create stores `"allow"` → Read returns `"allow"` → plan diff is zero → `ExpectNonEmptyPlan: false` satisfied.

## Standing rule

Any acceptance test HCL for `betterado_release_definition_permissions` (or any framework permissions resource using the shared `permissionTypeValuesType`) MUST use lowercase permission values.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-release-folder-permissions/events.jsonl` (lines 1455-1461: WI-2 iteration 2, case-fix + gate.pass)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-release-folder-permissions.md`
