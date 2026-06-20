Take `terraform-provider-betterado` to a **feature-complete, declarative Azure DevOps Release surface**. This is a roadmap-scale initiative set, already scoped in the operator's planning doc `docs/planning/2026-06-03-betterado-release-roadmap.md` (forge repo). Emit it as a serial **chain of coarse-feature initiatives** (you set the vision + ACs + cross-initiative deps; the PM owns ALL work-item sizing + gates — do NOT emit per-feature gates). Wire `depends_on_initiatives` as a strict linear chain INIT-1 → INIT-2 → INIT-3 → INIT-4 → INIT-5.

## Why serial (the load-bearing constraint)
Every new resource/data-source adds a line to the `azuredevops/provider.go` registry — the canonical AI-agent merge-conflict hotspot. Release entries sort adjacently, so parallel branches would collide at the merge boundary (forge's #1 historical failure). So the chain is a strict dependency chain: each initiative `depends_on_initiatives` its predecessor; the scheduler holds it until the predecessor is **merged** (`done/`), then it branches fresh from post-merge `main`. Serial but merge-safe.

## Scope (locked 2026-06-03) — DECLARATIVE ONLY
Every Release entity managed as Terraform desired-state. **Out of scope (do not plan these):** the imperative/runtime surface — creating releases, triggering/redeploying, approving/rejecting, gate-state, manual interventions. Those are runtime actions, not desired-state; they need a separate imperative escape-hatch design and are explicitly deferred.

## The five initiatives

**INIT-1 — Complete `betterado_release_definition` (feature-complete + acceptance-green). Size L.** No registry line (touches only the existing `release_definition.go`), so it is the clean foundation and its acceptance-test fix is the prerequisite that makes every later initiative's acceptance tests credible. Coarse features:
1. Acceptance-test refresh — make the 6 existing acc tests green against live ADO: confirm/fix the now-required stage `retention_policy` (VS402982) and the now-required pre/post approval structure (VS402877). (Schema already has these fields; verify they actually pass live.)
2. Deployment gates — `pre_deployment_gates` / `post_deployment_gates` blocks (gates + gatesOptions: isEnabled / timeout / samplingInterval / stabilizationTime / minimumSuccessDuration), each gate carrying workflow tasks.
3. Definition triggers — `triggers` block: continuous-deployment (artifact) trigger + schedule trigger.
4. Parallel execution + agentless phase — `deployment_input.parallel_execution` (none/multiConfiguration/multiMachine) and the `runOnServer` (agentless) deployment-input variant.
AC (outcome): new schema round-trips (expand/flatten unit tests); a release definition with gates + a CD trigger + a parallel phase + an agentless phase applies, reads back, and destroys cleanly against live ADO; the full project CI gate is green. Live ADO required. NOTE: `resource_release_definition.go` is a ~1618-LOC god-file — the PM must size WIs to avoid collisions.

**INIT-2 — `betterado_release_folder`. Size S.** CRUD resource over `/release/folders` (CreateFolder/UpdateFolder/DeleteFolder/GetFolders — already in MockReleaseClient); fields project_id, path, description; registered in provider.go; docs + example. Use the CreateFolder POST variant (PUT Create is deprecated). depends_on INIT-1.

**INIT-3 — Release data sources ×2. Size S.** `data.betterado_release_definition` (by id or name) + `data.betterado_release_definitions` (list); registered in the data-source map; docs + examples. depends_on INIT-2 (shares the provider.go registry — serialize).

**INIT-4 — `betterado_release_definition_permissions`. Size M.** Permissions resource mirroring the existing `*_permissions` resources (e.g. resource_git_permissions.go), using the already-registered ReleaseManagement (project-level) + ReleaseManagement2 (definition-level) security namespaces. RISK: the release permission token format must be confirmed against the live org first (the two namespaces have different token patterns) — surface as the first WI. depends_on INIT-3.

**INIT-5 — Release environment templates (SPIKE-GATED). Size L (may end at the spike).** First WI is a SPIKE: confirm whether the vendored microsoft/azure-devops-go-api v7 exposes `…/release/definitions/environmenttemplates`; if not, confirm the raw-HTTP path via the existing azuredevops.Connection. **If neither is viable, STOP — record the finding and park the resource (do NOT vendor-patch).** Only if the spike passes: build `betterado_release_definition_environment_template` (create/read/delete — templates are immutable, no update); docs + example. depends_on INIT-4.

## Conventions (betterado)
schema → expand/flatten → CRUD; gomock unit substrate (canonical 5 + characterization) is the default creds-free quality gate scoped to the release package; acceptance tests under `acceptancetests/` (TF_ACC=1, live ADO — creds present in secrets.env) are the sharp live gate, NOT the dev-loop default. Disk-safe build: `go build -mod=vendor .` only (never `go build ./...`).

## Definition of done for the component
INIT-1–4 merged (release_definition feature-complete + folder + data sources + permissions, all CI-green), and INIT-5 either merged or its spike has parked environment templates with a documented reason. At that point betterado exposes a feature-complete declarative Azure DevOps Release surface.
