/**
 * Shared demo-author invocation contract — system + user prompt builders +
 * tool config (F-44).
 *
 * The demo-author agent writes exactly two files into the demo working dir:
 * `demo.spec.ts` (one Playwright spec) and `demo-manifest.json`. The
 * orchestrator (orchestrator/demo.ts) then runs the spec against the
 * baseline tree and the changed tree and composes the before/after report.
 *
 * Lean system prompt (same posture as reviewer-invocation post-F-41): the
 * SKILL.md contract + discipline only. Brain context is reached via the
 * mandated `brain-query` first action in the SKILL, not via a prepended
 * navigation index — keeps the prompt cheap and avoids redundant re-reads.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FORGE_ROOT = resolve(import.meta.dirname, '..');
const SKILL_PATH = resolve(FORGE_ROOT, 'skills', 'demo', 'SKILL.md');

export type DemoScriptAllowedTool = 'Read' | 'Grep' | 'Glob' | 'Write' | 'Bash';
export type DemoScriptDisallowedTool = 'Edit' | 'NotebookEdit' | 'WebFetch' | 'WebSearch';

// Edit is disallowed on purpose: the agent must NOT modify project source,
// only Write the two demo files. Bash is allowed for read-only inspection
// (git diff, ls) but the agent does not run the spec — the orchestrator does.
export const DEMO_SCRIPT_ALLOWED_TOOLS: DemoScriptAllowedTool[] = [
  'Read',
  'Grep',
  'Glob',
  'Write',
  'Bash',
];
export const DEMO_SCRIPT_DISALLOWED_TOOLS: DemoScriptDisallowedTool[] = [
  'Edit',
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
];
export const DEMO_SCRIPT_MODEL = 'claude-sonnet-4-6';

let cachedSkillText: string | null = null;
function loadSkillText(): string {
  if (cachedSkillText !== null) return cachedSkillText;
  cachedSkillText = readFileSync(SKILL_PATH, 'utf8');
  return cachedSkillText;
}

/**
 * System prompt: the demo SKILL.md contract + the behavioural-delta
 * discipline. `_brainCwd` kept for signature parity with other invocation
 * contracts; not used (no prepended brain index — brain-query is the
 * SKILL's mandated first action).
 */
export function buildDemoScriptSystemPrompt(_brainCwd?: string): string {
  return [
    '# demo-author skill contract',
    '',
    loadSkillText(),
    '',
    '---',
    '',
    '# Operating discipline',
    '',
    '- You produce EXACTLY two files: `demo.spec.ts` and `demo-manifest.json`,',
    '  both in the demo working directory given below. Nothing else.',
    '- You never modify project source (the Edit tool is disabled). You never',
    '  run the spec, build, or start a server — the orchestrator does that',
    '  twice (baseline tree, changed tree) with `DEMO_BASE_URL` +',
    '  `DEMO_SCREENSHOT_DIR` set per run.',
    '- The same spec runs against BOTH trees unchanged. It must not branch on',
    '  which tree it is — it captures whatever behaviour is present. The',
    '  before/after contrast is produced by running it twice, not by the spec',
    '  detecting versions.',
    '- ONE `test()` per checkpoint; the test title MUST equal the checkpoint',
    '  `label`. Screenshot checkpoints write',
    '  `${process.env.DEMO_SCREENSHOT_DIR}/<label>.png`; video checkpoints do',
    '  the timed action and DO NOT screenshot (Playwright records the test as',
    '  the clip; the orchestrator harvests `<label>.webm` by test title).',
    '- Choose `kind` per checkpoint: `screenshot` only for a SETTLED static',
    '  UI; `video` for anything time-dependent (running simulation, animation,',
    '  flow). A single still cannot demonstrate parity of a moving system.',
    '- NEVER fabricate a checkpoint for a non-visual change (internal API',
    '  removal, invisible refactor). Do not invent fake on-screen overlays or',
    '  re-shoot an unrelated screen. State non-visual deltas in `essence`.',
    '- Tolerance is mandatory: wrap interactions so a changed-tree-only',
    '  element being absent in the baseline never throws — capture whatever',
    '  IS present (the prior behaviour) and continue.',
    '- Refuse scope creep: the tightest scenario that makes the ONE essential',
    '  behavioural delta visible. 3–5 checkpoints.',
  ].join('\n');
}

export type DemoScriptUserPromptInput = {
  /** Project name (e.g. trafficGame). */
  project: string;
  initiativeId?: string;
  /** Absolute path of the demo working dir where the two files go. */
  demoWorkDir: string;
  /** Absolute path to the changed worktree (read its real source/components). */
  changedTreePath: string;
  baseRef: string;
  changedRef: string;
  /** Absolute path to a file containing the manifest body + acceptance criteria. */
  briefPath: string;
  /** Absolute path to a file containing `git diff <base>..<changed>` (full). */
  diffPath: string;
  /** Worktree-relative path to an existing Playwright spec to mirror, or null. */
  exampleSpecRelPath: string | null;
  /** Worktree-relative Playwright config path, or null. */
  playwrightConfigRelPath: string | null;
  /** How the orchestrator will serve the app (so the spec knows what to expect). */
  serveHint: string;
};

export function renderDemoScriptUserPrompt(input: DemoScriptUserPromptInput): string {
  return [
    '# Demo-author invocation',
    '',
    `Project: **${input.project}**${input.initiativeId ? ` · Initiative: \`${input.initiativeId}\`` : ''}`,
    `Comparing **before** \`${input.baseRef}\` → **after** \`${input.changedRef}\`.`,
    '',
    '## Step 0 — brain-query (required first action)',
    '',
    'Query the brain about this project\'s UI/interaction shape and any demo',
    'conventions before reading anything else. Then proceed.',
    '',
    '## Inputs (read these, in order)',
    '',
    `1. **Intent** — manifest body + acceptance criteria: \`${input.briefPath}\``,
    `2. **Implementation** — full technical diff: \`${input.diffPath}\``,
    `3. **Changed tree source** (read the real components the diff touches): \`${input.changedTreePath}\``,
    input.exampleSpecRelPath
      ? `4. **Existing spec to mirror conventions**: \`${input.changedTreePath}/${input.exampleSpecRelPath}\``
      : '4. (No existing Playwright spec found — follow @playwright/test defaults.)',
    input.playwrightConfigRelPath
      ? `5. **Playwright config**: \`${input.changedTreePath}/${input.playwrightConfigRelPath}\``
      : '5. (No playwright config found — assume a vanilla project.)',
    '',
    '## How the orchestrator will run your spec',
    '',
    `- ${input.serveHint}`,
    '- It sets `process.env.DEMO_BASE_URL` to the running server URL.',
    '- It sets `process.env.DEMO_SCREENSHOT_DIR` to the per-run capture dir.',
    '- It runs `npx playwright test demo.spec.ts` from the demo working dir,',
    '  once per tree. The spec file must work unchanged for both.',
    '',
    '## Output (exactly two files)',
    '',
    `- \`${input.demoWorkDir}/demo.spec.ts\``,
    `- \`${input.demoWorkDir}/demo-manifest.json\``,
    '',
    'Every `demo-manifest.json` checkpoint needs `label` (= its `test()`',
    'title), `kind` ("screenshot" | "video"), and `caption`. Screenshot',
    'labels map to `<label>.png`; video labels to a harvested `<label>.webm`.',
    'Keep it tight: the single behavioural delta that is the essence of this',
    'initiative, framed as prior behaviour → new behaviour. The baseline is a',
    'valid working state, never an error. Non-visual deltas go in `essence`,',
    'never as a fabricated checkpoint.',
  ].join('\n');
}

/** Tool-use telemetry surfaced to the orchestrator (brain-first gate + cost). */
export type DemoScriptToolUseSummary = {
  brainReads: number;
  reads: number;
  writes: number;
  bashCalls: number;
};

export function tallyToolUse(
  message: { content?: Array<{ type?: string; name?: string; input?: unknown }> } | undefined,
  summary: DemoScriptToolUseSummary,
): void {
  const blocks = message?.content ?? [];
  for (const block of blocks) {
    if (block?.type !== 'tool_use') continue;
    const name = block.name ?? '';
    if (name === 'Read' || name === 'Grep' || name === 'Glob') {
      summary.reads += 1;
      const blob = JSON.stringify(block.input ?? {});
      if (blob.includes('brain/') || blob.includes('"brain"')) summary.brainReads += 1;
    } else if (name === 'Write') {
      summary.writes += 1;
    } else if (name === 'Bash') {
      summary.bashCalls += 1;
    }
  }
}
