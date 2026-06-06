# The forge↔project contract (generalised)

> **What this is.** The set of properties **any** project must expose for forge
> to develop it unattended — independent of its form (UI app, HTTP API, library,
> CLI, monorepo, infra provider). This is the conceptual design; the *decision*
> is [ADR-017](./decisions/017-forge-project-contract.md), the *enforcement* is
> [`cli/preflight.ts`](../cli/preflight.ts) (`forge preflight <project>`), and the
> *origin* is the brain theme `forge-project-onboarding-contract` (trafficGame
> arc). This doc generalises those into form-agnostic invariants and records all
> additions through the 2026-06-06 betterADO sharpening round (C9 new; C1b
> CI-alignment sub-rule named; C7 live-acc linter gap; DEMO open gap noted).

## Why a contract exists

Forge runs a project as an **unattended loop**: plan → change → verify → package →
review → merge, fanning work out across parallel work items between human
interaction points. There is no human in the inner loop. Every guarantee a human
would normally provide — "this change is done," "this PR contains only what I
meant," "these two tasks won't collide" — must instead be **structurally true of
the project**. The contract is exactly that set of guarantees. A project that
doesn't provide them doesn't fail loudly; it fails *subtly* (false "done," PRs
full of junk, colliding WIs, hallucinated plans), which is worse. So forge
**declines** a project that doesn't meet the hard clauses rather than limp.

The contract is **about invariants, not recipes.** "A truthful done-signal" is the
invariant; a Playwright component test, an HTTP contract test, a `go test`, and a
pytest unit are all just *how* different project forms satisfy it. Onboarding =
mapping each invariant onto the project's form.

## The four interaction seams

The contract is not a flat checklist — every clause guards a seam where forge
touches the project. Naming the seams makes onboarding a guided walk rather than a
clause hunt.

| Seam | Forge needs the project to guarantee | Clauses |
|------|--------------------------------------|---------|
| **Planning** | Faithful, machine-readable, fresh planning inputs | C4, C8, BRAIN |
| **Development** | Truthful done-signal, hermetic commits, conflict-free decomposability, honoured locked core, CI alignment | C1, C1b, C2, C3, C5 |
| **External resources** *(conditional)* | Two-tier verification: creds-free in-loop gate + isolated live confirmation | C7 |
| **Demo / Review** | The change is demonstrable — evidence a human can approve | DEMO |
| **Merge** | Forge can produce a PR the operator can merge | C6 |

The planning and development seams are the mature ones. The external-resources seam
is conditional (only projects that cannot be verified without a live system). The
demo seam continues to be deepened (see DEMO below for the current open gap).

---

## C1 — A truthful, discriminating done-signal (the quality gate)

**One-line requirement:** One command, deterministic, green at HEAD, fast (≤10s),
and genuinely discriminating — it must fail before the work exists and pass only
when the acceptance criteria are met.

**Hard.** Forge has no human judging each iteration; the gate is the sole oracle.

**Three silent failure modes, all observed:**

- *Hollow*: already green at iter-0 because the gate isn't scoped to the unit of
  change (e.g. a whole-package gate where the package already has tests).
- *False-pass*: exits 0 without running the new work (a `-run` regex matching
  nothing; `go test` with `TF_ACC` unset silently skipping and printing
  `ok pkg 0.00s`).
- *Poisoned*: a test-less sibling package's `[no tests to run]` line in a
  multi-target run makes a passing gate look like a failure.

**Design rule:** scope the gate to the *unit of change* so empty ⇒ fail and
real-work ⇒ pass.

**Research grounding:** SonarQube "Clean as You Code," Keploy, and Augment Code
converge on: gate on new/changed lines only, but gate hard. ETH Zurich (2025):
agents cannot self-correct without a fast, deterministic oracle. betterADO
confirmed: the gate-mirrors-CI fix (PR #5, first green CI check) could not have
landed without making the forge gate identical to the CI command.

**Project-type mapping:**
- UI app → component/unit test for the new component (not the full Playwright suite)
- HTTP API → request/response (contract) test for the new endpoint
- Library → unit test for the new exported function
- CLI → unit test for the new command behaviour
- IaC provider → `terraform validate` + schema unit test (live acc test is C7, outer tier)
- Monorepo → gate scoped to the touched package (`--filter` in Nx/Turborepo), never repo-wide

### C1b — CI alignment (sub-rule, sharpened 2026-06-02/06)

**One-line requirement:** The per-WI gate must either BE the CI command or be a
strict subset subsumed by it. A gate that is lint-only when CI also requires
`make test`, or an acceptance test that omits `golangci-lint`, satisfies neither
clause.

**Hard (when `ci_gate` is populated).**

**WHY:** Two betterADO cycle failures traced to this gap. The per-WI gate was
narrower than CI: the ci-green PR #3 and the shared-fixture cycle both passed
the WI gate yet reddened GitHub CI — burning the full cycle. CI alignment is
enforced structurally via `.forge/project.json` fields:
- `ci_gate` — the full CI command the PM uses verbatim for CI-mirror WIs.
- `ci_fix_cmd` — auto-formatters run before the delivery gate.
- `ci_gate_unset_env` — strips live-test triggers so `ci_gate` mirrors GitHub
  CI's clean environment.

**For live-acc WIs specifically:** the per-WI gate should additionally run the
project linter scoped to the changed package. A live-acc WI gate that is only
the acceptance test produces lint-red code caught only at the cycle-level delivery
gate — an expensive, late catch.

---

## C2 — Hermetic commit capture (PR hermeticity)

**One-line requirement:** The repo must be configured so that only intentional
source edits can enter a commit.

**Hard.** Forge commits with `git add -A` and assembles a PR with no human
curating the file list.

**Three categories must be covered:**

1. **Forge scratch:** `.forge/` runtime dir, `AGENT.md`, `PROMPT.md`, `fix_plan.md`
   (the original C2, from trafficGame).
2. **Build artifacts and generated outputs:** compiled binaries, bundler `dist/`,
   coverage reports, knowledge-graph caches, LSP indexes — *anything a build or
   tool writes into the working tree will be committed unless excluded.* betterADO:
   a renamed, un-ignored provider binary committed a 35 MB blob via `git add -A`.
3. **Config inside ignored dirs must be force-tracked:** `.forge/project.json` lives
   under the ignored `.forge/` and must survive both the ignore and forge's
   scratch-strip. Any per-project config file inside an ignored dir must be
   explicitly tracked.

**Invariant:** `git status` after a clean build shows **nothing but intended
source.**

**Check must use git-truth** (`git ls-files --error-unmatch` + `git check-ignore -q`)
— a `.gitignore` entry is a no-op on already-tracked files.

**Project-type mapping:**
- UI app → ignore `dist/`, `.next/`, `*.js.map`, coverage
- HTTP API → ignore compiled server binaries, test fixtures under `_test/`, coverage
- Library → ignore `dist/`, `*.d.ts` generated outputs, `coverage/`
- CLI → ignore compiled binaries, cross-compiled output dirs
- IaC provider → ignore the provider binary, `.terraform/`, plan files, `terraform.tfstate`
- Monorepo → each package's own build output; shared root `.gitignore` plus per-package additions

---

## C3 — Conflict-free decomposability

**One-line requirement:** Source files must sit under the project's own size norm
with clear, single-responsibility module seams, so parallel WIs can be fanned out
without colliding at merge.

**Advisory.** Justified large files may exist; the PM's `detectHiddenCoupling` is
the runtime guard.

**WHY (research grounded):** A controlled study (arXiv:2605.20049) found agents
working on decomposed code use 7–8% fewer tokens and revisit files 34% less. The
context-window cost of a 3,000-line file forces the agent to truncate context or
spend the full window on one file. betterADO: the release resource at ~1,490 lines
was at the top of acceptable range; the trafficGame blocker was `Game.ts` at
1,732 LOC — a hard collision point for five parallel WIs.

**Norms (same across project types):**
- Soft warning: > 200–400 lines typical per file
- Hard ceiling: 800 lines (same forge holds for itself)
- God-file class (flag): ≥ 1,600 lines (2×)
- Functions: ≤ 80 lines
- Modules: single responsibility; extract when > 3 unrelated concerns

**Monorepo addition:** explicit package boundary rules (Nx `enforce-module-boundaries`
or Turborepo workspace config) prevent cross-package imports the PM can't see;
check at CI not just at build.

---

## C4 — Faithful, machine-readable planning inputs

**One-line requirement:** A `roadmap.md` at the project root and a seeded,
accurate, queryable brain sub-wiki at `brain/profile.md` (Brain 3 inside the
project repo).

**Hard.** Without these the planner hallucinates — it invents a plan for a project
it does not understand.

**The brain must be primed and corrected during onboarding** — not just checked for
existence — because a stale brain citing renamed files actively misleads the
planner. An ADR that documents "why not" prevents the agent from re-opening closed
decisions. A seeded brain encoding past failures prevents the agent from repeating
them.

**What to seed:** architecture decisions (ADRs), known failure modes and resolutions,
API quirks (e.g. "ADO returns VS402877 if pre/post approvals are absent"), integration
gotchas, security constraints, per-module conventions.

**Research grounding:** the Knowledge Activation / Atomic Knowledge Unit pattern
(arXiv:2603.14805) — each AKU declares intent, procedure, governance constraints,
and continuation paths. Plain Markdown is sufficient; a vector/graph index is
additive.

**betterADO:** the brain themes for `shared-fixture-canonical-ado-validity`,
`spike-wis-prevent-wrong-builds`, and `provider-resource-as-test-fixture` are what
enable the PM to emit correctly-grounded WIs on the next cycle, rather than
re-deriving the same lessons at cost.

**Project-type mapping:** same across all types. Libraries seed API design decisions.
IaC providers seed resource lifecycle and provider protocol choices. Monorepos seed
inter-package dependency rules and the module ownership map.

---

## C5 — Declared untouchables (locked core)

**One-line requirement:** The project must declare what forge may not change, and
forge must honour the declarations.

**Advisory.** File presence cannot prove honour; the preflight checks presence only.

**WHY:** Without declared untouchables forge has no guard against destroying
invariants the project's existing tests or CI depend on. trafficGame: forge had to
change to `commit-not-reset` to honour git ownership. betterADO: "never edit tests
to pass" is a standing locked-core mandate; forge must not adjust a test expectation
to make a WI gate pass.

**What to declare:** git ownership, "never edit tests to pass," calibrated
per-project thresholds, generated files that must not be hand-modified.

**Presence check:** `CLAUDE.md`, `AGENTS.md`, `.forge/constraints.md`, or
`CONSTRAINTS.md` at the project root.

---

## C6 — A satisfiable merge model

**One-line requirement:** Forge must be able to produce a PR the operator can merge
without stacking or auto-merge hazards.

**Advisory. Forge-side-satisfied post-Phase-6:** the review phase produces a
demo-embedded PR and stops; the operator merges in GitHub. The only project-side
requirement is a GitHub remote and a non-stacked branch topology per initiative.

---

## C7 — An external-resource model (two-tier verification)

**One-line requirement:** For projects whose behaviour can only be verified against
a live external system (cloud, database, third-party API, IaC provider), the
done-signal must split into two tiers, both defined in `.forge/project.json`.

**Conditional — applies when live-verification is required. Hard when it does.**

### The two-tier model

**Tier 1 — Inner (every dev-loop iteration):**
- Fast, creds-free, deterministic, ≤ 10s
- Mocks, fakes, in-process harnesses, contract tests, unit tests
- The `quality_gate_cmd` in `.forge/project.json` — this is the C1 gate for C7 projects
- Never requires live external systems; must be runnable in any sandbox

**Tier 2 — Merge (pre-PR, runs once per cycle):**
- The `ci_gate` with live-test triggers stripped via `ci_gate_unset_env`
- Plus: the mandatory live-acceptance WI whose per-WI gate runs with live creds

### Three structural seams in `.forge/project.json` that make the two-tier model impossible to bypass

**1. `acceptance_gate: { match, required, requires_env }`**

When `required: true`, the PM phase hard-fails the cycle unless ≥ 1 emitted WI has
a `quality_gate_cmd` token matching `match` (e.g. `"acceptancetests"`). This
guarantees every initiative is proven by a real live-acceptance WI.

`requires_env` closes the false-pass hole: without the listed env var (e.g.
`TF_ACC`), `go test` silently skips and prints `ok pkg 0.00s` (indistinguishable
from a pass — it even matches forge's "tests ran" heuristic). The dev-loop
therefore **errors** a matching gate whose `requires_env` vars are unset, instead
of false-passing. Origin: the betterADO daemon ran two full cycles without `TF_ACC`
set and shipped two unverified resources before this gap was closed (2026-06-06).

**2. `standing_work_item_acs: string[]`**

Verbatim testing invariants forge appends to **every** WI body as a
`## Standing acceptance criteria (project contract)` section. Encodes project-wide
test invariants as structural injection, not per-WI PM judgment. betterADO has two
standing ACs: (a) live acceptance — `terraform apply` → API-read assert →
idempotency re-plan (`ExpectNonEmptyPlan: false`) → clean destroy; (b)
CI-equivalent — `make test` (no live trigger) + linter + formatter.

**3. `ci_gate_unset_env: string[]`**

Strips the live-test trigger from the env before the final CI delivery gate runs,
so it mirrors GitHub CI's clean environment. Without this, `TF_ACC=1` set for
per-WI live gates leaks into `make test` and runs the entire live suite — failures
GitHub never sees.

### Live-tier discipline (self-cleaning, isolated, read-back, non-default)

- Each live test creates uniquely named resources (UUID-prefixed); never reuses names
- `defer terraform.Destroy(t, opts)` / `t.Cleanup` / `finally` — teardown runs on
  success AND failure
- Creds supplied out-of-band (gitignored env file → environment variables); never committed
- Orphan sweep as a fallback: periodic script destroys resources matching the test
  prefix older than N hours
- Read-back assertion: after create/update, a separate GET/describe call verifies the
  stored state matches the intent (not just that the write returned 200)
- Non-default fixture values for every field under test (see C9)
- `PreCheck` function: if required env vars are absent, the test calls `t.Fatal` with
  a clear message rather than skipping (a skip is a false-pass)

### Live-acc WI linter gap (sharpened 2026-06-06)

A live-acc WI gate that is only the acceptance test will produce lint-red code
that only fails at the cycle-level delivery gate — an expensive, late catch. The
structural fix is composing `lint <pkg>` into the per-WI gate, or running a
file-scoped lint sub-check at dev-loop close.

**Project-type mapping:**
- IaC provider → `TF_ACC`-gated acceptance tests with `terraform apply` + API read-back + destroy; `PreCheck` per test
- HTTP API → staging integration tests against a real DB in an ephemeral container; assert both response AND DB state
- UI app → Playwright E2E against a real deployed staging environment (ephemeral, seeded)
- CLI → end-to-end invocation against a real target system in a temp directory
- Library → no C7 unless the library calls external services; property-based tests against real interpreters are sufficient
- Monorepo → per-service C7 in isolation; do not share live state across packages

---

## C8 — A human-authored agent-instruction file

**One-line requirement:** A human-authored `AGENTS.md` or `CLAUDE.md` at the
project root, with build/test/lint commands near the top and any locked-core
mandates. Forge must never create or overwrite this file.

**Advisory.** If absent, forge warns and the operator creates it.

**WHY (research grounded):** ETH Zurich / DeepMind (arXiv:2602.11988): human-authored
minimal context files yield ~4pp task-completion uplift; auto-generated files yield
–2% to –3% success rate and +20–23% inference cost because 95–100% of LLM-generated
files include information the agent can discover itself. Keep under 200 lines. Place
load-bearing rules at the top (agents suffer "lost in the middle" on long files).
Omit anything the agent can infer from reading code.

**What must be present:**
- Exact shell invocations for build, test, lint (not prose)
- Non-obvious tooling (a custom task runner, `make` targets, unusual flags like `-tags all`)
- Permission boundaries: `Always do:`, `Ask first:`, `Never do:`
- Project-specific constraints that override language/framework defaults
- Known project hazards (betterADO: "never run `go build ./...` — fills the drive")

**What to omit:** architecture overviews, standard framework conventions, anything
duplicating the README, anything stale.

**Lifecycle note:** the forge scratchpad `AGENT.md` (per-cycle, written by forge
during the dev-loop) is distinct from `AGENTS.md`/`CLAUDE.md` (operator-authored).
The scratchpad must be gitignored (C2); the instruction file must be present and
human-authored (C8).

---

## C9 — Shared fixtures with non-default values and read-back assertions *(new, 2026-06-06)*

**One-line requirement:** Core acceptance criteria and test fixtures must use
non-default, non-zero values for every field under test, and every create/update
test must verify the stored state via a separate read-back call — not just assert
the write response.

**Advisory for unit tests; hard for C7 projects** (where live-confirmation is the
proof).

**WHY:** Default values make gates blind to server-side normalisation: the server
accepts the request but ignores the field — the field reads back as its default,
which equals the asserted value, producing a false pass. betterADO confirmed:
`VS402982` (stage-level retention required) and `VS402877` (pre/post approvals
required) were both silent field discards invisible to a default-value fixture. The
shared `SharedReleaseFixture(t)` encodes all current ADO validity constraints in one
place; updating it once updates every test.

**Concrete practices:**
- String fields: use `"test-sentinel-abc123"` not `""` or `"test"`
- Numeric IDs: use values outside the default range or random UUIDs
- Boolean toggles: test both `true` and `false` states; a test that only asserts
  `true` passes if `true` is the default
- Resource names: prefix with a run-specific UUID (prevents collision across parallel runs)
- Read-back assertion: after create/update, a separate GET/describe/show call verifies
  all written fields on the fetched copy — not just the create response
- Shared fixture factory: a `fixtures.go` / `fixtures.ts` / `conftest.py` producing
  test objects with explicitly non-default values; referenced in `AGENTS.md` so agents
  use it rather than inventing inline data

**Project-type mapping:**
- IaC provider → `TestAcc*` with `terraform.ImportStateVerify: true` (destroys state,
  re-imports from live API, diffs against original plan) + explicit `TestCheckResourceAttr`
  (not just `TestCheckResourceAttrSet`)
- HTTP API → `POST /resource` → `GET /resource/{id}` → assert all written fields; also
  double-apply (idempotency)
- Library → property-based tests asserting round-trip fidelity (encode → decode → assert
  equals original)
- CLI → stdout capture after invocation + re-read from affected file/state to confirm
  persistence
- UI app → DOM assertion after action (not just event emission); re-render and confirm state

---

## DEMO — The change is demonstrable

**One-line requirement:** The project must declare how a change is demonstrated so
the review phase can present the operator with observable evidence, not faith.

**Advisory.** But operationally important: a project that can be gated but not
demonstrated leaves the operator approving blind.

**The demo is evidence, not a test log.** "Tests pass" and "feature is demonstrable"
are different guarantees. The review phase must show the actual resource (API GET
response, rendered page screenshot, plan output) — not a table of test names. The
before/after delta is the unit of demo; showing only the "after" does not prove the
change caused the behaviour.

**Project-side declaration (`.forge/project.json` `demo` block):**
- `demo.shape` — one of `browser | harness | cli-diff | artifact | none`
- `demo.command` — required for any shape ≠ `none`; how forge produces the before/after
- `demo.preview_command` — required for `browser`; must be a fresh server, never a
  reused stray dev server (trafficGame stale-capture lesson)

**Open gap (2026-05-31, not yet resolved):** the shape vocabulary has no category for
"live external system: API response + external-UI screenshots." betterADO is
classified `harness` (the creds-free floor) but the richer demo is a live ADO org
visible via REST API and dev.azure.com portal. A `demo.skill` field pointing to a
project-owned demo skill is the desired workaround, but **this field does not yet
exist in `project-config.ts`**; it is tracked in `docs/known-gaps.md` as an open
schema gap. Until resolved, richer live-external demos are a project-side
convention described in the project's `AGENTS.md`, not a machine-checked field.

The forge half of the demo contract (what a demo must contain, effort tiers, the UI
mapping) is owned by [`skills/demo/SKILL.md`](../skills/demo/SKILL.md).

**Project-type mapping:**
- UI app → `browser`: Playwright screenshots, fresh dev server, before/after frames
- HTTP API → `harness`: `curl`/`httpx` against staging, raw JSON response verbatim
- Library → `artifact`: usage example against the built artifact, recorded output
- CLI → `cli-diff`: before/after stdout capture, rendered diff
- IaC provider → `harness` (floor); richer live evidence via project-owned demo skill
  (live apply → API GET → portal screenshot → destroy) as a project convention
- Monorepo → per-project demo target; the initiative's demo targets the project that changed

---

## BRAIN — Brain freshness (themes cite live source paths)

**Advisory preflight check.** Scans `brain/themes/*.md` in the project repo for
`src/`/`tests/` paths that no longer exist in the project tree. Themes that
contradict the code silently poison the PM/architect. WARN-only: themes legitimately
reference history; the operator judges.

---

## betterADO as the worked example

| Clause | betterADO satisfaction |
|--------|------------------------|
| **C1 / C1b** | `quality_gate_cmd`: `go test -tags all -count=1 ./azuredevops/internal/service/release/... ./azuredevops/internal/service/taskagent/...` — creds-free, ~1s, exact package dirs (no `./...`), `-tags all` to include gomock tests behind `//go:build all`, `-run <Prefix>` in per-WI gates to enforce discrimination. `ci_gate`: `make test && golangci-lint run ./... && make terrafmt-check`. `ci_fix_cmd`: `make fmt && make terrafmt`. The gate-mirrors-CI fix (PR #5, first green GitHub CI) proved CI alignment is load-bearing. |
| **C2** | `.gitignore` covers: `.forge/` (forge scratch), the compiled `terraform-provider-betterado` binary (the 35 MB lesson), `graphify-out/` (graph caches), `*.tfstate`, `.terraform/`. `.forge/project.json` is force-tracked despite the ignored `.forge/` dir. |
| **C3** | Net-new code isolated to `azuredevops/internal/service/release/` and `/taskagent/` — distinct packages. Resource implementation at ~1,490 lines (top of acceptable range). Onboarding confirmed no god-files in the fork's net-new scope. |
| **C4** | `roadmap.md` at project root. Brain themes seeded with: `2026-05-31-forge-onboarding-findings.md`, `2026-06-05-provider-resource-as-test-fixture.md`, `2026-06-06-shared-fixture-canonical-ado-validity.md`, `2026-06-06-spike-wis-prevent-wrong-builds.md`, plus `release-substrate-context.md` encoding the full API surface. |
| **C5** | `CLAUDE.md` carries: never run `go build ./...` (fills drive), never edit tests to pass, user owns git. Forge honours git-ownership via `commit-not-reset`. |
| **C6** | GitHub remote at `parsoFish/terraform-provider-betterado`; operator merges in GitHub; no auto-merge. |
| **C7** | `acceptance_gate: { match: "acceptancetests", required: true, requires_env: ["TF_ACC"] }`. `ci_gate_unset_env: ["TF_ACC"]`. Two `standing_work_item_acs`. Live-acc WIs create uniquely-named ADO resources, assert via API GET, re-plan for idempotency, destroy on success and failure. `SharedReleaseFixture(t)` centralises all ADO validity constraints. `TF_ACC=1` + ADO PAT in gitignored `secrets.env`; creds never committed. |
| **C8** | Operator-authored `CLAUDE.md` with exact `go test` invocation (including `-tags all`), `make` targets, `go build ./...` prohibition, and naming/error-handling conventions. The per-cycle `AGENT.md` scratchpad is gitignored (C2) and distinct. |
| **C9** | `SharedReleaseFixture` uses non-default values: UUID-prefixed project name, non-empty description, explicit `retention_policy` at the stage level (required by ADO, not default), explicit pre/post approvals. `TestCheckResourceAttr` asserts exact field values (not `TestCheckResourceAttrSet`). `ImportStateVerify: true` for re-import round-trip. Idempotency via `ExpectNonEmptyPlan: false`. |
| **DEMO** | `demo.shape: "harness"`, `demo.command`: the offline unit run (creds-free floor). Richer evidence (live apply → API GET + portal screenshots → destroy) is a project convention; awaiting `demo.skill` schema field (tracked in known-gaps). |

---

## How forge enforces it

`forge preflight <project>` checks C1–C8 + the advisory **DEMO** and **BRAIN**
clauses structurally and **declines** on a hard failure (C1/C2/C4 hard;
C3/C5/C6/C8/DEMO/BRAIN advisory). The C2 check uses **git-truth**
(`git ls-files --error-unmatch` + `git check-ignore -q`) rather than scanning
`.gitignore` text — a `.gitignore` entry is a no-op on already-tracked files. The
DEMO clause validation is delegated to `orchestrator/project-config.ts`
`validateProjectConfig` (single source of truth).

**C9 is not yet machine-checked** — it is a hand-verified onboarding requirement.
**C1b (CI alignment)** is partially structural (`ci_gate` presence) but the
discrimination check (gate fails on clean tree) is still hand-verified.

C7's mandatory per-WI testing contract is checked where the data exists:
`acceptance_gate` is enforced in the **PM phase** (cycle hard-fails if no live-acc
WI is emitted), `standing_work_item_acs` is injected there too, and
`ci_gate_unset_env` is applied by the **final CI gate**
(`orchestrator/cycle.ts enforceFinalCiGate`). The remaining C7 facets (creds
out-of-band, isolation/self-cleanup) stay hand-verified during onboarding.

Adding C9 to preflight and adding a C1b structural check would require a
`preflight.ts` update — tracked in `docs/known-gaps.md` (not implemented here).

## The point: roadmap-scale, not single-WI

Meeting the contract is what makes the *intended* operating mode work: the operator
hands forge a **roadmap-scale, multi-feature** initiative and forge decomposes it.
A project that doesn't meet the contract tempts the operator to shrink scope to
compensate (single-WI initiatives) — that's a smell, not the target. Fix the
contract gap instead.

---

## Sources

**betterADO cycle evidence (primary):**
- `/home/parso/forge/projects/terraform-provider-betterado/.forge/project.json` — the structural seams as implemented
- `docs/known-gaps.md` §2026-05-31, §2026-06-02, §2026-06-06 — all observed failure modes
- `projects/terraform-provider-betterado/brain/themes/2026-06-06-shared-fixture-canonical-ado-validity.md` — C9 origin
- `projects/terraform-provider-betterado/brain/themes/2026-06-06-spike-wis-prevent-wrong-builds.md` — C7 spike pattern
- `projects/terraform-provider-betterado/brain/themes/2026-06-05-live-acceptance-gate-for-acceptance-wis.md` — C7 per-WI gate discipline
- `projects/terraform-provider-betterado/brain/themes/2026-06-05-provider-resource-as-test-fixture.md` — C9 hermetic fixtures

**Research:**
- ETH Zurich/DeepMind (arXiv:2602.11988) — human vs LLM-authored AGENTS.md: +4pp vs –3pp task success
- arXiv:2605.20049 — code cleanliness controlled study: 7–8% fewer tokens, 34% fewer file revisits on decomposed code
- arXiv:2602.07900 — agent-generated tests produce circular validation; external tests are the real done-signal
- SonarQube "Clean as You Code" — new-code-only coverage threshold; 20-line fudge factor
- HashiCorp acceptance testing docs — `TF_ACC` gate, `CheckDestroy`, `ImportStateVerify`, `ExpectNonEmptyPlan: false`
- Terratest — `defer terraform.Destroy(t, opts)` + `RandomWithPrefix` + idempotency pattern
- Google ICST 2023 — ephemeral, hermetic test environments; shared long-lived staging is a flakiness factory
- arXiv:2603.14805 — Knowledge Activation / AKU pattern for seeded project brains

---

## See also

- [ADR-017](./decisions/017-forge-project-contract.md) — the decision (needs a one-line amendment noting C9 + C1b addition).
- [`cli/preflight.ts`](../cli/preflight.ts) — the enforcement (C1–C8 + DEMO + ARTIFACTS + BRAIN).
- [`orchestrator/project-config.ts`](../orchestrator/project-config.ts) — canonical DEMO_SHAPES + validateProjectConfig (imported by preflight).
- [`docs/schemas/project-config.schema.json`](./schemas/project-config.schema.json) — operator-facing .forge/project.json schema.
- brain `forge-dev/themes/forge-project-onboarding-contract.md` — origin (trafficGame).
- [docs/known-gaps.md](./known-gaps.md) §2026-05-31, §2026-06-06 — not-yet-enforced facets and open schema gaps.
