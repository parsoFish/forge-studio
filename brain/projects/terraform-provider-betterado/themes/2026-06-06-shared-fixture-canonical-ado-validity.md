---
title: Shared fixture enforces canonical ADO API validity
description: Per-test hand-rolled minimal HCL fragments hide API validity bugs; a shared fixture locks in the valid structure once and exposes VS402877, VS402982, and permission key constraints provider-wide.
category: pattern
created_at: '2026-06-06T09:41:00Z'
updated_at: '2026-07-10T09:46:00Z'
---

## Pattern

Per-test hand-rolled HCL fragments pass `go vet` and compile but silently hide API validity bugs:
- VS402877: release definition MUST have pre+post approvals on each stage
- VS402982: each stage MUST have a `retention_policy`
- `EditReleaseEnvironment`: permission key must be exact-case or the API silently ignores it

`SharedReleaseFixture(t *testing.T)` in `azuredevops/internal/acceptancetests/shared_fixtures.go` provisions a full ADO object graph (project → Git repo → build definition → variable group → 2-stage release definition) with all constraints enforced, and tears it all down via `t.Cleanup`. A test that uses `SharedReleaseFixture` cannot accidentally misconfigure these invariants.

## Scope

Any ADO resource with structural complexity that the API enforces at create-time (not just at read-back) should have a canonical shared fixture BEFORE building a suite of tests. The fixture is also a living coverage map: gaps (deployment-group phase, per-user approvers, tags persistence) remain visible as `// TODO` annotations in the fixture rather than hidden in individual test HCL strings.

## Post-merge evolution

The v1 fixture used `IsAutomated: true` + zero UUID for approvals — satisfies VS402877 structurally but auto-approves with no real gate. Operator flagged this as under-delivery. Fixed in commits `a1a4c20e` + `8f30353d`: real project-group identity via `IdentityClient.ListGroups`, `IsAutomated: false`. Subsequently extended with pre/post deployment gates, agent + agentless jobs, 2nd variable group, CD + scheduled triggers — non-default everything with read-back assertions on every option.

## Sources

- `_logs/2026-06-06T09-32-34_INIT-2026-06-06-shared-acceptance-fixture/events.jsonl` (EV_mq25q8m9_10kf7p0v: `dev-loop.delivered`; EV_mq25nkcw_y5aogyja: acceptance gate pass)
- `/home/parso/forge/brain/cycles/_raw/2026-06-06T09-32-34_INIT-2026-06-06-shared-acceptance-fixture.md`
- `projects/terraform-provider-betterado/azuredevops/internal/acceptancetests/shared_fixtures.go`
