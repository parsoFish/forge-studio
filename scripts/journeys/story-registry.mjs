/**
 * story-registry.mjs
 *
 * What this is: the wave-5 target story inventory — every scripted story
 * in the studio end-state mockup (`mockups/studio-endstate-v2/journeys-data.jsx`,
 * the `JOURNEYS` map) with its disposition against the real forge-ui journey
 * gallery (`scripts/journeys/`).
 *
 * Why it lives here and not in `docs/`: parity is derived by comparing
 * these refs against `scripts/journeys/index.mjs` journey and beat ids, so
 * a code home makes the dangling-ref check a plain import instead of a
 * markdown parser; the per-batch journey-sync port edits the registry and
 * the journey module in the same directory.
 *
 * Nothing here is a count. Status (`ported` / `pending` / `excluded`) and
 * all totals are DERIVED by `scripts/lib/story-parity.mjs` from the real
 * mockup file, the real journey registry, and these refs. Never add a
 * stored status or a stored count to this file.
 *
 * Port contract for future batches: `port = { journey, beats }` where
 * `journey` is a real id in `scripts/journeys/index.mjs` and `beats` has
 * exactly one entry per mockup beat — either a real beat id string (which
 * must also appear in `RUN_ORDER`) or `{ excluded: '<why>', decision: '<doc
 * reference>' }`. A beat is either ported or explicitly excluded; it is
 * never silently skipped.
 *
 * Optional `note` field: free prose recording WHY an entry is dispositioned
 * the way it is when that is not self-evident from the batch plan — e.g. a
 * story absent from README §4's closure column, or a surface already
 * verified aligned so the port carries no product work. It is carried into
 * the derived report for the reader and is never an input to status.
 *
 * Baseline honesty note: as of 2026-08-03 no story is `ported`. The nine
 * existing journeys in `scripts/journeys/` overlap conceptually with
 * several mockup stories, but none was authored as a beat-for-beat port,
 * so claiming `ported` would be attributing status from a loose semantic
 * match. `ported` is claimed only when a batch actually does the port, as
 * its journey-sync duty.
 */

export const WAVE5_BATCHES = ['A', 'B', 'C', 'D', 'E', 'F'];

const DECISION_2 =
  'docs/roadmaps/README.md §8 "Wave-5A cut decisions (2026-08-03)" ' +
  'decision 2 — plan-band parallelism PARKED as R2-D2';

export const STORY_REGISTRY = [
  {
    story: 'onboard-project',
    batch: 'B',
    port: null,
    excluded: null,
  },
  {
    story: 'create-project',
    batch: 'B',
    port: null,
    excluded: null,
  },
  {
    story: 'create-agent',
    batch: 'B',
    port: null,
    excluded: null,
  },
  {
    story: 'edit-agent',
    batch: 'B',
    port: null,
    excluded: null,
  },
  {
    story: 'create-flow',
    batch: 'C',
    port: null,
    excluded: null,
    note:
      "Only mockup story absent from every batch's functional-closure " +
      'column in README §4. Its surface (flow builder, hex canvas, ' +
      'ArtifactPicker edges) is verified aligned by R4-B13, so the port ' +
      'is a pure journey-sync duty with no product work; assigned to C ' +
      'as the only batch owning flows-pillar modules.',
  },
  {
    story: 'edit-flow',
    batch: null,
    port: null,
    excluded: {
      reason:
        'Whole story is plan-band parallel branching: fork after intake, ' +
        'Demo Design + Research in parallel, Developer as a JOIN. The ' +
        'cut parked plan-band parallelism; forge-develop stays linear.',
      decision: DECISION_2,
    },
  },
  {
    story: 'run-flow',
    batch: 'C',
    port: null,
    excluded: null,
    note:
      "Flow topology verified aligned by R4-B13; the mockup's extra " +
      '"Initiative intake" node is presentation of the existing queue ' +
      "claim, not a new flow node. Batch C's port covers the " +
      'kickoff/run-detail/monitor surfaces the story walks.',
  },
  {
    story: 'run-agent',
    batch: 'C',
    port: null,
    excluded: null,
  },
  {
    story: 'build-hook',
    batch: 'A',
    port: null,
    excluded: null,
  },
  {
    story: 'build-skill',
    batch: 'A',
    port: null,
    excluded: null,
  },
  {
    story: 'install-connections',
    batch: 'A',
    port: null,
    excluded: null,
  },
  {
    story: 'create-kb-project',
    batch: 'D',
    port: null,
    excluded: null,
  },
  {
    story: 'create-kb-cycle',
    batch: 'D',
    port: null,
    excluded: null,
  },
  {
    story: 'kb-maintain',
    batch: 'D',
    port: null,
    excluded: null,
  },
  {
    story: 'install-skills-hooks',
    batch: 'A',
    port: null,
    excluded: null,
  },
  {
    story: 'run-agent-developer',
    batch: 'C',
    port: null,
    excluded: null,
    note:
      'Agent itself verified aligned by R4-B13 (ralph loop, per-WI ' +
      "fanout, write-first continuity); batch C's port covers the " +
      'run/kickoff/monitor surfaces the story walks.',
  },
  {
    story: 'run-agent-adversarial-review',
    batch: 'C',
    port: null,
    excluded: null,
    note:
      'Agent itself verified aligned by R4-B13 (refute-first findings ' +
      "feeding the verdict gate); batch C's port covers the " +
      'run/kickoff/monitor surfaces the story walks.',
  },
  {
    story: 'run-agent-demo-runner',
    batch: 'C',
    port: null,
    excluded: null,
    note:
      'Agent itself verified aligned by R4-B13 (project-demo-skill ' +
      'execution with actual-resource evidence; the showcase-page delta ' +
      'is R4-14 and the project-hook trigger delta is R2-08); batch C\'s ' +
      'port covers the run/kickoff/monitor surfaces the story walks.',
  },
  {
    story: 'run-agent-reflector',
    batch: 'C',
    port: null,
    excluded: null,
    note:
      'Agent itself verified aligned by R4-B13 (outside-the-cycle ' +
      'reflection into the brains on the merged trigger; the brain-tune ' +
      "flow packaging delta is R4-20); batch C's port covers the " +
      'run/kickoff/monitor surfaces the story walks.',
  },
  {
    story: 'run-agent-demo-design',
    batch: null,
    port: null,
    excluded: {
      reason:
        'The demo-design parallel-intake agent is parked and stays ' +
        'vision-badged; no real agent to run.',
      decision: DECISION_2,
    },
  },
  {
    story: 'run-agent-research',
    batch: null,
    port: null,
    excluded: {
      reason:
        'The research parallel-intake agent is parked and stays ' +
        'vision-badged; no real agent to run.',
      decision: DECISION_2,
    },
  },
  {
    story: 'run-agent-architect',
    batch: 'B',
    port: null,
    excluded: null,
  },
  {
    story: 'run-agent-demo-builder',
    batch: 'B',
    port: null,
    excluded: null,
  },
  {
    story: 'run-agent-onboarding',
    batch: 'B',
    port: null,
    excluded: null,
  },
  {
    story: 'run-agent-brain-creation',
    batch: 'D',
    port: null,
    excluded: null,
  },
  {
    story: 'run-flow-onboard',
    batch: 'D',
    port: null,
    excluded: null,
  },
  {
    story: 'run-flow-brain-tune',
    batch: 'D',
    port: null,
    excluded: null,
  },
];
