/**
 * S10 — run the example factory to a merged PR from Studio (1.0.md §3 row S10,
 * promoted from `docs/product/user-stories.md` R-01; ruling 389).
 *
 * ******************************************************************
 * DRAFT — NOT PINNED. Ruling 404(a) puts S10 in draft-then-review
 * (S8/S9's precedent): this file is drafted unattended, and NOTHING is
 * pinned until the combined sitting (ruling 397). Every key below is
 * marked VERIFIED or SOURCE-DERIVED. Do not fund a run on it yet.
 * ******************************************************************
 *
 * Operator flow: the operator drops an idea on a real ground, answers the
 * architect's interview, confirms the change class at the plan gate, starts
 * development from the project's own roadmap, watches the run build, reviews
 * the result, sends ONE anchored comment back, sees the fix land, approves —
 * which IS the merge — reflects, and finds the theme on the knowledge graph
 * with a cost figure that equals the event log. Act 2 stops a run mid-flight
 * and resumes it without losing the work items already done.
 *
 * THE GROUND, CHECKED BEFORE THE IDEA WAS CHOSEN (§15.205). `gitpulse` at
 * `f69976f0` (`Merge pull request #16 … markdown-output-flag`), version
 * 0.15.0, method-C hash `e12d66d463e094eb`. `.forge/` holds `project.json` and
 * `demo` and NO work items, so the story starts from an idea and not from a
 * queued initiative. The pristine copy had been one merge behind its remote
 * since M5's close; T1 fast-forwarded it and this lane re-derived both the SHA
 * and the hash. `_1.0/stories/S10.md` records the check.
 *
 * THE IDEA, and why this one. `--exclude-author <pattern>`, the inverse of the
 * `--author` filter the ground already ships. Verified absent at THAT head:
 * `grep -rn 'exclude-author\|excludeAuthor' src/ README.md` returns nothing and
 * `src/author-filter.ts` exports only `AuthorFilterResult` and
 * `filterAuthorCommits`. It extends existing code rather than adding an island,
 * so the review has something to say; it carries exactly one genuinely risky
 * clause — what happens when `--author` AND `--exclude-author` are both given —
 * which is what "I'll gate the risky parts" means, what the plan gate confirms
 * the class of, and what the ONE send-back anchors to.
 *
 * ===================================================================
 * WHAT IS VERIFIED AND WHAT IS NOT — read this before trusting a key
 * ===================================================================
 *
 * A census of every `expect.route`, `expect.data` key, `press` and `fill` in
 * the eleven pinned story files was run BEFORE this file was written, so it
 * would reuse handles those files already assert rather than invent names.
 * The census decided how S10 can be authored at all:
 *
 *   VERIFIED — asserted by a pinned story, reused here unchanged:
 *     beats 1–5 (the project page, the idea drop, the interview, the plan
 *     gate). Sources named per beat.
 *
 *   SOURCE-DERIVED — read out of `apps/studio`'s own component source and its
 *     render tests, NOT from a live page and NOT from any pinned story:
 *     beats 6–14 and act 2. Every one is marked in its own comment with the
 *     `file:line` it came from.
 *
 * Nine of this story's beats fall in the second class, and that is not a
 * shortcut — it is a property of what S10 is. Beats 6–14 describe pages that
 * exist only WHILE a real gated run is in flight, which is the very run this
 * story's green pass is meant to be. They cannot be read off a live page in
 * advance the way S4's builder handles were, and that is precisely why ruling
 * 389 said "one attended sitting" in the first place. The sitting, or the
 * first funded run, turns each SOURCE-DERIVED key into a measured one —
 * exactly as S4 beat 4 was proven by a throwaway probe before it was trusted.
 *
 * THE TRAP THIS FILE AVOIDS. S6 beat 11 fills the idea and presses
 * `start-architect` while asserting the DESTINATION route
 * `/sessions/architect/<sid>`. S6's own comment records that as NOT expressible
 * — the press mints and then navigates, and `driveBeat` resolves `expect.route`
 * BEFORE the `do` steps run — and the beat is a known red. Beat 3 below takes
 * S2 beat 10's shape instead: it acts on the page it is standing on and binds
 * the session id there.
 *
 * THE WORD `integrate`, AND WHY THIS FILE DOES NOT USE IT. 1.0.md's spec calls
 * the band `integrate`; ruling 383 renames `demo` → `integrate` across the
 * product as a lane-C filler. TODAY THAT WORD DOES NOT EXIST IN THE PRODUCT: a
 * case-insensitive search of `apps/studio` for `integrat*` finds only unrelated
 * English, and the live vocabulary is `demo-band` / `review-band`
 * (`lib/studio-client.ts:645-654`, confirmed live in `studio-client.test.ts`
 * :1343) with node ids `dev` · `demo` · `adversarial-review` · `review`
 * (`lib/flow-run-detail-render.test.ts:104-109`). A beat asserting a value the
 * product does not carry is red forever (§15.175/178/201), so beat 8 asserts
 * `demo` — the truth today — and the 383 PR must amend this beat in the SAME
 * PR that performs the rename (§15.183/204: a class fix goes to every beat that
 * carries it, in one amendment). This comment is the pointer that makes that
 * amendment findable.
 *
 * ONE PRODUCT FINDING, RECORDED HERE AND IN `_1.0/stories/S10.md`. The same
 * destructive act has TWO different confirmation contracts. On the run-detail
 * surface, abandon is arm-then-confirm — a visible `[data-component=
 * "abandon-confirm"]` panel and a second press (`RunControls.tsx:141-146,
 * 225-249`). On the roadmap drawer, `recovery-abandon` POSTs on the first click
 * with no confirmation at all (`InitiativeDetail.tsx:106-107,311-313`;
 * `RoadmapCanvas.tsx:707-721`). Act 2 drives the run-detail surface, so it
 * expects the confirm step; a beat driving the drawer must not.
 */

const IDEA =
  'Add an --exclude-author <pattern> flag: the inverse of --author. Same *-wildcard, ' +
  'case-insensitive matching, repeatable and OR-combined. It composes with every other ' +
  'filter. State the precedence explicitly when --author and --exclude-author are both ' +
  'given, and annotate the text header and the JSON output the way --author already does.';

/** The ceiling the operator types into the idea box, in dollars. */
const CEILING = '35';

/**
 * The one anchored send-back. It lands on the precedence clause — the risky
 * part the plan gate confirmed the class of — so the fix-WI it becomes is the
 * clause the operator asked to gate, not a stylistic note.
 */
const SEND_BACK =
  'The precedence when both --author and --exclude-author are given is not stated in the ' +
  'output. Exclude must win, and the header annotation must say how many commits each ' +
  'filter removed, so a zero-commit report is never ambiguous about which filter emptied it.';

export default {
  id: 'S10',
  // budget_usd is the exit row's ceiling (ruling 389). realSpawn because every
  // beat past 3 stands on a real agent.
  ground: { project: 'gitpulse', realSpawn: true, budget_usd: 35 },
  docs: { kind: 'tutorial', title: 'Run the example factory to a merged PR' },
  beats: [
    {
      // VERIFIED shape (S1 b3, S3 b2 assert `page`/`project-id`/`page-ready`
      // on `/projects/<id>`). The VALUES are gitpulse's own and are
      // SOURCE-DERIVED: no pinned story has ever opened `/projects/gitpulse`.
      act: 'Open the project forge already manages',
      expect: {
        route: '/projects/gitpulse',
        data: { page: 'projects', 'project-id': 'gitpulse', 'page-ready': 'true' },
      },
      say: 'This is the ground the whole story stands on: a real CLI with a real test suite, already onboarded, already merged through once. Nothing here is seeded — the roadmap, the history and the contract are what the previous cycles left behind.',
    },
    {
      // VERIFIED — S2 b9 asserts exactly these five keys after this press.
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
      say: 'The operator has a feature in mind and no plan for it. That is what the Architect is for, and it is the only entry point in the product that starts from a sentence rather than from an initiative that already exists.',
    },
    {
      // VERIFIED — S2 b10's shape exactly: act on the page being stood on and
      // bind the id THERE. See the header's note on S6 b11's known red.
      act: 'Describe the work, cap what this run may spend, and press "Start architect"',
      do: [
        { fill: 'idea', with: IDEA },
        { fill: 'cost-ceiling-usd', with: CEILING },
        { press: 'start-architect' },
      ],
      expect: {
        route: '/architect/new',
        data: {
          page: 'architect-new',
          section: 'new-idea',
          'architect-session-id': '<architectSessionId>',
        },
      },
      say: 'The ceiling is set before the work starts, not discovered afterwards. Pressing Start mints a session and names it on the page the operator is standing on, so the run is nameable before anything navigates.',
    },
    {
      // VERIFIED — S2 b12 / S4 b11: the repeat, the `until`, and the stated
      // bound. The architect decides how many rounds it needs
      // (`bridge-studio-architect.ts:380` increments `round` per submission),
      // so a fixed number of fills cannot answer a variable interview.
      act: 'Open the session and answer the Architect\'s questions',
      do: [
        { press: 'open-session' },
        {
          repeat: [
            {
              fillAll: 'question-freetext',
              with:
                'The gate command is `npm test`. Exclude wins over include when both are given — ' +
                'say so in the header annotation. Breaking the existing human-readable output is ' +
                'not acceptable; the new flag is additive, like --author was.',
            },
            { press: 'submit-answers' },
          ],
          until: { 'session-phase': 'awaiting-verdict' },
        },
      ],
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
      say: 'The interview is where the operator\'s one sentence becomes something buildable. The answers are not decoration — the precedence rule stated here is the clause the review will come back to.',
    },
    {
      // VERIFIED for the gate itself — S1 b11 asserts every key here and
      // presses `approve-plan`. NOT VERIFIED: "the class confirmed". No
      // `class`-shaped data key is asserted by any pinned story, and the census
      // found none in the corpus. The beat therefore asserts the gate state it
      // can prove and SAYS what the operator read; the class handle is an open
      // item in `_1.0/stories/S10.md` for the sitting.
      act: 'Read the plan at the gate and approve it',
      do: [{ press: 'open-plan' }, { press: 'approve-plan' }],
      expect: {
        route: '/artifact',
        data: {
          section: 'architect-plan',
          'architect-phase': 'committed',
          'gate-armed': 'false',
          'plan-mode': 'gate',
        },
      },
      say: 'This is the first of the two human gates. The operator reads what will be built and what it will touch, and approving arms the work — the plan is committed and the gate is no longer waiting on anyone.',
    },
    {
      // SOURCE-DERIVED. `StartWorkActions.tsx:187` (`data-section="start-work"`),
      // `:230` (`data-action="start-work-develop"`), corroborated by
      // `lib/start-work-render.test.ts:112,114`. `project-tab-roadmap` is
      // VERIFIED (S1 b10). The disabled reasons are source-FIXED strings in
      // `lib/start-work-view.ts:80-101`, so a red here names which one fired.
      act: 'Open the roadmap and start development on the planned initiative',
      do: [{ press: 'project-tab-roadmap' }, { press: 'start-work-develop' }],
      expect: {
        route: '/projects/gitpulse',
        data: { page: 'projects', 'project-id': 'gitpulse', section: 'start-work' },
      },
      say: 'The plan produced an initiative and the roadmap is where it now lives. Starting it from the card is the point: the operator is not re-describing the work, they are pressing go on the thing the Architect already planned.',
    },
    {
      // SOURCE-DERIVED. `FlowRunDetail.tsx:121-127` (page/run-id/run-found/
      // run-status/flow-id/page-ready), corroborated by
      // `lib/flow-run-detail-render.test.ts:180-191`. The node id `dev` and the
      // per-row keys are `FlowRunDetail.tsx:282-285`, corroborated at
      // `flow-run-detail-render.test.ts:231-236,247-249`.
      act: 'Watch the run build',
      wait: { for: 'agent', upTo: 1_800_000 },
      expect: {
        route: '/flows/forge-develop/run/<runId>',
        data: {
          page: 'flow-run',
          'run-found': 'true',
          'flow-id': 'forge-develop',
          'page-ready': 'true',
          'timeline-row': 'true',
          'node-id': 'dev',
        },
      },
      say: 'The dev station fans out over the work items the plan decomposed into. Each row on the timeline is a station with its own status and its own cost, so "what is it doing and what has it spent" is one screen, not an investigation.',
    },
    {
      // SOURCE-DERIVED — AND THE VALUE IS THE ONE RULING 383 RENAMES.
      // Today the node is `demo`: `lib/flow-run-detail-render.test.ts:104-109`
      // lists the real `forge-develop` node ids as dev · demo ·
      // adversarial-review · review, and a case-insensitive search of
      // `apps/studio` for `integrat*` finds NO product use. The spec's word is
      // `integrate`, and 383 makes that rename a lane-C filler. This beat
      // asserts what the product carries TODAY, because a beat asserting a
      // value the product does not carry is red forever (§15.175/178/201); the
      // 383 PR amends it in the same PR that renames the band (§15.183/204).
      act: 'The built work is assembled for review',
      expect: {
        route: '/flows/forge-develop/run/<runId>',
        data: { page: 'flow-run', 'timeline-row': 'true', 'node-id': 'demo' },
      },
      say: 'Between building and judging there is a step that puts the change together with the evidence for it — the diff, the acceptance criteria and what was actually demonstrated. The reviewer reads that, not a pile of commits.',
    },
    {
      // SOURCE-DERIVED. Node id from the same fixture list; the review station
      // is `adversarial-review` (`flow-run-detail-render.test.ts:104-109`), and
      // `data-section="review-findings"` is corroborated at
      // `flow-run-detail-render.test.ts:413`.
      act: 'The review station files its findings',
      wait: { for: 'agent', upTo: 1_200_000 },
      expect: {
        route: '/flows/forge-develop/run/<runId>',
        data: {
          page: 'flow-run',
          'timeline-row': 'true',
          'node-id': 'adversarial-review',
          section: 'review-findings',
        },
      },
      say: 'A machine reviewer goes first, against the acceptance criteria and the change class the plan gate confirmed. Its findings are the reviewer\'s starting point, not its verdict — the human decides.',
    },
    {
      // SOURCE-DERIVED, and the surface choice is load-bearing. The cycle
      // review gate is `/artifact?type=verdict&mode=gate`
      // (`app/artifact/page.tsx:4-36,922-931`). TWO components render a verdict
      // there: `ReviewVerdictForm` (fallback) and `DemoReviewSurface` (primary,
      // when a demo model exists). THIS BEAT NEEDS `DemoReviewSurface`, because
      // `ReviewVerdictForm`'s rationale textarea carries NO `data-field` at all
      // (`ReviewVerdictForm.tsx:97-104`) — the DSL cannot fill it. The anchored
      // path does: `data-action="comment-region"` (`DemoReviewSurface.tsx:459`),
      // `data-field="comment-body"` (`:435`), `data-field="comment-blocking"`
      // (`:443`), `data-action="add-comment"` (`:448`), then
      // `data-action="send-back"` (`:262`) with `data-form-kind` and
      // `data-ac-count` (`:227,229`). A blocking comment becomes a
      // `ReviewCommentAc` GIVEN/WHEN/THEN carried as the send-back's
      // acceptanceCriteria (`lib/review-comments-client.ts:11,22-23`) — there
      // is no separate "fix work item" handle, and this comment records that
      // rather than inventing one.
      //
      // NO RENDER TEST EXISTS for `DemoReviewSurface` (its own header says the
      // e2e harness asserted it). Every key here is source-only and must be
      // confirmed at the sitting.
      act: 'Anchor one blocking comment to the precedence criterion and send it back',
      do: [
        { press: 'comment-region' },
        { fill: 'comment-body', with: SEND_BACK },
        { fill: 'comment-blocking', with: 'true' },
        { press: 'add-comment' },
        { press: 'send-back' },
      ],
      expect: {
        route: '/artifact',
        data: { page: 'artifact', 'form-kind': 'send-back', 'form-state': 'submitted' },
      },
      say: 'This is the send-back the whole story is built around. The operator does not restart anything and does not write a work item — they anchor one blocking comment to the criterion it fails, and that comment becomes the acceptance criterion the fix has to meet.',
    },
    {
      // SOURCE-DERIVED. The fix lands on the same branch and the run returns to
      // the review station; keys as beat 9.
      act: 'The fix lands on the same branch and comes back for re-review',
      wait: { for: 'agent', upTo: 1_800_000 },
      expect: {
        route: '/flows/forge-develop/run/<runId>',
        data: { page: 'flow-run', 'timeline-row': 'true', 'node-id': 'review' },
      },
      say: 'No restart, no second cycle, no lost work. The send-back became one more thing to satisfy on the branch that already exists, which is the difference between a review loop and a do-over.',
    },
    {
      // SOURCE-DERIVED, and the merge handle is weaker than one would like.
      // `data-gate-state="approved"` (`app/artifact/page.tsx:924-930`, set at
      // `:1148,1169`) plus the product's own copy "Approved — merged." (`:1190`,
      // `DemoReviewSurface.tsx:243`) IS the merged-outcome handle: there is no
      // machine-readable merged boolean, no PR-state key, anywhere in the DOM.
      // Recorded as an open item — the exit row re-derives the merge with
      // `gh pr view --repo parsoFish/gitpulse`, not from this page.
      act: 'Approve — which is the merge',
      do: [{ press: 'approve-and-merge' }],
      expect: {
        route: '/artifact',
        data: { page: 'artifact', 'gate-state': 'approved' },
      },
      say: 'The second human gate, and the only one that spends something irreversible. Approving is not a signal to a later step — it IS the merge, so the operator is pressing the button that lands the change.',
    },
    {
      // SOURCE-DERIVED. `data-action="open-reflect"` (`app/artifact/page.tsx
      // :1194`, named in that file's own comment at :1177),
      // `data-action="submit-reflection"` (`ReflectionGate.tsx:297`),
      // `data-section="reflect-done"` (`:165`). NOT ONE of these is
      // corroborated by any test file — a repo-wide grep for
      // `reflect-questions`, `reflect-done` in `*.test.ts` returns zero hits.
      act: 'Reflect on the cycle',
      do: [{ press: 'open-reflect' }, { press: 'submit-reflection' }],
      wait: { for: 'agent', upTo: 900_000 },
      expect: { route: '/artifact', data: { section: 'reflect-done' } },
      say: 'The cycle ends by writing down what it learned. This is the step that makes the next cycle cheaper, and it is one shot — the operator confirms what the reflector inferred rather than filling in a form.',
    },
    {
      // SOURCE-DERIVED for the reflected theme. `data-theme-node` /
      // `data-theme-active` (`ThemeList.tsx:34-35`) are the SHAPE S6 b7 already
      // asserts VERIFIED — but S6's theme comes from a project-brain SEEDING
      // session, and no pinned story has ever asserted a REFLECTOR-produced
      // theme. `data-ingest-fresh-themes` (`app/knowledge/page.tsx:824-826`) is
      // the reflector-side evidence and is source-only.
      act: 'Find what the cycle learned on the knowledge graph',
      expect: {
        route: '/knowledge',
        data: { page: 'knowledge', 'page-ready': 'true', 'kb-id': 'gitpulse' },
      },
      say: 'The theme the reflector wrote is now a node the next planner will read. That is the loop closing: this cycle made the project\'s brain bigger, and nobody typed it in.',
    },
    {
      // SOURCE-DERIVED, and the comparison is the hard part. `data-run-cost-usd`
      // is `.toFixed(4)` on the monitor strip (`MonitorSummary.tsx:53,101`)
      // while `data-phase-cost-usd` is `.toFixed(2)` per node
      // (`FlowRunDetail.tsx:285`) — DELIBERATELY different attribute names and
      // precisions (`lib/history-ledger-render.test.ts:228-233` documents the
      // non-collision). NO `event`/`event-log` data key exists anywhere, so the
      // page cannot be compared against the log from inside a beat; the exit
      // row does that comparison outside, with
      // `sumAuthoritativeCostFromLines` over the run's events.jsonl — never the
      // naive sum, which double-counts by more than 2× (M3's measurement).
      act: 'Check what the run cost',
      expect: {
        route: '/monitor',
        data: { page: 'monitor', 'page-ready': 'true', 'run-cost-usd': '<runCostUsd>' },
      },
      say: 'One figure, and it is the same figure the event log holds. A run that cannot say honestly what it spent cannot be trusted with a ceiling, so this is checked against the log rather than taken from the screen.',
    },
    {
      // ACT 2 — SOURCE-DERIVED, and NOTHING in the pinned corpus covers it: a
      // grep for `resume`, `forced stop`, `abort`, `kill`, `pause` across all
      // eleven story files returns zero matches. Handles:
      // `data-section="run-controls"` (`RunControls.tsx:176-180`, corroborated
      // `lib/run-controls-render.test.ts:63-64`), `data-action="abandon-run"` /
      // `"requeue-run"` / `"resume-run"` (`lib/run-controls.ts:41,49,57`,
      // corroborated `lib/run-controls.test.ts:60`), and the arm-then-confirm
      // pair `data-component="abandon-confirm"` + `data-action="confirm-abandon"`
      // (`RunControls.tsx:227,235,243`, corroborated
      // `run-controls-render.test.ts:79-80`). THIS SURFACE CONFIRMS; the
      // roadmap drawer's `recovery-abandon` does not (header note).
      act: 'ACT 2 — stop a run mid-flight',
      do: [{ press: 'abandon-run' }, { press: 'confirm-abandon' }],
      expect: {
        route: '/flows/forge-develop/run/<secondRunId>',
        data: { page: 'flow-run', section: 'run-controls', component: 'abandon-confirm' },
      },
      say: 'Things stop halfway. What matters is not that it never happens but that stopping is a decision the operator makes on purpose, twice, rather than something they discover.',
    },
    {
      // ACT 2 — SOURCE-DERIVED. The preservation evidence lives on the ROADMAP
      // DRAWER, not on run-controls: `data-recovery-attempt-count` and
      // `data-recovery-prior-attempts` (`InitiativeDetail.tsx:291-294,302-303`,
      // corroborated `lib/roadmap-canvas-render.test.ts:292-294`) and
      // `data-recovery-commits` (`:322`) — the branch's surviving commits.
      // `RunControls.tsx` carries NO per-work-item preservation attribute at
      // all, which is why this beat changes surface.
      act: 'ACT 2 — resume it, and see the finished work items survived',
      do: [{ press: 'project-tab-roadmap' }, { press: 'recovery-requeue' }],
      wait: { for: 'agent', upTo: 900_000 },
      expect: {
        route: '/projects/gitpulse',
        data: {
          page: 'projects',
          'project-id': 'gitpulse',
          section: 'recovery-detail',
          'recovery-prior-attempts': '1',
        },
      },
      say: 'The second attempt starts from what the first one finished, not from nothing. The work items that passed are still passed and their commits are still on the branch — that is the whole reason a stopped run is recoverable rather than wasted.',
    },
  ],
};
