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
