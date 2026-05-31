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

## 2026-05-31 — architect/PM decomposition boundary is under-specified (the breakdown can happen twice)

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
- **Evidence:** `skills/architect/SKILL.md` (feature → WI → file; per-feature C4
  fields), `skills/project-manager/SKILL.md` (decompose each feature → WIs),
  `_logs/2026-05-31T10-15-32_INIT-2026-05-31-release-definition-unit-tests/`
  (architect FEAT-1/2 titled WI-1/WI-2 → PM WI-1/WI-2, 1:1).

## 2026-05-31 — unifier loops `branches-not-in-sync` because the per-iteration autocommit never pushes

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
