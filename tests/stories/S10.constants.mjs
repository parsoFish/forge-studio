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
export const IDEA =
  'Add an --exclude-author <pattern> flag: the inverse of --author. Same *-wildcard, ' +
  'case-insensitive matching, repeatable and OR-combined. It composes with every other ' +
  'filter. State the precedence explicitly when --author and --exclude-author are both ' +
  'given, and annotate the text header and the JSON output the way --author already does.';

/** The ceiling the operator types into the idea box, in dollars. */
export const CEILING = '35';

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
 * Tightened from run 12's measurement regardless: a declared figure that
 * survives a real one is a guess nobody re-examined (513/551; beat 4 cost run 3
 * exactly that).
 */
export const PLAN_AND_BUILD_CEILING_MS = 360_000;

/**
 * The one anchored send-back. It lands on the precedence clause — the risky
 * part the plan gate confirmed the class of — so the fix-WI it becomes is the
 * clause the operator asked to gate, not a stylistic note.
 */
export const SEND_BACK =
  'The precedence when both --author and --exclude-author are given is not stated in the ' +
  'output. Exclude must win, and the header annotation must say how many commits each ' +
  'filter removed, so a zero-commit report is never ambiguous about which filter emptied it.';
