# ADO Demo Skill — a betterado demo is an *exhaustive live test*

## Purpose

This is **betterado's half of the forge demo contract** (the forge half lives in
`forge/skills/demo/SKILL.md`). It defines what a betterado demo IS so the merge
decision is made on *live evidence*, not a table of test names.

**The core principle (2026-06-05, hardened after the INIT-1 release_definition
demo).** A betterado demo is not a screenshot of *some* resource — it is an
**exhaustive live exercise of the resource the change touches**:

1. **Exhaustive config** — the demo HCL provides a **non-default value for every
   configurable option** the resource exposes (every schema field, every nested
   block, every enum branch). If the resource has a `queue_id`, set a real agent
   pool — never leave it `0`. If it has `demands`, `skip_artifacts_download`,
   `enable_access_token`, gates, triggers, parallel execution — set them all, to
   non-default values. The demo is the place we prove the *whole surface* works,
   not just the field that changed.
2. **Live apply** against the operator's real ADO org (creds in gitignored
   `secrets.env`), with a locally-built provider via `dev_overrides`.
3. **Round-trip proof** — `GET` the created object from the live REST API and
   assert **every option persisted with the value we set** (not just that the
   object exists).
4. **Idempotency proof** — a second `terraform plan` after apply **MUST show
   `No changes`**. A perpetual diff means a flatten path doesn't round-trip — the
   change is **NOT done**, no matter how green the unit tests are. (This is the
   single check that caught the three round-trip bugs unit tests missed in INIT-1.)
5. **Portal evidence + operator review** — screenshot the resource in the ADO web
   portal; for a high-stakes change, leave it **standing** for the operator to
   review live, and destroy only on their go-ahead.
6. **Clean destroy** — `terraform destroy`; API `GET` → 404; zero orphans.

> **Why "exhaustive."** Unit (gomock) tests assert expand/flatten in isolation and
> routinely pass while the live round-trip drifts (a field the API renames, a list
> the API comma-joins, a block the API omits when empty). Only an exhaustive
> apply→GET→re-plan against live ADO catches that. So the demo is also the test.

## A demo PASSES only if ALL of these hold (hard gates)

- [ ] **Every option set** — the HCL exercises every schema field/block with a
      non-default value (agent pool/queue included). Diff the HCL against the
      resource schema; an unset option is a hole in the test.
- [ ] **Apply succeeds** against live ADO.
- [ ] **Round-trip** — the API `GET` shows every value we set (gates have actual
      gates, not just options; multipliers/branch filters/parallel blocks match).
- [ ] **Idempotent** — `terraform plan` post-apply is `No changes. Your
      infrastructure matches the configuration.` (perpetual diff = FAIL).
- [ ] **Portal screenshot** of the live resource.
- [ ] **Live evidence captured** — the acceptance test's read-back `Check` step
      calls `testutils.CaptureLiveEvidence(label, url, response)` BEFORE destroy
      (template: `resource_task_group_test.go` `captureTaskGroupEvidence`), so
      `.forge/live-evidence/<label>.json` is written and `forge demo render`
      back-fills it into `demo.json`. The `demo.json` checkpoint's label MUST
      equal that capture label (the join is exact-match). A `demo.json` with NO
      `checkpoint.liveEvidence.url` is a test-name table → RED.
- [ ] **Clean destroy** — no orphans.

If any box is unchecked, the demo is RED and the initiative is not mergeable.

## Live tests ARE regular testing (not a one-off)

The exhaustive apply above is **codified as a Terraform acceptance test** and runs
as part of the regular suite — it is not a thing the operator does by hand once:

- Each release-surface resource has a `TestAccReleaseDefinition_complete`-style
  acceptance test (`azuredevops/internal/acceptancetests/`) whose HCL is the
  **exhaustive non-default config** above, and whose `Check`s assert **every field
  round-trips** plus **`ExpectNonEmptyPlan: false`** (the idempotency gate — a
  perpetual diff fails the test automatically).
- These run via `scripts/acctest.sh` (`TF_ACC=1`, live ADO). For any initiative
  that touches a release resource, the **live acceptance test is a required gate
  before merge** — wire it as the acceptance WI's `quality_gate_cmd` (or the
  initiative's `ci_gate`), so forge's gate goes red until the live round-trip is
  green. The fast offline gomock suite stays the dev-loop's inner gate; the live
  acceptance tier is the merge gate. Both must pass.
- The demo (`demo.json`) is then *generated from that same live run* — the API
  `GET` it already performed becomes the round-trip evidence + `live-resource.json`
  interactive surface; the portal screenshot becomes the visual checkpoint.
- **The capture is gate-enforced, not prose.** The acceptance test's read-back
  `Check` step MUST call `testutils.CaptureLiveEvidence(label, url, apiResponse)`
  while the resource is still live (before destroy). That writes
  `.forge/live-evidence/<label>.json`; `forge demo render` (run by the unifier)
  reads it and merges it onto the `demo.json` checkpoint with the matching label.
  **Copy `captureTaskGroupEvidence` (`resource_task_group_test.go:131-154`)** — for
  a release resource, build the **vsrm host** URL
  (`<AZDO_ORG_SERVICE_URL→vsrm>/<project>/_apis/release/definitions/<id>?api-version=7.1`)
  using the **release client** (NOT `TaskAgentClient`), GET the definition, and
  call `CaptureLiveEvidence("acceptance-resource", url, def)` (same label the
  unifier's checkpoint uses, so the join lands). Keep the helper **best-effort**
  (`_ = testutils.CaptureLiveEvidence(...)`) so a capture miss never fails the test.

So: **one exhaustive live config → an acceptance test that calls CaptureLiveEvidence
→ the demo evidence.** They are the same artifact viewed two ways.

### The demo page is the review surface — no re-stand-up

The point of capturing live evidence in-cycle is that the operator reviews the real
resource ON THE DEMO PAGE, never by asking for the resources to be re-stood-up:

- **Always (headless, in the autonomous cycle):** during the live run, `GET` the
  created object and save it as `demo/<id>/live-resource.json`; declare
  `interactiveSurfaces` — a `live-query` serving that JSON + a `portal-link` deep
  link. The operator inspects the real API response and opens the portal from the
  `/review` screen. This is creds-only (PAT), so it always works in the cycle and
  is the primary evidence.
- **Portal screenshots (only when a browser session is connected):** compose
  `ado-browser-inspector` (the Claude-in-Chrome MCP) to screenshot the resource and
  embed `kind: screenshot` checkpoints. NOTE: that MCP is an operator-adjacent
  browser session — it is **not available in a headless cycle**, so screenshots are
  best-effort. The API evidence above is the always-available substitute; never
  block the demo (or the merge) on a screenshot.

## Prerequisites (the live layer)

- `AZDO_ORG_SERVICE_URL` + `AZDO_PERSONAL_ACCESS_TOKEN` stored under these exact
  canonical names in gitignored `secrets.env` at the repo root. PreCheck
  (`testutils/commons.go` / `azuredevops/internal/acceptancetests/commons.go`) calls
  `loadSecretsEnv()` and self-loads `secrets.env` automatically — no manual export or
  re-mapping step needed. Already-exported shell vars still take precedence.
  Do NOT use the old `$ADO_PAT` alias — that name is retired; the file must use
  `AZDO_PERSONAL_ACCESS_TOKEN` directly.
- A locally-built provider wired via `dev_overrides` → the freshly-built binary
  (`go build -mod=vendor -o <dir>/terraform-provider-betterado .`; a `dev.tfrc`
  with `provider_installation { dev_overrides { "local/betterado" = "<dir>" } direct {} }`;
  run terraform with `TF_CLI_CONFIG_FILE=<dir>/dev.tfrc`).
- Get real IDs from the live org instead of guessing — agent queues:
  `GET /_apis/distributedtask/queues`; task GUIDs+versions:
  `GET /_apis/distributedtask/tasks` (filter `runsOn` = `Server` for agentless).
  (INIT-1 wasted two apply attempts guessing a Delay task GUID/version.)

Branch the `essence` text on whether the live tier actually ran:

- **Creds present (the normal cycle)** — the acceptance test ran live. `essence`
  MUST describe the live apply → API GET round-trip → idempotency re-plan → clean
  destroy and reference the captured REST evidence. It MUST NOT say "offline
  floor", "gomock floor", or "TF_ACC skipped" — the live tier was NOT skipped.
- **Creds absent (CI without the PAT)** — only then is the live tier skipped and
  the demo degrades to the offline gomock floor; state THAT explicitly in `essence`.

Never fabricate a screenshot or claim a live pass that didn't run.

## Workflow

1. **Build** the provider binary (`go build -mod=vendor -o …`; never `go build ./...`).
2. **Author the exhaustive HCL** — one resource of the kind under test, every
   option set non-default. Ground every field name in the schema (`resource_*.go`
   schema map) and every external ID (queues, task GUIDs) in a live API GET.
3. **`terraform apply`** against the live org.
4. **API `GET`** the object; assert every option persisted (save as the "after"
   JSON / `live-resource.json`).
5. **`terraform plan`** → assert `No changes` (idempotency gate).
6. **Portal screenshot** (compose `ado-browser-inspector`); deep-link the resource.
7. **Operator review** for high-stakes changes — leave it standing, hand over the
   portal URL + the round-trip + idempotency results, and destroy only on the
   operator's go-ahead.
8. **`terraform destroy`** + confirm 404 / no orphans.
9. **Author `demo.json`** — a `kind: "screenshot"` checkpoint per behavioural
   surface, a `metrics`/round-trip row from the API GET, and the interactive
   surfaces below.

## Lessons this contract encodes (from the INIT-1 release_definition demo)

The first attempt at "complete release_definition" passed all gomock unit tests but
the exhaustive live demo caught four things unit tests cannot:

1. **Half-modeled feature** — deployment gates exposed `gates_options` (timing)
   but **zero actual gates** (`gates#=0`); the gate *checks* (each a workflow task)
   weren't modeled. "Exhaustive config" forces you to set a real gate, which fails
   loudly if the schema can't express it.
2. **Perpetual diff** — `parallel_execution.multipliers`, a spuriously-emitted
   empty `parallel_execution` block on non-parallel phases, and
   `schedule_trigger.branch_filter.include` all failed to round-trip. The
   idempotency re-plan gate catches every one of these automatically.
3. **Unset agent pool** — `queue_id` defaulted to `0`, so the stage had no pool.
   Functionality existed; the *demo* under-exercised it. "Non-default for every
   option" closes that hole.
4. **Guessed external IDs** — a wrong Delay task GUID/version burned apply
   attempts. Always read live `…/distributedtask/tasks` + `…/queues` first.

The rule of thumb: **if the demo wouldn't expose a regression in a field, the demo
isn't exercising that field.** Set everything; assert everything; re-plan to zero.
