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
 * THE WORD `integrate`, AND WHY THIS FILE DOES NOT USE IT. 1.0.md's spec calls
 * the band `integrate`; ruling 383 renames `demo` → `integrate` across the
 * product as a lane-C filler. TODAY THAT WORD DOES NOT EXIST IN THE PRODUCT: a
 * case-insensitive search of `apps/studio` for `integrat*` finds only unrelated
 * English, and the live vocabulary is `demo-band` / `review-band`
 * (`lib/studio-client.ts:645-654`, confirmed live in `studio-client.test.ts`
 * :1343) with node ids `dev` · `demo` · `adversarial-review` · `review`
 * (`lib/flow-run-detail-render.test.ts:104-109`). A beat asserting a value the
 * product does not carry is red forever (§15.175/178/201), so beat 10 asserts
 * `demo` — the truth today — and the 383 PR must amend this beat in the SAME
 * PR that performs the rename (§15.183/204: a class fix goes to every beat that
 * carries it, in one amendment). This comment is the pointer that makes that
 * amendment findable.
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
import { IDEA, CEILING, SEND_BACK, PLAN_AND_BUILD_CEILING_MS } from './S10.constants.mjs';

export default {
  id: 'S10',
  // budget_usd is the exit row's ceiling (ruling 389). realSpawn because every
  // beat past 3 stands on a real agent.
  ground: { project: 'gitpulse', realSpawn: true, budget_usd: 35 },
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
      // THE CEILING IS DECLARED, NOT MEASURED — the only bound in this story
      // that is. No run has ever reached this station, so 20 minutes is chosen
      // as headroom against the Architect's measured 8m49s–10m52s for a smaller
      // pass. It is a 513/551-class figure and gets TIGHTENED from run 7's
      // measurement; leaving a guess in place once a real number exists is how
      // beat 4 cost run 3.
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
      // moves. CEILING: 6 minutes, DECLARED, basis = run 11's measured cycle at
      // 2m01s (`13:21:29.805` start → `13:23:30.644` cycle.end) with 3x headroom
      // for a decomposition that finds more work. Tightened from run 12's
      // measurement — a declared figure that survives a real one is a guess
      // nobody re-examined (513/551, and beat 4 cost run 3 exactly that).
      wait: { for: 'agent', anchor: 'scheduler-start', upTo: PLAN_AND_BUILD_CEILING_MS },
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
      // NO AGENT WAIT ANY MORE, and dropping it is the honest half of 718(4).
      // Beat 8 now waits until the initiative reaches `ready-for-review`, which
      // means the dev station has ALREADY run by the time this beat looks. A
      // declared 30-minute agent bound here would be a bound on work that
      // finished before the beat began — and in this campaign a declared bound
      // is a SPEND, not a decoration (513/551). What is left is an assertion on
      // the timeline the finished cycle wrote, under the default consequence
      // poll, which is what beat 10 has always done and what these three now
      // are: readers of history, not waiters on it.
      expect: {
        route: '/flows/forge-develop/run/<cycleId>',
        data: {
          page: 'flow-run',
          'run-found': 'true',
          'flow-id': 'forge-develop',
          'page-ready': 'true',
          'timeline-row': 'true',
          'node-id': 'dev',
        },
      },
      say: 'The dev station fans out over the work items the plan decomposed into. Each row on the timeline is a station with its own status and its own cost, so "what is it doing and what has it spent" is one screen, not an investigation.',
    },
    {
      // SOURCE-DERIVED — AND THE VALUE IS THE ONE RULING 383 RENAMES.
      // Today the node is `demo`: `lib/flow-run-detail-render.test.ts:104-109`
      // lists the real `forge-develop` node ids as dev · demo ·
      // adversarial-review · review, and a case-insensitive search of
      // `apps/studio` for `integrat*` finds NO product use. The spec's word is
      // `integrate`, and 383 makes that rename a lane-C filler. This beat
      // asserts what the product carries TODAY, because a beat asserting a
      // value the product does not carry is red forever (§15.175/178/201); the
      // 383 PR amends it in the same PR that renames the band (§15.183/204).
      act: 'The built work is assembled for review',
      expect: {
        route: '/flows/forge-develop/run/<cycleId>',
        data: { page: 'flow-run', 'timeline-row': 'true', 'node-id': 'demo' },
      },
      say: 'Between building and judging there is a step that puts the change together with the evidence for it — the diff, the acceptance criteria and what was actually demonstrated. The reviewer reads that, not a pile of commits.',
    },
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
        data: { page: 'flow-run', 'timeline-row': 'true', 'node-id': 'review' },
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
