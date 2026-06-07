/**
 * Shared developer-unifier invocation contract — system prompt + per-iteration
 * prompt builder + workspace prep for the unifier sub-phase.
 *
 * The unifier is a final Ralph that runs after all per-WI Ralphs complete.
 * It owns the initiative-level acceptance criteria, the tracked demo bundle
 * at `<worktree>/demo/<initiative-id>/`, and the PR description draft at
 * `<worktree>/.forge/pr-description.md`. The cycle's developer-loop runner
 * invokes this contract; the SDK-backed Claude agent receives the
 * `buildUnifierSystemPrompt` output as its system prompt and reads
 * `PROMPT.md` (stamped by `prepareUnifierWorkspace`) at the start of every
 * iteration.
 *
 * C19: there is no $ cap; an iteration runaway-bound (see
 * `UNIFIER_DEFAULT_ITERATION_CAP`) is the only backstop — this module does not
 * expose any cost-related fields. (ADR 026 retired the `feedbackRef` send-back
 * mode: review feedback is now appended UWIs the unifier loop runs in place.)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { readWorkItemsFromDir } from './work-item.ts';
import type { DemoShape } from './project-config.ts';
import { modelForSpec, type PhaseAgentSpec } from './phase-agent.ts';

const FORGE_ROOT = resolve(import.meta.dirname, '..');
const SKILL_PATH = resolve(FORGE_ROOT, 'skills', 'developer-unifier', 'SKILL.md');

export type UnifierAllowedTool =
  | 'Read'
  | 'Write'
  | 'Edit'
  | 'MultiEdit'
  | 'Bash'
  | 'Grep'
  | 'Glob';
export type UnifierDisallowedTool = 'NotebookEdit' | 'WebFetch' | 'WebSearch';

export const UNIFIER_ALLOWED_TOOLS: UnifierAllowedTool[] = [
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'Bash',
  'Grep',
  'Glob',
];
export const UNIFIER_DISALLOWED_TOOLS: UnifierDisallowedTool[] = [
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
];
/**
 * ADR 024 seam (first concrete phase): the unifier as a declarative phase
 * agent — it COMPOSES the developer-unifier skill (the source of its intent),
 * the orchestrator spawns it clean at the `sonnet` tier (packaging/unify work,
 * not opus-justifying). Other phases adopt the same `PhaseAgentSpec` shape
 * incrementally. The orchestrator resolves the model from the tier.
 */
export const unifierAgentSpec: PhaseAgentSpec = {
  phase: 'unifier',
  skill: 'skills/developer-unifier/SKILL.md',
  tier: 'sonnet',
  allowedTools: UNIFIER_ALLOWED_TOOLS,
  disallowedTools: UNIFIER_DISALLOWED_TOOLS,
};

/** Concrete model, derived from the spec's tier (single source: the spec). */
export const UNIFIER_MODEL = modelForSpec(unifierAgentSpec);

/**
 * Default unifier iteration cap per CONTRACTS.md C19 (no $ cap;
 * iteration cap is the only bound).
 *
 * Bumped from 3 → 6 (2026-05-24, claude-harness cycle 1 + operator
 * feedback): the unifier's task is *fundamentally different* from a
 * per-WI Ralph — it has to read every WI's output holistically, judge
 * whether the initiative was met, generate a project-shape-specific
 * demo, AND compose a PR description. That exploration legitimately
 * spans more turns than a 2–3-file WI fix. Three iterations was a
 * "match the per-WI cap" choice that left no room for the multi-step
 * read → write → review → revise rhythm the unifier actually does.
 */
export const UNIFIER_DEFAULT_ITERATION_CAP = 15;

let cachedSkillText: string | null = null;
function loadSkillText(): string {
  if (cachedSkillText !== null) return cachedSkillText;
  cachedSkillText = readFileSync(SKILL_PATH, 'utf8');
  return cachedSkillText;
}

/**
 * Build the unifier system prompt: the SKILL.md contract (which now includes
 * the Ralph-loop discipline block and the iter-1-skeleton rule — moved there
 * as part of the ADR 024 prose migration so the skill is the single source of
 * intent). Identical shape to `buildDevSystemPrompt` so the SDK adapter can be
 * reused unchanged.
 */
export function buildUnifierSystemPrompt(): string {
  return loadSkillText();
}

export type UnifierUserPromptInput = {
  initiativeId: string;
  /** Worktree-relative path to the initiative manifest. */
  manifestRelPath: string;
  /** Worktree-relative paths of every WI spec the initiative contains. */
  workItemSpecs: string[];
  iteration: number;
  iterationBudget: number;
  demoShape: DemoShape;
  qualityGateCmd: string[];
};

/**
 * Render the per-iteration prompt body that gets stamped into PROMPT.md.
 * The runner re-reads PROMPT.md every iteration; this is the body the
 * agent sees as "Iteration N — what to do this round".
 *
 * Static instructional prose (role, iter-1-skeleton rule, hard rules) now
 * lives in SKILL.md (ADR 024 prose migration). This builder emits only the
 * DYNAMIC run-context: initiative id, manifest path, WI spec list, iteration
 * counter, demo shape, and quality-gate command.
 */
export function renderUnifierUserPrompt(input: UnifierUserPromptInput): string {
  const wiList = input.workItemSpecs.length > 0
    ? input.workItemSpecs.map((p) => `- \`${p}\``).join('\n')
    : '- _(no work items recorded; consult the manifest body)_';

  const demoBlock = demoInstructionsForShape(input.demoShape);

  return [
    '# Developer-unifier — iteration brief',
    '',
    `> Initiative: **${input.initiativeId}** · Iteration **${input.iteration}** of **${input.iterationBudget}** · Demo shape: **${input.demoShape}**`,
    '',
    '## Inputs',
    '',
    `- Initiative manifest: \`${input.manifestRelPath}\`.`,
    `- Quality-gate command: \`${input.qualityGateCmd.join(' ')}\`.`,
    '  **The demo must demonstrate THIS command (the gate forge actually ran), verbatim — never a narrower one.**',
    '- Per-WI specs:',
    wiList,
    '- `AGENT.md` — institutional memory + prior iteration notes.',
    '- `fix_plan.md` — initiative-level AC checklist.',
    '',
    '## What to do this iteration',
    '',
    [
      '1. **Read AGENT.md and fix_plan.md.**',
      '2. **Read each WI spec** to know the union of files_in_scope (your scope ceiling).',
      `3. **Run the quality gate**: \`${input.qualityGateCmd.join(' ')}\`. If red, fix within scope.`,
      '4. **Produce the demo** under `demo/<initiative-id>/`:',
      demoBlock,
      '5. **Write `.forge/pr-description.md`** — substantive Why/What/How sections. Anchor on `git diff --name-only main...HEAD` to list ONLY files that ACTUALLY appear in the diff. The orchestrator appends the `## Demo` section; do not add one yourself.',
      '6. **Commit** as `feat(<initiative-id>): unify and demo`. Skip the commit if no changes were made.',
      '7. **Push** the branch so `origin/<branch>` == local HEAD.',
      '8. **Update AGENT.md** with what you did this iteration.',
    ].join('\n'),
    '',
    '## Constraints',
    '',
    '- Scope ceiling: union of all WIs\' `files_in_scope` ∪ `demo/<initiative-id>/**` ∪ `.forge/pr-description.md`.',
    `- Iteration cap: **${input.iterationBudget}** (no $ cap per CONTRACTS.md C19).`,
    '- Do **NOT** call `gh pr create` or `gh pr merge`.',
    '- Do **NOT** re-implement work from the WI specs — every WI is ALREADY committed; verify with `git log`.',
    '- After completing this iteration, **stop**.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * ADR 021: the demo author is unified around ONE structured `demo.json`
 * (validated against the schema — this is the contract that fixes free-form
 * inconsistency). `forge demo render` derives DEMO.md/DEMO.html.
 *
 * The canonical demo capability — effort tiers, per-shape rules, the
 * behavioural-delta discipline, media capture, and the UI mapping — lives in
 * `skills/demo/SKILL.md` (ADR 024: a capability the unifier agent composes).
 * The per-shape guidance below is its operational summary for the inline brief;
 * keep the two in sync.
 */
function demoInstructionsForShape(shape: DemoShape): string {
  const schema = [
    '   **The demo contract is defined in `skills/demo/SKILL.md`** (the canonical',
    '   demo capability: what every demo must contain, effort tiers scaled to the',
    '   diff, per-shape rules, and how it maps to the review UI). Summary:',
    '   **`demo/<initiative-id>/demo.json` schema (the contract):**',
    '   - `title` (string, required) — one-line essence.',
    '   - `essence` (string, required) — what behaviour changed and why it matters.',
    '   - `project` (string, required), `initiativeId`, `baseRef`, `changedRef`.',
    '   - `diffStat` (string, required) — output of `git diff --stat main...HEAD`.',
    '   - `checkpoints` (array, ≥1 required) — each `{ label, caption, beforeNote?, afterNote?, kind?: screenshot|video|harness, metrics?, beforeImage?, afterImage? }`. Describe BEHAVIOUR (before vs after), never "what is broken".',
    '   - `acceptanceCriteria` (string[], optional).',
    '   - `summary` (object, optional) — `{ bullets: string[], prUrl?, branch?, commitSha? }`.',
    '   - `apiDiff` (array, optional) — `{ name, change: "added"|"changed"|"removed", before?, after? }[]`.',
    '   - `testEvidence` (array, optional) — `{ name, result: "pass"|"fail"|"skip", delta? }[]`.',
    '   - `filesChanged` (array, optional) — `{ path, note? }[]` annotated file list.',
    '   - `usage_example` (string, optional) — a fenced code block (HCL/CLI/API) showing how to USE the new capability. Required for new-or-changed-capability initiatives.',
    '   - `impact` (string[], optional) — bullet list of what the new capability unlocks. Required for new-or-changed-capability initiatives.',
    '   **Parity vocabulary for harness metrics:** `match` (exact same), `within` (within tolerance), `diverged` (regression), `incomplete` (baseline missing).',
    '   After writing demo.json, run `Bash forge demo render <initiative-id>` to emit DEMO.md + DEMO.html, then commit all three.',
  ].join('\n');
  switch (shape) {
    case 'browser':
      return [
        '   This is a VISUAL initiative — fill demo.json checkpoints AND capture media:',
        '   - Author the structured checkpoints (label + caption + before/after notes).',
        '   - **Run the demo skill\'s capture step** to fill before/after screenshots: `Bash forge demo capture <initiative-id>` (best-effort; back-fills `beforeImage`/`afterImage`; skip entirely for a trivial diff — see the effort tiers in skills/demo/SKILL.md).',
        schema,
      ].join('\n');
    case 'harness':
      return [
        '   Behaviour measurable at the test layer — fill demo.json with harness metrics:',
        '   - Run the project\'s demo/harness command against baseline AND HEAD, scrape stable result lines.',
        '   - Encode them as a `harness` checkpoint with `metrics: [{ label, before, after, deltaPct, parity }]`.',
        '   - Parity vocabulary: `match` = exact same, `within` = within tolerance, `diverged` = regression, `incomplete` = baseline missing.',
        '   - Author a `testEvidence[]` array — one row per test suite or key case, with `result: "pass"|"fail"|"skip"` and coverage `delta`.',
        '   - Do NOT author "Visual Changes"/screenshots — there are none for a harness demo.',
        '   - For a new-or-changed-capability initiative: MUST also author `usage_example` (fenced HCL/CLI/API block showing how to use the capability) and `impact` (string array of what it unlocks).',
        schema,
      ].join('\n');
    case 'cli-diff':
      return [
        '   - Run the project\'s demo command twice (baseline + HEAD); capture stdout.',
        '   - Encode the before/after in checkpoint `beforeNote`/`afterNote` (or a metrics row). No media required.',
        schema,
      ].join('\n');
    case 'artifact':
      return [
        '   - Run the project\'s demo command; capture the produced file/stdout block.',
        '   - Summarise it in a checkpoint caption + before/after notes. No media required.',
        schema,
      ].join('\n');
    case 'none':
      return [
        '   - Infra-only initiative. No media. A single checkpoint whose caption +',
        '     afterNote is a rationale block ("what would a reviewer grep to convince',
        '     themselves this works") satisfies the schema.',
        schema,
      ].join('\n');
  }
}

export type PrepareUnifierWorkspaceInput = {
  initiativeId: string;
  /** Worktree-relative manifest path. */
  manifestRelPath: string;
  /** Absolute path to the worktree the agent runs in. */
  worktreePath: string;
  iterationBudget: number;
  demoShape: DemoShape;
  qualityGateCmd: string[];
};

export type PreparedUnifierWorkspace = {
  promptPath: string;
  agentMdPath: string;
  fixPlanPath: string;
};

/**
 * Stamp PROMPT.md, AGENT.md, and fix_plan.md for the unifier sub-phase.
 * Idempotent — does not overwrite already-stamped files (a re-entrant
 * cycle inherits prior state).
 *
 * The fix_plan.md is initialised from the initiative's WI ACs so the
 * agent has a single checklist to tick.
 */
export function prepareUnifierWorkspace(
  input: PrepareUnifierWorkspaceInput,
): PreparedUnifierWorkspace {
  const promptPath = join(input.worktreePath, 'PROMPT.md');
  const agentMdPath = join(input.worktreePath, 'AGENT.md');
  const fixPlanPath = join(input.worktreePath, 'fix_plan.md');

  // Collect every WI spec under .forge/work-items/ for the prompt.
  const workItemsDir = join(input.worktreePath, '.forge', 'work-items');
  const wiSpecs: string[] = [];
  const acCriteria: Array<{ wi: string; given: string; when: string; then: string }> = [];
  if (existsSync(workItemsDir)) {
    const { items } = readWorkItemsFromDir(workItemsDir);
    for (const wi of items) {
      wiSpecs.push(`.forge/work-items/${wi.work_item_id}.md`);
      for (const ac of wi.acceptance_criteria) {
        acCriteria.push({ wi: wi.work_item_id, given: ac.given, when: ac.when, then: ac.then });
      }
    }
  }

  if (!existsSync(promptPath)) {
    const prompt = renderUnifierUserPrompt({
      initiativeId: input.initiativeId,
      manifestRelPath: input.manifestRelPath,
      workItemSpecs: wiSpecs,
      iteration: 1,
      iterationBudget: input.iterationBudget,
      demoShape: input.demoShape,
      qualityGateCmd: input.qualityGateCmd,
    });
    writeFileSync(promptPath, prompt);
  }

  if (!existsSync(agentMdPath)) {
    writeFileSync(
      agentMdPath,
      [
        `# Unifier Agent Memory — ${input.initiativeId}`,
        '',
        '> Institutional memory across unifier-Ralph iterations. Read at the start of every iteration; updated at the end.',
        '',
        '## What I tried',
        '',
        '_(updated by each iteration — most recent at the top)_',
        '',
        '## Notes for reflection',
        '',
        '_(observations the reflector should capture into the brain)_',
        '',
      ].join('\n'),
    );
  }

  if (!existsSync(fixPlanPath)) {
    const checklist = acCriteria.length > 0
      ? acCriteria
          .map(
            (ac, i) =>
              `- [ ] AC${i + 1} (${ac.wi}): GIVEN ${ac.given.trim()} WHEN ${ac.when.trim()} THEN ${ac.then.trim()}`,
          )
          .join('\n')
      : '- [ ] _(no acceptance criteria found in WI specs; consult manifest)_';
    writeFileSync(
      fixPlanPath,
      [
        '# Fix Plan — unifier sub-phase',
        '',
        '> Initiative-level acceptance criteria. Tick each as you prove it against branch tip. Iteration 1 is initial prep; iterations 2+ react to either gate failures or send-back feedback.',
        '',
        checklist,
        '',
      ].join('\n'),
    );
  }

  // Ensure the .forge/ scratch dir exists for pr-description.md authoring.
  const forgeDir = join(input.worktreePath, '.forge');
  if (!existsSync(forgeDir)) mkdirSync(forgeDir, { recursive: true });

  return { promptPath, agentMdPath, fixPlanPath };
}
