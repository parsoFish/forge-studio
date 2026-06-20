---
source_type: cycle
source_url: _logs/2026-06-20T04-10-33_INIT-2026-06-19-framework-state-upgraders/events.jsonl
source_title: Cycle 2026-06-20T04-10-33 — Initiative INIT-2026-06-19-framework-state-upgraders
cycle_id: 2026-06-20T04-10-33_INIT-2026-06-19-framework-state-upgraders
initiative_id: INIT-2026-06-19-framework-state-upgraders
project: terraform-provider-betterado
ingested_at: 2026-06-20T05:20:00.000Z
ingested_by: reflector
retention: load-bearing
cited_by:
  - projects/terraform-provider-betterado/forge/brain/themes/2026-06-20-ado-org-project-limit-blocks-test-creates.md
  - projects/terraform-provider-betterado/forge/brain/themes/2026-06-20-framework-state-upgrader-v0-pattern.md
  - projects/terraform-provider-betterado/forge/brain/themes/2026-06-20-unifier-demo-path-worktree-vs-root.md
---

# Cycle 2026-06-20T04-10-33 — framework-state-upgraders

## Summary

Initiative: add `StateVersion: 1` + V0→V1 StateUpgrader wiring to `betterado_task_group` and `betterado_release_definition` framework resources, with unit tests and a live TF_ACC smoke test capturing ADO evidence.

**Outcome:** PR #31 opened — https://github.com/parsoFish/terraform-provider-betterado/pull/31. 15 files changed, 1544 insertions, 5 deletions, 11 commits. CI gate (make test + golangci-lint + terrafmt-check) passed.

**5 WIs delivered:**
- WI-1: StateUpgrader wiring + state_upgrade_v0.go for release definition
- WI-2: unit tests for release definition upgrader
- WI-3: StateUpgrader wiring + state_upgrade_v0.go for task group
- WI-4: unit tests for task group upgrader
- WI-5: live TF_ACC smoke test `TestAccTaskGroupStateUpgradeSmoke` (2 iterations; worked around 1000-project org limit)

**Total cycle cost: ~$9.7.** WI-5 alone ~$5.59 (57%) — ADO org-capacity wall required Ralph to research `GetProjects(stateFilter=wellFormed)` API and rewrite the project resolution strategy.

**Notable events:**
- `gate.expected-fail` on WI-5 iteration 0 (gate-tightening caught no-tests-yet condition correctly)
- `gate.fail` on WI-5 iteration 1 (ADO 1000-project org limit)
- `gate.pass` on WI-5 iteration 2 (test passes in 5.51s using existing project via `data "betterado_project"`)
- Unifier iteration 1 put DEMO.md at `forge/history/.../demo/DEMO.md` not `demo/.../DEMO.md`; reviewer rejected; cycle resumed; second reviewer pass succeeded with DEMO.md in correct location
- PM ran twice (two restarts at 04:10:33 and 04:12:09); second PM produced the 5 WIs

## Event log reference

Full event log: `_logs/2026-06-20T04-10-33_INIT-2026-06-19-framework-state-upgraders/events.jsonl` (1014+ events)
Retro: `_logs/2026-06-20T04-10-33_INIT-2026-06-19-framework-state-upgraders/retro.md`
