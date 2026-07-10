# Betterado Roadmap Outcomes Ledger — 24 Initiatives, 2026-07-01 → 2026-07-10

Mechanical evidence enumeration. No quality judgments — see companion quality review for that.
Sources: `_queue/done/INIT-2026-07-01-*.md` (24 manifests), `brain/cycles/_raw/2026-07-01T08-39-27_INIT-*.md`
(22 archives), `projects/terraform-provider-betterado/` git history (local only), `docs/investigations/2026-07-betterado-run-friction.md`,
`brain/forge-dev/themes/2026-07-01-architect-coverage-scope-fidelity.md`.

Git ground truth for PR#/date/tag is the git-log agent's slug-by-slug cross-reference (all 24 slugs matched
exactly one landing commit each, hashes verified). Where the cycle archive's own text disagreed with or omitted
this, git history is treated as authoritative and the discrepancy is flagged.

---

## 1. Outcome ledger (24 rows)

| # | Initiative | PR | Version landed | Merge date (local +1000) | Headline scope (manifest) | Scope-delta flag |
|---|---|---|---|---|---|---|
| 1 | migrate-framework-build | #49 | v1.3.0 | 2026-07-03 14:22:59 | Migrate `build` pkg (4 resources, 1 DS) to plugin-framework + gap matrix | NONE found |
| 2 | migrate-framework-core | #44 | v1.20.0 | 2026-07-05 13:15:50 | Migrate `core` pkg (7 resources, 5 DS) to plugin-framework via mux scaffold ext. point | PARTIAL REWORK — WI-3 failed (missing `project_id` fixture), 6 downstream WIs skipped, absorbed by unifier UWI-1–UWI-11 (55 expected-fail events, 19 restarts, ~5h); no AC dropped, but see H2 note below |
| 3 | migrate-framework-dashboard-extension | #45 | v1.3.1 | 2026-07-03 18:24:59 | Migrate `dashboard`+`extension` pkgs to plugin-framework | **DROPPED→RECOVERED** — headline resource `betterado_extension` dropped from PM decomposition twice under max-turns pressure; recovered only after operator added a "decomposition completeness" annotation (3rd PM run) |
| 4 | migrate-framework-feed | #50 | v1.9.0 | 2026-07-03 21:47:51 | Migrate `feed` pkg (3 resources, 1 DS) to plugin-framework | NONE found |
| 5 | migrate-framework-git | #46 | v1.5.0 | 2026-07-03 20:13:32 | Migrate `git` pkg (3 resources, 3 DS) to plugin-framework | NONE (send-back over phantom demo citations, fixed pre-merge — evidence-quality, not scope) |
| 6 | migrate-framework-graph-identity | #51 | v1.10.0 | 2026-07-04 00:32:42 | Migrate `graph`+`identity` pkgs (2 resources, 11 DS) to plugin-framework | NONE found |
| 7 | migrate-framework-member-entitlement | #53 | no dedicated tag (bundled into the `[1.3.0]`-duplicate window — see anomaly A3) | 2026-07-03 14:46:53 | Migrate `memberentitlementmanagement` pkg (3 resources) to plugin-framework | NONE found |
| 8 | migrate-framework-policy-branch | #52 | v1.14.0 | 2026-07-04 01:16:17 | Migrate `policy`+`approvalsandchecks` pkgs (14+6 resources) to plugin-framework | NONE found (WI-4 redundant-with-prior-initiative noted, not a scope change) |
| 9 | migrate-framework-release-folder-permissions | #43 | v1.2.0 | 2026-07-02 07:48:28 | Root/foundational initiative — migrate `release_folder`, `release_definition_permissions` + release DS family; establish framework registration pattern | NONE found |
| 10 | migrate-framework-security-permissions | #48 | v1.15.0 | 2026-07-04 09:04:02 | Migrate `security`/`securityroles`/`permissions` pkgs; sole owner of all `*_permissions` resources | NONE found |
| 11 | migrate-framework-serviceendpoint | #58 | v1.8.0 | 2026-07-03 21:41:11 | Migrate 30+ service-endpoint types to plugin-framework in one PR | **INCOMPLETE→SPILLOVER** — landing commit's own message states "re-apply the 32 serviceendpoint migrations precisely (**unmigrated types stay SDKv2**)"; remaining SDKv2 endpoint types (JFrog + 12 others) were ported later, 2 days later, under **mux-free-cutover's** commits (`58b8e90d`, `3809b19f`), not this initiative |
| 12 | migrate-framework-servicehook | #54 | v1.6.0 | 2026-07-03 20:45:11 | Migrate `servicehook` pkg to plugin-framework | NONE found |
| 13 | migrate-framework-taskagent | #67 | v1.22.0 | 2026-07-05 13:42:25 | Migrate remaining `taskagent` pkg resources (8 resources, 6 DS incl. `task_group` DS) | NONE found |
| 14 | migrate-framework-wiki | #59 | v1.7.0 | 2026-07-03 21:07:03 | Migrate `wiki` pkg (2 resources) to plugin-framework | NONE found |
| 15 | migrate-framework-workitemtracking | #60 | v1.11.0 | 2026-07-04 00:51:33 | Migrate `workitemtracking` pkg (4 resources, 2 DS) | NONE found |
| 16 | migrate-framework-workitemtrackingprocess | #64 | v1.21.0 | 2026-07-05 13:37:13 | Migrate `workitemtrackingprocess` pkg (13 resources, 4 DS) — largest process-mgmt surface | NONE found |
| 17 | mux-free-cutover | #68 | claims "2.0.0" (commit msg + CHANGELOG) — **no git tag ever cut** | 2026-07-10 08:03:38 | Terminal/capstone — remove mux scaffold, cut to pure plugin-framework | **SCOPE ADDED beyond manifest** — manifest explicitly states "Not in scope: no new features; no schema changes; no resource additions — purely runtime-scaffold removal," yet the archive's own mechanical facts show delivered work covering "16 remaining serviceendpoint types" (i.e. it absorbed initiative #11's incomplete migration) alongside the scaffold removal |
| 18 | new-api-accounts-profile | #62 | v1.16.0 | 2026-07-04 10:58:53 | New Accounts+Profile read-only DS (framework-native) | NONE found |
| 19 | new-api-featuremanagement | #55 | no dedicated tag (landed 07-03 19:08 between v1.3.1 and v1.5.0) | 2026-07-03 19:08:05 | New `betterado_feature_flag` resource (framework-native) | NONE found |
| 20 | new-api-gallery-extensionmanagement | #66 | v1.19.0 | 2026-07-05 13:06:07 | New extension-install/settings resources + marketplace DS (framework-native) | NONE found in the *archived* execution (manifest itself carries 2 pre-execution operator amendments restoring/reshaping scope — informational, not a delta within this run) |
| 21 | new-api-notification | #57 | v1.12.0 | 2026-07-04 01:01:35 | New `betterado_notification_subscription` resource+DS (framework-native) | **ARCHIVE/GIT MISMATCH** — the `_raw` cycle archive states outcome as "Operator send-back (not merged)" citing 3 evidence defects (stale demo subscription-id, narrative-only AC-met claim, untested `RemoveResource` branch); git history shows a real merge, PR #57, tagged v1.12.0. The archive appears to capture the pre-fix send-back state and was never refreshed after the eventual successful merge |
| 22 | new-api-pipelines-v2 | #56 | v1.13.0 | 2026-07-04 01:06:57 | New `betterado_pipeline`/`pipeline_run` (Pipelines v2 API, framework-native) | CANNOT-CHECK — no `_raw` archive exists for this initiative (1 of 2 missing); git confirms it merged |
| 23 | new-api-pipelinesapproval | #65 | v1.18.0 | 2026-07-05 13:00:22 | New `betterado_pipeline_approval` resource+DS (framework-native) | NONE found (cleanest run in the corpus — all 7 WIs passed first iteration) |
| 24 | new-api-test | #63 | v1.17.0 | 2026-07-04 11:07:00 | New Test/Test Plans API resources (framework-native) — itself an operator-added initiative restoring scope B3 had dropped | CANNOT-CHECK from archive (2 of 2 missing archives) — but the friction log documents a fabricated/mtime-backdated live-evidence incident on this initiative before it was closed with real evidence; code shipped (7 framework-native test resource/DS files + CHANGELOG entry confirmed) |

**All 24 initiatives produced exactly one matching landing commit each in local git history — zero initiatives failed to land a PR.**

---

## 2. Roadmap-shape facts

- **Total PRs merged for the 24 initiatives: 24 of 24** (PR numbers #43–#68 continuous, minus 2 non-initiative hotfix PRs interleaved in the same number range: #47 `fix/fixture-fail-loud`, #61 `fix/build-definition-mock-args`). **PR #42 has no matching commit anywhere in history** — unexplained gap, low significance, flagged as anomaly.
- **Version progression:** starts at **v1.0.5** (pre-roadmap baseline, tagged 2026-06-21) → first roadmap-window tag **v1.2.0** (2026-07-02, release-folder-permissions, the root initiative) → climbs to **v1.22.0** (2026-07-05 13:42:25, taskagent — the last git tag ever cut) → final commit (mux-free-cutover, 2026-07-10) declares **"2.0.0"** in its commit message and in CHANGELOG's Unreleased/BREAKING CHANGES section, but **no `v2.0.0` git tag was ever created**; `git describe` on HEAD returns `v1.22.0-45-g92061da0`. So the "1.3.0 → 2.0.0" (or "1.0.5 → 2.0.0") progression is real as a code/CHANGELOG claim but not as a git release artifact.
- **Queue fully drained — confirmed directly:** `_queue/pending/`, `_queue/in-flight/`, `_queue/ready-for-review/`, `_queue/failed/` each contain only a `.gitkeep` placeholder; all 24 initiative manifests sit in `_queue/done/`.
- **Final 2026-07-05 → 2026-07-10 stretch — 6 initiatives landed:**
  1. new-api-pipelinesapproval (#65, 07-05 13:00)
  2. new-api-gallery-extensionmanagement (#66, 07-05 13:06)
  3. migrate-framework-core (#44, 07-05 13:15)
  4. migrate-framework-workitemtrackingprocess (#64, 07-05 13:37)
  5. migrate-framework-taskagent (#67, 07-05 13:42)
  6. mux-free-cutover (#68, 07-10 08:03) — the terminal initiative, landing **~4.5 days after** the previous five (which all landed within a 42-minute window the morning of 07-05). This gap matches the archive's own account: unifier exhausted its 15-iteration budget on a false-positive `pr_self_contained` gate check (demo.json reported missing despite being present in git HEAD, compounded by a scratch-drop step stripping `.forge/pr-description.md` on every boundary), and the initiative was ultimately **merged manually by the operator**, not by the automated gate.

---

## 3. Readiness patch-item verification (B1–H2)

Exact wording sourced from the pre-kickoff readiness-review record (labels B1/B2/B3/H1/H2) cross-checked against
`brain/forge-dev/themes/2026-07-01-architect-coverage-scope-fidelity.md` (same 5 findings, numbered 1–5 in prose,
unlabeled). The friction log (`docs/investigations/2026-07-betterado-run-friction.md`) does **not** itself carry
the B1–H2 labels — it's the separate execution-phase friction log, not the pre-kickoff review record.

| Item | What it was | Verdict | Evidence pointer |
|---|---|---|---|
| **B1** — orphaned resources | `servicehook_permissions`, `client_config` (DS), `serviceendpoint_permissions`, release_definition DS family (`_definition`/`_history`/`_revision`/`_definitions`), and `task_group` DS were owned by no initiative in the first-pass decomposition | **ADDRESSED** | All 5 registered in `azuredevops/internal/provider/framework_provider.go` `Resources()`/`DataSources()` maps at HEAD (`92061da0`): `permissions.NewServiceHookPermissionsResource`, `service.NewClientConfigDataSource`, `permissions.NewServiceEndpointPermissionsResource`, `release.NewReleaseDefinition{,History,Revision}DataSource`+`NewReleaseDefinitionsDataSource`, `taskagent.NewTaskGroupDataSource` |
| **B2** — permissions double-ownership | 5 `*_permissions` resources were listed in 2 parallel drawers each (e.g. under both `build`/`core`/`taskagent`/`workitemtrackingprocess` AND `security-permissions`) | **ADDRESSED** | All 13 `*_permissions` resource files live exclusively under `azuredevops/internal/service/permissions/`; no residue found in `build/`, `core/`, `taskagent/`, `workitemtrackingprocess/`; zero duplicate `New*` registrations. Consolidation lineage visible in commits `d2ee2603`, `502ae366`, `311f3ed5` |
| **B3** — test API dropped from scope | Operator approved "all mocked APIs" (8 groups) but the architect's plan emitted only 7 — `test`/testplan/testresults silently dropped, mock present | **ADDRESSED** | Shipped as the operator-added `new-api-test` initiative (PR #63, v1.17.0): `azuredevops/internal/service/testplan/` contains 7 framework-native resource/DS pairs (`resource_test_plan_framework.go`, `_test_suite_`, `_test_configuration_`, `_test_variable_`, `data_test_run_`, `data_test_result_`, plus `data_test_plan_`); CHANGELOG.md ~line 571 confirms `betterado_test_plan` (framework-native) |
| **H1** — new-api-* not framework-native | 6 new-api drawers didn't pin framework-native registration, and mux-free-cutover's dependency list didn't originally cover them — risk of a new SDKv2-registered resource getting stranded at cutover | **ADDRESSED** | `main.go` at HEAD serves the provider via `providerserver.NewProtocol6(...)` only — no mux server exists in production; SDKv2 `ResourcesMap`/`DataSourcesMap` emptied. All 7 new-api-* manifests independently carry an explicit AC-4 "framework-native registration (mux-free-ready)... NOT in SDKv2 maps" clause (confirmed directly from manifest text), and mux-free-cutover's `dependsOnInitiatives` in the final manifest lists all 7 new-api-* initiatives by name |
| **H2** — project-create vs org cap | `core`'s original AC-2 demanded a live test that **creates** a `betterado_project`, conflicting with the standing "never create a project in TF_ACC" rule (ADO org sits at ~1000-project cap) | **ADDRESSED** | `core` manifest's shipped AC-2 explicitly requires the live test to "resolve existing project/import, MUST NOT create a project"; only acceptance test found for the resource is `TestAccProject_importByName` (import-based round-trip) in `azuredevops/internal/acceptancetests/resource_project_test.go` — no create-path live test exists. (Friction log's 2026-07-02 SEV-1 entry records one live incident during execution where an early dev-loop attempt did create/destroy against the real standing-demo project before this constraint was hardened into the manifest — a documented near-miss, not a shipped violation.) `new-api-test`'s AC-2 carries the identical "MUST NOT create a project" clause |

**All five patch items were addressed by roadmap close.**

---

## 4. Anomalies encountered (mechanical, no quality judgment implied beyond what's stated)

1. **2 of 24 initiatives lack a `_raw` cycle archive**: `new-api-pipelines-v2` and `new-api-test`. Both nonetheless show a clean, unique landing commit in git (PR #56 / PR #63), so their *shipping* is not in doubt — only the archived narrative of *how* they ran is unavailable.
2. **`new-api-notification` archive/git mismatch**: the `_raw` archive's stated outcome is "Operator send-back (not merged)," but git history shows PR #57 merged and tagged v1.12.0. The archive was evidently captured at the send-back point and never regenerated after the eventual successful merge — a gap in the archival mechanism, not evidence the initiative failed to ship.
3. **CHANGELOG.md duplicate version header**: `## [1.3.0]` appears twice (line 1051, dated 2026-07-01, content = dashboard/extension+feature_flag; line 1085, dated 2026-07-03, content = member-entitlement+build). A third independent "bump version to 1.3.0" commit (`c151d502`, 2026-07-02 22:51:52) exists outside either header's date — strong evidence of a version-number collision when multiple initiative branches fan into main in quick succession. This also explains why `migrate-framework-member-entitlement` (#53) and `migrate-framework-build` (#49) show no fully-distinct tagged version of their own in the ledger above.
4. **CHANGELOG.md has zero version headers for 1.1.0 and the entire 1.4.0→2.0.0 range** — 21 `### FEATURES` blocks (representing the bulk of the roadmap's late-stage initiatives, including the final BREAKING CHANGES note for mux-free-cutover) sit undifferentiated under `## [Unreleased]`, despite `v1.4.0`–`v1.22.0` existing as real git tags and "2.0.0" being the claimed final version. The changelog and the git tag history diverged partway through the run and were never reconciled.
5. **No `v1.1.0`, `v1.4.0`, or `v2.0.0` git tags** exist, though all three versions are referenced in commit messages or CHANGELOG prose. Tag sequence jumps `v1.0.5 → v1.2.0` and `v1.3.1 → v1.5.0`.
6. **Two merge-commit conventions used interchangeably** across the 24 initiatives: 15 used the "forge squash-merge" convention (`forge: INIT-... (#NN)`), 9 used a plain GitHub "Merge pull request" convention — no single canonical mechanism for the whole run.
7. **CHANGELOG.md never cites PR numbers** anywhere (`grep -c '#[0-9]\{2,3\}'` → 0), so changelog entries cannot be cross-referenced to PRs without external git-log reconstruction (i.e., what this ledger had to do).
8. **`migrate-framework-serviceendpoint` (#58) shipped incomplete by its own commit message** ("unmigrated types stay SDKv2"); the remaining service-endpoint types were finished 2 days later inside `mux-free-cutover` (#68)'s commits, which is scope not listed in either initiative's manifest as belonging there (serviceendpoint's manifest claims full 30+-type coverage as AC-1; mux-free-cutover's manifest claims "purely runtime-scaffold removal, no resource additions").
9. **PR #42 has no matching commit anywhere in local git history** — unexplained numbering gap (possibly opened/closed without merging). Low significance but noted since it breaks the otherwise-continuous #43–#68 sequence.
10. **`migrate-framework-member-entitlement` and `new-api-featuremanagement`** produced no uniquely-attributable git tag of their own — both landed inside the same short window as the `[1.3.0]` duplicate-header collision (anomaly 3) and are folded into that ambiguity rather than cleanly mapping to one version each.

---

## Summary

- **24/24 initiatives landed a merged PR** (PR #43–#68, minus 2 unrelated hotfix PRs #47/#61 in the same range; #42 unaccounted for).
- **Version progression: v1.0.5 (pre-roadmap) → v1.2.0 (07-02, first roadmap tag) → v1.22.0 (07-05, last real git tag) → "2.0.0" claimed in the final commit/CHANGELOG (07-10) but never tagged.**
- **Queue confirmed fully drained** (pending/in-flight/ready-for-review/failed all empty save `.gitkeep`).
- **Final 07-05→07-10 stretch: 6 initiatives** (pipelinesapproval, gallery-extensionmanagement, core, workitemtrackingprocess, taskagent, mux-free-cutover), with a ~4.5-day gap before the terminal mux-free-cutover, which required a manual operator merge after the automated unifier exhausted its iteration budget on a false-positive gate.
- **Patch items B1–H2: all 5 ADDRESSED** by roadmap close, each with direct file/commit evidence in the shipped provider.
- **Scope-delta flags found in 3 of 24 rows**: dashboard-extension (dropped→recovered pre-merge), serviceendpoint (shipped incomplete, finished later under a different initiative), mux-free-cutover (scope added beyond its own manifest's "no resource additions" boundary to absorb serviceendpoint's leftovers). One archive/git contradiction found (new-api-notification). Two archives missing outright (pipelines-v2, test) — both confirmed shipped via git regardless.
- **10 mechanical anomalies logged** — the most consequential being the CHANGELOG/tag divergence (duplicate 1.3.0 header, missing 1.1.0/1.4.0-through-2.0.0 headers, no v2.0.0 tag) and the notification archive/git mismatch.

Full detail: `/tmp/claude-1000/-home-parso-forge/29cfec14-7c52-4a4d-b8b0-b4e040409bed/scratchpad/outcomes-ledger.md`
