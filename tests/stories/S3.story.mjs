/**
 * S3 — reset a project contract (1.0.md §3, row S3).
 *
 * Operator flow: a project forge has managed for months has drifted away from
 * the contract every NEW project is built to. The operator rebuilds its
 * mechanisms from the current contract template — `.forge/project.json`, the
 * project skills, `testProcess`/`demoProcess`/`releaseProcess` — while the
 * three things forge could never regenerate survive untouched: the north star,
 * the instructions, and the secrets. Preflight comes out MET and a drift
 * report says what moved. Authored 2026-08-30 against `parsoFish/main`
 * `da566d8b`, with the operator (H6). Green expected at M5.
 *
 * THE CAPABILITY THIS STORY ASSERTS DOES NOT EXIST YET, and that is the point.
 * `forge project reset` + Studio's "Rebuild contract" land in the projects
 * lane at M4 (1.0.md §3, S3's row). So beat 5 presses a control the product
 * does not render and the story is red from there down. It is NOT re-expressed
 * against the surfaces that happen to exist today: bending a story to the
 * product is what §4 M1 Lane C forbids, and this story exists to hold M4 to
 * the flow, not to describe M1.
 *
 * WHY THIS GROUND. `terraform-provider-betterado` is the oldest project forge
 * manages and the only one that shows the drift with its own DOM. Its contract
 * BINDS NINE PROJECT SKILLS — ado-api-explorer, ado-browser-inspector,
 * ado-demo, resource-scaffolder, schema-refactor, tfplugindocs-gen,
 * tf-acceptance-test-author, ado-release-explorer, breaking-change-detector —
 * and Studio resolves NONE of them: every chip reads
 * `[data-resolved="missing"][data-skill-source="missing"]`, live, on this
 * lane's own bridge. They are on disk; they sit under the project's own
 * `forge/skills/`, the layout it was onboarded to. `projects/mdtoc`, onboarded
 * later, keeps its one skill at `.forge/skills/` and resolves
 * `[data-resolved="ok"][data-skill-source="project"]` — the value beat 6
 * expects, copied from mdtoc's live page rather than invented. Nine dead
 * bindings against one live one IS the drift, and it is the operator's reason
 * to reset.
 *
 * H4 NOTE, re-derived rather than assumed. PR #71 on
 * `parsoFish/terraform-provider-betterado` is still OPEN on 2026-08-30, and
 * the brief says an unmerged #71 makes its branch the "before". It does not
 * matter here: #71 touches 26 files and every one is under `docs/` — zero
 * changes to `.forge/`. The contract this story resets is byte-identical on
 * `main` and on the branch, so the ground is the repo as it stands.
 *
 * ON THE `data-*` KEYS. Every key and value below was copied from the live DOM
 * of a bridge booted from this lane's worktree — `/projects` and
 * `/projects/terraform-provider-betterado` observed directly, `resolved: 'ok'`
 * / `skill-source: 'project'` from `/projects/mdtoc`, and the onboarding
 * session pair (`onboard-run-status: 'running'`, `session-kind: 'onboarding'`)
 * transcribed from `docs/forge-ui-dom-and-harness.md` and S1's own worked
 * beats, because observing them live costs a real spawn. None is invented.
 * Where the page root does not carry a key, the keys it does not carry are
 * answered together by ONE element, per §3.1's nested-read rule.
 *
 * THE DRIFT REPORT HAS NO HANDLE, and the story does not invent one. §3 asks
 * for "a drift report of what changed"; nothing on the project page declares a
 * `data-*` for it, and the handbook forbids inventing an attribute a page does
 * not carry. So the drift report is the second half of beat 5's act and is
 * named in its narration, and `_1.0/stories/S3.md` records it as a surface M4
 * must build. The beat still fails on a real key: after a rebuild from the
 * current template nothing is left unresolved, and today
 * `[data-section="contract-resolution"]` reads
 * `[data-resolution-failing-count="1"][data-resolution-agent-count="1"]`.
 *
 * WHY THIS STORY COSTS MONEY. §3 names S3's owning packages as **projects AND
 * sessions**, and the sessions half is beats 11-12: a template can regenerate
 * the mechanisms forge owns, but it cannot write `ado-api-explorer` for an
 * Azure DevOps provider. The re-derivation is an Agent's job, so `realSpawn`
 * is true and `budget_usd` is declared, and the runner refuses to start
 * without `--approve-spend` (H2). The spend gate is evaluated before any
 * dispatch, so a run that dies at beat 5 — as this one does today — spends $0.
 */

/** The project's own north star, verbatim from its `.forge/project.json` — the
 *  first of the three things a rebuild must preserve, so the brief hands the
 *  agent back exactly what the contract already says rather than a new one. */
const NORTH_STAR =
  'Feature complete ADO provider that has data and resources defined for all resources available in the ADO API';

/** The project's own quality gate, verbatim from `.forge/quality_gate_cmd`. */
const GATE = 'go test -tags all -count=1 ./azuredevops/internal/service/servicehook/...';

/** This run's ceiling, in dollars — the same figure the ground declares. */
const CEILING = 25;

export default {
  id: 'S3',
  ground: { project: 'terraform-provider-betterado', realSpawn: true, budget_usd: CEILING },
  docs: { kind: 'how-to', title: 'Reset a project contract' },
  beats: [
    {
      // Fully expressible. `card-id` and `health` are the same <a> card, so
      // the pair is answerable by one element.
      act: 'Open Studio on the Projects pillar',
      expect: {
        route: '/projects',
        data: {
          page: 'projects-index',
          'page-ready': 'true',
          'card-id': 'terraform-provider-betterado',
          health: 'healthy',
        },
      },
      say: 'The Projects pillar lists every project forge manages. The one this story is about has been here longest, and the pillar says it is healthy — which is true of the repo and no longer true of the contract forge builds against it.',
    },
    {
      // Fully expressible. The card is a real <a href>, so the runner reaches
      // the page by ordinary navigation with no `do` step.
      act: 'Open the project',
      expect: {
        route: '/projects/terraform-provider-betterado',
        data: {
          page: 'projects',
          'project-id': 'terraform-provider-betterado',
          'page-ready': 'true',
        },
      },
      say: 'The project page is where the contract lives: what forge tests with, what it demos with, what it releases with, and which skills its agents may reach for.',
    },
    {
      // Fully expressible; `accepts` and `count` are the same <div>.
      act: 'Count the skills this project binds',
      expect: {
        route: '/projects/terraform-provider-betterado',
        data: {
          page: 'projects',
          'project-id': 'terraform-provider-betterado',
          accepts: 'skill',
          count: '9',
        },
      },
      say: 'Nine skills — an API explorer, a resource scaffolder, a docs generator, an acceptance-test author. They are the reason this project can be built unattended at all: they are the moves that are specific to an Azure DevOps provider and to nothing else forge manages.',
    },
    {
      // Fully expressible, and this beat pins the BEFORE. `kind`, `skill-id`,
      // `resolved` and `skill-source` are the same <span>. It is green today
      // and must stay green until the rebuild happens in the beat below it —
      // the drift is the story's premise, not its failure.
      act: 'Read the first of them',
      expect: {
        route: '/projects/terraform-provider-betterado',
        data: {
          page: 'projects',
          'project-id': 'terraform-provider-betterado',
          kind: 'skill',
          'skill-id': 'ado-api-explorer',
          resolved: 'missing',
          'skill-source': 'missing',
        },
      },
      say: 'It does not resolve. Nor do the other eight. The skills are on disk — they sit where this project was told to put them when it was onboarded, and the contract every project written since puts them somewhere else. Nothing is broken enough to fail a gate, which is exactly why it has gone unnoticed: the project is drifting away from forge, one convention at a time.',
    },
    {
      // NOT expressible, and deliberately left so. There is no "Rebuild
      // contract" control anywhere on this page — the full data-* inventory of
      // the live page carries no action, section or field matching reset,
      // rebuild, regenerate or drift. `forge project reset` + Studio's
      // "Rebuild contract" land in the projects lane at M4 (1.0.md §3), and
      // this beat is what proves it, so the beat carries no `do` block: there
      // is nothing honest to name, and naming an invented `data-action` would
      // be inventing the contract this story exists to hold the product to.
      //
      // The DRIFT REPORT is the second half of this act and has no handle
      // either — see the header. What the beat CAN assert is the state only a
      // rebuild produces: a contract regenerated from the current template
      // leaves nothing unresolved. `section`, `resolution-failing-count` and
      // `resolution-agent-count` are all the same <div>, so the three are
      // answerable together; today they read `1` and `1` (DEMO-ALIGN).
      act: 'Press "Rebuild contract", and read the drift report it produces before applying it',
      expect: {
        route: '/projects/terraform-provider-betterado',
        data: {
          page: 'projects',
          'project-id': 'terraform-provider-betterado',
          section: 'contract-resolution',
          'resolution-failing-count': '0',
          'resolution-agent-count': '0',
        },
      },
      say: 'Rebuilding is not repairing. Forge regenerates the mechanisms it owns — the project config, the test, demo and release processes, the skill wiring — from the template every project created today is built from, and shows the operator a drift report first: what it will change, what it will leave alone, and what it cannot decide. Applying it closes the gaps, so nothing is left for a human or an agent to resolve by hand.',
    },
    {
      // Fully expressible. The same <span> as beat 4, now expected to resolve:
      // `resolved: 'ok'` and `skill-source: 'project'` are copied from
      // `/projects/mdtoc`'s live chip, which is the only bound project skill in
      // this checkout that resolves. Blocked behind beat 5 today.
      act: 'Check the nine skills resolve now',
      expect: {
        route: '/projects/terraform-provider-betterado',
        data: {
          page: 'projects',
          'project-id': 'terraform-provider-betterado',
          kind: 'skill',
          'skill-id': 'ado-api-explorer',
          resolved: 'ok',
          'skill-source': 'project',
        },
      },
      say: 'The rebuild moved the skills to where the current contract expects them and rewrote the wiring that points at them. The bindings the project has carried all along now resolve, and the agents that run against this project can reach the moves that are specific to it.',
    },
    {
      // Fully expressible. The strongest of the three preservation beats: it
      // names a secret forge could not possibly have regenerated. `detail-line`
      // is its own <li> under the secrets row, so it answers alone.
      act: 'Check the secrets the rebuild had no right to touch',
      expect: {
        route: '/projects/terraform-provider-betterado',
        data: {
          page: 'projects',
          'project-id': 'terraform-provider-betterado',
          'detail-line': 'AZDO_PERSONAL_ACCESS_TOKEN',
        },
      },
      say: 'This is the first of the three things a rebuild must never regenerate. The contract names the environment variables the live acceptance tier needs — never a value — and a template cannot know that this project talks to Azure DevOps with a personal access token. The element still names it, so the acceptance gate still knows what it needs.',
    },
    {
      // Fully expressible; the instructions source is its own <div>.
      act: 'Check the instructions still point at the project’s own file',
      expect: {
        route: '/projects/terraform-provider-betterado',
        data: {
          page: 'projects',
          'project-id': 'terraform-provider-betterado',
          'contract-conventions-source': 'AGENTS.md',
        },
      },
      say: 'The second. This project keeps its conventions in AGENTS.md and forge binds to that file read-only; a rebuild that swapped it for the template’s own choice would silently retarget every agent that reads it. The source is unchanged, so the instructions the operator has been curating for months are still the ones in force.',
    },
    {
      // Fully expressible; the north-star state is its own <div>. The VALUE is
      // not exposed as a `data-*` anywhere on this page — the editor renders it
      // in a `[data-field="north-star"]` textarea and the contract panel
      // publishes only its state — so `present` is the strongest honest
      // assertion available, and the narration says which north star it means.
      act: 'Check the north star survived',
      expect: {
        route: '/projects/terraform-provider-betterado',
        data: {
          page: 'projects',
          'project-id': 'terraform-provider-betterado',
          'contract-northstar-state': 'present',
        },
      },
      say: 'The third. "Feature complete ADO provider that has data and resources defined for all resources available in the ADO API" is the sentence every planner reads before it decides what to build next. It is the one thing in the contract that is a judgement rather than a mechanism, and a rebuild that regenerated it would quietly change what forge is building.',
    },
    {
      // Fully expressible. `preflight-status`, `flow-ready` and `ready-count`
      // are all the readiness panel's own <div>, so the three are answerable
      // together.
      act: 'Confirm preflight is MET and the project is still ready for a Flow',
      expect: {
        route: '/projects/terraform-provider-betterado',
        data: {
          page: 'projects',
          'project-id': 'terraform-provider-betterado',
          'preflight-status': 'ok',
          'flow-ready': 'true',
          'ready-count': '5',
        },
      },
      say: 'This is the check that says the reset was worth doing rather than merely survivable. Five readiness elements met, preflight MET, and the project still ready to have a Flow pointed at it — the same bar a project created today has to clear, now cleared by one that predates it.',
    },
    {
      // Fully expressible; `section`, `onboard-run-status`, `onboard-session-id`
      // and `onboard-attaching` are all the same <section>, and the minted id
      // is published there BEFORE the navigation that consumes it (M1-G closed
      // `forge-8vfn.5.5` on this surface), so beat 12 can bind it. `running` is
      // transcribed from `docs/forge-ui-dom-and-harness.md` and S1's beat 4 —
      // the live page reads `idle` and observing `running` costs a spawn.
      act: 'Run the onboarding agent to re-derive the parts a template cannot write, briefed with the contract’s own north star and gate',
      do: [
        { press: 'toggle-onboard-brief' },
        { fill: 'northStar', with: NORTH_STAR },
        { fill: 'gateCommand', with: GATE },
        { press: 'run-onboarding-agent' },
      ],
      expect: {
        route: '/projects/terraform-provider-betterado',
        data: {
          page: 'projects',
          'project-id': 'terraform-provider-betterado',
          section: 'onboard-with-agent',
          'onboard-run-status': 'running',
          'onboard-session-id': '<onboardSessionId>',
          'onboard-attaching': 'false',
        },
      },
      say: 'A template can regenerate the mechanisms forge owns. It cannot write an API explorer for Azure DevOps, so the skills the rebuild rewired still have to be re-derived against what this provider actually does. That is an Agent’s job, and it is briefed with what the contract already says rather than with anything new — the rebuild preserved both, so the operator is handing back the project’s own words.',
    },
    {
      // Fully expressible. The press navigates to
      // `/sessions/onboarding/<sid>?project=terraform-provider-betterado`; the
      // runner matches on pathname, and `<onboardSessionId>` is bound by beat
      // 11. `session-kind: 'onboarding'` is S1's own worked value.
      act: 'Follow "View onboarding session" and watch it work',
      do: [{ press: 'view-onboarding-session' }],
      expect: {
        route: '/sessions/onboarding/<onboardSessionId>',
        data: {
          page: 'session',
          'page-ready': 'true',
          'session-kind': 'onboarding',
          'buildout-row-count': '5',
        },
      },
      say: 'The session opens on the shared session surface, showing the same five-element contract buildout the project page shows — so the operator watches the Agent finish the job in the vocabulary the gate will judge. That is where S3 ends: a project that predates the contract now built to it, with the three things only the operator could have written still intact.',
    },
  ],
};
