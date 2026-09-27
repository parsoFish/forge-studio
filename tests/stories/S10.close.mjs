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
      // Ruling 1736, round 3 (bead `forge-8vfn.8.1.34`) — `terminal:
      // 'reflected'` is the WRONG word here. Anchored on this beat's own start
      // (T1 718(1)), it admits the INTERACTIVE reflector's first, PRE-ANSWER
      // pass too: that reflection published `user-questions.json` and reached
      // `reflector.end` before this beat pressed anything (run 36:
      // reflector.start 02:59:43, reflector.end 03:04:36 — beat 21 started
      // 02:59:12), so the very next poll after the answer POSTed above saw
      // that ALREADY-terminal event and resolved at once — racing the
      // detached rerun `fireReflectorRerun` (`bridge-reflect.ts`) had only
      // just fired. `terminal: 'reflected-answered'` (same door,
      // `beats-reflection-terminal.mjs`) adds the one gate that gets this
      // right: only a terminal whose PRECEDING `reflector.start` is at or
      // after `user-feedback.md`'s mtime counts, so it is the RERUN's own
      // terminal this resolves on, never the first reflection's.
      wait: { for: 'agent', terminal: 'reflected-answered', cycleOf: '<runId>', upTo: 900_000 },
      expect: { route: '/artifact', data: { section: 'reflect-done' } },
      say:
        'The cycle ends by writing down what it learned. The operator answers every question the ' +
        'reflector asked — a pick where it offered options, a note where it did not — and that hands ' +
        'the reflector one more pass to fold the answers into the brain.',
    },
    {
      // Row 143 (bead `forge-8vfn.8.1.36`, ruling 1737) — NAVIGATION-ONLY, the
      // same shape `S10.act2.mjs` uses for the identical reason (T1 ruling
      // 533, the 504 class: `route` plus `page`/`page-ready`, nothing else).
      // `performSteps` runs BEFORE the route wait and before real-nav
      // (`beats-drive.mjs`), so a `do` naming `kb-select` on THIS beat would
      // run on `/artifact` — the previous beat's page, which carries no such
      // control at all — and spend its whole bound learning nothing.
      //
      // The global `Knowledge` pillar is the only door: `StudioNav.tsx:94`
      // renders it `data-nav="knowledge"`, never `data-action`, so no `press`
      // step can reach it (`handleFor`, `beats.mjs`, only ever builds
      // `[data-action="…"]`). The runner's real-nav fallback
      // (`beats-drive.mjs`'s `[data-nav][href]` branch) is what actually
      // clicks it — unchanged from before this fix.
      act: 'Open the knowledge graph',
      expect: {
        route: '/knowledge',
        data: { page: 'knowledge', 'page-ready': 'true' },
      },
      say: 'The cycle is done. Before reading what it learned, the operator opens the knowledge graph.',
    },
    {
      // Row 143 (bead `forge-8vfn.8.1.36`, ruling 1737). The Knowledge pillar
      // (previous beat) lands on the operator's own LAST-VIEWED base, or the
      // roster's first entry when none was viewed (`app/knowledge/page.tsx
      // :328-337`, `lib/kb-last-viewed.ts`'s `initialKbId`, pinned by
      // `kb-last-viewed.test.ts`) — the product's own intended default, never
      // a defect, and never this cycle's ground. A real run reds: `data-kb-id:
      // expected "gitpulse", got "cycles"`. Selecting it explicitly is the
      // only honest way to find THIS cycle's theme.
      //
      // `data-field="kb-select"` on the `<select>` (`KbSelector.tsx:46`, one
      // `<option value="<kbId>">` per KB), documented in
      // `docs/reference/studio-dom-contract.md` under "KB selector
      // zero-state". `fill` on a SELECT handle resolves to `selectOption`
      // (`beats-steps.mjs`'s `setControl`); the change handler itself
      // navigates to `?id=<kbId>` (`KbSelector.tsx:39`), which is what moves
      // `data-kb-id`.
      //
      // SOURCE-DERIVED for the reflected theme, unchanged by this fix.
      // `data-theme-node` / `data-theme-active` (`ThemeList.tsx:34-35`) are the
      // SHAPE S6 b7 already asserts VERIFIED — but S6's theme comes from a
      // project-brain SEEDING session, and no pinned story has ever asserted a
      // REFLECTOR-produced theme. `data-ingest-fresh-themes`
      // (`app/knowledge/page.tsx:824-826`) is the reflector-side evidence and is
      // source-only.
      act: 'Find what the cycle learned on the knowledge graph',
      do: [{ fill: 'kb-select', with: 'gitpulse' }],
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
