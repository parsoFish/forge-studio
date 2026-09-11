/**
 * S10's ACT 2 — stop a run mid-flight, and resume it.
 *
 * SPLIT, NEVER BASELINE (ruling 492). `S10.story.mjs` reached 802 lines when
 * amend-7's provenance comments landed, one line over the cap — the same way
 * `sweep.test.ts` did an hour earlier, and for the same reason: the comments
 * that record WHY a beat asserts what it asserts are most of this corpus's
 * weight, and they are the part worth keeping.
 *
 * The cut follows the story's OWN labelled boundary, not the line count. ACT 1
 * is the develop cycle end to end; ACT 2 is the interruption and the recovery,
 * and the file already named it that way in two beat titles before this split
 * existed. Beat 21 travels with it because it is ACT 2's setup: the Monitor row
 * is how the operator reaches the running initiative they are about to stop.
 *
 * These beats are spread into `beats` at the point they already occupied, so
 * the story's order and numbering are unchanged — a beat's number is how every
 * verdict, evidence dir and ruling refers to it, and renumbering them to suit a
 * file split would invalidate the campaign's own record of this story.
 */
export const ACT_2 = [
    {
      // NAVIGATION-ONLY (T1 ruling 533, the 504 class: `route` plus
      // `page`/`page-ready`, nothing else). `performSteps` runs BEFORE the
      // route wait and before real-nav, so the beat that follows would press
      // its control while still standing on the page this beat leaves — and
      // spend its whole bound on a control that page does not carry. Run 2
      // measured that shape at 600 000 ms on beat 4 and 900 000 ms twice more.
      // Reached by the monitor's own run row (`app/monitor/page.tsx:155`).
      // `abandon-run` is on the run page's controls (`RunControls.tsx:34`,
      // a variable-valued handle), not on the monitor.
      act: 'Open the running initiative from Monitor',
      expect: {
        route: '/flows/forge-develop/run/<runId>',
        data: { page: 'flow-run', 'page-ready': 'true' },
      },
      say: 'Act 2 starts where act 1 was watched from: the operator opens the run they are about to stop.',
    },
    {
      // ACT 2 — SOURCE-DERIVED, and NOTHING in the pinned corpus covers it: a
      // grep for `resume`, `forced stop`, `abort`, `kill`, `pause` across all
      // eleven story files returns zero matches. Handles:
      // `data-section="run-controls"` (`RunControls.tsx:176-180`, corroborated
      // `lib/run-controls-render.test.ts:63-64`), `data-action="abandon-run"` /
      // `"requeue-run"` / `"resume-run"` (`lib/run-controls.ts:41,49,57`,
      // corroborated `lib/run-controls.test.ts:60`), and the arm-then-confirm
      // pair `data-component="abandon-confirm"` + `data-action="confirm-abandon"`
      // (`RunControls.tsx:227,235,243`, corroborated
      // `run-controls-render.test.ts:79-80`). THIS SURFACE CONFIRMS; the
      // roadmap drawer's `recovery-abandon` does not (header note).
      act: 'ACT 2 — stop a run mid-flight',
      do: [{ press: 'abandon-run' }, { press: 'confirm-abandon' }],
      expect: {
        route: '/flows/forge-develop/run/<runId>',
        data: { page: 'flow-run', section: 'run-controls', component: 'abandon-confirm' },
      },
      say: 'Things stop halfway. What matters is not that it never happens but that stopping is a decision the operator makes on purpose, twice, rather than something they discover.',
    },
    {
      // NAVIGATION-ONLY (T1 ruling 533, the 504 class: `route` plus
      // `page`/`page-ready`, nothing else). `performSteps` runs BEFORE the
      // route wait and before real-nav, so the beat that follows would press
      // its control while still standing on the page this beat leaves — and
      // spend its whole bound on a control that page does not carry. Run 2
      // measured that shape at 600 000 ms on beat 4 and 900 000 ms twice more.
      // Reached by the run page's own project link (`FlowRunDetail.tsx:154`,
      // `data-action="open-project"`). `recovery-requeue` lives on the
      // project's roadmap (`InitiativeDetail.tsx:344`).
      act: 'Go back to the project to pick the stopped work up again',
      expect: {
        route: '/projects/gitpulse',
        data: { page: 'projects', 'page-ready': 'true' },
      },
      say: 'Recovery is where the operator already is — the roadmap the work lives on, not a special screen.',
    },
    {
      // ACT 2 — SOURCE-DERIVED. The preservation evidence lives on the ROADMAP
      // DRAWER, not on run-controls: `data-recovery-attempt-count` and
      // `data-recovery-prior-attempts` (`InitiativeDetail.tsx:291-294,302-303`,
      // corroborated `lib/roadmap-canvas-render.test.ts:292-294`) and
      // `data-recovery-commits` (`:322`) — the branch's surviving commits.
      // `RunControls.tsx` carries NO per-work-item preservation attribute at
      // all, which is why this beat changes surface.
      act: 'ACT 2 — resume it, and see the finished work items survived',
      do: [{ press: 'project-tab-roadmap' }, { press: 'recovery-requeue' }],
      // 15 minutes, UNCHANGED and UNMEASURED (T1 ruling 558). A RESUMED
      // developer-loop has never been measured in this campaign — beats 5–22
      // have never run to completion — so there is no figure to raise this to.
      // Left alone deliberately rather than guessed at, and said here so that a
      // red on this beat reads as FIRST MEASUREMENT and not as a bound too
      // small.
      wait: { for: 'agent', upTo: 900_000 },
      expect: {
        route: '/projects/gitpulse',
        data: {
          page: 'projects',
          'project-id': 'gitpulse',
          section: 'recovery-detail',
          'recovery-prior-attempts': '1',
        },
      },
      say: 'The second attempt starts from what the first one finished, not from nothing. The work items that passed are still passed and their commits are still on the branch — that is the whole reason a stopped run is recoverable rather than wasted.',
    },
];
