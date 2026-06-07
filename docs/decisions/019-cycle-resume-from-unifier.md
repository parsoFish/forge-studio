# ADR 019 — Cycle resume-from-unifier

- **Status:** accepted
- **Date:** 2026-05-29
- **Supersedes / amends:** extends ADR 011 (unattended scheduler), ADR 012 (crash recovery). Builds on the worktree-preservation-on-`failed` behaviour added 2026-05-25 (scheduler.ts).

> **Amended 2026-05-31 (resume rebase).** As first written this ADR did **no
> rebase**, so the dev-loop-close invariant (`main == merge-base`) failed the
> moment another cycle merged to `main` between the stall and the resume —
> wasting the whole resumed unifier run before failing at the close (known-gaps
> #4). The resume path now rebases the preserved initiative branch onto current
> `main` at the **start** of the resume (`rebasePreservedBranchOntoMain`,
> `orchestrator/pr.ts`): no divergence → no-op; clean → rebase + `--force-with-lease`
> push of the *initiative branch only* (never main), fully unattended; conflict →
> abort + a classified, actionable `resume-needs-rebase` terminal failure (the
> operator rebases by hand, then re-resumes). This makes concurrent unattended
> resume work for the non-conflicting case instead of always dying at the close.

## Context

A forge cycle is `PM → developer-loop(per-WI + unifier) → reviewer → closure → reflector`. The **unifier** is a sub-phase of the developer-loop that runs *after* every work-item (WI) has been delivered and committed to the initiative branch. It merges the WI work, runs the full project quality gate (`npm test`), produces the demo bundle + PR description, and opens the PR.

Two facts collide:

1. **The unifier can fail for reasons unrelated to the WI work.** The motivating case (claude-trail verify-cascade-v4, 2026-05-29): all 6 WIs delivered green in a single iteration each, but the unifier's full-suite gate went red on **pre-existing** baseline failures in the project (an unwired `stats` subcommand + gitignored test fixtures absent from a fresh worktree). The per-WI gates are sharp and scoped; only the unifier runs the whole suite, so a red baseline surfaces *only* at the unifier boundary.

2. **The worktree (with all per-WI commits) is already preserved on `failed`** (scheduler.ts, 2026-05-25). The lesson — "cleaning up the worktree wiped the dev-loop's committed work, forcing a full retry from scratch" — was half-learned: the work is *kept*, but nothing ever *resumes against it*. Both auto-retry (F-27) and `forge requeue` re-run the **entire** cycle (architect → PM → all WIs → unifier), and `forge requeue` even deletes the worktree first.

So today, a unifier-only failure throws away an arbitrary amount of expensive, correct WI work. As the operator put it: *"work item level changes on their own would [rarely] ever be bad enough to completely throw away."*

## Decision

Add a **resume-from-unifier** entry point that re-runs only the unifier sub-phase (and the downstream reviewer → closure → reflector) against the **preserved worktree + branch**, skipping the architect, PM, and per-WI dev-loop.

Mechanism (smallest thing that works — no new state machine):

1. **Manifest field** `resume_from: unifier` (optional, snake_case in frontmatter). Round-trips through `manifest.ts`.
2. **`CycleInput.resumeFrom`** threads the flag from the scheduler into `runCycle`.
3. **`cycle.ts`** skips `runProjectManager` when `resumeFrom === 'unifier'` (the WI specs already exist in the preserved worktree's `.forge/work-items/`).
4. **`developer-loop.ts`** runs the per-WI loop over an **empty list** when resuming (the WI commits already exist on the branch), and skips the `0/N completed → total failure` guard. The unifier sub-phase + close-sync invariant run unchanged.
5. **`scheduler.ts`** reuses the existing checked-out worktree (instead of `worktree.add`, which would fail on an already-registered path) when `resume_from` is set and the worktree is live; otherwise it falls back to `worktree.add`, which re-checks-out the surviving branch (commits intact).
6. **CLI** `forge requeue <id> --resume-from=unifier` sets the manifest field, moves the manifest to `pending/`, and — unlike a plain requeue — **does not delete the worktree**.

Auto-retry (F-27) is intentionally **not** changed in this ADR: the failure-classifier does not yet auto-detect "WIs done, only the unifier failed," so resume stays an explicit operator signal for now. A follow-up may add the classifier signature to make a transient unifier failure auto-resume.

## Amendment — `resume_from: developer` variant (implemented)

A second resume variant, `resume_from: developer`, is also implemented in `orchestrator/manifest.ts` and `orchestrator/cycle.ts`. It targets a different failure mode: the **developer loop itself** stalled (e.g. the project-manager WI specs exist but the dev-loop never finished all WIs, or a reviewer send-back needs a fresh dev-loop pass from the WI layer). Mechanism:

- **Manifest field** `resume_from: developer` — skips `runProjectManager` (PM specs already in `.forge/work-items/`), then runs the full per-WI developer loop against those specs, followed by the unifier → reviewer → closure → reflector chain.
- **CLI** `forge requeue <id> --resume-from=developer` stamps the field, preserves the worktree **and** the initiative branch, and preserves any `<id>.pr-feedback.md` so send-back context survives.
- **Work-item snapshot**: because the preserved branch is rebased onto current `main` at resume start (same rebase step as the unifier variant), the `.forge/work-items/` directory is snapshotted outside the git worktree before the rebase and restored afterward (the dir is gitignored so a rebase would wipe it).

Use `resume_from: unifier` when all WIs are done and only the unifier failed. Use `resume_from: developer` when the dev-loop itself needs to restart from the existing WI specs.

## Consequences

- **Cheap recovery.** A unifier-only failure no longer discards the WI work; the operator re-runs only the unifier + downstream phases.
- **No backward-compat risk.** `resume_from` is optional; manifests without it behave exactly as before (full cycle). No feature flag, no v1 path.
- **Surface area.** Adds one optional manifest field, one `CycleInput` field, one CLI flag, and two small conditionals (cycle.ts, developer-loop.ts) plus worktree-reuse in the scheduler. This is a deliberate, bounded increase to `orchestrator/` justified by the cost of the discarded-work failure mode.
- **Precondition.** Resume assumes the preserved branch already carries the per-WI commits and the worktree's `.forge/work-items/` survives. If the worktree was GC'd, the scheduler re-checks-out the branch (commits are durable on the ref) but the PM specs may be absent — in that case the unifier runs against the branch state, which is the correct best-effort.

## Alternatives considered

- **Re-run the whole cycle (status quo).** Rejected: discards correct WI work; expensive; the exact thing the operator flagged.
- **A standalone `forge unify <id>` command** that bypasses `runCycle`. Rejected: would duplicate the reviewer/closure/reflector wiring and drift from `runCycle`. Reusing `runCycle` with a skip flag keeps one spine.
- **Auto-resume in the failure-classifier now.** Deferred: needs a reliable "WIs done, unifier-only failed" signature; explicit operator signal is the safe first step.
