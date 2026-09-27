/**
 * S10's ACT 2 — stop a run mid-flight, and resume it.
 *
 * ROW 149 (bead `forge-8vfn.8.1.40`, rulings 1771 / 1774 / 1794). By the time
 * ACT 2 used to run, S10's only initiative was already merged and reflected
 * (ACT 1 + `REVIEW_LOOP` + `CLOSE`), so ACT 2's own "stop a run mid-flight"
 * beats had nothing running to stop — beat 26 of run 37 reds it in the
 * product's own words: standing on the wrong page, no control on it at all,
 * because there was no second run for it to belong to.
 *
 * ACT 2 now starts a SECOND, small initiative on the SAME gitpulse ground
 * through the real UI (`SECOND_IDEA`, `S10.constants.mjs`) — the cheapest real
 * path this product offers, since no interview-free / quick-idea kickoff
 * exists anywhere in `apps/studio` (checked: no `quick-idea`, `skip-interview`
 * or similar handle in the codebase) — waits for its first work item to be
 * genuinely IN FLIGHT (never for it to finish — ROW 149 ROUND 2's own beat
 * comment explains why that shape is vacuous), stops the run mid-build,
 * confirms the halt landed on the product's own `operator-stop` terms with
 * the finished work item complete and the next one never started, resumes
 * it, and confirms the finished work item survived while the unfinished one
 * resumes rather than being skipped. It ends there — the ruling is "do not
 * wait for the resumed run to merge" —
 * and the runner's own teardown (`sweep-teardown.mjs`'s
 * `stopSchedulerCensusAndRelease` / `reapCensusAndSweep`) is what cleans up
 * the still-running resumed cycle: it releases and reaps by `_queue/
 * in-flight/` claim and by process descendants of the daemon, generically,
 * with no special case for a claim that started life as a stop-then-resume
 * rather than a fresh dispatch.
 *
 * THE WI-COUNT RISK, stated rather than hidden. The architect/PM pass that
 * decomposes `SECOND_IDEA` is model-determined, exactly like ACT 1's own —
 * `project-manager.ts` accepts anything from one work item upward (a lone WI
 * is flagged `pm.under-decomposed`, non-blocking, never refused). This file
 * hardcodes `WI-1`/`WI-2` (work items are numbered sequentially from 1,
 * confirmed by every prior run's own `work-items-snapshot/WI-1..N.md` names)
 * on the assumption the idea decomposes into AT LEAST two. If it decomposes
 * into exactly one, the beats waiting on `WI-1` still pass (there is nothing
 * else to wait for) but the ones asserting `WI-2` red honestly — a real
 * finding about this run's own decomposition, not a story defect. The DSL's
 * `expect.data` matches by an exact string per key (`answers()`,
 * `beats-page-read.mjs`), so "at least N of M work items" cannot be expressed
 * without inventing a new comparator; two-plus is not forced, only likely
 * (`SECOND_IDEA` names two distinct facets on purpose — parse/validate the
 * flag, then apply it to the report's row order — the same shape ACT 1's own
 * one-genuinely-risky-clause idea used to guarantee more than a single WI).
 *
 * WHY THE MONITOR, NOT THE RUN-DETAIL PAGE, CARRIES THE PER-WORK-ITEM
 * EVIDENCE. `FlowRunDetail` (`/flows/[id]/run/[runId]`) has no per-WI
 * attribute at all — its timeline is one row per FLOW NODE
 * (`lib/flow-run-timeline.ts:100-104`), and the `dev` node's own fan-out is
 * dropped from that timeline once it fans out (`monitor-layout.ts:220-227`'s
 * `seenPhase` dedupe). Only the flow MONITOR's hex topology
 * (`FlowTopology.tsx`, `/flows/[id]`) expands a fanned-out node into one hex
 * PER WORK ITEM — `[data-mon-node][data-node-id][data-status][data-hex-kind=
 * "wi"][data-wi-id]` (`monitor-layout.ts:190-199`, `FlowTopology.tsx:405-412`)
 * — so every per-WI assertion in this file stands on `/flows/forge-develop`,
 * never on the run's own detail page.
 *
 * THE RUN-DETAIL PAGE HAS NO LIVE REFRESH, which is why every wait on it is
 * shaped the way it is. `app/flows/[id]/run/[runId]/page.tsx` fetches ONCE on
 * mount (`useEffect(() => { void load(signal); }, [load])`, no `subscribe()`,
 * no interval) — a beat that stood still on it waiting for a DOM value to
 * change would poll the same stale snapshot forever. So a beat that needs an
 * async fact from THIS page either (a) asserts something already true the
 * instant its own press resolves (`RunControls`' synchronous `outcome-control`
 * line), pairing that with a `cycleOf`/`terminal` wait that watches the
 * QUEUE on disk rather than the DOM, or (b) leaves the page and comes back —
 * `back-to-monitor` (`FlowRunDetail.tsx:148`) then `RunRail`'s own
 * `open-run-detail` link (`:408-421`) — which forces a fresh mount and a
 * fresh fetch. The flow MONITOR, by contrast, subscribes to the bridge socket
 * and refreshes on both `cycle-list-changed` and per-cycle `event` messages
 * (`app/flows/[id]/page.tsx`'s own header comment), so every wait declared
 * there is an ordinary DOM poll against a page that is actually live.
 *
 * `pickDefaultRun` (`app/flows/[id]/page.tsx:53-59`) resolves the monitor's
 * selected run fresh on every load when nothing is sticky (`gated ?? active
 * ?? complete ?? planned ?? runs[0]`) — this story never presses a run row
 * (`RunCard` carries no `data-action` a `press` step could reach), so nothing
 * here ever sets the sessionStorage sticky pick, and the monitor always
 * re-derives live. `complete` outranks `planned`, so a monitor visit in the
 * WINDOW between a stop and the scheduler reclaiming the resumed manifest
 * can show ACT 1's OWN `complete` run instead of the second one — and ACT 1
 * has its own `WI-1`, already `complete`, so a bare `wi-id`/`status`
 * assertion cannot tell the two runs apart (ROW 149 ROUND 2).
 *
 * ROW 149 ROUND 3 — `run-id` ALONE DOES NOT GUARD IT, AND WHY. The first fix
 * added `run-id: '<cycleId2>'` beside every hex assertion, reasoning that
 * `RunControls`' `data-run-id={run.id}` (`RunControls.tsx:191`, mounted on
 * the monitor too, `schedulerStrip={false}`) names the SELECTED run. True,
 * but `data-run-id` is ALSO rendered on EVERY rail card (`RunRail.tsx:232`),
 * one per run — so `resolveExpectations` (`beats-page-read.mjs`) treats
 * `run-id` as a SHARED key with THREE carriers (two rail cards, one
 * `RunControls`), and its together-rule is satisfied the moment ANY ONE of
 * them carries the wanted value: ACT 2's own rail card (which always exists
 * and always carries `run-id: '<cycleId2>'`, selected or not) satisfies the
 * key on its own, regardless of which run `RunControls`/the topology are
 * actually showing. Proved empirically in
 * `beats-page-read.test.ts` ("ROW 149 ROUND 2/3" tests) before trusting it
 * here. The fix pins `run-id` to `RunControls`' OWN element specifically by
 * pairing it with `section: 'run-controls'` (`RunControls.tsx:189`) — a
 * value no rail card carries at all. That pairing only works because
 * `data-section` has a SECOND, unconditional carrier on this exact page:
 * `HistoryLedger`'s own `<section data-section="history-ledger">`
 * (`HistoryLedger.tsx:106-108`), mounted with no guard at all
 * (`app/flows/[id]/page.tsx:887`) whenever the monitor renders a flow at
 * all. Without that second carrier, `section` would have exactly ONE carrier
 * too, `resolveExpectations` would read it SOLO (bypassing the together-rule
 * entirely), and `section`+`run-id` would be assembled from two DIFFERENT
 * records again — the identical vacuity one level up. With it, `section` is
 * a genuinely SHARED key, `section` and `run-id` co-occur on the SAME record
 * only in `RunControls`' own output, and the union-find groups them there —
 * so `RunControls` showing the wrong run leaves the group unsatisfiable and
 * the beat correctly does not pass. EVERY monitor-page hex assertion in this
 * file therefore names `section: 'run-controls'` TOGETHER WITH
 * `run-id: '<cycleId2>'`, never one without the other.
 *
 * SPLIT, NEVER BASELINE (ruling 492), same as `S10.review.mjs`'s own header.
 * These beats are spread into `beats` at the point they already occupied.
 */
import { SECOND_IDEA, SECOND_CEILING, CYCLE_BOUND } from './S10.constants.mjs';

export const ACT_2 = [
    {
      // SOURCE-DERIVED. `/projects` (`app/projects/page.tsx` ->
      // `ProjectsIndex.tsx`) carries NO `data-page`/`data-page-ready` at all —
      // grepped, not assumed — so this beat asserts the one readiness signal
      // the page actually publishes, `data-fetch-status` (the same convention
      // S5/S9/S6 already use alongside `page`/`page-ready` where those exist;
      // here they do not, so only the real attribute is asserted). Reached by
      // the global Projects pillar (`StudioNav.tsx`, `data-nav="projects"`),
      // present on every page including the one CLOSE's last beat left this
      // story standing on (`/flows/forge-develop`).
      act: 'ACT 2 — open the projects index to start a second initiative',
      expect: {
        route: '/projects',
        data: { 'fetch-status': 'ok' },
      },
      say:
        'A second, smaller change starts the same way the first one did: from the projects the ' +
        'operator already manages.',
    },
    {
      // VERIFIED shape (the story's own beat 1). Reached by the gitpulse
      // project card (`LibraryCard.tsx:81-86`, `data-card-type="project"`,
      // href `/projects/gitpulse`) rendered on the index this beat's
      // predecessor just reached.
      act: 'ACT 2 — open gitpulse again',
      expect: {
        route: '/projects/gitpulse',
        data: { page: 'projects', 'project-id': 'gitpulse', 'page-ready': 'true' },
      },
      say: 'The same ground, a second time — nothing here was reset between the two initiatives.',
    },
    {
      // VERIFIED — same handle as the story's own beat 2.
      act: 'ACT 2 — press "Architect →" for the second idea',
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
      say: 'The first change already merged. The operator has a second, smaller one in mind.',
    },
    {
      // VERIFIED shape — same as the story's own beat 3, a second time with
      // `SECOND_IDEA`/`SECOND_CEILING` (`S10.constants.mjs`).
      act: 'ACT 2 — describe the second idea and start its architect',
      do: [
        { fill: 'idea', with: SECOND_IDEA },
        { fill: 'cost-ceiling-usd', with: SECOND_CEILING },
        { press: 'start-architect' },
      ],
      expect: {
        route: '/architect/new',
        data: {
          page: 'architect-new',
          section: 'new-idea',
          'architect-session-id': '<architectSessionId2>',
        },
      },
      say: 'A smaller ceiling for a smaller idea, set before the work starts.',
    },
    {
      // VERIFIED shape — same repeat/until as the story's own beat 4.
      // UNMEASURED bound (this beat has never been funded): reusing the
      // FIRST idea's own proven 18-minute figure (T1 ruling 625) rather than
      // guessing a smaller one — a wider bound costs wall-clock patience
      // only, never money, and this idea has no precedent run to tighten
      // against.
      act: 'ACT 2 — open the session and answer the second interview',
      do: [
        { press: 'view-architect-session' },
        {
          repeat: [
            {
              fillAll: 'question-freetext',
              with:
                'The gate command is `npm test`. Default the sort direction per column the way the ' +
                'other two reports already do (numeric desc, text asc) — do not invent a new default ' +
                'for coupling. Breaking the existing plain-text or --json output when --sort is absent ' +
                'is not acceptable; the flag is additive, like the first one was.',
            },
            { press: 'submit-answers' },
          ],
          until: { 'session-phase': 'awaiting-verdict' },
        },
      ],
      wait: { for: 'agent', upTo: 1_080_000 },
      expect: {
        route: '/sessions/architect/<architectSessionId2>',
        data: {
          page: 'session',
          'page-ready': 'true',
          'session-kind': 'architect',
          'session-phase': 'awaiting-verdict',
        },
      },
      say: 'A smaller idea, the same interview shape — the architect decides how many rounds it needs.',
    },
    {
      // VERIFIED — same handles and keys as the story's own beat 5.
      act: 'ACT 2 — read the second plan at the gate and approve it',
      do: [{ press: 'open-plan' }, { press: 'approve-plan' }],
      expect: {
        route: '/artifact',
        data: {
          section: 'architect-plan',
          'architect-phase': 'committed',
          'gate-armed': 'false',
          'plan-mode': 'view',
        },
      },
      say: 'Approving the plan is what mints the second initiative — the same act that started the first.',
    },
    {
      // NAVIGATION-ONLY (T1 ruling 533) — same breadcrumb as the story's own
      // beat 6 (`app/artifact/page.tsx`, `data-crumb="project"`).
      act: 'ACT 2 — go back to the project for the second initiative',
      expect: {
        route: '/projects/gitpulse',
        data: { page: 'projects', 'page-ready': 'true' },
      },
      say: 'Back to the project to start the second initiative, exactly as the first one was started.',
    },
    {
      // SOURCE-DERIVED. NO `scheduler-start` press — the story's own beat 7
      // already started the scheduler for ACT 1 and nothing since has
      // stopped it (`scheduler-start` exists only while the scheduler is
      // STOPPED, `lib/scheduler-view.ts`, cited in the story's own beat 7
      // comment; pressing it here would be pressing a handle a running
      // scheduler does not render). Only the roadmap tab needs pressing — a
      // fresh navigation to `/projects/gitpulse` defaults to the `editor` tab
      // (`app/projects/[id]/page.tsx:104`).
      act: 'ACT 2 — return to the roadmap; the scheduler is still running from ACT 1',
      do: [{ press: 'project-tab-roadmap' }],
      expect: {
        route: '/projects/gitpulse',
        data: { page: 'projects', 'project-id': 'gitpulse', 'scheduler-status': 'running' },
      },
      say: 'The scheduler never stopped between the two initiatives — there is nothing to start again.',
    },
    {
      // SOURCE-DERIVED — same shape as the story's own "watch the factory
      // plan and build the initiative" beat, `terminal` alone (no `cycleOf`
      // yet — the second initiative's own id does not exist to bind until
      // THIS beat publishes it) anchored on THIS run's own enqueuing press:
      // approving the plan is what repoints the manifest into
      // `_queue/pending/` (same mechanic the story's own beat 7 comment
      // documents), and the scheduler is already running continuously, so it
      // claims the second initiative without anything else needing to be
      // pressed.
      act: 'ACT 2 — watch the factory plan and build the second initiative',
      do: [],
      wait: {
        for: 'agent', anchor: 'approve-plan',
        terminal: 'ready-for-review',
        upTo: CYCLE_BOUND.ms,
        boundBasis: CYCLE_BOUND.label,
      },
      expect: {
        route: '/projects/gitpulse',
        data: {
          page: 'projects', 'project-id': 'gitpulse',
          'initiative-status': 'ready-for-review', 'plan-state': 'planned',
          'initiative-id': '<runId2>',
        },
      },
      say:
        'The second initiative is smaller, but it is planned and built the same unattended way ' +
        'the first one was.',
    },
    {
      // VERIFIED shape — same `pressBound` as the story's own "open the
      // initiative to find the run it produced" beat, binding the SECOND
      // initiative's own cycle id under its own name so nothing downstream
      // can confuse it with ACT 1's `<cycleId>`.
      act: 'ACT 2 — open the second initiative to find the run it produced',
      do: [{ pressBound: { action: 'open-initiative-', bind: 'runId2' } }],
      expect: {
        route: '/projects/gitpulse',
        data: {
          page: 'projects', 'project-id': 'gitpulse',
          'run-active': 'true',
          'run-cycle-id': '<cycleId2>',
        },
      },
      say:
        'A second run, with its own cycle id — nothing about it is the first run under a ' +
        'different name.',
    },
    {
      // VERIFIED — same handle as the story's own "hand the plan to the
      // build flow" beat. DELIBERATELY NO WAIT here: ACT 1's own beat sits
      // through the WHOLE develop cycle before moving on, which is exactly
      // wrong for ACT 2 — the story needs to catch this run MID-FLIGHT, not
      // after it finishes. `enqueue-kind` flips synchronously on the press,
      // same as the story's own equivalent beat, without needing to wait for
      // anything the daemon does afterwards.
      act: 'ACT 2 — hand the second plan to the build flow',
      do: [{ press: 'start-development' }],
      expect: {
        route: '/projects/gitpulse',
        data: {
          page: 'projects', 'project-id': 'gitpulse',
          'enqueue-kind': 'develop',
        },
      },
      say:
        'Development starts on the second initiative too — and this time the operator does not ' +
        'wait for it to finish.',
    },
    {
      // NAVIGATION-ONLY (T1 ruling 533), reached by the global Flows pillar
      // (`StudioNav.tsx`, `data-nav="flows"`) — the SAME two-hop CLOSE's own
      // "check what the run cost" beats already use (`beats-cost-route.test.ts`),
      // reused rather than a third path invented to reach the same monitor.
      act: 'ACT 2 — open the flows index to watch the second run build',
      expect: {
        route: '/flows',
        data: { page: 'flows-index', 'page-ready': 'true' },
      },
      say: 'Before catching the run mid-flight, the operator opens the flow that is building it.',
    },
    {
      // NAVIGATION-ONLY, reached by the forge-develop FlowCard's own link
      // (`LibraryCard.tsx`'s `FlowCard`, `href="/flows/forge-develop"`) —
      // same mechanism CLOSE's own cost beat uses.
      act: 'ACT 2 — open the develop flow monitor',
      expect: {
        route: '/flows/forge-develop',
        data: { page: 'flow-monitor', 'page-ready': 'true' },
      },
      say: 'This is the surface with per-work-item evidence — the run\'s own detail page has none.',
    },
    {
      // ROW 149 ROUND 2 — WAITS FOR `active`, NEVER `complete`, AND WHY.
      // `resolveDevWiConcurrency` (`packages/kernel/config.ts:325-333`)
      // resolves to `DEFAULT_DEV_WI_CONCURRENCY = 1` (`:299`) for this ground
      // (no `FORGE_DEV_WI_CONCURRENCY` env, no `dev.maxConcurrentWorkItems` in
      // gitpulse's `forge.config.json`, and `developer-ralph`'s own SKILL.md
      // frontmatter declares `fanout: concurrencyCap: 1`,
      // `skills/developer-ralph/SKILL.md:26-29`) — WIs dispatch SEQUENTIALLY,
      // one Ralph loop at a time (`developer-loop.ts:1196-1210`'s
      // `runConcurrentDispatch`). But the operator stop is honoured ONLY at
      // TWO checkpoints — `CycleInput.shouldStopBeforeWorkItem`, consulted
      // BEFORE a WI's worktree is created (`developer-loop.ts:1152`,
      // wired to the flag file at `flow-runner.ts:461-464`), and the next
      // clean NODE boundary — never mid-turn: ADR 028's amendment records
      // that `cycle.ts` never threads `nodeBudgets` into `runFlow` in
      // production, so the wedge-kill live-abort path is "presently dormant
      // outside tests" (`docs/decisions/028-flow-engine.md` ~262-269).
      // Waiting for WI-1 `complete` before pressing stop (the ORIGINAL,
      // wrong shape) means WI-2's worktree is already created and its own
      // Ralph loop is already running by the time the press lands — the next
      // `shouldStopBeforeWorkItem` check is for a WI-3 that does not exist,
      // so nothing stops WI-2 from running to completion, and "WI-2 resumes"
      // would pass VACUOUSLY on a WI-2 the stop never touched. Waiting for
      // `active` instead presses stop WHILE WI-1 is still building: WI-1
      // finishes naturally (nothing aborts a live turn), and the very next
      // checkpoint — before WI-2's worktree would be created — is where the
      // halt actually lands, which is what makes "WI-2 was genuinely
      // unfinished at the stop" a checked fact two beats from here, not an
      // assumption.
      //
      // `active` is `wiStatusFor`'s own word for "has a start event, no end
      // yet, no error" (`packages/flows/run-model-derive-status.ts:176-194`),
      // the SAME `RunPhaseStatus` union `complete`/`pending` come from
      // (`packages/contracts/run-view-types.ts:25`).
      //
      // `section: 'run-controls'` PAIRED WITH `run-id: '<cycleId2>'` GUARDS
      // AGAINST THE WRONG RUN — `run-id` ALONE DOES NOT (ROW 149 ROUND 3,
      // this file's header has the full trace, proved in
      // `beats-page-read.test.ts`): `data-run-id` is also on every rail
      // card (`RunRail.tsx:232`), so a bare `run-id` key is satisfied by
      // ACT 2's own (always-present) rail card regardless of which run
      // `RunControls`/the topology actually show. Pairing it with
      // `section: 'run-controls'` (`RunControls.tsx:189,191`, unique to
      // that one element, and kept out of the solo path by
      // `HistoryLedger`'s own always-rendered `data-section=
      // "history-ledger"`, `HistoryLedger.tsx:106-108`) pins both keys to
      // the SAME record — the selected run's own `RunControls` section —
      // via `beats-page-read.mjs`'s co-occurrence union. UNMEASURED bound:
      // reusing `CYCLE_BOUND` (derived from the FIRST initiative's larger
      // budget) is deliberately generous for this smaller one — a wider
      // bound costs patience, never money.
      act: 'ACT 2 — wait for the second run\'s first work item to start',
      do: [],
      wait: {
        for: 'agent', anchor: 'start-development',
        upTo: CYCLE_BOUND.ms,
        boundBasis: CYCLE_BOUND.label,
      },
      expect: {
        route: '/flows/forge-develop',
        data: {
          page: 'flow-monitor', section: 'run-controls', 'run-id': '<cycleId2>',
          'hex-kind': 'wi', 'node-id': 'dev', 'wi-id': 'WI-1',
          status: 'active',
        },
      },
      say:
        'Something is genuinely in flight before anything is interrupted — otherwise stopping ' +
        'mid-flight proves nothing.',
    },
    {
      // NAVIGATION-ONLY, reached by `RunRail`'s own `open-run-detail` link
      // (`RunRail.tsx:408-421`, href `/flows/${flowId}/run/${run.id}`) for
      // the SECOND run's own card — the run is still `active`, so its card
      // is rendered and pinned by the same live monitor this beat's
      // predecessor already stands on.
      act: 'ACT 2 — open the second run\'s own detail page',
      expect: {
        route: '/flows/forge-develop/run/<cycleId2>',
        data: { page: 'flow-run', 'run-found': 'true', 'page-ready': 'true' },
      },
      say: 'Act 2 starts where Act 1 was watched from: the operator opens the run they are about to stop.',
    },
    {
      // ROW 150 (bead `forge-8vfn.8.1.39`, rulings 1771 + 1774) — the real
      // non-destructive `stop-run` control: `data-section="run-controls"`
      // (`RunControls.tsx:176-180`), `data-action="stop-run"`
      // (`lib/run-controls.ts`'s `RUNNING_CONTROLS`). Non-destructive: posts
      // on its own click, no arm-then-confirm step. `outcome-control` flips
      // SYNCHRONOUSLY once the POST resolves (`RunControls.tsx`'s `act()`),
      // which is what this beat's own `expect.data` reads — the wait below
      // is for the SEPARATE, asynchronous fact that the halt actually landed
      // on disk, read through `cycleOf`/`terminal` (a queue-directory
      // transition, `beats-queue-terminal.mjs`) rather than through this
      // page's own DOM, which never refreshes on its own (this file's
      // header). `terminal: 'failed'` is `_queue/failed/`, the SAME state
      // every other terminal but `ready-for-review` reads by mtime
      // (`beats-queue-terminal.mjs`'s own header). UNMEASURED bound: the
      // halt lands at the next clean node/work-item boundary (ADR 028's
      // amendment), which for this idea is at most one more work item's
      // build — `CYCLE_BOUND` is generous headroom over that.
      act: 'ACT 2 — stop the second run mid-flight',
      do: [{ press: 'stop-run' }],
      wait: {
        for: 'agent', anchor: 'stop-run',
        cycleOf: '<runId2>', terminal: 'failed',
        upTo: CYCLE_BOUND.ms,
        boundBasis: CYCLE_BOUND.label,
      },
      expect: {
        route: '/flows/forge-develop/run/<cycleId2>',
        data: { page: 'flow-run', section: 'run-controls', 'outcome-control': 'stop' },
      },
      say:
        'Things stop halfway. What matters is not that it never happens but that stopping is a ' +
        'decision the operator makes on purpose — and that it never throws away the work already done.',
    },
    {
      // Forces a fresh read (this file's header): the run-detail page fetched
      // once, before the halt landed, and never refetches on its own. Also
      // where the halt's WORK-ITEM-LEVEL effect is checked (the next two
      // beats) — the monitor, not the run-detail page, carries it.
      act: 'ACT 2 — step away while the halt lands',
      do: [{ press: 'back-to-monitor' }],
      expect: {
        route: '/flows/forge-develop',
        data: { page: 'flow-monitor', 'page-ready': 'true' },
      },
      say: 'The runner needs a moment to reach the boundary it halts at.',
    },
    {
      // ROW 149 ROUND 2, REQUIREMENT 3 — THE UNFINISHED WORK IS A CHECKED
      // FACT, NOT AN ASSUMPTION. This beat and the next assert the halt's
      // own two-sided effect BEFORE any resume: the work item the stop's own
      // wait (previous beats) let finish naturally is `complete`, and the one
      // it never let start is still `pending` — never inferred from having
      // waited for `active` earlier. `section`+`run-id` guard the wrong-run
      // risk this file's header explains (ROUND 3: `run-id` alone is
      // vacuous). UNMEASURED bound: the halt was already confirmed on disk
      // (the stop beat's own `cycleOf`/`terminal` wait); this one is only
      // for the monitor's own live-refresh to catch up, which `CYCLE_BOUND`
      // is generous headroom for.
      act: 'ACT 2 — after the halt, the running work item finished naturally',
      do: [],
      wait: {
        for: 'agent', anchor: 'stop-run',
        upTo: CYCLE_BOUND.ms,
        boundBasis: CYCLE_BOUND.label,
      },
      expect: {
        route: '/flows/forge-develop',
        data: {
          page: 'flow-monitor', section: 'run-controls', 'run-id': '<cycleId2>',
          'hex-kind': 'wi', 'node-id': 'dev', 'wi-id': 'WI-1',
          status: 'complete',
        },
      },
      say:
        'The work item already in flight when the operator stopped the run is not thrown away ' +
        'mid-turn — it finishes, because nothing in this product aborts a live turn.',
    },
    {
      // The SECOND half, on the SAME fresh read: the work item the halt
      // never let start. `pending` is `wiStatusFor`'s own word for "zero
      // events" (`run-model-derive-status.ts:177`) — its worktree was never
      // created, because `shouldStopBeforeWorkItem` refused it BEFORE that
      // (`developer-loop.ts:1152`). No wait of its own: this beat reads the
      // SAME settled state the previous beat's wait already brought current.
      // `section`+`run-id`, same ROUND 3 pinning as every other hex beat.
      act: 'ACT 2 — and the next work item never started at all',
      do: [],
      expect: {
        route: '/flows/forge-develop',
        data: {
          page: 'flow-monitor', section: 'run-controls', 'run-id': '<cycleId2>',
          'hex-kind': 'wi', 'node-id': 'dev', 'wi-id': 'WI-2',
          status: 'pending',
        },
      },
      say:
        'That is the fact a resume has to prove it does not skip — not an assumption this story ' +
        'is making about it.',
    },
    {
      // NAVIGATION-ONLY, back to the same run's own detail page for the
      // resume control (`resume-run` lives in `RunControls`, mounted there
      // too, but the failed/stop-reason read and the resume press both need
      // the run-detail page's own unambiguous, URL-keyed identity — never
      // the monitor's `pickDefaultRun`-derived selection). Same
      // `RunRail`/`open-run-detail` link as the earlier visit
      // (`RunRail.tsx:408-421`); `routeMatches`' own destination filter
      // (`beats-drive.mjs`) picks the ONE link whose href is THIS cycle id,
      // never ACT 1's, so two runs on the rail is not an ambiguity here the
      // way it would be for a bare `press`.
      act: 'ACT 2 — open the second run\'s own detail page again',
      expect: {
        route: '/flows/forge-develop/run/<cycleId2>',
        data: { page: 'flow-run', 'run-found': 'true', 'page-ready': 'true' },
      },
      say: 'Back to the run itself to confirm why it stopped, and then to resume it.',
    },
    {
      // A fresh mount, a fresh fetch (this file's header), reading the STATE
      // AFTER the halt the earlier beats' own `cycleOf`/`terminal` wait
      // already confirmed on disk. `data-run-status` is the page root's own
      // attribute (`FlowRunDetail.tsx`'s `main`, solo — the only element on
      // the page carrying it), and `data-run-stop-reason="operator-stop"` is
      // `RunControls`' own status line (`run-controls.ts`'s
      // `runFailureNoteKind`/`describeOperatorStop`, ROW 150 ruling 1774),
      // derived per read from the run's own `flow.operator-stop` event
      // rather than stored.
      act: 'ACT 2 — confirm the stopped, resumable state',
      expect: {
        route: '/flows/forge-develop/run/<cycleId2>',
        data: {
          page: 'flow-run', 'run-status': 'failed',
          'run-stop-reason': 'operator-stop',
        },
      },
      say:
        'The product says plainly why this run stopped — not a crash, an operator decision — ' +
        'and that it is still here to resume.',
    },
    {
      // ROW 150 addendum (ruling 1794) — `resume-run`
      // (`run-controls.ts`'s `FAILED_CONTROLS`, `RunControls.tsx`'s
      // `post()` mapping `resume` -> `resumeRun` -> `POST /api/runs/:id/resume`)
      // is THE control this row names, never `requeue-run`
      // (`recoveryRequeue`, a full fresh-from-main re-run) and never the
      // roadmap drawer's own `recovery-requeue` ACT 1 used to press here —
      // that button lives on `InitiativeDetail.tsx`, not on this page, and
      // this row's own resume control is what the product actually offers
      // beside the run it just stopped. `bridge-studio-runs.ts`'s `/resume`
      // route always passes `resumeFromIntegrate: true`, but
      // `forge-requeue.ts`'s own decision overrides that whenever the prior
      // failure was a CLEAN-BOUNDARY HALT (`requeue-resume.ts`'s
      // `decideRequeueResume` — an operator-stop always is,
      // `cleanBoundaryHalt: true`) — so this press resolves through
      // `inferRequeueResume`, exactly as ruling 1794 names it, never through
      // the operator's own integrate-only override. `outcome-control`
      // flips synchronously, same shape as the stop beat above.
      act: 'ACT 2 — resume via the run\'s own resume control',
      do: [{ press: 'resume-run' }],
      expect: {
        route: '/flows/forge-develop/run/<cycleId2>',
        data: { page: 'flow-run', section: 'run-controls', 'outcome-control': 'resume' },
      },
      say:
        'Resume is not a fresh start. It picks up from what the stop preserved — the worktree, ' +
        'the branch, the work items already done.',
    },
    {
      // Back to the live monitor for the per-work-item evidence — the
      // run-detail page still cannot show it, and still would not refresh
      // even if it could.
      act: 'ACT 2 — step back to the monitor to watch the resumed run',
      do: [{ press: 'back-to-monitor' }],
      expect: {
        route: '/flows/forge-develop',
        data: { page: 'flow-monitor', 'page-ready': 'true' },
      },
      say: 'The second attempt starts from what the first one finished, not from nothing.',
    },
    {
      // `inferRequeueResume`'s own contract (`requeue-resume.ts`'s
      // `decideRequeueResume`): with WI-1 already complete and WI-2 not,
      // the preserved worktree carries no `resume_from` marker and the
      // scheduler's preserved-work-items reuse path re-runs the dev-loop in
      // place — WI-1's own commits are never rebuilt. This beat asserts the
      // FIRST half of that: the finished work item's hex still reads
      // `complete` after the stop and the resume, on the SAME `wi-id` the
      // earlier beat waited for. `section`+`run-id` guard the same wrong-run
      // risk this file's header explains — a resumed run sits briefly
      // `planned` before the scheduler reclaims it, `pickDefaultRun` ranks
      // ACT 1's own `complete` run above `planned`, and `run-id` alone would
      // be satisfied by ACT 2's own rail card regardless (ROUND 3).
      act: 'ACT 2 — the finished work item survived the stop and the resume',
      do: [],
      wait: {
        for: 'agent', anchor: 'resume-run',
        upTo: CYCLE_BOUND.ms,
        boundBasis: CYCLE_BOUND.label,
      },
      expect: {
        route: '/flows/forge-develop',
        data: {
          page: 'flow-monitor', section: 'run-controls', 'run-id': '<cycleId2>',
          'hex-kind': 'wi', 'node-id': 'dev', 'wi-id': 'WI-1',
          status: 'complete',
        },
      },
      say:
        'The work item that passed is still passed and its commits are still on the branch — ' +
        'that is the whole reason a stopped run is recoverable rather than wasted.',
    },
    {
      // The SECOND half: the work item that was unfinished at the stop
      // resumes rather than being silently skipped. `complete` is asserted
      // rather than `active` — the stronger, unambiguous proof that the
      // dev-loop genuinely redid the work rather than leaving it exactly as
      // the stop found it (the skip defect this row exists to catch would
      // read as this work item's hex NEVER changing at all). The DSL cannot
      // express "active or complete" as one condition (`answers()` matches
      // one exact string or any non-empty placeholder, never an either/or —
      // this file's header), so this is the stronger of the two acceptable
      // readings named by row 149, not a weaker substitute for it. Its own
      // wait, separate from the previous beat's: WI-1's survival and WI-2's
      // completion are two different facts and there is no reason one
      // beat's patience should be spent proving the other. Also carries
      // `section`+`run-id`, the same ROUND 3 pinning as every other hex
      // beat — this is the work item that read `pending` two beats before
      // the resume, never assumed to have been the unfinished one.
      act: 'ACT 2 — the unfinished work item resumes, not skipped',
      do: [],
      wait: {
        for: 'agent', anchor: 'resume-run',
        upTo: CYCLE_BOUND.ms,
        boundBasis: CYCLE_BOUND.label,
      },
      expect: {
        route: '/flows/forge-develop',
        data: {
          page: 'flow-monitor', section: 'run-controls', 'run-id': '<cycleId2>',
          'hex-kind': 'wi', 'node-id': 'dev', 'wi-id': 'WI-2',
          status: 'complete',
        },
      },
      say:
        'A stopped run does not skip the work it never reached — it comes back and finishes it. ' +
        'The story ends here: it does not wait for this second, resumed run to merge.',
    },
];
