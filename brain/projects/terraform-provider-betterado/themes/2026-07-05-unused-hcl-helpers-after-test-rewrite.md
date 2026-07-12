---
title: Unused HCL helper functions after acceptance-test rewrite
description: When acceptance tests are rewritten to use the import path instead of create path, the original HCL helper functions (e.g. hclTeamBasic) become unreachable; golangci-lint unused check blocks CI gate at the end.
category: antipattern
keywords: [unused-func, golangci-lint, hcl-helper, acceptance-test-rewrite, ci-gate, dead-code]
related_themes: [build-tooling-index]
created_at: 2026-07-05
updated_at: 2026-07-05
---

# Unused HCL helper functions after acceptance-test rewrite

## Context

During the core framework migration, `betterado_project` acceptance tests were rewritten to use `terraform import` against the standing-demo project (org is at 1000-project cap, cannot create). The original `hclProjectPipelineSettings`, `hclTeamBasic`, `hclTeamDataSourceBasic`, `hclTeamsDataSourceBasic` HCL builder functions were left in the test files but no longer called. Similarly for `betterado_team`-family tests.

## Failure

The golangci-lint `unused` check flagged all four at the CI delivery gate:

```
azuredevops/internal/acceptancetests/data_team_test.go:79:6: func hclTeamDataSourceBasic is unused (unused)
azuredevops/internal/acceptancetests/data_teams_test.go:73:6: func hclTeamsDataSourceBasic is unused (unused)
azuredevops/internal/acceptancetests/resource_project_pipeline_settings_test.go:98:6: func hclProjectPipelineSettings is unused (unused)
azuredevops/internal/acceptancetests/resource_team_test.go:202:6: func hclTeamBasic is unused (unused)
```

The CI gate blocked. A `ci-fix-committed` event fired (auto-formatter ran), but the linter cannot auto-delete unused functions — manual fix needed.

## Rule

When rewriting an acceptance test to use a different HCL shape (e.g. import-path replacing create-path), delete the now-unused `hcl*` builder functions in the same commit. If they might be needed for future create-path coverage, comment them out or add a `_ = hclFoo` sentinel — do not leave them dead.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-core/events.jsonl` — `ci-gate-failed` event at 2026-07-03T22:49:21 and 2026-07-04T00:49:36
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-core.md`
