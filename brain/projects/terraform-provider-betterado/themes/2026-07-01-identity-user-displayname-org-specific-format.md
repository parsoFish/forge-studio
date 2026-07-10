---
title: Identity user display name is org-specific — "Project Collection Build Service" doesn't exist
description: ADO identity lookup with DisplayName filter requires the org-specific format "{ProjectName} Build Service ({OrgName})" — the generic "Project Collection Build Service" name is not resolvable in this org.
category: antipattern
created_at: 2026-07-01T10:11:22.291Z
updated_at: 2026-07-01T10:11:22.291Z
---

## Problem

WI-6 acceptance test for `betterado_identity_user` used `"Project Collection Build Service"` as the `name` argument (DisplayName filter). The `validateIdentityUser` function performs a `strings.Contains` match against the display name — but this exact string does not exist in the betterado ADO org.

Gate failure messages (3 iterations, L1703, L1797, L1901):
```
Could not find user with name: Project Collection Build Service, with filter: DisplayName
Could not find user with name: betterado-standing-demo Build Service (davidgparsonson), with filter: DisplayName
Could not find user with name: Project Collection Build Service (davidgparsonson), with filter: DisplayName
```

## Root cause

The build-service user in this org resolves as `"{ProjectName} Build Service ({OrgName})"`. The correct format for the standing fixture project is:

```
betterado-standing-demo Build Service (davidgparsonson)
```

The test requires the full composite name (not just "Project Collection Build Service") because `validateIdentityUser` with `DisplayName` filter does a contains-match, but there's still an exact-enough requirement on the full org-scoped name.

## Fix applied

WI-6 ralph fixed the HCL test fixture to use `"${var.project_name} Build Service (${var.org_name})"` style composition, resolving the name dynamically from Terraform vars or hardcoding the standing fixture name. Took 3 gate.fail iterations to converge.

## Standing rule for acceptance tests

When writing `betterado_identity_user` acceptance tests: never use `"Project Collection Build Service"` as the display name. Use the composite format: `"{SharedFixtureProjectName} Build Service ({OrgName})"` where OrgName is the ADO org name (e.g. `davidgparsonson`).

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-graph-identity/events.jsonl` — gate.fail events at L1703, L1797, L1901 with error messages
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-graph-identity.md`
