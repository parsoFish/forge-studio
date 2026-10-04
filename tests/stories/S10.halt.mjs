/**
 * S10's emergency-halt beats (ADR 011's one halt, row 207) — kept beside the
 * story, not inside it: `S10.story.mjs` and `S10.act2.mjs` sit at the 800-line
 * cap (T1 ruling 492: SPLIT, NEVER BASELINE), and these beats are one concern.
 *
 * TWO CLAIMS, TWO PLACES, ZERO EXTRA AGENT SPEND. The halt stops every NEW claim
 * and lets every active run finish. ACT 1 proves the second half on the story's
 * own build run: the halt is pulled while the develop flow is building, the run
 * still reaches `ready-for-review`, and the drain line reads zero active before
 * the halt is released. ACT 2 proves the first half on the story's own resume:
 * the halt is pulled before `resume-run`, the requeued run stays queued, and the
 * resumed run continues unchanged once the halt is released.
 *
 * SOURCE-DERIVED, like the story's other pages that exist only while a real run
 * is in flight: every key below is read out of `docs/reference/studio-dom-contract.md`'s
 * emergency-halt paragraph, `EmergencyHalt.tsx` and `RunControls.tsx`, and the
 * first funded run turns each into a measured one.
 *
 * `[data-component="emergency-halt-banner"]` is asserted by the PAIR
 * `component` + `halt-active`: `component` alone is carried by many elements, and
 * the co-occurrence rule (`beats-page-read.mjs`'s `resolveExpectations`) binds the
 * pair to the one element that carries both. The control is asserted by its own
 * `halt-state`, which exactly one element carries.
 *
 * NOT ASSERTED, and why. The banner's ABSENCE after release: an expectation names
 * a value the page carries, and the DSL has no "this element is gone" form. The
 * control reading `halt-state="off"` is the same `serve.halt` read that unmounts
 * the banner, so one cannot read `off` while the other still renders.
 */
import { CYCLE_BOUND } from './S10.constants.mjs';

const BANNER = 'emergency-halt-banner';

/** ACT 1 — after `start-development` is pressed (the story's own beat), through the release. */
export const HALT_BUILD = [
  {
    // NAVIGATION-ONLY (T1 ruling 533) — the same global Flows pillar hop ACT 2
    // uses (`StudioNav.tsx`, `data-nav="flows"`).
    act: 'Open the flows index to watch the build',
    expect: {
      route: '/flows',
      data: { page: 'flows-index', 'page-ready': 'true' },
    },
    say: 'The build flow is running the initiative now. The operator opens the flow itself to watch it work.',
  },
  {
    // NAVIGATION-ONLY, reached by the forge-develop FlowCard's own link.
    act: 'Open the develop flow monitor',
    expect: {
      route: '/flows/forge-develop',
      data: { page: 'flow-monitor', 'page-ready': 'true' },
    },
    say: 'This is the surface with per-work-item evidence while a run builds.',
  },
  {
    // The halt is pulled only once a run is genuinely claimed: a halt pressed
    // before the claim would hold the run in the queue and prove a different
    // claim. `active` is `wiStatusFor`'s own word for "started, not finished",
    // asserted as ACT 2's own first-work-item beat asserts it, without naming
    // the work item: any building work item of this run says it is claimed.
    act: 'Wait for the build flow to claim the run',
    do: [{ pressBound: { action: 'select-run-', bind: 'cycleId' } }],
    wait: {
      for: 'agent', anchor: 'start-development',
      upTo: CYCLE_BOUND.ms,
      boundBasis: CYCLE_BOUND.label,
    },
    expect: {
      route: '/flows/forge-develop',
      data: {
        page: 'flow-monitor', section: 'run-controls', 'run-id': '<cycleId>',
        'hex-kind': 'wi', 'node-id': 'dev',
        status: 'active',
      },
    },
    say: 'Something is genuinely running before anything is held back — the run is claimed and a work item is building.',
  },
  {
    // One button, no confirm step: an emergency brake takes one press. The ON
    // state is a full-width alert under the nav on every page.
    act: 'Pull the emergency halt while the run builds',
    do: [{ press: 'emergency-halt' }],
    expect: {
      route: '/flows/forge-develop',
      data: { 'halt-state': 'on', component: BANNER, 'halt-active': '1' },
    },
    say: 'One press. The control flips to its on state and a banner names it on every page: one run finishing, nothing new starts.',
  },
  {
    // The wait is the story's own develop-cycle wait, moved here from the press
    // beat so the halt lands while the run is still building. `halt-active: 0`
    // together with the terminal is the proof: the active run ran to the end
    // under the halt, and the count the operator reads drained to zero.
    act: 'The active run finishes under the halt',
    wait: {
      for: 'agent', anchor: 'start-development',
      terminal: 'ready-for-review',
      cycleOf: '<runId>',
      upTo: CYCLE_BOUND.ms,
      boundBasis: CYCLE_BOUND.label,
    },
    expect: {
      route: '/flows/forge-develop',
      data: { 'halt-state': 'on', component: BANNER, 'halt-active': '0' },
    },
    say: 'The halt stops new work, not work in progress. The run finishes, and the banner now reads every active run finished.',
  },
  {
    act: 'Release the halt',
    do: [{ press: 'release-halt' }],
    expect: {
      route: '/flows/forge-develop',
      data: { 'halt-state': 'off' },
    },
    say: 'Release is one press from the same place. The factory claims work again and the banner is gone.',
  },
];

/** ACT 2 — between the stopped-run confirmation and the existing `resume-run` beat. */
export const HALT_BEFORE_RESUME = [
  {
    act: 'ACT 2 — pull the emergency halt before resuming',
    do: [{ press: 'emergency-halt' }],
    expect: {
      route: '/flows/forge-develop/run/<cycleId2>',
      data: { 'halt-state': 'on', component: BANNER },
    },
    say: 'The operator holds the factory before resuming the stopped run, to see what the halt does to queued work.',
  },
];

/** ACT 2 — after `resume-run`, through the release; the story's own resumed-run waits follow unchanged. */
export const HALT_WHILE_QUEUED = [
  {
    act: 'ACT 2 — step back to the monitor before reading the queued run',
    do: [{ press: 'back-to-monitor' }],
    expect: {
      route: '/flows/forge-develop',
      data: { page: 'flow-monitor', 'page-ready': 'true' },
    },
    say: 'The run page reads its run once; a fresh load shows the state resume left behind.',
  },
  {
    // NAVIGATION-ONLY, reached by `RunRail`'s own `open-run-detail` link for the
    // second run's card. The page loads fresh, so it reads the run as resume
    // left it.
    act: 'ACT 2 — open the resumed run\'s detail page',
    expect: {
      route: '/flows/forge-develop/run/<cycleId2>',
      data: { page: 'flow-run', 'run-found': 'true' },
    },
    say: 'A fresh read of the run the operator just resumed.',
  },
  {
    // The run reads `planned`, so `RunControls` renders its queued line; with the
    // halt on that line is `queued-halted`, ahead of every other tone
    // (`queuedServeTone`). Bounded poll of `expect.data`, as ACT 2's other
    // monitor beats are.
    act: 'ACT 2 — the resumed run waits queued while the halt is on',
    wait: { for: 'agent', anchor: 'resume-run', upTo: 60_000 },
    expect: {
      route: '/flows/forge-develop/run/<cycleId2>',
      data: { page: 'flow-run', 'run-status': 'planned', 'halt-state': 'on', component: 'queued-halted' },
    },
    say: 'Resume put the run back in the queue and the halt keeps it there: the run says it starts when the halt is released, and nothing it had done is lost.',
  },
  {
    act: 'ACT 2 — release the halt so the resumed run can start',
    do: [{ press: 'release-halt' }],
    expect: {
      route: '/flows/forge-develop/run/<cycleId2>',
      data: { 'halt-state': 'off' },
    },
    say: 'Releasing the halt lets the factory claim the queued run; the next beats watch it pick up where the stop left it.',
  },
];
