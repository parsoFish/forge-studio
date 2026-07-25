# ADR 040 — Review send-back re-dispatches the develop agent on the initiative's own WI queue

- **Status:** accepted (R4-08-F2, 2026-07-25)
- **Supersedes:** [ADR 026](./026-review-unifier-wi-list.md) — review feedback no longer appends unifier work-items; the send-back loop compiles fix work-items onto the initiative's own queue and re-dispatches the develop agent.
- **Relates to:** [ADR 019](./019-cycle-resume-from-unifier.md) (crash-recovery resume survives unchanged), [ADR 021](./021-local-review-and-unified-demo.md) (approve IS the merge — untouched), [ADR 036](./036-orchestrator-owned-gate-execution.md) (agent judges / orchestrator evidences — untouched), the Q3-B operator decision (unifier retired in favour of demo + adversarial-review agents; the develop agent is the single fix executor), and R4-10-F1's loop topology (every post-develop fix loop re-dispatches the develop agent; loops are orchestrator re-entry, not flow back-edges).

## Context

ADR-026 solved the three requeue-per-send-back bugs (forked `_logs` dirs, cost-lineage
blanks, vanished WI hexes) by keeping one cycle and appending typed unifier work-items
(UWIs) that the unifier's Ralph loop executed. That was the right shape while the
unifier was the only post-develop executor.

The Q3-B decision retires the unifier: the successor pipeline is demo agent (R4-07) +
adversarial-review agent (R4-08-F1), and R4-10-F1 names the **develop agent** the
single executor for every post-develop fix loop — demo AC-miss iteration, verdict
send-back, and red merge-boundary remediation. Keeping the UWI queue would preserve a
second executor with its own queue, cap constant, and gate discipline precisely when
the platform is converging on one.

## Decision

**Review send-back compiles the operator's feedback into fix work-items on the
initiative's own `.forge/work-items/` queue and re-dispatches the develop agent —
same cycle, same worktree, same branch.**

1. **Queue substrate.** Fix WIs are ordinary `WorkItem`s written as
   `WI-<max+1>.md` (append-only, never renumbered) with a new frontmatter field
   `origin: 'review-fix' | 'demo-fix' | 'gate-fix'`. Only `review-fix` ships here;
   the other two values are reserved for R4-10's demo-miss and merge-gate loops,
   which reuse the same compiler and count against the same caps. `kind` remains a
   unifier-item-only dispatch selector and never appears on dev WIs. A
   `packaging`-classified concern compiles with `behavior_preserving: true` (the
   existing marker that relaxes the fail-first-test gate); `code-fix` concerns keep
   the full dev-loop rigor — ADR-026's "review-originated code gets dev-grade rigor"
   invariant is preserved by the dev loop itself. Compiled ids are appended to the
   manifest's `specs` list under the manifest lock.

2. **The compiler is one seam.** `orchestrator/fix-work-items.ts` owns
   validation (≥1 complete GIVEN/WHEN/THEN, non-empty gate, the H1
   shell-pipeline ban, whole-set validation before any write), scope derivation
   (the concern's own `files_in_scope` when supplied, else the union of dev-WI
   scopes plus the demo/PR artifacts), and cap enforcement.

3. **Bound.** Two independent caps, config-owned in `forge.config.json`'s new
   `review` section (env > config > default): `maxSendBackRounds` (default 6) and
   `maxTotalFixWorkItems` (default 24, the `UNIFIER_MAX_TOTAL_ITEMS` analogue —
   that constant is deleted). Either exhausting **rejects the send-back (409) and
   parks the initiative needs-operator loudly**: a `.forge/REVIEW-CAP-EXHAUSTED.md`
   marker, a `sendback.cap-exhausted` event, and an operator notification. The
   manifest stays in `ready-for-review/`; parking is a status, not a queue move.

4. **Re-entry is `resume_from: 'develop'`.** The verdict handler stamps it (and
   increments `review_rounds`) in one locked write. The fix-loop drain re-claims the
   manifest and re-enters `runCycle`: PM skips (rebase-only), the dev loop **runs** —
   prior WIs re-verify cheaply through the iter-0 already-complete shortcut, fix WIs
   build — then the post-develop spine re-presents. In the legacy spine the re-armed
   static UWI-1 re-authors `demo.json` + the PR description against the fixed branch
   (the terminal re-prep UWI is replaced by re-arming UWI-1 to `pending` before each
   re-entry); once R4-10 assembles the successor flow, the same drain re-enters the
   flow's develop node and the demo/adversarial-review agents re-present instead —
   the compiler, caps, and arbitration carry over unchanged.
   `resume_from: 'unifier'` survives strictly for ADR-019 crash recovery.

5. **One cycle identity.** Mechanism B carries over verbatim: the drain threads
   `manifest.cycle_id` (falling back to `latestCycleId`, then the initiative id)
   into `CycleInput`, so every round shares one `_logs/<cycleId>` dir, one cost
   rollup, one hex list. Fix WIs surface as hexes automatically (`WI-` prefixed
   events) plus a `pm.work-item-emitted`-message event at append time so the
   drawer shows them before dispatch.

6. **Mutual exclusion.** The finalize-vs-loop arbitration is re-implemented on the
   new queue with today's pinned semantics: **a confirmed-MERGED PR wins** —
   finalize proceeds and the dropped pending fix WIs are surfaced in a
   non-silent notify; the drain checks merge state before claiming and cedes
   (`pr-merged`); the atomic manifest rename to `in-flight/` is the single claim
   arbiter for the race. A pending fix loop defers nothing from a confirmed merge;
   an unmerged manifest with pending fix WIs belongs to the drain.

### The ADR-026 inversion, named

ADR-026's migration step 7 deliberately deleted `resume_from: 'developer'` under the
rule "never send back to the dev phase." This ADR reintroduces develop re-entry on
purpose. What ADR-026 actually protected — one cycle identity, dev-grade rigor for
review-originated code, append-only queue discipline, validated writes — is preserved
by mechanism B and the dev loop's own gates, not by avoiding the dev phase. The thing
being removed is the second executor, which is exactly what Q3-B retired.

## What survives from ADR-026

One `cycle_id` per initiative (mechanism B); append-only ids; validate-before-write
(a malformed concern never corrupts the queue); the rebase-onto-main step for crash
recovery; the merge-wins arbitration shape; the static UWI-1 "unify & prep the PR"
mission (until R4-01-F4 retires the unifier node); `resume_from: 'unifier'` for
operator-explicit crash recovery only.

## What is removed

The typed-UWI append path (`appendReviewUnifierItems`, `ReviewConcern`,
`UnifierItemsCapError`), the terminal re-prep UWI (replaced by UWI-1 re-arm), the
`UNIFIER_MAX_TOTAL_ITEMS` constant (caps move to config), and
`drain-unifier-items.ts` (replaced by `drain-fix-loop.ts`).

## Consequences

- One executor for all post-develop fixes; the R4-10 loops (demo-miss, merge-gate)
  land as new `origin` values + compiler calls, not new machinery.
- The operator can tune loop bounds per install without a code change; exhaustion is
  loud on three surfaces (HTTP 409, worktree marker, notification).
- `orchestrator/` surface stays ~flat: two focused new modules
  (`fix-work-items.ts`, `drain-fix-loop.ts`) against the deletion of
  `drain-unifier-items.ts` and ~170 lines of `unifier-items.ts` append machinery.
- The dev loop re-verifies completed WIs once per round via the already-complete
  shortcut — bounded, real gate time; a status-based skip is a recorded follow-up
  optimization, not part of this change.
