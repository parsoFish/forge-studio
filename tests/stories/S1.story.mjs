/**
 * S1 — onboard an existing project (1.0.md §3, row S1).
 *
 * Operator flow: a code repo already sits on disk with no `.forge/`; the
 * operator brings it under forge and gets to a first approved architect plan.
 * Authored interactively with the operator (H6) on 2026-08-29 against
 * `parsoFish/main` a592b1f3. Green expected at M5.
 *
 * GROUND. `projects/gitweave` is a clone of `parsoFish/GitWeave` (Python tests
 * over a Terraform control repo) with **no `.forge/` directory**. That absence
 * is the starting state, not a fault: Studio already discovers the repo and
 * reports it as `health="attention"` / "no .forge/project.json — onboarding is
 * unfinished". The story never creates `.forge/` by hand — the point is that
 * forge creates it. The flow ends at an approved architect plan, which is a
 * real Agent spawn, so `realSpawn` is true and `budget_usd` is declared: the
 * runner refuses to start without `--approve-spend` (H2).
 *
 * ON THE `data-*` KEYS. Every key and value below was copied from the live DOM
 * of a bridge booted from a lane worktree — none is invented. Some of them sit
 * on nested elements (the project card, the onboard section) rather than on
 * `main[data-page]`; since M1-F the runner judges the page root **and its
 * descendants**, which is what `docs/forge-ui-dom-and-harness.md` has always
 * said the contract is.
 *
 * AMENDED 2026-08-30 (M1-C-S1b, bead `forge-8vfn.2.18`) — EXPRESSION ONLY.
 * The ten beats are the ones the operator approved on 2026-08-29; not one
 * `act`, `expect` or `say` changed. What changed is that beats 3–10 now carry
 * the `do` blocks §3.1 gained in M1-F, so the story can PERFORM the
 * form-driven flow it always described instead of stopping at the first
 * button. Where a beat's act has no declared `data-field`/`data-action` to
 * name, or its route segment cannot be bound, the beat says so in a comment
 * and stays unexpressed rather than being narrowed to fit — the operator's
 * 2026-08-29 ruling ("author the true flow") applied to the verbs as it was
 * applied to the assertions. `_1.0/stories/S1.md` names every one of those
 * gaps and its owner.
 */

/** The gate command GitWeave's own repo answers to — `tests/` is pytest. */
const GATE = 'python -m pytest tests/';

/** GitWeave's own README, first line — the north star is the project's, not the story's. */
const NORTH_STAR =
  'A single control repository that configures and weaves together a GitHub organisation using in-repo modules, overlays and provider-native tooling.';

export default {
  id: 'S1',
  ground: { project: 'gitweave', realSpawn: true, budget_usd: 25 },
  docs: { kind: 'tutorial', title: 'Onboard an existing project' },
  beats: [
    {
      act: 'Open Studio on the Projects pillar',
      expect: {
        route: '/projects',
        data: {
          page: 'projects-index',
          'page-ready': 'true',
          'card-id': 'gitweave',
          health: 'attention',
        },
      },
      say: 'The Projects pillar lists every project forge manages. GitWeave is already discovered from disk, but it needs attention: it has no contract yet, so no Flow can be pointed at it.',
    },
    {
      act: 'Click "Onboard a project"',
      expect: {
        route: '/projects/new',
        data: {
          page: 'projects',
          'project-id': 'new',
          'page-ready': 'true',
          section: 'project-onboard',
        },
      },
      say: 'Onboarding asks for the few things a Factory needs before it can build a repo: what to call it, the quality gate that judges its work, and the north star that tells a planner what the project is for.',
    },
    {
      // Fully expressible. Every handle below was verified live by M1-F on
      // this exact form; `proof.story.mjs` beat 5 performs the identical six
      // steps and is green for a project forge has never seen.
      act: 'Fill in the name, the quality gate and the north star — and under Advanced, the repo path — then press "Onboard project →"',
      do: [
        { fill: 'project-name', with: 'gitweave' },
        { fill: 'quality-gate', with: GATE },
        { fill: 'north-star', with: NORTH_STAR },
        { press: 'toggle-onboard-advanced' },
        { fill: 'repo-path', with: 'projects/gitweave' },
        { press: 'onboard-project' },
      ],
      expect: {
        route: '/projects/gitweave',
        data: {
          page: 'projects',
          'project-id': 'gitweave',
          'page-ready': 'true',
          'preflight-status': 'hard-fail',
          'checklist-row': 'contract',
          'checklist-status': 'absent',
        },
      },
      say: 'Registering the project lands the operator on its page, where forge immediately measures GitWeave against the project contract and reports the result honestly: a hard fail. The Contract Buildout checklist says why — the contract itself is absent, and so are the secrets, demo and roadmap stages. Only the instructions are present, read from the repo\'s own CLAUDE.md. No Flow can be pointed at a project in this state.',
    },
    {
      // Partly expressible. `run-onboarding-agent` is a real `data-action`.
      // The two brief fields are NOT: `OnboardWithAgent.tsx` declares them as
      // `data-onboard-input="northStar"|"gateCommand"`, and `do`'s fill verb
      // resolves `[data-field=...]` only — so the story names the product's
      // own declared VALUES and goes red on the attribute, rather than
      // dropping the brief and quietly dispatching an unbriefed agent while
      // the act text and the generated tutorial both say it was briefed.
      // The `<summary>` that opens `[data-section="onboard-brief"]` carries no
      // `data-action` either, unlike `toggle-onboard-advanced` on the very
      // next panel — so there is no way to open the brief before filling it.
      act: 'Open "Brief the agent", give it the north star and the gate command, and press "Run onboarding agent"',
      do: [
        { fill: 'northStar', with: NORTH_STAR },
        { fill: 'gateCommand', with: GATE },
        { press: 'run-onboarding-agent' },
      ],
      expect: {
        route: '/projects/gitweave',
        data: {
          section: 'onboard-with-agent',
          'onboard-run-status': 'running',
          'onboard-session-id': '<sessionId>',
          'onboard-attaching': 'false',
        },
      },
      say: 'The operator does not fill the contract in by hand. An Agent does it, briefed with the two things only the operator knows: what the project is for, and the command that tells the truth about whether it works.',
    },
    {
      // Fully expressible. The press navigates to
      // `/sessions/onboarding/<sid>?project=gitweave`; the runner matches on
      // pathname, and `<sessionId>` is bound by beat 4's
      // `data-onboard-session-id` — the one place in Studio where a minted
      // session id is rendered before the navigation that consumes it.
      act: 'Follow "View onboarding session"',
      do: [{ press: 'view-onboarding-session' }],
      expect: {
        route: '/sessions/onboarding/<sessionId>',
        data: {
          page: 'session',
          'page-ready': 'true',
          'session-kind': 'onboarding',
          'session-stage': 'contract',
          'buildout-mode': 'checklist',
          'buildout-row-count': '5',
        },
      },
      say: 'The onboarding session opens on the shared session surface. Its live artifact is the same five-stage Contract Buildout the project page shows — contract, instructions, secrets, demo, roadmap — so the operator watches the Agent close the gaps in the same vocabulary the gate will judge.',
    },
    {
      // Partly expressible. Answering IS expressible —
      // `[data-field="session-answer"]` + `[data-action="submit-answers"]`.
      // Walking the stages is NOT: `StageSelector.tsx` renders one
      // `[data-action="select-stage"]` per stage and distinguishes them by
      // `data-stage`, while `do`'s press verb resolves `[data-action=...]`
      // and takes `.first()` — so a beat cannot say WHICH stage to open, and
      // this beat's `buildout-active-stage: 'secrets'` is unreachable. A
      // generic `select-stage` press would open whichever stage happens to be
      // first and pretend it was `secrets`, so the story does not write one.
      act: 'Answer the Agent\'s questions about the quality gate and what GitWeave must never touch, stage by stage, until the contract and secrets stages read present',
      do: [
        { fill: 'session-answer', with: `The quality gate is \`${GATE}\`. Never touch infra/ state or config/orgs/*.yaml — GitWeave applies those to a real GitHub organisation.` },
        { press: 'submit-answers' },
      ],
      expect: {
        route: '/sessions/onboarding/<sessionId>',
        data: {
          'session-kind': 'onboarding',
          'session-stage': 'secrets',
          'buildout-mode': 'detail',
          'buildout-active-stage': 'secrets',
          'stage-detail-status': 'present',
        },
      },
      say: 'This is the part only a human can supply. The Agent runs the contract criteria and invokes the Skills built for the purpose, but the decisions — what the done-signal is, which files are untouchable, which credentials the acceptance tier needs — are the operator\'s. The secrets stage names the environment variables and never their values.',
    },
    {
      // NOT expressible, and deliberately left so — two independent gaps.
      // (a) `<demoSessionId>` cannot be bound. The demo builder is started by
      //     a POST whose handler `router.push`es `/sessions/demo/<sid>` in the
      //     same click (`ContractResolutionPanel.tsx`, `projects/[id]/page.tsx`),
      //     so the id is never rendered as a `data-*` value a prior beat could
      //     observe. Binding it off `HomeSessionsStrip`'s `data-session-id`
      //     would take whichever session sorts first — the fail-open shape.
      // (b) There is no handle to press. `ContractBuildout.tsx`'s stage detail
      //     declares `data-stage-detail-state|stage|status` and no
      //     `data-action` at all, so "hand it to the demo builder" has no
      //     declared control on the onboarding session surface;
      //     `[data-action="launch-demo-builder"]` lives on the project page.
      act: 'Select the demo stage and hand it to the demo builder — the heavy one — then come back when it has finished',
      expect: {
        route: '/sessions/demo/<demoSessionId>',
        data: {
          page: 'session',
          'page-ready': 'true',
          'session-kind': 'demo',
          'session-phase': 'complete',
        },
      },
      say: 'Not every contract component is a question and an answer. The demo process is a build in its own right, so it gets its own long-running session rather than blocking the onboarding one. The operator can leave it and come back — the session is the record, not the terminal it was started from.',
    },
    {
      // Fully expressible, but only because the exit is itself a
      // `data-action`. `do` steps run on the page the operator is STANDING on,
      // before this beat's route is reached, so a "go there, then act" beat is
      // expressible only when the navigation is a step too —
      // `[data-action="back-to-project"]` renders on every session shell in
      // every phase (W7-A2), so it is.
      act: 'Return to the project, apply the auto-fixable clauses and record a decision on the ones that need your judgement',
      do: [
        { press: 'back-to-project' },
        { press: 'apply-preflight-auto' },
        { press: 'apply-clause-decision' },
      ],
      expect: {
        route: '/projects/gitweave',
        data: {
          page: 'projects',
          'project-id': 'gitweave',
          'preflight-status': 'ok',
          'flow-ready': 'true',
          'resolution-failing-count': '0',
        },
      },
      say: 'Preflight is MET. GitWeave now has a contract forge can hold it to, and the project is Flow-ready: the gates downstream have something real to judge against.',
    },
    {
      // NOT expressible — the same gap as beat 7, one surface along.
      // `<architectSessionId>` cannot be bound: `ProjectArchitectEntry.tsx`
      // opens `NewIdeaBox`, whose `start-architect` POST returns the id
      // straight into `router.push('/sessions/architect/<sid>')`. The one
      // element that DOES render it — `[data-action="resume-architect-session"]
      // [data-session-id]` — appears only once an in-flight session already
      // exists, which is after this beat, not before it. The route resolves
      // before any `do` step runs, so no press on this beat can supply it.
      act: 'Press "Architect →" and describe the first piece of work',
      expect: {
        route: '/sessions/architect/<architectSessionId>',
        data: {
          page: 'session',
          'page-ready': 'true',
          'session-kind': 'architect',
          'session-phase': 'awaiting-verdict',
        },
      },
      say: 'With a contract in place the Architect can plan. It interviews the operator, reads the project, and produces a roadmap for review — the first Gate a human stands at.',
    },
    {
      // Fully expressible. `/artifact` is reached by a query-string href, so
      // the runner's `a[href="/artifact"]` fallback would not match it — the
      // navigation is a `do` step (`[data-action="open-plan"]`,
      // `SessionArchitectPanel.tsx`) and the approval follows it on the page
      // it lands on (`[data-action="approve-plan"]`, `PlanGate.tsx`).
      act: 'Read the plan and press Approve',
      do: [{ press: 'open-plan' }, { press: 'approve-plan' }],
      expect: {
        route: '/artifact',
        data: {
          'section': 'architect-plan',
          'architect-phase': 'committed',
          'gate-armed': 'false',
          'plan-mode': 'gate',
        },
      },
      say: 'The plan is approved and committed. An existing repo that forge knew nothing about half an hour ago is now an onboarded project with a contract, a demo, a knowledge profile and an approved roadmap — ready for a Factory to build.',
    },
  ],
};
