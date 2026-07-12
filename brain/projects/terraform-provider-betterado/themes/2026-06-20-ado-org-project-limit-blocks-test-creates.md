---
title: ADO org 1000-project limit blocks live acceptance test creates — it's the SOFT-DELETE recycle bin, not active projects
description: 'The davidgparsonson org hits the 1000-project cap with only 4 ACTIVE projects — 996 SOFT-DELETED projects (stateFilter=deleted, 28-day retention) count toward the cap but are hidden from the portal/normal API. ADO has no purge API; `make sweep` soft-deletes (feeds the bin) so it''s counterproductive. Durable fix: tests must REUSE an existing project (data "betterado_project" / GetProjects), never create.'
category: antipattern
keywords: [1000-project-limit, soft-delete, recycle-bin, statefilter-deleted, reuse-project, never-create-projects]
related_themes: [fixture-discipline-index]
created_at: 2026-06-20
updated_at: 2026-06-20
---

# ADO org 1000-project limit blocks live acceptance test creates

## Real root cause (verified 2026-06-20)

The org shows **4 active projects** (portal + `GET _apis/projects`, even
`stateFilter=all`). But project creates fail with "already has 1000 projects."
The hidden cause: **`GET _apis/projects?stateFilter=deleted` returns 996** —
soft-deleted projects. ADO soft-deletes a project on delete and retains it ~28
days; **soft-deleted projects count toward the 1000-project org cap** but are NOT
shown by the portal or the default/`all` list API. 4 active + 996 soft-deleted =
1000. 992 of the 996 are named `test-acc-*` (acc-test fixture leaks); none are
real projects.

Consequences:
- **`make sweep` is counterproductive** for the quota — it *soft-deletes* active
  test projects, moving them INTO the recycle bin (still counted), never reducing
  the count. After it clears the active `test-acc-*`, it deletes 0 while the cap
  stays pinned.
- **No public purge API.** `_apis/projects/recycleBin` → 404; nothing in the
  azure-devops-go SDK. Soft-deleted projects auto-purge only after the 28-day
  retention. (Per-day soft-delete spread on 2026-06-20: oldest 2026-05-30 →
  purges ~06-27; the bulk from 06-17/06-18/06-20 won't drain until ~mid-July.)
- The error's advice ("delete unused projects") is a trap here — deleting
  soft-deletes, which keeps counting.

Remediation: wait for auto-purge, request a manual recycle-bin purge from MS
support, OR (durable) stop creating projects in tests — see the standing rule
below. A full acc-suite run that creates a project per fixture adds dozens of
soft-deletes per run and accelerates exhaustion.

## What happened

WI-5 (`TestAccTaskGroupStateUpgradeSmoke`) initially used `resource "betterado_project" "smoke"` in the TF HCL fixture. First live run returned:

```
Error: creating project: Failed to add a project as this organization already has 1000 projects.
Please delete unused projects to reduce total project count to under 1000 or switch to another organization.
```

Both the TF resource and a direct `QueueCreateProject` REST call reproduce this. The ADO org `davidgparsonson` is at capacity.

## Fix applied

Rewrote `smokeResolveProject()` to call `CoreClient.GetProjects(ctx, core.GetProjectsArgs{StateFilter: &projectStateValues.WellFormed, Top: &one})` — returns the first wellFormed project name. HCL fixture changed to `data "betterado_project" "smoke"` referencing that name. Test passed in 5.51s on first attempt.

## Standing rule

Any live acceptance test in this project that needs a project context MUST use `data "betterado_project"` (existing project) or resolve via `GetProjects`. NEVER create a project in TF_ACC tests against this org.

## The shared project (2026-06-20)

`betterado-standing-demo` is now the single shared project for BOTH the standing
demo and live acceptance tests. `SharedReleaseFixture` resolves it (const
`SharedFixtureProjectName`); the task_group tests reference it via
`data "betterado_project" { name = SharedFixtureProjectName }`. It is reused, never
deleted, and allowlisted in the sweeper's `keepProjects`. This lets live acceptance
run **immediately** despite the org sitting at the cap (no project creation needed)
and stops the recycle-bin leak going forward. Per-run sub-resources (repo, build
def, var groups, release def, task group, WIQ) use unique `test-acc-*` names + are
torn down; they never touch the standing-demo's own resources. `TestAccTaskGroup_basic`
+ `_withGapFields` pass green live against it; `TestAccReleaseDefinition_basic`
reaches live but is RED on [[2026-06-20-release-definition-revision-idempotency]].

## Sources

- `_logs/2026-06-20T04-10-33_INIT-2026-06-19-framework-state-upgraders/events.jsonl` (EV_mqlvggs7_v5gozlly gate.fail, EV_mqlvrcxv_37u4bcjs gate.pass)
- `brain/cycles/_raw/2026-06-20T04-10-33_INIT-2026-06-19-framework-state-upgraders.md`
