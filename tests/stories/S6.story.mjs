/**
 * S6 — create a new knowledge base (1.0.md §3, row S6).
 *
 * Operator flow: a Flow keeps learning things and forgetting them. The
 * operator binds a knowledge base to that Flow, scopes it to the band that
 * should read it, lets forge seed it, proves a planner run genuinely READS it,
 * and then drains it to green and reads the diff the drain proposes before
 * accepting it. Authored 2026-08-30 against `parsoFish/main` 6889f080, with
 * the operator (H6), in the amended draft-then-review mode. Green expected at
 * M4.
 *
 * WHAT THIS STORY IS ACTUALLY FOR. Forge's whole claim is that it compounds:
 * a cycle reflects, a theme lands, the next planner reads it and plans better.
 * §3's row states that as an observable — "a planner run reads it (a
 * `brain-index` event is visible)" — and beat 13 is that observable. It is the
 * one beat in this story that cannot be written against any attribute the
 * product has: `brain-index` appears NOWHERE in `forge-ui`. Every `data-*`
 * naming a brain fact is `data-ingest-*`, and ingest is the REFLECTOR'S WRITE,
 * not a planner's read. So the read-proof is the second half of beat 10's act,
 * named in its narration, and recorded in `_1.0/stories/S6.md` as a surface
 * the knowledge lane must build — the same shape as S3 beat 5's drift report.
 *
 * GROUND. `story-s6` does not exist when the story starts; beat 3 creates it.
 * The `story-` prefix is the fixture namespace `scripts/stories/sweep.mjs`
 * owns — though see the SWEEP note below, because for a KB it does not
 * actually reach. The binding is `{kind: 'flow', ref: 'forge-develop', band:
 * 'review-band'}`: `review-band` is a REAL derived band read off the live
 * form's own `[data-field="kb-binding-band"]` options (`demo-band`,
 * `review-band`), never a hardcoded guess, and it is the band CLAUDE.md
 * already grants the reviewer an advisory read of — so the scope this story
 * binds is one the product genuinely consumes. The flow reaches a real
 * seeding turn and a real planner run, so `realSpawn` is true and
 * `budget_usd` is declared: the runner refuses to start without
 * `--approve-spend` (H2, $25 approved by the operator for the S5/S6/S7 batch
 * on 2026-08-30).
 *
 * `ground.project` is `mdtoc` — the schema requires a project id, this story's
 * subject is a KB, and mdtoc is the project beat 11's planner run is pointed
 * at. It is the one project committed to this repo, so it is the only one a
 * CLEAN CHECKOUT has, which is the condition 1.0 exits on.
 *
 * ON THE `data-*` KEYS. Every key and value below was copied from the live DOM
 * of a bridge booted from this lane's own worktree, EXCEPT beats 5 and 6,
 * whose session phases are transcribed from
 * `docs/forge-ui-dom-and-harness.md` — observing a project-brain session live
 * costs a real seeding spawn. That is stated here rather than hidden: if you
 * did not see it, say you did not. Beat 3's landing state was confirmed by
 * driving the real form during authoring and then removing the fixture: a KB
 * named "story S6" mints the id `story-s6`, and the form lands on
 * `/knowledge?id=story-s6&seedSession=<sid>&seedProject=.kb-story-s6` with the
 * graph already showing the new KB's single index node.
 *
 * WHERE A BEAT CANNOT BE EXPRESSED it says so and stands anyway. TWO places
 * remain after amend-1 (see below); the seeding-session and Health-tab entries
 * that used to head this list are closed.
 *
 * AMENDED after this story's first run (2026-08-30, same authoring session,
 * re-pinned). The first draft stepped straight from `/knowledge` to
 * `/architect/new`, and the runner was right to red it: no nav pillar and no
 * link on the Knowledge page points there, so it is not a step an operator can
 * take. Three beats now carry the real path — Projects, mdtoc, "Architect →" —
 * and NOT ONE ASSERTION CHANGED. The amendment made the story truer about the
 * operator's journey; it did not make it easier to pass.
 *   - Beat 11 routes to `/sessions/architect/<architectSessionId>`, and this
 *     beat's OWN press is what mints that id. The runner resolves a route
 *     before performing any `do` step, so binding it is a two-beat act. That
 *     is an authoring change, not a product gap — the product has published
 *     `data-architect-session-id` since M1-G.
 *   - Beat 12's real subject is a planner's READ of this KB (§3 asks for a
 *     visible `brain-index` event). `brain-index` appears nowhere in
 *     forge-ui: every brain-related attribute the UI declares renders the
 *     reflector's WRITE. Asserting one of those would report a write as a
 *     read — the fail-open shape this story exists to catch — so the
 *     read-proof stays named in the narration. Bead `forge-8vfn.5.16`.
 *
 * AMEND-1 (M4, operator-authorised; `_1.0/gate-manifests/M1-C-S6.amend-1.md`).
 * `forge-8vfn.5.10` and `forge-8vfn.5.14` shipped the four handles this story
 * had been red against: `data-seed-session-id` on the seed banner, and
 * `data-action` on the Explore and Health tabs plus `data-field` on
 * `#kb-select`. Two strictly additive edits then let the story use them —
 * beat 3 ASKS for `seed-session-id`, and beat 13 presses the Health tab before
 * the drain, which its own `act` text always claimed it did. One added expect
 * key and one added press; nothing removed, nothing relaxed. The Ingest
 * Activity tab is still unnameable ON PURPOSE:
 * `scripts/check-kb-ingest-affordance.mjs` rule 1 bans any forge-ui
 * `data-action` naming ingest (operator decision 3), and a name picked to slip
 * past that guard would be gaming it.
 *
 * SWEEP. `sweep.mjs` removes `projects/story-<id>` and
 * `brain/projects/story-<id>`. A flow-bound KB writes `brain/story-s6` and
 * anchors its seeding session under `projects/.kb-story-s6`, and NEITHER is in
 * that list — so this story does not sweep its own fixture and a second run
 * meets a KB that already exists. That is bead `forge-8vfn.2.26`, filed by the
 * S4 lane for the same class one object kind along; cited, not re-filed.
 */

/** What this knowledge base is for — what the operator types into the create form. */
const DESCRIPTION =
  'What adversarial review keeps finding on this codebase, so the next reviewer starts from the last one’s conclusions instead of rediscovering them.';

/**
 * The binding. `forge-develop` and `review-band` are both read off the live
 * create form's own selects — the flow roster and that flow's REAL derived
 * bands — never a hardcoded pair.
 */
const BOUND_FLOW = 'forge-develop';
const BOUND_BAND = 'review-band';

/** The piece of work the planner is asked to plan, so that it has a reason to read the KB. */
const IDEA =
  'Tighten the heading-anchor rules so a generated table of contents survives duplicate headings, with a test that pins the collision rule.';

/** The planner run's ceiling, in dollars. The ground's budget caps the BATCH; this caps the run. */
const CEILING = '5';

export default {
  id: 'S6',
  ground: { project: 'mdtoc', realSpawn: true, budget_usd: 25 },
  docs: { kind: 'how-to', title: 'Create a new knowledge base' },
  beats: [
    {
      // Fully expressible — all three keys are the route's own root.
      act: 'Open Studio on the Knowledge pillar',
      expect: {
        route: '/knowledge',
        data: { page: 'knowledge', 'page-ready': 'true', 'fetch-status': 'ok' },
      },
      say: 'Knowledge is where everything forge has learned lives, as graphs it can read back. The knowledge base this story is about is not here yet — the Flow it belongs to has been running without one.',
    },
    {
      // Fully expressible. `new-kb` is the header's always-present CTA,
      // deliberately distinct from the empty state's own `new-kb-empty-cta`,
      // so naming it is unambiguous whichever state the roster is in.
      act: 'Press "+ New KB"',
      do: [{ press: 'new-kb' }],
      expect: {
        route: '/knowledge/new',
        data: { page: 'knowledge-new', 'page-ready': 'true', section: 'kb-new' },
      },
      say: 'One form, and the only two things that matter on it are what this knowledge base is called and what it is bound to. A knowledge base with no binding is a folder.',
    },
    {
      // Fully expressible — every field on this form declares a real
      // `data-field`, and `kb-binding-band` renders only for a `flow` binding,
      // which is why the kind is selected before the band. `kb-id` and
      // `node-count` are both on the graph root, so one element answers both.
      // Confirmed live during authoring: the id minted is `story-s6` and the
      // fresh KB comes up with exactly its own index node.
      act: `Name it, bind it to the ${BOUND_FLOW} flow, scope it to the ${BOUND_BAND}, and create it`,
      do: [
        { fill: 'kb-name', with: 'story S6' },
        { fill: 'kb-binding-kind', with: 'flow' },
        { fill: 'kb-binding-ref', with: BOUND_FLOW },
        { fill: 'kb-binding-band', with: BOUND_BAND },
        { fill: 'kb-desc', with: DESCRIPTION },
        { press: 'create-kb' },
      ],
      expect: {
        route: '/knowledge',
        data: {
          page: 'knowledge',
          'page-ready': 'true',
          'kb-id': 'story-s6',
          'node-count': '1',
          'seed-session-id': '<seedSessionId>',
        },
      },
      say: `Binding is the act. A band scope says WHICH readers on that Flow this knowledge is for — ${BOUND_BAND} means the reviewer, not the planner and not the developer — so the knowledge lands in front of the agent it was written for and nowhere else. Forge writes the graph with one index node and nothing in it.`,
    },
    {
      // Expressible since amend-1. `open-seed-session` was always a real
      // `data-action` on the seed banner, so the PRESS was always honest; what
      // was missing was the session id as a `data-*` VALUE, so nothing could
      // bind `<seedSessionId>` and the runner — which resolves a route before
      // performing any `do` step — could never arrive. `forge-8vfn.5.10`
      // published `data-seed-session-id` beside that control and beat 3 now
      // asks for it.
      act: 'Follow the seeding session forge started for it',
      do: [{ press: 'open-seed-session' }],
      expect: {
        route: '/sessions/project-brain/<seedSessionId>',
        data: {
          page: 'session',
          'page-ready': 'true',
          'session-kind': 'project-brain',
          'session-phase': 'briefing',
        },
      },
      say: 'Creating a knowledge base starts an agent that fills it. Forge does not leave the operator with an empty graph and a shrug — it offers the session it already started, and the operator goes and watches it.',
    },
    {
      // Reachable since amend-1 (the same segment beat 4 now binds). The phase
      // name is still transcribed from `docs/forge-ui-dom-and-harness.md` (a
      // real briefing POST flips `phase → analyzing` on disk) rather than
      // observed live: observing it costs a real seeding spawn.
      act: 'Brief the seeding agent on what this knowledge base is for, and let it read',
      expect: {
        route: '/sessions/project-brain/<seedSessionId>',
        data: {
          page: 'session',
          'session-kind': 'project-brain',
          'session-phase': 'analyzing',
        },
      },
      say: 'A band-scoped knowledge base has no project repo to read — it reads the Flow’s own archived cycles, and synthesises what review kept finding. The operator’s brief is the only thing that tells it which of those findings are worth keeping.',
    },
    {
      // Reachable since amend-1 — same segment as beats 4 and 5.
      // `verdict-approve` is the generic interactive panel's real action; the
      // `committing` phase is likewise transcribed from the DOM contract
      // rather than observed.
      act: 'Read the themes it drafted and approve them into the knowledge base',
      do: [{ press: 'verdict-approve' }],
      expect: {
        route: '/sessions/project-brain/<seedSessionId>',
        data: {
          page: 'session',
          'session-kind': 'project-brain',
          'session-phase': 'committing',
        },
      },
      say: 'Nothing an agent drafts enters the brain without a human saying yes. This is the gate: the operator reads what it wrote, and only then does it become knowledge the next run will act on.',
    },
    {
      // Fully expressible as an assertion. `theme-node` and `theme-active` are
      // the same button in the right-rail theme list, so one element answers
      // both, and `<seedTheme>` takes any non-empty value — the product names
      // the theme, not this story.
      //
      // `kb-id` is what makes that claim mean anything, and it was missing until
      // amend-2. S6 run 3 scored this beat GREEN on
      // `2026-06-05-forge-demo-render-cwd-sensitivity` — a `cycles` theme —
      // while `brain/story-s6/themes/` was EMPTY, because no seeding agent had
      // run. Unscoped, "SOMETHING real landed" was answered by a theme from
      // ANOTHER knowledge base: a bare `/knowledge` lands on `cycles`, which
      // beat 12 reports honestly and this beat was calling success. Pinning
      // `kb-id` ties the right-rail to the KB beat 3 created, so the beat now
      // stays red until a theme lands in THIS one.
      act: 'Back on the knowledge base, find a real theme in the graph',
      expect: {
        route: '/knowledge',
        data: {
          page: 'knowledge',
          'page-ready': 'true',
          'kb-id': 'story-s6',
          'theme-node': '<seedTheme>',
          'theme-active': 'false',
        },
      },
      say: 'Seeded means there is something in it. One theme with a name the operator can read is the difference between a knowledge base and an empty promise.',
    },
    {
      // AMENDED after the first run (2026-08-30, same authoring session, re-pinned).
      // The first draft went straight from `/knowledge` to `/architect/new`,
      // and the runner was right to red it: there is no Architect nav pillar
      // and the Knowledge page carries no link to one, so that is not a step
      // the operator can take. The real path is through the project — which is
      // the honest shape anyway, because a planner run is always ABOUT a
      // project. Two beats, not one act pretending to be one.
      act: 'Go to the Projects pillar to find the project on the other end of that binding',
      expect: {
        route: '/projects',
        data: { page: 'projects-index', 'page-ready': 'true' },
      },
      say: 'A knowledge base is bound to a Flow, and a Flow runs against projects. To prove the binding does anything, the operator has to go to one of them.',
    },
    {
      // Fully expressible, and deliberately with NO `do`: the project card is a
      // real `a[href="/projects/mdtoc"]`, so the runner reaches it by the link
      // the operator clicks. The card carries `data-card-type`/`data-card-id`
      // and no `data-action`, and naming a handle that does not exist would be
      // inventing one.
      act: 'Open mdtoc',
      expect: {
        route: '/projects/mdtoc',
        data: { page: 'projects', 'project-id': 'mdtoc', 'page-ready': 'true' },
      },
      say: 'mdtoc is the project this repo ships with, so it is the one a clean checkout can plan against.',
    },
    {
      // Fully expressible, but only because the exit is itself a `data-action`:
      // `start-work-architect` is an <a> whose href carries a query string
      // (`/architect/new?project=mdtoc`), which the runner's `a[href="<route>"]`
      // fallback cannot match. `/architect/new` is the native "start a run" entry;
      // `section`, `roster-state` and `new-idea-ready` all live on the same
      // `[data-section="new-idea"]` element. `roster-state: 'ok'` is the
      // M1-G-derived readiness — this route used to declare `page-ready`
      // literally true over a loading roster, and no longer does.
      act: 'Press "Architect →" to plan a piece of work on it',
      do: [{ press: 'start-work-architect' }],
      expect: {
        route: '/architect/new',
        data: {
          page: 'architect-new',
          'page-ready': 'true',
          section: 'new-idea',
          'roster-state': 'ok',
        },
      },
      say: 'A knowledge base earns its keep at planning time. So the operator starts a real planner run against the project on the other end of that binding, and gives it a piece of work to think about.',
    },
    {
      // NOT expressible. `<architectSessionId>` cannot be bound: this beat's
      // own press is what mints it, and the runner resolves a route BEFORE its
      // `do` steps run. The product now renders `data-architect-session-id`
      // beside a `view-architect-session` control after Start (M1-G closed
      // `forge-8vfn.5.5`), so binding it is a two-beat act — press here, bind
      // there — which is authoring this story does not do, because the
      // operator does not stop between pressing Start and watching the run.
      // Recorded in `_1.0/stories/S6.md`, not filed as a product defect.
      act: 'Describe the work, cap what this run may spend, and press "Start architect"',
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
      say: 'The planner is a real agent and a real agent costs money, so the operator caps this run before starting it. What happens next is the thing S6 exists to prove.',
    },
    {
      // NOT expressible, and this is the finding. §3's row asks for a
      // `brain-index` event to be VISIBLE. `brain-index` appears nowhere in
      // `forge-ui`: every brain-related `data-*` the UI declares is
      // `data-ingest-kb`/`data-ingest-fresh-themes`/`data-ingest-impl` on the
      // Ingest Activity tab, and those render the REFLECTOR'S WRITE
      // (`reflect.kb-ingest`), not a planner's READ. Asserting one of them
      // here would be bending the story to the product: it would report a
      // write as if it were a read, and the compounding claim would go
      // unproven while the beat went green. So the beat asserts only that the
      // operator is standing on the knowledge base, and the read-proof is
      // named in the narration and recorded as a surface the knowledge lane
      // must build.
      act: 'Go back to the knowledge base and see that the planner actually read it — the brain-index event, naming this KB and what it took',
      expect: {
        route: '/knowledge',
        data: { page: 'knowledge', 'page-ready': 'true', 'kb-id': 'story-s6' },
      },
      say: 'This is the beat the whole product rests on. Forge’s claim is that it compounds — that what one run learned changes what the next one plans — and the only honest evidence for that is the planner’s own read, on the record, naming this knowledge base. Until that is on the page, compounding is something forge asserts about itself rather than something the operator can check.',
    },
    {
      // Expressible since amend-1. The Health tab, where the drain lives, had
      // `data-tab="health"` and no `data-action`, so the operator's act of
      // switching to it could not be named and nothing in the KB action group
      // could be reached. `forge-8vfn.5.14` added
      // `data-action="open-kb-tab-health"`, and this beat now presses it
      // before the drain — the step its `act` text always described.
      // `drain-state` and `drain-run-id` are both on the drain panel root, so
      // one element answers both.
      act: 'Open the knowledge base’s Health tab and drain it to green',
      do: [{ press: 'open-kb-tab-health' }, { press: 'drain-to-green' }],
      expect: {
        route: '/knowledge',
        data: {
          page: 'knowledge',
          'page-ready': 'true',
          'drain-state': 'running',
          'drain-run-id': '<drainRunId>',
        },
      },
      say: 'A seeded knowledge base is not a healthy one. The drain runs every lint finding to a fixed point — frontmatter, index sync, dead links, orphans — and it is the operator pressing one button rather than the operator editing markdown.',
    },
    {
      // Fully expressible once the tab is reachable. `drain-proposal-file` and
      // `drain-proposal-disposition` are the same proposal row, which wraps
      // the rendered diff itself. `applied` is the target: a drain that
      // proposes and refuses everything has not drained anything.
      act: 'Read the diff the drain proposes, file by file, before accepting it',
      expect: {
        route: '/knowledge',
        data: {
          page: 'knowledge',
          'page-ready': 'true',
          'drain-proposal-file': '<drainedFile>',
          'drain-proposal-disposition': 'applied',
        },
      },
      say: 'This is where S6 ends: a rendered diff, per file, of what an agent changed inside the operator’s knowledge — not a claim that it cleared N findings. The drain reports what it PROPOSED and what a post-fix lint says actually cleared, and those are different facts on purpose.',
    },
  ],
};
