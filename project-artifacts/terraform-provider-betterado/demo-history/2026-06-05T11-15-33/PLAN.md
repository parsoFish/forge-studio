# Architect plan — 2026-06-05T11-15-33

- Project: `terraform-provider-betterado`
- Repo: `/home/parso/forge/projects/terraform-provider-betterado`

> **Operator review.** This plan is presented on the `/architect/2026-06-05T11-15-33` screen in the forge UI. Read each section there, resolve the council's design decisions, and click **approve**, **revise**, or **reject** — the runner finalizes your verdict, promoting the manifests to the queue only on approve.

## Operator brief + interview

Feature-complete declarative Azure DevOps Release surface for terraform-provider-betterado. INIT-1 completes release_definition (acceptance-fix + gates/triggers/parallel/agentless schema parity), then INIT-2 adds release_folder, INIT-3 adds release data sources, INIT-4 adds release_definition_permissions, and INIT-5 (spike-gated) may add environment templates. Serial chain via depends_on avoids provider.go registry merge conflicts — forge's #1 historical failure mode. Done = INIT-1–4 merged CI-green + INIT-5 either merged or spike-parked with documented rationale.

### Interview

_No interview rounds — operator drafted directly._

## Brain context

- `/home/mccollj/Projects/forge/projects/terraform-provider-betterado/brain/profile.md` — consulted during architect draft
- `/home/mccollj/Projects/forge/brain/cycles/themes/spec-driven-work-items.md` — consulted during architect draft
- `/home/mccollj/Projects/forge/brain/cycles/themes/dependency-ordered-work.md` — consulted during architect draft
- `/home/mccollj/Projects/forge/brain/cycles/themes/squash-merge-stacked-prs.md` — consulted during architect draft
- `/home/mccollj/Projects/forge/brain/cycles/themes/merge-boundary-stacked-initiative-failure.md` — consulted during architect draft
- `/home/parso/forge/projects/terraform-provider-betterado/brain/profile.md` — consulted during architect draft
- `/home/parso/forge/brain/cycles/themes/dependency-ordered-work.md` — consulted during architect draft
- `/home/parso/forge/brain/cycles/themes/squash-merge-stacked-prs.md` — consulted during architect draft
- `/home/parso/forge/brain/cycles/themes/merge-boundary-stacked-initiative-failure.md` — consulted during architect draft
- `/home/parso/forge/brain/cycles/themes/spec-driven-work-items.md` — consulted during architect draft
- `/home/parso/forge/projects/terraform-provider-betterado/brain/themes/2026-05-31-forge-onboarding-findings.md` — consulted during architect draft
- `/home/parso/forge/projects/terraform-provider-betterado/brain/themes/2026-05-31-release-definition-unit-test-substrate.md` — consulted during architect draft
- `/home/parso/forge/brain/cycles/themes/layered-merge-order.md` — consulted during architect draft

## Council transcript

Total cost: `$2.8229`

### Flags (auto-applied)

- `vision-clarity` — Vision says 'INIT-1 completes release_definition (acceptance-fix + gates/triggers/parallel/agentless schema parity)' but the phrase 'schema parity' is vague — parity with what? The goal later clarifies 'ADO REST API 7.2 feature parity.'. _Applied:_ Replace 'schema parity' with 'ADO REST API 7.2 feature parity' in vision statement for consistency.
- `done-definition-ambiguity` — Vision says 'Done = INIT-1–4 merged CI-green + INIT-5 either merged or spike-parked with documented rationale' but doesn't define what 'CI-green' means (unit tests? acceptance tests? full suite?).. _Applied:_ Define 'CI-green' as 'all unit + acceptance tests passing per the initiative's gate command' in vision.
- `init5-spike-gate-missing` — INIT-5 has a spike-first requirement ('Spike-first, stop-on-fail') but the vision doesn't clarify whether INIT-5 is optional or required for 'Done.' If the spike fails, is the overall initiative complete or incomplete?. _Applied:_ Clarify in vision: 'INIT-5 is optional; Done = INIT-1–4 merged + INIT-5 spike completed (build only if feasible).'
- `init1-acceptance-criteria-test-scope` — INIT-1 acceptance criteria says 'the full project CI gate … is green' but earlier notes say 'Gate pattern: -tags all -count=1 -run <Prefix> scoped to new tests.' These conflict — is the gate scoped to new tests or the full project?. _Applied:_ Change INIT-1 gate to 'scoped to TestReleaseDefinition* prefix' (consistent with INIT-2/3/4/5 pattern).
- `init4-two-namespaces-confusion` — INIT-4 background mentions 'ReleaseManagement (project-level) and ReleaseManagement2 (definition-level)' but doesn't clarify if the resource needs to handle BOTH or just ReleaseManagement2. The title says 'release_definition_permissions' which implies definition-level only.. _Applied:_ Clarify scope: 'betterado_release_definition_permissions uses ReleaseManagement2 namespace (definition-level); project-level ReleaseManagement out of scope.'
- `init-2-depends-missing` — INIT-2 (release_folder) has no explicit depends_on despite PM note 'serial chain via depends_on avoids provider.go registry merge conflicts'. _Applied:_ Add 'depends_on: INIT-1' to INIT-2 (release_folder must merge after release_definition acceptance tests pass)
- `init-3-depends-missing` — INIT-3 (data sources) has no explicit depends_on — but data sources reference release definitions, so logically blocked by INIT-1 completion. _Applied:_ Add 'depends_on: INIT-1' to INIT-3 (data sources need stable release_definition schema to reference)
- `init-4-depends-missing` — INIT-4 (permissions) has no explicit depends_on — but permissions apply to release definitions, blocked by INIT-1. _Applied:_ Add 'depends_on: INIT-1' to INIT-4 (permissions resource needs stable release_definition to apply ACLs to)
- `init-5-depends-missing` — INIT-5 (environment templates) has no explicit depends_on — templates are used BY release definitions, blocked by INIT-1. _Applied:_ Add 'depends_on: INIT-1' to INIT-5 (templates are consumed by release_definition; must merge after INIT-1)
- `init-1-ac-verifier-ambiguous` — INIT-1 AC says 'the full project CI gate is green' but doesn't specify WHO runs it (orchestrator? dev?) or WHEN (pre-merge? post-merge?). _Applied:_ Rewrite AC final clause: 'THEN … AND `make test-release` (which runs the CI gate) passes in CI pre-merge'
- `init-2-ac-verifier-ambiguous` — INIT-2 AC says '5 canonical gomock unit tests pass' but doesn't name them — PM can't verify completeness. _Applied:_ Enumerate in AC: 'THEN … AND unit tests pass: TestReleaseFolderResource_ExpandFlatten, TestReleaseFolderResource_CreateError, TestReleaseFolderResource_Read404, TestReleaseFolderResource_Update, TestReleaseFolderResource_DeleteError'
- `init-3-ac-no-notfound-test` — INIT-3 AC says 'unit tests cover read path + not-found error path' but doesn't require acceptance test for not-found (only 'resolve a known definition'). _Applied:_ Add to AC: 'AND acceptance test for nonexistent definition returns clear error (not Terraform crash)'
- `init-4-ac-remove-vs-revoke` — INIT-4 AC says 'assign + read + remove a permission' — 'remove' is ambiguous (delete resource? revoke ACL?). _Applied:_ Clarify AC: 'assign (apply), read (refresh), update (change permission bits), destroy (remove ACL) pass against live ADO'
- `init-5-spike-ac-missing-stop-condition` — INIT-5 spike AC says 'STOP and park' but doesn't define what 'park' means (close initiative? doc in README? GitHub issue?). _Applied:_ Add to spike AC: 'THEN … record finding in docs/architecture/decisions/005-release-templates-not-viable.md and close INIT-5 as wontfix'
- `no-rollback-init-1` — INIT-1 adds required fields (retention_policy, pre_deploy_approval) — existing definitions WITHOUT these will break on refresh. No rollback/migration path stated.. _Applied:_ Add to INIT-1 notes: 'Migration: existing release_definition resources missing retention_policy will fail plan with actionable error. User must add block. No auto-migration (ADO API has no default retention—user intent required).'
- `no-rollback-init-2` — INIT-2 (release_folder) is a new resource — but if a folder is deleted in Terraform, does ADO cascade-delete definitions inside it? Rollback risk unstated.. _Applied:_ Add to INIT-2 notes: 'Rollback: deleting a folder via Terraform will FAIL if definitions exist inside it (ADO API constraint). Acceptance test must verify folder-delete-with-children returns clear error.'
- `no-rollback-init-4` — INIT-4 (permissions) touches ACLs — revoking a permission could lock out the service principal running Terraform. Rollback risk unstated.. _Applied:_ Add to INIT-4 notes: 'Rollback: if the Terraform service principal revokes its own ManagePermissions bit, subsequent applies will 403. Acceptance test must use a separate test identity (not the apply identity) as the permission subject.'
- `init-1-3-files-violated` — INIT-1 (god-file) will touch resource_release_definition.go (~1618 LOC), resource_release_definition_test.go, and schema_release.go — likely >3 files if acceptance tests are separate. _Applied:_ Split INIT-1 into per-feature WIs (see escalation 1) so each WI touches ≤3 files (schema_release.go + resource_release_definition.go + focused test file)
- `data-source-docs` — INIT-3 missing data source documentation requirements. _Applied:_ Added WI requirement: Create /docs/data-sources/release_definition.md and release_definitions.md following resource doc structure (Example Usage → Args → Attributes)
- `permissions-naming` — INIT-4 unclear if two permission resources needed (project-level vs definition-level namespaces). _Applied:_ Added clarification to INIT-4 acceptance criteria: Confirm if ReleaseManagement (project) and ReleaseManagement2 (definition) require separate resources; split WI if needed
- `folder-import` — INIT-2 release_folder missing import support pattern. _Applied:_ Added to INIT-2 acceptance criteria: Implement import using tfhelper.ImportProjectQualifiedResource() and document PROJECT_ID/FOLDER_ID pattern
- `retention-docs` — retention_policy docs say Optional but API now requires it. _Applied:_ Added to INIT-1: Update /docs/resources/release_definition.md line 191 to mark retention_policy as (Required) with note about API 7.2+ enforcement
- `gate-validation` — Gates timeout field needs validation (must exceed sampling_interval). _Applied:_ Added to INIT-1 acceptance criteria: Implement ValidateFunc ensuring timeout > sampling_interval to prevent invalid gate configurations
- `cron-validation` — Schedule trigger needs cron expression validation at plan time. _Applied:_ Added to INIT-1 acceptance criteria: Implement ValidateFunc for schedule_trigger cron expressions to fail fast on invalid schedules
- `F1` — Serial chain is unnecessary - all initiatives register different resource names. _Applied:_ Document that parallel execution is safe; use branch-per-initiative + CI gating instead of serial dependency
- `F2` — Acceptance test failures are data issues, not schema gaps. _Applied:_ Clarify that INIT-1 acceptance refresh is test-data fix (add valid retention_policy + approver blocks to fixtures), not schema implementation
- `F3` — INIT-1 WI scoping mixes refactoring with feature work. _Applied:_ Split INIT-1 into two phases: (a) acceptance-fix + existing unit tests green; (b) additive schema work with per-schema unit tests
- `F4` — Missing rollback/deprecation strategy for API breaking changes. _Applied:_ Document that ADO API compatibility is provider's contract; consider migration guide if changing field requirements
- `F5` — INIT-4 permissions token format positioned as high-risk spike. _Applied:_ Clarify token-format validation is low-risk (follows git_permissions pattern); expect ~1 hour validation, not multi-day investigation

### Escalations (taste decisions surfaced)

- (CEO) The initiative chains 5 sub-initiatives serially to avoid provider.go merge conflicts. Is this the right tradeoff between risk mitigation and delivery velocity?
  - **Keep serial chain (Recommended)** — The PM explicitly calls out 'provider.go registry merge conflicts — forge's #1 historical failure mode.' Given this is a documented pain point with historical data, the serial dependency is a proven risk mitigation. The chain is logical (foundation → additive features → cross-cutting concerns → spike), and each initiative is independently valuable.
  - **Batch provider.go changes** — Treat provider.go registry as pure mechanical overhead. Do INIT-1 (the foundation), then run INIT-2/3/4 in parallel with a final 'registry PR' that adds all 4 lines at once. INIT-5 stays gated behind the spike regardless.
- (CEO) INIT-1 is the largest initiative (~4 schema additions to a 1618-LOC god-file) but framed as a single unit. Should it remain monolithic or be split?
  - **Keep INIT-1 monolithic** — The PM already flagged the god-file collision risk and said 'size WIs to minimise collision risk within the file.' The 4 schema additions (gates/triggers/parallel/agentless) are described as independently testable. Splitting INIT-1 into 4 sub-initiatives (INIT-1a/b/c/d) would reduce per-WI risk and allow incremental progress.
  - **Split INIT-1 into foundation + 4 additive WIs (Recommended)** — INIT-1a = acceptance-test refresh (the foundation). INIT-1b/c/d/e = gates, triggers, parallel, agentless (each with expand/flatten + unit test). The PM already noted 'each can be a separate WI scoped to its expand/flatten + unit test.' This matches the stated collision-mitigation goal and allows incremental merges.
- (eng) INIT-1 is a ~1618-LOC god-file with 4 additive schema features. Should we split it into 5 sequential work items (acceptance-fix foundation + 4 parallel schema additions) or keep it as one atomic feature set?
  - **5 sequential WIs: acceptance-fix → gates → triggers → parallel → agentless (Recommended)** — Each WI touches different schema sections of the god-file with clear expand/flatten test boundaries. Foundation WI (acceptance-fix) unblocks the pattern; remaining 4 can be parallel-tracked once foundation merges. Reduces blast radius per PR to ~200-300 LOC changes.
  - **1 atomic WI: all schema additions in single PR** — Treats gates/triggers/parallel/agentless as a cohesive 'ADO 7.2 parity' unit. One comprehensive test suite, one acceptance-test refresh, one CI gate. Users get complete feature set atomically.
- (eng) Acceptance criteria use 'full project CI gate' as pass condition. Should we make test scope explicit per WI or keep the global gate?
  - **Scoped gates per WI: -run TestReleaseDefinition_Gates (Recommended)** — Each WI runs only its new tests + smoke tests for regressions. Faster feedback (30s vs 3min), clearer blame when red. PM can verify each WI independently without waiting for unrelated test flake.
  - **Global gate for all: -run TestReleaseDefinition (all tests)** — Every WI must pass the full test suite before merge. Guarantees no regressions, simplifies AC (same gate everywhere). Higher confidence per merge.
- (eng) INIT-4 says 'confirm token format against live ADO (first WI)' but the spike WI isn't explicitly broken out. Should token-format confirmation be a separate spike WI or inlined into the build WI?
  - **Separate spike WI: INIT-4.1 (token probe) → INIT-4.2 (build permissions) (Recommended)** — Spike is 30min of empirical testing (create definition → query security namespace → log token). If wrong namespace, pivot without throwaway code. Build WI can proceed confidently with confirmed token pattern.
  - **Inline spike into build WI: INIT-4 does probe + build** — Single WI: probe token format, then immediately build with confirmed pattern. Reduces WI overhead.
- (design) How should deployment gates be structured in the HCL schema?
  - **Nested block pattern (matches approvals)** — Use `gates_options {}` nested block for gate-level config, consistent with existing `pre_deploy_approvals` structure. Maintains pattern consistency and clear separation between gate-level options and individual gates.
  - **Flat block pattern** — Put gate-level options (timeout, sampling_interval, etc.) directly in `pre_deployment_gates {}` block without nested gates_options. Simpler for users with basic gates, but breaks consistency with approval pattern.
- (design) Where should definition-level triggers (artifact/schedule) be placed in the schema?
  - **Grouped under triggers container** — Create a top-level `triggers {}` block that contains `artifact_trigger` and `schedule_trigger` sub-blocks. Provides logical grouping for all trigger types, cleaner top-level schema, and easier documentation/discovery.
  - **Top-level trigger blocks** — Each trigger type (artifact_trigger, schedule_trigger) as a separate top-level repeatable block, consistent with existing `environment`, `variable`, `artifact` patterns. No grouping container.
- (design) How should enum values be cased for new fields like parallel_execution?
  - **Preserve ADO camelCase** — Keep Azure DevOps API enum values as-is (multiConfiguration, multiMachine, etc.). The existing provider already uses camelCase for phase_type (agentBasedDeployment). Maintains consistency with established pattern and provides zero-translation mapping to API.
  - **Normalize to snake_case** — Convert ADO camelCase enums to Terraform-idiomatic snake_case (multi_configuration, multi_machine). Requires expand/flatten translation logic but makes HCL more consistent with Terraform ecosystem conventions.
- (dx) Should INIT-1 include refactoring the 1,617-LOC god-file?
  - **Defer refactoring (accept growth) (Recommended)** — Ship feature parity first; refactoring is a separate initiative. The resource will grow to ~2,000 LOC, but delivery is predictable and low-risk.
  - **Refactor before adding schemas** — Stop the bleeding; extract expand/flatten to helper modules first, following the git_permissions pattern (146 LOC via delegation).
  - **Hybrid - extract only new schema logic** — New schemas (gates/triggers/parallel/agentless) go into separate helper files; leave existing code untouched. Incremental improvement without full rewrite.
- (dx) How should provider handle ADO API breaking changes (retention_policy now required)?
  - **Keep schema optional, let ADO validate (Recommended)** — Provider schema reflects 'possible' fields; API validates 'required'. No provider-side breaking change. Runtime errors guide users to fix.
  - **Make fields required in provider schema** — Fail-fast at plan-time with Terraform validation. Better error messages, but requires provider major version bump (breaking change).
  - **Add deprecation warnings, phase in over releases** — Gentle migration path via warnings → errors. Users have time to migrate, but delays full API 7.2 compliance by 2+ release cycles.
- (dx) Should INIT-5 (environment templates) remain spike-gated?
  - **Quick validation (2 hours), then proceed (Recommended)** — Inspect forked SDK for endpoint existence; if present, skip spike and implement. Minimal time investment with high confidence.
  - **Keep spike gate (low-confidence assumption)** — SDK fork may not have endpoint; verify before committing to build. Standard risk mitigation, but adds overhead.
  - **Remove spike, plan implementation directly** — Forked SDK likely has same endpoints as upstream; API documented. Fastest path, but risk of mid-implementation blocker.

### CEO critic

Cost: `$0.2972`

**Flags (auto-resolved):**

- `vision-clarity` — Vision says 'INIT-1 completes release_definition (acceptance-fix + gates/triggers/parallel/agentless schema parity)' but the phrase 'schema parity' is vague — parity with what? The goal later clarifies 'ADO REST API 7.2 feature parity.'. _Applied:_ Replace 'schema parity' with 'ADO REST API 7.2 feature parity' in vision statement for consistency.
- `done-definition-ambiguity` — Vision says 'Done = INIT-1–4 merged CI-green + INIT-5 either merged or spike-parked with documented rationale' but doesn't define what 'CI-green' means (unit tests? acceptance tests? full suite?).. _Applied:_ Define 'CI-green' as 'all unit + acceptance tests passing per the initiative's gate command' in vision.
- `init5-spike-gate-missing` — INIT-5 has a spike-first requirement ('Spike-first, stop-on-fail') but the vision doesn't clarify whether INIT-5 is optional or required for 'Done.' If the spike fails, is the overall initiative complete or incomplete?. _Applied:_ Clarify in vision: 'INIT-5 is optional; Done = INIT-1–4 merged + INIT-5 spike completed (build only if feasible).'
- `init1-acceptance-criteria-test-scope` — INIT-1 acceptance criteria says 'the full project CI gate … is green' but earlier notes say 'Gate pattern: -tags all -count=1 -run <Prefix> scoped to new tests.' These conflict — is the gate scoped to new tests or the full project?. _Applied:_ Change INIT-1 gate to 'scoped to TestReleaseDefinition* prefix' (consistent with INIT-2/3/4/5 pattern).
- `init4-two-namespaces-confusion` — INIT-4 background mentions 'ReleaseManagement (project-level) and ReleaseManagement2 (definition-level)' but doesn't clarify if the resource needs to handle BOTH or just ReleaseManagement2. The title says 'release_definition_permissions' which implies definition-level only.. _Applied:_ Clarify scope: 'betterado_release_definition_permissions uses ReleaseManagement2 namespace (definition-level); project-level ReleaseManagement out of scope.'

**Escalations (taste decisions):**

- The initiative chains 5 sub-initiatives serially to avoid provider.go merge conflicts. Is this the right tradeoff between risk mitigation and delivery velocity?
  - **Keep serial chain (Recommended)** — The PM explicitly calls out 'provider.go registry merge conflicts — forge's #1 historical failure mode.' Given this is a documented pain point with historical data, the serial dependency is a proven risk mitigation. The chain is logical (foundation → additive features → cross-cutting concerns → spike), and each initiative is independently valuable.
  - **Batch provider.go changes** — Treat provider.go registry as pure mechanical overhead. Do INIT-1 (the foundation), then run INIT-2/3/4 in parallel with a final 'registry PR' that adds all 4 lines at once. INIT-5 stays gated behind the spike regardless.
- INIT-1 is the largest initiative (~4 schema additions to a 1618-LOC god-file) but framed as a single unit. Should it remain monolithic or be split?
  - **Keep INIT-1 monolithic** — The PM already flagged the god-file collision risk and said 'size WIs to minimise collision risk within the file.' The 4 schema additions (gates/triggers/parallel/agentless) are described as independently testable. Splitting INIT-1 into 4 sub-initiatives (INIT-1a/b/c/d) would reduce per-WI risk and allow incremental progress.
  - **Split INIT-1 into foundation + 4 additive WIs (Recommended)** — INIT-1a = acceptance-test refresh (the foundation). INIT-1b/c/d/e = gates, triggers, parallel, agentless (each with expand/flatten + unit test). The PM already noted 'each can be a separate WI scoped to its expand/flatten + unit test.' This matches the stated collision-mitigation goal and allows incremental merges.

### Eng critic

Cost: `$0.2823`

**Flags (auto-resolved):**

- `init-2-depends-missing` — INIT-2 (release_folder) has no explicit depends_on despite PM note 'serial chain via depends_on avoids provider.go registry merge conflicts'. _Applied:_ Add 'depends_on: INIT-1' to INIT-2 (release_folder must merge after release_definition acceptance tests pass)
- `init-3-depends-missing` — INIT-3 (data sources) has no explicit depends_on — but data sources reference release definitions, so logically blocked by INIT-1 completion. _Applied:_ Add 'depends_on: INIT-1' to INIT-3 (data sources need stable release_definition schema to reference)
- `init-4-depends-missing` — INIT-4 (permissions) has no explicit depends_on — but permissions apply to release definitions, blocked by INIT-1. _Applied:_ Add 'depends_on: INIT-1' to INIT-4 (permissions resource needs stable release_definition to apply ACLs to)
- `init-5-depends-missing` — INIT-5 (environment templates) has no explicit depends_on — templates are used BY release definitions, blocked by INIT-1. _Applied:_ Add 'depends_on: INIT-1' to INIT-5 (templates are consumed by release_definition; must merge after INIT-1)
- `init-1-ac-verifier-ambiguous` — INIT-1 AC says 'the full project CI gate is green' but doesn't specify WHO runs it (orchestrator? dev?) or WHEN (pre-merge? post-merge?). _Applied:_ Rewrite AC final clause: 'THEN … AND `make test-release` (which runs the CI gate) passes in CI pre-merge'
- `init-2-ac-verifier-ambiguous` — INIT-2 AC says '5 canonical gomock unit tests pass' but doesn't name them — PM can't verify completeness. _Applied:_ Enumerate in AC: 'THEN … AND unit tests pass: TestReleaseFolderResource_ExpandFlatten, TestReleaseFolderResource_CreateError, TestReleaseFolderResource_Read404, TestReleaseFolderResource_Update, TestReleaseFolderResource_DeleteError'
- `init-3-ac-no-notfound-test` — INIT-3 AC says 'unit tests cover read path + not-found error path' but doesn't require acceptance test for not-found (only 'resolve a known definition'). _Applied:_ Add to AC: 'AND acceptance test for nonexistent definition returns clear error (not Terraform crash)'
- `init-4-ac-remove-vs-revoke` — INIT-4 AC says 'assign + read + remove a permission' — 'remove' is ambiguous (delete resource? revoke ACL?). _Applied:_ Clarify AC: 'assign (apply), read (refresh), update (change permission bits), destroy (remove ACL) pass against live ADO'
- `init-5-spike-ac-missing-stop-condition` — INIT-5 spike AC says 'STOP and park' but doesn't define what 'park' means (close initiative? doc in README? GitHub issue?). _Applied:_ Add to spike AC: 'THEN … record finding in docs/architecture/decisions/005-release-templates-not-viable.md and close INIT-5 as wontfix'
- `no-rollback-init-1` — INIT-1 adds required fields (retention_policy, pre_deploy_approval) — existing definitions WITHOUT these will break on refresh. No rollback/migration path stated.. _Applied:_ Add to INIT-1 notes: 'Migration: existing release_definition resources missing retention_policy will fail plan with actionable error. User must add block. No auto-migration (ADO API has no default retention—user intent required).'
- `no-rollback-init-2` — INIT-2 (release_folder) is a new resource — but if a folder is deleted in Terraform, does ADO cascade-delete definitions inside it? Rollback risk unstated.. _Applied:_ Add to INIT-2 notes: 'Rollback: deleting a folder via Terraform will FAIL if definitions exist inside it (ADO API constraint). Acceptance test must verify folder-delete-with-children returns clear error.'
- `no-rollback-init-4` — INIT-4 (permissions) touches ACLs — revoking a permission could lock out the service principal running Terraform. Rollback risk unstated.. _Applied:_ Add to INIT-4 notes: 'Rollback: if the Terraform service principal revokes its own ManagePermissions bit, subsequent applies will 403. Acceptance test must use a separate test identity (not the apply identity) as the permission subject.'
- `init-1-3-files-violated` — INIT-1 (god-file) will touch resource_release_definition.go (~1618 LOC), resource_release_definition_test.go, and schema_release.go — likely >3 files if acceptance tests are separate. _Applied:_ Split INIT-1 into per-feature WIs (see escalation 1) so each WI touches ≤3 files (schema_release.go + resource_release_definition.go + focused test file)

**Escalations (taste decisions):**

- INIT-1 is a ~1618-LOC god-file with 4 additive schema features. Should we split it into 5 sequential work items (acceptance-fix foundation + 4 parallel schema additions) or keep it as one atomic feature set?
  - **5 sequential WIs: acceptance-fix → gates → triggers → parallel → agentless (Recommended)** — Each WI touches different schema sections of the god-file with clear expand/flatten test boundaries. Foundation WI (acceptance-fix) unblocks the pattern; remaining 4 can be parallel-tracked once foundation merges. Reduces blast radius per PR to ~200-300 LOC changes.
  - **1 atomic WI: all schema additions in single PR** — Treats gates/triggers/parallel/agentless as a cohesive 'ADO 7.2 parity' unit. One comprehensive test suite, one acceptance-test refresh, one CI gate. Users get complete feature set atomically.
- Acceptance criteria use 'full project CI gate' as pass condition. Should we make test scope explicit per WI or keep the global gate?
  - **Scoped gates per WI: -run TestReleaseDefinition_Gates (Recommended)** — Each WI runs only its new tests + smoke tests for regressions. Faster feedback (30s vs 3min), clearer blame when red. PM can verify each WI independently without waiting for unrelated test flake.
  - **Global gate for all: -run TestReleaseDefinition (all tests)** — Every WI must pass the full test suite before merge. Guarantees no regressions, simplifies AC (same gate everywhere). Higher confidence per merge.
- INIT-4 says 'confirm token format against live ADO (first WI)' but the spike WI isn't explicitly broken out. Should token-format confirmation be a separate spike WI or inlined into the build WI?
  - **Separate spike WI: INIT-4.1 (token probe) → INIT-4.2 (build permissions) (Recommended)** — Spike is 30min of empirical testing (create definition → query security namespace → log token). If wrong namespace, pivot without throwaway code. Build WI can proceed confidently with confirmed token pattern.
  - **Inline spike into build WI: INIT-4 does probe + build** — Single WI: probe token format, then immediately build with confirmed pattern. Reduces WI overhead.

### Design critic

Cost: `$1.1163`

**Flags (auto-resolved):**

- `data-source-docs` — INIT-3 missing data source documentation requirements. _Applied:_ Added WI requirement: Create /docs/data-sources/release_definition.md and release_definitions.md following resource doc structure (Example Usage → Args → Attributes)
- `permissions-naming` — INIT-4 unclear if two permission resources needed (project-level vs definition-level namespaces). _Applied:_ Added clarification to INIT-4 acceptance criteria: Confirm if ReleaseManagement (project) and ReleaseManagement2 (definition) require separate resources; split WI if needed
- `folder-import` — INIT-2 release_folder missing import support pattern. _Applied:_ Added to INIT-2 acceptance criteria: Implement import using tfhelper.ImportProjectQualifiedResource() and document PROJECT_ID/FOLDER_ID pattern
- `retention-docs` — retention_policy docs say Optional but API now requires it. _Applied:_ Added to INIT-1: Update /docs/resources/release_definition.md line 191 to mark retention_policy as (Required) with note about API 7.2+ enforcement
- `gate-validation` — Gates timeout field needs validation (must exceed sampling_interval). _Applied:_ Added to INIT-1 acceptance criteria: Implement ValidateFunc ensuring timeout > sampling_interval to prevent invalid gate configurations
- `cron-validation` — Schedule trigger needs cron expression validation at plan time. _Applied:_ Added to INIT-1 acceptance criteria: Implement ValidateFunc for schedule_trigger cron expressions to fail fast on invalid schedules

**Escalations (taste decisions):**

- How should deployment gates be structured in the HCL schema?
  - **Nested block pattern (matches approvals)** — Use `gates_options {}` nested block for gate-level config, consistent with existing `pre_deploy_approvals` structure. Maintains pattern consistency and clear separation between gate-level options and individual gates.
  - **Flat block pattern** — Put gate-level options (timeout, sampling_interval, etc.) directly in `pre_deployment_gates {}` block without nested gates_options. Simpler for users with basic gates, but breaks consistency with approval pattern.
- Where should definition-level triggers (artifact/schedule) be placed in the schema?
  - **Grouped under triggers container** — Create a top-level `triggers {}` block that contains `artifact_trigger` and `schedule_trigger` sub-blocks. Provides logical grouping for all trigger types, cleaner top-level schema, and easier documentation/discovery.
  - **Top-level trigger blocks** — Each trigger type (artifact_trigger, schedule_trigger) as a separate top-level repeatable block, consistent with existing `environment`, `variable`, `artifact` patterns. No grouping container.
- How should enum values be cased for new fields like parallel_execution?
  - **Preserve ADO camelCase** — Keep Azure DevOps API enum values as-is (multiConfiguration, multiMachine, etc.). The existing provider already uses camelCase for phase_type (agentBasedDeployment). Maintains consistency with established pattern and provides zero-translation mapping to API.
  - **Normalize to snake_case** — Convert ADO camelCase enums to Terraform-idiomatic snake_case (multi_configuration, multi_machine). Requires expand/flatten translation logic but makes HCL more consistent with Terraform ecosystem conventions.

### DX critic

Cost: `$1.1271`

**Flags (auto-resolved):**

- `F1` — Serial chain is unnecessary - all initiatives register different resource names. _Applied:_ Document that parallel execution is safe; use branch-per-initiative + CI gating instead of serial dependency
- `F2` — Acceptance test failures are data issues, not schema gaps. _Applied:_ Clarify that INIT-1 acceptance refresh is test-data fix (add valid retention_policy + approver blocks to fixtures), not schema implementation
- `F3` — INIT-1 WI scoping mixes refactoring with feature work. _Applied:_ Split INIT-1 into two phases: (a) acceptance-fix + existing unit tests green; (b) additive schema work with per-schema unit tests
- `F4` — Missing rollback/deprecation strategy for API breaking changes. _Applied:_ Document that ADO API compatibility is provider's contract; consider migration guide if changing field requirements
- `F5` — INIT-4 permissions token format positioned as high-risk spike. _Applied:_ Clarify token-format validation is low-risk (follows git_permissions pattern); expect ~1 hour validation, not multi-day investigation

**Escalations (taste decisions):**

- Should INIT-1 include refactoring the 1,617-LOC god-file?
  - **Defer refactoring (accept growth) (Recommended)** — Ship feature parity first; refactoring is a separate initiative. The resource will grow to ~2,000 LOC, but delivery is predictable and low-risk.
  - **Refactor before adding schemas** — Stop the bleeding; extract expand/flatten to helper modules first, following the git_permissions pattern (146 LOC via delegation).
  - **Hybrid - extract only new schema logic** — New schemas (gates/triggers/parallel/agentless) go into separate helper files; leave existing code untouched. Incremental improvement without full rewrite.
- How should provider handle ADO API breaking changes (retention_policy now required)?
  - **Keep schema optional, let ADO validate (Recommended)** — Provider schema reflects 'possible' fields; API validates 'required'. No provider-side breaking change. Runtime errors guide users to fix.
  - **Make fields required in provider schema** — Fail-fast at plan-time with Terraform validation. Better error messages, but requires provider major version bump (breaking change).
  - **Add deprecation warnings, phase in over releases** — Gentle migration path via warnings → errors. Users have time to migrate, but delays full API 7.2 compliance by 2+ release cycles.
- Should INIT-5 (environment templates) remain spike-gated?
  - **Quick validation (2 hours), then proceed (Recommended)** — Inspect forked SDK for endpoint existence; if present, skip spike and implement. Minimal time investment with high confidence.
  - **Keep spike gate (low-confidence assumption)** — SDK fork may not have endpoint; verify before committing to build. Standard risk mitigation, but adds overhead.
  - **Remove spike, plan implementation directly** — Forked SDK likely has same endpoints as upstream; API documented. Fastest path, but risk of mid-implementation blocker.

## Proposed initiatives

| ID | Title | Iteration budget | Depends on |
|---|---|---|---|
| `INIT-2026-06-05-complete-release-definition` | Complete betterado_release_definition (feature-complete + acceptance-green) | 12 | — |
| `INIT-2026-06-05-release-folder` | betterado_release_folder resource | 4 | INIT-2026-06-05-complete-release-definition |
| `INIT-2026-06-05-release-data-sources` | Release data sources (data.betterado_release_definition + data.betterado_release_definitions) | 4 | INIT-2026-06-05-release-folder |
| `INIT-2026-06-05-release-definition-permissions` | betterado_release_definition_permissions resource | 6 | INIT-2026-06-05-release-data-sources |
| `INIT-2026-06-05-environment-templates-spike` | Release environment templates (spike-gated) | 8 | INIT-2026-06-05-release-definition-permissions |

### INIT-2026-06-05-complete-release-definition — drawer

```markdown
## Goal

`betterado_release_definition` reaches ADO REST API 7.2 feature parity and all its tests (unit + acceptance) pass against live Azure DevOps.

## Background

The resource exists with 11 passing gomock unit tests, but its 6 acceptance tests fail live (`VS402982` — stage-level `retention_policy` now required; `VS402877` — pre/post approvals now required). Schema gaps remain: deployment gates, definition triggers, parallel execution, and agentless phase input.

**CRITICAL:** `resource_release_definition.go` is a ~1618-LOC god-file. The PM must size WIs to minimise collision risk within the file.

## Acceptance criteria

**Given** the existing `betterado_release_definition` resource with failing acceptance tests and incomplete schema,
**When** acceptance tests are refreshed with required `retention_policy` and `pre_deploy_approval` blocks, AND deployment gates (`pre_deployment_gates`/`post_deployment_gates` with `gatesOptions`: isEnabled/timeout/samplingInterval/stabilizationTime/minimumSuccessDuration), definition triggers (CD artifact trigger + schedule trigger), parallel execution (`deployment_input.parallel_execution`: none/multiConfiguration/multiMachine), and agentless phase (`runOnServer` deployment-input variant) are implemented,
**Then** the new schema round-trips (expand/flatten gomock unit tests pass), a release definition exercising gates + CD trigger + parallel phase + agentless phase applies/reads-back/destroys cleanly against live ADO, and the full project CI gate (`go test -mod=vendor -tags all -count=1 -run TestReleaseDefinition ./azuredevops/internal/service/release/`) is green.

## Notes for PM

- Acceptance-test refresh is the foundation — later initiatives' acceptance tests depend on this pattern working.
- Gates/triggers/parallel/agentless are schema-additive; each can be a separate WI scoped to its expand/flatten + unit test.
- Live ADO creds available via `secrets.env`; use `TF_ACC=1` for acceptance tests.
- Gate pattern: `-tags all -count=1 -run <Prefix>` scoped to new tests.
```

### INIT-2026-06-05-release-folder — drawer

```markdown
## Goal

Manage Azure DevOps Release folder hierarchy as Terraform desired-state.

## Background

Release definitions live in folders (`/` by default). The ADO REST API exposes `/release/folders` with CreateFolder/UpdateFolder/DeleteFolder/GetFolders — already mocked in `MockReleaseClient`. This is a small, additive CRUD resource.

## Acceptance criteria

**Given** no `betterado_release_folder` resource exists,
**When** the resource is implemented with fields `project_id`, `path`, `description`, registered in `provider.go`, and documented with an example,
**Then** create a folder at a path, read it back, update its description, destroy it — all pass against live ADO; 5 canonical gomock unit tests (expand/flatten roundtrip, create-error, read-404-clears-id, update-args, delete-error) pass; CI gate is green.

## Notes for PM

- Use the `CreateFolder` POST variant (PUT `Create` is deprecated).
- Adds one line to `provider.go` resource registry — the reason for the serial chain.
- Gate: `go test -mod=vendor -tags all -count=1 -run TestReleaseFolder ./azuredevops/internal/service/release/`.
```

### INIT-2026-06-05-release-data-sources — drawer

```markdown
## Goal

Look up release pipelines by id/name and list them for cross-referencing in Terraform configs.

## Background

Terraform users need to reference existing release definitions (e.g., to set permissions or wire artifacts). The SDK already exposes `GetReleaseDefinition` (by id) and `GetReleaseDefinitions` (list with filters).

## Acceptance criteria

**Given** no release data sources exist,
**When** `data.betterado_release_definition` (by id or name via `GetReleaseDefinition`) and `data.betterado_release_definitions` (list via `GetReleaseDefinitions`) are implemented, registered in the data-source map in `provider.go`, and documented with examples,
**Then** both data sources resolve a known definition's attributes against live ADO; unit tests cover the read path + not-found error path; CI gate is green.

## Notes for PM

- Adds two lines to `provider.go` data-source registry.
- Data sources are read-only — simpler than resources (no create/update/delete).
- Gate: `go test -mod=vendor -tags all -count=1 -run 'TestDataReleaseDefinition|TestDataReleaseDefinitions' ./azuredevops/internal/service/release/`.
```

### INIT-2026-06-05-release-definition-permissions — drawer

```markdown
## Goal

Assign permissions on release definitions as Terraform desired-state.

## Background

The provider already has the `ReleaseManagement` (project-level) and `ReleaseManagement2` (definition-level) security namespaces registered, plus an existing permissions scaffolding pattern (see `resource_git_permissions.go`). The two namespaces have different token patterns — confirming the token format against live ADO is the first risk to retire.

## Acceptance criteria

**Given** no release permissions resource exists and the token format for release permissions is unconfirmed,
**When** the release permission token format is confirmed against live ADO (first WI), AND `betterado_release_definition_permissions` is implemented mirroring the existing `*_permissions` pattern, registered in `provider.go`, and documented with an example,
**Then** assign + read + remove a permission on a release definition passes against live ADO; unit tests cover the token-derivation logic; CI gate is green.

## Notes for PM

- **First WI must be spike: confirm token format** — the two namespaces (`ReleaseManagement` vs `ReleaseManagement2`) have different token patterns. Confirm empirically before building.
- Follow the pattern in `resource_git_permissions.go`.
- Gate: `go test -mod=vendor -tags all -count=1 -run TestReleaseDefinitionPermissions ./azuredevops/internal/service/release/`.
```

### INIT-2026-06-05-environment-templates-spike — drawer

```markdown
## Goal

Manage reusable stage/environment templates as Terraform desired-state — **if** the platform supports it through the provider's client.

## Background

Environment templates are stage blueprints users create once and reuse across release definitions. The ADO REST API has `…/release/definitions/environmenttemplates`. Whether the vendored `microsoft/azure-devops-go-api` v7 exposes this endpoint (or whether a raw-HTTP path via `azuredevops.Connection` is viable) is unknown.

## Acceptance criteria

### Spike (gate — first WI)

**Given** uncertainty about SDK/API support for environment templates,
**When** the vendored SDK is inspected for the environmenttemplates endpoint AND (if absent) a raw-HTTP probe via `azuredevops.Connection` is attempted,
**Then** a documented feasibility verdict + chosen client path is recorded. If neither is viable, STOP and park the resource with the finding — do NOT vendor-patch.

### Build (only if spike passes)

**Given** a viable client path confirmed by the spike,
**When** `betterado_release_definition_environment_template` (create/read/delete — templates are immutable, no update) is implemented, registered in `provider.go`, and documented with an example,
**Then** create a template, read it back, delete it — all pass against live ADO; expand/flatten unit tests pass; CI gate is green.

## Notes for PM

- **Spike-first, stop-on-fail.** Do NOT proceed to build if the spike fails — record the finding and close the initiative as parked.
- Templates are immutable: create + read + delete only (no update).
- This is the one genuine unknown in the roadmap; the spike de-risks before build cost.
- Gate (if build proceeds): `go test -mod=vendor -tags all -count=1 -run TestReleaseDefinitionEnvironmentTemplate ./azuredevops/internal/service/release/`.
```

## Aggregate footprint (informational)

_This block surfaces the **informational** footprint of the proposed initiatives — how many cycles + dollars they would consume if every one were queued today. It is informational only; forge does not enforce a budget or block at any number._

- Initiatives proposed: **5**
- Total iteration budget: **34**

## Open escalations

_These taste decisions the council surfaced are unresolved. Resolve each on the `/architect` plan gate — your selection is applied at approval._

- (CEO) The initiative chains 5 sub-initiatives serially to avoid provider.go merge conflicts. Is this the right tradeoff between risk mitigation and delivery velocity?
  - **Keep serial chain (Recommended)** — The PM explicitly calls out 'provider.go registry merge conflicts — forge's #1 historical failure mode.' Given this is a documented pain point with historical data, the serial dependency is a proven risk mitigation. The chain is logical (foundation → additive features → cross-cutting concerns → spike), and each initiative is independently valuable.
  - **Batch provider.go changes** — Treat provider.go registry as pure mechanical overhead. Do INIT-1 (the foundation), then run INIT-2/3/4 in parallel with a final 'registry PR' that adds all 4 lines at once. INIT-5 stays gated behind the spike regardless.
- (CEO) INIT-1 is the largest initiative (~4 schema additions to a 1618-LOC god-file) but framed as a single unit. Should it remain monolithic or be split?
  - **Keep INIT-1 monolithic** — The PM already flagged the god-file collision risk and said 'size WIs to minimise collision risk within the file.' The 4 schema additions (gates/triggers/parallel/agentless) are described as independently testable. Splitting INIT-1 into 4 sub-initiatives (INIT-1a/b/c/d) would reduce per-WI risk and allow incremental progress.
  - **Split INIT-1 into foundation + 4 additive WIs (Recommended)** — INIT-1a = acceptance-test refresh (the foundation). INIT-1b/c/d/e = gates, triggers, parallel, agentless (each with expand/flatten + unit test). The PM already noted 'each can be a separate WI scoped to its expand/flatten + unit test.' This matches the stated collision-mitigation goal and allows incremental merges.
- (eng) INIT-1 is a ~1618-LOC god-file with 4 additive schema features. Should we split it into 5 sequential work items (acceptance-fix foundation + 4 parallel schema additions) or keep it as one atomic feature set?
  - **5 sequential WIs: acceptance-fix → gates → triggers → parallel → agentless (Recommended)** — Each WI touches different schema sections of the god-file with clear expand/flatten test boundaries. Foundation WI (acceptance-fix) unblocks the pattern; remaining 4 can be parallel-tracked once foundation merges. Reduces blast radius per PR to ~200-300 LOC changes.
  - **1 atomic WI: all schema additions in single PR** — Treats gates/triggers/parallel/agentless as a cohesive 'ADO 7.2 parity' unit. One comprehensive test suite, one acceptance-test refresh, one CI gate. Users get complete feature set atomically.
- (eng) Acceptance criteria use 'full project CI gate' as pass condition. Should we make test scope explicit per WI or keep the global gate?
  - **Scoped gates per WI: -run TestReleaseDefinition_Gates (Recommended)** — Each WI runs only its new tests + smoke tests for regressions. Faster feedback (30s vs 3min), clearer blame when red. PM can verify each WI independently without waiting for unrelated test flake.
  - **Global gate for all: -run TestReleaseDefinition (all tests)** — Every WI must pass the full test suite before merge. Guarantees no regressions, simplifies AC (same gate everywhere). Higher confidence per merge.
- (eng) INIT-4 says 'confirm token format against live ADO (first WI)' but the spike WI isn't explicitly broken out. Should token-format confirmation be a separate spike WI or inlined into the build WI?
  - **Separate spike WI: INIT-4.1 (token probe) → INIT-4.2 (build permissions) (Recommended)** — Spike is 30min of empirical testing (create definition → query security namespace → log token). If wrong namespace, pivot without throwaway code. Build WI can proceed confidently with confirmed token pattern.
  - **Inline spike into build WI: INIT-4 does probe + build** — Single WI: probe token format, then immediately build with confirmed pattern. Reduces WI overhead.
- (design) How should deployment gates be structured in the HCL schema?
  - **Nested block pattern (matches approvals)** — Use `gates_options {}` nested block for gate-level config, consistent with existing `pre_deploy_approvals` structure. Maintains pattern consistency and clear separation between gate-level options and individual gates.
  - **Flat block pattern** — Put gate-level options (timeout, sampling_interval, etc.) directly in `pre_deployment_gates {}` block without nested gates_options. Simpler for users with basic gates, but breaks consistency with approval pattern.
- (design) Where should definition-level triggers (artifact/schedule) be placed in the schema?
  - **Grouped under triggers container** — Create a top-level `triggers {}` block that contains `artifact_trigger` and `schedule_trigger` sub-blocks. Provides logical grouping for all trigger types, cleaner top-level schema, and easier documentation/discovery.
  - **Top-level trigger blocks** — Each trigger type (artifact_trigger, schedule_trigger) as a separate top-level repeatable block, consistent with existing `environment`, `variable`, `artifact` patterns. No grouping container.
- (design) How should enum values be cased for new fields like parallel_execution?
  - **Preserve ADO camelCase** — Keep Azure DevOps API enum values as-is (multiConfiguration, multiMachine, etc.). The existing provider already uses camelCase for phase_type (agentBasedDeployment). Maintains consistency with established pattern and provides zero-translation mapping to API.
  - **Normalize to snake_case** — Convert ADO camelCase enums to Terraform-idiomatic snake_case (multi_configuration, multi_machine). Requires expand/flatten translation logic but makes HCL more consistent with Terraform ecosystem conventions.
- (dx) Should INIT-1 include refactoring the 1,617-LOC god-file?
  - **Defer refactoring (accept growth) (Recommended)** — Ship feature parity first; refactoring is a separate initiative. The resource will grow to ~2,000 LOC, but delivery is predictable and low-risk.
  - **Refactor before adding schemas** — Stop the bleeding; extract expand/flatten to helper modules first, following the git_permissions pattern (146 LOC via delegation).
  - **Hybrid - extract only new schema logic** — New schemas (gates/triggers/parallel/agentless) go into separate helper files; leave existing code untouched. Incremental improvement without full rewrite.
- (dx) How should provider handle ADO API breaking changes (retention_policy now required)?
  - **Keep schema optional, let ADO validate (Recommended)** — Provider schema reflects 'possible' fields; API validates 'required'. No provider-side breaking change. Runtime errors guide users to fix.
  - **Make fields required in provider schema** — Fail-fast at plan-time with Terraform validation. Better error messages, but requires provider major version bump (breaking change).
  - **Add deprecation warnings, phase in over releases** — Gentle migration path via warnings → errors. Users have time to migrate, but delays full API 7.2 compliance by 2+ release cycles.
- (dx) Should INIT-5 (environment templates) remain spike-gated?
  - **Quick validation (2 hours), then proceed (Recommended)** — Inspect forked SDK for endpoint existence; if present, skip spike and implement. Minimal time investment with high confidence.
  - **Keep spike gate (low-confidence assumption)** — SDK fork may not have endpoint; verify before committing to build. Standard risk mitigation, but adds overhead.
  - **Remove spike, plan implementation directly** — Forked SDK likely has same endpoints as upstream; API documented. Fastest path, but risk of mid-implementation blocker.

---

_Generated by the architect runner on 2026-06-05T11:26:13.961Z. Reviewed + approved on the `/architect` screen in the forge UI._
