---
source_type: cycle
source_url: _logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-servicehook/events.jsonl
source_title: Cycle 2026-07-01T08-39-27 — Initiative INIT-2026-07-01-migrate-framework-servicehook
cycle_id: 2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-servicehook
initiative_id: INIT-2026-07-01-migrate-framework-servicehook
project: terraform-provider-betterado
ingested_at: 2026-07-03T11:00:00.000Z
ingested_by: reflector
retention: load-bearing
cited_by:
  - brain/projects/terraform-provider-betterado/themes/2026-07-01-dead-sdkv2-publisher-funcs-block-ci-gate-twice.md
---

## Summary

Migrate `betterado_servicehook_storage_queue_pipelines` and `betterado_servicehook_webhook_tfs` from SDKv2 to terraform-plugin-framework. Also produce `docs/servicehook-gap-matrix.md` for both resources.

**Outcome:** Merged as release v1.7.0. 155 files changed (+9214/−2813 vs main), 33 commits. All 6 WIs `complete`.

**Total cost:** ~$22.29 ($1.25 PM × 3 runs, $8.87 dev-loop, $11.95 unifier × 4 passes, $0.22 release).

### Phases

| Phase | Runs | Notes |
|---|---|---|
| PM | 3 | Run 1: hidden-coupling rejection (provider files shared across WIs). Run 2: `error_max_turns` reading `framework.go` (7 retries, zero WIs emitted). Run 3: succeeded, 6 WIs, no violations. |
| Developer-loop | 1 | WI-1–3: 1 gate iteration each. WI-4: 3 iterations (null→empty string inconsistency). WI-5: 2 iterations (same). WI-6: 1 iteration. |
| Unifier | 4 passes | UWI-2 (pass 1), UWI-4 (passes 1–3). Large UWI-4 pass 2 cost ($6.47) suggests validator-parity + dead-file remediation. |
| Reviewer | 0 | No reviewer phase — PR awaited operator merge. |

### Key patterns identified

1. **Multi-resource PM coupling trap** — any initiative migrating 2+ resources will have the deregistration WIs share `provider.go`/`framework_provider.go`. The PM's hidden-coupling checker fires unless registration edits are batched into a single WI.
2. **`framework.go` read failure** — PM run 2 exhausted its turn budget trying to read a large file via `Read` + 7 Bash retries. No Grep fallback was attempted.
3. **Null→empty-string state inconsistency** — two resources (WI-4, WI-5) needed extra iterations to flatten attributes that returned empty strings from the API but were stored as null in state.
4. **Unifier overload** — 4 passes at $11.95 total (exceeds dev-loop). Indicates checklist items not enforced at WI gate were deferred to the unifier.

### Event log

Full event log: `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-servicehook/events.jsonl` (2,139 events)
