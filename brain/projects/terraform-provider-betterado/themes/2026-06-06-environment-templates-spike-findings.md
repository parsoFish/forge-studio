---
title: Environment templates spike — vsrm raw-HTTP viable; full blueprint requirement makes build heavy
description: GET /environmenttemplates via raw-HTTP on vsrm.dev.azure.com returns 200; create requires a full ReleaseDefinitionEnvironment blueprint (heaviest provider type); initiative parked.
category: reference
created_at: 2026-06-06T00:00:00.000Z
updated_at: 2026-06-06T00:00:00.000Z
---

## Findings

### API reachability

- Vendored `microsoft/azure-devops-go-api` v7 `release.Client` has **no** `environmenttemplates` methods.
- Struct `ReleaseDefinitionEnvironmentTemplate` exists at `vendor/.../release/models.go:2090` but not surfaced in the generated client.
- Raw-HTTP path via `azuredevops.Connection.GetClientByUrl()` + `client.Client.Send()` **is viable**: GET to `vsrm.dev.azure.com` returns HTTP 200.
- Location ID: `6b3ad47a-2a42-4e24-9785-e3a0a8e3e64d`

### Why the build was parked

Creating a template requires a full `ReleaseDefinitionEnvironment` blueprint:

- Deploy phases (`deployPhases[]`)
- Retention policy
- Approval gates

This is the provider's **heaviest nested type** (`resource_release_definition.go` ~1618 LOC to model it). None of this was modeled at the time of the spike. Build scope exceeded the initiative's assumption; operator applied the manifest's pre-authorized exit: "spike-parked-with-reason is a valid done state".

### What was scaffolded (unmerged branch, PR #12)

- `azuredevops/utils/sdk/environmenttemplates/client.go` — `Client` interface + `ClientImpl` (raw-HTTP, Get/Save/Delete/List).
- `azuredevops/utils/sdk/environmenttemplates/models.go` — type-aliases + arg structs.
- `azuredevops/internal/service/release/resource_release_definition_environment_template.go` — resource stub (Create/Read/Delete schema).
- Unit tests (Flatten/Expand) + acceptance test scaffold.
- Provider + client registrations.

### Future path

If this resource is revisited: the raw-HTTP client pattern is proven. The blocker is modeling `ReleaseDefinitionEnvironment` as a create-time input schema — feasible only after the full release definition schema is mature. Fold into an integration-test-project initiative that already needs the full environment type.

## Sources

- `_logs/2026-06-06T06-11-08_INIT-2026-06-05-environment-templates-spike/events.jsonl` (WI-1 last_assistant_text: spike verdict)
- `/home/parso/forge/brain/cycles/_raw/2026-06-06T06-11-08_INIT-2026-06-05-environment-templates-spike.md`
