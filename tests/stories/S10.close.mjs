/**
 * S10's closing beats — reflect on the cycle, find what it learned, check what
 * it cost.
 *
 * SPLIT, NEVER BASELINE (ruling 492, the same move as `S10.act2.mjs` and
 * `S10.review.mjs`). `S10.story.mjs` sat at 798 lines when ruling 1736's
 * answered reflect beat needed five `do` steps, which took it over the cap.
 *
 * The cut follows the story's own boundary: these three beats close ACT 1's
 * develop cycle, after the review loop merges it and before ACT 2 interrupts
 * a second one. They are spread into `beats` at the point they already
 * occupied, so the story's order and numbering are unchanged — a beat's number
 * is how every verdict, evidence dir and ruling refers to it.
 */
export const CLOSE = [
    {
      // SOURCE-DERIVED. `data-action="open-reflect"` (`app/artifact/page.tsx
      // :1194`, named in that file's own comment at :1177),
      // `data-action="submit-reflection"` (`ReflectionGate.tsx:297`),
      // `data-section="reflect-done"` (`:165`). NOT ONE of these is
      // corroborated by any test file — a repo-wide grep for
      // `reflect-questions`, `reflect-done` in `*.test.ts` returns zero hits.
      // T1 1693 (bead `forge-8vfn.8.1.31`, S10 proof run 35). `merged` is a
      // PRECONDITION of reflection, not its terminal — a plain agent wait fell
      // through to the generic channel-ended door, which read `merged` as the
      // whole cycle's word and stopped 180s into a reflection that had barely
      // started. `terminal: 'reflected'` + `cycleOf` route this wait to the
      // reflector's OWN terminal (`makeReflectionWatch`) instead.
      //
      // Ruling 1736 (bead `forge-8vfn.8.1.34`, S10 proof run 36, beat 21).
      // `submit-reflection` is rendered DISABLED, with a title naming why
      // (`ReflectionGate.tsx:296-299`), until every `[data-question-index]`
      // fieldset has a recorded choice (`reflectionAllAnswered`,
      // `lib/reflection-form.ts:12-17`). The prior `do` pressed it unanswered,
      // which spent the whole 900 000 ms bound on a control that was never
      // going to enable — and because the pre-act wait only checks PRESENCE,
      // not enabled-ness, the runner had no visibility into that at all
      // (closed alongside this fix — `beats-page.mjs`'s `waitForHandleOrStall`/
      // `waitOffSession` now wrap the same "while waiting" reporter the ACT
      // phase already had, bead `6.11.30`).
      //
      // The reflector's seed set is UP TO 4 questions, MODEL-DETERMINED
      // (`skills/reflector/SKILL.md`): most carry a bullet option list
      // rendered as RADIOS (`data-option-label` per option, `type="radio"
      // name="rq-${i}"`, `ReflectionGate.tsx:236,249-253`), the general-notes
      // question never does (`data-question-freeform`, `:276` — no
      // `data-field` at all, by the skill's own "NO bullet list" instruction).
      // `pressFirstEach`/`fillAllMatching` answer whichever shape THIS cycle's
      // reflector actually wrote, exactly the reason `fillAll` answers the
      // architect's variable-count interview a few beats up — and, because the
      // options are a RADIO GROUP per question, `pressFirstEach` presses only
      // the FIRST option inside each `data-question-index` fieldset, never
      // every option (which would just leave the LAST one checked).
      act: 'Reflect on the cycle',
      do: [
        { press: 'open-reflect' },
        { pressFirstEach: 'option-label', within: 'question-index' },
        { fillAllMatching: 'question-freeform', with: 'Nothing further on this question.' },
        { fill: 'freeform', with: 'No additional notes this cycle.' },
        { press: 'submit-reflection' },
      ],
      // Anchored on this beat's own start (T1 718(1)): the reflector this waits
      // for is the RERUN `fireReflectorRerun` fires from the answer POST above
      // (`bridge-reflect.ts`), not the interactive session's first
      // `reflector.end`, which already fired before this beat pressed
      // anything. `terminal: 'reflected'` + `cycleOf` still route to the
      // reflector's OWN terminal (`makeReflectionWatch`) — unchanged from
      // before this fix — so it is the RERUN's end this resolves on.
      wait: { for: 'agent', terminal: 'reflected', cycleOf: '<runId>', upTo: 900_000 },
      expect: { route: '/artifact', data: { section: 'reflect-done' } },
      say:
        'The cycle ends by writing down what it learned. The operator answers every question the ' +
        'reflector asked — a pick where it offered options, a note where it did not — and that hands ' +
        'the reflector one more pass to fold the answers into the brain.',
    },
    {
      // SOURCE-DERIVED for the reflected theme. `data-theme-node` /
      // `data-theme-active` (`ThemeList.tsx:34-35`) are the SHAPE S6 b7 already
      // asserts VERIFIED — but S6's theme comes from a project-brain SEEDING
      // session, and no pinned story has ever asserted a REFLECTOR-produced
      // theme. `data-ingest-fresh-themes` (`app/knowledge/page.tsx:824-826`) is
      // the reflector-side evidence and is source-only.
      act: 'Find what the cycle learned on the knowledge graph',
      expect: {
        route: '/knowledge',
        data: { page: 'knowledge', 'page-ready': 'true', 'kb-id': 'gitpulse' },
      },
      say: 'The theme the reflector wrote is now a node the next planner will read. That is the loop closing: this cycle made the project\'s brain bigger, and nobody typed it in.',
    },
    {
      // SOURCE-DERIVED, and the comparison is the hard part. `data-run-cost-usd`
      // is `.toFixed(4)` on the monitor strip (`MonitorSummary.tsx:53,101`)
      // while `data-phase-cost-usd` is `.toFixed(2)` per node
      // (`FlowRunDetail.tsx:285`) — DELIBERATELY different attribute names and
      // precisions (`lib/history-ledger-render.test.ts:228-233` documents the
      // non-collision). NO `event`/`event-log` data key exists anywhere, so the
      // page cannot be compared against the log from inside a beat; the exit
      // row does that comparison outside, with
      // `sumAuthoritativeCostFromLines` over the run's events.jsonl — never the
      // naive sum, which double-counts by more than 2× (M3's measurement).
      act: 'Check what the run cost',
      expect: {
        route: '/monitor',
        data: { page: 'monitor', 'page-ready': 'true', 'run-cost-usd': '<runCostUsd>' },
      },
      say: 'One figure, and it is the same figure the event log holds. A run that cannot say honestly what it spent cannot be trusted with a ceiling, so this is checked against the log rather than taken from the screen.',
    },
];
