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
 * CONTRACTS.md C3b: when `feedbackRef` is set, the per-iteration prompt
 * augments the brief with send-back semantics. C19: there is no $ cap; an
 * iteration runaway-bound (see `UNIFIER_DEFAULT_ITERATION_CAP`) is the
 * only backstop — this module does not expose any cost-related fields.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { readWorkItemsFromDir } from './work-item.ts';
import type { DemoShape } from './project-config.ts';

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
export const UNIFIER_MODEL = 'claude-sonnet-4-6';

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
 * Build the unifier system prompt: the SKILL.md contract plus Ralph
 * discipline notes. Identical shape to `buildDevSystemPrompt` so the SDK
 * adapter can be reused unchanged.
 */
export function buildUnifierSystemPrompt(): string {
  return [
    '# developer-unifier skill contract',
    '',
    loadSkillText(),
    '',
    '---',
    '',
    '# Ralph loop discipline (unifier sub-phase)',
    '',
    'You are inside a **Ralph loop** running on the initiative branch AFTER all per-WI Ralphs have completed. Each call to you is **one iteration**. The loop carries state via three worktree files you must read at the start of every iteration:',
    '',
    '- **`PROMPT.md`** — the per-iteration brief (initiative ID, manifest path, demo shape, iteration counter, optional send-back feedback reference).',
    '- **`AGENT.md`** — institutional memory across iterations. Read first, update last.',
    '- **`fix_plan.md`** — checklist of initiative-level ACs. Tick items as you prove each one against the branch tip.',
    '',
    'After your work this iteration, **commit** with `feat(<initiative-id>): unify and demo` (or `fix(<initiative-id>): address review round <N>` in send-back mode). Atomic commits — one concern per commit. You may use `Bash` for `git`, the quality gate, the demo runner, etc.',
    '',
    '**The orchestrator decides when to stop, not you.** It runs four composed gates between your iterations:',
    '1. `initiative_gate` — the project quality-gate command against the whole branch.',
    '2. `demo_runs_clean` — the project demo-command exits 0 (excused for shape "none").',
    '3. `pr_self_contained` — `demo/<initiative-id>/demo.json` exists and validates against the structured demo schema (ADR 021), and `.forge/pr-description.md` has substantive Why/What/How/Demo sections.',
    '4. `branches_in_sync` — `origin/<branch>` == local HEAD; main == merge-base.',
    '',
    'All four must pass for the unifier to exit clean. There is a runaway-bound on iterations (no $ cap per CONTRACTS.md C19) — treat it as a backstop, not a target.',
    '',
    'Hard rules:',
    '- **Scope discipline.** Files you may modify are the union of all WIs\' `files_in_scope` plus the tracked demo path (`demo/<initiative-id>/**`) plus `.forge/pr-description.md`. Anything else is a scope violation; flag in `AGENT.md` for the reflector.',
    '- **No `gh pr create`, no `gh pr merge`.** The review phase opens the PR from your output.',
    '- **No queue mutation.** `_queue/` is read-only; in send-back mode the feedback file is your input, not your output.',
    '- **No shortcuts.** Don\'t skip tests, don\'t `--no-verify`, don\'t disable lint rules to pass.',
    '- **No hallucinated test passes.** If you claim tests pass, prove it via `Bash`. The orchestrator re-runs them and exits failed if your claim was wrong.',
  ].join('\n');
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
  /**
   * Optional path to a C3a `pr-feedback.md`. When set, the unifier is in
   * send-back mode (C3b) and the prompt augments accordingly.
   */
  feedbackRef: string | undefined;
};

/**
 * Render the per-iteration prompt body that gets stamped into PROMPT.md.
 * The runner re-reads PROMPT.md every iteration; this is the body the
 * agent sees as "Iteration N — what to do this round".
 */
export function renderUnifierUserPrompt(input: UnifierUserPromptInput): string {
  const sendBackMode = input.feedbackRef !== undefined;
  const wiList = input.workItemSpecs.length > 0
    ? input.workItemSpecs.map((p) => `- \`${p}\``).join('\n')
    : '- _(no work items recorded; consult the manifest body)_';

  const demoBlock = demoInstructionsForShape(input.demoShape);
  const sendBackBlock = sendBackMode
    ? [
        '',
        '## Send-back mode (CONTRACTS.md C3b)',
        '',
        `This is a send-back round. Read \`${input.feedbackRef}\` (C3a schema: line-level + PR-level review comments) and address each comment by file/line. Commit. Push. Do not exceed the iteration cap. Do not add scope beyond what the comments request.`,
        '',
        'After addressing the comments, post an ack comment on the PR:',
        '',
        '```',
        'gh pr comment --body "<!-- forge:verdict-ack --> addressed: <brief summary>"',
        '```',
        '',
      ].join('\n')
    : '';

  return [
    '# Developer-unifier — iteration brief',
    '',
    `> Initiative: **${input.initiativeId}** · Iteration **${input.iteration}** of **${input.iterationBudget}** · Demo shape: **${input.demoShape}**`,
    '',
    '## ⚠ YOU ARE THE UNIFIER — NOT A DEVELOPER',
    '',
    'Every per-WI dev-loop has ALREADY COMPLETED. The agents that ran',
    'them already wrote the code, ran the tests, and committed. Their',
    'commits are on this branch — verify with `git log --oneline ' +
      'main...HEAD`. Your job is **NOT to implement WIs**. It is:',
    '',
    '1. Confirm the initiative was met (read the merged WI commits + run',
    '   the gate to verify they still pass together).',
    '2. **Author the structured demo** at `demo/' + input.initiativeId + '/demo.json`',
    '   (the schema below — this is the contract), then run',
    '   `forge demo render ' + input.initiativeId + '` to emit the derived',
    '   `DEMO.md` + `DEMO.html`.',
    '3. **Write the PR description** at `.forge/pr-description.md`',
    '   (substantive Why/What/How/Demo sections; must include `## Demo`).',
    '4. Commit + push.',
    '',
    'If you find yourself reading WI specs to "figure out what to implement",',
    'STOP — that work is done. Read them only to understand SCOPE (what',
    'files this initiative touches) so your demo + description cover them.',
    '',
    '## ⚠ WRITE-FIRST DISCIPLINE — DRAFT WITHIN 2 TOOL CALLS',
    '',
    '**Iteration 1, tool call #1 or #2: `Write` a SKELETON of**',
    '`demo/' + input.initiativeId + '/demo.json` **AND** `.forge/pr-description.md`.',
    'A minimal valid demo.json is fine. Placeholder prose is fine. The point is',
    'to have something on disk that the gate will see; you refine it in',
    'subsequent iterations (then re-run `forge demo render`).',
    '',
    'Minimal valid iter-1 demo.json skeleton (the required core; see the full',
    'schema below):',
    '',
    '```json',
    '{',
    '  "title": "<one-line essence>",',
    '  "essence": "<what behaviour changed and why it matters>",',
    '  "project": "<project name from the manifest>",',
    '  "initiativeId": "' + input.initiativeId + '",',
    '  "diffStat": "<git diff --stat main...HEAD>",',
    '  "checkpoints": [',
    '    { "label": "main", "caption": "<what this demonstrates>",',
    '      "beforeNote": "<prior behaviour>", "afterNote": "<new behaviour>" }',
    '  ]',
    '}',
    '```',
    '',
    'and',
    '',
    '```',
    '## Why',
    '<placeholder, fills in iter 2+>',
    '## What',
    '<placeholder>',
    '## How',
    '<placeholder>',
    '## Demo',
    'See [demo/' + input.initiativeId + '/DEMO.md](../demo/' + input.initiativeId + '/DEMO.md).',
    '```',
    '',
    'Then `Bash git add . && git commit -m "wip: unifier skeleton"` and',
    'continue investigation in iter 2+. **DO NOT spend iteration 1 reading**',
    '**files. The skeleton goes in FIRST.** This is the consistent failure',
    'mode (observed 5+ cycles): 10+ iters of `ls` + `git log` + `cat` with',
    'zero writes, terminal-fail at iteration-budget. Don\'t replicate.',
    '',
    '## Inputs',
    '',
    `- Initiative manifest: \`${input.manifestRelPath}\`.`,
    `- Quality-gate command: \`${input.qualityGateCmd.join(' ')}\`.`,
    '- Per-WI specs:',
    wiList,
    '- `AGENT.md` — institutional memory + prior iteration notes.',
    '- `fix_plan.md` — initiative-level AC checklist.',
    sendBackMode ? `- Feedback ref: \`${input.feedbackRef}\` (read this BEFORE writing any code).` : '',
    sendBackBlock,
    '## What to do this iteration',
    '',
    sendBackMode
      ? [
          '1. **Read AGENT.md, fix_plan.md, and the feedback file.**',
          '2. **Address each comment** in the feedback file. If a comment maps to `path:line`, edit that file. If a comment is general (PR-level), update the PR body or add a `## Notes` section.',
          '3. **Re-run the quality gate.** Fix anything that breaks.',
          '4. **Refresh the demo** if the change is user-visible.',
          '5. **Commit** as `fix(<initiative-id>): address review round <N>`.',
          '6. **Push** the branch.',
          '7. **Post the ack comment** on the PR.',
          '8. **Update AGENT.md** with what you addressed.',
        ].join('\n')
      : [
          '1. **Read AGENT.md and fix_plan.md.**',
          `2. **Read each WI spec** to know the union of files_in_scope (your scope ceiling).`,
          `3. **Run the quality gate**: \`${input.qualityGateCmd.join(' ')}\`. If red, fix within scope.`,
          '4. **Produce the demo** under `demo/<initiative-id>/`:',
          demoBlock,
          '5. **Write `.forge/pr-description.md`** — substantive Why/What/How/Demo sections (Demo section must reference `demo/<initiative-id>/DEMO.md` via a relative link). Anchor on `git log` + `git diff --stat main...HEAD`.',
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
  /** Optional send-back feedback file path (per C3b). */
  feedbackRef: string | undefined;
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
      feedbackRef: input.feedbackRef,
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
