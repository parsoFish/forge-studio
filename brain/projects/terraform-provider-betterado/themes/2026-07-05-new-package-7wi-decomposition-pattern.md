---
title: New framework resource package — 7-WI single-responsibility decomposition pattern
description: Gap-matrix → client-wiring → resource → data-source → provider-registration → acceptance-test → changelog decomposition for a brand-new API package; every WI passed first iteration.
category: pattern
created_at: 2026-07-05
updated_at: 2026-07-05
---

## Pattern

For a brand-new ADO API surface with no prior code in the repo, decompose into these 7 ordered WIs:

1. **Gap matrix** — `docs/<api>-gap-matrix.md`; hollow gate (test verifies file exists).
2. **Client wiring** — add `<Api>Client` field to `AggregatedClient`, wire via `<Api>.NewClient`. Gate: `TestXxxClient` unit test in `./azuredevops/internal/client/`.
3. **Resource implementation** — `service/<api>/resource_<name>_framework.go` + unit test. Gate: `TestXxxResource` unit tests.
4. **Data source implementation** — `service/<api>/data_<name>_framework.go` + unit test. Gate: `TestXxxDataSource` unit tests.
5. **Provider registration** — add to `framework_provider.go` `Resources()` / `DataSources()`; update provider test counts. Gate: `TestFrameworkProvider_HasXxxResources`.
6. **Acceptance test stub** — `acceptancetests/resource_<name>_framework_test.go` with `TestAccXxx` that skips cleanly without TF_ACC. Gate: hollow (SKIP exit-0 = pass).
7. **Changelog + docs** — `CHANGELOG.md ## [Unreleased]` entry, `docs/resources/` page, version bump. Gate: `TestChangelog_HasXxxEntry`.

## Evidence

pipelinesapproval initiative (INIT-2026-07-01-new-api-pipelinesapproval): 7 WIs, 7 complete, all in exactly 1 iteration each. Zero gate failures. Total dev-loop cost: $19.65. Framework-native only; no SDKv2 registration.

## Notes

- WI-3 and WI-4 depend on WI-2 (client); WI-5 depends on WI-3 and WI-4; WI-6 depends on WI-5; WI-7 depends on WI-5 and WI-1. This dependency order is load-bearing.
- WI-1 (gap matrix) can run in parallel with WI-2 (client wiring) — they have no shared dependency.
- The `quality_gate_cmd` for each WI MUST target only the new package (not full `./azuredevops/...`) to avoid `[no test files]` false-pass on the broader suite.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-new-api-pipelinesapproval/events.jsonl` — WI-1 through WI-7 ralph.end events
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-new-api-pipelinesapproval.md`
