# Antipattern index

> Category index. Lists the theme pages in this knowledge base with `category: antipattern`.

## Theme pages

### Auto-linked (re-file under a curated heading when convenient)

- [`sharp-edges`](./themes/sharp-edges.md) — Red tests, retiring artefacts still in tree, bootstrap Docker dep, spec.repository pattern
- [`2026-10-10-failing-test-audit-must-be-exhaustive`](./themes/2026-10-10-failing-test-audit-must-be-exhaustive.md) — Initial WI scope driven by architect's partial "known list" missed 13+ test files, causing 3 send-backs; fix is a full pytest scan before PM emits WIs.
- [`2026-10-10-docs-cleanup-must-accompany-artefact-deletion`](./themes/2026-10-10-docs-cleanup-must-accompany-artefact-deletion.md) — docs/demo-guide.md was not in any initial WI scope; caught by adversarial review in rounds 1 and 2 (two consecutive send-backs), requiring WI-8 to fully fix.
- [`2026-10-10-verbatim-legal-text-needs-url-anchor`](./themes/2026-10-10-verbatim-legal-text-needs-url-anchor.md) — CLA.md AC said "standard form" — agent wrote a restructured "based on" paraphrase; adversarial review caught it; WI-8 replaced with verbatim text.
- [`2026-10-11-plan-engine-all-three-state-branches-required`](./themes/2026-10-11-plan-engine-all-three-state-branches-required.md) — First implementation of plan.py missed the delete branch for snapshot-only resources; gate failed 8× before the gap was diagnosed and fixed.
- [`2026-10-11-acceptance-tests-require-live-credentials`](./themes/2026-10-11-acceptance-tests-require-live-credentials.md) — Post-merge red on `gw apply (live)` was not an idempotency bug — CI workflow missing `FORGE_RESOURCE_PREFIX`; acceptance tests passed in WI-15's gate (547 passed including 5 acceptance tests against dave-parso).
- [`2026-10-12-forge-resource-prefix-missing-in-ci-workflow`](./themes/2026-10-12-forge-resource-prefix-missing-in-ci-workflow.md) — CI workflow never sets FORGE_RESOURCE_PREFIX; `gw apply (live)` fails without it; "Apply Configuration" job also red from pre-I2 stubbed script. Both I3 first items.
