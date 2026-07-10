---
source_type: cycle
source_url: _logs/2026-06-06T06-11-08_INIT-2026-06-05-environment-templates-spike/events.jsonl
source_title: Cycle 2026-06-06T06-11-08 — Initiative INIT-2026-06-05-environment-templates-spike
cycle_id: 2026-06-06T06-11-08_INIT-2026-06-05-environment-templates-spike
initiative_id: INIT-2026-06-05-environment-templates-spike
project: terraform-provider-betterado
ingested_at: 2026-07-10T09:40:50.894Z
ingested_by: reflector
retention: interesting
cited_by:
  - brain/projects/terraform-provider-betterado/themes/2026-06-06-environment-templates-spike-findings.md
  - brain/projects/terraform-provider-betterado/themes/2026-06-06-spike-parked-valid-closure.md
---

## Summary

Spike initiative to determine whether `betterado_release_definition_environment_template` is buildable using the vendored Azure DevOps Go SDK v7 or a raw-HTTP path.

**Outcome: PARKED** (operator decision, 2026-06-06).

### What ran

- 3 WIs, all completed in 1 iteration each.
- Wall-clock: ~24 min (06:11 → 06:35 UTC).
- `dev-loop.delivered`: 16 files, 1312 insertions, 0 deletions, 7 commits.
- PR #12 opened: https://github.com/parsoFish/terraform-provider-betterado/pull/12
- No wedge events. No rate limits. No recovery/resume.

### Spike verdict (WI-1)

Vendored `release.Client` has **no** `environmenttemplates` methods. Struct `ReleaseDefinitionEnvironmentTemplate` exists at `vendor/.../release/models.go:2090` but was never surfaced in the generated client.

Raw-HTTP path **is viable**: GET via `azuredevops.Connection.GetClientByUrl()` + `client.Client.Send()` to `vsrm.dev.azure.com` returns HTTP 200. Confirmed in `azuredevops/utils/sdk/environmenttemplates/client.go` (same pattern as `securityroles`).

### Why parked

Creating a template requires a full `ReleaseDefinitionEnvironment` blueprint — deploy phases, retention policy, approval gates — the provider's heaviest type, never modeled. Build scope far exceeded the initiative's assumption. Operator applied the manifest's pre-authorized "spike-parked-with-reason is a valid done state" directive. Build folded into a proposed full integration-test-project initiative.

### What was built (landed on branch, not merged)

- `azuredevops/utils/sdk/environmenttemplates/models.go` — type-aliases + arg structs for all four operations.
- `azuredevops/utils/sdk/environmenttemplates/client.go` — `Client` interface + `ClientImpl` (raw-HTTP).
- `azuredevops/internal/service/release/resource_release_definition_environment_template.go` — resource stub (Create/Read/Delete, no Update).
- `azuredevops/internal/service/release/resource_release_definition_environment_template_test.go` — Flatten/Expand unit tests.
- `azuredevops/internal/acceptancetests/resource_release_definition_environment_template_test.go` — acceptance test scaffold.
- Provider and client registrations.
- Docs + example HCL.

### Gate pattern

- WI-1: offline unit test (`TestReleaseDefinitionEnvironmentTemplateSpike`) — 1 iter.
- WI-2: offline unit tests (`TestReleaseDefinitionEnvironmentTemplate_`) — 1 iter.
- WI-3: compile-only acceptance test (`TestAccReleaseDefinitionEnvironmentTemplate`, no `TF_ACC`) — 1 iter.

### Forge observations

- All 3 ralph sessions: `brainReads: 0` (known antipattern).
- PM: 11 `pm.brain-query` events (all same timestamp, empty metadata) — exceeds ≤3 cap.
- WI-1 and WI-2: AGENT.md/fix_plan.md scratch committed on branch in chore commits.
