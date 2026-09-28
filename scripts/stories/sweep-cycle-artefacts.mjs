/**
 * sweep-cycle-artefacts.mjs — the ONE claim-then-clear pass over a develop
 * cycle's own queue writes, split out of `sweep.mjs` (SPLIT, NEVER BASELINE —
 * T1 ruling 492) so the file has real headroom and this block's own doc
 * comments are never trimmed to fit a line cap.
 */
import { basename } from 'node:path';
import { claimQueueWrites } from './queue-claim.mjs';
import { captureAndClearMintedRunArtefacts, describeRunArtefactsClear } from './ground-clear.mjs';

/**
 * FAIL FAST RATHER THAN SKIP. The queue claim needs a window and somewhere to
 * capture to, and a default that quietly skipped it would print a clean
 * trailing sweep for a run that never looked at `_queue` — §15.507, a green
 * for a case that did not run, which is the shape of the defect this bead
 * exists to close. Shared by every caller of `sweepCycleArtefacts` — the
 * trailing sweep and the post-stop sweep alike — so the two can never drift
 * on what counts as a usable window.
 */
export function assertCycleArtefactArgs(fnName, sinceMs, evidenceDir) {
  if (typeof sinceMs !== 'number' || typeof evidenceDir !== 'string' || evidenceDir === '') {
    throw new Error(
      `${fnName} needs { sinceMs, evidenceDir } to claim this run's queue writes (forge-8vfn.7.6.74)`,
    );
  }
}

/**
 * THE CYCLE'S OWN WRITES, WHICH NO STORY-ID GLOB CAN REACH (`forge-8vfn.7.6.74`,
 * `forge-8vfn.7.6.146`) — the `INIT-<id>.md` queue manifest, its `.heartbeat`,
 * `_worktrees/<id>` and `_worktrees/wi/<id>`, and the `_logs/<ts>_INIT-*` cycle
 * dir. Exactly the targets `residue.sh`
 * (`.claude/skills/tiered-orchestration/scripts/residue.sh`) gates on for a
 * develop-flow cycle: `_queue/*`, `_worktrees` and `_logs/<ts>_INIT-*`.
 *
 * SPLIT OUT OF `sweepProductFixtures` (bead `forge-8vfn.8.1.52`, row 146) so
 * the post-stop sweep on the SIGTERM/SIGINT path (`run.mjs`) can call the
 * exact same claim-then-clear a normal trailing sweep does, rather than a
 * second copy of it. `sweepProductFixtures`'s OWN residue — the story-named
 * fixtures `productFixturePathsFor` finds — is not this function's business;
 * a run stopped mid-flight keeps its fixture ground for evidence exactly as a
 * crash does, and the residue guard never gates on it.
 *
 * `groundProject` is OPTIONAL here for the same reason it always was: when the
 * caller has no single ground to exempt (the post-stop sweep does not know
 * which story, if any, was in flight), attribution falls back to the
 * `sinceMs`/`untilMs` window alone — the existing born-within-this-run rule,
 * unchanged.
 *
 * ROW 166 (`forge-8vfn.8.1.60`) — `schedulerAlive`, threaded straight into
 * `claimQueueWrites` (its own header explains why: that daemon's heartbeat
 * writer is a `setInterval` inside its OWN process, never a spawned
 * descendant, so no process census can prove it dead short of killing the
 * daemon itself, and an in-flight manifest it might still own is never
 * claimed out from under it). Never given a default AT THIS LEVEL — the
 * right answer is a per-caller fact, not a property of this function:
 *   · the trailing sweep (`sweepProductFixtures`) passes what
 *     `reapCensusAndSweep` already resolved — the scheduler outlives the
 *     STORY, so a cycle it still owns must be deferred, not claimed.
 *   · the post-stop sweep (`run.mjs`'s SIGTERM/SIGINT handler) passes
 *     `false` — the signal that triggers this sweep is what is killing the
 *     scheduler, in the SAME process group, so by the time this sweep runs
 *     there is no live writer left to defer to; claiming what it left behind
 *     is this sweep's entire job.
 *   · the batch-end deferred clear (`sweep-teardown.mjs`'s
 *     `stopSchedulerCensusAndRelease`) passes `false` too: it runs only once
 *     that daemon is CONFIRMED dead (drained, or killed and censused empty).
 * `claimQueueWrites`'s own default (`false`) covers a caller with no opinion
 * at all — never inherited here as license to skip stating one.
 */
export function sweepCycleArtefacts(storyId, root, {
  sinceMs, untilMs, groundProject, evidenceDir, schedulerAlive,
}) {
  assertCycleArtefactArgs('sweepCycleArtefacts', sinceMs, evidenceDir);
  const claim = claimQueueWrites({ root, sinceMs, untilMs, groundProject, evidenceDir, schedulerAlive });

  // `forge-8vfn.7.6.146` — THE REST OF WHAT THIS RUN MINTED, derived from the
  // very ids the claim above just ATTRIBUTED by `created_at`. The claim takes
  // the `INIT-<id>.md` manifests and, by its own words, LEAVES everything else:
  // "LEFT … not an INIT manifest (the story-id sweep owns it)". Nothing owned
  // them. Runs 20 and 21 left a `.md.heartbeat`, two `_worktrees/` trees and a
  // `_logs/<ts>_INIT-*` cycle dir, and the next costed run's residue door
  // refused on each in turn at $0 — three correct refusals, three hand clears.
  //
  // Derived, never a pattern: a `_worktrees/*` sweep would take a concurrent
  // lane's trees, and this box runs four lanes.
  const claimedIds = claim.claimed
    .map((c) => basename(String(c.path)))
    .filter((n) => n.endsWith('.md'))
    .map((n) => n.slice(0, -3));
  const artefacts = captureAndClearMintedRunArtefacts({
    root, storyId, runStamp: String(sinceMs), initiativeIds: claimedIds,
  });

  return {
    claim,
    artefacts,
    lines: [...claim.lines, ...describeRunArtefactsClear(artefacts)],
  };
}
