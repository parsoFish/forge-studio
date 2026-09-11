/**
 * S9 — do all of the above through the assistant (1.0.md §3, row S9).
 *
 * Operator flow: every one of S1-S8 is a thing the operator can do with their
 * own hands in Studio. S9 is the same work handed to the sessions spine
 * instead — the operator says what they want, picks what the run costs and
 * what it runs on, and reads back what it spent. Authored 2026-08-30 against
 * `parsoFish/main` d8d9df73, with the operator (H6), in the amended
 * draft-then-review mode. Green expected at M6 — later than every other
 * story, so this one is expected to red early and stay red longest.
 *
 * S9 IS THE ONE STORY WHOSE SUBJECT IS THE OTHER EIGHT, and the discipline
 * that follows from that is: do not re-author their flows here. S7 already
 * pins what authoring a library component looks like; S1 already pins what
 * onboarding a project looks like. This story takes the assistant-driven
 * variant of TWO of them — chosen with the operator on 2026-08-30 — and
 * asserts only the three things §3's row names that belong to S9 and to
 * nothing else:
 *
 *     "the operator asks the sessions spine to do it; SDK / model / effort
 *      are set per session; cost is recorded and shown"
 *
 * One clause per group of beats. **SDK / model / effort set per session** —
 * beats 5 and 11. **Cost recorded** — beat 8. **Cost shown** — beats 13-14.
 * Everything else in the story exists to get honestly to those five beats.
 *
 * WHY TWO VARIANTS AND NOT ONE. Beat 5 takes the `authoring` kind, whose
 * kickoff renders `data-model-tier-picker="range"` — the operator really does
 * choose. Beat 11 takes the `onboarding` kind, whose kickoff renders
 * `data-model-tier-picker="fixed"` and a read-only
 * `[data-field="kickoff-model-fixed-chip"][data-model-tier="sonnet"]` — the
 * operator chooses nothing, and widening the range is a SKILL.md edit rather
 * than a UI decision. Both read live. A story that took only the `authoring`
 * kind would report §3's clause as kept; taking both is what makes it
 * measurable that it is kept for some kinds and not others.
 *
 * GROUND. `mdtoc` — the one project committed to this repo, so it is the only
 * project a CLEAN CHECKOUT has, and it is the only option in either kickoff's
 * own `[data-field="kickoff-project"]` select (read live: `|mdtoc`). Both
 * kickoffs end in a REAL dispatch, so `realSpawn` is true and `budget_usd` is
 * declared ($25, approved by the operator 2026-08-30 for this batch); the
 * runner refuses to start without `--approve-spend` (H2).
 *
 * THIS STORY WILL ACTUALLY SPEND, UNLIKE THE SEVEN BEFORE IT. S1, S2, S5, S6
 * and S7 each approved $25 and spent $0, because the gate is evaluated before
 * any dispatch and each died before reaching one. S9 does not: the runner
 * continues past a red beat (S7 ran 5/15 with greens after its first red), and
 * beats 6 and 12 are fully expressible `do` blocks that press `start-session`
 * on a kickoff form the earlier beats have already filled. Beat 5 going red
 * does not stop beat 6 from dispatching the creation agent, and beat 11 going
 * red does not stop beat 12 from dispatching the onboarding agent. S3 is the
 * one precedent — its beat-11 dispatch ran about sixty seconds for tens of
 * cents against its own `effective_ceiling_usd: 5`.
 *
 * ON THE `data-*` KEYS. Every key and value below was copied from the live DOM
 * of a bridge booted from this lane's own worktree (pid 2560406,
 * `/proc/<pid>/cwd` verified), EXCEPT the session-surface keys of beats 6-8,
 * transcribed from the DOM contract — observing a live session costs a real
 * dispatch, which is the thing this story is trying to budget. REPOINTED
 * (bead `forge-8vfn.7.4.1`, ruling 444): that doc is now
 * `docs/reference/studio-dom-contract.md`; `docs/reference/studio-dom-contract.md`
 * no longer exists, so the old citation named a file a reader could not open. None is invented. Read live and load-bearing: `/sessions` reports
 * `data-session-count="0"` with seven kickoff CTAs, one per kind, each its own
 * unique `data-action`; `/sessions/authoring/new` renders
 * `[data-field="kickoff-project"]`, `[data-field="kickoff-prompt"]` and two
 * `[data-field="kickoff-model-tier-option"]` labels (`sonnet`, `opus`) and
 * NOTHING ELSE that could set what the run uses; `/monitor` reports
 * `data-ledger-total="0"` with `[data-section="history-ledger"][data-ledger-count="0"]`.
 *
 * WHERE A BEAT CANNOT BE EXPRESSED it says so and stands anyway:
 *
 *   - Beats 6 and 12 route to `/sessions/<kind>/<sid>`, and neither segment
 *     can be bound: `start-session` POSTs and `router.push`es straight into
 *     the session without ever publishing the minted id as a `data-*` on the
 *     page it is leaving. That is the mint-then-navigate shape M1-G closed for
 *     onboarding and left open in six other places — bead `forge-8vfn.5.10`.
 *     The generic kickoff is named in it. Cited, not re-diagnosed.
 *   - Beat 5 fills `kickoff-model-tier-option`, which TWO `<label>`s carry;
 *     §3.1's `fill` verb names a `data-field` and nothing else, so it cannot
 *     pick one of a radio group. The act is named honestly and the schema gap
 *     is recorded — `forge-8vfn.2.22`'s neighbourhood, the same shape S7 hit
 *     on a checkbox and S8 hits on the community kind filter.
 *   - Beat 9 returns via Home rather than straight to `/sessions`. Every page
 *     carries `a[href="/"]` in its nav; whether the session shell's
 *     breadcrumbs carry `/sessions` could only be established by observing a
 *     live session, which costs a dispatch. So the story takes the route it
 *     can prove exists.
 *
 * SWEEP. `sweep.mjs` removes `projects/story-<id>` and
 * `brain/projects/story-<id>` only. Both sessions here are anchored to
 * `mdtoc`, so each run leaves a session directory under `projects/mdtoc/`
 * that nothing sweeps, and a second run meets the duplicate-session guard —
 * `[data-action="start-session"]` reads "Start another session" and arms on
 * the first click instead of posting. Bead `forge-8vfn.2.26`; cited, not
 * re-filed. This lane swept by hand between runs.
 */

/** What the operator asks the assistant to build — the same job S7's operator does by hand. */
const AUTHORING_BRIEF =
  'A skill that checks every relative link in a markdown file resolves to a real path in the repo, and reports the ones that do not with their line numbers.';

/** The model the operator picks for the one session that lets them pick. */
const CHOSEN_TIER = 'opus';

/** The agent an authoring session dispatches — a kickoff-only system agent. */
const AUTHORING_AGENT = 'creation-agent';

export default {
  id: 'S9',
  ground: { project: 'mdtoc', realSpawn: true, budget_usd: 25 },
  docs: { kind: 'how-to', title: 'Drive forge through the assistant' },
  beats: [
    {
      // Fully expressible. `active-session-count` is on the sessions strip;
      // `page` and `page-ready` are the root's. Zero is the starting state and
      // it matters: every cost this story reads later is a cost this story
      // itself caused.
      act: 'Open Studio',
      expect: {
        route: '/',
        data: {
          page: 'home',
          'page-ready': 'true',
          section: 'sessions-needing-you',
          'active-session-count': '0',
        },
      },
      say: 'Nothing is running. Every one of S1 through S8 is something the operator can do with their own hands from here; this story hands the same work to the assistant instead, and the difference has to be visible in what it costs.',
    },
    {
      // Fully expressible — `view-all-sessions` is the strip's own link and is
      // unique. `/sessions` has no nav pillar of its own, so this is how an
      // operator reaches the spine.
      act: 'Press "View all sessions"',
      do: [{ press: 'view-all-sessions' }],
      expect: {
        route: '/sessions',
        data: {
          page: 'sessions-index',
          'page-ready': 'true',
          'session-count': '0',
          'fetch-status': 'ok',
        },
      },
      say: 'This is the spine, and it is S9’s whole subject: seven doors, one per session kind, and behind them the assistant-driven variant of most of the other eight stories. `fetch-status` is here on purpose — an empty list and an unreachable bridge are different facts and this page refuses to render them the same.',
    },
    {
      // Fully expressible — each of the seven kickoff CTAs carries its own
      // unique `data-action`, read live. This is S7's job handed over: S7's
      // operator either typed the skill package into a form or described it to
      // the creation agent from the library page. Here the same job starts at
      // the spine, which is where §3 says the run's SDK, model and effort get
      // chosen.
      act: 'Ask the assistant to do S7’s job — author a library component',
      do: [{ press: 'kickoff-authoring' }],
      expect: {
        route: '/sessions/authoring/new',
        data: { page: 'session-kickoff', 'page-ready': 'true', 'kickoff-kind': 'authoring' },
      },
      say: 'Same work as S7, different hands. The operator is not going to write the package, name its directory or check its frontmatter — they are going to say what they want and pay for a turn.',
    },
    {
      // Fully expressible. `kickoff-project` is the selector (live options are
      // exactly `|mdtoc`) and `kickoff-prompt` is the free-text brief —
      // `authoring` is the ONE kickoff kind whose `/start` body requires one,
      // so Start stays disabled until it is filled. The start button answers
      // the keys the root does not; `existing-count` is on it always, and
      // asserting `confirming: 'false'` pins that this is a first session
      // rather than an armed "Start another".
      act: 'Point it at a project and tell it what to build',
      do: [
        { fill: 'kickoff-project', with: 'mdtoc' },
        { fill: 'kickoff-prompt', with: AUTHORING_BRIEF },
      ],
      expect: {
        route: '/sessions/authoring/new',
        data: {
          page: 'session-kickoff',
          'page-ready': 'true',
          'kickoff-kind': 'authoring',
          action: 'start-session',
          'existing-count': '0',
          confirming: 'false',
        },
      },
      say: 'The brief is the whole instruction — there is no second turn where the operator fills in what they meant. Every other kickoff kind takes its brief later; this one takes it here, because the agent has nothing else to go on.',
    },
    {
      // THE FIRST OF S9's THREE CLAUSES, and it is one-third kept. The model
      // half is real: `[data-section="kickoff-model-tier"]` renders
      // `data-model-tier-picker="range"` with two
      // `[data-field="kickoff-model-tier-option"]` labels, `sonnet` and
      // `opus`, pre-selecting the envelope's cheapest tier so the checked
      // radio always names what will actually run.
      //
      // TWO THINGS THIS BEAT ASSERTS THAT THE PAGE DOES NOT DO. First, the
      // picker publishes no SELECTED value — there is no `data-*` anywhere on
      // this page stating which tier is chosen, so nothing in the DOM contract
      // says what this session will run on until after it has started. The
      // beat asserts `data-model-tier` on the section, the same key the FIXED
      // picker's own chip carries, because a range picker that cannot state
      // its selection is the weaker of the two. Second, and larger: §3 says
      // SDK, model AND effort are set per session, and this page has no
      // control for SDK and no control for effort at all. The full live field
      // inventory of `/sessions/authoring/new` is `kickoff-project`,
      // `kickoff-prompt` and `kickoff-model-tier-option`. There is no attribute
      // to assert for the two that are missing, and the handbook forbids
      // inventing one, so they are named here and in `_1.0/stories/S9.md`
      // as surfaces the sessions lane must build.
      act: 'Set the SDK, the model and the effort this session will run on',
      do: [{ fill: 'kickoff-model-tier-option', with: CHOSEN_TIER }],
      expect: {
        route: '/sessions/authoring/new',
        data: {
          page: 'session-kickoff',
          'page-ready': 'true',
          'kickoff-kind': 'authoring',
          section: 'kickoff-model-tier',
          'model-tier-picker': 'range',
          'model-tier': CHOSEN_TIER,
        },
      },
      say: 'Three knobs is what §3 promises and one is what the page offers. Which model a turn runs on is the cheapest of the three to get right, and it is the only one an operator can touch — the SDK the session runs under and how hard it is allowed to think are decided somewhere the operator never sees.',
    },
    {
      // NOT expressible as a route — `<authoringSessionId>` cannot be bound,
      // because `start-session` POSTs and pushes straight into the session
      // without publishing the minted id anywhere a prior beat could observe
      // it. Bead `forge-8vfn.5.10`; the generic kickoff is one of its six
      // surviving sites. The `do` IS honest and WILL execute: this beat
      // dispatches the creation agent for real, which is why the ground
      // declares a budget.
      act: 'Start it',
      do: [{ press: 'start-session' }],
      expect: {
        route: '/sessions/authoring/new',
        data: {
          page: 'session-kickoff',
          'page-ready': 'true',
          'kickoff-kind': 'authoring',
          'minted-session-id': '<authoringSessionId>',
        },
      },
      say: 'From here the assistant is doing S7’s work: reading the project, drafting the package, and stopping at the approval S7’s operator would have reached by typing. The operator’s job for the next few minutes is to watch what it costs.',
    },
    {
      // The half of clause one the product DOES keep, and worth pinning
      // precisely because it is kept. `modelTier` is written at kickoff onto
      // `status.json`, read back live off the session read route, and rendered
      // as a READ-ONLY chip beside the panel's provenance strip. So the tier
      // chosen in beat 5 survives into the running session and can be checked
      // against it — which is exactly what "set per session" has to mean.
      act: 'Check the session is running on the model the operator chose',
      expect: {
        route: '/sessions/authoring/<authoringSessionId>',
        data: {
          page: 'session',
          'page-ready': 'true',
          'session-kind': 'authoring',
          // AMENDED (M6-A s3 sitting, ruling 503). Was `'session-phase':
          // 'working'`, which no product could ever satisfy: `working` is one
          // of the FIVE lifecycle tokens `session-lifecycle-client.ts` declares
          // and publishes under `data-lifecycle-state`, while `authoring`'s own
          // phases are analyzing / awaiting-review / committing / committed.
          // The claim is unchanged — this session is RUNNING, on the tier the
          // operator chose — and it is now made against the attribute that
          // carries it. It is also stabler: beat 10 already refuses to pin
          // `phase` because it moves as the agent works, and this beat was
          // carrying the race beat 10 was written to avoid.
          'lifecycle-state': 'working',
          component: 'session-model-chip',
          'model-tier': CHOSEN_TIER,
        },
      },
      say: 'This is the one part of the promise that already works end to end: a choice made on the kickoff form is a fact the running session states about itself, not a hope. The other two knobs have nothing to state because nothing set them.',
    },
    {
      // THE SECOND OF S9's THREE CLAUSES — "cost is recorded". Nothing on any
      // session surface carries one. The session read route returns
      // `{ok, kind, title, sessionId, project, phase, stages, defaultStage,
      // turns, artifact, affordances, modelTier, terminal, lifecycle, [kbId]}`
      // and there is no cost field in it; the activity drawer's cost ticker
      // renders ONLY from caller-supplied `costUsd`. The sentence this comment
      // used to quote — that only `RunPanel` has a real source for cost while
      // the session-summary types "carry no cost field yet, a disclosed gap,
      // not papered over" — was in `docs/reference/studio-dom-contract.md`, which no
      // longer exists. REPOINTED (bead `forge-8vfn.7.4.1`, ruling 444) to
      // `docs/reference/studio-dom-contract.md`, and the quote is NOT carried
      // across: that doc does not make the claim, and repointing a citation at
      // a file which does not say the cited thing is worse than a dead path.
      // What survives is the observation itself, which the beat asserts. So the
      // beat asserts `data-ledger-cost-usd`, the ONE key forge publishes a
      // cost under anywhere in its DOM contract, bound as `<authoringCostUsd>`
      // so the story pins that a figure exists rather than what it is. Owning
      // package `sessions`.
      act: 'Read what the session has cost so far',
      // AMENDED (M6-A s3 sitting). The attribute is absent because the figure
      // is genuinely `null` 0.2 s after dispatch: cost is priced at a TURN
      // BOUNDARY, and ruling 438 gives the mechanism — a beat with no `do` and
      // no `wait` reads the page ONCE. The operator confirmed what this gives
      // up: "so far" now means "by the first completed turn", not mid-flight.
      // A running mid-turn total is a PRODUCT change and its own initiative,
      // not a beat amendment. What it buys is that beats 13-14 become
      // reachable in the same run — the authoring session has priced something
      // by the time `/monitor` is read.
      // AMENDED 2026-09-11 (amend-7, operator ruling 625) — 600_000 → 300_000.
      // Beat 8's greens are INSTANT across all four runs: the session's own
      // cost is on its page the moment the beat reads it (run 4 bound 0.68 at
      // t+43 s from the press, runs 1-3 likewise). 1.5× the slowest of those
      // is far below the 5-minute floor, so 300_000 IS the floor rather than a
      // derived figure — and it is still fifty times the largest green.
      // Complementary to C's 626 stall door, not redundant with it: this bound
      // is the ceiling on a beat that is progressing, while 626 stops a
      // genuinely stuck agent at the product's own 3-minute silence ceiling
      // first. Neither makes the other unnecessary.
      wait: { for: 'agent', upTo: 300_000 },
      expect: {
        route: '/sessions/authoring/<authoringSessionId>',
        data: {
          page: 'session',
          'page-ready': 'true',
          'session-kind': 'authoring',
          'ledger-cost-usd': '<authoringCostUsd>',
        },
      },
      say: 'A session the operator is paying for by the token should be able to say what it has spent, while it is spending it. This is the beat that decides whether "cost is recorded" means anything, and the operator asking the question has nowhere to look.',
    },
    {
      // Fully expressible. Every page carries `a[href="/"]` in its nav, so
      // this return is provable; see the header for why it does not go
      // straight to `/sessions`. The count is the assertion: one assistant is
      // working now, and Home's strip is derived from the same active-sessions
      // read `/sessions` uses.
      act: 'Go back to Studio’s front page',
      expect: {
        route: '/',
        data: {
          page: 'home',
          'page-ready': 'true',
          section: 'sessions-needing-you',
          'active-session-count': '1',
        },
      },
      say: 'One assistant working, counted in the one place the operator looks first. Beat 1 pinned this at zero for exactly this comparison.',
    },
    {
      // Fully expressible as an assertion. The row's four keys —
      // `session-kind`, `session-phase`, `needs-you`, `session-state` — are
      // all on the same `<tr>`; `session-kind` keeps the raw registry id while
      // the visible column renders the descriptor's authored title. `phase` is
      // deliberately not pinned: it moves as the agent works and pinning it
      // would make this beat a race. `needs-you: 'false'` is the honest state
      // for a merely-working agent — the bridge derives it and it is truthful
      // in both directions.
      act: 'Press "View all sessions" and find it on the spine',
      do: [{ press: 'view-all-sessions' }],
      expect: {
        route: '/sessions',
        data: {
          page: 'sessions-index',
          'page-ready': 'true',
          'session-count': '1',
          'session-kind': 'authoring',
          // AMENDED (amend-4, OPERATOR ruling 566). S9 run 2 measured
          // `awaiting-operator` / `needs-you: true` here, and NOTHING IS
          // BROKEN — the amendment that fixed beat 8 is what moved this beat's
          // ground. Beat 8 gained `wait: { for: 'agent', upTo: 600_000 }` at
          // the sitting so a cost figure would exist to read; that wait means
          // the authoring session has finished its turn by the time the spine
          // is read, so the state it settles into is the one it asks the
          // operator from. `working` was a window the wait closed, and
          // `awaiting-operator` is a settled state — this is the stabler
          // assertion as well as the true one.
          'session-state': 'awaiting-operator',
          'needs-you': 'true',
        },
      },
      say: 'The spine lists what it started, and it is already asking for you: kind, project, phase, state, model tier, last update — six columns that tell the operator a decision is waiting, and not one of them is money.',
    },
    {
      // THE OTHER HALF OF CLAUSE ONE, and the sharpest measurement in this
      // story. This kickoff renders `data-model-tier-picker="fixed"` and a
      // read-only `[data-field="kickoff-model-fixed-chip"][data-model-tier="sonnet"]`
      // reading "sonnet · fixed for this agent" — read live. So for this kind
      // the operator sets nothing: the tier comes from the agent's own
      // SKILL-declared envelope and widening it is a SKILL.md edit, never a UI
      // decision. The beat asserts `range` because §3's clause is "set per
      // session", and a value the operator cannot set is not set per session.
      // Owning package `sessions`.
      act: 'Ask the assistant to do S1’s job, and choose ITS model too',
      do: [{ press: 'kickoff-onboarding' }],
      expect: {
        route: '/sessions/onboarding/new',
        data: {
          page: 'session-kickoff',
          'page-ready': 'true',
          'kickoff-kind': 'onboarding',
          section: 'kickoff-model-tier',
          'model-tier-picker': 'range',
        },
      },
      say: 'Second variant, and the promise comes apart on it. One kind lets the operator pick a model and the next fixes it read-only — same spine, same form, same words on the page, opposite amount of control. "Per session" has to mean per session, or the operator has to know which kinds it is untrue for.',
    },
    {
      // AMENDED (M6-A s3 sitting, ruling 483 — the class ruled once across
      // S9, S7 and S6). This beat used to assert
      // `/sessions/onboarding/<onboardingSessionId>` while NO beat bound that
      // segment, which made it unsatisfiable by any product change rather than
      // a finding about the product. Since ruling 396 the press publishes the
      // minted id and STAYS, so the beat takes its own beat 6's shape: bind
      // here, navigate next. `forge-8vfn.5.10`'s six mint-then-navigate sites
      // are still open; this beat no longer depends on that bead to pass.
      //
      // The `do` is honest and WILL execute: this is the second real dispatch,
      // and the second half of what this story's $25 ceiling is for.
      act: 'Start it and let both of them run',
      do: [
        { fill: 'kickoff-project', with: 'mdtoc' },
        { press: 'start-session' },
      ],
      expect: {
        route: '/sessions/onboarding/new',
        data: {
          page: 'session-kickoff',
          'page-ready': 'true',
          'kickoff-kind': 'onboarding',
          'minted-session-id': '<onboardingSessionId>',
        },
      },
      say: 'Two assistants now, on two different jobs, one of which the operator chose a model for and one of which chose for itself. Whatever else is true, they are both spending real money right now.',
    },
    {
      // NEW BEAT (M6-A s3 sitting, ruling 441 / 490's sibling half). Row 7
      // (#557, main `cfe9e111`) gave onboarding a real interview: the kind now
      // declares `{ phase: briefing, step: noop, awaits: questions }` as its
      // ONE writable row, and `studio/session-kinds.yaml` says in its own words
      // that "a session opened from the spine (/sessions/onboarding/new) with
      // nobody to brief it shows the question form instead of claiming to run".
      // So this is S9's own truth, not a path borrowed from S1: the operator
      // started this session from the SPINE, and the spine has nobody to brief
      // it but them.
      //
      // It is also the ONLY place in the nine stories where the BARE generic
      // interview is exercised — every other briefed kind reaches its agent
      // through a bespoke form — and without it the onboarding session never
      // prices anything, so beats 13-14 could not read two costs.
      //
      // THE HANDLE IS `session-answer`, the GENERIC `SessionInteractivePanel`'s
      // — NOT `question-freetext`, which belongs to `ArchitectQuestionForm`.
      // Bead `6.11.21` records that exact confusion costing S2 beat 12 and S1
      // beat 6; it is named here so the next author does not pay for it again.
      //
      // The `until` is the repeat's OWN and it is reachable: `running` is the
      // state the brief's submission produces (briefing -> running, written by
      // the question-form write itself), so the loop ends when the brief is
      // ACCEPTED rather than borrowing this beat's own expectation — §3.1's
      // recorded trap, bought by two funded S1 runs (ruling 320).
      act: 'Tell the assistant what the project is for, and let it start',
      // AMENDED (amend-3, T1 ruling 562 — mechanical, 513's class). S9 run 2
      // measured the defect and it was MINE, not the product's: this beat was
      // added at the sitting with NO declared `wait`, so the repeat inherited
      // the 15 000 ms default and reported `answered 0 round(s) and this
      // beat's declared bound (15000 ms) ran out`. An onboarding session
      // minted at `briefing` has to mount its question form before anything
      // can be filled. Beat 8 was given `wait: { for: 'agent', upTo: 600_000 }`
      // at that same sitting and this beat was not — I asked the bound
      // question of the beat I was amending and never of the beat I was
      // adding. Same wait, same reason: it stands on a real agent.
      // AMENDED 2026-09-11 (amend-7, operator ruling 625) — 600_000 → 300_000.
      // Beat 13 went green for the first time in run 4, instantly — amend-5's
      // `{ press: 'open-minted-session' }` was the missing navigation, and the
      // beat answers the brief as soon as it is on the right page. The ten
      // minutes it burned in run 3 was the cost of the missing press, not of
      // a slow agent: a bound cannot be priced on a red that never reached
      // the work. 300_000 is the 5-minute floor, above every green measured.
      wait: { for: 'agent', upTo: 300_000 },
      do: [
        // AMENDED (amend-5, T1 ruling 577, mechanical under 574's class). THE
        // NAVIGATION THE 483 SPLIT REQUIRES. amend-2 made beat 12 STAY on
        // `/sessions/onboarding/new` to bind `minted-session-id`; that made a
        // navigation step mandatory here, and the beat I added did not have
        // one. S9 run 3 measured the cost: `answered 0 round(s)` against the
        // FULL 600 000 ms bound, on a page frame 13 shows is the kickoff form
        // — no question form, no `session-answer` anywhere on it.
        //
        // It burned the whole bound instead of failing fast because the
        // repeat's first inner step is a `fillAll`, and the wrong-page check
        // exempts fills by design (a fill names a field inside an affordance
        // the press before it opened). Correct for a not-yet-opened
        // affordance; it also means a repeat standing on the wrong page spends
        // everything it declared.
        //
        // amend-3 blamed the missing wait for this and was WRONG — the wait is
        // necessary and was never sufficient. `open-minted-session` is the
        // kickoff page's own handle (`app/sessions/[kind]/new/page.tsx:576`,
        // the "Open the session →" link), and this is the shape S1 beats 5 and
        // 11 already use.
        { press: 'open-minted-session' },
        { repeat: [
            { fillAll: 'session-answer', with: 'A markdown table-of-contents tool; the gate is `npm test`.' },
            { press: 'submit-answers' },
          ],
          until: { 'session-phase': 'running' } },
      ],
      expect: {
        route: '/sessions/onboarding/<onboardingSessionId>',
        data: {
          page: 'session',
          'page-ready': 'true',
          'session-kind': 'onboarding',
          'session-phase': 'running',
        },
      },
      say: 'A session the operator started from the spine has nobody to brief it but them. The assistant asks for the one thing only they know, and the moment they answer it starts spending — which is what the next two beats go to read.',
    },
    {
      // THE THIRD OF S9's THREE CLAUSES — "cost is shown". `/monitor` carries
      // the ONE cross-run ledger forge keeps: `[data-ledger-total]` on the
      // root and `[data-section="history-ledger"][data-ledger-count]` on the
      // section. It is fed by `GET /api/agents/runs/recent`, which joins FLOW
      // RUNS and STANDALONE AGENT DISPATCHES. A session is neither, so no
      // session this story started can ever appear in it, and the ledger reads
      // zero after two paid dispatches. Owning package `sessions`.
      act: 'Open the Monitor and read what the two of them cost',
      // AMENDED 2026-09-11 (amend-8, operator ruling 656) — 2 → 3, and the
      // three are NAMED here rather than counted, because a bare count against
      // this ledger has now been wrong twice for two unrelated reasons.
      //
      // S9 run 5 (`evidence/m6-a-S9-run5/`, frame 14), read off the page:
      //   AGENT  onboarding-agent  onboarding-agent    RUNNING
      //   FLOW   creation-agent    Authoring session   AWAITING-REVIEW  $1.01
      //   FLOW   onboarding-agent  Onboarding session  RUNNING
      //
      // So the ledger carries the TWO SESSIONS this story started — which is
      // what the act means by "the two of them" — PLUS the standalone dispatch
      // the onboarding kind makes for itself. The onboarding work appears
      // twice, as a session and as the agent run beneath it; the authoring
      // work appears once, because its kind dispatches nothing. That is not a
      // duplicate row: they are different objects with different ids, and the
      // ledger is right to list both.
      //
      // WHY THE OLD 2 WAS WRONG, twice, differently. In run 4 (head
      // `6ed2855d`, before `forge-b6af`) it read THREE because two of them
      // were `_queue/pending` residue — 7.6.17's doubled initiative manifests
      // from S1 run 3, surfacing as PLANNED flow rows. In run 5 it reads three
      // again with an empty queue, because b6af taught the ledger to list
      // sessions at all. Same number, no shared cause.
      //
      // `/monitor` merges flow runs, standalone dispatches AND sessions. A
      // beat asserting a bare total against three independent sources is wrong
      // again the moment any one of them changes — which is exactly what
      // happened. `ledger-agent` is asserted alongside so the count cannot
      // drift back into meaning nothing: a run that produces three rows from
      // the wrong work still fails here.
      //
      // AMENDED 2026-09-11 (amend-9, T1 ruling 705) — SPLIT IN TWO, because
      // amend-8 asked for a combination this page cannot answer in one
      // element. S9 run 6 read `data-ledger-agent: expected "creation-agent",
      // absent from the page` — and the value was ON the page, in the runner's
      // own `beat-14-dom.html` captured at the instant of the verdict.
      //
      // `resolveExpectations` (`scripts/stories/beats-page.mjs:284`) answers
      // from the page ROOT first, then requires ONE record to satisfy every
      // remaining SHARED key at once. Carrier census on that DOM:
      //
      //   data-page, data-page-ready, data-ledger-total   → on <main>, the root
      //   data-section                                     → 7 carriers, SHARED
      //   data-ledger-agent                                → 3 carriers, SHARED
      //   data-ledger-count                                → 1, on the <section>
      //
      // `<section data-section="history-ledger">` carries the counts and NOT
      // `ledger-agent`; the three rows carry `ledger-agent` and NO `section`.
      // No element can satisfy both, so the together-rule scored, chose the
      // section, and reported the key that record lacks. The rule is right —
      // it exists to refuse an ambiguous match — and the EXPECTATION was
      // unsatisfiable.
      //
      // So this beat keeps the section's totals and beat 14a takes the row
      // identity. The `say` below already named two facts on two elements.
      expect: {
        route: '/monitor',
        data: {
          page: 'monitor',
          'page-ready': 'true',
          'ledger-total': '3',
          section: 'history-ledger',
          'ledger-count': '3',
        },
      },
      say: 'The Monitor is where forge shows what it has spent, and it is honest about knowing nothing — an empty ledger, not a fabricated zero row. It is also the only place an operator could look, so a kind of work that never reaches it is a kind of work that costs an unknown amount forever. Three rows for two sessions is the honest shape.',
    },
    {
      // 14a — the other half of amend-9's split: the ROW, not the section.
      //
      // `ledger-agent` is the only SHARED key here, so the creation-agent row
      // satisfies it alone. `ledger-total` comes from the page root, which
      // `resolveExpectations` reads BEFORE sharing is considered — which is
      // why pairing it with `ledger-agent` is safe even though it has two
      // carriers of its own. M6-C raised exactly that worry; the answer is
      // that a key the root answers never enters the shared set at all.
      //
      // Asserted because the count alone cannot say WHOSE work was paid for:
      // three rows from the wrong work would still satisfy beat 14.
      act: 'Read which agent the paid row belongs to',
      expect: {
        route: '/monitor',
        data: {
          page: 'monitor',
          'page-ready': 'true',
          'ledger-total': '3',
          'ledger-agent': 'creation-agent',
        },
      },
      say: 'A count is not an answer to "what did this cost me". The ledger names the agent behind each row, so the authoring session the operator started is identifiable among the three — the onboarding kind dispatches a standalone agent of its own, and the operator is shown both the session and the run beneath it.',
    },
    {
      // Blocked behind beat 13 and asserting the figure itself. Both keys are
      // real row-level `HistoryLedger` attributes: `data-ledger-agent` is the
      // per-row attribution the aggregate route added, and
      // `data-ledger-cost-usd` is the bare `.toFixed(2)` figure — omitted, not
      // zeroed, when a cost genuinely does not exist, which is the discipline
      // that makes its absence here meaningful rather than ambiguous. The
      // value binds as `<authoringCostUsd>` so the story pins that the number
      // is published, not what it is.
      act: 'Read the authoring session’s own figure, against the ceiling it was given',
      expect: {
        route: '/monitor',
        data: {
          page: 'monitor',
          'page-ready': 'true',
          'ledger-agent': AUTHORING_AGENT,
          'ledger-cost-usd': '<authoringCostUsd>',
        },
      },
      // AMENDED 2026-09-11 (amend-6, T1 ruling 585 (iii)) — the comment that
      // stood here named a cause the evidence refutes, and the correction
      // matters more than the beat.
      //
      // It said "the creation-agent row publishes no `data-ledger-cost-usd`,
      // which is precisely what this beat exists to prove". There is NO
      // creation-agent row. `/monitor`'s ledger comes from
      // `GET /api/agents/runs/recent`, which joins FLOW RUNS and STANDALONE
      // `_agent-*` DISPATCHES. Run 3's two event logs settle it:
      // `_authoring-<sessionId>/events.jsonl` carries `cost_usd 0.71176675`
      // under `cycle_id _authoring-<sessionId>` — beat 8 read that 0.71 on the
      // session's own page — while `_agent-onboarding-agent-<stamp>/` carries
      // `0.39334640` under an `_agent-` cycle id. Beat 14 saw FOUR rows, all
      // `onboarding-agent`, matching the four `_agent-onboarding-agent-*` dirs
      // 1:1 by stamp. The authoring session is simply absent.
      //
      // `bridge-studio-kickoff.ts:372` MINTS `_agent-creation-agent-<stamp>`,
      // stores it on the session and returns it — and no such directory has
      // ever existed. Onboarding writes its turn's events under its minted
      // runId; authoring writes them under `_authoring-<sessionId>`. So the
      // onboarding rows are an accident of one kind's internals, not evidence
      // that sessions are ledgered: `/monitor` has never shown what a SESSION
      // cost. Bead `forge-b6af`.
      //
      // The citation is corrected too. `forge-8vfn.6.11.51` is a different bug
      // — `HomeSessionsStrip.tsx:175` renders `open-session` once per card — and
      // it was standing here as shorthand for "which row does the story
      // address". This beat's row does not exist, so that shorthand was wrong
      // on the substance and is removed rather than reworded.
      //
      // The failure MESSAGE also misnamed the defect until amend-6's sibling
      // fix. `beats.mjs` rebound an already-bound placeholder instead of
      // comparing, so this beat's `<authoringCostUsd>` silently moved 0.71 to
      // 0.39 and the red fell on `data-ledger-agent` instead — a missing-row
      // finding wearing a wrong-agent message. With compare-when-already-bound
      // it reads `expected "0.71" … got "0.39"`, which points where it should.
      say: 'This is where S9 ends, on the one claim that makes the other eight stories affordable to run through an assistant at all: that the operator can see, per session, what they were charged for handing the work over. Until they can, "ask the assistant to do it" is a bill with no itemisation.',
    },
  ],
};
