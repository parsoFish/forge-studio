/**
 * S1's ACT 3 — plan with the Architect, and approve the plan.
 *
 * SPLIT OUT OF `S1.story.mjs`, `forge-8vfn.7.6.75` follow-through under T1 961:
 * that file returned to 800/800 the moment 7.6.98's amendment text landed, and
 * 961 ruled the next amend owes the act-split rather than another trim. The cut
 * is by ACT, not by line count — beats 10 and 11 are the architect's own arc,
 * from "describe the first piece of work" to an approved, committed plan, and
 * they are the two beats every bound in this bead is about.
 *
 * The same rule as `S10.act2.mjs`: this file holds beats, nothing else. Both
 * halves are validated as ONE story by `validateStory`, so nothing here can
 * drift from the beats that precede it without the runner saying so.
 *
 * NOTHING IS EDITED IN THE MOVE. `validateStory(S1)` hashes identically before
 * and after — `2c0e5eb16a882bd8`, 11 beats.
 */
import { IDEA, CEILING, ANSWER } from './S1.constants.mjs';

export const ACT_3 = [
    {
      // AMENDED 2026-09-05 (H6, operator present) — expressible, and it always
      // was the same shape as the demo handoff two beats up. `NewIdeaBox`'s
      // `start-architect` does NOT push the minted id into a route: it sets
      // `startedSessionId` and publishes it on its own section
      // (`NewIdeaBox.tsx:111`), then renders `SessionMinted` beside it
      // (`:187`). `ProjectArchitectEntry.tsx:84` opens that box INLINE on the
      // project page, so every step of this act happens on `/projects/gitweave`
      // and the id is bound where it is minted. The beat that stood here
      // asserted the architect session's own phase and could never reach it —
      // no earlier beat could supply the segment, so nothing was ever pressed
      // and no Architect was ever started. Its `session-phase` assertion is
      // not re-homed: the beat below walks through that session to the plan
      // gate and asserts `architect-phase` there, which is the same fact read
      // where the operator actually decides on it.
      act: 'Press "Plan with Architect" and describe the first piece of work',
      // AMENDED 2026-09-05 (ruling 214 (c) as re-scoped by ruling 215). Run 3
      // reported `no element carries that handle` for `plan-with-architect` —
      // a handle `ProjectArchitectEntry` renders UNCONDITIONALLY, in every
      // branch of `[data-section="project-roadmap"]`. It was one tab away: the
      // project page's tab buttons carried `data-tab`/`data-tab-active` and no
      // `data-action`, and `beats.mjs` resolves `[data-action=…]` only, so no
      // story could reach the roadmap tab. Bead `forge-8vfn.6.11.9` (#436)
      // declared it; this presses it.
      do: [
        { press: 'project-tab-roadmap' },
        { press: 'plan-with-architect' },
        { fill: 'idea', with: IDEA },
        { fill: 'cost-ceiling-usd', with: CEILING },
        { press: 'start-architect' },
      ],
      expect: {
        route: '/projects/gitweave',
        data: {
          page: 'projects',
          'project-id': 'gitweave',
          section: 'new-idea',
          'architect-session-id': '<architectSessionId>',
        },
      },
      say: 'With a contract in place the Architect can plan. It interviews the operator, reads the project, and produces a roadmap for review — the first Gate a human stands at. A real Agent costs money, so the operator caps this run before starting it, and forge names the session it just minted on the page they are standing on rather than sweeping them into it.',
    },
    {
      // Fully expressible. `/artifact` is reached by a query-string href, so
      // the runner's `a[href="/artifact"]` fallback would not match it — the
      // navigation is a `do` step (`[data-action="open-plan"]`,
      // `SessionArchitectPanel.tsx`) and the approval follows it on the page
      // it lands on (`[data-action="approve-plan"]`, `PlanGate.tsx`).
      //
      // AMENDED 2026-09-05 (H6, operator present) — one press added at the
      // front. The beat above now binds `<architectSessionId>` on the project
      // page rather than being swept into the session, so this beat starts on
      // `/projects/gitweave` and `open-plan` is not there — it is on the
      // architect session's panel. `SessionMinted.tsx:26` renders
      // `[data-action="view-architect-session"]` beside the id the beat above
      // bound, so the walk in is a declared step like the other two. Three
      // presses, three surfaces, all named by the product.
      act: 'Open the session, read the plan and press Approve',
      // AMENDED 2026-09-06 (T1 rulings 312/317, operator-confirmed). THE
      // ARCHITECT INTERVIEWS BEFORE IT PLANS, and it decides how many ROUNDS it
      // needs — `bridge-studio-architect.ts:380` writes `{ phase:
      // 'interviewing', round: round + 1 }` and spawns another turn on every
      // submission, with no ceiling anywhere in the product (bead
      // `forge-8vfn.6.10.28`). Measured on S4 run 4: `round: 2` with one round
      // of answers recorded, red at `awaiting-answers` after the full bound.
      //
      // So `repeat` answers rounds UNTIL the phase leaves the interview,
      // bounded by this beat's own declared wait — never a fixed count, which
      // is wrong in BOTH directions: too few never reaches the draft, and too
      // many press `submit-answers`, which exists only while the session awaits
      // answers (`studio/session-kinds.yaml:88` is the only row declaring
      // `awaits: questions`), so the surplus press reds on a control that is
      // correctly gone.
      do: [
        { press: 'view-architect-session' },
        // `until` is the INTERVIEW's end, not this beat's. AMENDED 2026-09-06
        // (T1 ruling 320) after S1 run 6 burned its whole bound here: the
        // repeat borrowed `expect.data`, which is `architect-phase:
        // 'committed'` — produced by `approve-plan`, two steps LATER — so it
        // could never stop by answering questions. `status.json` showed the
        // product was right all along (`phase: "awaiting-verdict", round: 2`,
        // one round answered): the architect drafted, and the loop kept
        // submitting to a session that had moved on.
        {
          repeat: [{ fillAll: 'question-freetext', with: ANSWER }, { press: 'submit-answers' }],
          until: { 'session-phase': 'awaiting-verdict' },
          // 7.6.98. THE BOUND LIVES HERE, on the loop that actually spends the
          // time, and `progressKey` must be a key `until` names — so it is
          // guaranteed observable on the page this repeat stands on. Declared
          // on the beat's `wait` (7.6.77's form) it also reached the
          // consequence wait, which stands on `/artifact` where
          // `data-session-phase` does not exist at all.
          perTransition: 480_000,
          progressKey: 'session-phase',
        },
        { press: 'open-plan' },
        { press: 'approve-plan' },
      ],
      // AMENDED 2026-09-13 (`forge-8vfn.7.6.77`, then `7.6.98`; T1 930/971/977).
      // THE LIVE BOUND IS ON THE REPEAT ABOVE, not here. `upTo` is a BACKSTOP.
      //
      // Measured, five funded runs — `awaiting-answers` counted, never
      // `round=N`, which is an attempt and not an answered round (§15.528):
      //
      //   run | answered | interview ends | final turn         | outcome
      //    7  |    1     |      68 s      | 392 s  completed   | PASS
      //    9  |    2     |     132 s      | 327 s  completed   | PASS
      //   11  |    2     |     154 s      | 386 s  completed   | PASS
      //    8  |    2     |     160 s      | 437 s  KILLED      | FAIL
      //   10  |    3     |     216 s      | 379 s  KILLED      | FAIL
      //
      // THE TWO FAILURES HAVE NOTHING IN COMMON BUT THE CEILING, which is why
      // no single wall-clock figure could separate them. Run 8 lost it in the
      // DRAFT — its interview matched run 11's to six seconds and its final
      // turn was already 51 s longer than a completed one when killed. Run 10
      // lost it in the INTERVIEW — a third answered round cost 62 s, and its
      // draft was cut 7 s SHORT of run 11's completed 386 s.
      //
      // Worst observed need = 216 s + >437 s = **>653 s against a 600 s
      // ceiling**: the old ceiling was never big enough for the worst case
      // anyone had seen, and `perTransition` could not help because `upTo`
      // outranks it (`beats.mjs:244` -> `beats-steps.mjs:44` — a progress bound
      // can only end a beat EARLIER). That is why 7.6.77 alone could not have
      // saved either run, and why the bound moved to the step.
      //
      // 480 000 ms is 24% over the longest COMPLETED turn (386 s) and clears
      // both killed turns. `upTo: 1_200_000` is a RUNAWAY STOP — ~1.8x the
      // worst observed need, 3x the longest completed turn — and is not a
      // figure this beat is expected to reach.
      wait: { for: 'agent', upTo: 1_200_000 },
      expect: {
        route: '/artifact',
        data: {
          'section': 'architect-plan',
          'architect-phase': 'committed',
          'gate-armed': 'false',
          // AMENDED 2026-09-11 (amend-10) — was `'gate'`, which this beat can
          // never see. `SessionArchitectPanel.tsx:147` builds the plan href as
          // `phase === 'awaiting-verdict' ? 'gate' : 'view'`, so APPROVING IS
          // WHAT ENDS GATE MODE — and this beat's last `do` step is
          // `{ press: 'approve-plan' }`. It was asserting the gate it had just
          // closed, beside `architect-phase: 'committed'`, which only exists
          // BECAUSE the gate closed. The two keys could not both hold.
          //
          // S1 run 3 proved the product right and the beat wrong, and said so
          // in the shape of the red: it named ONE token, `plan-mode`, which
          // means `architect-phase: 'committed'` and `gate-armed: 'false'`
          // both HELD. The approval worked. A red that names one of three keys
          // is reporting that the other two passed.
          //
          // Lane C measured the identical token on S10 beat 5 (run 4 red at
          // 10:55:32 while `status.json` had gone COMMITTED at 10:55:17.386 —
          // the approval had already landed); their amend-3 declared `'view'`
          // and beat 5 went green in 3.1 s.
          'plan-mode': 'view',
        },
      },
      say: 'The plan is approved and committed. An existing repo that forge knew nothing about half an hour ago is now an onboarded project with a contract, a demo, a knowledge profile and an approved roadmap — ready for a Factory to build.',
    },
];
