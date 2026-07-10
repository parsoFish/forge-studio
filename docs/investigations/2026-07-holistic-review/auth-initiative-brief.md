# Kickoff brief — INIT framework-auth-parity (betterado P0)

**Status: DRAFT — deliberately not queued.** This is the forward-validation
cycle for REFINEMENT-PLAN v2 Phase 6.2. Kick off via the architect (paste this
brief as the idea) or the roadmap page once the Phase 1–3 refinements land.
Source analysis: [`endstate-audit.md`](./endstate-audit.md) §4–§5. P1 (protocol
manifest `["5.0"]`→`["6.0"]` + cut v2.0.1) should ride along in the same cycle —
betterado 2.0.0 is not publicly usable until both land.

---

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
  - RIDE-ALONG (P1): terraform-registry-manifest.json protocol_versions → ["6.0"]; cut v2.0.1.

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
  AC-7  (P1 ride-along) terraform-registry-manifest.json declares ["6.0"]; v2.0.1 released; a
        local `terraform init` against the release binary completes the handshake.

ROUGH SIZE  ~3-4 WIs (see endstate-audit §5 for the WI split and risk notes).
