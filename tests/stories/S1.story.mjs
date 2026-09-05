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
 *
 * AMENDED 2026-09-05 (H6, ruling 170, operator present at the terminal) —
 * FOUR beats, and the story grows from ten to ELEVEN. Every gap the 2026-08-30
 * amendment left open has been closed by the product since, so the beats that
 * stood unexpressed can now perform what they always described: beat 4 opens
 * the brief panel before filling it (the missing press that cost this story
 * three runs at $0.00 — no Agent was ever dispatched); beat 7 hands the demo
 * stage over on the surface it stands on and binds the id the handoff mints;
 * beat 10 starts the Architect inline on the project page and binds that id
 * too; beat 11 walks into the session it named. Beat 3 is RE-RECORDED, not
 * repaired: it pinned `checklist-status: 'absent'` for a contract the product
 * scaffolds at registration.
 *
 * The one structural change is beat 7. It carried two acts — hand the demo
 * stage over, AND come back when the builder has finished — and the runner
 * resolves `expect.route` before the `do` steps, so no single beat can both
 * mint an id and stand on the route that id names. Splitting it keeps an
 * assertion on both acts; folding them would have dropped one in silence.
 * Beats 8–11 are the old 7–10 renumbered. Recorded in
 * `_1.0/gate-manifests/M1-C-S1.amend-1.md`.
 *
 * AMENDED AGAIN 2026-09-05, LATER THE SAME SITTING (operator present) — beat 7
 * only, correcting an error the amendment above introduced and the run caught
 * hours later. Beat 7 bound `<demoSessionId>` from `session-id`, a key the
 * SESSION SHELL'S OWN ROOT carries, so it bound the onboarding session's id
 * and beat 8 reported both ids side by side. `resolveExpectations` answers a
 * key from the page root and never consults the nested elements when it can,
 * so on that surface no key `SessionMinted` carries is reachable and the id
 * cannot be bound there by any beat. Beat 7 now asserts that the handoff
 * happened and minted something, and binds nothing; beat 8 keeps its route and
 * stands red with a product owner. Recorded in `M1-C-S1.amend-2.md`.
 */

/** The gate command GitWeave's own repo answers to — `tests/` is pytest. */
const GATE = 'python -m pytest tests/';

/** GitWeave's own README, first line — the north star is the project's, not the story's. */
const NORTH_STAR =
  'A single control repository that configures and weaves together a GitHub organisation using in-repo modules, overlays and provider-native tooling.';

/** The first piece of work the operator asks the Architect to plan. */
const IDEA =
  'Add an overlay lint that fails the plan when a repo overlay names a team that no module in the org actually grants, so a broken grant is caught before it reaches GitHub.';

/** This run's ceiling, in dollars — the same figure the ground declares. */
const CEILING = '25';

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
      //
      // AMENDED 2026-09-05 (H6, operator present) — `checklist-status`
      // re-recorded `absent` → `present`, and the narration rewritten to match.
      // The beat pinned a world where registering a project leaves its contract
      // absent; the product scaffolds the C4 artifacts at registration and says
      // so in its own copy ("the project was registered and the C4 artifacts
      // were scaffolded"). Measured twice — 2026-09-02 (`_1.0/stories/S1.md`,
      // Finding A) and again 2026-09-04 by probe `m5-b-probe9`. Re-recorded,
      // never edited to pass: `preflight-status: 'hard-fail'` STAYS, because
      // the two together are the finding — a present stub that still hard-fails
      // is exactly what onboarding has to work on. (Its sibling amendment, the
      // one that would have split this six-key set across two beats, is struck:
      // the sibling-key absence was the runner's and PR #411 fixed it.)
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
          'checklist-status': 'present',
        },
      },
      say: 'Registering the project lands the operator on its page, where forge immediately measures GitWeave against the project contract and reports the result honestly: a hard fail. Registration scaffolds the contract artifacts forge can write without asking anyone, so the checklist says contract — present, and preflight says hard fail, and both are true at once: a scaffolded contract is a stub, not an answer. The secrets, demo and roadmap stages have nothing at all; only the instructions carry real content, read from the repo\'s own CLAUDE.md. No Flow can be pointed at a project in this state.',
    },
    {
      // FULLY expressible since the `<summary>` gained a handle, and AMENDED
      // 2026-09-05 (H6, operator present) to use it. Both halves of this
      // beat's authoring-time gap are closed: the two brief inputs declare
      // `data-field` now (they were `data-onboard-input` when this was
      // written), and `[data-action="toggle-onboard-brief"]` opens the
      // `<details>` they sit in.
      //
      // The single missing press is what cost this story three runs at $0.00.
      // The 2026-09-02 run failed `could not fill [data-field="northStar"] …
      // element is not visible` — the input existed and was the right one; the
      // panel around it was shut. So `forge-8vfn.2.25`, which that run was
      // forecast to exercise, was never reached, and no Agent was ever
      // dispatched. S3's beat 11, authored a day later against the same
      // surface, has always opened the panel first; only a story-authoring
      // session may bring S1 into line with it, and this is that session.
      act: 'Open "Brief the agent", give it the north star and the gate command, and press "Run onboarding agent"',
      do: [
        { press: 'toggle-onboard-brief' },
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
      // AMENDED 2026-09-05 (ruling 220, bead `forge-8vfn.6.11.10`). This beat
      // stands on a REAL AGENT: `SessionInteractivePanel` renders
      // `[data-field="session-answer"]` only inside a `question-form`
      // affordance — only once the onboarding agent has ASKED. Runs 1, 2 and 3
      // all reported `no element carries that handle`, and run 3's
      // `describeControl` proved the handle was ABSENT rather than disabled or
      // slow. The cause was the runner, not the product: one bound,
      // `READY_TIMEOUT_MS = 15_000`, for a DOM update and for an agent's first
      // question alike. #438 gives a beat its own bound; this declares it.
      //
      // 10 minutes is a STATED GUESS, not a measurement, and it is the first
      // thing the next run turns into a number: no run has ever reached this
      // state, so the true figure is only known to be larger than anything
      // observed. It is generous enough to be a real measurement and short
      // enough that a genuine product red does not hold the host for half an
      // hour — and the verdict now names which bound gave up, so the next run
      // record cannot confuse "the agent was slow" with "the product is wrong".
      //
      // Ruling 214(d) said beat 6 was untouched; it was written before ruling
      // 220 established that this beat cannot pass without a declared wait.
      // Landing amend-3 without this would spend S1 run 4's $25 re-measuring a
      // beat that cannot pass.
      wait: { for: 'agent', upTo: 600_000 },
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
      // AMENDED 2026-09-05 (H6, operator present) — SPLIT IN TWO, and both
      // halves are now expressible. Both gaps this beat was left open for are
      // closed by bead `forge-8vfn.5.6`: `ContractBuildout.tsx:118` mounts
      // `DemoStageHandoff` on the demo stage's own detail — so the act HAS a
      // declared control on this surface at last — and that component's
      // `SessionMinted` publishes `[data-session-id]` beside
      // `[data-action="view-demo-session"]`, so the id is rendered before the
      // navigation that consumes it. `StageSelector.tsx:46` declares one
      // `select-stage-<id>` per stage, so a beat can finally say WHICH stage
      // it opens instead of taking `.first()` and pretending.
      //
      // The split is forced by the runner, not by taste: `driveBeat` resolves
      // `expect.route` BEFORE the `do` steps, so a beat cannot both mint an id
      // and stand on the route that id names. This beat mints and binds on the
      // page it is standing on — the S4 beat-9 shape — and the next one walks
      // in. The original beat's two acts each keep an assertion; folding them
      // would have dropped one of them silently.
      // AMENDED AGAIN 2026-09-05 (H6, operator present) — the 2026-09-05 run
      // caught an authoring error in this beat's FIRST amendment, made hours
      // earlier in the same sitting, and this is the correction.
      //
      // The first version asked for `session-id: '<demoSessionId>'` alongside
      // `page`, `page-ready` and `session-kind`. It bound the ONBOARDING
      // session's id, and beat 8 reported the two ids side by side:
      // `no real-nav path to /sessions/demo/2026-09-05T02-06-32-703c9252 from
      // /sessions/demo/2026-09-05T02-06-53-05028a45`.
      //
      // The cause is not the answered-together rule, which is what the first
      // reading assumed. `resolveExpectations` (`scripts/stories/beats.mjs`)
      // computes `missing` as the keys the PAGE ROOT does not carry and only
      // then looks at nested records — so a key the root carries is answered
      // by the root and the nested elements are never consulted at all. The
      // session shell puts `data-session-id` on its root
      // (`app/sessions/[kind]/[sessionId]/page.tsx:398`), so on this surface
      // `session-id` can only ever mean "the session you are looking at".
      // `data-session-kind` is on the root too. **No key `SessionMinted`
      // carries is reachable here**, so `<demoSessionId>` cannot be bound on
      // this page by any beat — which is why this beat no longer tries.
      //
      // What it CAN say honestly is that the handoff happened and minted
      // something: `stage-detail-stage` is carried by exactly one element, and
      // `action` is not on the root at all, so the value picks out
      // `SessionMinted`'s anchor — the way in that only exists once a session
      // has been created (`SessionMinted.tsx:19`, "No id, no element").
      //
      // Beat 8 keeps its route and reds with a PRODUCT owner. The fix is the
      // one `OnboardWithAgent` already ships: publish the minted id under a
      // distinctly-named key (`data-onboard-session-id`) that no page root
      // shadows. Bead raised to T1.
      act: 'Select the demo stage and hand it to the demo builder — the heavy one',
      do: [{ press: 'select-stage-demo' }, { press: 'launch-demo-builder' }],
      expect: {
        route: '/sessions/onboarding/<sessionId>',
        data: {
          'stage-detail-stage': 'demo',
          action: 'view-demo-session',
        },
      },
      say: 'Not every contract component is a question and an answer. The demo process is a build in its own right, so it gets its own long-running session rather than blocking the onboarding one. Handing it over does not take the operator anywhere: the demo session is minted and named on the page they are standing on, so they can walk into it now or come back to it later.',
    },
    {
      // NOT expressible today, and left standing red on purpose (the
      // 2026-08-29 ruling: author the true flow). `view-demo-session`
      // (`SessionMinted.tsx:26`) is a real handle and the four keys below are
      // the demo session shell's own root — the same shared surface the
      // onboarding session uses, which is the point: one surface, four kinds,
      // no bespoke runner per kind.
      //
      // What is missing is the SEGMENT. `<demoSessionId>` cannot be bound by
      // any earlier beat, because the only page that renders it is the
      // onboarding session, whose own root carries `data-session-id` and
      // therefore answers that key before `resolveExpectations` ever reaches
      // the nested anchor (see beat 7). PRODUCT owner: publish the minted id
      // under a distinctly-named key, exactly as `OnboardWithAgent` already
      // does with `data-onboard-session-id` — bead raised 2026-09-05. Until
      // then this beat reds on an unbound segment and says so.
      act: 'Come back to the demo builder when it has finished',
      do: [{ press: 'view-demo-session' }],
      expect: {
        route: '/sessions/demo/<demoSessionId>',
        data: {
          page: 'session',
          'page-ready': 'true',
          'session-kind': 'demo',
          'session-phase': 'complete',
        },
      },
      say: 'The operator can leave a heavy session and come back — the session is the record, not the terminal it was started from. This is the beat that proves it: the demo builder was started from one surface, left alone, and read from another, and the work is there and finished.',
    },
    {
      // Fully expressible, but only because the exit is itself a
      // `data-action`. `do` steps run on the page the operator is STANDING on,
      // before this beat's route is reached, so a "go there, then act" beat is
      // expressible only when the navigation is a step too —
      // `[data-action="back-to-project"]` renders on every session shell in
      // every phase (W7-A2), so it is.
      act: 'Return to the project, apply the auto-fixable clauses and record a decision on the ones that need your judgement',
      // AMENDED 2026-09-05 (operator ruling 214 (a)+(b), T1 ruling 217), and
      // BOTH halves were defects no run could see until run 3 reached this
      // beat for the first time.
      //
      // (a) THE PRESS HAD NOTHING TO APPLY. `ContractResolutionPanel.tsx:270`
      // disables `apply-clause-decision` while `(notes[c.id] ?? '').trim() ===
      // ''`; the operator types the decision into
      // `[data-field="clause-decision-<clauseId>"]` (:262) first. Run 3's own
      // log names the clause — `locator resolved to <button disabled
      // data-apply-clause-id="C1b" …>` — so the fill is `clause-decision-C1b`
      // and not a guess. C1b is the CI mirror clause, and gitweave's
      // post-auto-fix contract carries `testProcess.local` and no `ci`.
      //
      // (b) THE COUNT WAS UNSATISFIABLE BY CONSTRUCTION. The pinned
      // `resolution-failing-count: '0'` asked for a value only the element's
      // ABSENCE can produce: `ContractResolutionPanel.tsx:180` is `if
      // (failing.length === 0) return null` and `:185` carries the count, so
      // at zero no element carries the key at all — `beats.mjs`'s resolver
      // sends it to `shared`, every record scores 0, and the beat reds on a
      // key that cannot exist. §15.175, the same trap the H6 sitting fixed in
      // S2 beat 5 and S3 beat 5 and left here because no run had reached beat
      // 9.
      //
      // The replacement values are MEASURED, not chosen: on a restored
      // gitweave copy carrying run 3's `.forge/`, `applyPreflightAutoFixes`
      // (the function this beat's second press calls) cleared C2 and C4 — the
      // only two HARD clauses — taking `runPreflight().ok` false → true and
      // failing 6 → 4; declaring `testProcess.ci`, which is the C1b decision's
      // whole job, leaves `ok: true` with failing 3 / user 0 / agent 3 (C8,
      // DEMO-SKILL, DEMO-ALIGN). So readiness and the counts are true
      // TOGETHER, which is why they sit in one beat (ruling 217, branch (ii)),
      // and `section: 'contract-resolution'` is named so a future zero cannot
      // silently revert this beat to §15.175's trap.
      do: [
        { press: 'back-to-project' },
        { press: 'apply-preflight-auto' },
        {
          fill: 'clause-decision-C1b',
          with: "GitWeave's CI mirror is the same command the per-WI gate runs — declare testProcess.ci as python -m pytest tests/. There is no separate build step, so C1b is satisfied by making the mirror explicit rather than by inventing a second command.",
        },
        { press: 'apply-clause-decision' },
      ],
      // AMENDED 2026-09-05 (T1 ruling 230; ruling 200's mechanical class as
      // extended by 222). A `wait` field changes no expectation and no act —
      // it names the bound the beat is judged under.
      //
      // THIS BEAT STANDS ON A REAL AGENT, and amendment 3 gave the declaration
      // only to beat 6. `apply-clause-decision`'s handler is `submitUser`
      // (`ContractResolutionPanel.tsx:161`), which calls `preflightFixAgent`
      // and polls the run it dispatches; the panel's own header says so — "this
      // tier — and only this tier — genuinely dispatches + polls an agent
      // turn". Run 4 pressed it for the first time in the story's life and read
      // the counts back at STATE B (`failing 4 / user 1`), i.e. before the
      // decision landed, because the runner gave an agent's work the 15 s
      // bound meant for a DOM update. §15.183 a second time, in this story.
      //
      // 200 000 ms is MEASURED, not guessed: the panel's own poll ceiling is
      // `DEFAULT_POLL_INTERVAL_MS 2000 × DEFAULT_POLL_MAX_ATTEMPTS 90` = 180 s
      // (`apps/studio/lib/agent-dispatch.ts:49,51`), after which it renders
      // `data-poll-state="timed-out"` with a `re-check` affordance and these
      // counts can never move from that poll. A bound above the product's own
      // bound would buy nothing, so the beat waits exactly as long as the
      // product is still able to answer, plus a margin for the re-render.
      wait: { for: 'agent', upTo: 200_000 },
      expect: {
        route: '/projects/gitweave',
        data: {
          page: 'projects',
          'project-id': 'gitweave',
          'preflight-status': 'ok',
          'flow-ready': 'true',
          section: 'contract-resolution',
          'resolution-failing-count': '3',
          'resolution-user-count': '0',
          'resolution-agent-count': '3',
        },
      },
      say: 'Preflight is MET. GitWeave now has a contract forge can hold it to, and the project is Flow-ready: the gates downstream have something real to judge against.',
    },
    {
      // AMENDED 2026-09-05 (H6, operator present) — expressible, and it always
      // was the same shape as the demo handoff two beats up. `NewIdeaBox`'s
      // `start-architect` does NOT push the minted id into a route: it sets
      // `startedSessionId` and publishes it on its own section
      // (`NewIdeaBox.tsx:111`), then renders `SessionMinted` beside it
      // (`:187`). `ProjectArchitectEntry.tsx:84` opens that box INLINE on the
      // project page, so every step of this act happens on `/projects/gitweave`
      // and the id is bound where it is minted. The beat that stood here
      // asserted the architect session's own phase and could never reach it —
      // no earlier beat could supply the segment, so nothing was ever pressed
      // and no Architect was ever started. Its `session-phase` assertion is
      // not re-homed: the beat below walks through that session to the plan
      // gate and asserts `architect-phase` there, which is the same fact read
      // where the operator actually decides on it.
      act: 'Press "Plan with Architect" and describe the first piece of work',
      // AMENDED 2026-09-05 (ruling 214 (c) as re-scoped by ruling 215). Run 3
      // reported `no element carries that handle` for `plan-with-architect` —
      // a handle `ProjectArchitectEntry` renders UNCONDITIONALLY, in every
      // branch of `[data-section="project-roadmap"]`. It was one tab away: the
      // project page's tab buttons carried `data-tab`/`data-tab-active` and no
      // `data-action`, and `beats.mjs` resolves `[data-action=…]` only, so no
      // story could reach the roadmap tab. Bead `forge-8vfn.6.11.9` (#436)
      // declared it; this presses it.
      do: [
        { press: 'project-tab-roadmap' },
        { press: 'plan-with-architect' },
        { fill: 'idea', with: IDEA },
        { fill: 'cost-ceiling-usd', with: CEILING },
        { press: 'start-architect' },
      ],
      expect: {
        route: '/projects/gitweave',
        data: {
          page: 'projects',
          'project-id': 'gitweave',
          section: 'new-idea',
          'architect-session-id': '<architectSessionId>',
        },
      },
      say: 'With a contract in place the Architect can plan. It interviews the operator, reads the project, and produces a roadmap for review — the first Gate a human stands at. A real Agent costs money, so the operator caps this run before starting it, and forge names the session it just minted on the page they are standing on rather than sweeping them into it.',
    },
    {
      // Fully expressible. `/artifact` is reached by a query-string href, so
      // the runner's `a[href="/artifact"]` fallback would not match it — the
      // navigation is a `do` step (`[data-action="open-plan"]`,
      // `SessionArchitectPanel.tsx`) and the approval follows it on the page
      // it lands on (`[data-action="approve-plan"]`, `PlanGate.tsx`).
      //
      // AMENDED 2026-09-05 (H6, operator present) — one press added at the
      // front. The beat above now binds `<architectSessionId>` on the project
      // page rather than being swept into the session, so this beat starts on
      // `/projects/gitweave` and `open-plan` is not there — it is on the
      // architect session's panel. `SessionMinted.tsx:26` renders
      // `[data-action="view-architect-session"]` beside the id the beat above
      // bound, so the walk in is a declared step like the other two. Three
      // presses, three surfaces, all named by the product.
      act: 'Open the session, read the plan and press Approve',
      do: [{ press: 'view-architect-session' }, { press: 'open-plan' }, { press: 'approve-plan' }],
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
