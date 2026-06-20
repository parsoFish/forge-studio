# Architect plan — 2026-06-06T08-49-27

- Project: `terraform-provider-betterado`
- Repo: `/home/parso/forge/projects/terraform-provider-betterado`

> **Operator review.** This plan is presented on the `/architect/2026-06-06T08-49-27` screen in the forge UI. Read each section there, resolve the council's design decisions, and click **approve**, **revise**, or **reject** — the runner finalizes your verdict, promoting the manifests to the queue only on approve.

## Operator brief + interview

Build a shared, reusable, creds-gated live acceptance fixture for the betterado provider's release-definition tests. This fixture provisions a coherent set of wired-together ADO objects (project, identities, variable group, repo, build, and one canonical multi-stage release-definition valid against ADO REST API 7.1) and is consumed by acceptance tests instead of each test hand-rolling its own minimal inline definition. Proof: refactor at least one existing test (e.g. `TestAccReleaseDefinition_basic`) to consume the fixture and pass live (real apply → API round-trip assert → clean destroy), demonstrating the fixture catches ADO-validity bugs (VS402877/VS402982/permission-key drift) that fragmented inline definitions let hide.

### Interview

_No interview rounds — operator drafted directly._

## Brain context

- `brain/cycles/themes/spec-driven-work-items.md` — consulted during architect draft
- `brain/cycles/themes/spec-driven-development.md` — consulted during architect draft
- `brain/cycles/themes/tdd-with-agents.md` — consulted during architect draft
- `brain/cycles/themes/real-capability-harness.md` — consulted during architect draft
- `brain/cycles/themes/quality-gate-cmd-must-assert-new-work.md` — consulted during architect draft
- `projects/terraform-provider-betterado/brain/profile.md` — consulted during architect draft
- `projects/terraform-provider-betterado/brain/themes/2026-05-31-forge-onboarding-findings.md` — consulted during architect draft
- `projects/terraform-provider-betterado/brain/themes/2026-05-31-release-definition-unit-test-substrate.md` — consulted during architect draft
- `brain/cycles/themes/dependency-ordered-work.md` — consulted during architect draft
- `brain/cycles/themes/design-is-the-bottleneck.md` — consulted during architect draft
- `projects/terraform-provider-betterado/brain/themes/2026-05-18-stack-and-test-layout.md` — consulted during architect draft

## Council transcript

Total cost: `$0.5546`

### CEO critic

Cost: `$0.1797`

- _no mechanical flags_

- _no taste escalations_

### Eng critic

Cost: `$0.0822`

- _no mechanical flags_

- _no taste escalations_

### Design critic

Cost: `$0.1521`

- _no mechanical flags_

- _no taste escalations_

### DX critic

Cost: `$0.1406`

- _no mechanical flags_

- _no taste escalations_

## Proposed initiatives

| ID | Title | Iteration budget | Depends on |
|---|---|---|---|
| `INIT-2026-06-06-shared-acceptance-fixture` | Shared live acceptance fixture for betterado release-definition tests | 8 | — |

### INIT-2026-06-06-shared-acceptance-fixture — drawer

```markdown
## Context

Today every acceptance test in `azuredevops/internal/acceptancetests/` hand-rolls its own minimal release definition inline. This fragmentation let a cluster of real ADO-validity bugs hide until each test was finally run live with `TF_ACC=1`: VS402877 (current ADO requires BOTH pre- AND post-deploy approvals per stage), VS402982 (every stage needs a `retention_policy`), and an invalid permission key (`EditReleaseStage` vs the real `EditReleaseEnvironment`). A single canonical fixture, valid against current Azure DevOps REST API 7.1 and reused across tests, would have caught all of these in one place.

## What to build

One reusable, creds-gated live fixture in the existing acceptance-test helper layer (`azuredevops/internal/acceptancetests/` + its `testutils` patterns) that provisions/looks up a coherent set of wired-together ADO objects:

- A project
- A couple of real group/user identities (for approvals)
- A variable group
- A Git repo
- A build definition
- A **canonical multi-stage release definition** whose every stage is valid against current ADO (pre+post approvals AND a `retention_policy`)

New-resource acceptance tests reference this shared fixture instead of re-declaring a minimal release definition inline.

## Acceptance criteria

**Given** the shared fixture is implemented in `azuredevops/internal/acceptancetests/shared_fixtures.go` (or similar helper)
**When** a developer runs `TF_ACC=1 go test ./azuredevops/internal/service/release/... -run TestAccReleaseDefinition_basic`
**Then** the test:
- Provisions a real ADO project + identities + variable group + repo + build + release-definition via the fixture helper
- Applies the Terraform config against the live fixture objects
- Asserts the API round-trip (reads back the created release-definition and verifies its structure)
- Cleans up all provisioned objects (no orphaned cloud resources)
- Passes end-to-end with green output

**Given** the fixture is valid against ADO REST API 7.1
**When** examining the canonical release-definition returned by the fixture
**Then** it includes:
- At least one stage with BOTH `pre_deploy_approval` (with a real approver identity) AND `post_deploy_approval`
- Every stage has a `retention_policy` block
- All permission/approval keys match current ADO API schema (e.g. `EditReleaseEnvironment`, not the stale `EditReleaseStage`)

**Given** at least one existing acceptance test is refactored to consume the fixture
**When** `TestAccReleaseDefinition_basic` (or another high-value test) is updated to use the shared fixture
**Then**:
- The test's HCL no longer hand-rolls a minimal release-definition inline
- Instead it references the canonical fixture objects (project ID, repo ID, build-definition ID, etc.)
- The test passes live (`TF_ACC=1`) with the same apply → API-roundtrip-assert → destroy discipline

## Hard constraints

- **Creds-gated + self-cleaning** (C7 live-acceptance discipline): fixture only runs when `TF_ACC=1` + `AZDO_ORG_SERVICE_URL` + `AZDO_PERSONAL_ACCESS_TOKEN` are set; must destroy all provisioned objects on teardown; no orphaned cloud resources.
- **Go Terraform provider project** (`github.com/parsoFish/terraform-provider-betterado`): implement under `azuredevops/internal/acceptancetests/...`; do NOT create release-notes markdown or touch the forge repo.
- **Do NOT modify the parked `environment_templates` resource yet** — this fixture is the groundwork that will later give it a real environment to template from.
- **Stay faithful to upstream patterns** (`testutils.HclXxx` helpers, existing fixture conventions in `acceptancetests/`).

## Out of scope (v1)

- Refactoring ALL acceptance tests to use the fixture (v1 bounds to at least ONE refactored test as proof).
- Live CI integration (fixture runs locally with operator-supplied creds; CI remains offline unit-only).
- Data-source acceptance tests (focus v1 on resource tests only).

## Success signals

- The canonical fixture stands up real ADO objects end-to-end (confirmed via live apply → API round-trip).
- At least one existing acceptance test (`TestAccReleaseDefinition_basic` or similar) is refactored to consume the fixture and passes live.
- No ADO-validity errors (VS402877, VS402982, invalid permission keys) when run against current Azure DevOps.
- Clean teardown: no orphaned projects/repos/releases in the ADO org after test run.
```

## Aggregate footprint (informational)

_This block surfaces the **informational** footprint of the proposed initiatives — how many cycles + dollars they would consume if every one were queued today. It is informational only; forge does not enforce a budget or block at any number._

- Initiatives proposed: **1**
- Total iteration budget: **8**

---

_Generated by the architect runner on 2026-06-06T08:54:12.198Z. Reviewed + approved on the `/architect` screen in the forge UI._
