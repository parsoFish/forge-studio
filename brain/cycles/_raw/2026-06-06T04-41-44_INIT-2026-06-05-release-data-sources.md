---
source_type: cycle
source_url: _logs/2026-06-06T04-41-44_INIT-2026-06-05-release-data-sources/events.jsonl
source_title: Cycle 2026-06-06T04-41-44 — Initiative INIT-2026-06-05-release-data-sources
cycle_id: 2026-06-06T04-41-44_INIT-2026-06-05-release-data-sources
initiative_id: INIT-2026-06-05-release-data-sources
project: terraform-provider-betterado
ingested_at: 2026-06-06T05:10:00Z
ingested_by: reflector
retention: load-bearing
cited_by:
  - projects/terraform-provider-betterado/brain/themes/2026-06-06-acceptance-test-compile-only-gate.md
  - projects/terraform-provider-betterado/brain/themes/2026-06-06-data-source-split-read-only-pattern.md
  - projects/terraform-provider-betterado/brain/themes/2026-06-06-docs-only-wi-gate-mismatch.md
---

# Cycle: INIT-2026-06-05-release-data-sources

## Summary

Added two read-only Terraform data sources for ADO classic release pipelines:
`data.betterado_release_definition` (lookup by id or name) and
`data.betterado_release_definitions` (list with optional path filter).

**Outcome:** `pr-open`. 16 files changed, 1489 insertions, 0 deletions. 5 WIs, all complete, 1 iteration each.

**Total cost:** $12.90 (exceeds $10 budget). Breakdown:
- PM: $1.98
- WI-1 (data_release_definition impl + unit tests): $1.21
- WI-2 (data_release_definitions impl + unit tests): $0.49
- WI-3 (provider.go registration + provider_test.go): $0.33
- WI-4 (docs + examples): $0.56
- WI-5 (acceptance tests): $0.55
- Dev-loop aggregate: $3.14
- Unifier: $0.75

**Duration:** 20m 9s (04:41:44 → 05:01:54)

**Baseline green:** yes — offline unit suite passed before iteration start.

## WI shape

| WI | Scope | Iterations | Cost | Gate pattern |
|---|---|---|---|---|
| WI-1 | data_release_definition.go + unit test | 1 | $1.21 | iter-0 expected-fail (no-work-indicator); iter-1 gate.pass |
| WI-2 | data_release_definitions.go + unit test | 1 | $0.49 | iter-0 expected-fail; iter-1 gate.pass |
| WI-3 | provider.go + provider_test.go | 1 | $0.33 | iter-0 expected-fail; iter-1 gate.pass (2×) |
| WI-4 | docs + examples (4 files) | 1 | $0.56 | iter-0 required-paths-missing; iter-1 gate.pass |
| WI-5 | acceptance test file | 1 | $0.55 | iter-0 expected-fail; iter-1 gate.pass |

## Notable observations

1. **Gate-tightening effective.** All 5 WIs had a correct `gate.expected-fail` at iter-0 — the tightened gate correctly rejected "nothing ran yet" before the agent had written any code. No false-pass at iter-0.

2. **WI-4 used wrong quality gate.** WI-4 targets docs + examples (no Go code). Its `quality_gate_cmd` runs `go test -run TestDataReleaseDefinition|TestDataReleaseDefinitions ./azuredevops/internal/service/release/` — tests from WI-1/WI-2, not in WI-4's `files_in_scope`. Gate fires `required-paths-missing` at iter-0 because `creates:` lists doc files not yet created. Iter-1 creates the docs and the gate passes (tests still green). Functional — but the gate is verifying WI-1/WI-2 work, not WI-4 work.

3. **PM cost $1.98 dominates small WIs.** PM emitted 5 well-structured WIs with quality gates. But at $1.98 the PM is ~15% of total cycle cost for an initiative that is straightforward. For a 5-WI initiative where each WI takes 1 iteration, PM cost is higher than 2 of the 5 WIs combined.

4. **Acceptance test WI correctly used non-TF_ACC gate.** WI-5 wrote the acceptance test *file* only (no live run). Gate was `go test ... -run TestAccDataReleaseDefinition|TestAccDataReleaseDefinitions ./azuredevops/internal/acceptancetests/` — this compiles and registers the test functions without running them live (no `TF_ACC=1`). Correct split: write-and-compile in dev-loop, run live only pre-merge.

5. **Cost exceeded $10 budget.** Total $12.90 vs $10 budget. Primary driver: PM at $1.98 + WI-1 at $1.21. Both reasonable for their scope; the budget was slightly underestimated for a 5-WI initiative with PM cost included.

## Event log reference

- `EV_mq1vdyjw_cq50t9pt` — WI-1 iter-0 expected-fail (no-work-indicator)
- `EV_mq1vs931_bqgoj5ov` — WI-5 gate.pass iter-1
- `EV_mq1vsao2_bisk87ar` — dev-loop.end (5/5 complete, cost $3.14)
- `EV_mq1vybqu_kaaftfq0` — dev-loop.delivered (16 files, 1489 ins, 0 del, 9 commits)
- `EV_mq1vyx01_6t0a7b28` — cycle.end (status: pr-open)
