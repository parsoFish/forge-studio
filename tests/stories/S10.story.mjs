/**
 * S10 — run the example factory to a merged PR from Studio (1.0.md §3 row S10,
 * promoted from `docs/product/user-stories.md` R-01; ruling 389).
 *
 * ******************************************************************
 * DRAFT — NOT PINNED. Ruling 404(a) puts S10 in draft-then-review
 * (S8/S9's precedent): this file is drafted unattended, and NOTHING is
 * pinned until the combined sitting (ruling 397). Every key below is
 * marked VERIFIED or SOURCE-DERIVED. Do not fund a run on it yet.
 * ******************************************************************
 *
 * Operator flow: the operator drops an idea on a real ground, answers the
 * architect's interview, confirms the change class at the plan gate, starts
 * development from the project's own roadmap, watches the run build, reviews
 * the result, sends ONE anchored comment back, sees the fix land, approves —
 * which IS the merge — reflects, and finds the theme on the knowledge graph
 * with a cost figure that equals the event log. Act 2 stops a run mid-flight
 * and resumes it without losing the work items already done.
 *
 * THE GROUND, CHECKED BEFORE THE IDEA WAS CHOSEN (§15.205). `gitpulse` at
 * `f69976f0` (`Merge pull request #16 … markdown-output-flag`), version
 * 0.15.0, method-C hash `e12d66d463e094eb`. `.forge/` holds `project.json` and
 * `demo` and NO work items, so the story starts from an idea and not from a
 * queued initiative. The pristine copy had been one merge behind its remote
 * since M5's close; T1 fast-forwarded it and this lane re-derived both the SHA
 * and the hash. `_1.0/stories/S10.md` records the check.
 *
 * THE IDEA, and why this one. `--exclude-author <pattern>`, the inverse of the
 * `--author` filter the ground already ships. Verified absent at THAT head:
 * `grep -rn 'exclude-author\|excludeAuthor' src/ README.md` returns nothing and
 * `src/author-filter.ts` exports only `AuthorFilterResult` and
 * `filterAuthorCommits`. It extends existing code rather than adding an island,
 * so the review has something to say; it carries exactly one genuinely risky
 * clause — what happens when `--author` AND `--exclude-author` are both given —
 * which is what "I'll gate the risky parts" means, what the plan gate confirms
 * the class of, and what the ONE send-back anchors to.
 *
 * ===================================================================
 * WHAT IS VERIFIED AND WHAT IS NOT — read this before trusting a key
 * ===================================================================
 *
 * A census of every `expect.route`, `expect.data` key, `press` and `fill` in
 * the eleven pinned story files was run BEFORE this file was written, so it
 * would reuse handles those files already assert rather than invent names.
 * The census decided how S10 can be authored at all:
 *
 *   VERIFIED — asserted by a pinned story, reused here unchanged:
 *     beats 1–5 (the project page, the idea drop, the interview, the plan
 *     gate). Sources named per beat.
 *
 *   SOURCE-DERIVED — read out of `apps/studio`'s own component source and its
 *     render tests, NOT from a live page and NOT from any pinned story:
 *     beats 6–14 and act 2. Every one is marked in its own comment with the
 *     `file:line` it came from.
 *
 * Nine of this story's beats fall in the second class, and that is not a
 * shortcut — it is a property of what S10 is. Beats 6–14 describe pages that
 * exist only WHILE a real gated run is in flight, which is the very run this
 * story's green pass is meant to be. They cannot be read off a live page in
 * advance the way S4's builder handles were, and that is precisely why ruling
 * 389 said "one attended sitting" in the first place. The sitting, or the
 * first funded run, turns each SOURCE-DERIVED key into a measured one —
 * exactly as S4 beat 4 was proven by a throwaway probe before it was trusted.
 *
 * THE TRAP THIS FILE AVOIDS. S6 beat 11 fills the idea and presses
 * `start-architect` while asserting the DESTINATION route
 * `/sessions/architect/<sid>`. S6's own comment records that as NOT expressible
 * — the press mints and then navigates, and `driveBeat` resolves `expect.route`
 * BEFORE the `do` steps run — and the beat is a known red. Beat 3 below takes
 * S2 beat 10's shape instead: it acts on the page it is standing on and binds
 * the session id there.
 *
 * THE WORD `integrate`. 1.0.md's spec calls the band `integrate`, and operator
 * item 85 renamed `demo` → `integrate` across the product with no alias. The
 * live vocabulary is now `integrate-band` / `review-band`, with node ids `dev`
 * · `integrate` · `adversarial-review` · `review`. Beat 10 asserts
 * `integrate`; it was amended in the SAME PR that performed the rename
 * (§15.183/204: a class fix goes to every beat that carries it, in one
 * amendment), so the story never asserted a value the product did not carry.
 *
 * ONE PRODUCT FINDING, RECORDED HERE AND IN `_1.0/stories/S10.md`. The same
 * destructive act has TWO different confirmation contracts. On the run-detail
 * surface, abandon is arm-then-confirm — a visible `[data-component=
 * "abandon-confirm"]` panel and a second press (`RunControls.tsx:141-146,
 * 225-249`). On the roadmap drawer, `recovery-abandon` POSTs on the first click
 * with no confirmation at all (`InitiativeDetail.tsx:106-107,311-313`;
 * `RoadmapCanvas.tsx:707-721`). Act 2 drives the run-detail surface, so it
 * expects the confirm step; a beat driving the drawer must not.
 */



import { ACT_2 } from './S10.act2.mjs';
import { REVIEW_LOOP } from './S10.review.mjs';
import { IDEA, CEILING, GROUND, CYCLE_BOUND } from './S10.constants.mjs';

export default {
  id: 'S10',
  // budget_usd is the exit row's ceiling (ruling 389). realSpawn because every
  // beat past 3 stands on a real agent.
  //
  // 7.6.118: declared in `S10.constants.mjs` now, because beat 8's bound is
  // DERIVED from this money and the ceiling the operator types is derived from
  // it too. One declaration, or the story runs to one number and is judged
  // against another.
  ground: GROUND,
  docs: { kind: 'tutorial', title: 'Run the example factory to a merged PR' },
  beats: [
    {
      // VERIFIED shape (S1 b3, S3 b2 assert `page`/`project-id`/`page-ready`
      // on `/projects/<id>`). The VALUES are gitpulse's own and are
      // SOURCE-DERIVED: no pinned story has ever opened `/projects/gitpulse`.
      act: 'Open the project forge already manages',
      expect: {
        route: '/projects/gitpulse',
        data: { page: 'projects', 'project-id': 'gitpulse', 'page-ready': 'true' },
      },
      say: 'This is the ground the whole story stands on: a real CLI with a real test suite, already onboarded, already merged through once. Nothing here is seeded — the roadmap, the history and the contract are what the previous cycles left behind.',
    },
    {
      // VERIFIED — S2 b9 asserts exactly these five keys after this press.
      act: 'Press "Architect →"',
      do: [{ press: 'start-work-architect' }],
      expect: {
        route: '/architect/new',
        data: {
          page: 'architect-new',
          'page-ready': 'true',
          section: 'new-idea',
          'roster-state': 'ok',
          'new-idea-ready': 'false',
        },
      },
      say: 'The operator has a feature in mind and no plan for it. That is what the Architect is for, and it is the only entry point in the product that starts from a sentence rather than from an initiative that already exists.',
    },
    {
      // VERIFIED — S2 b10's shape exactly: act on the page being stood on and
      // bind the id THERE. See the header's note on S6 b11's known red.
      act: 'Describe the work, cap what this run may spend, and press "Start architect"',
      do: [
        { fill: 'idea', with: IDEA },
        { fill: 'cost-ceiling-usd', with: CEILING },
        { press: 'start-architect' },
      ],
      expect: {
        route: '/architect/new',
        data: {
          page: 'architect-new',
          section: 'new-idea',
          'architect-session-id': '<architectSessionId>',
        },
      },
      say: 'The ceiling is set before the work starts, not discovered afterwards. Pressing Start mints a session and names it on the page the operator is standing on, so the run is nameable before anything navigates.',
    },
    {
      // VERIFIED — S2 b12 / S4 b11: the repeat, the `until`, and the stated
      // bound. The architect decides how many rounds it needs
      // (`bridge-studio-architect.ts:380` increments `round` per submission),
      // so a fixed number of fills cannot answer a variable interview.
      act: 'Open the session and answer the Architect\'s questions',
      do: [
        // `view-architect-session`, NOT `open-session` — T1 ruling 532, bought by
        // run 2. `open-session` is the LIST surfaces' handle (Home's session
        // strip, the sessions index, the plan gate). The page that MINTS a
        // session publishes the architect family's own handle through
        // `SessionMinted.tsx:24` (`data-action={`view-${kind}-session`}`,
        // mounted at `NewIdeaBox.tsx:207` as `kind="architect"`), and the DOM
        // contract names that family. Pressing the list handle on the mint page
        // spent this beat's full 600 000 ms on a control that page never had.
        { press: 'view-architect-session' },
        {
          repeat: [
            {
              fillAll: 'question-freetext',
              with:
                'The gate command is `npm test`. Exclude wins over include when both are given — ' +
                'say so in the header annotation. Breaking the existing human-readable output is ' +
                'not acceptable; the new flag is additive, like --author was.',
            },
            { press: 'submit-answers' },
          ],
          // Row 108: the architect now also passes through `critiquing`/`revising` before `awaiting-verdict`; `until` is unchanged.
          until: { 'session-phase': 'awaiting-verdict' },
        },
      ],
      // 30 MINUTES, MEASURED (T1 rulings 551 / 558). This declared 600 000 ms
      // and run 3 died on it: `answered 1 round(s) and this beat's declared
      // bound (600000 ms) ran out before its `until``.
      //
      // Run 2's OWN evidence already said ten minutes was too few — its
      // architect started at 05:08:49 and reached `awaiting-verdict` at
      // 05:27:07, EIGHTEEN minutes — and that figure was written into run 2's
      // outcome and its evidence README before run 3 was funded. A $35 run
      // bought a fact that was already on disk. The number here is measurement
      // plus headroom, not a guess.
      //
      // Not comparable to the 2–3 minute `architect` phase in `_1.0/traces/`:
      // those are non-interactive, out-of-cycle architects. This beat drives the
      // interactive interview-and-draft session, which is a different thing that
      // waits on an operator between rounds.
      // 18 MINUTES, AND THIS ONE IS MEASURED (T1 ruling 625, 513/551 class).
      // Five runs have now timed this beat: 8m49s · 10m52s · 11m43s and two
      // earlier, and the longest GREEN was 11.7 min. 18 = 11.7 x 1.5, so the
      // bound is headroom over the worst measurement rather than over a guess.
      // It was 30 minutes, set from run 3's 18-minute architect BEFORE any of
      // those greens existed; leaving a guess in place once a real number
      // exists is how beat 4 cost run 3 in the first place.
      //
      // The spread is the reason for 1.5x rather than 1.2x: 8m49s to 11m43s on
      // an UNCHANGED head and ground, so the architect varies by ~3 minutes
      // run to run and the bound has to cover the range, not the median.
      wait: { for: 'agent', upTo: 1_080_000 },
      expect: {
        route: '/sessions/architect/<architectSessionId>',
        data: {
          page: 'session',
          'page-ready': 'true',
          'session-kind': 'architect',
          'session-phase': 'awaiting-verdict',
        },
      },
      say: 'The interview is where the operator\'s one sentence becomes something buildable. The answers are not decoration — the precedence rule stated here is the clause the review will come back to.',
    },
    {
      // VERIFIED for the gate itself — S1 b11 asserts every key here and
      // presses `approve-plan`. NOT VERIFIED: "the class confirmed". No
      // `class`-shaped data key is asserted by any pinned story, and the census
      // found none in the corpus. The beat therefore asserts the gate state it
      // can prove and SAYS what the operator read; the class handle is an open
      // item in `_1.0/stories/S10.md` for the sitting.
      act: 'Read the plan at the gate and approve it',
      do: [{ press: 'open-plan' }, { press: 'approve-plan' }],
      expect: {
        route: '/artifact',
        data: {
          section: 'architect-plan',
          'architect-phase': 'committed',
          'gate-armed': 'false',
          // `view`, not `gate` — T1 ruling 570, measured by G1/S10 run 4.
          //
          // This beat APPROVES the plan, and approving is what ends gate mode:
          // `SessionArchitectPanel.tsx:147` builds the plan href as
          // `phase === 'awaiting-verdict' ? 'gate' : 'view'`, so the two keys
          // below could never both hold — `architect-phase: committed` is the
          // post-approval phase and `plan-mode: gate` was the pre-approval one.
          // The beat was asserting the gate it had just approved at.
          //
          // Run 4's timeline shows the product was right throughout: beat 4
          // green at 10:55:16.757, `approve-plan` enabled at 10:55:16.9,
          // `status.json` COMMITTED at 10:55:17.386 — the approval WORKED — and
          // the beat then red at 10:55:32.185 on this one token.
          'plan-mode': 'view',
        },
      },
      say: 'This is the first of the two human gates. The operator reads what will be built and what it will touch, and approving arms the work — the plan is committed and the gate is no longer waiting on anyone.',
    },
    {
      // NAVIGATION-ONLY (T1 ruling 533, the 504 class: `route` plus
      // `page`/`page-ready`, nothing else). `performSteps` runs BEFORE the
      // route wait and before real-nav, so the beat that follows would press
      // its control while still standing on the page this beat leaves — and
      // spend its whole bound on a control that page does not carry. Run 2
      // measured that shape at 600 000 ms on beat 4 and 900 000 ms twice more.
      // Reached by the artifact page's own breadcrumb
      // (`app/artifact/page.tsx:953`, `data-crumb="project"`), one hop.
      // `project-tab-roadmap` lives on `/projects/[id]` (`ProjectTabs.tsx:47`,
      // a template-literal handle) and nowhere else.
      act: 'Go back to the project the plan belongs to',
      expect: {
        route: '/projects/gitpulse',
        data: { page: 'projects', 'page-ready': 'true' },
      },
      say: 'The plan is approved. The operator goes back to the project to start the work it planned.',
    },
    {
      // T1 ruling 622, bought by G1/S10 run 7. THE ENQUEUE WORKED AND NOTHING
      // CLAIMED IT. Beat 7 spent its full 20-minute ceiling with
      // `data-plan-state` never leaving `unplanned` — not even reaching
      // `planning` — because `POST /api/initiatives/:id/plan` "repoints the
      // manifest at forge-architect + threads its cycle_id, then THE SCHEDULER
      // CLAIMS IT" (`lib/bridge-client.ts:670-680`), and no scheduler was
      // running. Measured, not inferred: no PM run dir under `_logs/` at all,
      // `_queue/in-flight/` and `_queue/done/` both empty, and every manifest
      // still sitting in `_queue/pending/` with its mtime moved by the press.
      //
      // THE PRODUCT SAYS SO AND THE STORY DID NOT LISTEN.
      // `data-needs-scheduler-start` is published on `EnqueueOutcomeLine.tsx:69`
      // and `ArchitectCommittedView.tsx:20`, and the Start control is right
      // there on this page — `<SchedulerCard variant="strip">`,
      // `app/projects/[id]/page.tsx:1228`. Pressing it is the operator's real
      // path; having the harness start it silently would hide a state the
      // product deliberately shows.
      //
      // SOURCE-DERIVED, AND THE STATE MACHINE MATTERS HERE.
      // `lib/scheduler-view.ts` gives each status its own action list:
      //   `stopped`  → ['start']            ← the only state carrying this handle
      //   `running`  → ['pause', 'stop']
      //   `paused`   → ['resume', 'stop']
      //   `unknown`  → []   (status not yet read from the bridge — a transient
      //                      on first paint, which is why the press waits for
      //                      the handle rather than assuming it)
      // So `scheduler-start` EXISTS ONLY WHILE THE SCHEDULER IS STOPPED. If a
      // previous run left one running, this beat reds at t+0 on a missing
      // handle while the state it wants already holds. That is a residue
      // hazard, not a product defect: the preflight re-hashes the ground and
      // must also leave no scheduler running.
      //
      // THIS COMMENT USED TO SAY the preflight "clears `_logs/_agent-*`". It
      // never did — `reap.mjs` reaps PROCESSES by pid and deletes no directory,
      // and `sweep.mjs` had no `_agent-*` rule at all. The sentence described the
      // system as it ought to be and was read as a description of what it was.
      // The reusable half, C's words: A COMMENT THAT DESCRIBES AN INTENTION AS
      // A FACT IS A CLAIM NOTHING CHECKS, and it outlives everyone who knew it
      // was aspirational. Its author believed it on re-reading too.
      // `forge-8vfn.7.6.24` makes the leading sweep claim them for real; until
      // that landed, S5 run 3 met run 2b's dir and a beat that had been red all
      // campaign went GREEN by reading a different run's row (T1 ruling 716(ii)).
      // `_queue/pending/` is the same class (run 7's `queue-residue.md`).
      // AMEND-6, bought by run 8 at twelve seconds of act bound and a whole
      // beat. `scheduler-start` was absent and I called the product wrong
      // before the evidence did: `/api/scheduler/status` answered
      // `{"running":false}` live during the run, which `scheduler-view.ts`
      // maps to `stopped` → actions `['start']`. The button was renderable.
      //
      // It is on the ROADMAP TAB. `<SchedulerCard variant="strip">` lives at
      // `app/projects/[id]/page.tsx:1228`, inside the block rooted at
      // `data-section="project-roadmap"`, three lines above the Plan and
      // Start-development controls — and the project page opens on
      // `useState<ProjectTab>('editor')` (`:104`). The beat below has pressed
      // `project-tab-roadmap` first all along, for exactly this reason.
      //
      // I verified the handle EXISTS and that its state was reachable, and
      // never verified WHERE IT RENDERS (§15.358). Existence is not
      // reachability from the page the beat is standing on, and only the
      // second is what a beat asserts.
      act: 'Start the scheduler so queued work can be claimed',
      do: [{ press: 'project-tab-roadmap' }, { press: 'scheduler-start' }],
      expect: {
        route: '/projects/gitpulse',
        data: { page: 'projects', 'project-id': 'gitpulse', 'scheduler-status': 'running' },
      },
      say: 'Planning and building are done by a scheduler that claims queued work. Nothing the operator enqueues moves until it is running, and the product says so plainly rather than leaving the work to sit — so starting it is part of the journey, not setup hidden behind it.',
    },
    {
      // T1 ruling 604, bought by G1/S10 run 6. THE STORY WAS MISSING A STATION.
      //
      // Run 6 reached here and died on `start-work-develop` being present but
      // DISABLED, carrying the product's own reason: "the ready initiatives are
      // not planned yet — Plan first" (`lib/start-work-view.ts:88-95`). A PLAN
      // AND AN INITIATIVE ARE TWO DIFFERENT OBJECTS. Approving the Architect's
      // plan is what MINTS the initiative — run 6's session ended
      // `"phase": "committed"` and produced exactly one manifest — and planning
      // THAT initiative, decomposing it into work items, is a separate pass.
      // `planDisabledReason` was null throughout, so the product's path was
      // enabled beside the disabled button the whole time: the flow was right
      // and the story was wrong.
      //
      // WHY THE CONSEQUENCE IS `plan-state`, NOT THE OUTCOME LINE. Pressing Plan
      // ENQUEUES: `POST /api/initiatives/:id/plan` "repoints the manifest at
      // forge-architect + threads its cycle_id, then the scheduler claims it"
      // (`lib/bridge-client.ts:670-680`). So `data-start-work-outcome="ok"`
      // means the enqueue succeeded, NOT that planning is done — asserting it
      // would let the next beat press Develop while the pass was still running
      // and reproduce run 6's red with a different message. The roadmap node
      // publishes the real state: `data-plan-state`, whose vocabulary is
      // `planned | planning | error | needs-confirm | unplanned`
      // (`RoadmapCanvas.tsx:101-112`, `:578`). `waitForConsequence` polls the
      // declared keys until they hold, so `planned` is what makes this beat wait
      // out the pass rather than race it.
      //
      // THE CEILING WAS DECLARED, NOT MEASURED, and run 17 finally reached this
      // station to prove what that cost: the window funded $3.02 against a
      // cycle that spent $3.99 and finished 116 s after the beat gave up
      // (§15.559). It is derived from the story's own funding now, not chosen.
      act: 'Watch the factory plan and build the initiative',
      // NO PRESS. The daemon beat 7 started has already claimed this
      // initiative — run 11 measured the claim at `13:21:29`, with the cycle
      // dir born `13:21:29.798`, **449 ms BEFORE beat 7's own green at
      // 13:21:30.247**. There is nothing for the operator to press; the factory
      // is already running, and a press here asserts the operator doing what
      // the factory did.
      do: [],
      // ANCHORED ON BEAT 7'S PRESS (718(1)). The door searches `_logs/` for a
      // dispatch born since a moment the caller names, and that moment used to
      // be the wait's own start — correct for a press that dispatches its OWN
      // work, and wrong here by half a second. Run 11 reded `no-channel:
      // nothing under _logs/ was created by this press` about a cycle that
      // reached `cycle.end` sixty seconds before the beat gave up.
      //
      // The BOUND still runs from this wait's start; only the search window
      // moves.
      //
      // THE BOUND IS NO LONGER WHAT DECIDES THIS BEAT (7.6.118, T1 1089(c)).
      // The wait ENDS on the cycle's own terminal event — the product moving
      // this initiative out of `_queue/in-flight/` — so a cycle that finishes
      // is seen the instant it finishes, whether or not its channel has gone
      // quiet, and a cycle that terminates into `failed` reds here immediately
      // instead of sitting out the rest of the bound waiting for a state the
      // product has already ruled out.
      //
      // WHAT THE BOUND IS NOW: the outer backstop for a cycle that never
      // terminates at all, DERIVED from `ground.budget_usd` at run 17's
      // measured burn and then bound by `MAX_DECLARED_WAIT_MS`. Both figures
      // travel in `boundBasis` and the label names which one bound it — run
      // 17's red printed `declared 360000 ms` and that bare integer is why its
      // first readers believed the product had stalled when it had succeeded.
      wait: {
        for: 'agent', anchor: 'scheduler-start',
        // The product's own word for "this cycle is done", read from the queue
        // rather than from the card: run 17 reached it at 22:46:55 while this
        // beat had already given up at 22:44:59 asserting the card alone.
        terminal: 'ready-for-review',
        upTo: CYCLE_BOUND.ms,
        boundBasis: CYCLE_BOUND.label,
      },
      expect: {
        route: '/projects/gitpulse',
        // `needs-scheduler-start` IS GONE — amend-6, and it never worked.
        // 622 added it so a scheduler-less environment would "red in seconds
        // instead of burning the bound in silence". Run 8 returned
        // `expected "false", ABSENT from the page`: the attribute is published
        // by `EnqueueOutcomeLine.tsx:69` and `ArchitectCommittedView.tsx:20`,
        // neither of which is on the roadmap tab this beat stands on. Same
        // mistake as beat 7 above — the attribute exists in the product and
        // not on this page (§15.358).
        //
        // It could not have failed fast even where it renders:
        // `waitForConsequence` waits for ALL declared keys until the deadline,
        // so one key that can never hold still costs the whole bound. THE DOOR
        // IS THE FAIL-FAST NOW — ruling 640 put the channel door in that same
        // wait, so a press that dispatches nothing ends at the 180-second
        // stall ceiling with `no-channel`, three minutes instead of twenty.
        //
        // AMEND-7 (T1 690/696). `plan-state: 'planned'` NOW MEANS WORK ITEMS
        // EXIST. It did not when this beat was written, and run 10 paid to find
        // that out: `planStateAttr` read `unplanned = status === 'pending' &&
        // !planned` and returned `'planned'` for anything that was merely no
        // longer pending — so the SCHEDULER'S CLAIM, 288 ms after beat 7 started
        // it, flipped this key green on an initiative nothing had planned. The
        // PM had been running for 0.48 s and would not write its first file for
        // another ten seconds; it was killed mid-decomposition and never wrote a
        // work item at all. The beat passed anyway.
        //
        // D's `forge-8vfn.7.6.21` (#649, `c12ea4f6`) made the attribute mean
        // what this beat always needed: `planned` iff work items exist, and a
        // claimed-but-unplanned initiative reads `planning`. So the SAME
        // assertion is now the Plan station's real measurement instead of a race
        // the claim wins — §15.386, verify what makes an attribute TRUE, not
        // that it reads true.
        // BOTH KEYS, on the same node (T1 720). `plan-state` is NOT dropped:
        // I had written here that `planned` is a state the daemon runs straight
        // through and is catchable only by luck. **That was wrong, and I wrote
        // it while correcting a previous inversion.** D's read of the product
        // settles it — `RoadmapCanvas.tsx:563`:
        //
        //   planPhase = workItems !== undefined ? 'planned'
        //             : status === 'in-flight'  ? 'claimed'
        //             : 'pending'
        //
        // and `planStateAttr:103` returns `planned` FIRST. So `planned` is the
        // RESTING state — it holds for as long as work items exist — and
        // `planning` is the transient. The beat asserts the resting state of a
        // finished cycle, which is exactly what it should have been doing all
        // along.
        //
        // THE THREE WAYS THIS REDS, so a future red is diagnosable from the
        // line rather than from a trace:
        //   `planning`   — claimed, PM has not written its work items yet.
        //   `unplanned`  — past in-flight with no WI snapshot. NOT `planning`:
        //                  `claimed` requires `status === 'in-flight'`.
        //   stale        — the DOM value is older than the manifest's mtime.
        //
        // RUN 11 HIT THE THIRD, and it is worth the bytes because it is the one
        // nobody predicted. At the red (`13:24:30.590`) the card read
        // `planning`, which by `:563` requires `workItems === undefined`. But
        // `_logs/<cycle>/work-items-snapshot/WI-1..3.md` were on disk at
        // `23:23:30.621` and the manifest had been in `_queue/ready-for-review/`
        // since `23:23:30.604` — **sixty seconds earlier**. The data the
        // attribute derives from existed a full minute before the attribute was
        // read. That is staleness in the roadmap refresh, not a planning
        // failure, and the beat reded about the wrong thing entirely.
        //
        // What the factory actually leaves behind is the initiative's STATUS.
        // `bridge-studio.ts:893` maps `_queue/ready-for-review/` →
        // `'ready-for-review'`; `RoadmapCanvas.tsx:561` destructures `status`
        // off the initiative and `:576` publishes it as
        // `data-initiative-status`. Run 11's manifest ended in
        // `_queue/ready-for-review/` with its worktree preserved on
        // `forge/INIT-2026-09-11-exclude-author-flag`, so this is the state the
        // run really reaches — read from the product, cited, not guessed (718(2)).
        // `<runId>` BINDS HERE, and it has to: the beat that used to bind it —
        // "Open the roadmap and start development" — is dropped, because the
        // daemon had already started development. Every later beat routes on
        // `/flows/forge-develop/run/<runId>`, and the story-file validator
        // caught the dangling placeholder before any run did, which is the
        // check earning its keep.
        //
        // IT BINDS FROM `initiative-id`, and the basis is the product's own
        // line: `RoadmapCanvas.tsx:74` says the success line links THAT run as
        // `/flows/<flowId>/run/<initiativeId>` — for a develop cycle the run
        // route is keyed on the INITIATIVE, not on the stamped cycle id (run
        // 11's cycle log dir was `2026-09-11T13-21-26_INIT-…`, a different
        // identifier that belongs to the log and not to the route).
        //
        // DECLARED, NOT YET MEASURED THROUGH THIS PATH. Run 11 never reached
        // the run page, so no run has yet proved the binding end to end; beat 9
        // asserting `run-found: 'true'` is what will, and if it reds on a
        // missing run the binding is the first suspect rather than the product.
        data: {
          page: 'projects', 'project-id': 'gitpulse',
          'initiative-status': 'ready-for-review', 'plan-state': 'planned',
          'initiative-id': '<runId>',
        },
      },
      say: 'Starting the scheduler was the operator\'s last act for a while. The factory claims the initiative, decomposes it into work items, builds them and stops at the review gate — unattended, and faster than the operator could have driven it. What the operator does next is not start the work; it is READ it.',
    },
    {
      // 7.6.54 / ruling 795 — THE BEAT THAT MAKES THE RUN REACHABLE.
      //
      // Beats 10-21 used to route to `/flows/forge-develop/run/<runId>` from
      // `/projects/gitpulse` and every one of them reded with "no real-nav path
      // to the run page". TWO separate defects, both measured on run 13:
      //
      //   1. the roadmap node had no `data-action`, so a `press` could not open
      //      the drawer where the run link lives (D's 7.6.39 added
      //      `open-initiative-<initiativeId>`);
      //   2. the run route is keyed by CYCLE id, never by initiative id
      //      (`studio-dom-contract.md:2845`), so `<runId>` named a route that
      //      does not exist.
      //
      // This beat fixes both: it presses the node's handle — built at run time
      // from `<runId>`, which is why `pressBound` had to exist at all — and
      // binds `<cycleId>` off the drawer's own link. A beat cannot bind the
      // placeholder its own route needs, so the binding happens HERE and the
      // routing happens in the beats that follow.
      //
      // `data-run-active="true"` means NEWEST, NOT RUNNING
      // (`cycle-grouping.ts:48-62` sorts by cycle id and takes the head; it is
      // not a liveness check). It is declared ALONGSIDE `run-cycle-id` because
      // the drawer renders one link per cycle: the two keys together pick the
      // single record to bind from, where `run-cycle-id` alone would be
      // ambiguous the moment a second cycle exists.
      act: 'Open the initiative to find the run it produced',
      do: [{ pressBound: { action: 'open-initiative-', bind: 'runId' } }],
      expect: {
        route: '/projects/gitpulse',
        data: {
          page: 'projects', 'project-id': 'gitpulse',
          'run-active': 'true',
          'run-cycle-id': '<cycleId>',
        },
      },
      say: 'The card says the work is ready for review. The operator opens it to reach the run itself — and the drawer names the cycle that produced it, which is the handle everything downstream is keyed by. The initiative is what was asked for; the cycle is what actually ran.',
    },
    {
      // `forge-8vfn.7.6.124` — THE BEAT THAT WAS MISSING FOR EIGHTEEN RUNS.
      //
      // Every S10 run to date asserted the developer's output without ever
      // starting the developer. `forge-architect` ENDS after the project-manager
      // BY DESIGN — its `ready-for-review` means THE PLAN is ready for the
      // operator, the first of the three human interaction points — and
      // `forge-develop` (dev -> demo -> adversarial-review -> review) is a
      // SEPARATE flow the operator starts. DEC-3: "Architect decomposes; Develop
      // builds." The architect declares no `on: flow-complete` chaining, so
      // nothing hands over on its own.
      //
      // RUN 18 IS WHY THIS IS HERE AND NOT A GUESS. Beat 8 passed for the first
      // time (7.6.118), the cycle reported `ready-for-review` with ERRORS
      // RECORDED 0 and three work items written, and the phase census read
      // `developer 0`. The story had been asserting a station it never asked
      // anyone to run. It was NOT the budget: run 17 stopped at the same place
      // with 67% of a $12.00 budget untouched and no cost-warn at all.
      //
      // WHY BOTH FLOWS LOOK ALIKE, which is how this survived eighteen runs:
      // they terminate in the SAME WORD. `ready-for-review` means "plan ready"
      // here and "PR open" after develop, and report.md does not distinguish
      // them.
      //
      // NO CONFIRMATION IS EXPECTED ON THIS PATH, and asserting the outcome line
      // is how that gets checked. `enqueue-develop-run.ts` passes
      // `DEVELOP_HANDOFF_SOURCE_FLOWS = ['forge-architect']` as
      // `allowRepointFrom`, so architect -> develop is the designed lifecycle
      // transition and is auto-authorised; anything else "is a repoint like any
      // other and gets the refusal". The DOM contract makes the two mutually
      // exclusive — a refusal renders `[data-component="repoint-confirm"]`
      // INSTEAD, and "the control that RAISED a confirmation is not rendered
      // beside it". So an `enqueue-outcome` carrying `develop` IS the assertion
      // that no confirmation was required, and the day that changes this beat
      // reds without a second assertion needed to notice.
      act: 'Hand the plan to the build flow',
      do: [{ press: 'start-development' }],
      // 7.6.143 (T1 1147). `cycleOf`, NOT the anchor form, because THE DEVELOP
      // STATION CONTINUES THE ARCHITECT'S CYCLE — DEC-2 threads one `cycle_id`
      // through the kickoff. The anchor form asks "which dispatch dir was born
      // since the press", right when a press MINTS a cycle and wrong here.
      // Run 20: dir born 20:21:58.902, press anchored 20:26:22.301, nothing
      // born since, so a THIRTY-MINUTE wait completed in 231 ms and this beat
      // reported GREEN while the developer ran four minutes unwatched. Beat 11's
      // old comment argued that was impossible, on the premise that the develop
      // cycle mints its own dir. It does not. I wrote that premise; it was false.
      // `<runId>` is the initiative bound at beat 9, and the cycle dir is
      // `<timestamp>_<initiative>`, so identity resolves it at any birth time.
      wait: {
        for: 'agent', anchor: 'start-development',
        terminal: 'ready-for-review',
        cycleOf: '<runId>',
        upTo: CYCLE_BOUND.ms,
        boundBasis: CYCLE_BOUND.label,
      },
      expect: {
        route: '/projects/gitpulse',
        data: {
          page: 'projects', 'project-id': 'gitpulse',
          // `EnqueueOutcomeLine.tsx`, per the DOM contract's W7-A3 entry:
          // `[data-component="enqueue-outcome"][data-enqueue-kind="plan"|"develop"]`.
          // The KIND is the load-bearing half — a `plan` here would mean the
          // press landed on the wrong control of a drawer that renders both.
          'enqueue-kind': 'develop',
        },
      },
      say: 'The architect has planned and stopped, which is where it is meant to stop — the plan is the first thing a human is asked to approve. Starting development is a separate act, and this is the operator making it: the same initiative, repointed from the flow that decomposed it to the flow that builds it.',
    },
    {
      // SOURCE-DERIVED. `FlowRunDetail.tsx:121-127` (page/run-id/run-found/
      // run-status/flow-id/page-ready), corroborated by
      // `lib/flow-run-detail-render.test.ts:180-191`. The node id `dev` and the
      // per-row keys are `FlowRunDetail.tsx:282-285`, corroborated at
      // `flow-run-detail-render.test.ts:231-236,247-249`.
      act: 'Watch the run build',
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
      // THE WAIT IS BACK, AND 7.6.124 IS WHY THE OLD REASONING WAS WRONG. This
      // comment used to read "beat 8 now waits until the initiative reaches
      // ready-for-review, which means the dev station has ALREADY run by the
      // time this beat looks." It has not, and never had: beat 8 watches the
      // ARCHITECT cycle, which ends after the project-manager. Run 18 proved it
      // — beat 8 green, this beat red on `data-status: expected "complete", got
      // "pending"`, census `developer 0`. Fourteen red beats, one cause.
      //
      // So this waits on the DEVELOP cycle's own terminal event, anchored on the
      // press that started it, with 7.6.118's door rather than a wall clock —
      // the same instrument and the same argument as beat 8, one flow over.
      //
      // THE STALE-TERMINAL HAZARD, named because both flows end in the same
      // word: at the moment `start-development` is pressed the initiative is
      // ALREADY in `_queue/ready-for-review/` from the architect cycle, and a
      // terminal read landing there would pass instantly on the PREVIOUS cycle's
      // verdict. It cannot, and ORDERING is what prevents it rather than luck:
      // `makeCycleTerminalWatch` resolves its channel with
      // `newestChannelSince(anchor)`, so it has nothing to read until a dispatch
      // dir exists — and a dispatch dir exists only once the scheduler has
      // CLAIMED the initiative, which requires it to have been repointed into
      // `_queue/pending/` first. Dispatch dir implies already left
      // ready-for-review; `beats-cycle-terminal.test.ts` states that as its own
      // door so the ordering cannot quietly change underneath this beat.
      // 7.6.143 (T1 1147) — THE WAIT MOVED TO THE BEAT THAT PRESSES.
      //
      // It used to sit here, and it could never run. This beat presses nothing,
      // so nothing navigates; it expects a route the previous beat does not
      // leave the page on, so `routeMatches` is false and the consequence wait
      // never fires. Run 20 measured it: this beat asserted 0.4 s after the
      // press, red, and fourteen later beats cascaded from it. `story-file.mjs`
      // now REFUSES that shape at validation, before a run is ever funded.
      //
      // The wait now lives on beat 10 with `cycleOf`, because the develop
      // station CONTINUES the cycle the architect minted rather than minting
      // one — so by the time this beat looks, the cycle it describes has
      // actually terminated.
      expect: {
        route: '/flows/forge-develop/run/<cycleId>',
        data: {
          page: 'flow-run',
          'run-found': 'true',
          'flow-id': 'forge-develop',
          'page-ready': 'true',
          'timeline-row': 'true',
          'node-id': 'dev',
          // §15.473 — ROW PRESENCE IS A PROPERTY OF THE FLOW DEFINITION,
          // NOT OF THE RUN. `lib/flow-run-timeline.ts:104` is `status:
          // run.phases[node.id] ?? 'pending'`, and that file's header says
          // rows include every declared node the run never touched — so
          // `timeline-row` + `node-id` alone green on a cycle that stopped at
          // the PM, which is run 14's shape exactly. Nine runs read these as
          // "the station ran" and they never said that (D's 7.6.61).
          //
          // ASSERTED BY VALUE, not as `!== 'pending'`: a QUEUED node also
          // reads `pending`, so the negative form cannot tell "not started"
          // from "never will". `RunPhaseStatus` is
          // 'pending'|'active'|'complete'|'retrying'|'failed'
          // (`studio-client.ts:47`).
          //
          // THE KEY BINDS TO THE ROW, not to the page: the root publishes
          // `data-run-status`, NOT `data-status` (`FlowRunDetail.tsx:124`), so
          // there is no root shadow, and `beats-page.mjs:308`'s together-rule
          // demands ONE element carrying and answering all of
          // `timeline-row`/`node-id`/`status` — the row at
          // `FlowRunDetail.tsx:282-284`. The status dot at `:300` carries
          // `status` alone and can never satisfy all three.
          'status': 'complete',
        },
      },
      say: 'The dev station fans out over the work items the plan decomposed into. Each row on the timeline is a station with its own status and its own cost, so "what is it doing and what has it spent" is one screen, not an investigation.',
    },
    {
      // SOURCE-DERIVED. The `forge-develop` node ids are dev · integrate ·
      // adversarial-review · review (`lib/flow-run-detail-render.test.ts`). The
      // node was `demo` until operator item 85 renamed it; this beat was
      // amended in the same PR as the rename (§15.183/204), so it asserts the
      // value the product carries (§15.175/178/201).
      act: 'The built work is assembled for review',
      expect: {
        route: '/flows/forge-develop/run/<cycleId>',
        data: { page: 'flow-run', 'timeline-row': 'true', 'node-id': 'integrate', 'status': 'complete' /* §15.473: the row exists for an untouched node too */ },
      },
      say: 'Between building and judging there is a step that puts the change together with the evidence for it — the diff, the acceptance criteria and what was actually demonstrated. The reviewer reads that, not a pile of commits.',
    },
    ...REVIEW_LOOP,
    {
      // SOURCE-DERIVED. `data-action="open-reflect"` (`app/artifact/page.tsx
      // :1194`, named in that file's own comment at :1177),
      // `data-action="submit-reflection"` (`ReflectionGate.tsx:297`),
      // `data-section="reflect-done"` (`:165`). NOT ONE of these is
      // corroborated by any test file — a repo-wide grep for
      // `reflect-questions`, `reflect-done` in `*.test.ts` returns zero hits.
      act: 'Reflect on the cycle',
      do: [{ press: 'open-reflect' }, { press: 'submit-reflection' }],
      wait: { for: 'agent', upTo: 900_000 },
      expect: { route: '/artifact', data: { section: 'reflect-done' } },
      say: 'The cycle ends by writing down what it learned. This is the step that makes the next cycle cheaper, and it is one shot — the operator confirms what the reflector inferred rather than filling in a form.',
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
    ...ACT_2,
  ],
};
