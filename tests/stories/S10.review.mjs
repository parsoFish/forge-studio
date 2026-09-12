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
      // SOURCE-DERIVED. Node id from the same fixture list; the review station
      // is `adversarial-review` (`flow-run-detail-render.test.ts:104-109`), and
      // `data-section="review-findings"` is corroborated at
      // `flow-run-detail-render.test.ts:413`.
      act: 'The review station files its findings',
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
          section: 'review-findings',
        },
      },
      say: 'A machine reviewer goes first, against the acceptance criteria and the change class the plan gate confirmed. Its findings are the reviewer\'s starting point, not its verdict — the human decides.',
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
      // NO RENDER TEST EXISTS for `DemoReviewSurface` (its own header says the
      // e2e harness asserted it). Every key here is source-only and must be
      // confirmed at the sitting.
      act: 'Anchor one blocking comment to the precedence criterion and send it back',
      do: [
        { press: 'comment-region' },
        { fill: 'comment-body', with: SEND_BACK },
        { fill: 'comment-blocking', with: 'true' },
        { press: 'add-comment' },
        { press: 'send-back' },
      ],
      expect: {
        route: '/artifact',
        data: { page: 'artifact', 'form-kind': 'send-back', 'form-state': 'submitted' },
      },
      say: 'This is the send-back the whole story is built around. The operator does not restart anything and does not write a work item — they anchor one blocking comment to the criterion it fails, and that comment becomes the acceptance criterion the fix has to meet.',
    },
    {
      // SOURCE-DERIVED. The fix lands on the same branch and the run returns to
      // the review station; keys as beat 11.
      act: 'The fix lands on the same branch and comes back for re-review',
      // 30 MINUTES, AT THE CAP, WITH ONE MINUTE OF MARGIN — AND THAT IS
      // DISCLOSED, NOT COMFORTABLE (T1 rulings 555 → 558).
      //
      // The five real gitpulse cycles in `_1.0/traces/` ran their developer-loop
      // in 17, 20, 21, 24 and **29** minutes. This bound is 30. The audit asked
      // for 45; `story-file.mjs` refused it, because `MAX_DECLARED_WAIT_MS` is a
      // deliberate safety limit — "a declared wait is a licence to sit still; an
      // unbounded or absurd one turns a red run into a hung host" — and 558 kept
      // the limit rather than widening it for two beats.
      //
      // So this beat is a coin flip against its own worst measurement, and it is
      // written down here rather than discovered again: a red HERE, at the bound,
      // with `agent.heartbeat` events still streaming, is not a slow product. It
      // is this number. The fix is not a bigger bound — it is a bound that does
      // not expire while the agent is demonstrably progressing (bead under 7.5,
      // the mirror of ruling 518's early exit on a session the product has
      // already given up on).
      //
      // Those are SPAN figures, first to last event of the phase, so a cycle
      // that sat idle overstates. The five gitpulse cycles have no such gaps,
      // which is why they are the ones relied on and the betterado trace's
      // `architect=828m` is not.
      wait: { for: 'agent', upTo: 1_800_000 },
      expect: {
        route: '/flows/forge-develop/run/<cycleId>',
        data: { page: 'flow-run', 'timeline-row': 'true', 'node-id': 'review', 'status': 'complete' /* §15.473: the row exists for an untouched node too */ },
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
      // AMEND-9, as on beat 13: reachable only once 7.6.62 puts `open-gate` on
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
      act: 'Approve — which is the merge',
      do: [{ press: 'approve-and-merge' }],
      expect: {
        route: '/artifact',
        data: { page: 'artifact', 'gate-state': 'approved' },
      },
      say: 'The second human gate, and the only one that spends something irreversible. Approving is not a signal to a later step — it IS the merge, so the operator is pressing the button that lands the change.',
    },
];
