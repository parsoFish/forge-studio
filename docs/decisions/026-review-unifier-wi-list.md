# ADR 026 — Review feedback as unifier work-items (one cycle, no send-back to dev)

- **Status:** accepted (operator-confirmed model + the typed-UWI decision 2026-06-07; implementation is the migration below)
- **Date:** 2026-06-07
- **Supersedes / amends:** **amends [ADR 019](./019-cycle-resume-from-unifier.md)** — retires `resume_from` as the *review send-back* mechanism (the crash-recovery resume + its rebase-onto-main step survive, repurposed). Builds on [ADR 021](./021-local-review-and-unified-demo.md) (in-UI review) and [ADR 023](./023-ui-sole-operator-surface.md) (UI is the sole operator surface).
- **Relates to:** the 2026-06-07 release-folder-data-source assessment, whose three forge defects share one root cause this ADR removes (see Context).

## Context

The release-folder-data-source review surfaced three defects that the
adversarial investigation traced to **one shared root cause**: a review
send-back calls `runRequeue`, which moves the manifest to `pending/`; the
scheduler re-claims it and calls `runCycle` **without a `cycleId`**
([cycle.ts:68](../../orchestrator/cycle.ts#L68), [scheduler.ts:560](../../orchestrator/scheduler.ts#L560)),
so every send-back **mints a fresh `_logs/<cycleId>` dir with no parent link**.
Because cost, events, and the WI-hex list are all keyed per-`cycleId`:

1. **Cost/status lineage blanks** — the resumed cycle's PM/dev cost lives in the old dir.
2. **`forge requeue` has no PR-state guard** — it spawns a sibling cycle on an open PR.
3. **WI hexes disappear** — a resumed cycle skips PM, emits no `pm.work-item-emitted`, so the list derives empty ([use-graph-model.ts:42](../../forge-ui/lib/use-graph-model.ts#L42)).

The unifier is already a Ralph loop with a send-back re-entry mode and already
reads the WI list as input context ([developer-loop.ts:989](../../orchestrator/phases/developer-loop.ts#L989),
[unifier-invocation.ts:307](../../orchestrator/unifier-invocation.ts#L307)) — so the model below is a small step, not a rewrite.

## Decision

**Review feedback appends work-items to the unifier's list; the cycle never leaves.**

1. **The unifier owns a WI queue.** `<worktree>/.forge/unifier-items/UWI-<n>.md`
   (same `WorkItem` frontmatter/body as `.forge/work-items/`; reuse
   `readWorkItemsFromDir` / `writeWorkItem` / `writeWorkItemStatus` /
   `topologicalOrder` / `validateWorkItemSet` verbatim). `runUnifier` becomes a
   `for (const uwi of pending)` loop mirroring the dev-loop's per-WI loop, with the
   composed unifier gate. The dev-WI list under `.forge/work-items/` stays read-only
   input (scope ceiling + the `creates[]` delivery gate).

2. **Seeded with one static `UWI-1` = "unify & prep the PR"** — today's mission
   (prove every dev-WI AC against branch tip, author `demo/<id>/demo.json` +
   `.forge/pr-description.md`, commit, push). With only `UWI-1` present the loop is
   behaviour-equivalent to today.

3. **Review feedback appends UWIs in place.** The `/api/verdict` `send-back` branch
   stops calling `runRequeue`; it **validates then writes one `UWI-<next>.md` per
   review concern** into the live worktree's `unifier-items/` (the GIVEN/WHEN/THEN ACs
   the verdict form already collects become the UWI ACs; `depends_on:[UWI-1]`), then
   signals the cycle to drain. Append-only numbering (never renumber → stable hex id).

4. **Typed UWIs (operator decision 2026-06-07).** A UWI carries a `kind`:
   - `packaging` → the `developer-unifier` skill + the 5-gate composed unifier gate (UWI-1, demo/PR tweaks).
   - `code-fix` → a **dev-style role + the write-a-failing-test-first gate** (the sharp per-WI discipline, `failOnHollowIter0Gate=true`).
   So a review concern that needs real code (*"WI-3 has the wrong algorithm"*) is held
   to the **same rigor as PM-originated code** — without ever returning to a separate
   dev phase. The verdict form classifies each concern (default `code-fix` when ACs
   describe behaviour; `packaging` for demo/doc wording).

5. **One cycle via mechanism (B) — reuse the existing `cycleId`.** Persist a real
   `cycle_id` on the manifest at first claim. The drain re-claims the
   `ready-for-review/` manifest **threading that `cycle_id` into `CycleInput`** so
   `runCycle` reuses the same `_logs`/snapshot dir — the mechanism
   [`finalize-merged.ts:107-119`](../../orchestrator/finalize-merged.ts#L107) already
   proves in-tree. (Mechanism "A — keep a live loop" is rejected: at
   `ready-for-review` the cycle process has already returned; there is no loop to
   re-enter.) One stable `cycleId` ⇒ all three bugs dissolve.

6. **The drain re-runs the full post-unifier spine**, not just `runUnifier`:
   delivery gate → `assertNonEmptyDelivery` → `enforceFinalCiGate` → `openPrInline`
   (update) → `snapshotCycleArtefacts` ([cycle.ts:246-335](../../orchestrator/cycle.ts#L246)).
   Otherwise a review round re-pushes a **CI-red PR** bypassing the gate that exists to stop exactly that.

### Non-negotiable guards (from the adversarial review)

- **Mandatory terminal re-prep UWI** auto-appended after a batch of concern-UWIs, so
  `demo.json`/`pr-description.md` + the snapshot reflect the final state (never approve a stale demo).
- **Merge-vs-drain mutual exclusion** — `finalize-merged` and the drain both act on
  `ready-for-review/` manifests; take the same manifest lock + skip a manifest with
  pending UWIs / a merged PR (don't wipe the worktree mid-unify).
- **A review-round / total-UWI cap** surfaced to the operator (the unifier has no $
  ceiling, C19) — replaces the deleted `send-back-cap-exhausted` backpressure.
- **Validate each UWI before writing** (non-empty GWT, no dep cycle) and fail the HTTP
  request cleanly — a malformed payload must never corrupt the queue / fail the drain.
- **Keep the rebase-onto-main step** ([cycle.ts:167-211](../../orchestrator/cycle.ts#L167)) for
  crash recovery — main may advance during a long review conversation (cascade-v4 #4).

## Consequences

- The three release-folder bugs are removed at the root, not patched: one cycle, one
  `cycleId`, one set of hexes, one cost rollup. The forge `docs/known-gaps.md`
  2026-06-07 items #2 (requeue guard) and #4 (cost/status lineage) are resolved by
  removing the requeue-on-review trigger; #1 (status-blind merge) is addressed
  separately by the first-class `secrets.env` pattern (live tests actually run).
- `resume_from` is removed from the **review** path; the crash-recovery resume +
  rebase survive (operator-explicit `forge requeue` only), now threading `cycle_id`.
- Review-originated code keeps dev-grade rigor (typed `code-fix` UWIs); "never send
  back to the dev phase" holds (a phase, not the rigor, is what's removed).
- `orchestrator/` surface grows modestly (the unifier gains a WI loop) — justified: it
  *removes* the requeue/resume/`unifierFeedbackRef` coupling and reuses existing WI mechanics.

## Migration (ordered, each harness-gated)

1. **RED**: `e2e-journey.mjs` asserts a send-back creates **no** second cycle card / `_logs` dir (same `data-active-cycle-id`, `data-cycles-count` unchanged) and the concern materialises as a UWI hex under the unifier hex.
2. Seed static `UWI-1.md` in `prepareUnifierWorkspace`; `runUnifier` reads it as its single mission (behaviour-equivalent). Gate: build + test.
3. Convert `runUnifier` to the for-each-pending-UWI loop (mirror dev-loop) with the composed gate per UWI + push-after-each. Gate: test + `ui:journey` (still reaches ready-for-review).
4. Persist `cycle_id` on the manifest at first claim; thread it through `finalize-merged` + the drain re-claim. Gate: test.
5. Rewrite `/api/verdict` send-back → validate + append K typed UWIs + drain sentinel; stop calling `runRequeue`. Add the `kind` dispatch + the `code-fix` write-a-failing-test gate. Unit-test the handler. Gate: test.
6. Implement the drain (mechanism B re-claim with existing `cycle_id`) re-running the full spine; mandatory terminal re-prep UWI; merge-vs-drain mutex; the round/UWI cap. Gate: `ui:journey` — the step-1 RED passes (one cycle, UWI hexes appear).
7. Delete `resume_from:'developer'` + the `unifierFeedbackRef`/`pr-feedback.md` consumed-once thread (keep the rebase for recovery); relabel the UI ("add work items"); update `skills/developer-unifier/SKILL.md`. Gate: build + test + `ui:journey`.
8. **Operator-gated**: `verify:cycle` — a real review↔unifier round-trip stays in one cycle and reaches merge.

## Alternatives considered

- **Keep requeue + add a PR-state guard + cost-lineage carry-forward** (the patch route). Rejected — treats three symptoms of one root cause; leaves the new-cycle-per-send-back model that caused them.
- **Mechanism (A) — a live in-place unifier loop.** Rejected — false to the process model (no live loop at `ready-for-review`) and net-new scheduler surface CLAUDE.md caps.
- **Flag-and-continue for all review UWIs** (no typed gate). Rejected by the operator — ships review-originated code at lower rigor than PM-originated code.
