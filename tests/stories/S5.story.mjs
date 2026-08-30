/**
 * S5 — create a new agent (1.0.md §3, row S5).
 *
 * Operator flow: an agent forge does not ship. The operator composes it out of
 * the skills already in the library, fences the tools and MCP servers it may
 * reach, saves it, runs it standalone against a real project under a ceiling
 * they set, and then reads its page to find out what that run actually cost.
 * Authored 2026-08-30 against `parsoFish/main` 6889f080, with the operator
 * (H6), in the amended draft-then-review mode. Green expected at M4.
 *
 * WHY THE LAST BEAT IS THE POINT. §3's row ends "history and cost honest on
 * the agent page", and the word doing the work is HONEST. A page that renders
 * a ledger proves nothing; a page that renders `data-ledger-cost-usd="0.00"`
 * for a run that spent four dollars is worse than one that renders nothing.
 * So beat 12 asserts the recorded cost itself, on the row, beside the link
 * kind that says where the run happened — and `docs/forge-ui-dom-and-harness.md`
 * is explicit that the attribute is OMITTED rather than zeroed when no cost
 * exists, so "absent" and "0.00" are different facts and a `<runCost>`
 * placeholder (which takes any non-empty value) is the honest assertion of
 * "there is a real figure here".
 *
 * GROUND. `mdtoc` — the one project committed to this repo, so it is the only
 * project a CLEAN CHECKOUT has, and 1.0's exit condition is these stories
 * green on a clean checkout. The agent is minted by beat 7. The flow ends at
 * a real standalone dispatch, so `realSpawn` is true and `budget_usd` is
 * declared: the runner refuses to start without `--approve-spend` (H2, $25
 * approved by the operator for the S5/S6/S7 batch on 2026-08-30). Beat 9 sets
 * a $2 per-run ceiling — deliberately SMALLER than the ground's budget, which
 * is the batch's cap, not this run's.
 *
 * ON THE `data-*` KEYS. Every key and value below was copied from the live DOM
 * of a bridge booted from this lane's own worktree. None is invented. Two were
 * confirmed by driving the product directly during authoring rather than
 * guessed, and the probe fixtures were removed afterwards: saving an agent
 * named "story S5" mints the slug `story-s5` and lands on `/agents/story-s5`
 * (beat 7's route is the real slug rule, not an assumption), and that page
 * comes up `data-ready-count="5"` with `data-run-ceiling="10"` — the two
 * values beats 8 and 9 hold the product to different targets on.
 *
 * WHERE A BEAT CANNOT BE EXPRESSED it says so and stands anyway, per the
 * operator's 2026-08-29 ruling ("author the true flow"). Beats 3, 4, 5, 6 and
 * 9 carry NO `do` block, and that is this story's whole finding: `/agents/new`
 * and `/agents/<id>` declare ZERO `data-field` on any input and exactly FOUR
 * `data-action`s — `generate-instructions`, `toggle-advanced`, `save-agent`,
 * `run-agent`. Verified live: 10 inputs on the builder, 0 with `data-field`.
 * The four starter options carry `data-starter-option`; every catalog chip
 * carries `data-id`/`data-kind`; the SDK, model, loop-strategy and brain-access
 * pickers carry `data-sdk-id`/`data-model-id`/`data-loop-strategy`/`data-access`;
 * the run project, run inputs and cost ceiling carry bespoke boolean
 * attributes. `do`'s verbs resolve `[data-field="…"]` and `[data-action="…"]`
 * and nothing else, so NAMING the agent, COMPOSING its skills, FENCING its
 * tools and CAPPING its spend — the three acts §3's row actually names — have
 * no handle to name. Inventing one would be inventing the contract this story
 * exists to hold the product to. `_1.0/stories/S5.md` names every gap and its
 * owner.
 */

/** What this agent exists to do — what the operator types into the builder. */
const PURPOSE =
  'Read a project’s own docs and its live pages, and report every place the docs describe a page that no longer exists.';

/**
 * The skills it composes, read off the live catalog palette's own chips
 * (`[data-kind="skill"][data-id]`). Two, because the fence beats below are
 * about what an agent may REACH, and an agent with one skill has nothing to
 * fence.
 */
const SKILLS = ['brain-query', 'webapp-testing'];

/** The tools it may invoke — the whole fence, read off the palette's `[data-kind="tool"]` chips. */
const TOOLS = ['git', 'node'];

/** This run's ceiling, in dollars. The ground's budget caps the BATCH; this caps the run. */
const RUN_CEILING = '2';

export default {
  id: 'S5',
  ground: { project: 'mdtoc', realSpawn: true, budget_usd: 25 },
  docs: { kind: 'how-to', title: 'Create a new agent' },
  beats: [
    {
      // Fully expressible. `page`, `page-ready` and `fetch-status` are the
      // route's own root; `section` is the roster below it. Deliberately NO
      // `data-agent-count`: the roster is whatever the install ships (11
      // today), and pinning it would make this story fail on a different
      // checkout for a reason that has nothing to do with creating an agent.
      act: 'Open Studio on the Agents pillar',
      expect: {
        route: '/agents',
        data: {
          page: 'agents-index',
          'page-ready': 'true',
          'fetch-status': 'ok',
          section: 'agent-roster',
        },
      },
      say: 'The Agents pillar lists every agent forge can dispatch. They are the workers a Flow puts at its stations, and the operator is about to add one that does not exist yet.',
    },
    {
      // Fully expressible. `new-agent` is a real `data-action` on an <a> whose
      // href is `/agents/new`, so either the press or the runner's own link
      // fallback would reach it; the beat names the press because that is what
      // the operator does.
      act: 'Press "+ New agent"',
      do: [{ press: 'new-agent' }],
      expect: {
        route: '/agents/new',
        data: {
          page: 'agents',
          'agent-id': '',
          'page-ready': 'true',
          section: 'starter-picker',
        },
      },
      say: 'A new agent starts from a starter — a ready-made shape the operator edits — or from nothing at all. The empty `agent-id` is the page saying, honestly, that nothing has been minted yet.',
    },
    {
      // NOT expressible, and deliberately left so. The four starters are
      // `[data-starter-option="dev"|"plan"|"review"|"blank"]` — no
      // `data-action` — and the name, purpose, instructions and interactivity
      // fields are bare `<input>`/`<textarea>` with no `data-field` at all
      // (verified live: 10 inputs, 0 with `data-field`). So the operator's
      // first real act on this page cannot be named. The beat asserts the
      // state that act produces: the readiness panel's purpose row ticking
      // over. `check` and `ok` are the same <li>, so one element answers both.
      act: 'Start from the Blank agent starter, name it "story S5", and say what it exists to do',
      expect: {
        route: '/agents/new',
        data: {
          page: 'agents',
          'agent-id': '',
          check: 'purpose',
          ok: 'true',
        },
      },
      say: `Every agent needs one sentence that says why it exists, because that sentence is what a planner reads when it decides which agent to put at a station. This one is: “${PURPOSE}”`,
    },
    {
      // PARTIALLY expressible. `toggle-advanced` IS a real `data-action`, so
      // opening the drawer is named. What is inside it is not: the catalog
      // chips are `.catalog-chip[data-id][data-kind]`, click-to-add as well as
      // draggable, and neither attribute is one `do` can resolve. `accepts`
      // and `count` are the same drop zone, so one element answers both.
      act: 'Open Advanced and compose the two skills this agent needs',
      do: [{ press: 'toggle-advanced' }],
      expect: {
        route: '/agents/new',
        data: { page: 'agents', accepts: 'skill', count: String(SKILLS.length) },
      },
      say: `Composing is the whole idea: an agent is not written, it is assembled out of skills the library already holds. This one takes ${SKILLS.join(' and ')} — one to look up what the project already knows, one to drive its pages.`,
    },
    {
      // NOT expressible, same cause as beat 4 — the tool chips carry
      // `data-id`/`data-kind`. A separate beat from 5 because
      // `[data-accepts="tool"]` and `[data-accepts="skill"]` are different
      // elements, and folding them together would assert a combination no
      // single element makes.
      act: 'Set the tool fence: this agent may invoke git and Node, and nothing else',
      expect: {
        route: '/agents/new',
        data: { page: 'agents', accepts: 'tool', count: String(TOOLS.length) },
      },
      say: 'The fence is the point of the Advanced drawer. An agent reaches exactly the tools it is given and no others, so the operator states the list rather than discovering it from a transcript later.',
    },
    {
      // Fully expressible as an ASSERTION (no act to name — leaving a zone
      // empty has no control). It is a beat of its own because a fence is a
      // claim about what is ABSENT, and an empty MCP zone is the half of the
      // fence that a defect would quietly fill.
      act: 'Leave the MCP zone empty — the fence is a closed list, not a starting point',
      expect: {
        route: '/agents/new',
        data: { page: 'agents', accepts: 'mcp', count: '0' },
      },
      say: 'This agent talks to a repo and a browser. It has no reason to hold a memory graph or a database connection, so it gets neither. A fence that only ever grows is not a fence.',
    },
    {
      // Fully expressible: `save-agent` is a real `data-action`. The route is
      // the REAL slug rule, confirmed live during authoring — the operator
      // types "story S5" and forge mints `story-s5`, exactly as project create
      // slugs `story-S2` to `story-s2` (S2 beat 3 pins the same rule one
      // object kind along).
      act: 'Save the agent',
      do: [{ press: 'save-agent' }],
      expect: {
        route: '/agents/story-s5',
        data: { page: 'agents', 'agent-id': 'story-s5', 'page-ready': 'true' },
      },
      say: 'Saving mints the agent and lands the operator on its own page. Nothing linked here a moment ago — the route exists because the button was pressed.',
    },
    {
      // Fully expressible. Six is the builder's own contract, not a number
      // this story chose: purpose, skill, guard, process, interactivity,
      // runtime. A saved agent that cannot pass its own readiness panel is not
      // one a Flow should be allowed to schedule.
      act: 'Check the agent is ready — all six readiness checks pass',
      expect: {
        route: '/agents/story-s5',
        data: { page: 'agents', 'agent-id': 'story-s5', 'ready-count': '6' },
      },
      say: 'Readiness is forge refusing to pretend. Six checks, each of which can genuinely fail, and an agent that misses one is an agent that will disappoint a station at three in the morning.',
    },
    {
      // NOT expressible. The ceiling input is
      // `input[data-run-cost-ceiling="true"]` — a bespoke boolean, not a
      // `data-field` — so the operator's act of typing a cap cannot be named.
      // The assertion is on the Run button, which STATES the ceiling that will
      // be in force (`data-run-ceiling`), because a cap the operator cannot
      // read before pressing Run is not a cap they consented to. Live today
      // this reads "10", the policy default.
      act: `Cap what this run may spend at $${RUN_CEILING}`,
      expect: {
        route: '/agents/story-s5',
        data: { page: 'agents', 'agent-id': 'story-s5', 'run-ceiling': RUN_CEILING },
      },
      say: 'A real agent costs real money, so the operator sets the cap before starting the run rather than discovering the bill afterwards — and the button says the figure back to them.',
    },
    {
      // PARTIALLY expressible. `run-agent` IS a real `data-action`, so the
      // dispatch is named; the project picker (`[data-run-project]`) and the
      // inputs box (`[data-run-inputs]`) are bespoke booleans and are not, so
      // choosing mdtoc cannot be said. `run-id` and `run-status` are both on
      // the run panel section, so one element answers both.
      act: 'Run the agent standalone against mdtoc',
      do: [{ press: 'run-agent' }],
      expect: {
        route: '/agents/story-s5',
        data: {
          page: 'agents',
          'agent-id': 'story-s5',
          'run-status': 'running',
          'run-id': '<runId>',
        },
      },
      say: 'Standalone is an agent off the graph: no Flow, no station, just this agent against this project because the operator asked. It is how you find out whether the thing you assembled actually works before you wire it into a pipeline.',
    },
    {
      // Fully expressible. `ledger-count` is the history section's own root,
      // and a SEPARATE beat from 12 on purpose: the count lives on the
      // section and the cost lives on the row, so asserting both at once would
      // ask one element for a combination it does not make.
      act: 'Watch the run land in the agent’s own history',
      expect: {
        route: '/agents/story-s5',
        data: { page: 'agents', 'agent-id': 'story-s5', 'ledger-count': '1' },
      },
      say: 'Every dispatch this agent has ever had is on its own page. One run, one row — the operator never has to go looking through a global log to find out what their own agent has been doing.',
    },
    {
      // Fully expressible, and the beat §3's row exists for. All three keys
      // are the SAME ledger row, so one element answers them together.
      // `ledger-cost-usd` is a `<runCost>` placeholder rather than a figure
      // because the honest assertion is "a real cost is recorded here": the
      // DOM contract says the attribute is OMITTED, never zeroed, when a cost
      // genuinely does not exist, so its PRESENCE with a value is the claim,
      // and a fabricated `0.00` would fail it exactly as it should.
      act: 'Read the row: what it cost, where it ran, and how it ended',
      expect: {
        route: '/agents/story-s5',
        data: {
          page: 'agents',
          'agent-id': 'story-s5',
          'ledger-link-kind': 'standalone',
          'ledger-cost-usd': '<runCost>',
          'run-status': 'done',
        },
      },
      say: 'This is where S5 ends, and the word that matters is honest. The row says the run was a standalone dispatch, that it finished, and what it actually cost — not a zero standing in for a figure nobody recorded. An agent whose page lies about its spend is an agent the operator cannot budget for.',
    },
  ],
};
