<!-- verdict: approve | revise | reject -->

# Architect plan — 2026-06-01T08-01-28

- Project: `terraform-provider-betterado`
- Repo: `/home/parso/forge/projects/terraform-provider-betterado`
- Initiative type: `implementation`

> **Operator review.** This plan is presented on the `/architect/2026-06-01T08-01-28` screen in the forge UI. Read each section there, resolve the council's design decisions, and click **approve**, **revise**, or **reject** — the runner finalizes your verdict, promoting the manifests to the queue only on approve.

## Operator brief + interview

Fix CI pipeline (formatting/lint failures on stale branch) to unblock PR merges, then systematically complete the ADO Release API coverage as four independent initiatives: (1) complete the release_definition resource substrate with unit tests, (2) add release_folder resource, (3) add environment_template resource, and (4) add release data sources. Finally, refresh acceptance tests with stage retention_policy and pre_deploy_approval to pass live ADO 7.1+ validation.

### Interview

| # | Question | Operator answer |
|---|---|---|
| 1 | The CI failures are formatting/lint issues (gofmt, golint, terrafmt) on a stale branch. Should I scope the CI fix as a separate quick initiative, or bundle it into the release work? | Separate CI-fix initiative, run FIRST to unblock PRs (CI first). Everything else depends on it. |
| 2 | The release API coverage has 4 proposed features: (1) release_definition substrate completion, (2) release_folder resource, (3) environment_template resource, (4) data sources. How should we scope the initiatives? | One initiative per feature — 4 separate, independently-releasable initiatives (north-star model). Order them by real build dependency (data sources depend on the release_definition resource they read). |
| 3 | The acceptance tests need live ADO creds and the HCL is stale (VS402982/VS402877 errors). Should acceptance test refresh be in scope or deferred? | Include acceptance refresh — add stage retention_policy + pre_deploy_approval so acceptance tests pass live. It depends on the resources being built first. |

## Brain context

_No brain entries consulted (brain-gap event emitted)._

## Council transcript

Total cost: `$4.3868`

### Flags (auto-applied)

- `initiative2-redundant` — Initiative 2 (release_definition substrate verification) duplicates Initiative 1's quality gate ('make test' already runs all unit tests including release_definition). No unique verification value.. _Applied:_ Recommend merging Initiative 2 into Initiative 1 as a single deliverable: 'Fix CI and verify release_definition substrate'. The combined AC remains: all unit tests pass (which includes the 11 release_definition tests).
- `initiative1-scope-clarity` — Initiative 1 lists 'Fix any remaining manual lint issues' but doesn't define 'manual'. Scope could creep into refactoring.. _Applied:_ Tighten scope: 'Fix any remaining lint issues that cannot be auto-fixed (e.g., unused variables, unreachable code) by removing dead code or adding _ assignments. Do not refactor working logic.'
- `initiative6-credential-assumption` — Initiative 6 assumes live ADO credentials are available but doesn't list credential setup as in-scope work or a prerequisite.. _Applied:_ Add to scope: 'Assumes AZDO_ORG_SERVICE_URL and AZDO_PERSONAL_ACCESS_TOKEN are already configured (via environment or secrets.env). Credential setup is out-of-scope.'
- `initiative3-import-detail` — Initiative 3 (release_folder) mentions 'Import support via tfhelper.ImportProjectQualifiedResource()' but doesn't specify the import ID format.. _Applied:_ Add to AC2: 'Import ID format is {projectId}/{folderId}, parsed by tfhelper.ImportProjectQualifiedResource()—matching build_folder convention.'
- `initiative4-immutability-risk` — Initiative 4 (environment_template) states templates are immutable but doesn't address user experience risk: users may not expect ForceNew on description changes.. _Applied:_ Add to documentation requirement: 'Docs must clearly state that environment templates are immutable—any change to name, description, or environment triggers destroy/recreate (ADO API limitation).'
- `initiative5-name-conflict` — Initiative 5 (data sources) allows lookup by name but doesn't specify behavior when multiple definitions have the same name in different paths.. _Applied:_ Add to AC2: 'If name filter returns multiple matches, return error: "Multiple release definitions found with name X. Use definition_id for unambiguous lookup."'
- `missing-depends-on` — The initiative draft lists six initiatives in narrative order but lacks explicit depends_on metadata. Initiative 1 (CI fixes) must gate all others since they require passing CI to merge.. _Applied:_ Add explicit dependency metadata: Initiative 2-6 all have depends_on: [initiative-1-ci-fixes]. Initiative 6 (acceptance tests) has depends_on: [initiative-1-ci-fixes, initiative-2-release-definition-substrate]
- `ac-not-ci-executable` — Initiative 2 (release_definition substrate) AC1 says "all 11 tests pass" but doesn't specify which 11 tests or provide a command that can be run in CI to verify the count.. _Applied:_ Refine AC1 to include exact verification command: go test -mod=vendor -tags all -count=1 -v -run ^TestReleaseDefinition ./azuredevops/internal/service/release/ | grep -c "^--- PASS: TestReleaseDefinition" | grep -q "^11$"
- `missing-build-tag-convention` — Initiative 3 (release_folder), 4 (environment_template), and 5 (data sources) mention build tags but don't specify the full pattern. Current convention requires both positive and negative build constraints.. _Applied:_ Add build tag header to all new test files: //go:build (all || resource_release_folder) && !exclude_resource_release_folder plus legacy +build directives
- `no-rollback-acceptance-tests` — Initiative 6 modifies existing acceptance test HCL templates to add retention_policy and pre_deploy_approval. If ADO API validation changes again, there's no stated rollback strategy.. _Applied:_ Add rollback section to Initiative 6: Revert HCL template changes via git revert, re-run tests against baseline, document failing API validation errors in GitHub issue. No persistent state affected (tests create/destroy resources in isolated test projects)
- `missing-vendor-update` — Initiative 1 (CI fixes) runs golangci-lint run --fix which may add imports, but doesn't explicitly call go mod vendor before the final build step.. _Applied:_ Add to Initiative 1 scope: After running all fix commands, regenerate vendor directory with go mod tidy && go mod vendor
- `quality-gate-mismatch` — Initiative 1's quality gate runs go build -mod=vendor ./... but CI workflow unit-test.yml runs go build -v ./... (without -mod=vendor flag).. _Applied:_ Align quality gate with exact CI commands: go build -v ./... && make test (unit-test.yml), golangci-lint run -v ./azuredevops/... (golint.yml), make terrafmt-check (terrafmt.yml), make depscheck (depscheck.yml)
- `missing-gomock-pattern` — Initiative 2 AC3 mentions "gomock controller usage" but doesn't specify the canonical cleanup pattern used consistently across the codebase.. _Applied:_ Refine AC3 to verify the exact pattern: ctrl := gomock.NewController(t) followed by defer ctrl.Finish() for proper cleanup, then azdosdkmocks.NewMockReleaseClient(ctrl)
- `data-source-naming` — Initiative 5 proposes data.betterado_release_definition (singular) and data.betterado_release_definitions (plural), but the test function prefix pattern is unclear.. _Applied:_ Specify test naming convention: data_release_definition_test.go / data_release_definitions_test.go for files, TestDataReleaseDefinition_* / TestDataReleaseDefinitions_* for test function prefixes
- `missing-import-id-format` — Initiative 3 (release_folder) and 4 (environment_template) mention "import support" but don't specify the import ID format or whether it uses tfhelper.ImportProjectQualifiedResource().. _Applied:_ Add import specification: Import ID format {projectId}/{folderId}, Import function tfhelper.ImportProjectQualifiedResourceUUID(), Example: terraform import betterado_release_folder.example 00000000-0000-0000-0000-000000000000/1
- `missing-file-count` — Initiative AC claims "≤3 files where possible" but doesn't enumerate files for new resources.. _Applied:_ Add file manifest to each initiative: Initiative 3/4 have 4 new + 1 modified = 5 files (resource, test, docs, example, provider registration). Initiative 5 has 8 files (2 data sources × 4 files each). Recommend splitting Initiative 5 into 5a/5b to meet ≤3 file atomicity target
- `release-folder-naming` — Verify betterado_release_folder follows service_entity naming pattern (it does—matches build_folder, not workitemquery_folder outlier). _Applied:_ Confirmed naming is consistent with build_folder pattern. No change needed.
- `missing-docs-templates` — Only 1 of 120+ resources has documentation. New resources should follow established structure: Example Usage, Argument Reference, Attribute Reference.. _Applied:_ Ensure all new resource docs follow release_definition.md template structure with Basic/Advanced examples and schema references.
- `acceptance-test-missing-blocks` — Basic acceptance test HCL templates omit retention_policy and pre_deploy_approval, but need corresponding test assertions added too.. _Applied:_ Add resource.TestCheckResourceAttr() assertions for retention_policy and pre_deploy_approval blocks to verify round-trip correctness.
- `retention-policy-optionality` — Schema marks retention_policy as Optional+Computed, but ADO API 7.1+ requires it. Creates UX confusion when users omit it.. _Applied:_ Change retention_policy to Required OR add Default computed function with sensible defaults (30 days, 3 releases, retain_build=true) for backward compatibility.
- `error-messages-remediation` — Error messages like 'creating project: %v' lack user-actionable remediation hints for common failures (auth, required fields).. _Applied:_ Enhance error messages to detect common patterns (401→check creds, 400 with retention_policy→add required block) and append hints.
- `data-source-plural-naming` — Plural data source naming inconsistent across provider (some use _list suffix, others use plural s).. _Applied:_ Confirmed release_definitions (with s) matches existing plural pattern. No change needed.
- `missing-precommit-hooks` — No pre-commit hooks for format enforcement (gofmt, gofumpt, terrafmt, golangci-lint) - CI failures catch issues late. _Applied:_ Add .pre-commit-config.yaml with hooks for gofmt, gofumpt, terrafmt, and golangci-lint. Document setup in docs/contributing.md: 'pre-commit install'
- `no-acceptance-test-runbook` — Initiative 6 requires live ADO acceptance tests but no runbook for credentials setup, test isolation, cleanup, or cost estimation. _Applied:_ Create docs/acceptance-testing-runbook.md covering: PAT token scopes, test project isolation (AZDO_TEST_PROJECT_PREFIX), pre-flight checks, example commands, manual cleanup script (scripts/cleanup-test-projects.sh), and cost/runtime estimates
- `linter-debt-untracked` — .golangci.yml documents disabled linters (err113, errorlint, perfsprint - ~1000s instances) but no migration plan or tracking. _Applied:_ Create docs/linter-debt.md documenting each disabled linter, instance count, migration strategy (e.g., 'Fix in new code only' vs 'Plan full migration'), and status tracking via GitHub issues
- `mock-regeneration-undocumented` — Initiatives 2/3/4 reference azdosdkmocks/release_sdk_mock.go as 'generated - do not modify' but no process documented for regenerating mocks when SDK changes. _Applied:_ Add section to docs/contributing.md: 'Regenerating Mocks' with gomock installation and example commands for regenerating mocks after SDK updates
- `immutable-template-no-migration-plan` — Initiative 4 introduces immutable betterado_release_environment_template (no Update, all ForceNew) with no documented rationale or future migration path if immutability changes. _Applied:_ Add Immutability Notice section to docs/resources/release_environment_template.md explaining API immutability, ForceNew behavior, impact on referencing release definitions, and future consideration if ADO adds update support

### Escalations (taste decisions surfaced)

- (ceo) Should the release_definition substrate verification (Initiative 2) be merged into the CI fix (Initiative 1), or remain separate?
  - **Merge into CI fix (Recommended)** — Initiative 2's sole purpose is verifying existing tests pass. This is already covered by Initiative 1's AC4 ('make test' passes all unit tests). Running a subset of tests separately adds no strategic value—it's the same quality gate. Merging eliminates a phantom initiative and gets to the actual work (folders, templates, data sources) faster.
  - **Keep separate** — Treat the release_definition substrate as a distinct milestone requiring explicit sign-off before dependent work begins. Provides a clear checkpoint for stakeholders to confirm the foundation is solid before building on it.
- (ceo) Should initiatives 3–5 (folder, template, data sources) remain separate or be bundled?
  - **Keep separate (Recommended)** — Each is independently releasable and provides standalone user value. A user can deploy folders without templates, or use data sources without creating folders. Separate initiatives allow parallel work if multiple contributors are available, and each can be released as soon as it passes CI—maximizing feedback velocity.
  - **Bundle into 'Complete Release API Coverage'** — Deliver a coherent 'Release Management' feature set in one release. Users get folders + templates + data sources together, which tells a complete story. Reduces PR/review overhead from 3 initiatives to 1.
- (ceo) Is Initiative 6 (acceptance test refresh) correctly prioritized, or should it be deferred?
  - **Defer until after features ship (Recommended)** — Acceptance tests require live ADO credentials and validate end-to-end behavior. The unit tests (already passing after Initiative 1) provide sufficient CI gate for release_definition. Deferring this to a 'hardening' phase after folders/templates/data sources are shipped maximizes feature velocity now. The resource already works (unit tests prove CRUD logic); acceptance tests verify API contract stability, which is lower priority than new capabilities.
  - **Keep as-prioritized (after substrate, before new features)** — Ensure the existing release_definition resource passes live ADO validation before building dependent features. Folders and templates may reference release definitions; better to confirm the foundation works end-to-end against real API before layering on new resources.
- (eng) Initiative 1 aims to fix format/lint failures to unblock PR merges. Should it also update stale dependencies (e.g., golangci-lint config version, Go SDK minor bumps) discovered during linting, or strictly limit to formatting fixes?
  - **Fix format/lint only, defer dependency updates (Recommended)** — Minimize blast radius. Updating dependencies introduces risk of behavioral changes unrelated to CI failures. Keep Initiative 1 as a surgical fix to unblock PRs, then handle dependency updates as a separate maintenance task.
  - **Fix format/lint AND update dependencies proactively** — Since we're already touching CI, update dependencies now to prevent future CI breakage. Newer SDK versions may include bug fixes that reduce lint warnings.
- (eng) Initiative 2 verifies the existing 11 unit tests pass for release_definition substrate. Should we also generate a code coverage report to identify untested edge cases, or trust the existing characterization tests are sufficient?
  - **Run existing 11 tests, no coverage analysis (Recommended)** — The 11 tests already cover the canonical 5-test pattern plus 6 deep-nested characterization tests. Coverage reports are useful for new code, but this is a verification initiative to confirm the substrate is CI-ready, not a quality improvement initiative.
  - **Generate coverage report to identify gaps** — Since this is the substrate for all downstream release work, ensure comprehensive coverage now. A coverage report will identify any critical paths missing tests (e.g., error handling in nested expand/flatten functions).
- (eng) Initiative 4 states environment templates are immutable (no Update operation). Should we enforce this by omitting UpdateContext from the resource schema, or also add client-side validation to prevent unexpected API changes?
  - **Omit UpdateContext, mark all fields ForceNew (Recommended)** — Terraform's schema layer already enforces immutability via ForceNew: true. If a user changes any field, Terraform will destroy and recreate the resource. No need for additional client-side validation.
  - **Omit UpdateContext AND add API immutability check in Read** — Defensive programming. If the ADO API ever changes to allow updates (or if our understanding is wrong), detect it early by checking if the API returns different values than expected.
- (eng) Initiative 6 updates acceptance tests to pass against ADO API 7.1+. Should we test against only ADO 7.1 (current stable), or add matrix testing for ADO 7.0, 7.1, and 7.2 (if available)?
  - **Test against single ADO API version (7.1) (Recommended)** — The codebase uses azure-devops-go-api/azuredevops/v7 SDK which targets ADO 7.x. Testing against a single stable version (7.1) reduces complexity and matches real-world usage (most orgs pin to a specific ADO version).
  - **Test against ADO 7.0, 7.1, and 7.2 (if available)** — Increase confidence in SDK compatibility. By testing across multiple ADO versions, catch breaking changes early and document which versions are supported.
- (Design (UX)) Should betterado_release_folder accept 'path' as user input (like build_folder) or accept 'name' + auto-compute 'path' (hierarchical)?
  - **path as Required input (matches build_folder)** — Users specify full folder path (e.g., \\Parent\\Child). Matches existing build_folder behavior and ADO portal UX where users see paths.
  - **name as Required, path as Computed (hierarchical)** — Users specify name and optional parent_id to build folder trees. API computes path. More Terraform-idiomatic for hierarchical resources like workitemquery_folder.
  - **Exact build_folder clone (Recommended)** — path Required, name Computed. This is what the initiative SHOULD be—100% copy-paste of build_folder schema. The draft has it backwards (name Required, path Computed). Zero cognitive load for users familiar with build folders.
- (Design (UX)) How should the provider communicate that release_environment_template is immutable to users who expect in-place updates?
  - **Pure ForceNew (Standard Terraform UX)** — Mark all fields ForceNew: true, no custom messaging. Let Terraform's standard behavior handle it—plan shows 'must be replaced'. This is standard Terraform pattern for immutable resources.
  - **CustomizeDiff warning** — Add CustomizeDiff function to detect field changes and emit warnings explaining the ADO API immutability limitation during terraform plan. Educates users before apply.
  - **Documentation-only (Recommended)** — Use ForceNew schema attributes + prominent callout in docs explaining limitation. Add example showing lifecycle prevent_destroy block for safer updates. Standard Terraform documentation pattern.
- (dx) Should acceptance tests run in CI, and if so, how should credentials and test isolation be managed?
  - **Manual acceptance testing (current state)** — Keep acceptance tests manual-only, run by maintainers with personal PAT tokens. No CI infrastructure changes needed.
  - **Automated CI with isolated test org (Recommended)** — Create dedicated Azure DevOps org for CI tests. Store PAT token in GitHub secrets. Run acceptance tests on PR comment trigger (e.g., /test-acceptance).
  - **Contributor-provided test credentials** — Document in CONTRIBUTING.md that contributors must create their own test ADO org and PAT token. Tests run locally before submitting PR. PR template requires acceptance tests passing checkbox.
- (dx) How should the project handle scenarios where the Azure DevOps Go SDK is missing features needed for complete API coverage?
  - **Block on upstream SDK support (Recommended)** — Only implement resources where the SDK already has full support. File issues upstream for missing methods. Prioritize initiatives that are unblocked.
  - **Bypass SDK with direct HTTP** — For missing SDK methods, implement direct HTTP calls to Azure DevOps REST API using the existing HTTP client from the SDK for auth continuity.
  - **Fork SDK temporarily and contribute back** — Fork the Azure DevOps Go SDK, add missing methods, vendor the fork. Submit PRs upstream. When upstream merges, switch back to official SDK.
- (dx) What is the right balance between unit test coverage and acceptance test coverage for complex resources like release_definition?
  - **High unit coverage + smoke acceptance tests (Recommended)** — Use unit tests to exhaustively cover expand/flatten edge cases, error propagation, and data integrity. Use acceptance tests to validate happy-path integration with real ADO API.
  - **Comprehensive acceptance coverage** — Invest in detailed acceptance tests covering most schema combinations. Run in nightly CI against dedicated test org. Unit tests cover only core logic (expand/flatten helpers).
  - **Contract testing with recorded fixtures** — Record real API interactions once using a tool like go-vcr. Play back recordings in CI for fast, realistic tests without live ADO dependency. Periodically re-record against live API.

### CEO critic

Cost: `$0.3004`

**Flags (auto-resolved):**

- `initiative2-redundant` — Initiative 2 (release_definition substrate verification) duplicates Initiative 1's quality gate ('make test' already runs all unit tests including release_definition). No unique verification value.. _Applied:_ Recommend merging Initiative 2 into Initiative 1 as a single deliverable: 'Fix CI and verify release_definition substrate'. The combined AC remains: all unit tests pass (which includes the 11 release_definition tests).
- `initiative1-scope-clarity` — Initiative 1 lists 'Fix any remaining manual lint issues' but doesn't define 'manual'. Scope could creep into refactoring.. _Applied:_ Tighten scope: 'Fix any remaining lint issues that cannot be auto-fixed (e.g., unused variables, unreachable code) by removing dead code or adding _ assignments. Do not refactor working logic.'
- `initiative6-credential-assumption` — Initiative 6 assumes live ADO credentials are available but doesn't list credential setup as in-scope work or a prerequisite.. _Applied:_ Add to scope: 'Assumes AZDO_ORG_SERVICE_URL and AZDO_PERSONAL_ACCESS_TOKEN are already configured (via environment or secrets.env). Credential setup is out-of-scope.'
- `initiative3-import-detail` — Initiative 3 (release_folder) mentions 'Import support via tfhelper.ImportProjectQualifiedResource()' but doesn't specify the import ID format.. _Applied:_ Add to AC2: 'Import ID format is {projectId}/{folderId}, parsed by tfhelper.ImportProjectQualifiedResource()—matching build_folder convention.'
- `initiative4-immutability-risk` — Initiative 4 (environment_template) states templates are immutable but doesn't address user experience risk: users may not expect ForceNew on description changes.. _Applied:_ Add to documentation requirement: 'Docs must clearly state that environment templates are immutable—any change to name, description, or environment triggers destroy/recreate (ADO API limitation).'
- `initiative5-name-conflict` — Initiative 5 (data sources) allows lookup by name but doesn't specify behavior when multiple definitions have the same name in different paths.. _Applied:_ Add to AC2: 'If name filter returns multiple matches, return error: "Multiple release definitions found with name X. Use definition_id for unambiguous lookup."'

**Escalations (taste decisions):**

- Should the release_definition substrate verification (Initiative 2) be merged into the CI fix (Initiative 1), or remain separate?
  - **Merge into CI fix (Recommended)** — Initiative 2's sole purpose is verifying existing tests pass. This is already covered by Initiative 1's AC4 ('make test' passes all unit tests). Running a subset of tests separately adds no strategic value—it's the same quality gate. Merging eliminates a phantom initiative and gets to the actual work (folders, templates, data sources) faster.
  - **Keep separate** — Treat the release_definition substrate as a distinct milestone requiring explicit sign-off before dependent work begins. Provides a clear checkpoint for stakeholders to confirm the foundation is solid before building on it.
- Should initiatives 3–5 (folder, template, data sources) remain separate or be bundled?
  - **Keep separate (Recommended)** — Each is independently releasable and provides standalone user value. A user can deploy folders without templates, or use data sources without creating folders. Separate initiatives allow parallel work if multiple contributors are available, and each can be released as soon as it passes CI—maximizing feedback velocity.
  - **Bundle into 'Complete Release API Coverage'** — Deliver a coherent 'Release Management' feature set in one release. Users get folders + templates + data sources together, which tells a complete story. Reduces PR/review overhead from 3 initiatives to 1.
- Is Initiative 6 (acceptance test refresh) correctly prioritized, or should it be deferred?
  - **Defer until after features ship (Recommended)** — Acceptance tests require live ADO credentials and validate end-to-end behavior. The unit tests (already passing after Initiative 1) provide sufficient CI gate for release_definition. Deferring this to a 'hardening' phase after folders/templates/data sources are shipped maximizes feature velocity now. The resource already works (unit tests prove CRUD logic); acceptance tests verify API contract stability, which is lower priority than new capabilities.
  - **Keep as-prioritized (after substrate, before new features)** — Ensure the existing release_definition resource passes live ADO validation before building dependent features. Folders and templates may reference release definitions; better to confirm the foundation works end-to-end against real API before layering on new resources.

### Eng critic

Cost: `$0.9181`

**Flags (auto-resolved):**

- `missing-depends-on` — The initiative draft lists six initiatives in narrative order but lacks explicit depends_on metadata. Initiative 1 (CI fixes) must gate all others since they require passing CI to merge.. _Applied:_ Add explicit dependency metadata: Initiative 2-6 all have depends_on: [initiative-1-ci-fixes]. Initiative 6 (acceptance tests) has depends_on: [initiative-1-ci-fixes, initiative-2-release-definition-substrate]
- `ac-not-ci-executable` — Initiative 2 (release_definition substrate) AC1 says "all 11 tests pass" but doesn't specify which 11 tests or provide a command that can be run in CI to verify the count.. _Applied:_ Refine AC1 to include exact verification command: go test -mod=vendor -tags all -count=1 -v -run ^TestReleaseDefinition ./azuredevops/internal/service/release/ | grep -c "^--- PASS: TestReleaseDefinition" | grep -q "^11$"
- `missing-build-tag-convention` — Initiative 3 (release_folder), 4 (environment_template), and 5 (data sources) mention build tags but don't specify the full pattern. Current convention requires both positive and negative build constraints.. _Applied:_ Add build tag header to all new test files: //go:build (all || resource_release_folder) && !exclude_resource_release_folder plus legacy +build directives
- `no-rollback-acceptance-tests` — Initiative 6 modifies existing acceptance test HCL templates to add retention_policy and pre_deploy_approval. If ADO API validation changes again, there's no stated rollback strategy.. _Applied:_ Add rollback section to Initiative 6: Revert HCL template changes via git revert, re-run tests against baseline, document failing API validation errors in GitHub issue. No persistent state affected (tests create/destroy resources in isolated test projects)
- `missing-vendor-update` — Initiative 1 (CI fixes) runs golangci-lint run --fix which may add imports, but doesn't explicitly call go mod vendor before the final build step.. _Applied:_ Add to Initiative 1 scope: After running all fix commands, regenerate vendor directory with go mod tidy && go mod vendor
- `quality-gate-mismatch` — Initiative 1's quality gate runs go build -mod=vendor ./... but CI workflow unit-test.yml runs go build -v ./... (without -mod=vendor flag).. _Applied:_ Align quality gate with exact CI commands: go build -v ./... && make test (unit-test.yml), golangci-lint run -v ./azuredevops/... (golint.yml), make terrafmt-check (terrafmt.yml), make depscheck (depscheck.yml)
- `missing-gomock-pattern` — Initiative 2 AC3 mentions "gomock controller usage" but doesn't specify the canonical cleanup pattern used consistently across the codebase.. _Applied:_ Refine AC3 to verify the exact pattern: ctrl := gomock.NewController(t) followed by defer ctrl.Finish() for proper cleanup, then azdosdkmocks.NewMockReleaseClient(ctrl)
- `data-source-naming` — Initiative 5 proposes data.betterado_release_definition (singular) and data.betterado_release_definitions (plural), but the test function prefix pattern is unclear.. _Applied:_ Specify test naming convention: data_release_definition_test.go / data_release_definitions_test.go for files, TestDataReleaseDefinition_* / TestDataReleaseDefinitions_* for test function prefixes
- `missing-import-id-format` — Initiative 3 (release_folder) and 4 (environment_template) mention "import support" but don't specify the import ID format or whether it uses tfhelper.ImportProjectQualifiedResource().. _Applied:_ Add import specification: Import ID format {projectId}/{folderId}, Import function tfhelper.ImportProjectQualifiedResourceUUID(), Example: terraform import betterado_release_folder.example 00000000-0000-0000-0000-000000000000/1
- `missing-file-count` — Initiative AC claims "≤3 files where possible" but doesn't enumerate files for new resources.. _Applied:_ Add file manifest to each initiative: Initiative 3/4 have 4 new + 1 modified = 5 files (resource, test, docs, example, provider registration). Initiative 5 has 8 files (2 data sources × 4 files each). Recommend splitting Initiative 5 into 5a/5b to meet ≤3 file atomicity target

**Escalations (taste decisions):**

- Initiative 1 aims to fix format/lint failures to unblock PR merges. Should it also update stale dependencies (e.g., golangci-lint config version, Go SDK minor bumps) discovered during linting, or strictly limit to formatting fixes?
  - **Fix format/lint only, defer dependency updates (Recommended)** — Minimize blast radius. Updating dependencies introduces risk of behavioral changes unrelated to CI failures. Keep Initiative 1 as a surgical fix to unblock PRs, then handle dependency updates as a separate maintenance task.
  - **Fix format/lint AND update dependencies proactively** — Since we're already touching CI, update dependencies now to prevent future CI breakage. Newer SDK versions may include bug fixes that reduce lint warnings.
- Initiative 2 verifies the existing 11 unit tests pass for release_definition substrate. Should we also generate a code coverage report to identify untested edge cases, or trust the existing characterization tests are sufficient?
  - **Run existing 11 tests, no coverage analysis (Recommended)** — The 11 tests already cover the canonical 5-test pattern plus 6 deep-nested characterization tests. Coverage reports are useful for new code, but this is a verification initiative to confirm the substrate is CI-ready, not a quality improvement initiative.
  - **Generate coverage report to identify gaps** — Since this is the substrate for all downstream release work, ensure comprehensive coverage now. A coverage report will identify any critical paths missing tests (e.g., error handling in nested expand/flatten functions).
- Initiative 4 states environment templates are immutable (no Update operation). Should we enforce this by omitting UpdateContext from the resource schema, or also add client-side validation to prevent unexpected API changes?
  - **Omit UpdateContext, mark all fields ForceNew (Recommended)** — Terraform's schema layer already enforces immutability via ForceNew: true. If a user changes any field, Terraform will destroy and recreate the resource. No need for additional client-side validation.
  - **Omit UpdateContext AND add API immutability check in Read** — Defensive programming. If the ADO API ever changes to allow updates (or if our understanding is wrong), detect it early by checking if the API returns different values than expected.
- Initiative 6 updates acceptance tests to pass against ADO API 7.1+. Should we test against only ADO 7.1 (current stable), or add matrix testing for ADO 7.0, 7.1, and 7.2 (if available)?
  - **Test against single ADO API version (7.1) (Recommended)** — The codebase uses azure-devops-go-api/azuredevops/v7 SDK which targets ADO 7.x. Testing against a single stable version (7.1) reduces complexity and matches real-world usage (most orgs pin to a specific ADO version).
  - **Test against ADO 7.0, 7.1, and 7.2 (if available)** — Increase confidence in SDK compatibility. By testing across multiple ADO versions, catch breaking changes early and document which versions are supported.

### Design critic

Cost: `$1.2266`

**Flags (auto-resolved):**

- `release-folder-naming` — Verify betterado_release_folder follows service_entity naming pattern (it does—matches build_folder, not workitemquery_folder outlier). _Applied:_ Confirmed naming is consistent with build_folder pattern. No change needed.
- `missing-docs-templates` — Only 1 of 120+ resources has documentation. New resources should follow established structure: Example Usage, Argument Reference, Attribute Reference.. _Applied:_ Ensure all new resource docs follow release_definition.md template structure with Basic/Advanced examples and schema references.
- `acceptance-test-missing-blocks` — Basic acceptance test HCL templates omit retention_policy and pre_deploy_approval, but need corresponding test assertions added too.. _Applied:_ Add resource.TestCheckResourceAttr() assertions for retention_policy and pre_deploy_approval blocks to verify round-trip correctness.
- `retention-policy-optionality` — Schema marks retention_policy as Optional+Computed, but ADO API 7.1+ requires it. Creates UX confusion when users omit it.. _Applied:_ Change retention_policy to Required OR add Default computed function with sensible defaults (30 days, 3 releases, retain_build=true) for backward compatibility.
- `error-messages-remediation` — Error messages like 'creating project: %v' lack user-actionable remediation hints for common failures (auth, required fields).. _Applied:_ Enhance error messages to detect common patterns (401→check creds, 400 with retention_policy→add required block) and append hints.
- `data-source-plural-naming` — Plural data source naming inconsistent across provider (some use _list suffix, others use plural s).. _Applied:_ Confirmed release_definitions (with s) matches existing plural pattern. No change needed.

**Escalations (taste decisions):**

- Should betterado_release_folder accept 'path' as user input (like build_folder) or accept 'name' + auto-compute 'path' (hierarchical)?
  - **path as Required input (matches build_folder)** — Users specify full folder path (e.g., \\Parent\\Child). Matches existing build_folder behavior and ADO portal UX where users see paths.
  - **name as Required, path as Computed (hierarchical)** — Users specify name and optional parent_id to build folder trees. API computes path. More Terraform-idiomatic for hierarchical resources like workitemquery_folder.
  - **Exact build_folder clone (Recommended)** — path Required, name Computed. This is what the initiative SHOULD be—100% copy-paste of build_folder schema. The draft has it backwards (name Required, path Computed). Zero cognitive load for users familiar with build folders.
- How should the provider communicate that release_environment_template is immutable to users who expect in-place updates?
  - **Pure ForceNew (Standard Terraform UX)** — Mark all fields ForceNew: true, no custom messaging. Let Terraform's standard behavior handle it—plan shows 'must be replaced'. This is standard Terraform pattern for immutable resources.
  - **CustomizeDiff warning** — Add CustomizeDiff function to detect field changes and emit warnings explaining the ADO API immutability limitation during terraform plan. Educates users before apply.
  - **Documentation-only (Recommended)** — Use ForceNew schema attributes + prominent callout in docs explaining limitation. Add example showing lifecycle prevent_destroy block for safer updates. Standard Terraform documentation pattern.

### DX critic

Cost: `$1.9417`

**Flags (auto-resolved):**

- `missing-precommit-hooks` — No pre-commit hooks for format enforcement (gofmt, gofumpt, terrafmt, golangci-lint) - CI failures catch issues late. _Applied:_ Add .pre-commit-config.yaml with hooks for gofmt, gofumpt, terrafmt, and golangci-lint. Document setup in docs/contributing.md: 'pre-commit install'
- `no-acceptance-test-runbook` — Initiative 6 requires live ADO acceptance tests but no runbook for credentials setup, test isolation, cleanup, or cost estimation. _Applied:_ Create docs/acceptance-testing-runbook.md covering: PAT token scopes, test project isolation (AZDO_TEST_PROJECT_PREFIX), pre-flight checks, example commands, manual cleanup script (scripts/cleanup-test-projects.sh), and cost/runtime estimates
- `linter-debt-untracked` — .golangci.yml documents disabled linters (err113, errorlint, perfsprint - ~1000s instances) but no migration plan or tracking. _Applied:_ Create docs/linter-debt.md documenting each disabled linter, instance count, migration strategy (e.g., 'Fix in new code only' vs 'Plan full migration'), and status tracking via GitHub issues
- `mock-regeneration-undocumented` — Initiatives 2/3/4 reference azdosdkmocks/release_sdk_mock.go as 'generated - do not modify' but no process documented for regenerating mocks when SDK changes. _Applied:_ Add section to docs/contributing.md: 'Regenerating Mocks' with gomock installation and example commands for regenerating mocks after SDK updates
- `immutable-template-no-migration-plan` — Initiative 4 introduces immutable betterado_release_environment_template (no Update, all ForceNew) with no documented rationale or future migration path if immutability changes. _Applied:_ Add Immutability Notice section to docs/resources/release_environment_template.md explaining API immutability, ForceNew behavior, impact on referencing release definitions, and future consideration if ADO adds update support

**Escalations (taste decisions):**

- Should acceptance tests run in CI, and if so, how should credentials and test isolation be managed?
  - **Manual acceptance testing (current state)** — Keep acceptance tests manual-only, run by maintainers with personal PAT tokens. No CI infrastructure changes needed.
  - **Automated CI with isolated test org (Recommended)** — Create dedicated Azure DevOps org for CI tests. Store PAT token in GitHub secrets. Run acceptance tests on PR comment trigger (e.g., /test-acceptance).
  - **Contributor-provided test credentials** — Document in CONTRIBUTING.md that contributors must create their own test ADO org and PAT token. Tests run locally before submitting PR. PR template requires acceptance tests passing checkbox.
- How should the project handle scenarios where the Azure DevOps Go SDK is missing features needed for complete API coverage?
  - **Block on upstream SDK support (Recommended)** — Only implement resources where the SDK already has full support. File issues upstream for missing methods. Prioritize initiatives that are unblocked.
  - **Bypass SDK with direct HTTP** — For missing SDK methods, implement direct HTTP calls to Azure DevOps REST API using the existing HTTP client from the SDK for auth continuity.
  - **Fork SDK temporarily and contribute back** — Fork the Azure DevOps Go SDK, add missing methods, vendor the fork. Submit PRs upstream. When upstream merges, switch back to official SDK.
- What is the right balance between unit test coverage and acceptance test coverage for complex resources like release_definition?
  - **High unit coverage + smoke acceptance tests (Recommended)** — Use unit tests to exhaustively cover expand/flatten edge cases, error propagation, and data integrity. Use acceptance tests to validate happy-path integration with real ADO API.
  - **Comprehensive acceptance coverage** — Invest in detailed acceptance tests covering most schema combinations. Run in nightly CI against dedicated test org. Unit tests cover only core logic (expand/flatten helpers).
  - **Contract testing with recorded fixtures** — Record real API interactions once using a tool like go-vcr. Play back recordings in CI for fast, realistic tests without live ADO dependency. Periodically re-record against live API.

## Proposed initiatives

| ID | Title | Features | Iteration budget | Depends on |
|---|---|---|---|---|
| `INIT-2026-06-01-ci-fix` | Fix gofmt/golint/terrafmt failures blocking CI | 1 | 2 | — |
| `INIT-2026-06-01-release-definition-substrate` | Verify existing 11 unit tests pass and add any missing canonical tests | 1 | 3 | — |
| `INIT-2026-06-01-release-folder` | Implement release_folder schema, CRUD, and provider registration | 2 | 4 | — |
| `INIT-2026-06-01-environment-template` | Implement environment_template schema, CRD (no Update), and provider registration | 2 | 4 | — |
| `INIT-2026-06-01-release-data-sources` | Implement data_release_definition (by ID or name) | 2 | 3 | — |
| `INIT-2026-06-01-acceptance-test-refresh` | Update HCL fixtures with required stage retention_policy and pre_deploy_approval | 2 | 3 | — |

### INIT-2026-06-01-ci-fix — drawer

```markdown
## Summary

The GitHub Actions CI workflows (golint.yml, terrafmt.yml, unit-test.yml) are failing due to formatting and lint violations accumulated on the main branch. This blocks all PR merges and must be fixed first.

## Background

The CI checks run on every PR to main:
- `golint.yml`: runs `golangci-lint run -v ./azuredevops/...`
- `terrafmt.yml`: runs `make terrafmt-check` via `scripts/terrafmt.sh`
- `unit-test.yml`: runs `go build -v ./...` + `make test`

The fork has drifted from upstream formatting conventions and accumulated lint warnings that now fail CI.

## Scope

**In scope:**
- Run `make fmt` to fix gofmt issues
- Run `make fumpt` to apply gofumpt formatting
- Run `make terrafmt` to fix HCL blocks in test files
- Run `golangci-lint run --fix ./azuredevops/...` to auto-fix lint issues
- Fix any remaining manual lint issues (unused variables, etc.)
- Ensure `go build -mod=vendor ./...` passes
- Ensure `make test` passes (unit tests, not acceptance)

**Out of scope:**
- Acceptance tests (require live ADO creds)
- New features or resources
- Documentation updates

## Acceptance criteria

### AC1: gofmt check passes
**Given** the codebase after fixes are applied  
**When** running `./scripts/gofmtcheck.sh`  
**Then** the script exits 0 with no diff output

### AC2: terrafmt check passes
**Given** the codebase after fixes are applied  
**When** running `make terrafmt-check`  
**Then** the script exits 0 with no formatting errors

### AC3: golangci-lint passes
**Given** the codebase after fixes are applied  
**When** running `golangci-lint run -v ./azuredevops/...`  
**Then** the linter exits 0 with no errors

### AC4: Build and unit tests pass
**Given** the codebase after fixes are applied  
**When** running `go build -mod=vendor ./...` and then `make test`  
**Then** both commands exit 0

## Quality gate

```bash
./scripts/gofmtcheck.sh && make terrafmt-check && golangci-lint run -v ./azuredevops/... && go build -mod=vendor ./... && make test
```

## Non-goals

- Do not change any functional code behavior
- Do not add new tests beyond what's needed for lint fixes
- Do not update dependencies
```

### INIT-2026-06-01-release-definition-substrate — drawer

```markdown
## Summary

The `betterado_release_definition` resource has 11 gomock unit tests in `resource_release_definition_test.go` (1009 lines). This initiative verifies the substrate is complete and passes CI, ensuring it gates downstream release work.

## Background

The release_definition resource (`azuredevops/internal/service/release/resource_release_definition.go`, ~1618 lines) is the foundation of the Release API coverage. The existing unit test file covers:
1. Roundtrip (expand/flatten)
2. Create error propagation
3. Read clears ID on 404
4. Update calls SDK with args
5. Delete surfaces API error
6. Update revision-conflict retry
7. Secret variables preserve value on flatten
8. Deep-nested environment expand/flatten
9. Artifacts definition_reference filtering
10. Approval options round-trip
11. Deploy phases JSON marshal/unmarshal

The canonical 5-test pattern (roundtrip, create-error, read-404, update-args, delete-error) is covered. Additional characterization tests ensure deep-nested structures survive expand/flatten.

## Scope

**In scope:**
- Verify all 11 existing tests pass with: `go test -mod=vendor -tags all -count=1 -run ^TestReleaseDefinition ./azuredevops/internal/service/release/`
- Review test coverage for any gaps in the canonical pattern
- Add any missing edge-case tests discovered during review

**Out of scope:**
- Acceptance tests (separate initiative)
- New resource features
- Schema changes

## Acceptance criteria

### AC1: All unit tests pass
**Given** the release_definition unit test file  
**When** running `go test -mod=vendor -tags all -count=1 -run ^TestReleaseDefinition ./azuredevops/internal/service/release/`  
**Then** all tests pass (exit 0) with verbose PASS output for each test

### AC2: Tests use correct build tags
**Given** the test file header  
**When** examining the build constraints  
**Then** `//go:build (all || resource_release_definition)` is present, matching project convention

### AC3: MockReleaseClient is properly configured
**Given** the test setup  
**When** examining the gomock controller usage  
**Then** `azdosdkmocks.NewMockReleaseClient(ctrl)` is used consistently with proper cleanup via `defer ctrl.Finish()`

## Quality gate

```bash
go test -mod=vendor -tags all -count=1 -v -run ^TestReleaseDefinition ./azuredevops/internal/service/release/
```

Expected: 11 tests pass (PASS lines in output), exit code 0.

## Hard constraints

- Tests must be creds-free (gomock only, no TF_ACC)
- Must not modify `azdosdkmocks/release_sdk_mock.go` (generated file)
- Inline fixtures preferred; `testdata/` only if >20 lines
```

### INIT-2026-06-01-release-folder — drawer

```markdown
## Summary

Add `betterado_release_folder` resource to organize release definitions into folders, mirroring the `betterado_build_folder` pattern from the build service.

## Background

The Release API (`vsrm.dev.azure.com`) supports folders for organizing release definitions:
- `POST /release/folders` — CreateFolder
- `GET /release/folders` — GetFolders
- `PATCH /release/folders` — UpdateFolder
- `DELETE /release/folders` — DeleteFolder

The mock client already exists in `azdosdkmocks/release_sdk_mock.go` with `CreateFolder`, `GetFolders`, `UpdateFolder`, `DeleteFolder` methods.

## Scope

**In scope:**
- Schema: `name` (Required, ForceNew), `project_id` (Required, ForceNew), `path` (Computed — full path returned by API)
- CRUD operations using `clients.ReleaseClient.{Create,Get,Update,Delete}Folder`
- Import support via `tfhelper.ImportProjectQualifiedResource()`
- Register in `azuredevops/provider.go` as `betterado_release_folder`
- 5 canonical unit tests in `resource_release_folder_test.go`
- Documentation in `docs/resources/release_folder.md`
- Runnable example in `examples/release_folder/main.tf`

**Out of scope:**
- Acceptance tests (require live ADO)
- Nested folder creation in one resource

## Acceptance criteria

### AC1: Resource is registered and builds
**Given** the new resource file and provider registration  
**When** running `go build -mod=vendor ./...`  
**Then** the build succeeds with the resource registered as `betterado_release_folder`

### AC2: Schema is correct
**Given** the resource schema  
**When** examining `ResourceReleaseFolder().Schema`  
**Then** it contains: `name` (Required, string, ForceNew), `project_id` (Required, UUID, ForceNew), `path` (Computed, string)

### AC3: Unit tests pass
**Given** the unit test file  
**When** running `go test -mod=vendor -tags all -count=1 -run ^TestReleaseFolder ./azuredevops/internal/service/release/`  
**Then** all 5 canonical tests pass:
- `TestReleaseFolder_ExpandFlatten_Roundtrip`
- `TestReleaseFolder_Create_DoesNotSwallowError`
- `TestReleaseFolder_Read_ClearsIdOn404`
- `TestReleaseFolder_Update_CallsSDKWithArgs`
- `TestReleaseFolder_Delete_SurfacesAPIError`

### AC4: Documentation exists
**Given** the docs directory  
**When** checking `docs/resources/release_folder.md`  
**Then** it exists with schema reference and example usage

## Quality gate

```bash
go build -mod=vendor ./... && go test -mod=vendor -tags all -count=1 -v -run ^TestReleaseFolder ./azuredevops/internal/service/release/
```

## Non-goals

- Folder hierarchy management (parent/child relationships)
- Moving existing release definitions between folders
```

### INIT-2026-06-01-environment-template — drawer

```markdown
## Summary

Add `betterado_release_environment_template` resource to create reusable environment templates that can be referenced when creating release definitions.

## Background

The Release API supports environment templates:
- `POST /release/definitions/environmenttemplates` — Create
- `GET /release/definitions/environmenttemplates` — List/Get
- `DELETE /release/definitions/environmenttemplates/{templateId}` — Delete

**Note:** Templates are immutable after creation — there is no Update operation. Any schema change requires destroy/recreate (ForceNew on all mutable fields).

## Scope

**In scope:**
- Schema: `name` (Required, ForceNew), `project_id` (Required, ForceNew), `description` (Optional, ForceNew), `environment` block (Required, ForceNew — reuses release_definition environment schema)
- CRD operations (Create, Read, Delete — no Update)
- Import support
- Register in `azuredevops/provider.go` as `betterado_release_environment_template`
- Unit tests: roundtrip, create-error, read-404-clears-id, delete-error (no update test — immutable)
- Documentation and example

**Out of scope:**
- Update operation (templates are immutable)
- Acceptance tests

## Acceptance criteria

### AC1: Resource is registered and builds
**Given** the new resource file and provider registration  
**When** running `go build -mod=vendor ./...`  
**Then** the build succeeds with the resource registered as `betterado_release_environment_template`

### AC2: Schema marks mutable fields as ForceNew
**Given** the resource schema  
**When** examining all non-Computed fields  
**Then** they are marked `ForceNew: true` (no in-place updates)

### AC3: No Update function is registered
**Given** the resource definition  
**When** examining `&schema.Resource{}`  
**Then** `UpdateContext` is nil or absent

### AC4: Unit tests pass
**Given** the unit test file  
**When** running `go test -mod=vendor -tags all -count=1 -run ^TestReleaseEnvironmentTemplate ./azuredevops/internal/service/release/`  
**Then** all 4 tests pass:
- `TestReleaseEnvironmentTemplate_ExpandFlatten_Roundtrip`
- `TestReleaseEnvironmentTemplate_Create_DoesNotSwallowError`
- `TestReleaseEnvironmentTemplate_Read_ClearsIdOn404`
- `TestReleaseEnvironmentTemplate_Delete_SurfacesAPIError`

## Quality gate

```bash
go build -mod=vendor ./... && go test -mod=vendor -tags all -count=1 -v -run ^TestReleaseEnvironmentTemplate ./azuredevops/internal/service/release/
```

## Hard constraints

- No UpdateContext — immutable resource
- Environment block reuses expand/flatten from release_definition where possible
```

### INIT-2026-06-01-release-data-sources — drawer

```markdown
## Summary

Add data sources to read existing release definitions: `data.betterado_release_definition` (single by ID or name) and `data.betterado_release_definitions` (list with optional filters).

## Background

The Release API supports reading release definitions:
- `GET /release/definitions/{definitionId}` — Get single by ID
- `GET /release/definitions` — List with query parameters (name, path, isExactNameMatch, etc.)

Data sources allow Terraform configurations to reference existing release definitions without managing them.

## Scope

**In scope:**

**data.betterado_release_definition:**
- Schema: `project_id` (Required), `definition_id` (Optional, ConflictsWith name), `name` (Optional, ConflictsWith definition_id)
- Computed: all fields from the resource schema (read-only)
- Read via `GetReleaseDefinition` (by ID) or `GetReleaseDefinitions` + filter (by name)

**data.betterado_release_definitions:**
- Schema: `project_id` (Required), `name` (Optional filter), `path` (Optional filter)
- Computed: `definitions` list with ID, name, path, revision
- Read via `GetReleaseDefinitions`

- Unit tests for both data sources
- Documentation and examples

**Out of scope:**
- Acceptance tests
- Full nested environment/artifact flattening in list (keep list items lightweight)

## Acceptance criteria

### AC1: Single data source works by ID
**Given** a data source config with `definition_id`  
**When** Terraform reads the data source  
**Then** it calls `GetReleaseDefinition` and populates all computed fields

### AC2: Single data source works by name
**Given** a data source config with `name`  
**When** Terraform reads the data source  
**Then** it calls `GetReleaseDefinitions` with isExactNameMatch, finds the match, and populates fields

### AC3: List data source returns filtered results
**Given** a data source config with optional `name` and `path` filters  
**When** Terraform reads the data source  
**Then** it calls `GetReleaseDefinitions` with appropriate filters and returns matching definitions

### AC4: Unit tests pass
**Given** the data source test files  
**When** running `go test -mod=vendor -tags all -count=1 -run ^TestDataReleaseDefinition ./azuredevops/internal/service/release/`  
**Then** all tests pass for both data sources

## Quality gate

```bash
go build -mod=vendor ./... && go test -mod=vendor -tags all -count=1 -v -run ^TestDataReleaseDefinition ./azuredevops/internal/service/release/
```

## Hard constraints

- Either `definition_id` or `name` required for single data source (not both)
- Reuse flatten functions from resource where applicable
```

### INIT-2026-06-01-acceptance-test-refresh — drawer

```markdown
## Summary

Refresh the `betterado_release_definition` acceptance tests to pass against live Azure DevOps REST API 7.1+, which now requires stage-level `retention_policy` and `pre_deploy_approval` blocks.

## Background

The existing 6 acceptance tests in `resource_release_definition_test.go` are stale:
- `VS402982`: Stage-level `retention_policy` is now required by ADO
- `VS402877`: Pre/post deploy approvals structure is now validated more strictly

The HCL templates need updating to include these required blocks.

## Scope

**In scope:**
- Update `hclReleaseDefinitionBasic()` to include `retention_policy` block
- Update `hclReleaseDefinitionBasic()` to include `pre_deploy_approval` with automated approver
- Update all HCL template functions similarly
- Run acceptance tests with live ADO creds: `TF_ACC=1 go test -tags all -run TestAccReleaseDefinition ./azuredevops/internal/acceptancetests/`
- Fix any additional API validation errors discovered

**Out of scope:**
- New acceptance test scenarios
- Unit tests (separate initiative)
- Other resources

## Acceptance criteria

### AC1: All HCL templates include retention_policy
**Given** each HCL template function  
**When** examining the `environment` blocks  
**Then** each includes a `retention_policy` block with `days_to_keep`, `releases_to_keep`, `retain_build`

### AC2: All HCL templates include pre_deploy_approval
**Given** each HCL template function  
**When** examining the `environment` blocks  
**Then** each includes a `pre_deploy_approval` block with at least one automated approver

### AC3: Acceptance tests pass
**Given** the updated HCL templates and live ADO credentials  
**When** running `TF_ACC=1 go test -tags all -v -run TestAccReleaseDefinition ./azuredevops/internal/acceptancetests/ -timeout 30m`  
**Then** all 6 tests pass:
- `TestAccReleaseDefinition_basic`
- `TestAccReleaseDefinition_withDeploymentInput`
- `TestAccReleaseDefinition_withApprovalOptions`
- `TestAccReleaseDefinition_withEnvironmentOptions`
- `TestAccReleaseDefinition_update`
- `TestAccReleaseDefinition_complete`

### AC4: Import still works
**Given** the `TestAccReleaseDefinition_basic` and `TestAccReleaseDefinition_complete` tests  
**When** examining the ImportState step  
**Then** import succeeds with `ImportStateVerify: true`

## Quality gate

```bash
TF_ACC=1 go test -tags all -v -run TestAccReleaseDefinition ./azuredevops/internal/acceptancetests/ -timeout 30m
```

Requires: `AZDO_ORG_SERVICE_URL` and `AZDO_PERSONAL_ACCESS_TOKEN` environment variables (or sourced from `secrets.env`).

## Hard constraints

- Tests must create resources in isolated test projects (use `testutils.GenerateResourceName()`)
- Tests must auto-destroy resources (CheckDestroy function)
- No manual intervention required
```

## Aggregate footprint (informational)

_This block surfaces the **informational** footprint of the proposed initiatives — how many cycles + dollars they would consume if every one were queued today. It is informational only; forge does not enforce a budget or block at any number._

- Initiatives proposed: **6**
- Total iteration budget: **19**

## Open escalations

_These taste decisions the council surfaced are unresolved. Resolve each inline with `<!-- review: ... -->` before approving, or explicitly defer in your verdict._

- (ceo) Should the release_definition substrate verification (Initiative 2) be merged into the CI fix (Initiative 1), or remain separate?
  - **Merge into CI fix (Recommended)** — Initiative 2's sole purpose is verifying existing tests pass. This is already covered by Initiative 1's AC4 ('make test' passes all unit tests). Running a subset of tests separately adds no strategic value—it's the same quality gate. Merging eliminates a phantom initiative and gets to the actual work (folders, templates, data sources) faster.
  - **Keep separate** — Treat the release_definition substrate as a distinct milestone requiring explicit sign-off before dependent work begins. Provides a clear checkpoint for stakeholders to confirm the foundation is solid before building on it.
- (ceo) Should initiatives 3–5 (folder, template, data sources) remain separate or be bundled?
  - **Keep separate (Recommended)** — Each is independently releasable and provides standalone user value. A user can deploy folders without templates, or use data sources without creating folders. Separate initiatives allow parallel work if multiple contributors are available, and each can be released as soon as it passes CI—maximizing feedback velocity.
  - **Bundle into 'Complete Release API Coverage'** — Deliver a coherent 'Release Management' feature set in one release. Users get folders + templates + data sources together, which tells a complete story. Reduces PR/review overhead from 3 initiatives to 1.
- (ceo) Is Initiative 6 (acceptance test refresh) correctly prioritized, or should it be deferred?
  - **Defer until after features ship (Recommended)** — Acceptance tests require live ADO credentials and validate end-to-end behavior. The unit tests (already passing after Initiative 1) provide sufficient CI gate for release_definition. Deferring this to a 'hardening' phase after folders/templates/data sources are shipped maximizes feature velocity now. The resource already works (unit tests prove CRUD logic); acceptance tests verify API contract stability, which is lower priority than new capabilities.
  - **Keep as-prioritized (after substrate, before new features)** — Ensure the existing release_definition resource passes live ADO validation before building dependent features. Folders and templates may reference release definitions; better to confirm the foundation works end-to-end against real API before layering on new resources.
- (eng) Initiative 1 aims to fix format/lint failures to unblock PR merges. Should it also update stale dependencies (e.g., golangci-lint config version, Go SDK minor bumps) discovered during linting, or strictly limit to formatting fixes?
  - **Fix format/lint only, defer dependency updates (Recommended)** — Minimize blast radius. Updating dependencies introduces risk of behavioral changes unrelated to CI failures. Keep Initiative 1 as a surgical fix to unblock PRs, then handle dependency updates as a separate maintenance task.
  - **Fix format/lint AND update dependencies proactively** — Since we're already touching CI, update dependencies now to prevent future CI breakage. Newer SDK versions may include bug fixes that reduce lint warnings.
- (eng) Initiative 2 verifies the existing 11 unit tests pass for release_definition substrate. Should we also generate a code coverage report to identify untested edge cases, or trust the existing characterization tests are sufficient?
  - **Run existing 11 tests, no coverage analysis (Recommended)** — The 11 tests already cover the canonical 5-test pattern plus 6 deep-nested characterization tests. Coverage reports are useful for new code, but this is a verification initiative to confirm the substrate is CI-ready, not a quality improvement initiative.
  - **Generate coverage report to identify gaps** — Since this is the substrate for all downstream release work, ensure comprehensive coverage now. A coverage report will identify any critical paths missing tests (e.g., error handling in nested expand/flatten functions).
- (eng) Initiative 4 states environment templates are immutable (no Update operation). Should we enforce this by omitting UpdateContext from the resource schema, or also add client-side validation to prevent unexpected API changes?
  - **Omit UpdateContext, mark all fields ForceNew (Recommended)** — Terraform's schema layer already enforces immutability via ForceNew: true. If a user changes any field, Terraform will destroy and recreate the resource. No need for additional client-side validation.
  - **Omit UpdateContext AND add API immutability check in Read** — Defensive programming. If the ADO API ever changes to allow updates (or if our understanding is wrong), detect it early by checking if the API returns different values than expected.
- (eng) Initiative 6 updates acceptance tests to pass against ADO API 7.1+. Should we test against only ADO 7.1 (current stable), or add matrix testing for ADO 7.0, 7.1, and 7.2 (if available)?
  - **Test against single ADO API version (7.1) (Recommended)** — The codebase uses azure-devops-go-api/azuredevops/v7 SDK which targets ADO 7.x. Testing against a single stable version (7.1) reduces complexity and matches real-world usage (most orgs pin to a specific ADO version).
  - **Test against ADO 7.0, 7.1, and 7.2 (if available)** — Increase confidence in SDK compatibility. By testing across multiple ADO versions, catch breaking changes early and document which versions are supported.
- (Design (UX)) Should betterado_release_folder accept 'path' as user input (like build_folder) or accept 'name' + auto-compute 'path' (hierarchical)?
  - **path as Required input (matches build_folder)** — Users specify full folder path (e.g., \\Parent\\Child). Matches existing build_folder behavior and ADO portal UX where users see paths.
  - **name as Required, path as Computed (hierarchical)** — Users specify name and optional parent_id to build folder trees. API computes path. More Terraform-idiomatic for hierarchical resources like workitemquery_folder.
  - **Exact build_folder clone (Recommended)** — path Required, name Computed. This is what the initiative SHOULD be—100% copy-paste of build_folder schema. The draft has it backwards (name Required, path Computed). Zero cognitive load for users familiar with build folders.
- (Design (UX)) How should the provider communicate that release_environment_template is immutable to users who expect in-place updates?
  - **Pure ForceNew (Standard Terraform UX)** — Mark all fields ForceNew: true, no custom messaging. Let Terraform's standard behavior handle it—plan shows 'must be replaced'. This is standard Terraform pattern for immutable resources.
  - **CustomizeDiff warning** — Add CustomizeDiff function to detect field changes and emit warnings explaining the ADO API immutability limitation during terraform plan. Educates users before apply.
  - **Documentation-only (Recommended)** — Use ForceNew schema attributes + prominent callout in docs explaining limitation. Add example showing lifecycle prevent_destroy block for safer updates. Standard Terraform documentation pattern.
- (dx) Should acceptance tests run in CI, and if so, how should credentials and test isolation be managed?
  - **Manual acceptance testing (current state)** — Keep acceptance tests manual-only, run by maintainers with personal PAT tokens. No CI infrastructure changes needed.
  - **Automated CI with isolated test org (Recommended)** — Create dedicated Azure DevOps org for CI tests. Store PAT token in GitHub secrets. Run acceptance tests on PR comment trigger (e.g., /test-acceptance).
  - **Contributor-provided test credentials** — Document in CONTRIBUTING.md that contributors must create their own test ADO org and PAT token. Tests run locally before submitting PR. PR template requires acceptance tests passing checkbox.
- (dx) How should the project handle scenarios where the Azure DevOps Go SDK is missing features needed for complete API coverage?
  - **Block on upstream SDK support (Recommended)** — Only implement resources where the SDK already has full support. File issues upstream for missing methods. Prioritize initiatives that are unblocked.
  - **Bypass SDK with direct HTTP** — For missing SDK methods, implement direct HTTP calls to Azure DevOps REST API using the existing HTTP client from the SDK for auth continuity.
  - **Fork SDK temporarily and contribute back** — Fork the Azure DevOps Go SDK, add missing methods, vendor the fork. Submit PRs upstream. When upstream merges, switch back to official SDK.
- (dx) What is the right balance between unit test coverage and acceptance test coverage for complex resources like release_definition?
  - **High unit coverage + smoke acceptance tests (Recommended)** — Use unit tests to exhaustively cover expand/flatten edge cases, error propagation, and data integrity. Use acceptance tests to validate happy-path integration with real ADO API.
  - **Comprehensive acceptance coverage** — Invest in detailed acceptance tests covering most schema combinations. Run in nightly CI against dedicated test org. Unit tests cover only core logic (expand/flatten helpers).
  - **Contract testing with recorded fixtures** — Record real API interactions once using a tool like go-vcr. Play back recordings in CI for fast, realistic tests without live ADO dependency. Periodically re-record against live API.

---

_Generated by the architect runner on 2026-06-01T08:15:46.406Z. Reviewed + approved on the `/architect` screen in the forge UI._
