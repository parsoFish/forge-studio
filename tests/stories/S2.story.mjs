/**
 * S2 — create a new project from scratch (1.0.md §3, row S2).
 *
 * Operator flow: nothing exists yet. The operator picks a starter, forge
 * scaffolds a real repo from it, the project comes out contract-ready, and the
 * first Flow run on it reaches the plan gate. Authored 2026-08-30 against
 * `parsoFish/main` f28323f4, with the operator (H6). Green expected at M5.
 *
 * HOW THIS DIFFERS FROM S1, AND WHY IT MATTERS. S1 brings a repo that already
 * sits on disk under forge; it is red at beat 3 because project discovery is a
 * disk scan, so the onboarding form answers `409 already exists` for every
 * project the Projects pillar lists (`forge-8vfn.5.3`). S2 is the greenfield
 * path — the case that 409 does not block — so it uses the OTHER door on
 * `/projects/new`: `[data-section="project-create"]`, whose own copy promises
 * "a greenfield repo from a framework template — contract-green and ready for
 * the first architect run". That promise is what beats 4 and 5 hold it to.
 *
 * GROUND. `story-s2` does not exist when the story starts; beat 3 creates it
 * from the `typescript-cli` starter. The `story-` prefix is the fixture
 * namespace `scripts/stories/sweep.mjs` owns, so the crash-safe leading sweep
 * removes the repo and its Brain 3 profile however a run dies. The flow ends
 * at a real architect run, so `realSpawn` is true and `budget_usd` is
 * declared: the runner refuses to start without `--approve-spend` (H2). Beat 7
 * sets the same figure as this run's own kickoff ceiling, so the ground's
 * budget and the product's ceiling are one number, not two.
 *
 * ON THE `data-*` KEYS. Every key and value below was copied from the live DOM
 * of a bridge booted from this lane's worktree, except beat 8's session card,
 * whose attribute set is transcribed from `docs/forge-ui-dom-and-harness.md`
 * (observing it live costs a real architect spawn). None is invented. Where
 * the page root does not carry a key, the keys it does not carry are answered
 * together by ONE element — the nested-read rule §3.1 states — so a beat never
 * asserts a combination no single element makes.
 *
 * WHERE A BEAT CANNOT BE EXPRESSED it says so in a comment and stands anyway,
 * per the operator's 2026-08-29 ruling ("author the true flow"). Beats 7 and 9
 * route to `/sessions/architect/<architectSessionId>`, and that segment cannot
 * be bound: `start-architect`'s POST returns the id straight into a
 * `router.push`, so no earlier beat can observe it — bead `forge-8vfn.5.5`,
 * already filed, not re-diagnosed here. `_1.0/stories/S2.md` names every gap
 * and its owner.
 */

/** The project's own reason to exist — what the operator types into the create form. */
const NORTH_STAR =
  'A command-line tool that reports how long each stage of a build took, so a slow pipeline reads at a glance.';

/** The first piece of work the operator asks the Architect to plan. */
const IDEA =
  'Add a --json output mode so the stage timings can be consumed by CI, with a documented schema and a test that pins it.';

/** This run's ceiling, in dollars — the same figure the ground declares. */
const CEILING = '25';

export default {
  id: 'S2',
  ground: { project: 'story-s2', realSpawn: true, budget_usd: 25 },
  docs: { kind: 'tutorial', title: 'Create a new project from scratch' },
  beats: [
    {
      act: 'Open Studio on the Projects pillar',
      expect: {
        route: '/projects',
        data: { page: 'projects-index', 'page-ready': 'true' },
      },
      say: 'The Projects pillar lists every project forge manages. The tool this story is about is not here — it does not exist yet, on disk or anywhere else. That is the starting state: no repo, no contract, nothing to point a Flow at.',
    },
    {
      // Fully expressible. `/projects` carries TWO CTAs at the same href —
      // `[data-action="onboard-project-cta"]` and
      // `[data-action="create-project-cta"]`. The runner's link fallback would
      // resolve whichever comes first; the operator presses the greenfield
      // one, so the beat names it.
      act: 'Press "Start a greenfield project"',
      do: [{ press: 'create-project-cta' }],
      expect: {
        route: '/projects/new',
        data: {
          page: 'projects',
          'project-id': 'new',
          'page-ready': 'true',
          section: 'project-create',
          'app-type-count': '3',
        },
      },
      say: 'One page hosts both doors into forge: register a repo that already exists, or scaffold a new one. Three starters ship with forge, and the operator picks the one shaped like the thing they are about to build.',
    },
    {
      // Fully expressible. `create-app-type` is a <select>; `do`'s fill verb
      // selects an option when the handle resolves to one. The route segment
      // is forge's own slug of the typed name — the operator types
      // `story-S2`, forge mints `story-s2` — so this beat pins the slug rule
      // as well as the creation.
      act: 'Name it, say what it is for, pick the "typescript-cli" starter, and press "Create project"',
      do: [
        { fill: 'create-name', with: 'story-S2' },
        { fill: 'create-north-star', with: NORTH_STAR },
        { fill: 'create-app-type', with: 'typescript-cli' },
        { press: 'create-project' },
      ],
      expect: {
        route: '/projects/story-s2',
        data: { page: 'projects', 'project-id': 'story-s2', 'page-ready': 'true' },
      },
      say: 'Forge writes the repo from the starter, makes the first commit in it, and lands the operator on the project page. Nothing linked here a moment ago — the route exists because the button was pressed.',
    },
    {
      // Fully expressible. `preflight-status` and `flow-ready` are the SAME
      // element (the readiness panel), so the pair is answerable by one
      // element as the nested-read rule requires.
      act: 'Check the contract came out green, before pointing a Flow at it',
      expect: {
        route: '/projects/story-s2',
        data: {
          page: 'projects',
          'project-id': 'story-s2',
          'preflight-status': 'ok',
          'flow-ready': 'true',
        },
      },
      say: 'This is the promise a starter exists to keep. Onboarding an existing repo needs an Agent to fill the contract in, question by question; creating one from a starter should not, because forge wrote every file itself. So the operator checks the two things that decide it: preflight MET, and the project ready for a Flow.',
    },
    {
      // Fully expressible, and deliberately a beat of its own rather than
      // three keys on beat 4: `resolution-failing-count` lives on
      // `[data-section="contract-resolution"]`, NOT on the readiness panel
      // beat 4 reads. Folding them together would assert a combination no
      // single element makes — narrowing the read scope, not the story.
      act: 'Look at what forge says is still unresolved',
      expect: {
        route: '/projects/story-s2',
        data: {
          page: 'projects',
          'project-id': 'story-s2',
          section: 'contract-resolution',
          'resolution-failing-count': '0',
        },
      },
      say: 'The panel that catches a half-onboarded repo has nothing to show. Every clause the forge project contract asks about was answered by the starter, so there is no gap for the operator to close by hand and no Agent to dispatch at one.',
    },
    {
      // Fully expressible, but only because the exit is itself a
      // `data-action`: `start-work-architect` is an <a> whose href carries a
      // query string (`/architect/new?project=story-s2`), which the runner's
      // `a[href="<route>"]` fallback cannot match. The three nested keys all
      // live on `[data-section="new-idea"]`.
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
      say: 'With a contract in place the Architect can plan. Studio carries the new project through, so the only thing still missing is the one thing forge cannot know: what the operator wants built first.',
    },
    {
      // NOT expressible, and left so deliberately. `<architectSessionId>`
      // cannot be bound: `NewIdeaBox`'s `start-architect` POST returns the id
      // straight into `router.push('/sessions/architect/<sid>')`, so the id is
      // never rendered as a `data-*` value an earlier beat could observe. The
      // runner resolves a beat's route BEFORE its `do` steps run, so no press
      // on this beat can supply it either. Bead `forge-8vfn.5.5`. The `do`
      // steps are written out regardless — they are the operator's real
      // actions, and dropping them would make the generated tutorial claim a
      // run was started with no ceiling on it.
      act: 'Describe the first piece of work, cap what this run may spend, and press "Start architect"',
      do: [
        { fill: 'idea', with: IDEA },
        { fill: 'cost-ceiling-usd', with: CEILING },
        { press: 'start-architect' },
      ],
      expect: {
        route: '/sessions/architect/<architectSessionId>',
        data: {
          page: 'session',
          'page-ready': 'true',
          'session-kind': 'architect',
          'session-phase': 'working',
        },
      },
      say: 'The Architect is a real Agent and a real Agent costs money, so the operator sets this run\'s ceiling before starting it rather than discovering the bill afterwards. Pressing Start mints a session and opens it.',
    },
    {
      // Fully expressible. `/monitor` is a nav pillar, so the runner reaches
      // it by real navigation with no binding. Only ONE nested key is
      // asserted, and on purpose: every other attribute on the session card
      // (`data-session-phase`, `data-needs-you`) changes while the Agent runs,
      // so pinning one would be asserting the instant the browser happened to
      // look rather than the product. The card's attribute set is transcribed
      // from `docs/forge-ui-dom-and-harness.md` (`div[data-session-card]
      // [data-session-kind][data-session-id][data-session-phase]
      // [data-needs-you][data-session-state]`) — the only expectation in this
      // story not copied from a live page, because observing it costs a spawn.
      act: 'While it works, check Monitor',
      expect: {
        route: '/monitor',
        data: { page: 'monitor', 'page-ready': 'true', 'session-kind': 'architect' },
      },
      say: 'Monitor is the one surface that answers "what is running, and what is stuck". The architect run is on it — a Flow run against a project that did not exist a few minutes ago, which is the whole point of S2.',
    },
    {
      // NOT expressible — the same unbound segment as beat 7, and for the
      // same reason. What the beat's `do` steps CAN say is the way back in:
      // the Monitor card wraps `a[data-action="open-session"]`, and answering
      // is `[data-field="session-answer"]` + `[data-action="submit-answers"]`
      // on the shared session surface. Bead `forge-8vfn.5.5`.
      act: 'Open the session again and answer the Architect\'s questions about the project',
      do: [
        { press: 'open-session' },
        {
          fill: 'session-answer',
          with: 'The gate command is `npm test`. The timings come from the build tool\'s own output — never re-implement a build. Breaking the existing human-readable output is not acceptable; --json is additive.',
        },
        { press: 'submit-answers' },
      ],
      expect: {
        route: '/sessions/architect/<architectSessionId>',
        data: {
          page: 'session',
          'page-ready': 'true',
          'session-kind': 'architect',
          'session-phase': 'awaiting-verdict',
        },
      },
      say: 'The Architect interviews before it plans. The operator supplies the context only they have — what "done" means, what must not break — and the session moves to awaiting a verdict once the plan is drafted.',
    },
    {
      // Fully expressible once the session route resolves: `/artifact` is
      // reached by a query-string href, so the runner's `a[href="/artifact"]`
      // fallback cannot match it and the navigation is a `do` step
      // (`open-plan`). The four nested keys are the plan gate's own root.
      act: 'Open the plan and stand at the gate',
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
      say: 'This is the plan gate — the first Gate a human stands at, and where S2 ends. A starter became a repo, the repo became a contract-ready project, and the first Flow run on it reached the gate with a plan waiting on a decision. Nothing is approved yet: that decision is the operator\'s, and S10 is the story that makes it.',
    },
  ],
};
