---
source_type: cycle
source_url: _logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-release-folder-permissions/events.jsonl
source_title: Cycle 2026-07-01T08-39-27 — Initiative INIT-2026-07-01-migrate-framework-release-folder-permissions
cycle_id: 2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-release-folder-permissions
initiative_id: INIT-2026-07-01-migrate-framework-release-folder-permissions
project: terraform-provider-betterado
ingested_at: 2026-07-01T22:00:00.000Z
ingested_by: reflector
retention: load-bearing
cited_by:
  - brain/cycles/themes/2026-07-01-pm-must-embed-framework-migration-gotchas-as-acs.md
---

## Summary

Migrated `betterado_release_folder` and `betterado_release_definition_permissions` resources, plus all 5 release data-sources (`betterado_release_definition`, `_history`, `_revision`, `betterado_release_definitions`, `betterado_release_folder`), from SDKv2 to terraform-plugin-framework. Established first-ever `DataSources()` framework registration in `framework_provider.go`.

**4 WIs, 3 dev-loop runs, 32 commits, 30 files, 2354 insertions, 206 deletions. PR #43 opened. Version bumped to 1.2.0.**

### Key incidents

- **Run 1 killed by GitHub 403 after WI-1 (5 iterations, budget exhausted).** Root cause: SDKv2 deregister omitted → `Duplicate resource type: betterado_release_folder` on every live-acc run. brainReads:0 meant profile.md clause #1 (mandatory deregister checklist) was never consulted.
- **Run 2 resolved WI-1 in 3 iter** (nil-Meta fix: `getDirectClient()` in test helpers), WI-2 in 2 iter (permission value case: `"Allow"` → `"allow"`), WI-3 in 2 iter (1000-project cap: use `SharedReleaseFixture`), WI-4 in 1 iter.
- **Run 3 re-confirmed WI-2/3/4 as already-complete**, WI-2 iter 1 gate.pass (cached).
- **brainReads:0 across ALL ralph sessions** — every gotcha re-derived from scratch despite being in profile.md.
- **Unifier** completed in 1 iteration. `forge demo capture`/`render` failed (missing `skills/project-manager/SKILL.md`); fell back to hand-authored DEMO.md.
- **Cost ceiling warn** fired at WI-2 completion: $25.5 vs $25 ceiling (102%). Initiative continued to PR.

### Event log

Full event log: `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-release-folder-permissions/events.jsonl`
