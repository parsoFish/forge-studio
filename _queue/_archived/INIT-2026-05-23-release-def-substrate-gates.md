---
initiative_id: INIT-2026-05-23-release-def-substrate-gates
project: terraform-provider-betterado
project_repo_path: /home/parso/forge/projects/terraform-provider-betterado
created_at: '2026-05-23T11:19:10.000Z'
iteration_budget: 15
cost_budget_usd: 1.5
phase: pending
origin: architect
worktree_path: /home/parso/forge/_worktrees/INIT-2026-05-23-release-def-substrate-gates
retry_count: 1
previous_failure_modes:
  - dev-loop-WI-4-WI-5-no-files-written
features:
  - feature_id: FEAT-1
    title: gomock test substrate for resource_release_definition
    depends_on: []
  - feature_id: FEAT-2
    title: pre_deployment_gates schema + expand/flatten + tests
    depends_on:
      - FEAT-1
  - feature_id: FEAT-3
    title: post_deployment_gates schema + expand/flatten + tests
    depends_on:
      - FEAT-2
  - feature_id: FEAT-4
    title: docs + example for release_definition (incl. both gate blocks)
    depends_on:
      - FEAT-2
      - FEAT-3
---

# release_definition — test substrate + deployment gates

## Context

The fork's `azuredevops/internal/service/release/resource_release_definition.go`
exists and is registered as `azuredevops_release_definition` (inherited
from upstream) but ships with **zero unit tests** in the betterado tree.
INIT-01 closes that gap and extends the schema with the two deployment-gate
blocks the upstream provider doesn't expose (`pre_deployment_gates` /
`post_deployment_gates`).

This is the **substrate** initiative for the release-pipelines surface —
INIT-02 through INIT-04 all gate on a green test substrate here.

## Council constraints (binding) — see brain

Per [council-constraints](brain/projects/terraform-provider-betterado/themes/council-constraints.md):
**5-test pattern** (expand/flatten roundtrip + create-error + read-404 +
update-args + delete-error), **quality gate** is
`go test ./azuredevops/internal/service/release/...` + `go build -mod=vendor ./...`,
**docs** template under `docs/resources/` + runnable `examples/<name>/`
(never `website/`), **fixtures** inline <20 lines else `testdata/*.json`,
**additive-and-atomic** (absent config = prior behaviour; quality-gate
failure marks initiative BLOCKED), **PM scope-guard** keeps work-items
within `azuredevops/internal/service/release/` (no scans of `vendor/`
or `website/`).

## Gap analysis — see brain

Per [release-substrate-context](brain/projects/terraform-provider-betterado/themes/release-substrate-context.md):
release_definition is one of three substrate initiatives (01 here, 03
task_group, 04 test plan core) — closing the substrate unblocks the 17
dependent initiatives. `resource_release_definition.go` exists +
registered + zero tests; this initiative adds substrate + gates.

## Features

### FEAT-1 — gomock test substrate

Add `azuredevops/internal/service/release/resource_release_definition_test.go`
with the council's five-test pattern. Uses gomock against
`azdosdkmocks/release_sdk_mock.go` (read-only). Pattern mirrors upstream
`resource_environment_test.go`.

**Acceptance criteria:**

1. **Given** a valid release-definition config, **when** expand-then-flatten
   the SDK type, **then** the round-trip preserves all schema fields.
2. **Given** the Azure DevOps client returning an error on Create,
   **when** the resource Create() runs, **then** Terraform surfaces the
   error and state is empty.
3. **Given** the client returning a 404 on Read, **when** Read() runs,
   **then** state is cleared (no panic, no error).
4. **Given** a valid Update, **when** Update() runs, **then** the client's
   Update SDK method was called with the expected args.
5. **Given** the client returning an error on Delete, **when** Delete()
   runs, **then** Terraform surfaces the error and state is preserved.

### FEAT-2 — pre_deployment_gates schema

Extend `resource_release_definition.go` with a `pre_deployment_gates`
schema block (nested set), implement expand/flatten roundtrip, and extend
the FEAT-1 substrate with two new gate-specific test cases.

**Acceptance criteria:**

1. **Given** a config carrying `pre_deployment_gates`, **when** flatten()
   reads the SDK type, **then** the schema's roundtrip is byte-identical.
2. **Given** a config WITHOUT `pre_deployment_gates`, **when** Read()
   runs, **then** the absent block reproduces upstream behaviour exactly
   (additive contract).

### FEAT-3 — post_deployment_gates schema

Mirror FEAT-2 for the post-deployment side. Strictly additive on top of
FEAT-2 (no mutation of FEAT-2 surface). Same expand/flatten + 2 test
cases as FEAT-2.

**Acceptance criteria:**

1. **Given** a config carrying `post_deployment_gates`, **when**
   flatten() reads the SDK type, **then** the schema's roundtrip is
   byte-identical.
2. **Given** a config carrying BOTH `pre_deployment_gates` and
   `post_deployment_gates`, **when** the resource is created, **then**
   the SDK call's args carry both gate blocks in the order Terraform
   surfaces them.

### FEAT-4 — docs + example

Write `docs/resources/release_definition.md` per the council-constraints
docs template (description + basic + complex example + argument &
attribute reference + import). Write `examples/release_definition/main.tf`
+ `examples/release_definition/README.md` showing both gate blocks in a
runnable example.

Edit `docs/resources/` + `examples/` ONLY. Do NOT touch `website/`.

**Acceptance criteria:**

1. **Given** the new docs file, **when** rendered by Terraform's docs
   tooling (or grepped for required sections), **then** all four
   council-constraint sections are present (description, examples,
   arguments/attributes, import).
2. **Given** the new example dir, **when** `terraform init` is run in
   it (no apply), **then** the config validates against the betterado
   provider build.

## Aggregate cost — informational

Iteration budget: 15. No explicit $-ceiling (per C19). Demo shape:
harness (go-test output before vs after). The demo is the verification.
