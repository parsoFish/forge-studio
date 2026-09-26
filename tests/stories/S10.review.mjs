/**
 * S10's REVIEW LOOP — findings, the gate, the send-back, the re-review, the merge.
 *
 * SPLIT, NEVER BASELINE (ruling 492), for the second time in this story and
 * for the same reason as the first: amend-9's §15.473 rationale took
 * `S10.story.mjs` to 816 lines, and the comments recording WHY a beat asserts
 * what it asserts are most of this corpus's weight. `S10.act2.mjs` already
 * established the shape; this follows it rather than inventing a second one.
 *
 * The cut is at the story's OWN labelled boundary, not at a line count. What
 * travels here is one arc the beat titles already name: the machine reviewer
 * files findings, the operator opens the verdict at its gate, sends it back
 * with one anchored comment, and the fix returns on the same branch. It is the
 * send-back loop — the thing S10 exists to demonstrate — and it reads as a
 * unit or not at all.
 *
 * These beats are spread into `beats` at the point they already occupied, so
 * the story's order and numbering are unchanged. A beat's number is how every
 * verdict, evidence dir and ruling refers to it, and renumbering to suit a
 * file split would invalidate the campaign's own record of this story.
 */
import { SEND_BACK } from './S10.constants.mjs';

export const REVIEW_LOOP = [
    {
      // ROW 113 (bead `forge-8vfn.8.1.19`), SPLIT FROM ONE BEAT. This beat and
      // the one after it used to be ONE beat asserting BOTH the timeline row
      // (`timeline-row`/`node-id`/`status`) AND `section: 'review-findings'`
      // together. `resolveExpectations` (`beats-page-read.mjs:282-311`) picks
      // ONE best-matching record for every key a beat's `expect.data` shares,
      // and this route renders the two on DIFFERENT elements — the timeline
      // row (`FlowRunDetail.tsx:282-284`) and the findings panel are not the
      // same node — so asked for together the resolver kept the row and
      // silently dropped `section`: a beat that never filed a finding at all
      // would have looked identical to one that had. Split on the same route,
      // like beat 9/13's own precedent, no `do` on either half.
      //
      // SOURCE-DERIVED. Node id from the same fixture list; the review station
      // is `adversarial-review` (`flow-run-detail-render.test.ts:104-109`).
      act: 'The review station finishes its pass',
      // Same as beat 9: the review station ran inside the cycle beat 8 waited
      // through, so this reads the findings it left rather than waiting 20
      // minutes for them.
      expect: {
        route: '/flows/forge-develop/run/<cycleId>',
        data: {
          page: 'flow-run',
          'timeline-row': 'true',
          'node-id': 'adversarial-review',
          // §15.473, as on the dev beat: the row is declared, the status is run.
          'status': 'complete',
        },
      },
      say: 'A machine reviewer goes first, against the acceptance criteria and the change class the plan gate confirmed. Its pass runs inside the same cycle the operator has already been watching, and finishes without asking anything of them.',
    },
    {
      // ROW 113 (bead `forge-8vfn.8.1.19`) — the SECOND half of the split
      // above: the same press-free read of the same route, one beat later, so
      // `section` gets its OWN best-matching record instead of losing a tie to
      // the timeline row. `data-section="review-findings"` is corroborated at
      // `flow-run-detail-render.test.ts:413`.
      act: 'The review findings are on the run page',
      expect: {
        route: '/flows/forge-develop/run/<cycleId>',
        data: { page: 'flow-run', section: 'review-findings' },
      },
      say: 'Its findings are the reviewer\'s starting point, not its verdict — the human decides.',
    },
    {
      // NAVIGATION-ONLY (T1 ruling 533, the 504 class: `route` plus
      // `page`/`page-ready`, nothing else). `performSteps` runs BEFORE the
      // route wait and before real-nav, so the beat that follows would press
      // its control while still standing on the page this beat leaves — and
      // spend its whole bound on a control that page does not carry. Run 2
      // measured that shape at 600 000 ms on beat 4 and 900 000 ms twice more.
      // Reached by the run page's own gate chip (`PhaseDrawer.tsx:749`).
      // THE QUERY IS DECLARED (ruling 534): that drawer builds every chip as
      // `/artifact?run=…&type=…&mode=…`, so a develop run renders several
      // links sharing this pathname and differing only in their query —
      // 7.5.3's ambiguity refusal, working as designed. Naming the query is
      // how a beat says WHICH destination it means (ruling 514).
      act: 'Open the review verdict at its gate',
      // AMEND-9 — WHY THIS BEAT COULD NOT ARRIVE, AND WHAT FIXED IT.
      // It stays NAVIGATION-ONLY (533): the runner reaches it by REAL-NAV,
      // clicking a link on the page it is standing on whose route matches the
      // declared one (`beats-drive.mjs:347`, `:371`); there is no `page.goto`
      // fallback — `:382` says so in the refusal itself, "an unreachable route
      // must not pass as a beat".
      //
      // That refusal is what this beat was earning. The gate link existed
      // TWICE and on neither of them was the page the operator stands on:
      // `RunRail.tsx:293` and `PhaseDrawer.tsx:749`, both on the FLOW MONITOR
      // (D's 7.6.62, ruling 819). The run page's only `/artifact` link was
      // `:146`, `type=plan&mode=view` — a different query, so a different
      // destination, correctly not matched. Run 14 never reached here to show
      // it (the cycle stopped at the plan gate), which is why a beat can stay
      // unreachable for nine runs without saying so.
      //
      // 7.6.62 puts `a[data-action="open-gate"]` on the run page itself, with
      // `href=/artifact?run=<runId>&type=<gate-type>&mode=gate` derived from
      // the flow rather than hardcoded — so THIS route becomes reachable by
      // the same mechanism the beat always used. Nothing here changes but the
      // record of why.
      //
      // THE DECLARED QUERY IS THE GATE-TYPE ASSERTION. 7.6.62's bug was both
      // surfaces hardcoding `type=verdict` for ANY gated run; a plan-gated run
      // would send the operator to `type=plan`'s artifact, and `routeMatches`
      // would not match this beat's declared route. The story asserts the
      // operator-visible outcome; D's own doors assert the attribute.
      expect: {
        route: '/artifact?run=<cycleId>&type=verdict&mode=gate',
        data: { page: 'artifact', 'page-ready': 'true' },
      },
      say: 'The review has an opinion and the operator goes to read it where the decision is made.',
    },
    {
      // SOURCE-DERIVED, and the surface choice is load-bearing. The cycle
      // review gate is `/artifact?type=verdict&mode=gate`
      // (`app/artifact/page.tsx:4-36,922-931`). TWO components render a verdict
      // there: `ReviewVerdictForm` (fallback) and `DemoReviewSurface` (primary,
      // when a demo model exists). THIS BEAT NEEDS `DemoReviewSurface`, because
      // `ReviewVerdictForm`'s rationale textarea carries NO `data-field` at all
      // (`ReviewVerdictForm.tsx:97-104`) — the DSL cannot fill it. The anchored
      // path does: `data-action="comment-region"` (`DemoReviewSurface.tsx:459`),
      // `data-field="comment-body"` (`:435`), `data-field="comment-blocking"`
      // (`:443`), `data-action="add-comment"` (`:448`), then
      // `data-action="send-back"` (`:262`) with `data-form-kind` and
      // `data-ac-count` (`:227,229`). A blocking comment becomes a
      // `ReviewCommentAc` GIVEN/WHEN/THEN carried as the send-back's
      // acceptanceCriteria (`lib/review-comments-client.ts:11,22-23`) — there
      // is no separate "fix work item" handle, and this comment records that
      // rather than inventing one.
      //
      // RENDER TEST NOW EXISTS: `apps/studio/tests/regression/
      // DemoReviewSurface-collapsed-regions.test.ts` pins the region wall
      // (collapse-by-default over 12 regions, `toggle-region`/`comment-region`
      // scoping, and — `forge-8vfn.8.1.16` — that a COLLAPSED AC header still
      // carries its full criterion text). Every OTHER key here remains
      // source-only and must be confirmed at the sitting.
      //
      // COLLAPSE + TEXT SCOPE + FALLBACK (`forge-8vfn.8.1.16`, T1 ruling
      // 1561). S10 has 25 acceptance criteria (`S10.constants.mjs`'s `IDEA`
      // decomposes into more than `REGION_COLLAPSE_THRESHOLD` = 12), so every
      // AC region starts COLLAPSED (`lib/demo-review-view.ts`) — there is no
      // `comment-region` button anywhere until its own region is toggled open
      // first. Which criterion NAMES the precedence rule is decided by the
      // LLM that decomposed the initiative, at run time, so no beat can
      // hardcode "AC 7" — a `bind` scope has nothing earlier to bind from
      // either. `pressWithin`'s TEXT scope resolves this live, against
      // whichever AC header's own DOM text (PART 1's fix — the criterion sits
      // in the header even collapsed) contains "precedence": the FIRST such
      // region in document order, case-insensitive. `fallback: 'first'`
      // covers the case where the LLM's own wording never says "precedence"
      // verbatim — the run still anchors somewhere and the runner's log names
      // that it fell back, rather than stalling a funded run over phrasing.
      // Both `toggle-region` and `comment-region` below name the SAME scope
      // and re-resolve it independently (never cached between the two
      // presses), which is why the picker's re-resolution stability is its
      // own pinned case (`beats-press-within-text.test.ts`).
      act: 'Anchor one blocking comment to the precedence criterion (the first criterion, said so in the log, when none names precedence) and send it back',
      // 7.6.143: beat 16's agent wait lives HERE, on the beat whose
      // `send-back` press starts the work it waits for. That much was already
      // right; `forge-8vfn.8.1.23` (T1 rulings 1577/1579, S10 RUN 30) is what
      // was still missing.
      //
      // RUN 30's TRAP. The wait above used to read plain `{ for: 'agent',
      // upTo: 1_800_000 }` — no `cycleOf`, no `terminal` — so
      // `waitForConsequence` built no `cycleWatch` at all and this beat waited
      // on nothing but its OWN `expect` below. `form-state: 'submitted'` and
      // `region-comment-count: '1'` are the send-back REQUEST's own local
      // state, set the instant the POST resolves; they held ~1.5 s after the
      // press, so the wait ended immediately — before the scheduler had even
      // picked the continuation back up, let alone run it.
      //
      // THE FIX REUSES BEAT 10's DOOR, UNCHANGED. A send-back CONTINUES the
      // develop cycle (DEC-2) rather than minting a new one, so `cycleOf:
      // '<runId>'` + `terminal: 'ready-for-review'` resolve the SAME cycle
      // beat 10 watched, through `makeCycleTerminalDoor`
      // (`beats-agent-proc.mjs:298`). `anchor: 'send-back'` is what makes that
      // safe here: `cycleStartedSince` (`:407`) only credits a terminal once
      // the watched dir's OWN `cycle.start` lands AT OR AFTER the anchor, and
      // the queue-terminal check (T1 1503, row 98, `:358-371`) applies the
      // identical rule to a manifest's arrival mtime — so a terminal the
      // FIRST cycle already left behind (`ready-for-review`, sitting there
      // since before the press) cannot satisfy this wait. Only a terminal
      // written by a run that started AFTER the send-back can.
      //
      // MEASURED ON RUN 30. Send-back landed ~11:32:30. The continuation's
      // own fresh `cycle.start` is on disk at 11:34:00.108Z — after the
      // anchor, so the door correctly refuses to credit round 1's terminal
      // and waits for round 2's. The manifest sat in `_queue/in-flight/`
      // (never `ready-for-review`) for the whole fix — confirmed by the
      // run's own queue trace — until the second `cycle.end` at
      // 11:50:40.212Z, and the queue read `ready-for-review` again at
      // 11:51:08: 18m38s after the send-back (~18.6 min), comfortably under
      // the 30 minutes declared below and under the 17-29 min range this
      // file's own developer-loop measurements already cite. It is an
      // INACTIVITY window (`beats-cycle-progress.mjs`), reset by every
      // `events.jsonl` write and persisted review chunk the fix cycle makes
      // — developer-ralph, demo-agent and four adversarial-review passes all
      // land inside it — and backstopped by `CYCLE_WAIT_WALL_CEILING_MS`
      // (90 min) for a cycle that stops writing without ever finishing.
      wait: {
        for: 'agent', anchor: 'send-back',
        cycleOf: '<runId>',
        terminal: 'ready-for-review',
        upTo: 1_800_000,
      },
      do: [
        {
          pressWithin: {
            scope: { attr: 'demo-region', text: 'precedence', fallback: 'first' },
            action: 'toggle-region',
          },
        },
        {
          pressWithin: {
            scope: { attr: 'demo-region', text: 'precedence', fallback: 'first' },
            action: 'comment-region',
          },
        },
        { fill: 'comment-body', with: SEND_BACK },
        { fill: 'comment-blocking', with: 'true' },
        { press: 'add-comment' },
        { press: 'send-back' },
      ],
      expect: {
        route: '/artifact',
        data: {
          page: 'artifact', 'form-kind': 'send-back', 'form-state': 'submitted',
          'region-comment-count': '1',
        },
      },
      say: 'This is the send-back the whole story is built around. The operator does not restart anything and does not write a work item — they anchor one blocking comment to the criterion it fails, and that comment becomes the acceptance criterion the fix has to meet.',
    },
    {
      // SOURCE-DERIVED. The fix lands on the same branch and the run returns to
      // the review station; keys as beat 11.
      act: 'The fix lands on the same branch and comes back for re-review',
      // 7.6.143 (T1 1147) — NO WAIT HERE. This beat presses nothing and
      // expects a route the previous beat does not leave the page on, so
      // `routeMatches` is false and NOTHING could ever consume a bound
      // declared on it — `story-file.mjs` refuses that shape at validation.
      // Beat 16's wait (now `cycleOf`/`terminal`/`anchor`-gated) is what sits
      // through the fix; by the time the runner reaches here that wait has
      // already resolved, so this beat only has to read what is on the page.
      //
      // `forge-8vfn.8.1.23` (T1 rulings 1577/1579, S10 RUN 30) — WHY
      // `node-id: 'review', status: 'complete'` IS NOT ENOUGH ON ITS OWN.
      // `review-loop` and `closure` both canonicalise onto the SAME `review`
      // node (`run-model.ts`'s header comment), and a send-back continues the
      // cycle rather than resetting it, so that row reads `complete` from
      // ROUND 1's own closure onward and never goes back to anything else.
      // Before beat 16 carried a real `cycleOf` wait, this beat reached here
      // 0.7 s after the send-back press and went green on round 1's terminal
      // state alone — the exact defect this citation is for.
      //
      // `review-round: '2'` is the key ONLY the re-review can satisfy.
      // `findReviewRound` (`packages/flows/run-model-derive-lineage.ts`)
      // counts COMPLETED `adversarial-review` passes — `end` events only,
      // never `start` — so it reads 1 the instant the send-back is pressed
      // (round 1 already finished before the operator could see the gate) and
      // does not reach 2 until the SECOND pass genuinely finishes. Run 30: the
      // second `adversarial-review` end landed at 11:50:33.914Z, sixteen
      // seconds before that cycle's own `cycle.end` — so by the time this beat
      // reads the page (after beat 16's wait has already sat through the
      // whole fix), `review-round` and `status: 'complete'` are both true for
      // the SAME round, not one stale and one fresh.
      //
      // 30 MINUTES, AT THE CAP, WITH ONE MINUTE OF MARGIN — AND THAT IS
      // DISCLOSED, NOT COMFORTABLE (T1 rulings 555 → 558). This beat asserts
      // no bound of its own; the figure below is beat 16's, which now governs
      // the whole round-trip.
      //
      // The five real gitpulse cycles in `_1.0/traces/` ran their developer-loop
      // in 17, 20, 21, 24 and **29** minutes. This bound is 30. The audit asked
      // for 45; `story-file.mjs` refused it, because `MAX_DECLARED_WAIT_MS` is a
      // deliberate safety limit — "a declared wait is a licence to sit still; an
      // unbounded or absurd one turns a red run into a hung host" — and 558 kept
      // the limit rather than widening it for two beats. Run 30's own re-review
      // cycle finished in 18m38s (~18.6 min), well inside that margin, and is
      // now the sixth measurement sitting beside the five gitpulse ones above.
      //
      // Those are SPAN figures, first to last event of the phase, so a cycle
      // that sat idle overstates. The five gitpulse cycles have no such gaps,
      // which is why they are the ones relied on and the betterado trace's
      // `architect=828m` is not.
      expect: {
        route: '/flows/forge-develop/run/<cycleId>',
        data: {
          // §15.473: the row exists for an untouched node too.
          page: 'flow-run', 'timeline-row': 'true', 'node-id': 'review', 'status': 'complete',
          'review-round': '2',
        },
      },
      say: 'No restart, no second cycle, no lost work. The send-back became one more thing to satisfy on the branch that already exists, which is the difference between a review loop and a do-over.',
    },
    {
      // NAVIGATION-ONLY (T1 ruling 533, the 504 class: `route` plus
      // `page`/`page-ready`, nothing else). `performSteps` runs BEFORE the
      // route wait and before real-nav, so the beat that follows would press
      // its control while still standing on the page this beat leaves — and
      // spend its whole bound on a control that page does not carry. Run 2
      // measured that shape at 600 000 ms on beat 4 and 900 000 ms twice more.
      // Same gate chip, same declared query: the re-review lands back on the
      // run page, and the verdict is read at the gate again.
      act: 'Open the re-reviewed verdict at its gate',
      // AMEND-9, as on beat 15 (renumbered by ROW 113's split — this cross-
      // reference already read "beat 13" before that split, one off from the
      // AMEND-9 beat's own then-number of 14; corrected here rather than
      // carried forward wrong under a new number): reachable only once
      // 7.6.62 puts `open-gate` on
      // the run page. The re-review parks the run at its gate again, so the
      // link renders again (`run.status === 'gated'`), and the declared query
      // is again what distinguishes this destination from the plan artifact.
      expect: {
        route: '/artifact?run=<cycleId>&type=verdict&mode=gate',
        data: { page: 'artifact', 'page-ready': 'true' },
      },
      say: 'The fix came back. The operator reads the verdict again before deciding.',
    },
    {
      // SOURCE-DERIVED, and the merge handle is weaker than one would like.
      // `data-gate-state="approved"` (`app/artifact/page.tsx:924-930`, set at
      // `:1148,1169`) plus the product's own copy "Approved — merged." (`:1190`,
      // `DemoReviewSurface.tsx:243`) IS the merged-outcome handle: there is no
      // machine-readable merged boolean, no PR-state key, anywhere in the DOM.
      // Recorded as an open item — the exit row re-derives the merge with
      // `gh pr view --repo parsoFish/gitpulse`, not from this page.
      //
      // ROW 115 (bead `forge-8vfn.8.1.20`). With no `wait` this beat took the
      // 15 s DOM default while `approve-and-merge`'s POST blocks through
      // release-finalize and the merge itself — measured at ~72 s on run 29.
      // `gateState` (`app/artifact/page.tsx:585`) starts `'idle'` and
      // `DemoReviewSurface`'s `onSubmitted` (`:1148-1169`) does not flip it to
      // `'approved'` until `onSubmit`'s `await submitVerdict(...)` RETURNS, so
      // `idle` IS the blocking POST in flight — a `settle` wait that sits
      // through exactly that value, same shape as S6 beat 9's drain
      // (`S6.story.mjs:560`) and S8 beat 4's refresh (`S8.story.mjs:248`).
      act: 'Approve — which is the merge',
      do: [{ press: 'approve-and-merge' }],
      wait: { for: 'settle', upTo: 180_000, key: 'gate-state', while: 'idle' },
      expect: {
        route: '/artifact',
        data: { page: 'artifact', 'gate-state': 'approved' },
      },
      say: 'The second human gate, and the only one that spends something irreversible. Approving is not a signal to a later step — it IS the merge, so the operator is pressing the button that lands the change.',
    },
];
