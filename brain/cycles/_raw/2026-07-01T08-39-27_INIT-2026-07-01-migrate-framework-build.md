---
source_type: cycle
source_url: _logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-build/events.jsonl
source_title: Cycle 2026-07-01T08-39-27 — Initiative INIT-2026-07-01-migrate-framework-build
cycle_id: 2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-build
initiative_id: INIT-2026-07-01-migrate-framework-build
project: terraform-provider-betterado
ingested_at: 2026-07-03T03:00:00.000Z
ingested_by: reflector
retention: load-bearing
cited_by:
  - brain/cycles/themes/2026-07-03-pm-max-turns-exhaustion-before-wi-emission.md
  - brain/projects/terraform-provider-betterado/themes/2026-07-03-build-package-sdkv2-dead-files-not-deleted.md
  - brain/projects/terraform-provider-betterado/themes/2026-07-03-inline-plan-modifier-pattern-re-derived-per-wi.md
---

## Summary

**Initiative:** Migrate all resources/data-sources in the `build` package to terraform-plugin-framework; produce `docs/build-gap-matrix.md`.

**Resources in scope:** `betterado_build_definition` (resource + data), `betterado_build_folder`, `betterado_pipeline_authorization`, `betterado_resource_authorization`.

**Outcome:** PR #49 opened. CI gate green (make test + golangci-lint + terrafmt-check, 0 issues). 44 files changed, +5089/-590, 21 commits.

### Phase summary

| Phase | Result | Cost |
|---|---|---|
| Architect (out-of-cycle) | Complete | $0 (pre-cycle) |
| PM run 1 | Failed — `error_max_turns`, 0 WIs emitted | $1.45 |
| PM run 2 | Success — 5 WIs | $1.87 |
| Dev-loop run 1 (WI-1…5) | 5/5 complete, 1 iter each | $15.16 |
| Dev-loop run 2 (WI-5 verify) | 0 new files — WIs already done | $2.26 |
| Unifier | 0 UWIs pending — branch pushed immediately | ~$0 |
| Review | PR #49 opened | — |
| **Total** | **~$20.7** | |

### WI delivery (authoritative `dev-loop.delivered`)

- WI-1: 2 files, +275 — `docs/build-gap-matrix.md` + `gap_matrix_test.go`
- WI-2: 8 files, +623/-33 — `resource_build_folder_framework.go`, acceptance test
- WI-3: 5 files, +888 — `resource_build_definition_framework.go`, schema test
- WI-4: 8 files, +1163/-4 — `resource_pipeline_authorization_framework.go` + `resource_resource_authorization_framework.go`
- WI-5: 18 files, +1091/-463 — `datasource_build_definition_framework.go`, examples, docs, CHANGELOG

### Key findings

1. **`brainReads=0` in every ralph session** — third framework-migration cycle in a row; all known gotchas re-derived from source files.
2. **PM max_turns exhaustion** — run 1 failed after using all turns exploring the manifest/worktree without writing WIs.
3. **Old SDKv2 files not deleted** — `profile.md` clause 3b skipped for all 5 WIs (third cycle with same omission).
4. **Latent duplicate-resource-type bug fixed** — `betterado_build_definition` still in SDKv2 `ResourcesMap` after framework migration; caught and fixed by WI-5.
5. **Inline plan-modifier pattern re-derived per WI** — `stringplanmodifier`/`int64planmodifier` sub-packages not vendored; re-discovered each time despite being in AGENT.md from WI-2 onward.

### Event log reference

Full event log: `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-build/events.jsonl` (~3135 events, 1.9 MB).

Key event IDs:
- PM run 1 failure: `EV_mr2m17zw_6fnxfyb3` (`pm.empty-decomposition`, `error_max_turns`)
- Dev-loop run 1 end: `EV_mr39tps3_j3359jy3` (5/5 complete, $15.16)
- Authoritative delivery: `EV_mr4bvc6l_s7hirx09` (44 files, +5089/-590)
- PR opened: `EV_mr4bvl1p_rrux3sfu` (PR #49)
