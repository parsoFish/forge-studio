/**
 * journeys/index — the canonical journey registry for scripts/e2e-journey.mjs.
 *
 * JOURNEYS is every declared journey (a `defineJourney()` spec, one module per
 * user story under scripts/journeys/), in the building-blocks throughline order
 * below. RUN_ORDER is the flat `[journeyId, beatId]` execution sequence the
 * runner drives beat-by-beat — each journey's beats now run CONTIGUOUS (no
 * interleaving): skills → stand-up-onboard → stand-up-create → knowledge →
 * agents → flows-author → flows-run → roadmap → recovery → demo-builder.
 * (the standalone runtime-adapter journey was retired — its checks were
 * folded into agents' agents-scratch-build beat, which drives the SDK/model
 * picker as part of composing a brand-new agent from scratch.) Two
 * hard orderings this sequence must preserve (verified by reading every
 * journey module, not just assumed):
 *   · stand-up-onboard before flows-author — flows-author's seeded-run beat
 *     (J5) reads the project stand-up-onboard onboards (J4_PROJECT) on disk.
 *   · flows-run (all 24 beats, in file-declared order) before roadmap —
 *     roadmap-tab reads the shared cycle log's work-items-snapshot AFTER
 *     flows-run-approve-merge has moved the manifest into `done/`; roadmap
 *     must not run until every flows-run beat (including the ACT-3 SWAP beats
 *     monitor-deep-dive / start-run-cta / gate-control, which stay inside the
 *     flows-run journey itself) has completed.
 * Every other journey (skills, agents, knowledge, recovery, demo-builder) is
 * self-contained: skills-edit restores the real shipped skill it edits,
 * skills-agentic-author removes its staged demo-design artifact + demo
 * sessions, agents-scratch-build/agents-builder each clean up their own
 * skill-dir/stashed-SKILL.md, flows-author-scratch-build cleans its own
 * authored flow, and demo-builder-lock cleans its own seeded state — each at
 * the top/end of their own drive(). skills' created slugs never collide with
 * agents' starter slugs, and skills-create's api-contract-review skill is the
 * throughline artifact: it stays on disk until the runner's finally sweeps it.
 */
import { journey as skills } from './skills.mjs';
import { journey as standUpOnboard } from './stand-up-onboard.mjs';
import { journey as standUpCreate } from './stand-up-create.mjs';
import { journey as knowledge } from './knowledge.mjs';
import { journey as agents } from './agents.mjs';
import { journey as flowsAuthor } from './flows-author.mjs';
import { journey as flowsRun } from './flows-run.mjs';
import { journey as roadmap } from './roadmap.mjs';
import { journey as recovery } from './recovery.mjs';
import { journey as demoBuilder } from './demo-builder.mjs';

export const JOURNEYS = [
  skills,
  standUpOnboard,
  standUpCreate,
  knowledge,
  agents,
  flowsAuthor,
  flowsRun,
  roadmap,
  recovery,
  demoBuilder,
];

export const RUN_ORDER = [
  ['skills', 'skills-ootb-library'],
  ['skills', 'skills-edit'],
  ['skills', 'skills-create'],
  ['skills', 'skills-agentic-author'],

  ['stand-up-onboard', 'su-onboard-project'],
  ['stand-up-onboard', 'su-onboard-preflight'],

  ['stand-up-create', 'su-create-project'],
  ['stand-up-create', 'su-create-library'],
  ['stand-up-create', 'su-create-orientation'],
  ['stand-up-create', 'su-create-instructions'],
  ['stand-up-create', 'su-create-project-brain'],
  ['stand-up-create', 'su-create-project-builder'],

  ['knowledge', 'knowledge-graph'],
  ['knowledge', 'knowledge-pin-guidance'],
  ['knowledge', 'knowledge-create-kb'],
  ['knowledge', 'knowledge-ingest'],
  ['knowledge', 'knowledge-lint-index'],

  ['agents', 'agents-starters'],
  ['agents', 'agents-scratch-build'],
  ['agents', 'agents-builder'],

  ['flows-author', 'flows-author-new-flow'],
  ['flows-author', 'flows-author-scratch-build'],
  ['flows-author', 'flows-author-seeded-run'],

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
  ['flows-run', 'flows-run-monitor-deep-dive'],
  ['flows-run', 'flows-run-start-run-cta'],
  ['flows-run', 'flows-run-gate-control'],

  ['roadmap', 'roadmap-tab'],
  ['roadmap', 'roadmap-start-development'],

  ['recovery', 'recovery-surface'],

  ['demo-builder', 'demo-builder-brief'],
  ['demo-builder', 'demo-builder-generate'],
  ['demo-builder', 'demo-builder-lock'],
];
