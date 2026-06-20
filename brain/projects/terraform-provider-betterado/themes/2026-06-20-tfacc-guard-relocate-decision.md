---
title: TF_ACC guard — RELOCATE decision (DEC-7); keep as safety interlock, review/unifier is the only TF_ACC=1 context
description: The TF_ACC skip guard on SharedReleaseFixture and the acceptance_gate requires_env list are permanent safety interlocks — never remove them. TF_ACC=1 is set only in the forge review/unifier phase and the operator's live shell. The CI gate always strips TF_ACC. This prevents false-pass (dogfood 2026-06-06/07) and avoids stray live resource creation.
category: decision
created_at: 2026-06-20
updated_at: 2026-06-20
---

# TF_ACC guard — RELOCATE decision (DEC-7)

## Decision

The `TF_ACC` skip guard (in `SharedReleaseFixture` + `shared_fixtures.go`) and
the `acceptance_gate.requires_env` list in `.forge/project.json` are **permanent
safety interlocks**. They must never be removed.

**RELOCATE means:**
- `TF_ACC=1` is set ONLY in the forge **review / unifier** phase (and the
  operator live shell). Never in the offline CI gate.
- `ci_gate_unset_env: ["TF_ACC"]` in `.forge/project.json` strips TF_ACC before
  the CI delivery gate runs, so `make test` always exercises the creds-free path
  that mirrors GitHub CI.
- `acceptance_gate.required: false` — advisory. The PM adds a live-acc WI only
  when the initiative ships or changes live ADO behaviour.
- `acceptance_gate.requires_env: ["TF_ACC", "AZDO_ORG_SERVICE_URL",
  "AZDO_PERSONAL_ACCESS_TOKEN"]` — errors the dev-loop fast when a WI targets
  the acceptance suite but the env is missing any of the three, instead of
  silently false-passing with a skip.

## Why the guard exists

Two concrete incidents drove this:

1. **2026-06-06/07 false-pass (daemon cycles without TF_ACC).** The daemon ran
   INIT-3/4 cycles against the release folder resource. TF_ACC was unset; `go
   test` printed `ok` (acc tests skip). The dev-loop logged gate.pass. The cycle
   merged a resource that was never live-verified. The two-gate model + the
   requires_env guard were added to prevent recurrence.

2. **ADO org 1000-project cap (996 soft-deleted, 2026-06-20).** The org has only
   4 active projects but hits the 1000-project cap because 996 soft-deleted
   test-acc-* projects remain in the recycle bin (28-day retention). A stray
   `go test ./...` that runs project-creating acceptance tests without TF_ACC
   protection would not only waste live ADO quota but — if TF_ACC were set
   unintentionally — would add to the recycle-bin pile. The guard is the durable
   fix; changing tests to reuse `betterado-standing-demo` is the complementary
   fix (see [[2026-06-20-ado-org-project-limit-blocks-test-creates]]).

## Two-gate model (standing ACs)

Every work item in this project gets two injected acceptance criteria:

1. **Live acceptance** (TF_ACC=1): `terraform apply` → read-back assertions →
   mandatory idempotency re-plan (`ExpectNonEmptyPlan: false`) → clean destroy.
   Scoped to the specific `TestAcc*` name. NEVER `go test ./...`.
2. **CI-equivalent** (offline): `make test` + `golangci-lint run
   --new-from-rev=main ./azuredevops/...` + `make terrafmt-check`. Fast,
   deterministic, creds-free. Mirrors GitHub golint.yml.

Neither gate alone is sufficient: (1) catches live-only failures the offline
suite is blind to; (2) is what GitHub CI actually runs and prevents merging code
that lint/format/unit-test failures would catch without needing live creds.

## Sweeper safety

`make sweep` soft-deletes active test projects → moves them INTO the recycle bin
→ still counted toward the 1000-project cap → counterproductive. Never reap
`betterado-standing-demo` (allowlisted in `sweeper_test.go`). Use sweep only to
clean up after killed/timed-out live runs, understanding it cannot lower the cap.

## Sources

- `projects/terraform-provider-betterado/AGENT.md` (DEC-7 section)
- `.forge/project.json` (acceptance_gate + ci_gate_unset_env)
- `azuredevops/internal/acceptancetests/shared_fixtures.go` (SharedReleaseFixture
  guard at line 79)
- Brain theme `2026-06-20-ado-org-project-limit-blocks-test-creates`
- Brain theme `2026-06-16-acceptance-test-fixture-discipline`
