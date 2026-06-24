# The forge↔project contract (Studio-aligned)

> **What this is.** The complete set of properties a project must expose for
> forge to develop it unattended — authored in Studio, enforced by preflight,
> and checked in the UI before any flow run. This document is the single source
> of truth; the *decision* is [ADR-034](./decisions/034-studio-aligned-contract.md)
> (extends [ADR-017](./decisions/017-forge-project-contract.md)), the *preflight
> enforcement* is [`cli/preflight.ts`](../cli/preflight.ts), and the *UI readiness
> surface* is
> [`forge-ui/components/studio/project-builder/ContractReadiness.tsx`](../forge-ui/components/studio/project-builder/ContractReadiness.tsx).
> Last aligned: commit 1ba05f6 (2026-06-17).

---

## Why the contract exists

Forge runs a project as an **unattended loop**: plan → change → verify → package →
review → merge, fanning work out across parallel work items between human
interaction points. There is no human in the inner loop. Every guarantee a human
would normally provide — "this change is done," "this PR contains only what I
meant," "these two tasks won't collide" — must instead be **structurally true of
the project**. A project that doesn't satisfy the hard clauses doesn't fail
loudly; it fails *subtly* (false "done," PRs full of junk, colliding WIs,
hallucinated plans). Forge therefore **declines** a project that doesn't meet the
hard clauses rather than limp.

The contract is **about invariants, not recipes.** "A truthful done-signal" is
the invariant; a Playwright component test, an HTTP contract test, a `go test`,
and a pytest unit are all just *how* different project forms satisfy it. Onboarding
= mapping each invariant onto the project's form.

---

## Contract structure: two faces, one verdict

The contract has **two faces** that converge into a single readiness verdict in
the Studio project builder:

**Face A — Studio object fields** (edited in the UI project builder, stored in
`.forge/project.json`, surfaced in `ContractReadiness`): the project as a
first-class Studio object — its identity, its instructions to agents, its demo
protocol, its bound skills and knowledge base.

**Face B — Operational clauses** (enforced by `forge preflight`): the structural
properties that make unattended development safe — truthful done-signal, hermetic
commits, decomposable source, locked-core declarations, satisfiable merge model,
external-resource verification, agent-instruction file, non-default fixtures.

A project that is **flow-ready** in the Studio UI is simultaneously
**preflight-green**: `data-flow-ready="true"` requires all five Studio-field
checks AND zero failing HARD preflight clauses. This is the readiness convergence
point.

---

## Face A — Studio object fields

These five fields are displayed and edited in the project builder UI. They are
stored in `.forge/project.json` and validated by `validateProjectConfig`
(`orchestrator/project-config.ts`). The UI readiness panel (`ContractReadiness`)
checks all five; a project is not flow-ready until all five pass.

### northStar (required, ≤ 140 chars)

One-liner mission statement. Injected into the architect/PM prompt as the
project's primary objective. Enforced length: `northStar.length > 0 &&
northStar.length <= 140`. A project without a north star leaves every planning
invocation without an anchor; the planner fills the gap with assumptions.

### instructions (required, non-empty)

Free-text standing directives injected into every PM prompt — the project's
authoritative "always do / never do" for the inner loop. Generalises and replaces
per-initiative manual prompt text. Must be non-empty: an absent `instructions`
block means the PM runs with no project-specific behavioural constraints. This
field complements C8 (the agent-instruction file read by agents at the worktree
level); `instructions` reaches the PM at plan time.

### demoProcess (required: ≥ 1 capture step + ≥ 1 verify step)

Typed sequence of demo steps, each `{ kind: "capture" | "verify" | "present",
text: string }`. A valid `demoProcess` must include **at least one `capture`
step** (how forge records the before/after evidence) **and at least one `verify`
step** (the assertion that makes the evidence non-trivial). The `present` kind is
optional. This field closes the long-standing `demo.skill` known-gap (tracked in
`docs/known-gaps.md` since 2026-05-31): typed steps replace the open-ended
`demo.shape` blob for projects that need richer live-external demos. A project
with only `present` steps leaves the reviewer approving blind.

### skills (required: ≥ 1 bound skill slug)

Skill slugs bound to this project. Forge uses bound skills as the palette when
generating agent prompts and when the flow engine selects tools. A project with
no bound skills relies on forge's defaults; the UI requires ≥ 1 explicit binding
to confirm the operator has thought about the project's tooling surface.

### kb (required: a bound knowledge-base id)

The KB (Brain 3 descriptor) bound to this project. Planners and reflectors read
through the `KbBackend` seam (`orchestrator/kb-backend.ts`), which resolves the
backend from the `kb.yaml` descriptor. A project without a bound KB deprives the
planner of queryable context; the UI requires an explicit binding (set `kb: null`
only to explicitly leave unbound when Brain 3 doesn't exist yet).

---

## Face B — Operational clauses

These clauses are checked by `forge preflight <project>`. Hard clauses
(C1/C2/C4) fail the preflight (non-zero exit); advisory clauses
(C3/C5/C6/C8/DEMO/DEMO-SKILL/ARTIFACTS/BRAIN) surface as warnings that never flip
the verdict.

### C1 — A truthful, discriminating done-signal *(HARD)*

**One command, deterministic, green at HEAD, fast (≤ 10 s), and genuinely
discriminating** — it must fail before the work exists and pass only when the
acceptance criteria are met. Declared as `quality_gate_cmd` in
`.forge/project.json`.

Three silent failure modes observed in production:

- *Hollow*: already green at iter-0 (gate not scoped to the unit of change).
- *False-pass*: exits 0 without running the new work (e.g. `-run` regex matching
  nothing; `go test` with `TF_ACC` unset silently skipping and printing
  `ok pkg 0.00s`).
- *Poisoned*: a sibling package's `[no tests to run]` line makes a passing gate
  look like a failure.

**Design rule:** scope the gate to the *unit of change* so empty ⇒ fail and
real-work ⇒ pass. The preflight checks structure, not runtime: a single command
(no `&&`/`;`/`|` chaining) that is not a known-slow umbrella
(`playwright`/`cypress`/`e2e`/`integration`).

#### C1b — CI alignment *(HARD when `ci_gate` is populated)*

The per-WI `quality_gate_cmd` must be the CI command or a strict subset subsumed
by it. Structural seams in `.forge/project.json`:

- `ci_gate` — the full CI command (used verbatim for CI-mirror WIs and as the
  final delivery gate before opening a PR).
- `ci_fix_cmd` — auto-formatters run before `ci_gate`.
- `ci_gate_unset_env` — strips live-test triggers from the env when running
  `ci_gate`, so it mirrors GitHub CI's clean environment.

---

### C2 — Hermetic commit capture *(HARD)*

The repo must be configured so **only intentional source edits enter a commit**.
Forge commits with `git add -A`; the project's `.gitignore` is the sole guard.

Three categories must be covered:

1. **Forge scratch:** `.forge/work-items/`, `AGENT.md`, `PROMPT.md`, `fix_plan.md`
   must be untracked *and* ignored (git-truth check: `git ls-files
   --error-unmatch` + `git check-ignore -q`).
2. **Build artifacts and generated outputs:** compiled binaries, `dist/`,
   coverage, graph caches — anything a build writes that isn't source.
3. **Force-tracked contract config:** `.forge/project.json` lives inside the
   ignored `.forge/` dir and must be explicitly tracked despite the ignore
   (`git add --force .forge/project.json`).

The check uses **git-truth** — a `.gitignore` entry is a no-op on
already-tracked files.

---

### C3 — Conflict-free decomposability *(advisory)*

Source files must sit under the project's size norm so parallel WIs can fan out
without colliding at merge.

- Soft warning: > 400 LOC
- Hard ceiling: 800 LOC (same ceiling forge holds on its own tree)
- God-file class (flag): ≥ 1,600 LOC (2×)
- Functions: ≤ 80 LOC; modules: single responsibility

Advisory — the PM's `detectHiddenCoupling` is the runtime guard.

---

### C4 — Machine-readable planning inputs *(HARD)*

A `roadmap.md` at the project root **and** a brain sub-wiki at
`<artifactRoot>/brain/profile.md` (Brain 3 inside the project repo) must both
exist. Without these the planner hallucinates plans for a project it doesn't
understand.

`artifactRoot` defaults to `"."` (legacy layout: `brain/` at the project root);
a project can set e.g. `"forge"` to gather all committed forge artifacts under
`forge/brain/` and `forge/history/`. See the Artifact Layout section below.

---

### C5 — Declared untouchables *(advisory)*

A constraints doc must exist (`CLAUDE.md`, `AGENTS.md`, `.forge/constraints.md`,
or `CONSTRAINTS.md`) declaring what forge may not change: git ownership, "never
edit tests to pass," generated files that must not be hand-modified, calibrated
per-project thresholds.

Advisory — file presence cannot prove the harness honours the constraints; it
proves the operator declared them.

---

### C6 — Satisfiable merge model *(advisory — forge-side-satisfied)*

Forge produces a PR and stops; the operator merges in GitHub. No auto-merge. The
only project-side requirement is a GitHub remote. Advisory because this clause
is structurally satisfied by forge post-Phase-6; the check only confirms the
remote exists.

---

### C7 — External-resource model *(HARD when `acceptance_gate.required = true`)*

For projects whose behaviour can only be verified against a live external system,
the done-signal must split into two tiers, both declared in `.forge/project.json`.

**Tier 1 — per-WI (every dev-loop iteration):** fast, creds-free, deterministic,
≤ 10 s. The `quality_gate_cmd` — never requires live external systems.

**Tier 2 — pre-PR (once per cycle):** the `ci_gate` with live-test triggers
stripped via `ci_gate_unset_env`, plus a mandatory live-acceptance WI whose
per-WI gate runs with live creds.

Three structural seams in `.forge/project.json` make the two-tier model
impossible to bypass:

**`acceptance_gate: { match, required, requires_env }`** — when `required: true`,
the PM phase hard-fails unless ≥ 1 emitted WI has a `quality_gate_cmd` token
matching `match`. `requires_env` closes the false-pass hole: a matching gate
whose listed env vars are unset is **errored**, not silently skipped.
`requires_env` must list every var the test's `PreCheck` demands.

**`standing_work_item_acs: string[]`** — verbatim testing invariants appended
to every WI body as a `## Standing acceptance criteria (project contract)`
section. Encodes project-wide invariants as structural injection rather than
per-WI PM judgment.

**`ci_gate_unset_env: string[]`** — strips live-test triggers from the env
before the final CI delivery gate runs.

Live-tier discipline: each live test creates uniquely named resources
(UUID-prefixed); teardown runs on success AND failure; creds via a gitignored
`secrets.env`; read-back assertion (separate GET/describe after
create/update); non-default fixture values for every field under test (see C9).

---

### C8 — Human-authored agent-instruction file *(advisory)*

An `AGENTS.md` (the canonical single source; legacy projects may keep a
`CLAUDE.md`) at the project root with exact shell invocations for build/test/lint
near the top, and any locked-core mandates. Forge never creates or overwrites this
file *unattended*. The Studio **instructions-creator** may draft it through an
operator-confirmed interview — the human approves before it is written and owns the
result. The Studio `instructions` surface binds to this one file (it is read from
AGENTS.md, not stored separately), so there is exactly one set of instructions.

Research grounding: human-authored minimal context files yield ~4 pp
task-completion uplift; auto-generated ones yield –2 % to –3 % and +20–23 %
inference cost. The operator-confirmed interview preserves human ownership — the
uplift comes from a human-vetted file, which the confirm-gate guarantees. Keep
under 200 lines; place load-bearing rules at the top.

The per-cycle forge scratchpad `AGENT.md` (written by forge during the dev-loop)
is distinct from `AGENTS.md`/`CLAUDE.md` (operator-owned). The scratchpad must
be gitignored (C2); the instruction file must be present and operator-owned (C8).

---

### C9 — Non-default fixtures with read-back assertions *(advisory; HARD for C7 projects)*

Core acceptance criteria and test fixtures must use non-default, non-zero values
for every field under test, and every create/update test must verify the stored
state via a separate read-back call — not just assert the write response.

Default values make gates blind to server-side normalisation: the server accepts
the request but ignores the field and returns the default, which equals the
asserted value, producing a false pass.

Concrete practices: string fields like `"test-sentinel-abc123"` (not `""`),
resource names prefixed with a run-specific UUID, a shared fixture factory
(`fixtures.go` / `fixtures.ts` / `conftest.py`) referenced in `AGENTS.md`, and
`ImportStateVerify: true` for IaC providers.

---

### C10 — Documentation parity & release *(advisory; active when `releaseProcess` declared)*

A project that ships versioned releases must keep its **documented surface, its
changelog, and its version in sync with the code that merges** — and must own the
release in CI, not in forge. This clause is **opt-in**: it is inert unless the
project declares a `releaseProcess` block in `.forge/project.json`. A project that
omits the block is unaffected (the entire release flow is skipped).

When declared, the clause has three parts, all enforced by forge's release flow:

1. **In-cycle draft changelog.** Every work item in a release-bearing initiative
   carries a standing AC to draft a changelog entry under `## [Unreleased]`. The
   unifier authors the draft into `changelogPath`; the DRAFT is what ships in the
   PR. (Source of intent: the `changelog`/`in-cycle` step.)
2. **Post-approval pre-merge finalisation.** When the operator approves, forge's
   **release-finalizer** runs on the PR branch *before* merge: it computes the
   semver bump, promotes the draft to a versioned `## [X.Y.Z] - <date>` entry,
   runs the declared `pre-merge` steps (doc regeneration, version-file bump), and
   commits + pushes. Failure is log-and-continue — the merge still proceeds with
   the DRAFT as the fallback. (Source of intent: the `pre-merge` steps +
   `versionFile`/`docsDir`.)
3. **CI release on merge.** Forge **ships** a release CI workflow
   (`studio/starters/release-workflow.yml.example`, installed at
   `.github/workflows/release.yml` during onboarding) that reads the committed
   version/changelog and tags + cuts the release on merge to the default branch.
   **Forge never runs tag/publish** — that is exclusively CI's job.

The point: a merged feature whose docs/changelog/version are stale ships a lie;
this clause makes "the release artifacts are truthful and tagged by CI" a
structural property when the project opts in.

---

### DEMO — The change is demonstrable *(advisory)*

The project declares how a change is demonstrated in **two married faces of one
declaration**, not two competing fields:

- **`demoProcess`** (Face A — typed steps `capture` / `verify` / `present`) is the
  **executed demo**: `capture` steps name the before/after evidence to record,
  `verify` steps name the assertion that makes the evidence non-trivial (forge
  runs the step and encodes its concrete result), `present` steps say how it is
  surfaced. This is the primary declaration.
**The unifier/demo skill derives the executed demo from `demoProcess`.** A
`demoProcess` must include at least one `capture` step and one `verify` step —
checked by preflight (advisory).

The demo is evidence, not a test log. "Tests pass" and "feature is demonstrable"
are different guarantees. The review phase must show the actual resource (API GET
response, rendered page screenshot, plan output) — not a table of test names.

**Demo deliverable — an agent-built, per-initiative demo skill, not a fixed JSON
schema (Stage B).** The Studio **demo-builder** authors the project's reusable
**demo-generation skill** at `.forge/skills/demo-design/SKILL.md` (the same slug
the DEMO-SKILL clause checks) — the machinery that, for each completed
**initiative**, renders a rich, self-contained, Forge-styled HTML demo of *that
initiative's changes* (before/after of its diff, with real captured output). It is
NOT a generic current-state showcase: the unit of a demo is "what this initiative
changed". The operator builds the skill interactively — look-and-feel prompt + the
`demoProcess` above → the agent authors the skill and renders a real **sample**
(`.forge/demo/DEMO.html`) from a representative recent change → review → feedback →
lock for reproducibility. This replaces the rigid `demo.json` contract (whose fixed
shape was a recurring wedge): demos are bespoke HTML the project's own skill emits,
`demoProcess` is still the declaration of *what* to capture/verify, and the locked
skill is what later cycles run per merged initiative.

---

### DEMO-SKILL — The generated demo-design machinery exists *(advisory)*

`DEMO` checks the demoProcess *shape*; `DEMO-SKILL` checks the demoProcess was
actually *realised*. DEC-4: a project that declares a `demoProcess` should carry a
**generated demo-design skill at the fixed path `.forge/skills/demo-design/SKILL.md`**
(produced by the `demo-design` skill from the project's `demoProcess` + code — it
encodes the concrete capture commands the unifier runs each cycle). The fixed slug
+ path make this verifiable: `forge preflight` WARNs (`DEMO-SKILL`) when a project
declares a demoProcess but lacks the generated skill, and onboarding (Step 10)
generates it. Not applicable (passes) until a `demoProcess` is declared — `DEMO`
owns that case, so there is no double-warn.

---

### ARTIFACTS — Build artifacts gitignored *(advisory)*

Build outputs and generated files must be gitignored. The preflight checks
structurally (for the detected language, does `.gitignore` mention any
characteristic build-output patterns?). Zero coverage is flagged; presence of any
one hint clears it.

---

### BRAIN — Brain freshness *(advisory)*

Scans `<artifactRoot>/brain/themes/*.md` in the project repo for `src/`/`tests/`
paths that no longer exist in the project tree. A stale theme silently misleads
the PM/architect. WARN-only: themes legitimately reference history; the operator
judges.

---

## Artifact layout

Everything a project exposes to forge lives in one of three zones:

### `.forge/project.json` — the contract config

The project's canonical forge configuration. Lives in the project repo. Tracked
in git via force-add (C2). Contains both Studio object fields (Face A) and
operational-clause fields (Face B). The authoritative type is `ProjectConfig`
in `orchestrator/project-config.ts`.

### `<artifactRoot>/{brain,history}` — committed forge artifacts

The project-relative subdirectory `artifactRoot` (default `"."`) scopes all
**committed** forge artifacts:

- **`<artifactRoot>/brain/`** — Brain 3: the project's knowledge base
  (`profile.md`, `themes/`, the KB graph). Read by planners and reflectors via
  the `KbBackend` seam.
- **`<artifactRoot>/history/<initiative-id>/`** — the development history store
  (see below).

Setting `artifactRoot: "forge"` (for example) gathers both under `forge/brain/`
and `forge/history/`, giving the project a single visible home for its forge
artifacts. Validated as a clean relative path (no leading `/`, no `..`). Existing
projects retain the default `"."` (no migration required).

### Runtime/session scratch — gitignored, never committed

- `_architect/` — architect session state
- `demo/<initiative-id>/` — demo output written during the unifier run
- `.forge/work-items/` — per-cycle PM output

These are excluded by the project's `.gitignore` (C2 enforces this).

---

## Development-history convention

Every initiative leaves a **browsable, committed record** at
`<artifactRoot>/history/<initiative-id>/` in the project repo. The convention
has three entries:

| Path | Content |
|------|---------|
| `plan.md` | The initiative brief + approach as written by the architect/PM |
| `demo/` | The demo evidence produced by the unifier (screenshots, API responses, CLI captures) |
| `verdict.json` | The operator's approve/send-back verdict and timestamp |

The project's agents write this into the worktree as part of the work so it lands
in the PR and is committed — "showcase the history of project development through
plans and demos." This is a **convention enforced by the project's own
instructions and skills**, not hard-coded forge logic. The project's `AGENTS.md`
or `instructions` field should direct agents to write these files; the
`demoProcess` field (Face A) declares which steps populate `demo/`. Forge
provides the `artifactRoot` path so the convention is consistently locatable.

---

## Enforcement table

| Clause | Check | Enforcement |
|--------|-------|-------------|
| northStar | UI readiness (ContractReadiness) | Length > 0 and ≤ 140 |
| instructions | UI readiness | Non-empty string |
| demoProcess | UI readiness | ≥ 1 capture + ≥ 1 verify step |
| skills | UI readiness | ≥ 1 slug |
| kb | UI readiness | Non-null string |
| C1 / C1b | `forge preflight` — **HARD** | Structural: single command, not a slow umbrella; `ci_gate` presence |
| C2 | `forge preflight` — **HARD** | git-truth: `git ls-files` + `git check-ignore` |
| C3 | `forge preflight` — advisory | File size walk (800 / 1600 LOC thresholds) |
| C4 | `forge preflight` — **HARD** | `roadmap.md` + `<artifactRoot>/brain/profile.md` existence |
| C5 | `forge preflight` — advisory | Constraints doc presence |
| C6 | `forge preflight` — advisory | GitHub remote existence |
| C7 | PM phase — **HARD** (when `required: true`) + dev-loop gate (`requires_env` guard) | `acceptance_gate` enforcement; `ci_gate_unset_env` on final delivery gate |
| C8 | `forge preflight` — advisory | `AGENTS.md` / `CLAUDE.md` presence |
| C9 | Hand-verified at onboarding; HARD for C7 projects (fixture review) | Not yet machine-checked |
| C10 | Release flow — advisory (active when `releaseProcess` declared) | Draft changelog (PM standing AC) + pre-merge finalisation (release-finalizer) + CI release workflow installed |
| DEMO | `forge preflight` — advisory | `demoProcess` structural validation: ≥1 capture step + ≥1 verify step |
| ARTIFACTS | `forge preflight` — advisory | Language-specific build-output hints in `.gitignore` |
| BRAIN | `forge preflight` — advisory | `brain/themes/` path-existence scan |

**Readiness convergence:** `data-flow-ready="true"` on the project builder
readiness panel requires all five UI checks AND `preflight.clauses.filter(hard &&
!pass).length === 0`. A project that is flow-ready in the UI is preflight-green.
A project that is preflight-green but has unmet Studio-field checks is not
flow-ready — the flow engine will not accept it.

---

## betterADO worked example

| Clause | betterADO satisfaction |
|--------|------------------------|
| northStar | `"Forge-managed Terraform provider for Azure DevOps (pipeline management)."` |
| instructions | Two standing ACs injected into every WI (live acceptance + CI-equivalent) |
| demoProcess | `capture`: `terraform apply` run; `verify`: ADO API GET assert + idempotency re-plan; `present`: portal screenshot |
| skills | `forge-onboard-project`, `demo` |
| kb | `betterado` (Brain 3 in `brain/`) |
| **C1 / C1b** | `quality_gate_cmd`: `go test -tags all -count=1 ./...` scoped to changed packages. `ci_gate`: `make test && golangci-lint run ./... && make terrafmt-check`. `ci_fix_cmd`: `make fmt && make terrafmt` |
| **C2** | `.gitignore` covers `.forge/work-items/`, compiled provider binary, `*.tfstate`, `.terraform/`. `.forge/project.json` force-tracked |
| C3 | Net-new code isolated to `azuredevops/internal/service/release/` and `/taskagent/`. No god-files in net-new scope |
| **C4** | `roadmap.md` at project root. Brain seeded with `profile.md`, release substrate context, failure-mode themes |
| C5 | `CLAUDE.md`: never run `go build ./...`, never edit tests to pass, user owns git |
| C6 | GitHub remote at `parsoFish/terraform-provider-betterado` |
| C7 | `acceptance_gate: { match: "acceptancetests", required: true, requires_env: ["TF_ACC"] }`. `ci_gate_unset_env: ["TF_ACC"]`. Two `standing_work_item_acs`. Live tests: unique names, destroy on success/failure, `SharedReleaseFixture`, API GET read-back |
| C8 | Operator-authored `CLAUDE.md` with exact `go test` invocations, `make` targets, and hazard prohibitions |
| C9 | `SharedReleaseFixture` uses non-default values (UUID prefix, explicit retention, explicit approvals). `TestCheckResourceAttr` + `ImportStateVerify: true` + `ExpectNonEmptyPlan: false` |
| DEMO | `demoProcess` capture/verify steps drive the apply → API GET → portal screenshot → destroy flow; requires real ADO REST round-trip evidence (API GET response) when creds are present |

---

## The point: roadmap-scale, not single-WI

Meeting the contract is what makes the intended operating mode work: the operator
hands forge a **roadmap-scale, multi-feature** initiative and forge decomposes it.
A project that doesn't meet the contract tempts the operator to shrink scope to
compensate (single-WI initiatives) — that's a smell, not the target. Fix the
contract gap instead.

---

## See also

- [ADR-034](./decisions/034-studio-aligned-contract.md) — the decision recording
  the Studio-aligned unification (extends ADR-017).
- [ADR-017](./decisions/017-forge-project-contract.md) — the original contract
  decision (trafficGame arc, C1–C6 derivation).
- [`cli/preflight.ts`](../cli/preflight.ts) — the operational-clause enforcement.
- [`orchestrator/project-config.ts`](../orchestrator/project-config.ts) — the
  authoritative `ProjectConfig` type + `validateProjectConfig`.
- [`forge-ui/components/studio/project-builder/ContractReadiness.tsx`](../forge-ui/components/studio/project-builder/ContractReadiness.tsx) — the UI readiness surface.
- [`docs/schemas/project-config.schema.json`](./schemas/project-config.schema.json) — operator-facing schema.
- [`skills/demo/SKILL.md`](../skills/demo/SKILL.md) — the forge half of the demo contract.
- `brain/forge-dev/themes/forge-project-onboarding-contract.md` — origin theme (trafficGame arc).
