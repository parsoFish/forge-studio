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
 * `da566d8b`, with the operator (H6). Green expected at M5. Re-pointed onto
 * the forge-owned fixture ground `go-provider-old-contract` 2026-09-26 (plan
 * D5, M7-D forge-1rk5.1, T1 1494/1497) — see the GROUND paragraph below.
 *
 * THE CAPABILITY THIS STORY ASSERTS DOES NOT EXIST YET, and that is the point.
 * `forge project reset` + Studio's "Rebuild contract" land in the projects
 * lane at M4 (1.0.md §3, S3's row). So beat 5 presses a control the product
 * does not render and the story is red from there down. It is NOT re-expressed
 * against the surfaces that happen to exist today: bending a story to the
 * product is what §4 M1 Lane C forbids, and this story exists to hold M4 to
 * the flow, not to describe M1.
 *
 * WHY THIS GROUND. `terraform-provider-betterado` was the oldest project forge
 * managed and the only one that showed the drift with its own DOM. Its
 * contract BINDS NINE PROJECT SKILLS — ado-api-explorer, ado-browser-inspector,
 * ado-demo, resource-scaffolder, schema-refactor, tfplugindocs-gen,
 * tf-acceptance-test-author, ado-release-explorer, breaking-change-detector —
 * and Studio resolved NONE of them: every chip read
 * `[data-resolved="missing"][data-skill-source="missing"]`, live, on this
 * lane's own bridge, when this story was authored. They were on disk; they sat
 * under the project's own `forge/skills/`, the layout it was onboarded to.
 * `projects/mdtoc`, onboarded later, keeps its one skill at `.forge/skills/`
 * and resolves `[data-resolved="ok"][data-skill-source="project"]` — the
 * value beat 6 expects, copied from mdtoc's live page rather than invented.
 * Nine dead bindings against one live one WAS the drift, and it was the
 * operator's reason to reset. `computeContractDrift` against the fixture
 * (below) reproduces the identical nine-relocation shape offline, so the
 * DOM-observed premise and the frozen ground agree.
 *
 * GROUND. `story-s3`, provisioned for each run from the forge-owned fixture
 * `tests/stories/grounds/go-provider-old-contract` — a GATE-closure subset of
 * `terraform-provider-betterado` at `3b2e2ca4aa53cdb24ffd6760c8476c305a62ef73`
 * (the commit immediately before forge's own "Rebuild contract" commits
 * landed in PR #72), with `.forge/project.json` restored from a byte-exact
 * capture of the live ground's `.forge/` taken 2026-09-05 — the day this story
 * was authored, at this same SHA — because that file is `.gitignore`-hidden
 * from every `git archive`/`git show` at this pin (provenance, digests and the
 * full drift proof beside the seed: `tests/stories/grounds/go-provider-old-contract/PROVENANCE.md`).
 * Torn down after the fence has judged it (M7-D, forge-1rk5.1, plan D5). A
 * story now never drives real git/API operations against the operator's own
 * long-lived betterado ground. This also retires the H4 NOTE that used to sit
 * here: it addressed an open PR (#71) mutating the LIVE ground's "before" —
 * moot once the ground is a frozen fixture with no PRs of its own.
 *
 * ON THE `data-*` KEYS. Every key and value below was copied from the live DOM
 * of a bridge booted from this lane's worktree against the REAL
 * `terraform-provider-betterado` before the fixture existed — `/projects` and
 * `/projects/terraform-provider-betterado` observed directly, `resolved: 'ok'`
 * / `skill-source: 'project'` from `/projects/mdtoc`, and the onboarding
 * session pair (`onboard-run-status: 'running'`, `session-kind: 'onboarding'`)
 * transcribed from `docs/reference/studio-dom-contract.md` and S1's own worked
 * beats, because observing them live costs a real spawn. The `story-s3` token
 * itself (route segments, `card-id`/`project-id`, the `AZDO_PERSONAL_ACCESS_TOKEN`
 * secret NAME, `AGENTS.md`, the north star string) is not a fresh live
 * observation — it is the fixture's own name standing in the same DOM
 * position the real project's name held, licensed the same way every other
 * fixture token in this suite is (S4's own rule). None is invented. Where the
 * page root does not carry a key, the keys it does not carry are answered
 * together by ONE element, per §3.1's nested-read rule.
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

const SKILL_IDS = [
  'ado-api-explorer', 'ado-browser-inspector', 'ado-demo',
  'ado-release-explorer', 'breaking-change-detector', 'resource-scaffolder',
  'schema-refactor', 'tf-acceptance-test-author', 'tfplugindocs-gen',
];

export default {
  id: 'S3',
  ground: {
    project: 'story-s3',
    fixture: 'go-provider-old-contract',
    realSpawn: true,
    budget_usd: CEILING,
    // 7.6.136 — THE GROUND CHANGES THIS STORY'S PRODUCT MAKES, declared here so
    // the fence can tell them from a containment breach. Beat 5 presses
    // "Rebuild contract", which MOVES this project's nine declared skills from
    // `forge/skills/<id>/` (where its `artifactRoot: "forge"` put them) to
    // `.forge/skills/<id>/` (where the contract expects them), and rewrites
    // `.forge/project.json` unconditionally whenever ANY row is
    // `regenerate`/`add` — here the `skills` row always is, even though no
    // config VALUE changes (verified by running `applyContractReset` against
    // this fixture: the only diff is JSON string-escaping normalisation —
    // Node's `JSON.stringify` renders a `—` escape as a literal `—`
    // character — zero semantic change). Run 3 (on the real ground)
    // went 12/12 green and still exited 1, because the nine skill-move
    // removals were inside no minted session, written by no agent, and not
    // ignored — so the fence could only call them UNDECLARED.
    //
    // RE-DERIVED FOR THE FIXTURE, TWICE (M7-D, forge-1rk5.1, plan D5). First
    // pass: this fixture then carried NO `.gitignore` at all, so nothing was
    // ignored — simulating `classifyOwnGroundDrift` against a
    // provisioned-and-reset copy showed the nine `.forge/skills/<id>/SKILL.md`
    // ARRIVALS and the `.forge/project.json` re-serialisation ALL fall to
    // UNDECLARED unless named. Second pass, after the fixture was corrected to
    // carry betterado's own tracked `.gitignore` (verbatim, `3b2e2ca4`) so C2
    // could pass: re-ran the SAME simulation expecting the ignore to now
    // absorb the arrivals the way it did on the real ground. It does NOT —
    // `groundIgnoreFromGit` runs `git check-ignore` against the ground's git
    // state as the RUN LEAVES it, and beat 5's own press REWRITES `.gitignore`
    // (from the blanket `.forge/` this pin carries to the narrow scratch-only
    // form — the exact fix PR #72's `15a74d8a` made on the real ground,
    // `gitignoreFixed: true` when actually run). Checked against that FINAL,
    // narrow `.gitignore`, none of `.forge/skills/*` is ignored, so all nine
    // arrivals are STILL undeclared — and the rewrite adds an ELEVENTH new
    // write, `.gitignore` itself (`modified`), that the real ground's story
    // never had to declare (there, PR #72's fix predated S3 by three weeks and
    // was never inside a run this fence judged). Declared as ADDITIONS (the
    // nine arrivals), TWO MODIFICATIONS (`.forge/project.json`'s
    // re-serialisation, `.gitignore`'s rewrite) — every path
    // `applyContractReset` demonstrably writes on this ground, and nothing
    // wider (`tests/stories/grounds/go-provider-old-contract/PROVENANCE.md`
    // records both simulations: the first proved 19 exact, the second proved
    // 19 insufficient and 20 exact — 20 declared, 0 undeclared, 0 unmatched).
    //
    // `beat: 5` (7.6.140, T1 1275): each change names the beat whose press
    // causes it — beat 5's "Rebuild contract" — for the harness's per-beat
    // attribution of declared changes (7.6.140) to read.
    expectedChanges: [
      ...SKILL_IDS.map((id) => ({ path: `forge/skills/${id}/SKILL.md`, change: 'removed', beat: 5 })),
      ...SKILL_IDS.map((id) => ({ path: `.forge/skills/${id}/SKILL.md`, change: 'added', beat: 5 })),
      { path: '.forge/project.json', change: 'modified', beat: 5 },
      { path: '.gitignore', change: 'modified', beat: 5 },
    ],
  },
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
          'card-id': 'story-s3',
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
        route: '/projects/story-s3',
        data: {
          page: 'projects',
          'project-id': 'story-s3',
          'page-ready': 'true',
        },
      },
      say: 'The project page is where the contract lives: what forge tests with, what it demos with, what it releases with, and which skills its agents may reach for.',
    },
    {
      // Fully expressible; `accepts` and `count` are the same <div>.
      act: 'Count the skills this project binds',
      expect: {
        route: '/projects/story-s3',
        data: {
          page: 'projects',
          'project-id': 'story-s3',
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
        route: '/projects/story-s3',
        data: {
          page: 'projects',
          'project-id': 'story-s3',
          kind: 'skill',
          'skill-id': 'ado-api-explorer',
          resolved: 'missing',
          'skill-source': 'missing',
        },
      },
      say: 'It does not resolve. Nor do the other eight. The skills are on disk — they sit where this project was told to put them when it was onboarded, and the contract every project written since puts them somewhere else. Nothing is broken enough to fail a gate, which is exactly why it has gone unnoticed: the project is drifting away from forge, one convention at a time.',
    },
    {
      // FULLY expressible, and AMENDED 2026-09-05 (H6, ruling 170, operator
      // present) — this is the beat S3 was written to prove, and the
      // capability it waited for has shipped. `RebuildContractPanel.tsx`
      // declares the whole act: `rebuild-contract` computes the drift,
      // `contract-drift` carries the report the act says the operator reads,
      // and `apply-contract-reset` applies it.
      //
      // The `do` is four presses because this ground has no persisted app
      // type: the panel answers `needs-app-type` and will not compute a drift
      // until a template is named, so `rebuild-app-type` + the preview press
      // stand between the first press and the report.
      //
      // RE-AMENDED 2026-09-06 (amendment 9, bead `forge-8vfn.6.11.4`, operator
      // ruling 301): `typescript-cli` → **`cli`** — the one-word re-amendment
      // the paragraph that stood here predicted, made by the rename it named.
      // **It is STILL a placeholder in substance**: `cli` is a style, this
      // ground is a Go provider over Terraform, and every starter forge ships
      // is a TypeScript scaffold. Only a starter with a non-TypeScript variant
      // would make this value honest — option (C) fully built, which ruling
      // 301 did not choose. It is safe to name today only because bead `6.4` (PR
      // #414) made the reset PRESERVE what a template has no right to
      // regenerate — proven on this exact ground, `testProcess.local` and the
      // hand-authored 3-step Go/ADO `demoProcess` byte-identical, ground hash
      // `665dcf49a3982d6b` unchanged. Before #414 this `do` would have bought
      // a false green by rewriting the contract it was measuring.
      //
      // The `expect` moves to what the ACT describes. The pinned
      // `resolution-failing-count: '0'` beside `section:
      // 'contract-resolution'` was UNSATISFIABLE BY CONSTRUCTION —
      // `ContractResolutionPanel.tsx:179` is `if (failing.length === 0) return
      // null`, so a count of zero unmounts the section the same beat names.
      // (The identical defect sat in S2 beat 5; both are corrected in this
      // sitting.) `contract-drift-applied` and its `preflight-ok` are one
      // element and say the stronger thing anyway: the rebuild ran, and
      // preflight is MET afterwards.
      act: 'Press "Rebuild contract", and read the drift report it produces before applying it',
      do: [
        { press: 'rebuild-contract' },
        { fill: 'rebuild-app-type', with: 'cli' },
        { press: 'preview-contract-reset' },
        { press: 'apply-contract-reset' },
      ],
      expect: {
        route: '/projects/story-s3',
        data: {
          page: 'projects',
          'project-id': 'story-s3',
          section: 'contract-drift-applied',
          'preflight-ok': 'true',
        },
      },
      say: 'Rebuilding is not repairing. Forge regenerates the mechanisms it owns — the project config, the test, demo and release processes, the skill wiring — from the template every project created today is built from, and it shows the operator a drift report first: what it will change, what it will leave alone, and what it cannot decide. Only then does it rewrite anything. Applying it leaves preflight MET on a project whose north star, instructions and secrets forge never had the right to touch — which is what the next four beats go and check, one at a time.',
    },
    {
      // Fully expressible. The same <span> as beat 4, now expected to resolve:
      // `resolved: 'ok'` and `skill-source: 'project'` are copied from
      // `/projects/mdtoc`'s live chip, which is the only bound project skill in
      // this checkout that resolves. Blocked behind beat 5 today.
      act: 'Check the nine skills resolve now',
      expect: {
        route: '/projects/story-s3',
        data: {
          page: 'projects',
          'project-id': 'story-s3',
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
        route: '/projects/story-s3',
        data: {
          page: 'projects',
          'project-id': 'story-s3',
          'detail-line': 'AZDO_PERSONAL_ACCESS_TOKEN',
        },
      },
      say: 'This is the first of the three things a rebuild must never regenerate. The contract names the environment variables the live acceptance tier needs — never a value — and a template cannot know that this project talks to Azure DevOps with a personal access token. The element still names it, so the acceptance gate still knows what it needs.',
    },
    {
      // Fully expressible; the instructions source is its own <div>.
      act: 'Check the instructions still point at the project’s own file',
      expect: {
        route: '/projects/story-s3',
        data: {
          page: 'projects',
          'project-id': 'story-s3',
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
        route: '/projects/story-s3',
        data: {
          page: 'projects',
          'project-id': 'story-s3',
          'contract-northstar-state': 'present',
        },
      },
      say: 'The third. "Feature complete ADO provider that has data and resources defined for all resources available in the ADO API" is the sentence every planner reads before it decides what to build next. It is the one thing in the contract that is a judgement rather than a mechanism, and a rebuild that regenerated it would quietly change what forge is building.',
    },
    {
      // Fully expressible. `preflight-status`, `flow-ready` and `ready-count`
      // are all the readiness panel's own <div>, so the three are answerable
      // together.
      //
      // CONFIRMED, not fabricated (M7-D, forge-1rk5.1, plan D5): a first pass
      // measured `runPreflight` (`packages/projects/preflight.ts`) directly
      // against a provisioned-and-reset copy of this fixture at `ok: false` —
      // C2 (no `.gitignore` carried, so forge's own scratch paths were not
      // git-ignored) and C4 (missing `roadmap.md` and
      // `brain/projects/story-s3/profile.md`). Both are now fixed at the
      // source, not papered over: `.gitignore` and `roadmap.md` carried
      // verbatim from `3b2e2ca4` (both tracked there), and the fixture ground
      // harness (`scripts/stories/fixture-ground.mjs`) grew the ability to
      // provision a fixture's own `brain/` directory to
      // `brain/projects/<project>/` — this fixture carries the REAL
      // `brain/projects/terraform-provider-betterado/profile.md` (this forge
      // repo, `parsoFish/main`) verbatim, named + hashed in PROVENANCE.md.
      // Re-measured against the corrected fixture: `ok: true` — every HARD
      // clause (C1, C1b, C2, C4, SKILLS) passes; the readiness panel's own
      // five UI checks (north star, instructions, demo, skills, kb) all pass
      // too, so `ready-count: 5` and `flow-ready: true` hold for real, not
      // merely as declared. Full report in
      // `tests/stories/grounds/go-provider-old-contract/PROVENANCE.md`.
      act: 'Confirm preflight is MET and the project is still ready for a Flow',
      expect: {
        route: '/projects/story-s3',
        data: {
          page: 'projects',
          'project-id': 'story-s3',
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
      // transcribed from `docs/reference/studio-dom-contract.md` and S1's beat 4 —
      // the live page reads `idle` and observing `running` costs a spawn.
      act: 'Run the onboarding agent to re-derive the parts a template cannot write, briefed with the contract’s own north star and gate',
      do: [
        { press: 'toggle-onboard-brief' },
        { fill: 'northStar', with: NORTH_STAR },
        { fill: 'gateCommand', with: GATE },
        { press: 'run-onboarding-agent' },
      ],
      expect: {
        route: '/projects/story-s3',
        data: {
          page: 'projects',
          'project-id': 'story-s3',
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
      // `/sessions/onboarding/<sid>?project=story-s3`; the
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
