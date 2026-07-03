---
source_type: cycle
source_url: _logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-member-entitlement/events.jsonl
source_title: Cycle 2026-07-01T08-39-27 — Initiative INIT-2026-07-01-migrate-framework-member-entitlement
cycle_id: 2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-member-entitlement
initiative_id: INIT-2026-07-01-migrate-framework-member-entitlement
project: terraform-provider-betterado
ingested_at: 2026-07-03T05:00:00.000Z
ingested_by: reflector
retention: load-bearing
cited_by:
  - brain/cycles/themes/2026-07-03-pm-max-turns-manifest-read-cascade.md
  - brain/projects/terraform-provider-betterado/themes/2026-07-03-framework-config-validator-pattern-re-derived.md
  - brain/projects/terraform-provider-betterado/themes/2026-07-03-sdkv2-dead-files-omission-4th-cycle.md
---

## Summary

Migrated `betterado_user_entitlement`, `betterado_group_entitlement`, and `betterado_service_principal_entitlement` from SDKv2 to terraform-plugin-framework. Produced `docs/memberentitlementmanagement-gap-matrix.md`. PR #53 merged.

**Total cost:** ~$48.34 (dev-loop $29.97, unifier $14.93, PM $3.22).
**WIs:** 5/5 complete, 1 iteration each.
**Final delivery:** 74 files changed, +3630 / -3289 (includes SDKv2 dead-file deletion by unifier UWI-2).

### Key events

- **4 PM runs required** before valid WI graph: run 1 hit `error_max_turns`; run 2 SIGKILL (code 143); run 3 produced WIs but was rejected by hidden-coupling validator (WI-2/3/4 edited `framework_provider.go`/`provider.go`/`provider_test.go` with no dep edges); run 4 succeeded after operator added decomposition note to manifest.
- **Dev-loop ran cleanly**: WI-1 (gap matrix, brainReads=0), WI-2 (user_entitlement, brainReads=0), WI-3 (group_entitlement, brainReads=0), WI-4 (service_principal_entitlement, brainReads=0), WI-5 (docs/cleanup, brainReads=0).
- **SDKv2 dead files not deleted** (4th consecutive migration cycle): WI-2/3/4 created `*_framework.go` files but left SDKv2 `.go` files intact. Unifier run UWI-2 deleted them.
- **`go build ./...` run 2x during WI-3** (forbidden by profile.md).
- **Vendor config-validator re-explored by unifier** (UWI-2, ~8 bash calls) — same class as the build-cycle inline plan-modifier re-derivation antipattern.

### Ref

Full event log: `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-member-entitlement/events.jsonl` (1623 events).
