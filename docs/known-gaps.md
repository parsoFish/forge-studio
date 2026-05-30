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

## Concerns (ranked by exposure for a real, unattended initiative)

### 1. Reflector can write confidently-wrong themes from stale metadata — HIGH
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

### 2. Red-baseline blindness, discovered late and burned expensively — HIGH
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

### 3. PR can open despite the unifier failing / zero delivery — MEDIUM/HIGH
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

### 4. Resume-from-unifier assumes `main` has not moved — MEDIUM
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

### 6. Thin observability around stalls & retries — MEDIUM
Root-causing the cascade-v4 baseline failure required manual archaeology (read
the event log, run `npm test` in the worktree by hand); forge surfaced only
"failed". And `scripts/verify-cycle.mjs` latched onto the **stale** cycle id
after the resume (it matches by initiativeId and grabbed the prior stopped
cycle), so its auto-approve/closure tracking silently followed the wrong cycle.
- **Direction:** classify "baseline already red" as a distinct failure mode;
  make the recorder/verify harness select the newest cycle for an initiative,
  not the first match.

### 7. Lower-severity / housekeeping
- **Throwaway cycles still accrete brain artifacts.** A cycle explicitly marked
  "verification — throwaway" still wrote a `_raw` archive, a brain-log edit, and
  three themes (one wrong). No notion of "don't reflect this into the durable brain."
- **Reflector mis-scopes forge-machinery lessons into project brains.**
  `gate-too-loose` is a fact about forge, but the reflector wrote it to
  claude-harness's Brain 3. The three-brain scoping isn't enforced at write time.
- **`gate-too-loose` (and other iter-0 heuristics) assume fresh-work-from-zero**
  and misfire when state is pre-populated (e.g. on resume an immediate gate-pass
  looks identical to a no-op gate).

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

3. **[HIGH] no-work-indicator poisons multi-package `go test` runs.**
   `runGateCapturing` scans the **combined** output for `[no tests to run]` etc.
   A `./pkg/...` wildcard that includes a test-less sibling/sub-package (e.g.
   `taskagent/validate`) prints `[no tests to run]`, failing the gate **even
   though the real tests passed** — it burned a correct agent for 5 iters/$3.32.
   Fix: evaluate the indicator per-package, or don't fail if ≥1 package actually
   ran tests. (Today's workaround: gate the exact package dir, never `/...`.)

4. **[HIGH] PR hygiene — cycles commit build artifacts + delete tracked config.**
   `cycle.ts` `git add -A` (autocommit safety-net) committed a **35 MB compiled
   provider binary** + the whole `graphify-out/` + `.forge` scratch into the PR,
   because the project `.gitignore` didn't cover them (the binary had been
   renamed; gitignore lagged). Separately, `pr.ts` strips **all** of `.forge/`
   as scratch — which **deletes the tracked `.forge/project.json` / `quality_gate_cmd`**
   a Go project needs. Fixes: (a) `forge preflight` should flag a missing
   build-artifact ignore (the onboarding gate today only checks forge scratch);
   (b) exempt `.forge/project.json` + `.forge/quality_gate_cmd` from the `.forge/`
   strip, or move project config out of the ignored dir entirely.

5. **[MED] Unifier loop is the dominant cost and is opaque.** For a single-file
   test change ($1.34 dev, 1 iter), the unifier ran **~$11.5 / ~15 iters / 19 min**
   looping on `pr-not-self-contained` (demo.json / pr-description) — ~9× the
   actual work, packaging-only. No per-iteration reason is surfaced, and the loop
   isn't right-sized to the change. Fixes: bound/scale the unifier loop to diff
   size, emit a per-iteration "why still looping" reason, cap demo effort for
   trivial changes.

6. **[MED] UI misreports the dev/unifier phase (operator-confirmed live).**
   The unifier runs *inside* the `developer-loop` phase, so the dev hex shows
   green while the unifier loops for ~19 min more — inaccurate. The activity tab
   also fills with duplicates from the unifier's re-invocation iteration
   renumbering ("Iteration 8 → re-invocation as iter 1") + `forge-autocommit WIP`
   commits. Fixes: surface the unifier as a distinct sub-phase with its own
   status; make the activity log one clean monotonic stream for the whole cycle.
   (Already named as the step-10 gap in `docs/operator-journey.md`.)

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
