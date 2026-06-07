/**
 * PM invocation contract — system prompt + user prompt builders.
 *
 * ADR 024: the project-manager is now a declarative `PhaseAgentSpec` — the
 * orchestrator spawns it at the tier the spec declares, and the SKILL.md is
 * the single source of PM intent. The TS here is the binding layer: which
 * model tier, which tools, and (in `renderPmUserPrompt`) the dynamic per-cycle
 * briefing only.
 *
 * The system prompt = brain navigation index + skills/project-manager/SKILL.md.
 * The user prompt = a per-cycle, per-initiative briefing (dynamic data only).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadBrainIndex } from '../cli/brain-index.ts';
import { modelForSpec, type PhaseAgentSpec } from './phase-agent.ts';

const FORGE_ROOT = resolve(import.meta.dirname, '..');
const SKILL_PATH = resolve(FORGE_ROOT, 'skills', 'project-manager', 'SKILL.md');

export type PmAllowedTool = 'Read' | 'Grep' | 'Glob' | 'Write' | 'Edit';
export type PmDisallowedTool = 'Bash' | 'NotebookEdit' | 'WebFetch' | 'WebSearch';

export const PM_ALLOWED_TOOLS: PmAllowedTool[] = ['Read', 'Grep', 'Glob', 'Write', 'Edit'];
export const PM_DISALLOWED_TOOLS: PmDisallowedTool[] = ['Bash', 'NotebookEdit', 'WebFetch', 'WebSearch'];

/**
 * ADR 024 seam: the project-manager as a declarative phase agent — it COMPOSES
 * the project-manager skill (the source of its intent), runs at the `sonnet`
 * tier (planning/decomposition work; Sonnet is the right tier). The orchestrator
 * resolves the model from the tier.
 */
export const pmAgentSpec: PhaseAgentSpec = {
  phase: 'project-manager',
  skill: 'skills/project-manager/SKILL.md',
  tier: 'sonnet',
  allowedTools: PM_ALLOWED_TOOLS,
  disallowedTools: PM_DISALLOWED_TOOLS,
};

/** Concrete model, derived from the spec's tier (single source: the spec). */
export const PM_MODEL = modelForSpec(pmAgentSpec);

let cachedSkillText: string | null = null;
function loadSkillText(): string {
  if (cachedSkillText !== null) return cachedSkillText;
  cachedSkillText = readFileSync(SKILL_PATH, 'utf8');
  return cachedSkillText;
}

// Brain-index staleness window (documented, intentional — US-2.3 /
// brain-read-policy): this cache is module-level, so a long-running
// `forge serve` process keeps the brain index it loaded at boot. Themes
// written by cycle N are NOT visible to cycle N+1 until the process
// restarts. This is accepted, not a bug: the planner only needs a
// stable index within a cycle, and restarts are cheap. If per-cycle
// freshness is ever required, key the cache by cwd+mtime (as
// reflector-invocation.ts already keys by cwd) rather than adding an
// invalidation path. Do not "fix" this silently.
let cachedBrainIndex: string | null = null;
function loadBrainNavigation(cwd: string): string {
  if (cachedBrainIndex !== null) return cachedBrainIndex;
  cachedBrainIndex = loadBrainIndex({ cwd });
  return cachedBrainIndex;
}

/**
 * S8 / C23 — prompt caching intent.
 *
 * The PM system prompt has TWO sub-blocks with different cache lifetimes:
 *
 * - **Brain navigation index** (first block): stable for the lifetime of a
 *   forge process. Suitable for a 1-hour TTL marker —
 *   `cache_control: { type: 'ephemeral', ttl: '1h' }` (per C23). The 25% write
 *   premium amortises across every PM call in a multi-WI cycle (PM may run
 *   N>1 times across a long initiative).
 * - **`project-manager skill contract`** (second block): also stable, but
 *   shorter — 5-min ephemeral covers a single cycle's PM call cluster.
 *
 * The Claude Agent SDK v0.1.0 does NOT expose explicit `cache_control`
 * markers on its public surface (see `S8-DECISIONS.md` D1). Today the CLI
 * subprocess does prompt caching server-side keyed on prompt stability; this
 * file's job is to KEEP the prompt stable (no per-cycle timestamps, no
 * per-WI strings interpolated mid-prompt) so the cache hits naturally. The
 * `cacheable: true` flag on `createClaudeAgent` (and via this builder's
 * downstream wiring) carries the intent forward; the eventual marker shape
 * is documented here for the day the SDK exposes it.
 *
 * Build the PM system prompt: brain navigation index + the SKILL.md contract.
 *
 * @param brainCwd - directory containing `brain/`. For the bench this is the
 *   tempdir (with symlinked brain/); for the live cycle this is the forge root.
 */
export function buildPmSystemPrompt(brainCwd: string): string {
  return [
    '# Brain navigation index',
    '',
    "Below are the brain's category indexes — every theme in scope, with a one-line description. Use these descriptions to identify candidate theme pages, then read those files in full to verify and extract precise terminology, project names, and patterns. The indexes ARE the retrieval index; you should rarely need grep.",
    '',
    loadBrainNavigation(brainCwd),
    '',
    '---',
    '',
    '# project-manager skill contract',
    '',
    loadSkillText(),
  ].join('\n');
}

export type PmUserPromptInput = {
  initiativeId: string;
  /** Path to the initiative manifest, relative to the cwd the SDK runs in. */
  manifestRelPath: string;
  /** Path to the worktree where work items will be written, relative to cwd. */
  worktreeRelPath: string;
  projectName: string;
  /**
   * Project-shape context the live caller reads from the worktree before
   * invoking the PM (2026-05-25 — claude-harness cycle 8 audit):
   * `package.json`, `CLAUDE.md`, `.forge/project.json`, and a directory
   * listing. Injected verbatim near the top of the prompt so the PM
   * cannot draft `quality_gate_cmd` referencing tooling the project
   * doesn't have. Each is OPTIONAL (skipped if the file doesn't exist);
   * when present, the prompt block makes them load-bearing.
   */
  projectContext?: {
    packageJson?: string;
    claudeMd?: string;
    forgeProjectJson?: string;
    pyprojectToml?: string;
    cargoToml?: string;
    treeListing?: string;
  };
  /**
   * Language-derived quality-gate recipe (betterado #2). The live caller
   * detects the project's language and renders `renderGateRecipeBlock(...)`;
   * surfaced verbatim so the PM writes a discriminating, scoped per-WI gate
   * (e.g. Go's `-tags all -run <NewPrefix> ./pkg/`) without the operator
   * hand-encoding it. Optional — omitted callers fall back to the generic
   * gate guidance already in the prompt.
   */
  gateRecipe?: string;
};

/**
 * Render the per-cycle user prompt the SDK sends to the PM agent.
 *
 * Dynamic per-cycle briefing only: the initiative id, project name, paths,
 * the inlined project context block (load-bearing — prevents tooling
 * hallucination), and the language-derived gate recipe. All static operational
 * intent lives in SKILL.md (the system prompt), per ADR 024.
 *
 * S8/C23 caching intent: keeping dynamic data in the USER prompt (not the
 * system prompt) ensures the system prompt stays stable across invocations
 * so the server-side prompt cache hits naturally.
 */
export function renderPmUserPrompt(input: PmUserPromptInput): string {
  const projectContextBlock = renderProjectContextBlock(input.projectContext);
  return [
    '# Project-manager invocation',
    '',
    'Follow the project-manager skill contract in your system prompt. You are non-interactive; decompose THIS initiative\'s body and write the work items + _graph.md.',
    ...(projectContextBlock ? ['', projectContextBlock] : []),
    ...(input.gateRecipe ? ['', input.gateRecipe] : []),
    '',
    `## Initiative: ${input.initiativeId}`,
    `## Project: ${input.projectName}`,
    '',
    `- Initiative manifest: \`${input.manifestRelPath}\` — read this (after brain queries + structural Globs) as your single source of intent.`,
    `- Worktree: \`${input.worktreeRelPath}\` — your current working directory. All \`files_in_scope\` paths resolve here.`,
    `- Write work items to \`.forge/work-items/WI-<n>.md\` and the graph to \`.forge/work-items/_graph.md\`.`,
    `- Set \`initiative_id: ${input.initiativeId}\` exactly on every WI frontmatter.`,
    '',
    'Do not update the manifest frontmatter or status — leave that to the orchestrator. Just write the work items and the graph, then stop.',
  ].join('\n');
}

/**
 * Render the inlined project context block (2026-05-25; claude-harness
 * cycle 8 audit). Telling the PM "you MUST Read package.json" was
 * insufficient — the PM kept hallucinating tooling. Injecting the
 * contents verbatim near the top of the prompt makes them load-bearing
 * (the PM can't ignore what it's already reading).
 *
 * Returns '' (and the caller omits the block entirely) when no project
 * context is provided — keeps the bench tests' shorter prompts byte-
 * stable.
 */
export function renderProjectContextBlock(
  ctx: PmUserPromptInput['projectContext'],
): string {
  if (!ctx) return '';
  const parts: string[] = [
    '## Project context (read this FIRST — load-bearing)',
    '',
    'The live cycle harness reads the following from the worktree at PM-invocation time and inlines them here. Do NOT draft a `quality_gate_cmd` that references tooling absent from these files — the orchestrator runs the gate at iter 0 and hard-fails the WI with `gate-too-loose` when it passes trivially (which happens when the gate references `jest` in a project that uses `node:test`, `npm run build` when there\'s no build script, etc.).',
    '',
  ];
  if (ctx.packageJson) {
    parts.push('### package.json', '', '```json', ctx.packageJson.trim(), '```', '');
  }
  if (ctx.pyprojectToml) {
    parts.push('### pyproject.toml', '', '```toml', ctx.pyprojectToml.trim(), '```', '');
  }
  if (ctx.cargoToml) {
    parts.push('### Cargo.toml', '', '```toml', ctx.cargoToml.trim(), '```', '');
  }
  if (ctx.forgeProjectJson) {
    parts.push('### .forge/project.json', '', '```json', ctx.forgeProjectJson.trim(), '```', '');
  }
  if (ctx.claudeMd) {
    parts.push('### CLAUDE.md (project conventions)', '', '```markdown', ctx.claudeMd.trim(), '```', '');
  }
  if (ctx.treeListing) {
    parts.push('### Directory listing (top-level + src/ + tests/)', '', '```', ctx.treeListing.trim(), '```', '');
  }
  if (parts.length <= 4) return ''; // header only — nothing actually inlined
  return parts.join('\n');
}

/** Tool-use telemetry surfaced by the live cycle. */
export type PmToolUseSummary = {
  brainReads: number;
  writes: number;
};

/**
 * Inspect a streamed assistant message and increment the summary in place.
 * Brain reads detected by inspecting tool-input for `brain/` references;
 * writes/edits counted by tool name.
 */
export function tallyToolUse(
  message: { content?: Array<{ type?: string; name?: string; input?: unknown }> } | undefined,
  summary: PmToolUseSummary,
): void {
  const blocks = message?.content ?? [];
  for (const block of blocks) {
    if (block?.type !== 'tool_use') continue;
    const name = block.name ?? '';
    if (name === 'Write' || name === 'Edit') {
      summary.writes += 1;
    } else if (name === 'Read' || name === 'Grep' || name === 'Glob') {
      const blob = JSON.stringify(block.input ?? {});
      if (blob.includes('brain/') || blob.includes('"brain"')) summary.brainReads += 1;
    }
  }
}
