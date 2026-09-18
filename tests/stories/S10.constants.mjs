/**
 * S10's constants — the operator's words, the ceiling, and the send-back note.
 *
 * SPLIT, NEVER BASELINE (492), and this one was bought by a MERGE rather than
 * by either change alone. `S10.story.mjs` was 716 lines on my branch and 808 at
 * the post-update head: D's `#664` corrected a comment in the same file, and
 * the two edits together crossed the cap that neither crossed apart. My gate
 * ran on my branch and saw 716; CI ran main+branch and saw 808.
 *
 * That is §15.412 with a second author — D's rule was "single-digit headroom in
 * a file you do not own is a deferred failure". The stronger form this taught:
 * **a cap is a property of the MERGE, not of the branch**, and a file two lanes
 * are both commenting has no headroom either of them can see.
 *
 * The cut follows the concern, as the ACT 2 split did: these are the story's
 * DATA — what the operator types, what it may spend, how long a station may
 * take — and the beats are the story's ACTIONS. The ceiling travels here
 * because its justification is the longest prose in the file and belongs beside
 * the number it defends, not beside the beat that reads it.
 */
import { deriveWaitBoundMs } from '../../scripts/stories/wait-bound.mjs';

export const IDEA =
  'Add an --exclude-author <pattern> flag: the inverse of --author. Same *-wildcard, ' +
  'case-insensitive matching, repeatable and OR-combined. It composes with every other ' +
  'filter. State the precedence explicitly when --author and --exclude-author are both ' +
  'given, and annotate the text header and the JSON output the way --author already does.';

/**
 * THE GROUND, and the one place this story's money is declared.
 *
 * `CEILING` below is what the operator TYPES into the idea box and
 * `ground.budget_usd` is what the run is FUNDED with; they are the same money
 * described twice, and until 7.6.118 they were two literals that happened to
 * agree. A story whose typed ceiling and funded ground disagree would run to
 * one number and be judged against the other, and nothing would say so.
 */
export const GROUND = Object.freeze({ project: 'gitpulse', realSpawn: true, budget_usd: 35 });

/** The ceiling the operator types into the idea box, in dollars. DERIVED. */
export const CEILING = String(GROUND.budget_usd);

/**
 * Beat 8's ceiling — the factory planning AND building the initiative, watched.
 *
 * HELD AT A DECLARED FIGURE PENDING T1 721. Run 11 measured the cycle itself at
 * **2 m 01 s** (`13:21:29.805` orchestrator start → `13:23:30.644` cycle.end,
 * three work items written). That is the floor, not the answer, because the beat
 * waits for the ROADMAP to show the finished state and run 11 proved the card
 * can lag the disk: at the red its node still read
 * `data-initiative-status="in-flight"` / `data-plan-state="planning"` sixty
 * seconds after the manifest reached `_queue/ready-for-review/`.
 *
 * SETTLED BY 723, and the answer is the harder of the two: **the roadmap has no
 * live refresh at all.** D read it — `app/projects/[id]/page.tsx` `loadRoadmap`
 * (`:228`) fires only on mount, Retry, bridge recovery or an operator action
 * (`:274-278`). No `setInterval`, no SWR, no `subscribe()`, while six sibling
 * surfaces consume the bridge socket (`bridge-client.ts:1432`). So `:563` was
 * never re-run after the cycle finished, and run 11's stale card was the only
 * outcome the page could produce.
 *
 * That makes it a PRODUCT finding (bead 7.6.27, D's: the projects page
 * subscribes to the socket and refreshes on cycle/queue events), and it fixes
 * this ceiling at **360 s = 3x the measured 2 m 01 s cycle**. There is no
 * cadence to absorb, because there is no cadence; socket latency once 7.6.27
 * lands is negligible against that headroom.
 *
 * **THIS BEAT ASSERTS THE LIVE CARD. It does not reload, navigate away and back,
 * or press the panel's Retry.** Any of those would refresh the roadmap by hand
 * and turn the beat green over a defect that is still there — the operator doing
 * the product's job, which is the one thing a story must never quietly do. Run
 * 12 measures 7.6.27 THROUGH this beat, so a green here will mean the page
 * updated itself.
 *
 * SUPERSEDED BY 7.6.118 / T1 1089, and by the run that finally reached this
 * station. Everything above is why the figure was 360 s; run 17 is why it is no
 * longer a figure at all.
 *
 * **THE WINDOW FUNDED 25% LESS THAN THE CYCLE IT WAS WATCHING** (§15.559). At
 * the measured burn of $3.99 over 476 s, 360000 ms afforded $3.02 against a
 * cycle that spent $3.99 — and that cycle reached `ready-for-review` with 0
 * errors recorded 116 seconds AFTER this beat gave up with `expected
 * "ready-for-review", got "in-flight"`. The product succeeded. The deadline did
 * not. Third distinct beat-8 blocker in three runs, after the ADR 037
 * quarantine and the unwired wait anchor — and the only one of the three that
 * was never a product defect at all.
 *
 * The prose above also shows how it happened: every revision TIGHTENED the
 * number against a measurement of something smaller (run 11's 2m01s cycle, the
 * Architect's 8m49s pass), and tightening a guess is still a guess. No run had
 * ever completed a cycle at this station, so there was nothing to tighten
 * against.
 *
 * RENAMED FROM `PLAN_AND_BUILD_BOUND` BY 7.6.124. That name was minted on the
 * assumption the architect cycle also built — it does not. `forge-architect`
 * ENDS after the project-manager by design and `forge-develop` is a separate
 * flow the operator starts (DEC-3), so beat 8 watches the PLAN cycle only. The
 * same derived bound now serves BOTH cycle waits, which is honest rather than
 * lazy: the bound is a function of what the STORY funds (`ground.budget_usd`),
 * not of which station is running, so one derivation is the correct number for
 * any cycle this story waits on.
 *
 * SO IT IS DERIVED FROM THE MONEY, and it is no longer what decides this beat:
 * the wait ENDS on the cycle's own terminal event (`makeCycleTerminalDoor`), and
 * this is the outer backstop for a cycle that never terminates. See
 * `scripts/stories/wait-bound.mjs` for the derivation and why the clamp is
 * printed rather than hidden.
 */
export const CYCLE_BOUND = deriveWaitBoundMs(GROUND);

/**
 * The one anchored send-back. It lands on the precedence clause — the risky
 * part the plan gate confirmed the class of — so the fix-WI it becomes is the
 * clause the operator asked to gate, not a stylistic note.
 */
export const SEND_BACK =
  'The precedence when both --author and --exclude-author are given is not stated in the ' +
  'output. Exclude must win, and the header annotation must say how many commits each ' +
  'filter removed, so a zero-commit report is never ambiguous about which filter emptied it.';
