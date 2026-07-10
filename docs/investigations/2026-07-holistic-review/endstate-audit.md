# Betterado Terraform Provider — End-State Quality Audit (post 24-initiative roadmap)

Repo: `/home/parso/forge/projects/terraform-provider-betterado` @ `92061da0` (main, clean).
Companion mechanical ledger: `outcomes-ledger.md` (read first; this report does NOT redo it).
Date: 2026-07-10. Auditor: quality/judgment agent. Nothing in the betterado repo was modified.

Ownership tags per finding: **{forge-defect}** = orchestration process caused it · **{betterado-followup}** = provider work needed · **{cosmetic}** = trivial polish.

---

## 0. Headline correction to the ledger

The ledger's central claim — *"no v2.0.0 tag was ever cut; git describe = v1.22.0-45-g92061da0"* — is a **local-clone artifact, not the ground truth.** Checked against `origin`:

- **`refs/tags/v2.0.0 → 92061da0` exists on origin** (the exact HEAD commit).
- **`origin/main` is at HEAD** — the work IS pushed.
- **A published GitHub Release `v2.0.0` exists** (created 2026-07-09T22:03:38Z = 2026-07-10 08:03 +1000; `isDraft:false`, `isPrerelease:false`, marked Latest) with the **full GoReleaser artifact set**: 15 platform zips (darwin/freebsd/linux/windows × amd64/386/arm/arm64) + `terraform-provider-betterado_2.0.0_SHA256SUMS` + a detached **GPG `.sig`** over the checksums.

The local `git describe` simply never fetched the remote tag. **The 2.0.0 release was genuinely cut, signed, and published.** The ledger's tag/CHANGELOG-divergence anomalies are real *as CHANGELOG hygiene* but do NOT mean "no release happened."

---

## 1. End-state scorecard {claim → verified / discrepancy → owner}

| # | Claim (roadmap / final commit) | Verdict | Owner |
|---|---|---|---|
| 1 | "2.0.0 released" | **VERIFIED (remote).** Tag `v2.0.0`→HEAD + signed GitHub Release with 15 zips + SHA256SUMS + GPG sig; all 4 CI gates (lint/unit/terrafmt/depcheck) green; tag-on-changelog + release workflows both succeeded. | — |
| 2 | Pure plugin-framework, mux removed | **VERIFIED at the served binary.** `main.go` serves protocol 6 only (`NewProtocol6`+`tf6server`); no mux server; SDKv2 `Provider()` ResourcesMap/DataSourcesMap fully commented out. | — |
| 3 | "1.0.5 → 2.0.0" reflected in CHANGELOG | **DISCREPANCY.** `[Unreleased]` block was never renamed to `[2.0.0]`; all 1.4.0→2.0.0 content sits under `[Unreleased]`. Duplicate `## [1.3.0]` headers (lines 1051, 1085). No 1.1.0/1.4.0-2.0.0 headers. `goreleaser` has `changelog: disable:true`, so this does NOT block the release — it's a docs-hygiene defect. | {forge-defect} root / {betterado-followup} fix |
| 4 | `[Unreleased]` breaking-changes accurate about mux removal | **PARTIAL.** The block's *top* correctly leads with "Mux scaffold removed" (BREAKING) + accurate INTERNAL notes. But **dozens of per-resource FEATURE entries below still say "served through the mux provider"** (lines 29,37,41,48,52,61,65,69,75,79…) — internally contradictory; written per-initiative during the mux era, never reconciled at cutover. | {forge-defect} |
| 5 | All ~54 SDKv2 `helper/schema` imports are gone / dead | **DISCREPANCY.** 23 app files still import it (9 legacy + 14 `_framework` alias). Served provider is 100% framework, BUT `go list -deps .` proves SDKv2 `schema` is still **compiled/linked into the shipped binary** via live helpers (`namespaces`, core-team helpers). ~3,113 lines of pure-dead SDKv2 (4 `build/*` files + `provider.go`) remain. Commit `3ab48266` ("delete dead SDKv2 sources") was an **incomplete sweep** (deleted the build resources' *tests* but kept the untested *sources*). | {forge-defect} root / {betterado-followup} cleanup |
| 6 | Non-PAT auth (AAD/OIDC/MSI/CLI) works | **FALSE — dead schema.** Framework `Configure()` reads only 2 of 19 declared auth attributes (`org_service_url`, `personal_access_token`); the other **17 AAD/OIDC/MSI/CLI attributes are accepted silently and ignored**. If PAT is empty, Configure `return`s with nil data (no error). The full impl (`GetAuthProvider`+`aztfauth`) is **orphaned in the dead SDKv2 `provider.go`**. Doc comments still claim "AAD/OIDC auth handled by the SDKv2 provider" (false post-cutover). | {betterado-followup} (P0) |
| 7 | serviceendpoint surface complete (finished under mux-free-cutover) | **VERIFIED.** 40 framework SE resource files; **zero** SDKv2 SE resource files remain; 48 `serviceendpoint.New*` registrations in framework_provider. The pre-cutover SDKv2 SE types (jfrog/k8s/maven/nexus/npm/nuget/octopus/openshift/snyk/sonar/ssh/etc.) were deleted by `3ab48266` and exist only as framework now. | — |
| 8 | Docs complete & registry-publishable | **DOCS: VERIFIED.** Modern `docs/` layout; **201/201 shipped types documented (0 missing)**, incl. every new-API resource; valid `index.md` + 5 auth guides + examples. | — |
| 9 | Registry-ready to publish/use today | **DISCREPANCY (functional blocker).** `terraform-registry-manifest.json` declares `"protocol_versions": ["5.0"]` but the binary serves **protocol 6 only**. Registry will *ingest* it, but `terraform init/plan` against the installed provider would **fail the plugin handshake** (5.0 negotiated vs 6.0-only server). | {forge-defect} root / {betterado-followup} (P1, one-line) |
| 10 | Build/vet/unit-test green | **VERIFIED.** `go build ./...` = 0, `go vet ./...` = 0, `TF_ACC= go test ./...` = 0 (no FAIL). Caveat: unit coverage is thin — 41 of 53 packages have **no test files** (acceptance-test-heavy, normal for a TF provider, but noted). | {cosmetic} note |
| 11 | Cutover left no obsolete tests | **DISCREPANCY.** `resource_mux_sdkv2_passthrough_test.go` still asserts the *deleted* mux routing. Also, many acceptance tests still use `testutils.GetSDKv2ProviderFactories()` pointing at the SDKv2 provider whose ResourcesMap is now **empty** — latent test-suite rot. | {forge-defect} root / {betterado-followup} |

**Net:** the roadmap genuinely shipped a pushed, signed, CI-green 2.0.0 with 100% doc coverage and a fully-migrated resource surface — a strong result. Two substantive gaps block a *usable* public 2.0.0: **(P0) non-PAT auth is dead**, and **(P1) the protocol manifest would break every install**. Both are small, well-scoped fixes.

---

## 2. Prioritized betterado follow-up backlog (auth first)

| Rank | Item | Why | Size | Owner |
|---|---|---|---|---|
| **P0** | **Wire non-PAT auth into the framework provider** (full initiative drafted in §5) | 17 auth attributes are live in the schema but silently ignored; users configuring OIDC/MSI/CLI/AAD get no error and a broken provider. Must precede public 2.0.0 release notes that advertise these fields. | ~3–4 WIs | betterado-followup |
| **P1** | **Fix `terraform-registry-manifest.json` → `["6.0"]`, re-tag/re-release** | Installed provider fails Terraform's protocol handshake as published. One-line change + a patch release (e.g. v2.0.1). | 1 WI (trivial) | betterado-followup |
| **P2** | **Excise remaining SDKv2 from the binary** | Delete 4 dead `build/*` files + `provider.go` (~3,113 LOC); drop the ignored `*schema.ResourceData` param from `TokenCreatorFunc`/`NewSecurityNamespace` so the 14 `_framework` files shed `sdkschema`; de-SDKv2 `project_helpers.go` (`*schema.Set`→slice) and `tfhelper.go`. Removes `helper/schema` from `go list -deps .`. Blocked on P3 (tests). | ~3–5 WIs | betterado-followup |
| **P3** | **Migrate SDKv2-factory acceptance tests → framework factory; delete obsolete mux tests** | Many acc tests use `GetSDKv2ProviderFactories()` against an empty-map provider; `resource_mux_sdkv2_passthrough_test.go` tests deleted mux routing. Prereq for deleting `provider.go` (P2). | ~2–3 WIs | betterado-followup |
| **P4** | **CHANGELOG release-cut hygiene** | Rename `[Unreleased]`→`[2.0.0] - 2026-07-09`; de-dup the two `## [1.3.0]` headers; strip "served through the mux provider" from the per-resource entries (contradicts the block's own breaking-change note); add missing 1.4.0-1.22.0 headers or fold them. Non-blocking (goreleaser ignores CHANGELOG). | 1 WI | betterado-followup |
| **P5** | **Doc/example cosmetics** | Delete 7 phantom doc pages (5 `betterado_`-prefixed dupes + 2 orphan SE-resource pages `serviceendpoint_npm`/`serviceendpoint_sonarcloud` that ship only as data sources); fix stale `environment {}` in `README.md:41`, `demo/standing/DEMO.md:20`, and `stages {}`-block syntax in `examples/release_definition/main.tf` (registry `docs/` are already correct — these are hand-maintained files). | 1 WI | cosmetic |
| **P6** | **Org hygiene** | Several `test-acc-*` custom **processes** linger in the ADO org from acceptance runs (visible in live probe [4]); no destroy-cleanup. Sweep. | trivial | cosmetic |

---

## 3. Live-tier evidence (org `davidgparsonson`, PAT redacted)

Creds sourced from `secrets.env` (PAT length 84, never printed). All requests used HTTP basic auth `-u ":$PAT"`; **PAT redacted below**.

### REST GETs — 5/5 returned HTTP 200 with real data

```
[1] GET https://dev.azure.com/davidgparsonson/_apis/projects?api-version=7.1   → HTTP 200
    count: 4   (PublicProjects, Ohana, betterado-standing-demo [6ddb680c-…], DPLife)
    >>> Org is at only 4 projects — the ~1000-project soft-delete purge has COMPLETED.
        The standing "org near cap" constraint that shaped the roadmap is resolved.

[2] GET https://vsrm.dev.azure.com/davidgparsonson/betterado-standing-demo/_apis/release/definitions/2?api-version=7.1  → HTTP 200
    id: 2 | name: "betterado-standing-showcase" | path: \ | revision: 2
    environments: ["Staging", "Production"]
    >>> release_definition surface live; standing demo intact (2 stages).

[3] GET https://dev.azure.com/davidgparsonson/_apis/notification/subscriptions?api-version=7.1  → HTTP 200
    count: 25 live subscriptions
    >>> notification_subscription (new-api-notification, PR #57) target API reachable.

[4] GET https://dev.azure.com/davidgparsonson/_apis/process/processes?api-version=7.1  → HTTP 200
    count: 25 processes (built-in Agile/Scrum/CMMI/Basic + custom + several test-acc-* leftovers)
    >>> workitemtrackingprocess (PR #64) surface reachable. (test-acc-* residue → P6.)

[5] GET https://dev.azure.com/davidgparsonson/betterado-standing-demo/_apis/serviceendpoint/endpoints?api-version=7.1  → HTTP 200
    count: 1 (name: test-elastic-pool-se, type: azurerm)
    >>> serviceendpoint surface reachable.
```

### Acceptance tests — 2 targeted, both PASS against live ADO (no project created)

```
TestAccProject_importByName                     --- PASS (4.57s)   [import-only round-trip of the
    existing standing-demo project; uses `removed { destroy = false }` — never deletes. Migrated core resource.]
TestAccAgentPoolsDataSource_Basic  (-tags all)  --- PASS (12.20s)  [taskagent framework data source; org-level
    read of existing agent pools; creates nothing.]
```

Both are migrated-resource acc tests exercising real ADO reads. No projects created; no destructive mutation. (Note: most data-source acc tests are gated behind `//go:build all` tags — must pass `-tags all` or they silently report "no tests to run".) Full logs in scratchpad (`acc_project_import.log`, `acc_agentpools_ds.log`).

---

## 4. Auth gap — precise anatomy (feeds the §5 initiative)

**Framework `Configure()`** (`azuredevops/internal/provider/framework_provider.go:170-197`):
- Reads exactly two attributes: `path.Root("org_service_url")` and `path.Root("personal_access_token")` (only 2 `GetAttribute` calls in the whole file).
- Falls back to `AZDO_ORG_SERVICE_URL` / `AZDO_PERSONAL_ACCESS_TOKEN` env.
- If either is empty → **silent `return` with nil ResourceData** (line 195-197). Comment: *"AAD/OIDC auth handled by the SDKv2 provider"* — **false**, that provider is no longer served.
- Builds the client via `NewAuthProviderPAT(pat)` (line 199) — **PAT only**.

**17 declared-but-dead auth attributes** (in the framework schema, accepted without error, never read):
`client_id, client_id_file_path, tenant_id, auxiliary_tenant_ids, client_secret, client_secret_path, client_certificate, client_certificate_path, client_certificate_password, use_oidc, oidc_token, oidc_token_file_path, oidc_request_token, oidc_request_url, oidc_azure_service_connection_id, use_msi, use_cli`
(`use_cli` even documents `Defaults to true` — so a user with no PAT and default CLI auth silently gets a non-functional provider.)

**The working implementation is orphaned.** `GetAuthProvider(ctx, d *schema.ResourceData)` at `azuredevops/provider.go:405-450` maps all 17 attributes into `aztfauth.NewCredential{...}` (client-secret / client-cert / OIDC token/file/request / MSI / Azure CLI / multi-tenant) and returns `NewAuthProviderAAD(cred, ...)`. It is called **only** from the dead SDKv2 `providerConfigure` — unreachable from `main.go`. So the provider already *contains* full non-PAT auth; the cutover just never re-wired it into the framework `Configure()`.

---

## 5. Drafted follow-up initiative (P0)

```
INIT: framework-auth-parity — wire AAD/OIDC/MSI/CLI auth into the framework provider Configure()

GOAL
  The pure-plugin-framework provider must honor every authentication method it already
  advertises in its schema. Today framework Configure() is PAT-only; the 17 AAD/OIDC/MSI/CLI
  attributes are silently ignored and the working aztfauth implementation is stranded in the
  deleted-from-service SDKv2 provider.go. Achieve auth parity with the pre-cutover SDKv2 provider
  before publishing public 2.0.0 release notes that advertise these fields.

SCOPE (in)
  - Port the credential-resolution logic from provider.go:GetAuthProvider (PAT → AAD via
    aztfauth.NewCredential covering client-secret, client-cert, OIDC token/file/request,
    MSI, Azure CLI, auxiliary tenants) into a framework-native path callable from
    framework_provider.go:Configure().
  - Read all 17 auth attributes via req.Config.GetAttribute (or a single config-struct decode)
    instead of the current 2. Preserve the AZDO_* env-var fallbacks and the documented
    EnvDefaultFunc semantics (incl. use_cli default=true, use_oidc/use_msi bools).
  - Replace the silent `return` on missing PAT with proper method selection + a clear diagnostic
    when NO usable credential resolves (fail fast, not silent nil).
  - Update the stale Configure/schema doc comments that reference "the SDKv2 provider" / "the mux".
  - Delete the now-duplicated GetAuthProvider once the framework path owns credential resolution
    (coordinate with SDKv2-excision follow-up P2/P3 if provider.go is being removed in parallel).

SCOPE (out)
  - No new auth methods beyond what the schema already declares. No schema attribute changes
    (they already exist). No resource changes.

ACCEPTANCE CRITERIA
  AC-1  framework Configure() resolves credentials for all advertised methods; a config using
        use_cli/use_msi/use_oidc/client_secret/client_certificate (no PAT) builds a working
        AggregatedClient (unit test per method with a fake credential/token source).
  AC-2  A config with NO resolvable credential produces an explicit provider Configure diagnostic
        (not a silent nil that defers failure to first resource use). Regression test asserts the
        error is raised at Configure, with actionable text.
  AC-3  PAT path and AZDO_* env fallbacks remain unchanged (existing behavior preserved;
        TestAccProject_importByName and one PAT-env unit test still green).
  AC-4  Live proof (live-ADO tier): at least ONE non-PAT method authenticates against the real org
        end-to-end — Azure CLI auth is cheapest/creds-free on the runner (az login present):
        a read/import acc test (e.g. TestAccProject_importByName) passes with PAT unset and
        use_cli in effect. If CLI is unavailable on the runner, document the constraint and prove
        credential *construction* for the other methods via unit tests. MUST NOT create a project.
  AC-5  No stale "handled by the SDKv2 provider" / "mux" comments remain in Configure/schema.
  AC-6  go build/vet/unit green; no new SDKv2 helper/schema import introduced by the framework path.

ROUGH SIZE  ~3-4 WIs:
  WI-1 extract credential-resolution into a framework-native helper (port aztfauth wiring off
       *schema.ResourceData onto a plain config struct) + unit tests per method.
  WI-2 rewire framework_provider.go Configure() to read all 17 attrs, select method, fail-fast;
       update doc comments.
  WI-3 live/CLI-auth acc proof + PAT-parity regression tests.
  WI-4 (optional, may fold into P2/P3) remove the orphaned GetAuthProvider/provider.go auth path.

RISK NOTES
  - aztfauth.NewCredential currently takes *schema.ResourceData; the framework path must feed it a
    plain struct — refactor the signature (this is the same helper the SDKv2 provider used, so
    behavior is preserved, only the input shape changes).
  - use_oidc in CI relies on ADO/GitHub OIDC token exchange — hard to prove live on a laptop
    runner; lean on Azure CLI auth for the live AC and unit tests for OIDC/MSI construction.
  - Coordinate deletion of GetAuthProvider with the SDKv2-excision follow-up (P2/P3) to avoid a
    merge conflict over provider.go — sequence auth-parity BEFORE provider.go deletion so the
    reference impl stays available while porting.
  - Security-review the new credential handling before merge (secrets in config/state, logging).
```

---

## 6. Registry-readiness verdict

**NOT ready to publish a *usable* public 2.0.0 today — two must-fix items, both small:**

1. **{P1 blocker} protocol manifest.** `terraform-registry-manifest.json` = `["5.0"]`; provider serves protocol **6** only. As published, `terraform init/plan` would fail the plugin handshake. Fix to `["6.0"]`, cut v2.0.1. *(The registry would happily ingest the current release — this breaks actual use, not ingestion.)*
2. **{P0 blocker for honest release notes} dead non-PAT auth.** The provider advertises OIDC/MSI/CLI/AAD in its schema but only PAT works. Publishing 2.0.0 notes that mention these = shipping broken advertised functionality. Wire it (§5) first.

**Everything else is already registry-grade:** signed GoReleaser release artifacts exist; docs are 100% complete and schema-accurate in the registry `docs/` layout; examples present for new resources; build/vet/unit green; resource surface fully framework-migrated and live-verified. Cosmetic cleanup (7 phantom doc pages, stale README quickstart, CHANGELOG consolidation) is nice-to-have, non-blocking.

**Bottom line:** the roadmap delivered a real, signed, CI-green, fully-documented 2.0.0 with a 100%-migrated resource surface (a genuinely strong outcome) — but two orchestration-era gaps (a stale protocol manifest and un-rewired non-PAT auth, both traceable to the mux-free cutover finishing the *runtime* but not the *edges*) stand between "released" and "safely usable by the public." Both are a few WIs.
```
