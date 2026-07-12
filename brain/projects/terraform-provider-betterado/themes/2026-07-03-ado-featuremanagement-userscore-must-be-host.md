---
title: ADO FeatureManagement SDK — UserScope must be "host" not scope name
description: SetFeatureStateForScope / GetFeatureStateForScope require UserScope "host" (org-wide) or "me" (current user) as a routing discriminator, NOT the scope name ("project"). Passing the scope name produces invalid REST URLs rejected by ADO.
category: pattern
keywords: [featuremanagement, userscope, scopename, setfeaturestateforscope, host, rest-url, contributedfeature]
related_themes: [ado-api-shapes-index]
created_at: 2026-07-03
updated_at: 2026-07-03
---

## Problem

The ADO `featuremanagement` SDK methods `SetFeatureStateForScope` and `GetFeatureStateForScope` have two distinct scope parameters that are easy to conflate:

- **`UserScope`** — route discriminator. Must be `"host"` (org/host-wide feature store) or `"me"` (current user). This is used in the REST URL path as `FeatureStates/{UserScope}/...`.
- **`ScopeName`** — the named scope level: `"project"`, `"user"`, etc.
- **`ScopeValue`** — the scope ID (e.g. project GUID).

Passing `ScopeName` (e.g. `"project"`) as `UserScope` produces an invalid REST URL like `FeatureStates/project/project/{projectId}/...` — ADO rejects this with a userId validation error.

## Correct pattern

```go
// Always hardcode UserScope as "host" for org-scoped feature management.
// Never pass the ScopeName value here.
client.SetFeatureStateForScope(ctx, featuremanagement.SetFeatureStateForScopeArgs{
    Feature: &featuremanagement.ContributedFeatureState{
        FeatureId: &featureId,
        State:     &state,
        Scope: &featuremanagement.ContributedFeatureSettingScope{
            ScopeName:  &scopeName,  // "project"
            ScopeValue: &scopeValue, // project GUID
            UserScope:  userScopePtr("host"), // ALWAYS "host" for project-scoped features
        },
    },
    ContributionId: &featureId,
    UserScope:      "host",     // ← routing parameter — NOT scope_name
    ScopeName:      scopeName,  // "project"
    ScopeValue:     scopeValue, // project GUID
})
```

## Evidence

WI-3 PM spec incorrectly described `userScope: scope_name`. WI-4 agent re-derived the correct value from SDK source (`vendor/github.com/microsoft/azure-devops-go-api/azuredevops/v7/featuremanagement/client.go`) and fixed 5 call sites across `resource_feature_flag_framework.go` and `resource_feature_flag_test.go`. Live acceptance test (`TestAccFeatureFlag_basic`) confirmed correct behaviour.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-new-api-featuremanagement/events.jsonl` — WI-4 iteration 2 summary (line 739–742)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-new-api-featuremanagement.md`
