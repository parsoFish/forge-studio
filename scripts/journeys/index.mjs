/**
 * journeys/index — the canonical journey registry for scripts/e2e-journey.mjs.
 *
 * JOURNEYS is every declared journey (a `defineJourney()` spec, one module per
 * user story under scripts/journeys/), in the original source map's
 * declaration order. RUN_ORDER is the flat `[journeyId, beatId]` execution
 * sequence the runner drives beat-by-beat — it still INTERLEAVES journeys in
 * today's exact historical execution order (seed/cleanup ordering isn't yet
 * journey-scoped); a later task will make each journey's beats run contiguous
 * once seeding + cleanup are formalised per-journey.
 */
import { journey as standUpCreate } from './stand-up-create.mjs';
import { journey as agents } from './agents.mjs';
import { journey as flowsAuthor } from './flows-author.mjs';
import { journey as standUpOnboard } from './stand-up-onboard.mjs';
import { journey as skills } from './skills.mjs';
import { journey as flowsRun } from './flows-run.mjs';
import { journey as roadmap } from './roadmap.mjs';
import { journey as swapRuntime } from './swap-runtime.mjs';
import { journey as knowledge } from './knowledge.mjs';
import { journey as recovery } from './recovery.mjs';
import { journey as demoBuilder } from './demo-builder.mjs';

export const JOURNEYS = [
  standUpCreate,
  agents,
  flowsAuthor,
  standUpOnboard,
  skills,
  flowsRun,
  roadmap,
  swapRuntime,
  knowledge,
  recovery,
  demoBuilder,
];

export const RUN_ORDER = [
  ['stand-up-create', 'su-create-title'],
  ['stand-up-create', 'su-create-library'],
  ['stand-up-create', 'su-create-orientation'],
  ['agents', 'agents-starters'],
  ['flows-author', 'flows-author-new-flow'],
  ['stand-up-onboard', 'su-onboard-project'],
  ['stand-up-create', 'su-create-instructions'],
  ['stand-up-create', 'su-create-project-brain'],
  ['stand-up-onboard', 'su-onboard-preflight'],
  ['flows-author', 'flows-author-seeded-run'],
  ['flows-author', 'flows-author-scratch-parity'],
  ['agents', 'agents-builder'],
  ['stand-up-create', 'su-create-project-builder'],
  ['skills', 'skills-ootb-library'],
  ['skills', 'skills-edit'],
  ['skills', 'skills-create'],
  ['flows-run', 'flows-run-idea'],
  ['flows-run', 'flows-run-grounding'],
  ['flows-run', 'flows-run-questions'],
  ['flows-run', 'flows-run-freetext'],
  ['flows-run', 'flows-run-stall'],
  ['flows-run', 'flows-run-draft-cost'],
  ['flows-run', 'flows-run-plan-gate'],
  ['flows-run', 'flows-run-send-back'],
  ['flows-run', 'flows-run-approve'],
  ['flows-run', 'flows-run-pm-decompose'],
  ['flows-run', 'flows-run-tdd-red'],
  ['flows-run', 'flows-run-grind'],
  ['flows-run', 'flows-run-dependency-gate'],
  ['flows-run', 'flows-run-unifier'],
  ['flows-run', 'flows-run-cost-rollup'],
  ['flows-run', 'flows-run-review-comment'],
  ['flows-run', 'flows-run-review-send-back'],
  ['flows-run', 'flows-run-rerun'],
  ['flows-run', 'flows-run-re-review'],
  ['flows-run', 'flows-run-approve-merge'],
  ['flows-run', 'flows-run-reflect'],
  ['roadmap', 'roadmap-tab'],
  ['roadmap', 'roadmap-start-development'],
  ['flows-run', 'flows-run-monitor-deep-dive'],
  ['flows-run', 'flows-run-start-run-cta'],
  ['flows-run', 'flows-run-gate-control'],
  ['swap-runtime', 'swap-runtime-sdk-picker'],
  ['knowledge', 'knowledge-graph'],
  ['knowledge', 'knowledge-pin-guidance'],
  ['knowledge', 'knowledge-lint-index'],
  ['recovery', 'recovery-surface'],
  ['demo-builder', 'demo-builder-brief'],
  ['demo-builder', 'demo-builder-generate'],
  ['demo-builder', 'demo-builder-lock'],
];
