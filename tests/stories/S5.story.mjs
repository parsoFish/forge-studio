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
 * So beat 13 asserts the recorded cost itself, on the row, beside the link
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
 * approved by the operator for the S5/S6/S7 batch on 2026-08-30). Beat 10 sets
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
 * values beats 9 and 10 hold the product to different targets on.
 *
 * AMENDMENT 1 — what changed, and why (operator ruling 93, 2026-09-04). As
 * authored, beats 3, 4, 5, 6 and 9 carried NO `do` block, and that was this
 * story's whole finding: `/agents/new` and `/agents/<id>` declared ZERO
 * `data-field` on any input and exactly FOUR `data-action`s —
 * `generate-instructions`, `toggle-advanced`, `save-agent`, `run-agent`
 * (verified live at authoring: 10 inputs on the builder, 0 with `data-field`).
 * `do`'s verbs resolve `[data-field="…"]` and `[data-action="…"]` and nothing
 * else, so NAMING the agent, COMPOSING its skills, FENCING its tools and
 * CAPPING its spend — the acts §3's row actually names — had no handle to
 * name, and inventing one would have been inventing the contract this story
 * exists to hold the product to. Bead `forge-8vfn.5.15` shipped those handles:
 * `[data-action="starter-<id>"]` on the four starters, `add-<kind>-<id>` on
 * every catalog chip (the KIND is in the action name, so composing a skill and
 * fencing a tool stay different acts on the same widget), and `data-field` on
 * agent-name, purpose, instructions, interactivity, run-project and
 * run-cost-ceiling. Each beat below therefore now carries the `do` its act
 * ALREADY described. No act, no `say` and no `expect` was reworded; nothing
 * was removed.
 *
 * ONE BEAT WAS ADDED — beat 4, writing the instructions body. Beat 9 asserts
 * `data-ready-count="6"`, and the six checks are purpose / skill / guard /
 * process / interactivity / runtime; `BLANK_STATE` already ships a guard, an
 * interactivity sentence and a model, the beats below meet purpose and skill,
 * and `process` — the instructions body — was the one check NO authored
 * beat's act met. Measured against the real components, not reasoned:
 * `apps/studio/components/studio/agent-builder/agent-builder-handles.test.ts`,
 * the test named "S5 park measurement". The operator ruled the act belongs in
 * a beat of its own rather than folded into beat 3, because an operator writes
 * the instructions after saying what the agent is for and before deciding what
 * it is made of. Beats 4–12 renumbered to 5–13.
 *
 * WHERE A BEAT STILL CANNOT BE EXPRESSED it says so and stands anyway, per the
 * operator's 2026-08-29 ruling ("author the true flow"): beat 7 leaves the MCP
 * zone empty, and leaving a zone empty has no control to press.
 * `_1.0/stories/S5.md` names every gap and its owner.
 */

/** What this agent exists to do — what the operator types into the builder. */
const PURPOSE =
  'Read a project’s own docs and its live pages, and report every place the docs describe a page that no longer exists.';

/**
 * How it does it — the instructions body, typed into the builder's own
 * Instructions field. `[data-field="instructions"]` binds to the agent's
 * `process`, which is exactly what the readiness panel's `process` check reads
 * (`apps/studio/lib/agent-readiness.ts`), so this text is what turns that check
 * over. Three lines, because the field asks for steps rather than a restatement
 * of the purpose — read, check, report.
 */
const INSTRUCTIONS = [
  'Read every page under docs/ and list the routes each one claims exists.',
  'Open each of those routes in the running app and record whether it resolves.',
  'Report every doc line whose route no longer resolves, naming the file and the line.',
].join('\n');

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
      // Expressible since bead `forge-8vfn.5.15`. Three acts in one sentence,
      // three steps: the starter is `[data-action="starter-blank"]` (it used to
      // carry `data-starter-option` alone, which no `do` verb resolves), and the
      // name and purpose now carry `data-field`. ORDER IS LOAD-BEARING and it is
      // measured, not assumed: `/agents/new` mounts the starter picker ALONE, so
      // `[data-field="purpose"]` does not exist in the document until the starter
      // is pressed — `agent-name` does, because it lives in the agent header
      // above the picker branch. The beat still asserts the STATE the act
      // produces rather than the typing: the readiness panel's purpose row
      // ticking over. `check` and `ok` are the same <li>, so one element answers
      // both.
      act: 'Start from the Blank agent starter, name it "story S5", and say what it exists to do',
      do: [
        { press: 'starter-blank' },
        { fill: 'agent-name', with: 'story S5' },
        { fill: 'purpose', with: PURPOSE },
      ],
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
      // ADDED BY AMENDMENT 1 (operator ruling 93). `[data-field="instructions"]`
      // is the Instructions textarea, and it binds to the agent's `process` —
      // which is what the readiness panel's `process` check reads. This beat
      // exists because beat 9 asserts all six readiness checks pass and
      // `process` is the one check no other beat's act meets: the story names
      // naming, purposing, composing, fencing, saving, checking, capping and
      // running, and none of those writes down HOW the agent works. It sits
      // here, between saying what the agent is for and deciding what it is made
      // of, because that is the order the operator does it in. `check` and `ok`
      // are the same <li>, as on beat 3.
      act: 'Write the instructions: what this agent does, step by step',
      do: [{ fill: 'instructions', with: INSTRUCTIONS }],
      expect: {
        route: '/agents/new',
        data: {
          page: 'agents',
          'agent-id': '',
          check: 'process',
          ok: 'true',
        },
      },
      say: 'The purpose says why this agent exists; the instructions say how it works, and forge hands that body to the agent as its brief at dispatch time. An agent with no instructions is an agent told to improvise, which is why readiness refuses to pass without one — the Generate draft button beside the field is an offer, not a substitute.',
    },
    {
      // Fully expressible since bead `forge-8vfn.5.15`. `toggle-advanced` was
      // always a real `data-action`, but it is ABSENT until a starter is
      // pressed — the M1-H run died on exactly that, timing out on a control
      // that had not mounted rather than one that was slow, which is why beat 3
      // presses the starter before this beat reaches the drawer. What is inside
      // was the other half: the catalog chips carried `.catalog-chip[data-id]
      // [data-kind]` — CSS identity, which no `do` verb resolves — and now carry
      // `add-<kind>-<id>` as well. The two chip presses are the composition act
      // itself; the drawer is opened first because the drop zone this beat
      // asserts on lives inside it. `accepts` and `count` are the same drop
      // zone, so one element answers both.
      act: 'Open Advanced and compose the two skills this agent needs',
      do: [
        { press: 'toggle-advanced' },
        ...SKILLS.map((id) => ({ press: `add-skill-${id}` })),
      ],
      expect: {
        route: '/agents/new',
        data: { page: 'agents', accepts: 'skill', count: String(SKILLS.length) },
      },
      say: `Composing is the whole idea: an agent is not written, it is assembled out of skills the library already holds. This one takes ${SKILLS.join(' and ')} — one to look up what the project already knows, one to drive its pages.`,
    },
    {
      // Expressible on the same handles as beat 5, and the KIND is in the
      // action name on purpose: `add-tool-git` and `add-skill-git` are
      // different presses, so no beat can fence a tool believing it composed a
      // skill. Still a separate beat from 5 because `[data-accepts="tool"]` and
      // `[data-accepts="skill"]` are different elements, and folding them
      // together would assert a combination no single element makes. The drawer
      // is already open from beat 5, so this beat is the two presses alone.
      act: 'Set the tool fence: this agent may invoke git and Node, and nothing else',
      do: TOOLS.map((id) => ({ press: `add-tool-${id}` })),
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
      // Expressible since bead `forge-8vfn.5.15`: the ceiling input carried
      // `data-run-cost-ceiling` alone — a bespoke boolean marker, which is
      // identity and not a `fill` handle — and now carries `data-field` beside
      // it. Both stay. The assertion is still on the RUN BUTTON rather than on
      // the input, because a cap the operator cannot read before pressing Run
      // is not a cap they consented to, and `data-run-ceiling` is the figure
      // that will actually be dispatched: it resolves through
      // `costCeilingEnforceable`, so a loop strategy that cannot enforce a cap
      // reads back empty rather than echoing what was typed. Before this bead
      // the value was "10", the policy default, because nothing could type one.
      act: `Cap what this run may spend at $${RUN_CEILING}`,
      do: [{ fill: 'run-cost-ceiling', with: RUN_CEILING }],
      expect: {
        route: '/agents/story-s5',
        data: { page: 'agents', 'agent-id': 'story-s5', 'run-ceiling': RUN_CEILING },
      },
      say: 'A real agent costs real money, so the operator sets the cap before starting the run rather than discovering the bill afterwards — and the button says the figure back to them.',
    },
    {
      // Fully expressible since bead `forge-8vfn.5.15`. `run-agent` was always a
      // real `data-action`, but the project picker was `[data-run-project]`
      // alone — a bespoke boolean — so CHOOSING mdtoc could not be said, and a
      // press on its own would have dispatched against "no project" while the
      // act sentence claimed otherwise: green for the wrong reason. The picker
      // now carries `data-field="run-project"`, and `fill` sets a <select> with
      // `selectOption`, so the ground this story declares is the ground the run
      // actually gets. The inputs box (`[data-run-inputs]`) is still a bespoke
      // boolean, and this beat hands no inputs, so nothing is lost. `run-id` and
      // `run-status` are both on the run panel section, so one element answers
      // both.
      act: 'Run the agent standalone against mdtoc',
      do: [
        { fill: 'run-project', with: 'mdtoc' },
        { press: 'run-agent' },
      ],
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
      // and a SEPARATE beat from 13 on purpose: the count lives on the
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
