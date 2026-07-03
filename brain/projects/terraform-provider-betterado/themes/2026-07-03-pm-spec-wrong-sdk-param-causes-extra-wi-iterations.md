---
title: PM WI spec with wrong ADO SDK parameter value forces extra ralph iterations
description: When a PM work-item specifies an ADO SDK parameter value without verifying the SDK source, the dev-loop agent must spend 1-2 extra iterations re-deriving the correct value from vendor source. Seen with UserScope in the FeatureManagement WI-3/WI-4 pair.
category: antipattern
created_at: 2026-07-03
updated_at: 2026-07-03
---

## What happened

WI-3 spec (authored by PM) described the CRUD logic as:

> `SetFeatureStateForScope` called with `userScope: scope_name` (pass scope_name as UserScope)

The ADO SDK's `UserScope` parameter is a routing discriminator that must be `"host"` or `"me"` — NOT the scope name string ("project"). The PM had not read the SDK client code before writing the spec.

WI-4 (the live-acceptance-test WI) caught this: the agent ran the acceptance test, got an ADO userId validation error, traced the error to the SDK, read `vendor/github.com/microsoft/azure-devops-go-api/azuredevops/v7/featuremanagement/client.go`, derived the correct value, and fixed 5 call sites across the resource and test files. This was iteration 2 of WI-4 (3 total instead of the expected 1).

## Root cause

PM read the ADO REST documentation surface but not the Go SDK wrapper. The Go wrapper adds `UserScope` as a separate routing argument that has no obvious equivalent in the raw REST docs.

## Prevention

- PM SKILL for betterado: when writing WIs that call featuremanagement SDK methods, read `vendor/github.com/microsoft/azure-devops-go-api/azuredevops/v7/featuremanagement/client.go` before writing parameter descriptions.
- Or: encode the correct values in a project brain theme (see `2026-07-03-ado-featuremanagement-userscore-must-be-host.md`) and instruct the PM to brain-query before writing featuremanagement WIs.

## Cost

WI-4 ran 3 iterations instead of ~1. Extra cost: ~$1–1.5.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-new-api-featuremanagement/events.jsonl` — PM `pm.work-item-emitted` WI-3 (event line 43), WI-4 ralph.end iteration count (event line 744)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-new-api-featuremanagement.md`
