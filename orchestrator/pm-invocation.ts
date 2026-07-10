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
import { modelForSpec } from './phase-agent.ts';
import { deriveAgentSpec } from './studio/derive.ts';
import { loadAgentDefinition } from './studio/registry.ts';

const FORGE_ROOT = resolve(import.meta.dirname, '..');
const SKILL_PATH = resolve(FORGE_ROOT, 'skills', 'project-manager', 'SKILL.md');

export type PmAllowedTool = 'Read' | 'Grep' | 'Glob' | 'Write' | 'Edit';
export type PmDisallowedTool = 'Bash' | 'NotebookEdit' | 'WebFetch' | 'WebSearch';

/**
 * ADR 024 / M2-3: the project-manager spec derived from SKILL.md (single
 * source). The orchestrator resolves the model from the tier declared in the
 * frontmatter.
 */
export const pmAgentSpec = deriveAgentSpec('skills/project-manager/SKILL.md');

/** Tool lists derived from the spec — exported for downstream consumers. */
export const PM_ALLOWED_TOOLS = pmAgentSpec.allowedTools as PmAllowedTool[];
export const PM_DISALLOWED_TOOLS = pmAgentSpec.disallowedTools as PmDisallowedTool[];

/** Concrete model, derived from the spec's tier (single source: the spec). */
export const PM_MODEL = modelForSpec(pmAgentSpec);

/**
 * M2-3: brainAccess from the PM SKILL.md frontmatter — used by the phase
 * runner to decide whether 0 brain reads should abort the cycle. When
 * 'mandatory' the gate fires; when 'advisory' it does not.
 */
export const PM_BRAIN_ACCESS = loadAgentDefinition(SKILL_PATH).brainAccess;

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

/**
 * Plan 2.11 (PM turn economy / G8 rescoped) — the always-relevant brain themes
 * SKILL.md Step 0 names. The live caller pre-fetches these (plus the project
 * profile) and inlines them into the prompt so the PM never spends turns
 * re-discovering knowledge the orchestrator already holds. Kept in the
 * invocation contract (not the phase runner) so a test can assert the list
 * stays in sync with SKILL.md.
 */
export const PM_ALWAYS_RELEVANT_THEMES = [
  'brain/cycles/themes/spec-driven-work-items.md',
  'brain/cycles/themes/design-is-the-bottleneck.md',
  'brain/cycles/themes/work-item-completion-by-domain.md',
  'brain/cycles/themes/quality-gate-cmd-must-assert-new-work.md',
] as const;

/**
 * Plan 2.11 part 3 — the incremental-decomposition checkpoint the PM skill
 * writes after each WI (`- [x] WI-1 — title` per planned WI). Underscore-
 * prefixed so `readWorkItemsFromDir` never parses it as a work item.
 */
export const DECOMPOSITION_STATE_FILENAME = '_decomposition-state.md';

/**
 * Parse the checkbox checkpoint: planned = every `- [ ]`/`- [x]` line,
 * emitted = the ticked ones. Returns null when the content carries no
 * checklist (missing/never-written/free-prose file) so callers can
 * distinguish "no checkpoint" from "0 planned".
 */
export function parseDecompositionState(
  content: string,
): { planned: number; emitted: number } | null {
  let planned = 0;
  let emitted = 0;
  for (const line of content.split('\n')) {
    const m = /^\s*[-*]\s*\[( |x|X)\]/.exec(line);
    if (!m) continue;
    planned += 1;
    if (m[1]!.toLowerCase() === 'x') emitted += 1;
  }
  return planned > 0 ? { planned, emitted } : null;
}

export type PmUserPromptInput = {
  initiativeId: string;
  /** Path to the initiative manifest, relative to the cwd the SDK runs in. */
  manifestRelPath: string;
  /**
   * Plan 2.11 (G8 rescoped): the manifest's full markdown, inlined so the PM
   * does not spend a turn Reading a file the orchestrator has already parsed.
   * Evidence: 2026-07-10-pm-error-max-turns-new-api-exploration.md — the PM
   * burned its turn budget on exploration before writing any WI; the
   * successful re-queue pattern was "read manifest → write immediately".
   * Inlining removes even that read.
   */
  manifestContent?: string;
  /**
   * Plan 2.11 (G8 rescoped): brain files the orchestrator pre-fetched — the
   * project profile + PM_ALWAYS_RELEVANT_THEMES. Injected verbatim so the
   * brain-first mandate is satisfied structurally (the knowledge is IN
   * context) instead of behaviourally (turns spent on Read calls).
   */
  brainContext?: ReadonlyArray<{ path: string; content: string }>;
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
  /**
   * Standing project instructions (M2). When present, injected into every PM
   * prompt so the agent respects project-specific constraints without the PM
   * having to re-read project.json itself.
   */
  instructions?: string;
  /**
   * The project's north star (M2) — its ≤140-char mission statement. Injected
   * near the top of every PM prompt so decomposition stays aligned with the
   * project's purpose without the PM re-reading project.json.
   */
  northStar?: string;
};

/** Header for the injected project-instructions block — exported for tests. */
export const INSTRUCTIONS_SECTION_HEADER = '## Project instructions (injected by forge)';

/** Header for the injected project-north-star block — exported for tests. */
export const NORTH_STAR_SECTION_HEADER = '## Project north star (injected by forge)';

/** Header for the inlined initiative manifest — exported for tests. */
export const MANIFEST_SECTION_HEADER =
  '## Initiative manifest (inlined by forge — your single source of intent)';

/** Header for the pre-fetched brain-context block — exported for tests. */
export const BRAIN_CONTEXT_SECTION_HEADER = '## Brain context (pre-fetched by forge)';

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
  const brainContextBlock = renderBrainContextBlock(input.brainContext);
  const manifestBullet = input.manifestContent
    ? `- Initiative manifest: \`${input.manifestRelPath}\` — its full content is inlined below; do NOT spend a turn re-reading it.`
    : `- Initiative manifest: \`${input.manifestRelPath}\` — read this (after brain queries + structural Globs) as your single source of intent.`;
  return [
    '# Project-manager invocation',
    '',
    'Follow the project-manager skill contract in your system prompt. You are non-interactive; decompose THIS initiative\'s body and write the work items + _graph.md.',
    ...(input.northStar ? ['', NORTH_STAR_SECTION_HEADER, '', input.northStar.trim()] : []),
    ...(projectContextBlock ? ['', projectContextBlock] : []),
    ...(input.gateRecipe ? ['', input.gateRecipe] : []),
    ...(input.instructions ? ['', INSTRUCTIONS_SECTION_HEADER, '', input.instructions.trim(), ''] : []),
    '',
    `## Initiative: ${input.initiativeId}`,
    `## Project: ${input.projectName}`,
    '',
    manifestBullet,
    `- Worktree: \`${input.worktreeRelPath}\` — your current working directory. All \`files_in_scope\` paths resolve here.`,
    `- Write work items to \`.forge/work-items/WI-<n>.md\` and the graph to \`.forge/work-items/_graph.md\`.`,
    `- Set \`initiative_id: ${input.initiativeId}\` exactly on every WI frontmatter.`,
    ...(input.manifestContent
      ? ['', MANIFEST_SECTION_HEADER, '', '```markdown', input.manifestContent.trim(), '```']
      : []),
    ...(brainContextBlock ? ['', brainContextBlock] : []),
    '',
    'Do not update the manifest frontmatter or status — leave that to the orchestrator. Just write the work items and the graph, then stop.',
  ].join('\n');
}

/**
 * Render the pre-fetched brain-context block (plan 2.11 / G8 rescoped). The
 * orchestrator already knows which brain files every PM run needs (the
 * project profile + the always-relevant themes SKILL.md names); inlining them
 * converts N Read turns into zero. The block tells the PM these count as
 * consulted — it should cite them in the "Brain themes consulted" footer and
 * only Read ADDITIONAL themes the navigation index shows as directly relevant.
 *
 * Returns '' (caller omits the block) for a missing/empty list so callers
 * that don't inject stay byte-stable.
 */
export function renderBrainContextBlock(
  brainContext: PmUserPromptInput['brainContext'],
): string {
  if (!brainContext || brainContext.length === 0) return '';
  const parts: string[] = [
    BRAIN_CONTEXT_SECTION_HEADER,
    '',
    'The following brain files have already been read for you (pre-fetched by the orchestrator) — they COUNT as consulted. Cite their paths in each WI\'s "Brain themes consulted" footer. Do NOT re-Read them; only Read additional `brain/...` themes when the navigation index shows one directly relevant to this initiative\'s domain that is not inlined here.',
    '',
  ];
  for (const { path, content } of brainContext) {
    parts.push(`### ${path}`, '', '```markdown', content.trim(), '```', '');
  }
  return parts.join('\n');
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
    parts.push(
      '### Directory listing (depth-capped — trust this over repeated broad Globs; Glob only for deeper paths)',
      '',
      '```',
      ctx.treeListing.trim(),
      '```',
      '',
    );
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
