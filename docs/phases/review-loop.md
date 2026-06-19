# Phase: Review Loop

> *Human-in-the-loop.* Closes out an initiative back to main with a working demo and human approval.

## Purpose

Two stages, unified as one **review-Ralph** loop (Phase-6 redesign):
1. **Review-prep (unattended)** — review-Ralph holistically assesses the
   post-developer-loop initiative branch vs intent (may spawn a targeted
   developer-loop to align it), prepares a before/after **demo** + PR
   draft. The demo is **committed to a tracked `demo/<id>/`** on the
   branch and embedded in the PR body (visibility-aware: relative-link
   `DEMO.md` for private repos, inline raw images for public) so the PR is
   the **self-contained review surface**.
2. **Human review (interactive)** — the operator reviews from the PR and
   either **merges in GitHub** (forge *never* auto-merges) or sends back
   acceptance criteria. There is no per-iteration $/turn budget guard on
   the reviewer; the loop is bounded only by the adaptive iteration cap
   (1 prep + ≤2 send-back rounds).

## Inputs

- `_queue/in-flight/<initiative-id>.md` (manifest with all work items marked complete).
- The initiative branch in the project repo.
- Brain knowledge (lessons on demos, common review pitfalls).

## Outputs

- A GitHub PR opened via `gh pr create` against the project's `main`,
  with the demo committed on the branch (`demo/<initiative-id>/`) and
  surfaced in the PR body. The reviewer **never merges** and **never
  moves the manifest** (Phase-6 / G9 / G1).
- Notification fires (`review-ready`; see [ADR 013](../decisions/013-notifications.md)).
- The manifest stays in `_queue/in-flight/` through the entire review
  phase. **Closure** (`orchestrator/phases/closure.ts`) is the *single*
  terminal-move authority:
  - **Operator merged in GitHub** → closure confirms
    `gh pr view --json state == MERGED`, then `alignLocalToRemote`
    fast-forwards the project's working tree to the merged `main`
    (preserving uncommitted operator state via stash — never a bare ref
    move), prunes the branch, moves the manifest `in-flight/ → done/`,
    and **reflection fires**.
  - **Not merged / send-back-cap-exhausted** → manifest moves
    `in-flight/ → ready-for-review/`, flagged; reflection is skipped.
- **Send-back:** the operator works the **`/artifact?...&mode=review`** Studio
  surface (the sole review human-moment — ADR 031 folds `/review` + `/reflect`
  into the unified `/artifact` viewer; the old `/review/<cycleId>` route
  redirects there). The operator either approves or sends back ACs; send-back
  writes a `verdict-response.md` that review-Ralph reads into `fix_plan.md`
  the next iteration and re-prepares. Cap: 2 rounds.

## Skills

- [`skills/developer-unifier/SKILL.md`](../../skills/developer-unifier/SKILL.md) — the unifier sub-phase that owns the review-prep iteration (post-S4 collapse; the dedicated `skills/reviewer/` was archived 2026-05-23).

## Success signals

- **Demo runs first try:** the user runs the demo script and it works without intervention.
- **First-pass approval rate:** ≥70% of initiatives are approved on first human review.
- **Send-back resolution iterations:** when sent back, ≤2 further developer-loop passes resolve.
- **PR description quality:** PR explains the why (initiative goal, key decisions), not just the what.

## Benchmark suite

> Note (2026-05-25): the `benchmarks/` harnesses were removed (see [ADR-022](../decisions/022-real-capability-harness.md)); this section is historical. Phase quality is now judged on real merged cycles.

The per-phase `benchmarks/review-loop/` was archived 2026-05-23 (S4) when the reviewer collapsed into the developer-loop unifier. Review behaviour was then regressed (until the 2026-05-25 benchmark removal) via:

- `benchmarks/e2e/` — full cycle (PM → dev-loop → unifier → merge) with a human-simulator providing verdicts.
- `benchmarks/developer-loop/` — extended with unifier criteria (`artifact`/`harness` fixtures).
- `benchmarks/review-router/` — 6 deterministic mock-`gh` fixtures for the PR-comment poller.

## Known failure modes (to defend against)

- **Demo doesn't actually work** — pre-review checklist must include running the demo script in the worktree.
- **PR description is what-not-why** — explicit prompt rule (formerly also a benchmark check; benchmarks removed 2026-05-25).
- **Squash-merge stacked PRs** — explicitly forbidden (v1 lesson, in the brain). Use layered merge order.
- **Stale demo capture** — the demo must capture *this* branch's build, never a stray/ambient dev server (`reuseExistingServer: true` latching the wrong app silently). The reviewer mandates an isolated strict-port server / built `preview`; pattern of record: [`brain/cycles/themes/pr-as-sole-review-window.md`](../../brain/cycles/themes/pr-as-sole-review-window.md).
- **Reviewer never reaches the verdict gate** — historically a too-tight per-iteration $/turn budget cut every iteration before a verdict (0 verdicts, mislabelled send-back-cap). Those guards were removed; the loop is bounded only by the iteration cap.

## Status (as-built)

Closed end-to-end. The send-back loop, demo-embedded self-contained PR,
visibility-aware demo commit, and closure-as-single-mover are all
implemented (Phase-6 redesign + the 2026-05-18 operator-review
reliability pass + the 2026-05-23 S4 unifier collapse). The loop was
formerly exercised by the e2e + developer-loop benches (removed
2026-05-25; see *Benchmark suite* above); it is now exercised by real
merged cycles.

**2026-05-18 P2/P3 (unit-tested; not yet exercised against a live cycle):**
- **PR at end of review iteration 1, not on approve.** The gate ensures
  the demo-embedded PR (`pr.ts:ensurePullRequest`, idempotent) as soon as
  the branch is reviewable, so the PR is a durable review window that
  survives a dead serve process. The old `if (approved) openPullRequest()`
  creation point is removed.
- **Verdict via PR comments** (`pr-verdict.ts:makePrCommentVerdict`),
  with the file-verdict provider as a fallback when no PR can be created
  (no remote / gh down) — never strands. *(Historical — [ADR 023](../decisions/023-ui-sole-operator-surface.md)
  retired the PR-comment + CLI verdict ingress; `pr-verdict.ts` is deleted and
  the verdict now arrives solely from the `/review/<cycleId>` UI screen as a
  `verdict-response.md`.)*
- **P2 mechanical integrity gate:** a WI marked `complete` whose declared
  `files_in_scope` are entirely absent from the branch diff auto-sends-
  back into the loop WITHOUT consuming a human verdict round
  (`detectFalselyCompleteWorkItems`). Surfaced as
  `reviewer.integrity-autosendback` events.
- Operability: the scheduler runs as a managed daemon (`orchestrator/daemon.ts`). The lifecycle commands (`start/stop/status/pause/resume`) were retired from the CLI in M7 (ADR 031); the bridge `/api/scheduler/*` routes are the operator API. `forge studio` is the canonical launcher; `forge watch` was removed in M8-E.
