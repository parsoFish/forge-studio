/**
 * S4 — create a new flow (1.0.md §3, row S4).
 *
 * Operator flow: the two flows forge ships are starters. The operator builds
 * their own in the builder, lints it clean, runs it on `gitpulse`, watches it
 * on the monitor, and lands at the verdict. Authored 2026-08-30 against
 * `parsoFish/main` `da566d8b`, with the operator (H6). Green expected at M5.
 *
 * WHAT THE OPERATOR BUILDS, AND WHY IT IS NOT THE STARTER RENAMED. `/flows/new`
 * opens on a seeded canvas of three stations — plan → dev → review,
 * `[data-node-count="3"][data-edge-count="2"]`, live-verified. Saving that
 * unchanged would create a flow indistinguishable from what forge already
 * ships, and would prove nothing about the builder. So beat 4 places a FOURTH
 * station, the real `architect` agent from the palette, ahead of plan. That is
 * the act this story exists to prove, and it is also what makes the flow
 * runnable: a flow whose first station is the architect is launched from an
 * IDEA (`[data-kickoff-kind="idea"]`, copied from `/flows/forge-architect`
 * live), while a generic flow's launcher is an initiative picker that offers
 * only already-planned initiatives — and `gitpulse` has none
 * (`[data-action="start-work-run-flow"]` is disabled on its project page with
 * "no pending initiative to enqueue"). Building the flow the operator can
 * actually start is authoring the true flow, not routing around the product.
 *
 * WHERE IT GOES RED, AND WHO OWNS IT. Beat 4 has no `do` block. The palette's
 * chips declare `[data-palette-chip][data-chip-ref][data-chip-placeable]` and
 * NO `data-action`; a station is placed by dragging a chip onto the canvas and
 * wired by dragging between two `[data-handleid]` handles. `do` resolves
 * `[data-field=…]` and `[data-action=…]` only, so the single most important
 * act in the builder cannot be named at all. The beat stands and asserts the
 * canvas the operator would be looking at. `_1.0/stories/S4.md` names the
 * owner.
 *
 * "LINT CLEAN" HAS NO SURFACE, and the story does not invent one. §3's row
 * says `forge studio lint` clean, which is a CLI — and 1.0 requires these
 * flows to be driven from Studio. In Studio the lint runs as part of the save:
 * a REJECTED save renders `[data-component="flow-save-findings"]
 * [data-finding-count]` with per-row `[data-finding-node][data-finding-check]`,
 * and a clean one renders nothing at all. `expect.data` asserts values, never
 * absences, so beat 7 asserts the state a clean lint produces — the flow saved
 * and startable — and its narration says what was checked. The missing report
 * surface is recorded in `_1.0/stories/S4.md`, not invented here.
 *
 * ON THE `data-*` KEYS. Every key and value below was copied from the live DOM
 * of a bridge booted from this lane's worktree — `/flows`, `/flows/new`,
 * `/flows/forge-architect`, `/flows/forge-develop`, `/monitor` and
 * `/projects/gitpulse` all observed directly, including the `project` and
 * `kb-select` option VALUES the `do` steps select. The session tail (beats 11
 * and 12) is S2's own worked vocabulary, which costs a real architect spawn to
 * observe. None is invented. Where the page root does not carry a key, the
 * keys it does not carry are answered together by ONE element, per §3.1.
 *
 * THE FIXTURE, and the sweep that does not own it. The flow is named
 * `story-s4` — `story-<id>`, the reserved fixture namespace — typed already
 * lowercase so the story never depends on forge's slug rule. But
 * `scripts/stories/sweep.mjs` knows only `projects/story-<id>` and
 * `brain/projects/story-<id>`: it does not remove `studio/flows/story-s4`, nor
 * the starter agents a first save materialises into `skills/`. A `/flows/new`
 * save carries `create: true`, so the SECOND run of this story 409s on the
 * name — a fixture red masking the product signal, the class
 * `forge-8vfn.2.19` named. Recorded in `_1.0/stories/S4.md` as a `stories`
 * gap.
 *
 * COST. The flow ends at a real architect run on `gitpulse`, so `realSpawn` is
 * true and `budget_usd` is declared; the runner refuses to start without
 * `--approve-spend` (H2). Unlike S1 and S2, which both died before any
 * dispatch, S4 can genuinely reach one — beat 9 is the press that spends. The
 * ceiling below is set from M0's own measurement: G1's full gitpulse cycle
 * cost $16.41 end to end, and this story runs only the planning leg of one.
 */

/** What this flow is for — the operator's own words, typed into the builder. */
const GOAL =
  'Plan a change to gitpulse and take it to a reviewed verdict, with the architect drafting the initiative before any code is written.';

/** The first piece of work the operator asks the new flow to plan. */
const IDEA =
  'Add a --since flag so the report covers only commits after a given date, with the date parsing tested and a documented default.';

/** This run's ceiling, in dollars — the same figure the ground declares. */
const CEILING = '25';

export default {
  id: 'S4',
  ground: { project: 'gitpulse', realSpawn: true, budget_usd: 25 },
  docs: { kind: 'tutorial', title: 'Create a new flow' },
  beats: [
    {
      // Fully expressible; all three keys are the page root's own.
      act: 'Open Studio on the Flows pillar',
      expect: {
        route: '/flows',
        data: { page: 'flows-index', 'page-ready': 'true', 'flow-count': '2' },
      },
      say: 'Two flows, both shipped with forge: one drafts a roadmap, one takes a decomposed initiative to a reviewed PR. They are starters. The pillar says so on the page — "every flow below is a ready-made starter, build your own to customize" — and this story is the operator taking it up on that.',
    },
    {
      // Fully expressible. `/flows` carries TWO CTAs at the same href —
      // `[data-action="new-flow"]` in the header and
      // `[data-action="new-flow-first"]` in the empty-state card — so the beat
      // names the one the operator presses rather than letting the runner's
      // link fallback pick whichever comes first. `page`, `flow-id`,
      // `page-ready` and `active-tab` are the root's; `component`,
      // `node-count` and `edge-count` are the canvas's own <div>.
      act: 'Press "+ New flow"',
      do: [{ press: 'new-flow' }],
      expect: {
        route: '/flows/new',
        data: {
          page: 'flow-monitor',
          'flow-id': 'new',
          'page-ready': 'true',
          'active-tab': 'build',
          component: 'flow-builder-canvas',
          'node-count': '3',
          'edge-count': '2',
        },
      },
      say: 'The builder opens on a skeleton rather than an empty page: plan, then dev, then review. It is the shape almost every delivery pipeline has, and it is a starting point, not the answer — the whole reason to build a flow is that this particular codebase wants something the starter does not do.',
    },
    {
      // Fully expressible. The flow's NAME is not mirrored to any `data-*` —
      // it is only the `[data-field="flow-name"]` input's value — so the beat
      // asserts the header state that the goal produces and the name is proven
      // by beat 6's route instead.
      act: 'Name the flow and say what it is for',
      do: [
        { fill: 'flow-name', with: 'story-s4' },
        { fill: 'flow-goal', with: GOAL },
      ],
      expect: {
        route: '/flows/new',
        data: {
          page: 'flow-monitor',
          'flow-id': 'new',
          component: 'flow-header',
          'goal-set': 'true',
        },
      },
      say: 'A flow’s goal is not decoration: it is what every agent in it is told it is working towards, so it is written before the stations are. The operator says what the flow is for in one sentence, and the header records that the flow now has one.',
    },
    {
      // FULLY expressible since bead `5.12` declared the builder's handles,
      // and AMENDED 2026-09-05 (H6, ruling 170, operator present) to use them.
      // The beat's `act`, `expect` and `say` are UNTOUCHED — it always asserted
      // `node-count="4"` and `edge-count="3"`; what it lacked was a way to
      // produce them. `apps/studio` now declares `place-station-<ref>` and
      // `connect-from-<ref>` / `connect-into-<ref>`, so the drag and the wiring
      // are nameable acts rather than mouse gestures no story can express.
      //
      // PROVEN GREEN before it was written here, twice, by throwaway probe
      // `probe512` — before and after the `FlowStationNode` split
      // (`_1.0/evidence/m5-b-probe512-green.log`, `…-after-split.log`): the
      // place press takes the canvas to four nodes, and the two connect
      // presses to three edges.
      //
      // AMENDED AGAIN 2026-09-05 (ruling 200, mechanical — a press whose handle
      // now exists, with `act`, `expect` and `say` byte-identical). The fourth
      // press ANSWERS the artifact picker, which is the pointer path's own last
      // step: an edge has always had to say which artifact crosses it, and
      // until `forge-8vfn.5.12.1` the declared handles were the one way to draw
      // one that did not ask.
      //
      // WHY IT IS PART OF THE BEAT, not a workaround. `connect-into-plan` now
      // pushes the edge AND opens `ArtifactPicker` (`FlowBuilderCanvas.tsx`'s
      // `completeInto`), so `node-count: '4'` / `edge-count: '3'` are already
      // true when the picker is up. Leaving it unanswered is not "the same beat
      // with fewer presses": the picker closes on the next outside mousedown,
      // so beat 5's `Save Flow` DISMISSES it and saves the artifact-less edge —
      // `probe167`'s chain, in which the save returns 200, `loadFlowDefinition`
      // throws on read-back, `loadAllFlows` skips the flow, and the page the
      // operator is redirected to renders `data-page="not-found"`.
      //
      // PROVEN BOTH WAYS before it was written here, costlessly, on the same
      // tree (`_1.0/evidence/m5-b-s5-probe200a/`):
      //   `probe200a`    — this `do` → GREEN 6/6, the saved flow reads back and
      //                    its launcher is `kickoff-kind: 'idea'`.
      //   `probe200aneg` — identical, the fourth press REMOVED → RED 4/6,
      //                    `data-page: expected "flow-monitor", got "not-found"`.
      // So the press is necessary as well as sufficient, and the negative
      // control reproduces `probe167`'s chain on current main rather than
      // citing it.
      act: 'Drag the "architect" agent out of the palette onto the canvas, and wire it into "plan"',
      do: [
        { press: 'place-station-architect' },
        { press: 'connect-from-architect' },
        { press: 'connect-into-plan' },
        { press: 'pick-artifact-plan' },
      ],
      expect: {
        route: '/flows/new',
        data: {
          page: 'flow-monitor',
          'flow-id': 'new',
          component: 'flow-builder-canvas',
          'node-count': '4',
          'edge-count': '3',
        },
      },
      say: 'This is the act the builder exists for. The starter’s "plan" station is a stub; this flow wants the real Architect in front of it, so that a run can begin from an idea instead of from an initiative somebody already planned. Four stations now, three edges — and the flow has stopped being a copy of the starter.',
    },
    {
      // Fully expressible as an ACT — `toggle-flow-advanced` and `kb-select`
      // are both real, and `gitpulse` is the option's own value, read off the
      // live <select>. The RESULT is not expressible: nothing on the page
      // mirrors which knowledge base a flow is bound to, so the only honest
      // assertion left is that the panel holding the control is open. Recorded
      // in `_1.0/stories/S4.md` — a flow's bound KB is invisible to the DOM
      // contract that is supposed to describe its load-bearing state.
      act: 'Open Advanced and bind gitpulse’s knowledge base to the flow',
      do: [
        { press: 'toggle-flow-advanced' },
        { fill: 'kb-select', with: 'gitpulse' },
      ],
      expect: {
        route: '/flows/new',
        data: {
          page: 'flow-monitor',
          'flow-id': 'new',
          section: 'flow-advanced',
        },
      },
      say: 'A flow that plans work on one project should read what forge already knows about that project. Binding the knowledge base here is what makes the difference between a planner that starts cold every run and one that has read the last six months of this repo’s own lessons.',
    },
    {
      // Fully expressible. The save is a real `data-action`; the route is the
      // flow's own id, and the name was typed already lowercase so the beat
      // does not depend on forge's slug rule. A `/flows/new` save carries
      // `create: true`, so this beat also pins that a new flow is CREATED here
      // rather than silently overwriting an existing one.
      act: 'Press "Save Flow"',
      do: [{ press: 'save-flow' }],
      expect: {
        route: '/flows/story-s4',
        data: {
          page: 'flow-monitor',
          'flow-id': 'story-s4',
          'page-ready': 'true',
        },
      },
      say: 'Saving is where forge judges the flow rather than the operator: the stations have to resolve to real agents, the edges have to carry artifacts the next station can read, and a name already taken is refused rather than overwritten. The flow now exists as a thing with its own page.',
    },
    {
      // Fully expressible; `can-start` is the root's own. This is the "lint
      // clean" beat — see the header for why it cannot assert the report
      // itself. `can-start="true"` is the strongest honest statement available:
      // forge accepted the flow AND believes it can be launched.
      act: 'Check the flow came out clean and can be started',
      expect: {
        route: '/flows/story-s4',
        data: {
          page: 'flow-monitor',
          'flow-id': 'story-s4',
          'can-start': 'true',
        },
      },
      say: 'A saved flow is not necessarily a runnable one. This is the check the operator makes before spending money on it: forge raised no findings against any station, and it says the flow can be started — which is the same question `forge studio lint` answers at a terminal, asked from the page the flow was built on.',
    },
    {
      // Fully expressible. `section` and `kickoff-kind` are the same <div>;
      // `idea` is copied from `/flows/forge-architect`'s live launcher, the
      // shipped flow whose first station is also the architect. A flow that
      // begins with the Architect must be launchable from an idea — if forge
      // offers the generic initiative picker here instead, this flow cannot be
      // started on gitpulse at all, and the beat says so by failing.
      act: 'Open the launcher',
      expect: {
        route: '/flows/story-s4',
        data: {
          page: 'flow-monitor',
          'flow-id': 'story-s4',
          section: 'flow-kickoff',
          'kickoff-kind': 'idea',
        },
      },
      say: 'How a flow is launched follows from what its first station is. This one begins with the Architect, so forge asks for an idea rather than for an initiative someone has already planned — which is what makes it startable against a project that has never been planned against before.',
    },
    {
      // Fully expressible, and this is the beat that SPENDS. `section` and
      // `architect-session-id` are the same <div>, and the id is published
      // there BEFORE the navigation that consumes it (M1-G closed
      // `forge-8vfn.5.5` on exactly this surface), so beat 11 can bind it.
      // `gitpulse` is the <select>'s own option value, read live.
      act: 'Point the flow at gitpulse, describe the first piece of work, cap what the run may spend, and press "Start architect"',
      do: [
        { fill: 'project', with: 'gitpulse' },
        { fill: 'idea', with: IDEA },
        { fill: 'cost-ceiling-usd', with: CEILING },
        { press: 'start-architect' },
      ],
      expect: {
        route: '/flows/story-s4',
        data: {
          page: 'flow-monitor',
          'flow-id': 'story-s4',
          section: 'new-idea',
          'architect-session-id': '<architectSessionId>',
        },
      },
      say: 'A flow built ten minutes ago is now dispatching a real Agent against a real repository, so the operator sets the ceiling before starting rather than discovering the bill afterwards. Pressing Start mints a session and shows its id on the page the operator is standing on.',
    },
    {
      // Fully expressible. `/monitor` is a nav pillar, so the runner reaches it
      // by real navigation with no binding. Only the headline count is
      // asserted: every per-card attribute (`data-session-phase`,
      // `data-needs-you`) changes while the Agent runs, so pinning one would
      // assert the instant the browser happened to look rather than the
      // product.
      act: 'While it works, check Monitor',
      expect: {
        route: '/monitor',
        data: { page: 'monitor', 'page-ready': 'true', 'monitor-live': '1' },
      },
      say: 'Monitor is the one surface that answers "what is running, and what is stuck". One thing is live on it — a run of a flow that did not exist at the start of this story, against a project forge has never planned against. That is the whole of S4 in a single number.',
    },
    {
      // Fully expressible. The Monitor session card wraps
      // `a[data-action="open-session"]`, and `<architectSessionId>` was bound
      // by beat 9. `session-kind` and `session-phase` are the session root's
      // own — S2's worked vocabulary, which costs a spawn to observe live.
      act: 'Open the session from Monitor, answer the Architect\'s questions about the work, and wait for it to finish drafting',
      do: [
        { press: 'open-session' },
        {
          fillAll: 'question-freetext',
          with: 'Scope it to the commit range the flag already accepts — no new range syntax. The gate command is `npm test`, and the human-readable output must keep working exactly as it does now.',
        },
        { press: 'submit-answers' },
      ],
      // AMENDED 2026-09-05 (ruling 200's mechanical class, per T1 ruling 222).
      // A `wait` field changes no expectation and no act — it names the bound
      // the beat is judged under.
      //
      // RE-AUTHORED 2026-09-05 (M5-B s7, bead `forge-8vfn.6.11.24`, T1 ruling
      // 276). The beat used to press `open-session` and wait for
      // `awaiting-verdict` alone. S4 run 3 — this lane's LAST S4 run — showed
      // why that can never arrive: the architect turn ran 117.3 s to a CLEAN
      // end and stopped at `awaiting-answers` having asked the operator
      // questions, and the beat waited its full 600 000 ms for a draft that
      // was never coming. The `/proc` trend recorded it in the same verdict
      // ("it was WORKING … and the process was gone by the end"), so the run
      // could say "the product asked a question" rather than "the agent hung".
      //
      // A fresh architect session's FIRST round is an interview, and no beat
      // answered it. So the beat now does what the operator does: answers the
      // whole round (`fillAll`, because Submit stays disabled until EVERY
      // question is answered and the count is model-determined — two in one
      // measured turn, three in another), submits, and THEN waits for the
      // draft. The expectation is unchanged: `awaiting-verdict` is still what
      // a drafted plan looks like.
      //
      // This beat stands on a REAL AGENT. S4 run 1's own archived
      // `_architect/<id>/status.json` reads `"phase": "interviewing"` at reap,
      // and the beat reported `data-session-phase: expected
      // "awaiting-verdict", got "interviewing"`. Runs measured on merged
      // main showed the beat red not because the product was wrong but because
      // `beats.mjs` had ONE bound, `READY_TIMEOUT_MS = 15_000`, for a local DOM
      // update and for an architect's interview alike (bead
      // `forge-8vfn.6.11.10`, #438). Ten minutes is a STATED GUESS that the
      // next run turns into a number, and the verdict now names which bound
      // gave up — so that run cannot confuse "the agent was slow" with "the
      // product is wrong".
      wait: { for: 'agent', upTo: 600_000 },
      expect: {
        route: '/sessions/architect/<architectSessionId>',
        data: {
          page: 'session',
          'page-ready': 'true',
          'session-kind': 'architect',
          'session-phase': 'awaiting-verdict',
        },
      },
      say: 'The session is the same shared surface every kind of agent run uses, so a flow the operator built themselves is watched exactly the way the shipped ones are. When the plan is drafted the session stops and waits for a human.',
    },
    {
      // Fully expressible. `/artifact` is reached by a query-string href, so
      // the runner's `a[href="/artifact"]` fallback cannot match it and the
      // navigation is a `do` step. The four keys are the plan gate's own root
      // — S2's worked vocabulary.
      act: 'Open the plan and stand at the verdict',
      do: [{ press: 'open-plan' }],
      expect: {
        route: '/artifact',
        data: {
          section: 'architect-plan',
          'architect-phase': 'awaiting-verdict',
          'gate-armed': 'true',
          'plan-mode': 'gate',
        },
      },
      say: 'This is where S4 ends: a flow the operator assembled, linted and launched has produced a plan, and forge is holding it at a gate for a decision. Nothing is approved — that decision belongs to the operator, and it is S10 that makes it. What this story proves is that a flow built in the builder runs like a flow that shipped with forge.',
    },
  ],
};
