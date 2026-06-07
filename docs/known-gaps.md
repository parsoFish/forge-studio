# Forge — known gaps & hardening backlog

> **Status: operator-driven backlog, NOT forge initiatives.** Forge is not
> self-hosted (we don't run forge cycles against forge itself right now), so
> these are notes for a human (or a future Claude session) to pick up directly
> — not manifests for the queue.
>
> This is a **living doc**: append findings here so they survive across fresh
> sessions instead of being deferred and forgotten. Date each entry; strike or
> move items when resolved.

## Why this doc exists (2026-05-29)

Most of the gaps below trace to the same root cause: **forge has been built
across many fresh Claude sessions**, each with no memory of the last. The
pattern that produces drift is "fix the code, defer the cleanup, lose the
context at session end" — which accumulates into half-removed features,
contradictory brain themes, and stale metadata. Examples already observed:
wedged-detection removed in code but still described as live in the brain;
`LoopResult.'wedged'` left dangling; `bench:promote` half-pointing at deleted
paths. A living gaps doc + a session-boundary reconcile habit is the
cheapest counter.

Surfaced by the critical review of the 2026-05-29 claude-trail "cascade v4"
verification cycles (a stalled-then-resumed cycle that exercised the new
resume-from-unifier path, [ADR 019](./decisions/019-cycle-resume-from-unifier.md)).

---

## 2026-05-31 — architect/PM decomposition boundary is under-specified (the breakdown can happen twice) — ✅ RESOLVED 2026-06-04 (R1)

**Resolved (R1):** the feature layer was removed entirely. The architect emits
initiatives whose body carries Given/When/Then ACs directly (no `features[]`),
and the PM decomposes those ACs straight into right-sized work items — the
breakdown now happens exactly once, at the PM. The "breakdown can happen twice"
smell is structurally impossible without an intermediate feature tier. Original
finding below for the record.

Surfaced by the operator watching the release_definition dogfood cycle. The
intended hierarchy is **feature → WI → file** (`skills/architect/SKILL.md` §type:
implementation): the **architect** produces an initiative's `features[]`; the
**PM** decomposes each feature into atomic **work items**. The PM is correctly
*bound* to the architect's features (it cannot invent or drop them — the Phase-C
coverage + hallucination checks enforce that), so it does **not** regenerate the
*feature* set. So far, so good — two distinct levels, each decided once.

**The smell (real):** nothing pins the *granularity* of a feature vs a work item,
so the architect can decompose all the way to **WI granularity**. In this cycle it
emitted features literally titled `WI-1: Scaffold…` and `WI-2: …6 tests`, and the
PM then mapped them **1:1** to WI-1/WI-2. The chunking decision was effectively
made at the architect and **re-made** at the PM (which re-runs a full SDK
decomposition pass to land in the same place, then adds ACs/gates/file-scope).
Worse, the architect *may* also set per-feature `quality_gate_cmd` / `non_goals`
(the C4 optional fields) — the very fields the PM sets per WI — so the gate
decision can be specified at both levels too.

- **Why it matters:** the operator's ask is "perform the breakdown once." Today,
  for small initiatives, the architect and PM can both own the WI-sizing (and
  potentially the gate) decision — duplicated reasoning + a duplicated SDK
  decomposition pass + ambiguity about which level is authoritative.
- **Direction (pick one, make it explicit in both skills):**
  (a) The architect produces **coarse** features — capability/concern groupings,
  explicitly NOT work items, no per-feature gates — and the PM owns ALL WI sizing
  + gates (one breakdown, at the PM). OR
  (b) When the architect's features already *are* WI-sized (small initiatives),
  the PM **enriches** them into WIs (ACs/gates/scope) without re-deciding the
  chunking — i.e. the PM stops being a second decomposition pass.
  Either way: name the authoritative level for WI-sizing + the gate decision so it
  is decided exactly once.
- **Evidence:** R1 removal recorded in
  [ADR 015 amendment](./decisions/015-work-item-format.md#amendment-2026-06-04--feature_id-field-removed)
  + [ADR 007 amendment](./decisions/007-markdown-artifact-flow.md#amendment-2026-06-04--feature-layer-removed);
  `skills/architect/SKILL.md` + `skills/project-manager/SKILL.md` (now direct-AC
  decomposition, no feature tier). Original incident:
  `_logs/2026-05-31T10-15-32_INIT-2026-05-31-release-definition-unit-tests/`
  (architect FEAT-1/2 titled WI-1/WI-2 → PM WI-1/WI-2, 1:1).

## 2026-05-31 — unifier loops `branches-not-in-sync` because the per-iteration autocommit never pushes — ✅ RESOLVED 2026-05-31

**Resolved** by `43b5cfb` (direction (a): push inside the unifier's `onIteration`
callback so the next gate check sees `origin == HEAD`; the strip is append-only so
the push is always a fast-forward). **Verified end-to-end** by a
`forge requeue --resume-from=unifier` (ADR 019) on the preserved worktree: the
unifier passed in **1 iteration** (`stop_reason:quality-gates-pass`), **0**
`branches-not-in-sync` events (was 4), and **PR #2** opened on
parsoFish/terraform-provider-betterado carrying the 11 gomock tests + the demo
bundle — resume cost $0.80. Original finding below for the record.

Surfaced by the **second** release_definition dogfood re-run (the run that
validated the Phase A–I hardening). The dev-loop delivered **2/2 WIs** (11 gomock
tests, `dev-loop.delivered {files_changed:4, insertions:1253, commits:7}`), then the
**unifier** looped on `unifier.gate.branches-not-in-sync` for its full
(diff-scaled) cap of 4 iterations → `unifier.failed {stop_reason:iteration-budget}`
→ the **delivery gate correctly blocked the PR** → cycle failed cleanly at $16.30.

**Root cause (confirmed in code):** the unifier's composed gate sub-check #4,
`branches_in_sync`, calls `assertLocalRemoteSynced` →
`checkLocalRemoteSynced` ([`orchestrator/pr.ts:705`](./../orchestrator/pr.ts)),
which is **strict**: when an origin remote exists it requires
`origin/<branch> === local HEAD` exactly. But the Ralph runner runs
`autoCommitWorktreeIfDirty` at the top of every iteration
([`loops/ralph/runner.ts:226`](./../loops/ralph/runner.ts)) — it commits a
`forge-autocommit: … WIP` safety-net commit **but does not push it**
([`loops/ralph/stop-conditions.ts:359`](./../loops/ralph/stop-conditions.ts)).
The unifier loop itself has **no push step** (unlike the per-WI loop, which pushes
via `pushInitiativeBranch` after each WI). So the moment the unifier agent leaves
the tree dirty (or commits without pushing), the autocommit puts local HEAD one
commit *ahead* of origin → `branches_in_sync` is now **unsatisfiable for the rest
of the loop**: every subsequent iteration re-autocommits, stays ahead, and the gate
fails again until the cap. The work is real and the per-WI commits *were* pushed —
only the unifier-stage commits are stranded local.

- **Why it matters:** a genuinely-delivered branch (2/2 WIs green) is held back
  from review by a gate that can never go green mid-loop. The diff-scaled cap
  (Phase G) bounds the wasted spend (4 iters, not 15), and the delivery gate
  (Phase E) correctly refuses to open a misleading PR — but the *outcome* is a
  false-negative: review-ready work scored as `dev-loop-unifier-branch-divergence`.
- **Direction (pick one, make it explicit):**
  (a) **Push after the unifier autocommit** — when `autoCommitWorktreeIfDirty`
  fires inside a loop whose gate includes `branches_in_sync` AND the project has an
  origin remote, push the branch (mirror the per-WI `pushInitiativeBranch`). Keeps
  `origin == HEAD` so the gate can pass. Cleanest; downside is WIP commits reach the
  PR branch (acceptable — the unifier squashes/cleans before the PR anyway). OR
  (b) **Relax `branches_in_sync` to "no divergence" mid-loop** — accept
  *local-ahead-only* (origin is an ancestor of local) during the unifier loop, since
  the dev-loop *close* (`assertDevLoopCloseSync`) and `openPullRequest` both push +
  re-assert strict sync before the PR. Narrower change, but splits the invariant
  into two strictness levels.
  Either way the unifier must have a push step, or the strict check must move to a
  point where a push has happened.
- **What this run VALIDATED (the reason to keep it on record):** the `[no test
  files]` fix (run #1) held — WIs proceeded 2/2; the **green baseline gate**, **PM
  feature-coverage** (2 features → 2 WIs, no hallucination), **scoped discriminating
  gates** (gate-recipes), the **diff-scaled unifier cap** (bounded the loop at 4),
  **`dev-loop.delivered`** (recorded the real 1,253-line delivery), the **delivery
  gate** (blocked the PR on unifier-not-passed — the exact quality-escape it exists
  to prevent), and the **cost guard** ($16.30 < $25 ceiling) all fired correctly.
- **Evidence:**
  `_logs/2026-05-31T…_INIT-2026-05-31-release-definition-unit-tests/events.jsonl`
  (the re-run: `dev-loop.delivered` then 4× `unifier.gate.branches-not-in-sync` →
  `unifier.failed` → `delivery gate: unifier did not pass`),
  `orchestrator/pr.ts` (`checkLocalRemoteSynced`, strict),
  `loops/ralph/runner.ts:226` + `loops/ralph/stop-conditions.ts:359`
  (`autoCommitWorktreeIfDirty`, commit-no-push),
  `orchestrator/phases/developer-loop.ts:1185` (gate sub-check #4).

## 2026-05-31 — the quality gate ≠ the project's own CI (forge shipped a PR the project CI rejects)

Surfaced taking the release_definition PR to completion through review. The forge
offline gate for betterado is `go test -tags all ./release/... ./taskagent/...` —
it proves the *tests pass* but never runs the project's **own CI checks**. When the
PR opened, betterado's CI (`make fmtcheck` inside the `test` job, plus `go-lint` /
`terrafmt`) went red — and one failure, the new test file not being `gofmt`-clean,
was **introduced by forge** (the dev-loop wrote an unformatted file and nothing in
the gate caught it). A reviewer had to `gofmt` it by hand before merge.

- **Why it matters:** "review-ready" should mean "passes the project's merge bar,"
  but forge's gate is narrower than the project's CI. forge can hand the operator a
  PR that the project's own pipeline rejects — exactly the kind of quality escape the
  delivery gate was meant to stop, one layer up.
- **Direction:** the contract's C1 (the gate proves the change) should align the
  per-WI gate with the project's CI contract — at minimum run the language formatter
  (`gofmt`/`prettier`/`black`) and, where cheap, the project's lint, as part of the
  gate or a pre-PR check. Onboarding should capture the project's CI command(s) as a
  contract clause so the gate can include them.
- **Evidence:** PR parsoFish/terraform-provider-betterado#2 (`go-lint`/`terrafmt`/
  `fmtcheck` red); the `gofmt` reviewer-fix commit on the cycle branch.
- **Note (project-side, betterado):** `go-lint` + `terrafmt` + the other 3 `fmtcheck`
  files (`provider.go`, `resource_release_definition.go`, `resource_task_group.go`)
  are **pre-existing fork debt** — betterado's CI has never been green since the fork
  added classic-release resources. A betterado CI-cleanup initiative (gofmt the tree,
  fix errcheck/unused/staticcheck, terrafmt the examples) is a good
  *properly-sized* unit of work (see the initiative-size feedback) — tracked for
  betterado's own backlog, not forge's.

## 2026-05-31 — the demo phase produces thin demos for projects that CAN show live/visual evidence

Surfaced by the operator's review of the release_definition demo (a `harness` table
of test-name PASS/missing) — underwhelming *right after* tightening the demo phase.
Two coupled gaps:

1. **The demo shape vocabulary** (`browser | harness | cli-diff | artifact | none`)
   has no category for **"live external system: API responses + external-UI
   screenshots."** `browser` assumes a *local* preview server forge drives; betterado's
   real evidence is a resource it creates in a live, hosted ADO org, visible via the
   REST API **and** the dev.azure.com portal. So betterado got classified `harness`
   ("Go test-harness, no web UI") and the demo skill even encodes that as a lesson —
   **underselling** a project that is very much visually demo-able.
2. **The demo phase doesn't compose a project-side demo skill.** The "demo as a
   contract" design wants forge's demo skill (the forge half) to compose the
   *project's* demo skill (the project half). Today the project half is only a
   `demo.shape` + `demo.command` in `.forge/project.json` — declarative, not a
   capability. betterado now has `.claude/skills/ado-demo/SKILL.md` (live apply → API
   GET + portal screenshots; tests-only → API double-confirm), composing its existing
   `ado-api-explorer` + `ado-browser-inspector` skills — but **nothing in forge wires
   the demo phase to discover and compose it.**

- **Why it matters:** the demo exists to make review *less* of a bottleneck. A
  test-name table for a change that could show the actual release pipeline in the ADO
  portal defeats the purpose — the operator approves on a weaker signal than the
  project can produce.
- **Direction:** (a) add a demo shape (or sub-mode) for live-system evidence
  (API + external-UI screenshots); (b) have the demo phase agent discover a project
  demo skill (e.g. `.forge/project.json` `demo.skill` → compose it) so the project
  defines *how* it shows a change; (c) onboarding builds that project demo skill as a
  contract deliverable. See the operator feedback captured in memory.
- **Evidence:** `projects/terraform-provider-betterado/.claude/skills/ado-demo/SKILL.md`
  (the project half, written 2026-05-31), `.forge/project.json` `demo` block,
  `skills/demo/SKILL.md` (forge half — currently shape-based), the PR #2 `demo.json`.

## 2026-05-31 — two machinery findings the release_definition reflector surfaced (persisted from a gitignored retro)

The `retro.md` for the release_definition cycle lives under gitignored `_logs/`, so
two forge-machinery observations are recorded here to survive:

1. **Cycle report shows the wrong quality-gate command.** The report renders
   `(default: npm test if package.json exists)` as the quality gate, but the actual
   gate run was the Go command from the manifest — `quality_gate_cmd` isn't
   propagating to the report renderer. Misleads the operator about what was proven.
   *(Display/config-surface bug; the gate itself ran correctly.)*
2. **Unifier briefly orients in the forge root, not the worktree.** The unifier's
   first Bash commands ran `cd /home/parso/forge && git log …` before correcting to
   the worktree — read-only, self-corrected, no harm, but it inflated iteration-1's
   command count and is a context-orientation smell worth tightening in the unifier
   prompt (anchor it to `worktreePath` up front).

Both are low-severity; #1 is the more operator-visible (a review reads the report).

## 2026-06-01 — the dev-loop under-produces on NET-NEW code (the next bottleneck after the orchestration fixes)

Surfaced by the betterado roadmap re-run after Wave-1/2 landed (the orchestration —
deps DAG, deterministic finalize, deps-gating — all validated). Two initiatives
reached the dev-loop and BOTH failed 0/1 at ~$9-10, and the pattern is the same
class: **net-new code**, where forge's earlier betterado successes were all
*tests-for-an-existing-resource*.

1. **From-scratch resource: over-research, under-produce.** `release-folder` (a new
   `betterado_release_folder` CRUD resource + 5 tests, sized as ONE WI) burned all 5
   iterations *researching* — the agent's own iteration texts: "let me check the
   release SDK… the utils package… the Folder struct + docs" — and **never wrote
   `resource_release_folder.go` or its tests**. The gate (`go test -run
   ^TestReleaseFolder ./release/`) kept hitting `[no tests to run]` → no-work
   rejection ×5. Direction: (a) budget from-scratch-resource WIs higher than
   tests-for-existing WIs; (b) add a **write-first nudge** to the per-WI dev-loop
   prompt (`loops/ralph/PROMPT.md.tmpl` / dev-invocation) — the unifier has one;
   the dev-loop, on a big from-scratch WI, researches to budget exhaustion;
   (c) reconsider decomposing a from-scratch resource into schema→CRUD→tests WIs.
   NOTE the tension with the new PM "enrich, don't split" rule (`pm-invocation.ts`):
   its "split only when parts touch independent files" heuristic doesn't capture
   "one file, but too much work for one WI" — a from-scratch resource is one `.go`
   file yet too big for one WI/budget.
2. **Sweeping-cleanup WI mis-scoped.** `ci-green`'s WI gate was module-wide
   (`golangci-lint run ./azuredevops/...`) but its `files_in_scope` was ~6 files;
   the linter flags errcheck/unused/SA1019/gofmt across MANY out-of-scope files the
   dev-loop can't touch → the gate is **structurally unsatisfiable** within the WI's
   scope (2-iter budget for a whole-fork cleanup). Direction: a sweeping/mechanical
   cleanup needs a file-scope covering EVERY flagged file (or a gate scoped to the
   file-scope). Also: forge's gate accepted a WI using **`go build ./...`** which
   betterado's `CLAUDE.md` explicitly forbids ("fills the drive") — the project's
   documented build constraints should feed the gate (ties to the gate≠project-CI
   finding above).

**What this is NOT:** an orchestration regression. The scheduler claimed only the
unblocked root and HELD the dependents; both failures were classified + capped (no
hang — #6 held); the dependency contract correctly kept the leaves blocked on the
failed prerequisite. The orchestration refinements work; the dev-loop execution on
*from-scratch* work is the next layer. Evidence: decision log
`docs/autonomous-runs/2026-06-01-overnight.md`; cycle logs
`_logs/2026-06-01T13-18-09_INIT-2026-06-01-ci-green/`,
`_logs/2026-06-01T13-36-…_INIT-2026-06-01-release-folder/`.

## 2026-06-02 — dev-loop fixes (file-freedom + cwd-anchor) + a gate-INTEGRITY finding

After the operator flagged that (a) `files_in_scope` shouldn't fence the agent and
(b) Ralph iterations should build on prior output not restart, the dev-loop prompts
were fixed (commits `ba73ecd`, `6de3836`) and the two failing betterado initiatives
re-run. Results split:

- **`ci-green` — file-freedom fix WORKED, but it GAMED the gate (a new integrity
  gap).** With scope no longer fenced, the dev-loop genuinely fixed gofmt + terrafmt
  + 11 real `//nolint:staticcheck` (SA1019) + dead-code removal, and its WI gate
  (`golangci-lint run`) passed → reached ready-for-review (PR #3). BUT **GitHub CI is
  still RED**: the `test` workflow (`make test` = `go test ./...`) fails on
  `TestProvider_HasChildResources` (expects 131 resources, got 132 — `betterado_task_group`
  is registered in `provider.go` but missing from `provider_test.go`'s list; a
  one-line fix the dev-loop had the freedom to make). Worse, the **demo gamed it**:
  `demo.json`'s AC4 silently swapped the whole-module `make test` (what CI + the WI's
  AC4 require) for a narrowed `go test ./release/... ./taskagent/...` that *excludes*
  the failing package, then claimed "all pass." Two root gaps: (1) the WI's
  `quality_gate_cmd` was **lint-only** — it didn't cover AC4's `make test`, so forge's
  gate went green while CI's required check is red (the gate≠project-CI theme again);
  (2) nothing forces the **demo/unifier to run the WI's declared gate verbatim** — it
  can narrow the command in `demo.json` and the delivery gate won't notice.
  Direction: for a project with a CI command, the per-WI gate (and the demo's claimed
  command) should BE/mirror the project CI — at minimum the gate must cover every AC's
  `when` clause. **PR #3 is a SEND-BACK, not a merge.** Verdict + evidence:
  workflow `wf_b8307c34-c70`.

- **`release_folder` — real root cause is the PER-ITERATION TURN CAP (was 25), now
  fixed.** It is NOT missing-SDK (the Folder API is present), NOT laziness, NOT spec
  ambiguity (the WI correctly specifies `name` as Computed-from-path), and NOT model
  weakness (DEV_MODEL is Sonnet 4.6). Two contributing defects were found + fixed, but
  the BINDING constraint was the turn budget:
  - *(contributing, fixed `6de3836`)* the cwd-hallucination anchor (F-W5-6) lived only
    in the dead `loops/ralph/PROMPT.md.tmpl`; the live `renderDevUserPrompt()` had no
    "Your working directory" block, so the agent wasted calls re-locating the tree.
  - **(binding, fixed) `DEV_LIVE_MAX_TURNS_PER_ITERATION = 25` was too tight for a
    from-scratch resource.** First-hand on the 3rd failure (cwd-anchor + write-first
    BOTH live): the agent did **55 greps + 13 reads + 8 git/orient + 0 writes** and
    every iteration's final message was mid-research ("now I have everything I need,
    let me check one more thing") — it hit the 25-turn cap researching the SDK type +
    the build_folder reference + tfhelper, and the turn ENDED before it wrote. Nothing
    persisted (no code, and `AGENT.md` stayed the empty template), so the next
    iteration re-researched from zero. Bumped to 50 (cost_budget/iteration_budget
    remain the real spend bounds; the agent stops when the gate passes, so a simple WI
    isn't made pricier). LESSON: tests-for-existing-resource WIs fit in 25 turns;
    net-new code needs room to research AND write in one iteration.
  - Also a dead-path-drift lesson: fixes added to `PROMPT.md.tmpl` miss the live
    `renderDevUserPrompt` — they should be one source.
  - **★ VALIDATED (`c54adff`):** with maxTurns=50, release-folder landed on the **4th**
    run in **1 iteration** (`stop_reason: quality-gates-pass`, 615 insertions) — it
    finally wrote `resource_release_folder.go` + its tests. The turn cap was the
    binding constraint. (Cheaper too: $4.86 vs the $7-9.50 failures — fewer wasted
    iterations.)

**Two next-layer findings this loop also confirmed (the gate≠CI theme):**
- **CI-first is load-bearing — proven by overriding it.** I un-blocked release-folder
  (overrode the operator's CI-first dependency) so it branched from the **still-red**
  main (ci-green unmerged) → its PR #4 CI is red on the inherited lint debt + the
  count test. Had ci-green merged first (greening main), release-folder would have
  built on a green base. This is exactly why a dependent must wait for its
  prerequisite to merge.
- **Both PRs (#3, #4) have red GitHub CI on a brittle `provider_test.go`**: a
  hardcoded `expectedResources` count (131) that breaks whenever ANY resource is
  registered (ci-green: 132; +release-folder: 133). ci-green should have fixed it but
  the WI gate was lint-only + the demo narrowed `make test` to dodge it. The clean
  fix: the per-WI gate for a CI-green initiative must BE/mirror the project CI
  (`make test` whole-module), so forge's gate goes red until the count test is fixed —
  and the demo must run the declared gate verbatim, not a narrowed one.

**✅ RESOLVED + VALIDATED 2026-06-02** (`f3ed6cd`, `4b0193ae`, `df79ab5`):
- **Gate-mirrors-CI**: `.forge/project.json` gains `ci_gate` (the full CI command);
  `pm-invocation` requires a CI-green WI to use it verbatim (never a narrow proxy);
  `dev-invocation` tells the agent to run the project's auto-fixers (`make fmt` /
  `make terrafmt`) on a format/lint failure; `unifier-invocation` forbids the demo
  from claiming a pass on a narrower command than the gate.
- **Turn-cap → backstop** (`DEV_LIVE_MAX_TURNS_PER_ITERATION` 25→120): cheap
  exploration no longer prematurely ends an iteration; the token-weighted cost_budget
  is the real bound (operator steer: don't count cheap greps like impactful generation).
- **Stale-base on re-run** (`forge requeue` now deletes the branch on a non-resume
  re-run → fresh-from-current-main; resume still preserves it).
- **End-to-end proof**: ci-green re-ran, the dev-loop adopted the full-CI gate, ran
  `make fmt`/`terrafmt` + fixed the `provider_test.go` count, and produced **PR #5 with
  all 4 GitHub CI checks green** — merged to betterado `main`. The demo ran the full CI
  verbatim. The original gate-gaming can't recur (forge's authoritative gate IS the CI).

## 2026-06-06 — a live-acc WI's per-WI gate doesn't run the project linter, so the dev-loop ships CI-red code (gate ≠ CI, live-acc variant)

Surfaced driving the `shared-acceptance-fixture` initiative (a shared live ADO
test fixture) through forge end-to-end. The architect → PLAN → PM → dev-loop all
worked cleanly: PM emitted 2 well-grounded WIs (all under `azuredevops/`, both
live-acc TF_ACC gates, standing ACs injected, DAG WI-1→WI-2), the dev-loop
delivered the fixture (`shared_fixtures.go`, 464 lines) + refactored
`TestAccReleaseDefinition_basic`, both per-WI **live-acc gates passed live** (real
ADO apply → API round-trip → destroy), and the unifier passed. Then the **final CI
delivery gate** (`make test && golangci-lint run ./... && make terrafmt-check`,
TF_ACC correctly stripped — the A3 fix working) caught **`golangci-lint` errcheck
violations** in the new fixture (`_ =` on the four cleanup `Delete` calls under
errcheck `check-blank`, and two `id, _ := uuid.Parse(...)` discards) and
**correctly refused to open a PR**. The cycle failed at $14.75 / 22m with the
worktree preserved.

- **Why it matters:** the delivery gate did its job (no CI-red PR shipped), but the
  *dev-loop* should have caught this itself. A live-acc WI's `quality_gate_cmd` is
  the acceptance test (`go test -run TestX ./acceptancetests/`), which does **not**
  run `golangci-lint`. The standing AC (A2b) *tells* the agent "CI-equivalent
  (push-green) must pass — `golangci-lint run ./...`", but nothing **enforces** it
  at the per-WI gate. So the agent marks the WI `complete` on a green acc test while
  its code is lint-red, and the failure only surfaces at the cycle-level CI gate —
  which fails the **whole cycle** (expensive, net-new fixture re-run) instead of the
  dev-loop self-correcting in-iteration. Same "gate ≠ project CI" class as the
  2026-05-31 / 2026-06-02 findings, now in the **live-acc WI** guise (there the gate
  was lint-only and missed `make test`; here the gate is the acc test and misses lint).
- **Direction (pick one):**
  (a) For a project with a `ci_gate`, the per-WI gate for a **live-acc WI** should
  ALSO run the project's linter (append `golangci-lint run <pkg>` / the language
  formatter to the composed per-WI gate), so a lint-red WI can't reach `complete`. OR
  (b) Run a **lint/format sub-check at dev-loop close** (before the WI is marked
  complete) scoped to the changed files — cheaper than the whole-module CI gate, and
  it fails the iteration (self-correct) rather than the cycle.
  Either way the linter must run *inside* the dev-loop, not only at the post-unifier
  delivery gate.
- **Workaround used this cycle (operator):** hand-fixed the 6 errcheck lines
  (`mustParseUUID(t,…)` helper + `if err := …; err != nil { t.Logf(…) }` on the
  cleanup deletes), committed to the branch, and `forge requeue --resume-from=unifier`
  → the CI gate re-ran green → PR. The fixture itself (the delivered work) was sound;
  only the lint hygiene slipped the per-WI gate.
- **Evidence:** `_logs/2026-06-06T09-03-51_INIT-2026-06-06-shared-acceptance-fixture/`
  (`cycle.ci-gate` `ok:false` with the errcheck output; per-WI `ralph.end`
  `stop_reason:quality-gates-pass` for both WIs), branch
  `forge/INIT-2026-06-06-shared-acceptance-fixture` commit `52efbdee` (the fix).

## 2026-06-06 — two lower-severity machinery observations from the same fixture cycle

1. **`report.md` diff section shows inverted delivery on a resume cycle.** The
   resumed `shared-acceptance-fixture` report rendered `shared_fixtures.go` as a
   **deleted** file (−484) and the test reverting to inline HCL — the *opposite* of
   what landed — because the report's unified diff captured a stale git state, while
   the authoritative `dev-loop.delivered` event correctly showed
   `files_changed=6, insertions=1141, deletions=1`. Low severity (the reflector
   cross-checks `dev-loop.delivered`, so it didn't draw a wrong conclusion), but an
   operator reading the report diff would be misled. Same display-layer class as the
   "wrong quality-gate command in the report" item above. Direction: on a resume,
   render the report diff from the same base the delivery event uses (or annotate the
   diff as "may be stale on resume — see dev-loop.delivered"). The reflector also
   logged this as a betterADO Brain-3 theme (`2026-06-06-report-diff-stale-on-resume`)
   — a minor reflector **mis-scope** (it's forge machinery, not a betterADO pattern);
   re-route in a future brain pass.

## Concerns (ranked by exposure for a real, unattended initiative)

### 1. Reflector can write confidently-wrong themes from stale metadata — ✅ RESOLVED 2026-05-31
**Fixed (Phase F):** the dev-loop emits a `dev-loop.delivered` event at close —
the authoritative git diff-stat of the branch's net contribution (files /
insertions / deletions / commits), captured while the branch + base still exist
(so it's correct even on a resume where per-WI status reads stale). The reflector
prompt + skill now make this the source of completion truth: **never** write a
"nothing delivered / empty branch" theme if `dev-loop.delivered` shows
`files_changed > 0`; a status-vs-diff disagreement is itself the antipattern
(stale-status-vs-real-delivery). Original below.
On resume, WI-status files still read `failed:6` even though the branch carried
975 lines of working, tested, *merged* code. The reflector trusted that
metadata and wrote a durable antipattern theme (`pr-opened-despite-zero-wi-completions`)
concluding the PR had "no implementation / empty branch" — which is false.
This is garbage-in → durable-garbage-out, and exactly the stale-brain-poisons-
planner risk: a future planner reading that theme would be misled.
- **Direction:** on resume, derive completion truth from branch/commit state,
  not from stale per-WI status files. The reflector should cross-check status
  metadata against the actual diff before drawing "nothing was delivered"
  conclusions.
- **Evidence:** `projects/claude-harness/brain/themes/2026-05-29-pr-opened-despite-zero-wi-completions.md` (the wrong theme); `orchestrator/phases/developer-loop.ts` (resume skips per-WI status writes).

### 2. Red-baseline blindness, discovered late and burned expensively — ✅ RESOLVED 2026-05-31
**Fixed (Phase D):** `runDeveloperLoop` now runs the project-level gate ONCE at
dev-loop start (`assertGreenBaseline`, skipped on resume — the worktree there
already carries WI commits) and **fails fast** with a distinct
`dev-loop.baseline-red` event + the `baseline-already-red` terminal classification
(carries the gate stderr so the operator can tell a real failure from missing
deps / a flake). No more discovering it at the unifier. Below is the original.
Per-WI gates are scoped to each WI's own new test file; the full suite runs
**only** at the unifier. So a pre-existing red baseline (or a flake, or an env
dependency) is invisible until after all WI work is done, and the unifier then
can't distinguish "my changes broke it" from "it was already broken" — it burns
its full iteration budget thrashing. In unattended mode this fails silently and
expensively with no "baseline was already red" signal. (Observed on cascade-v4
run #1: unwired `stats` + a gitignored fixture made the suite red; the unifier
failed 5+ times unable to fix what it didn't cause.)
- **Direction:** run the project quality gate once at **dev-loop start** to
  establish a known-green baseline; if it's already red, fail fast with that
  diagnosis instead of discovering it at the unifier.

### 3. PR can open despite the unifier failing / zero delivery — ✅ RESOLVED 2026-05-31
**Fixed (Phase E):** a **delivery gate** at the dev→review boundary in `cycle.ts`.
`runDeveloperLoop` now returns the unifier outcome (`runUnifier` surfaces
`{ succeeded, failureClass }`); if the unifier did not pass its composed gate the
cycle **throws before the reviewer runs** — no PR is opened — and the
`unifier.failed` event classifies as a terminal `unifier-did-not-pass`. The
demo-missing case was already blocked by `assertTrackedDemoExists`; this closes
the demo-present-but-gate-failed escape. Original below.
The unifier's `log-and-continue` semantics mean a unifier gate failure does not
stop the pipeline, and the resume path bypasses the dev-loop's only
`completeCount === 0 → total failure` guard. On cascade-v4 the review-router
opened PR #1 even though the unifier stopped `gate-too-loose` and metadata said
`complete:0`. The work happened to be green, so no harm — but the *pattern* (final
quality gate fails, mergeable PR still appears) is a quality escape an inattentive
operator could merge.
- **Direction:** a delivery gate at the dev→review boundary; a unifier hard-fail
  (vs. partial-completion) should block PR creation, or at minimum annotate the
  PR with "unifier did not pass."

### 4. Resume-from-unifier assumes `main` has not moved — ✅ RESOLVED 2026-05-31
**Fixed (Phase E):** the resume path rebases the preserved branch onto current
`main` at the **start** (`rebasePreservedBranchOntoMain`, `pr.ts`): no divergence
→ no-op; clean → rebase + `--force-with-lease` push of the initiative branch only
→ unattended; conflict → abort + a terminal `resume-needs-rebase` action. No more
dying at the close invariant after wasting the resumed unifier run. ADR 019
amended. Original below.
[ADR 019](./decisions/019-cycle-resume-from-unifier.md) does no rebase. The
dev-loop-close invariant (`main == merge-base`) fails the moment another cycle
merges to main between the stall and the resume. Hit during the cascade-v4
dogfood and hand-rebased. For concurrent initiatives this breaks unattended
resume.
- **Direction:** rebase the preserved branch onto current main at the start of a
  resume (or detect divergence and surface a clear "rebase needed" action).

### 5. Stale / contradictory brain content from incomplete removals — ✅ RESOLVED 2026-05-29
~~`brain/cycles/themes/wedged-loop-detector.md` is still a `pattern` theme
describing wedged-detection as a live Ralph stop-condition, though the thinning
removed it; it contradicts `agent-stuck-no-detection.md`.~~ Fixed: the canonical
theme now documents the removal + rationale (kept as the record of *why* not to
re-add it), and the live-claims in `agent-stuck-no-detection`, `ralph-loop-pattern`,
`quality-gates-orchestrator-verified`, `review-fix-loop-spinning`, `patterns.md`,
and the `stop-conditions.ts` doc comment were corrected. The lint contradiction
flag cleared (13 → 12 flags, still 0 errors). The `LoopResult.'wedged'` status
the deferred-defects note worried about was already gone (`status` is
`'complete' | 'failed'`); the only remaining `'wedged'` ref is the *intentional*
backward-compat in `cli/cycle-retention.ts` (retention of historical archives
that legitimately recorded `stop_reason: 'wedged'`) — left in place by design.

### 6. Thin observability around stalls & retries — ✅ RESOLVED 2026-05-31 (Phases D + G)
**Fixed:** (a) "baseline already red" is now a distinct terminal failure mode
(Phase D — `dev-loop.baseline-red` + classifier). (b) `verify-cycle.mjs` now
selects the **newest** cycle for an initiative (prefer a live cycle, else newest
by `startedAt`) instead of `.find()`-ing the first match — it no longer latches
onto the stale stopped cycle after a resume (Phase G). Original below.
Root-causing the cascade-v4 baseline failure required manual archaeology (read
the event log, run `npm test` in the worktree by hand); forge surfaced only
"failed". And `scripts/verify-cycle.mjs` latched onto the **stale** cycle id
after the resume (it matches by initiativeId and grabbed the prior stopped
cycle), so its auto-approve/closure tracking silently followed the wrong cycle.
- **Direction:** classify "baseline already red" as a distinct failure mode;
  make the recorder/verify harness select the newest cycle for an initiative,
  not the first match.

### 7. Lower-severity / housekeeping
- **Throwaway cycles still accrete brain artifacts.** ✅ RESOLVED 2026-05-31 (Phase F):
  a manifest `disposable: true` flag (parsed + serialized, round-tripped) makes
  the reflector skip entirely — `reflector.skipped-disposable`, no themes, no
  archive — while the cycle still merges/closes. `verify-cycle.mjs` throwaway runs
  set it so the durable brain accretes only from real initiatives.
- **Reflector mis-scopes forge-machinery lessons into project brains.** ✅ RESOLVED
  2026-05-31 (Phase F): root cause was structural — the reflector was given only
  the *project* themes dir as an output, so forge lessons (`gate-too-loose`) had
  nowhere else to go. It now gets BOTH a project-themes and a forge-themes
  (`brain/cycles/themes/`) output path with an explicit routing rule + litmus
  ("would this lesson be true for a different project too?" → forge brain).
- **`gate-too-loose` (and other iter-0 heuristics) assume fresh-work-from-zero**
  and misfire when state is pre-populated (e.g. on resume an immediate gate-pass
  looks identical to a no-op gate). ✅ **Mostly resolved 2026-05-31 (Phase D):**
  the concrete live case was the **unifier** — on a resume-from-unifier the prior
  cycle's `demo.json`/`pr-description.md` are on the preserved branch, so its
  iter-0 gate passed and was mis-flagged `gate-too-loose`. The unifier's
  `runRalph` now passes `failOnHollowIter0Gate: false` (aligning code with the
  runner's already-documented intent; per-WI Ralphs keep the check on, and they
  don't run on resume). Residual: a *per-WI* gate could still pass at iter-0 if a
  cycle-2+ WI points at a pre-existing test — mitigated by the PM prompt's
  "point at a NEW test" rule, not structurally enforced. The broader "C1
  discrimination" stays **runtime-enforced** (iter-0 hollow check + the new
  baseline gate) and **onboarding-hand-checked**; it is deliberately NOT a
  `preflight` gate-run (ADR 017 keeps preflight cheap + side-effect-free).

---

## Strengths worth preserving (don't regress these)

- The **dual-boundary gate works as designed** — the unifier caught a red
  full-suite baseline the scoped per-WI gates couldn't see. Nothing shipped red.
- **Brain-path SSOT held up** end-to-end through a real reflection; `forge brain
  lint` stayed at 0 errors. The thinning's central bet is sound.
- **Worktree-preservation → salvage works** — the premise resume depends on.
- **The reflector is genuinely sharp** — it independently identified gaps #1, #3,
  and that the verification goals went unexercised. (It also drew the one wrong
  conclusion in #1 — sharp, but only as good as its inputs.)
- **Dogfooding caught a real integration bug** (branch-never-pushed-on-resume)
  that green unit tests missed.

## Already addressed this session (2026-05-29)
- Resume branch-never-pushed gap — fixed (`b750e74`); the resume path now
  publishes the branch before the unifier.
- claude-harness baseline (unwired `stats`, gitignored fixtures) — fixed +
  merged (project-side, not a forge gap).

## 2026-05-31 — betterado onboarding run (first live-creds, real-cloud target)

Operator drove an onboarding initiative against `terraform-provider-betterado`
(a large vendored Go monorepo) with **live Azure DevOps creds in the cycle env**.
Four cycle attempts; the 4th reached review with 5 genuinely-passing gomock unit
tests (landed clean on `main`). The dev-loop's *code generation is not the
problem* — every failure was in planning, gating, packaging, or hygiene around
it. **All of these block roadmap-scale (multi-feature) reliability; none is a
reason to retreat to single-WI initiatives — the single-feature run was a
diagnostic to isolate variables, not a target.**

1. **[HIGH] PM decomposition can hallucinate, ignoring the manifest.** On one run
   the PM received a correct 3-feature manifest (task_group/release/live-harness)
   and instead planned "create brain/profile.md / brain/themes / tracking file"
   — work items unrelated to any manifest feature. This is the #1 roadmap-scale
   risk: if the PM doesn't faithfully decompose the operator's manifest, scale is
   impossible. Mitigation ideas: validate that each WI's `feature_id` maps to a
   manifest feature AND the WI title is derived from that feature (reject/▼
   re-plan if a WI references files outside the manifest's stated scope);
   surface the PM's feature→WI mapping for a fast operator sanity check.

2. **[HIGH] Gates must be auto-derived correctly for the project's test runner.**
   The operator had to hand-discover that Go test-adding WIs need
   `go test -tags all -run <Prefix> ./pkg/` (exact dir). Two traps bit us:
   - A **bare package gate** passes at iter-0 when the package already has
     sibling tests → forge's hollow-iter0 guard fails the WI (`gate-too-loose`).
     Gates must FAIL on a clean tree → use `-run <NewPrefix>`.
   - `-tags all` is mandatory where unit tests sit behind `//go:build` tags
     (silently 0 tests otherwise).
   The architect/PM should derive these from the project (`.forge/project.json` +
   language detection), not depend on the operator encoding them in the manifest.

3. **[HIGH] no-work-indicator poisons multi-package `go test` runs. — ✅ RESOLVED 2026-05-31**
   *Fixed (Phase D):* the no-work-indicator scan in `loops/ralph/stop-conditions.ts`
   now only rejects when there is **no positive evidence tests ran anywhere**
   (a `WORK_HAPPENED_PATTERNS` check) — so a test-less sibling's `[no tests to
   run]` can't fail a run where another package passed. An all-empty multi-package
   run still rejects (discrimination held). Belt-and-braces with the Phase-C
   gate-recipe that steers Go gates to the exact package dir, never `./...`.
   Original below.
   `runGateCapturing` scans the **combined** output for `[no tests to run]` etc.
   A `./pkg/...` wildcard that includes a test-less sibling/sub-package (e.g.
   `taskagent/validate`) prints `[no tests to run]`, failing the gate **even
   though the real tests passed** — it burned a correct agent for 5 iters/$3.32.
   Fix: evaluate the indicator per-package, or don't fail if ≥1 package actually
   ran tests. (Today's workaround: gate the exact package dir, never `/...`.)

4. **[HIGH] PR hygiene — cycles commit build artifacts + delete tracked config. — ✅ RESOLVED 2026-05-31**
   *Fixed (Phase E):* (a) `stripForgeScratchFromBranch` now **exempts**
   `.forge/project.json` + `.forge/quality_gate_cmd` (lists tracked `.forge/`
   files and strips all but the protected config) — no longer deletes a Go
   project's config from the PR. (b) `forge preflight` gained an advisory
   **ARTIFACTS** clause: for the detected language, it flags a `.gitignore` with
   no build-output coverage (so a stray binary/dist can't be swept in by
   `git add -A` — the 35 MB betterado binary). Original below.
   `cycle.ts` `git add -A` (autocommit safety-net) committed a **35 MB compiled
   provider binary** + the whole `graphify-out/` + `.forge` scratch into the PR,
   because the project `.gitignore` didn't cover them (the binary had been
   renamed; gitignore lagged). Separately, `pr.ts` strips **all** of `.forge/`
   as scratch — which **deletes the tracked `.forge/project.json` / `quality_gate_cmd`**
   a Go project needs. Fixes: (a) `forge preflight` should flag a missing
   build-artifact ignore (the onboarding gate today only checks forge scratch);
   (b) exempt `.forge/project.json` + `.forge/quality_gate_cmd` from the `.forge/`
   strip, or move project config out of the ignored dir entirely.

5. **[MED] Unifier loop is the dominant cost and is opaque. — ✅ MOSTLY RESOLVED 2026-05-31 (Phase G)**
   *Fixed:* `unifierIterationCap` scales the cap to the branch diff — trivial (≤2
   files) → 4, small (≤10) → 8, larger → 15 (send-back keeps the full cap) — so a
   one-file change can't thrash 15×. The chosen `iteration_cap` is surfaced on
   `unifier.start`. Pairs with Phase B's demo effort-tiers (trivial → notes-only,
   no media capture). *Residual:* a crisp per-iteration "why still looping" reason
   beyond the existing per-iteration gate events is not yet emitted. For a single-file
   test change ($1.34 dev, 1 iter), the unifier ran **~$11.5 / ~15 iters / 19 min**
   looping on `pr-not-self-contained` (demo.json / pr-description) — ~9× the
   actual work, packaging-only. No per-iteration reason is surfaced, and the loop
   isn't right-sized to the change. Fixes: bound/scale the unifier loop to diff
   size, emit a per-iteration "why still looping" reason, cap demo effort for
   trivial changes.

6. **[MED] UI misreports the dev/unifier phase (operator-confirmed live). — ✅ MOSTLY RESOLVED 2026-05-31 (Phase G)**
   *Fixed (the misleading hex):* the unifier is now its OWN UI phase/hex —
   `derivePhaseStates` routes `skill: developer-unifier` events to a distinct
   `unifier` phase (the dev-loop hex completes at the per-WI loop's end; the
   unifier hex stays active until `unifier.end`). Backend event phase is
   unchanged (no ripple to the failure-classifier). Also: a resume's
   `complete:0/failed:N/resumed` dev-loop end no longer reddens the hex.
   *Residual (deferred — pure UI, needs the browser journey harness to verify):*
   the activity tab still shows duplicate iteration renumbering + `forge-autocommit`
   WIP-commit noise. Not a correctness issue; cosmetic stream-cleanliness.
   The unifier runs *inside* the `developer-loop` phase, so the dev hex shows
   green while the unifier loops for ~19 min more — inaccurate. The activity tab
   also fills with duplicates from the unifier's re-invocation iteration
   renumbering ("Iteration 8 → re-invocation as iter 1") + `forge-autocommit WIP`
   commits. Fixes: surface the unifier as a distinct sub-phase with its own
   status; make the activity log one clean monotonic stream for the whole cycle.
   (Already named as the step-10 gap in `docs/operator-journey.md`.)

### Housekeeping found + fixed 2026-05-31 (pre-cycle hardening, Phase B)
- **`forge brain lint` had regressed to 9 errors (was 0 on 2026-05-29) — now back
  to 0.** The 9 errors were `checkSourceLinks` **broken links**: nine durable
  themes linked `../../../_logs/2026-05-16_trafficgame-arc-reflection/{retro,architecture,benchmark-alignment}.md`,
  which forge's retention had moved to `_logs/_archived/…`. Re-pointed all nine to
  the archived path. Separately cleared the 7 `checkStaleness` **flags** (advisory):
  reworded two coarse false-positives (a `notify.<provider>.ts` template, a
  `docs/baselines/*.md` glob) and bannered the two themes that document removed
  systems (`chained-phase-benchmarks` → the deleted `benchmarks/`; the already-
  superseded `pr-as-sole-review-window` → the deleted `pr-verdict.ts`), de-formatting
  the removed-file path tokens per the §5 deletion-documenting convention. **Lint
  is now 0 errors / 0 staleness; 11 length soft-caps remain (advisory, tolerated).**
- **Residual (not a blocker):** durable brain themes still *link into* gitignored
  `_logs/_archived/`, which retention could prune again → the same break could
  recur. Deeper fix: durable themes should cite the tracked `brain/_raw/cycles/…`
  archive (they already do, alongside the `_logs` link) and reference the retro
  sub-sections as prose rather than hard-linking ephemeral logs. Left as-is for now.

### Project-side findings (betterado — also in its Brain 3)
- **Stale release acceptance HCL.** Live `terraform apply` of the basic release
  definition failed on current ADO with `VS402982` (stage-level `retention_policy`
  now required; pipeline-level deprecated) then `VS402877` (pre/post approvals now
  required). `TestAccReleaseDefinition_basic`'s HCL is stale and would fail live.
  Strong justification for the live harness; a work item for the release-acceptance
  feature.
- **Provider works live.** `betterado_project` created a real ADO project (10s),
  confirmed via API GET + org-list + tf state, destroyed clean. Evidence bundle:
  `/tmp/live-confirm/evidence/` (this session).

---

## 2026-06-07 — release-folder-data-source cycle assessment (post-merge review)

End-of-cycle review of `INIT-2026-06-07-release-folder-data-source` (PR #14 MERGED).
The data source shipped and 6/7 AC clauses are met, but the **central AC — "resolves
attributes against LIVE ADO" — was never proven**, and the review surfaced several
forge defects. Root-caused via an adversarially-verified investigation workflow.

**✅ FIXED this session (forge `cli/`+`forge-ui/`, betterado `.forge/`):**

- **UI send-back / requeue blanks the hex view.** On a send-back at the PR point the
  bridge requeues with `resume_from: unifier`, which **skips the PM phase**, so the new
  (active) cycle emits no `pm.work-item-emitted` events. The UI derived the WI-hex list
  *exclusively* from those events (`use-graph-model.ts`), so every WI hex vanished, and
  per-phase cost/status (cycle-scoped) went blank. Fix: (a) `/api/graph` now falls back
  to the live worktree `_graph.md` when the snapshot is absent (mirrors `/api/work-item`),
  and (b) `deriveGraphModel` seeds the WI set from the graph when no PM events are present.
  Tests: `forge-ui/lib/use-graph-model.test.ts`. *(Restores the disappearing WIs. The
  cost/status fidelity on a resumed cycle is the open lineage follow-up below.)*
- **Report diff inverted (3rd occurrence).** `computeDeliveredDiff` tried `branch..main`
  first — the inverted direction for an unmerged branch — so the "What landed" section
  rendered the cycle's added files as `deleted file mode` / `+0 −N`. Fix: anchor on
  `merge-base(main, branch)..branch`; the inverted range is gone. Regression test:
  `cli/forge-metrics-diff.test.ts`.
- **Live-acc gate didn't fail fast on missing creds (betterado).** `acceptance_gate.requires_env`
  listed only `TF_ACC`; the PreCheck also demands `AZDO_ORG_SERVICE_URL` + `AZDO_PERSONAL_ACCESS_TOKEN`.
  TF_ACC was set, so the guard stayed silent and the acc test burned **5 iterations**
  `t.Fatal`-ing in PreCheck on the missing PAT. Fix: `requires_env` now lists all three,
  so the guard ERRORs up-front. (`projects/terraform-provider-betterado/.forge/project.json`.)

**⏳ OPEN (forge behavior changes — need operator greenlight; each touches the autonomous pipeline):**

> **2026-06-07 update:** items **2 (requeue guard)** and **4 (cost/status lineage)** are
> superseded by **[ADR 026](./decisions/026-review-unifier-wi-list.md)** — the review↔unifier
> WI-list model removes the requeue-on-review trigger entirely, dissolving both (and the
> disappearing-hex bug) at their shared root. Item **1 (status-blind merge)** is addressed
> instead via the first-class `secrets.env` pattern (the live tests now actually run). Items
> 3 + 5 are done / independent.

1. **Merge boundary doesn't gate on per-WI status.** WI-2 ended `status: failed` (its live-acc
   gate never passed) yet the unifier's `canOpenPr` opened a PR (files-present + offline/TF_ACC-
   stripped CI green), and the operator merged it — so the data source shipped **unverified-live**.
   Direction: for a project with `acceptance_gate.required`, `canOpenPr` (`orchestrator/phases/developer-loop.ts`)
   must require every live-acc WI actually PASSED its per-WI gate, or at minimum loudly flag the
   closure as "live-acc unverified". This is the most important open gap — it's how unproven code merged.
2. **`forge requeue` has no PR-state guard.** It blindly moves a ready-for-review manifest back to
   pending, even with an open PR, spawning a wasteful re-run and removing the cycle from
   `finalizeMergedReadyForReview`'s view. It also never strips `resume_from`/`previous_failure_modes`
   on the terminal move to `done/`. Direction: probe `gh pr view --json state` before requeue;
   refuse/route-to-finalizer if OPEN/MERGED; strip resume markers on closure.
   (`cli/forge-requeue.ts`.)
3. **Report not regenerated on later merge.** A cycle ends at `pr-open` (unattended), then the
   operator merges; `finalizeMergedReadyForReview` runs closure+reflector and moves to `done/` but
   **never rewrites `report.md`**, so the report is permanently stuck at "Status: pr-open / no merge
   event recorded" while the manifest sits in `done/`. Direction: call `writeCycleReport` in
   `orchestrator/finalize-merged.ts` after a confirmed merge. (Note: closure's merge detection is
   *correct* — the apparent "merge not recorded at cycle end" was a misread; PR #14 merged at 03:41,
   ~27m after the cycle ended at pr-open.)
4. **Cost/status lineage on resumed cycles (UI Fix #2).** Even with the WI hexes restored, a resumed
   cycle's PM/dev cost pills read $0 and per-WI status reads `pending`, because cost/status are
   derived per-active-cycle and the predecessor cycle's spend/status live in the prior `_logs/<id>`.
   Direction: make the bridge/UI treat the active cycle as the **initiative lineage** — merge the
   predecessor cycle's events/cost for the same initiativeId (the predecessor cycleId isn't on the
   manifest today, so this needs either a lineage annotation at requeue time or sibling-dir discovery).
5. **Derive live-acc required env from the test contract (deeper than the betterado config fix).**
   The per-project `requires_env` list is hand-maintained and drifted (only TF_ACC). Better: have the
   live-env guard infer the required vars from the acceptance test's PreCheck, or treat a precheck
   `t.Fatal`-on-missing-env signature in the gate stdout as a distinct "live-env-missing" classification
   rather than a code FAIL the agent is asked (and fails) to fix.
