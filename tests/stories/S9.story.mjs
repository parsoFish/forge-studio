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
 * transcribed from `docs/forge-ui-dom-and-harness.md` — observing a live
 * session costs a real dispatch, which is the thing this story is trying to
 * budget. None is invented. Read live and load-bearing: `/sessions` reports
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
          'session-phase': 'working',
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
      // renders ONLY from caller-supplied `costUsd`, and
      // `docs/forge-ui-dom-and-harness.md` states plainly that today only
      // `RunPanel` has a real source for it while the session-summary types
      // "carry no cost field yet, a disclosed gap, not papered over". So the
      // beat asserts `data-ledger-cost-usd`, the ONE key forge publishes a
      // cost under anywhere in its DOM contract, bound as `<authoringCostUsd>`
      // so the story pins that a figure exists rather than what it is. Owning
      // package `sessions`.
      act: 'Read what the session has cost so far',
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
          'session-state': 'working',
          'needs-you': 'false',
        },
      },
      say: 'The spine lists what it started. Kind, project, phase, state, model tier, last update — six columns, and not one of them is money.',
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
      // NOT expressible as a route — `<onboardingSessionId>` is the same
      // unbound segment as beat 6, `forge-8vfn.5.10` again. The `do` is
      // honest and WILL execute: this is the second real dispatch, and the
      // second half of what this story's $25 ceiling is for. `session-phase`
      // is not pinned here — onboarding's own phases are its business and this
      // story is not re-authoring S1.
      act: 'Start it and let both of them run',
      do: [
        { fill: 'kickoff-project', with: 'mdtoc' },
        { press: 'start-session' },
      ],
      expect: {
        route: '/sessions/onboarding/<onboardingSessionId>',
        data: {
          page: 'session',
          'page-ready': 'true',
          'session-kind': 'onboarding',
        },
      },
      say: 'Two assistants now, on two different jobs, one of which the operator chose a model for and one of which chose for itself. Whatever else is true, they are both spending real money right now.',
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
      expect: {
        route: '/monitor',
        data: {
          page: 'monitor',
          'page-ready': 'true',
          'ledger-total': '2',
          section: 'history-ledger',
          'ledger-count': '2',
        },
      },
      say: 'The Monitor is where forge shows what it has spent, and it is honest about knowing nothing — an empty ledger, not a fabricated zero row. It is also the only place an operator could look, so a kind of work that never reaches it is a kind of work that costs an unknown amount forever.',
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
      say: 'This is where S9 ends, on the one claim that makes the other eight stories affordable to run through an assistant at all: that the operator can see, per session, what they were charged for handing the work over. Until they can, "ask the assistant to do it" is a bill with no itemisation.',
    },
  ],
};
