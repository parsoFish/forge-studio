/**
 * S1 — onboard an existing project (1.0.md §3, row S1).
 *
 * Operator flow: a code repo already sits on disk with no `.forge/`; the
 * operator brings it under forge and gets to a first approved architect plan.
 * Authored interactively with the operator (H6) on 2026-08-29 against
 * `parsoFish/main` a592b1f3. Green expected at M5.
 *
 * GROUND. `projects/gitweave` is a clone of `parsoFish/GitWeave` (Python) with
 * **no `.forge/` directory**. That absence is the starting state, not a fault:
 * Studio already discovers the repo and reports it as
 * `health="attention"` / "no .forge/project.json — onboarding is unfinished".
 * The story never creates `.forge/` by hand — the point is that forge creates
 * it. The flow ends at an approved architect plan, which is a real Agent
 * spawn, so `realSpawn` is true and `budget_usd` is declared: the runner
 * refuses to start without `--approve-spend` (H2).
 *
 * ON THE `data-*` KEYS. Every key and value below was copied from the live DOM
 * of a bridge booted from this worktree — none is invented. Some of them sit
 * on nested elements (the project card, the onboard section) rather than on
 * `main[data-page]`, and today's runner reads only `main`'s own attributes.
 * That is deliberate, and it is the operator's ruling of 2026-08-29: a beat
 * records what the operator observes, and the story outlives the runner.
 * Narrowing these assertions to fit today's harness would be bending the story
 * to the product one layer down. Where this story goes red on a harness limit
 * rather than a product gap, `_1.0/stories/S1.md` says so and names the owner.
 */
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
      act: 'Fill in the name, the quality gate and the north star — and under Advanced, the repo path — then press "Onboard project →"',
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
      act: 'Open "Brief the agent", give it the north star and the gate command, and press "Run onboarding agent"',
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
      act: 'Follow "View onboarding session"',
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
      act: 'Answer the Agent\'s questions about the quality gate and what GitWeave must never touch, stage by stage, until the contract and secrets stages read present',
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
      act: 'Return to the project, apply the auto-fixable clauses and record a decision on the ones that need your judgement',
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
      act: 'Read the plan and press Approve',
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
