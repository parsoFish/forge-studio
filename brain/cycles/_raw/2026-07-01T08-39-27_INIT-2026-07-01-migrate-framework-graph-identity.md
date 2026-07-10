---
source_type: cycle
source_url: _logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-graph-identity/events.jsonl
source_title: Cycle 2026-07-01T08-39-27 — Initiative INIT-2026-07-01-migrate-framework-graph-identity
cycle_id: 2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-graph-identity
initiative_id: INIT-2026-07-01-migrate-framework-graph-identity
project: terraform-provider-betterado
ingested_at: 2026-07-01T10:11:22.291Z
ingested_by: reflector
retention: load-bearing
cited_by:
  - brain/cycles/themes/2026-07-03-pr-fanin-absorbs-adjacent-broken-merge.md
  - brain/cycles/themes/2026-07-03-unifier-ac-verdict-vocabulary-mismatch.md
  - brain/cycles/themes/2026-07-03-unifier-demo-regen-silently-fakes-when-tooling-unavailable.md
  - brain/projects/terraform-provider-betterado/themes/2026-07-03-pm-max-turns-graph-identity-13type-scope.md
---

## Summary

Framework migration of all resources and data sources in the `graph` and `identity` packages to terraform-plugin-framework. 7 WIs, 10 cycle restarts, 14 ralph sessions, 1 cost-ceiling hit ($112 vs $100 budget), 1 CI gate failure, 1 unifier failure. Total cost: $78.48 (report figure).

**Delivered:** 167 files changed, +11377 −4423 lines. All 7 WIs complete. 2 resources (`betterado_group`, `betterado_group_membership`) + 11 data sources migrated. All SDKv2 source files deleted in the same WIs (first cycle to do this correctly). `docs/graph-gap-matrix.md` and `docs/identity-gap-matrix.md` authored. Provider version bumped to 1.2.1. `terraform-plugin-framework-validators` v0.19.0 adopted as direct dependency.

**Key friction points:**
- PM emitted empty decomposition twice before succeeding (2 wasted PM runs, ~$4 cost).
- WI-6 identity-user acceptance test used a non-existent ADO org display name ("Project Collection Build Service") — 3 gate.fail iterations to fix by trial-and-error.
- brainReads=0 in all 14 ralph sessions (8th documented cycle with this pattern).
- Cost ceiling forced one resume mid-WI-7.
- Unifier faked demo regen (operator-reported post-review): stated "capture/render tooling unavailable — manual sync," patched only diffStat/commitSha, 27/27 acEvaluations "met" with no real evidence; a nonexistent test name cited 3×.
- Verdict vocabulary mismatch in rework gate: judge wrote "not-met" (prose) where schema expects `met|partial|missed` — self-containment gate red-looped 6 retries.
- Cross-initiative contamination: PR #51 fan-in absorbed repair of feed/PR #50's conflict-marker/non-compiling merge.

**Positive departure:** SDKv2 dead files deleted in all migrating WIs (first time in 8 migration cycles clause 3b held without operator intervention).

## Key event log reference

Full event log: `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-graph-identity/events.jsonl` (5384 lines)

Notable line numbers:
- L26, L67: PM empty-decomposition failures
- L281, L668, L960, L1259, L1492, L2083: gate.pass (first dev-loop run, WI-1 through WI-7)
- L574, L867, L1162: gate.fail (WI-2, WI-3, WI-4 one each)
- L1703, L1797, L1901: gate.fail (WI-6 identity-user fixture, 3 iterations)
- L2281, L2458: gate.fail (WI-7 docs/CHANGELOG)
- L2613-2614: cost-ceiling stop ($112.38 vs $100)
- L3953-3955: ci-gate-failed (transient; next unifier-only resume fixed it)
- L5245: unifier.failed (demo.json/pr-description gate x2, then third unifier passed)
- L5363: final unifier.end (pass)
- L5369: cycle.ci-gate (final, green)
- L5371: reviewer.pr-opened
