/**
 * Developer-loop binding — system prompt + user prompt builders + tool
 * config. Called by orchestrator/phases/developer-loop.ts (runDeveloperLoop);
 * the single source of truth for what the developer agent sees. (The bench
 * harnesses this header once named were removed 2026-05-25.)
 *
 * Contrast vs PM (orchestrator/phases/pm-binding.ts):
 *   - PM is a one-shot decomposition. The agent reads, plans, writes WIs once.
 *   - Developer is a Ralph loop. Each iteration is one SDK query() call; the
 *     loop carries state across iterations via PROMPT.md / AGENT.md / fix_plan.md
 *     in the worktree (stamped by loops/ralph/runner.ts:prepareWorkspace).
 *   - PM forbids Bash. The developer agent NEEDS Bash (run tests, run build,
 *     git commit) — the quality-gate verification still happens orchestrator-side
 *     (the agent's claim of "tests pass" is not trusted; carried-over v1 lesson),
 *     but the agent has to *try* to make tests pass, which means running them.
 *
 * The system prompt is set once when constructing the agent
 * (createClaudeAgent({ systemPrompt: buildDevSystemPrompt(...) })) and reused
 * across every iteration. The per-iteration content lives in PROMPT.md (which
 * the runner re-reads each iteration via claude-agent.ts).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseWorkItem, type WorkItem } from '../work-item.ts';
import { modelForSpec } from '../phase-agent.ts';
import { deriveAgentSpec } from '../studio/derive.ts';
import { skillPath, skillPathRelative } from '../skill-path.ts';

const SKILL_PATH = skillPath('developer-ralph');

export type DevAllowedTool = 'Read' | 'Write' | 'Edit' | 'MultiEdit' | 'Bash' | 'Grep' | 'Glob';
export type DevDisallowedTool = 'NotebookEdit' | 'WebFetch' | 'WebSearch';

/**
 * ADR 024 / M2-3: the developer-loop spec derived from SKILL.md (single
 * source). The orchestrator resolves the model from the tier declared in the
 * frontmatter.
 */
export const devAgentSpec = deriveAgentSpec(skillPathRelative('developer-ralph'));

/** Tool lists derived from the spec — exported for downstream consumers. */
export const DEV_ALLOWED_TOOLS = devAgentSpec.allowedTools as DevAllowedTool[];
export const DEV_DISALLOWED_TOOLS = devAgentSpec.disallowedTools as DevDisallowedTool[];

/** Concrete model, derived from the spec's tier (single source: the spec). */
export const DEV_MODEL = modelForSpec(devAgentSpec);

let cachedSkillText: string | null = null;
function loadSkillText(): string {
  if (cachedSkillText !== null) return cachedSkillText;
  cachedSkillText = readFileSync(SKILL_PATH, 'utf8');
  return cachedSkillText;
}

/**
 * Build the developer-loop system prompt: the SKILL.md contract (which now
 * includes the Ralph-loop discipline block — moved there as part of the ADR 024
 * prose migration so the skill is the single source of intent).
 *
 * F-34 strip-back: previously this loaded the entire brain navigation index
 * (~17 KB) and mandated brain-first reads on every iteration. In practice the
 * brain context is for design (architect / PM / reflector); the dev agent's
 * job is to make code true to the WI's acceptance criteria, full stop. The
 * architect / PM have already encoded relevant brain themes into the WI body.
 * Stripping the navigation index + the mandate cut ~17 KB of context the
 * agent was anchoring on instead of focusing on the WI.
 *
 * @param _brainCwd - kept for signature compatibility with the bench harness;
 *   no longer used since the brain navigation index is no longer loaded.
 */
export function buildDevSystemPrompt(_brainCwd: string): string {
  return loadSkillText();
}

export type DevUserPromptInput = {
  initiativeId: string;
  workItemId: string;
  /** Worktree-relative path to the WI spec, e.g. `.forge/work-items/WI-1.md`. */
  workItemSpecRelPath: string;
  /** Worktree-relative path the agent runs in (usually `.`). */
  worktreeRelPath: string;
  /**
   * ABSOLUTE worktree path. Anchors the agent's cwd so it doesn't guess
   * non-existent sandbox paths (/root/repo, /workspace, …) and burn the
   * iteration re-finding the tree. (F-W5-6's cwd block lived only in the
   * dead PROMPT.md.tmpl path; the live render — this fn — was missing it,
   * which exhausted release_folder's budget on re-orientation, 2026-06-02.)
   */
  worktreePath: string;
  iteration: number;
  iterationBudget: number;
  costBudgetUsd: number;
  filesInScope: string[];
  acceptanceCriteria: Array<{ given: string; when: string; then: string }>;
};

/**
 * Render a per-iteration prompt body. This is the content Ralph stamps into
 * PROMPT.md and re-reads each iteration. The runner (loops/ralph/runner.ts)
 * stamps from a template by default; this helper is provided so callers that
 * want to override the per-iteration body (e.g., tests injecting custom
 * scenarios) have a single source of truth.
 */
export function renderDevUserPrompt(input: DevUserPromptInput): string {
  const acChecklist = input.acceptanceCriteria
    .map(
      (c, i) =>
        `- [ ] AC${i + 1}: GIVEN ${c.given.trim()} WHEN ${c.when.trim()} THEN ${c.then.trim()}`,
    )
    .join('\n');
  const scopeList = input.filesInScope.map((f) => `- \`${f}\``).join('\n');
  return [
    `# Work Item — ${input.workItemId}`,
    '',
    `> Initiative: **${input.initiativeId}** · Iteration **${input.iteration}** of **${input.iterationBudget}** · Cost budget remaining: **$${input.costBudgetUsd.toFixed(2)}**`,
    '',
    '## ⚠️ Your working directory',
    '',
    `Your current working directory is **already** \`${input.worktreePath}\` — your shell starts there and every tool runs there.`,
    '',
    '- Reference files **relative to it** (`AGENT.md`, `fix_plan.md`, `src/…`, `.forge/work-items/…`). Do NOT prepend an absolute prefix, and do NOT guess paths like `/workspaces/…`, `/repo/…`, `/workspace/…`, `/root/…` — they do not exist here. If ever unsure, run `pwd` once, then keep using relative paths. Don\'t spend tool calls re-locating the tree — you are already in it.',
    '',
    '## Spec',
    '',
    `Read \`${input.workItemSpecRelPath}\` for the full work-item spec (acceptance criteria, body, frontmatter).`,
    '',
    '## Acceptance criteria',
    '',
    acChecklist,
    '',
    '## Files in scope',
    '',
    scopeList,
    '',
    '## Your task this iteration',
    '',
    '**You are continuing prior iterations, not starting over** — their work is committed on this branch.',
    '',
    '1. **Check `.forge/last-gate-failure.md` FIRST if it exists** — it is AUTHORITATIVE forge feedback from your last attempt, and it is ONE OF TWO THINGS. Most often it is forge\'s **live** quality gate result (the same gate that decides done vs failed): fix EXACTLY what it reports — your own `make test`/offline gate run can show a **false pass** (live acceptance tests silently skip without `TF_ACC` and print `ok ... 0.00s`, which is NOT a pass), so trust that file over your own run. Less often — headed `MERGE CONFLICT`, not `Live quality-gate failure` — it means your PREVIOUS attempt\'s branch conflicted merging back into the cycle branch: sibling work items already changed the files it lists, so do NOT reproduce your previous edit, read the current state of those files first and rebase your approach onto it. Either way the work item is NOT done until the file is gone. Then **orient on prior progress:** run `git log --oneline main..HEAD` + `git diff --stat main..HEAD` to see what is already built, and read `AGENT.md` (what has been tried) and `fix_plan.md` (the checklist). Don\'t re-research anything `AGENT.md` already records.',
    `2. Read \`${input.workItemSpecRelPath}\` for the full WI body if you haven't yet.`,
    '3. **Write code now.** Make a concrete, committed change toward the highest-priority unchecked acceptance criterion. If an AC needs a new file, write a compiling skeleton of it in your first one or two tool calls, then flesh it out — don\'t spend the whole iteration reading. `files_in_scope` is advisory orientation, NOT a fence: edit any file needed to make the gate pass, including sweeping/mechanical changes across many files (e.g. a formatter run over the whole tree).',
    '4. Run the project\'s quality gates with `Bash`. Don\'t claim a pass without running them — and note an acceptance test that reports `ok ... 0.00s` with 0 tests RUN has SKIPPED (no `TF_ACC`), which is NOT a pass; the authoritative live result is `.forge/last-gate-failure.md`.',
    '5. Commit your changes with a conventional-commits message. If a DECLARED deliverable (a `creates:` path or verification artifact) falls under a `.gitignore` pattern, stage it with `git add -f <path>` — a plain `git add`/`git add -A` silently skips ignored paths and the gate rejects the WI as if you wrote nothing. Never `git add` the loop-scratch files (`AGENT.md`, `PROMPT.md`, `fix_plan.md`): they are gitignored on purpose and stay off the branch. Uncommitted work you leave behind is swept by a safety net and flagged as a commit-discipline failure (`ralph.uncommitted-work-swept`).',
    '6. Update `fix_plan.md` to reflect what\'s done and what\'s left.',
    '7. Update `AGENT.md` with anything you learned, so the next iteration doesn\'t re-tread your steps.',
  ].join('\n');
}

export type PrepareDevWorkspaceInput = {
  initiativeId: string;
  /** Absolute path to the WI spec inside the worktree. */
  workItemSpecPath: string;
  /** Worktree-relative path to the WI spec, e.g. `.forge/work-items/WI-1.md`. */
  workItemSpecRelPath: string;
  /** Absolute path to the worktree the agent runs in. */
  worktreePath: string;
  /** Iteration budget for the loop (used in the prompt header). */
  iterationBudget: number;
  /** Cost budget for the loop (used in the prompt header). */
  costBudgetUsd: number;
  /** Brain-query results to seed AGENT.md with. v1 leaves this empty. */
  brainQueryResults?: string;
};

export type PreparedDevWorkspace = {
  workItem: WorkItem;
  promptPath: string;
  agentMdPath: string;
  fixPlanPath: string;
};

/**
 * Stamp a fully-rendered PROMPT.md, AGENT.md, and fix_plan.md into the
 * worktree from the WI spec. Idempotent — does not overwrite already-stamped
 * files (a re-entrant cycle inherits prior state). Both bench and live cycle
 * call this before `loops/ralph/runner.ts:run()`; the runner's own
 * `prepareWorkspace` is a fallback that uses raw templates when no caller has
 * pre-stamped the worktree.
 */
export function prepareDevWorkspace(input: PrepareDevWorkspaceInput): PreparedDevWorkspace {
  const promptPath = join(input.worktreePath, 'PROMPT.md');
  const agentMdPath = join(input.worktreePath, 'AGENT.md');
  const fixPlanPath = join(input.worktreePath, 'fix_plan.md');

  const workItem = parseWorkItem(readFileSync(input.workItemSpecPath, 'utf8'));

  if (!existsSync(promptPath)) {
    const prompt = renderDevUserPrompt({
      initiativeId: input.initiativeId,
      workItemId: workItem.work_item_id,
      workItemSpecRelPath: input.workItemSpecRelPath,
      worktreeRelPath: '.',
      worktreePath: input.worktreePath,
      iteration: 0,
      iterationBudget: input.iterationBudget,
      costBudgetUsd: input.costBudgetUsd,
      filesInScope: workItem.files_in_scope,
      acceptanceCriteria: workItem.acceptance_criteria,
    });
    writeFileSync(promptPath, prompt);
  }

  if (!existsSync(agentMdPath)) {
    const brainBlock = (input.brainQueryResults ?? '').trim() ||
      '_(no brain context seeded — read theme files yourself if needed; the system prompt has the navigation index.)_';
    writeFileSync(
      agentMdPath,
      [
        `# Agent Memory — ${workItem.work_item_id}`,
        '',
        '> Institutional memory for this work item across Ralph iterations. Read at the start of every iteration; updated at the end.',
        '',
        '## Brain context (loaded at iteration 1)',
        '',
        brainBlock,
        '',
        '## What I\'ve tried',
        '',
        '_(updated by each iteration — most recent at the top)_',
        '',
        '## What worked',
        '',
        '_(append patterns/approaches that produced progress)_',
        '',
        '## What didn\'t work',
        '',
        '_(append dead-ends so future iterations don\'t re-tread them)_',
        '',
        '## Open questions',
        '',
        '_(things that aren\'t blocking but would be useful to clarify; reflector picks these up)_',
        '',
        '## Notes for reflection',
        '',
        '_(observations the reflector should capture into the brain; the agent doesn\'t write them itself, but flags here)_',
        '',
      ].join('\n'),
    );
  }

  if (!existsSync(fixPlanPath)) {
    const checklist = workItem.acceptance_criteria
      .map((c, i) => `- [ ] AC${i + 1}: GIVEN ${c.given.trim()} WHEN ${c.when.trim()} THEN ${c.then.trim()}`)
      .join('\n');
    writeFileSync(
      fixPlanPath,
      [
        '# Fix Plan',
        '',
        `> Checklist for ${workItem.work_item_id}. Tick items as you complete them; add items as you discover sub-problems.`,
        '',
        checklist,
        '',
      ].join('\n'),
    );
  }

  return { workItem, promptPath, agentMdPath, fixPlanPath };
}

/** Tool-use telemetry surfaced by both the bench and the live cycle. */
export type DevToolUseSummary = {
  reads: number;
  /**
   * Subset of `reads` whose tool input pointed at a `brain/...` path.
   * Telemetry only. Per the brain-read policy the dev-loop's intent source
   * is the work item, not the brain; there is no runtime brain-first gate
   * for dev-loop (removed in F-34). Reads of the cycle's project brain
   * (Brain 3) are permitted supplemental context (ADR 010 amendment
   * 2026-05-26); a high count still flags an agent spelunking instead of
   * anchoring on the WI — useful signal, not a gate.
   */
  brainReads: number;
  writes: number;
  bashCalls: number;
  testRuns: number;
};

const TEST_COMMAND_HEADS = new Set([
  'npm',
  'pnpm',
  'yarn',
  'pytest',
  'python',
  'python3',
  'node',
  'bats',
  'go',
  'cargo',
  'mocha',
  'jest',
  'vitest',
]);

/**
 * Inspect a streamed assistant message and increment the summary in place.
 * `testRuns` is a heuristic counted from Bash calls whose first token suggests
 * a test runner (npm, pytest, node, etc.); informational only.
 */
export function tallyToolUse(
  message: { content?: Array<{ type?: string; name?: string; input?: unknown }> } | undefined,
  summary: DevToolUseSummary,
): void {
  const blocks = message?.content ?? [];
  for (const block of blocks) {
    if (block?.type !== 'tool_use') continue;
    const name = block.name ?? '';
    if (name === 'Read' || name === 'Grep' || name === 'Glob') {
      summary.reads += 1;
      const blob = JSON.stringify(block.input ?? {});
      if (blob.includes('brain/') || blob.includes('"brain"')) summary.brainReads += 1;
    } else if (name === 'Write' || name === 'Edit' || name === 'MultiEdit') {
      summary.writes += 1;
    } else if (name === 'Bash') {
      summary.bashCalls += 1;
      if (looksLikeTestRun(block.input)) summary.testRuns += 1;
    }
  }
}

function looksLikeTestRun(input: unknown): boolean {
  if (typeof input !== 'object' || input === null) return false;
  const cmd = (input as { command?: unknown }).command;
  if (typeof cmd !== 'string') return false;
  const head = cmd.trim().split(/\s+/)[0] ?? '';
  return TEST_COMMAND_HEADS.has(head);
}
