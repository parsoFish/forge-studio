/**
 * PM invocation contract — system prompt + user prompt builders.
 *
 * The system prompt = brain navigation index + skills/project-manager/SKILL.md.
 * The user prompt = a per-cycle, per-initiative briefing telling the agent
 * exactly where the manifest lives, where the worktree lives, and where to
 * write outputs.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadBrainIndex } from '../cli/brain-index.ts';

const FORGE_ROOT = resolve(import.meta.dirname, '..');
const SKILL_PATH = resolve(FORGE_ROOT, 'skills', 'project-manager', 'SKILL.md');

export type PmAllowedTool = 'Read' | 'Grep' | 'Glob' | 'Write' | 'Edit';
export type PmDisallowedTool = 'Bash' | 'NotebookEdit' | 'WebFetch' | 'WebSearch';

export const PM_ALLOWED_TOOLS: PmAllowedTool[] = ['Read', 'Grep', 'Glob', 'Write', 'Edit'];
export const PM_DISALLOWED_TOOLS: PmDisallowedTool[] = ['Bash', 'NotebookEdit', 'WebFetch', 'WebSearch'];
export const PM_MODEL = 'claude-sonnet-4-6';

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
 * Tells the agent the cwd-relative paths and reiterates the contract
 * (brain-first, Given-When-Then, files_in_scope, _graph.md).
 *
 * Hard rules (quality_gate_cmd required, hidden-coupling check) are
 * enforced by the validator in orchestrator/work-item.ts — this prompt
 * states each rule once and defers to that enforcement.
 */
export function renderPmUserPrompt(input: PmUserPromptInput): string {
  const projectContextBlock = renderProjectContextBlock(input.projectContext);
  return [
    '# Project-manager invocation',
    '',
    'You are running non-interactively. Decompose the initiative body\'s Given-When-Then acceptance criteria directly into atomic outcome-sized work items and write them to disk. **You MUST write at least one work-item file before stopping; finishing without writing files is a failed run.** Do not ask clarifying questions; if something is genuinely under-specified in the manifest, infer the most reasonable choice, note it in the work-item body, and proceed.',
    ...(projectContextBlock ? ['', projectContextBlock] : []),
    '',
    '## Step 0 — Brain queries (REQUIRED, before any other action)',
    '',
    "**Your first tool calls MUST be `Read` against `brain/...` paths.** The orchestrator records which files you read; if zero of them are under `brain/`, the cycle aborts with a `pm.brain-skipped` error before validation even runs. The brain navigation index is in your system prompt above — use it to pick relevant theme files, then `Read` them in full. Do not infer or fabricate brain-theme content; you must have actually read the file.",
    '',
    'Required reads (minimum):',
    '- One or more `brain/cycles/themes/*.md` covering work-item sizing and file-scope discipline.',
    `- \`projects/${input.projectName}/brain/profile.md\` — taste signals for this project. Cite this in the WI body.`,
    `- Any \`projects/${input.projectName}/brain/themes/*.md\` whose description matches the initiative's domain.`,
    '',
    'The "Brain themes consulted" footer in each WI body must list paths you actually `Read`-ed.',
    '',
    '## Step 0.5 — Project structure enumeration (REQUIRED, before any WI emission)',
    '',
    "**You are running with `cwd` set to the project worktree.** All relative paths resolve against the worktree — not forge's root. Use relative paths everywhere.",
    '',
    "**You MUST `Glob` the actual project tree before drafting any WI.** Hallucinated `files_in_scope` paths cause dev-loop failures.",
    '',
    'Required before drafting any WI:',
    "- `Glob({ pattern: \"src/**\" })` — enumerate the entire source tree",
    "- `Glob({ pattern: \"tests/**\" })` (or `spec/**`, `__tests__/**` — try the project's actual convention)",
    "- `Read({ file_path: \"package.json\" })` (or `pyproject.toml`, `Cargo.toml`) — confirm scripts, deps, project type",
    "- `Read({ file_path: \"README.md\" })` and `CLAUDE.md` if present",
    '',
    "**Never invent files.** Every path in `files_in_scope` must either (a) appear in your Glob results, OR (b) be a new file this WI explicitly creates.",
    '',
    `## Initiative: ${input.initiativeId}`,
    `## Project: ${input.projectName}`,
    '',
    '## Decomposition mandate',
    '',
    'Read the initiative manifest body carefully. The body carries the vision and ≥1 Given-When-Then acceptance criterion. **Decompose the initiative ACs directly into atomic outcome-sized work items** (one WI = one independently-runnable AC where possible). The initiative body is your single source of intent — there is no features list.',
    '',
    '**Every GWT block in the initiative body must be exercised by ≥1 WI `quality_gate_cmd`.** Emitting zero work items is a terminal failure. Decompose ONLY the manifest body\'s ACs; do not plan project-setup / brain / tracking-file busywork the architect didn\'t ask for.',
    '',
    '**ENRICH, don\'t re-decide the chunking.** When an AC is already the size of one mergeable commit, emit one WI that enriches it (additional ACs + gate + file scope). Split only when two parts change genuinely independent files/surfaces.',
    ...(input.gateRecipe ? ['', input.gateRecipe] : []),
    '',
    '## Per-WI REQUIRED gate + optional fields',
    '',
    "**`quality_gate_cmd` is REQUIRED on every WI** — `validateWorkItem` hard-rejects any WI without one. The gate MUST fail on a clean tree before the agent does any work (iter-0 check). If it passes at iter 0, the WI hard-fails with `gate-too-loose`.",
    '',
    "**Use only tooling the project actually has.** Before drafting any gate, confirm the command's first arg appears in `package.json` scripts (or `pyproject.toml`, `Cargo.toml`, etc.). A gate referencing absent tooling either passes trivially or fails in a way the agent can't fix.",
    '',
    "**For CI/build/quality initiatives:** if `.forge/project.json` declares a `ci_gate`, set the WI's `quality_gate_cmd` to that verbatim — do NOT substitute a narrower proxy.",
    '',
    "**For cycle 2+ projects:** the test file your gate references MUST NOT EXIST in the worktree at WI start. Use your Step 0.5 Glob of `tests/**` as the source of truth.",
    '',
    "**Concrete sharp-gate patterns (mirror these):**",
    "- **node:test**: `['node', '--test', '--experimental-strip-types', 'tests/<new-test>.test.ts']` (file doesn't exist yet → iter-0 fails)",
    "- **jest**: `['npx', 'jest', '--testPathPattern', '<new-test-file>', '--findRelatedTests']`",
    "- **pytest**: `['pytest', '-k', '<new-test-name>', '-x']`",
    "- **bats**: `['bats', 'tests/<new-test>.bats']`",
    "- **go test**: `['go', 'test', '-run', '<NewTestName>', './...']`",
    '',
    'Other optional fields (omit-on-undefined):',
    '- `non_goals: ["docs","the bar component"]` — explicit out-of-scope items.',
    '- `verification_artifact: "tests/x.test.ts"` — path the dev-loop must produce; must appear in `files_in_scope`.',
    '- `creates: ["tests/x.test.ts"]` — files this WI creates from scratch (subset of `files_in_scope`).',
    '',
    '`demo_hook` is NOT a WI field — it lives at the initiative level only.',
    '',
    '## Inputs',
    '',
    `- Initiative manifest: \`${input.manifestRelPath}\` (read AFTER brain queries AND structural Globs). The body is your single source of intent.`,
    `- Worktree: your current directory. \`files_in_scope\` paths can be existing files (edited/moved) OR new files (created) — both are fine.`,
    '',
    '## Output requirements',
    '',
    `- Write **one work-item file per atomic unit of work** to \`.forge/work-items/WI-<n>.md\`. Use \`WI-1\`, \`WI-2\`, … contiguous and 1-indexed.`,
    `- Size WIs by consulting brain themes under \`projects/${input.projectName}/brain/themes/\` and \`brain/cycles/themes/\`. No synthetic floor or ceiling — choose the shape that matches the work.`,
    `- Prefer WIs with empty \`depends_on\` (parallel-from-start). The dev-loop parallelises every DAG level.`,
    '- **File-scope discipline (enforced).** If two WIs would both edit the same file, prefer in order: (1) split the file, (2) merge the WIs, (3) add a `depends_on` edge. Two WIs sharing a file with no edge fails `detectHiddenCoupling()` at PM close.',
    '- Frontmatter (locked by ADR 015) — exactly these fields, all required:',
    '  ```yaml',
    '  ---',
    '  work_item_id: WI-<n>',
    `  initiative_id: ${input.initiativeId}`,
    '  status: pending',
    '  depends_on: [WI-...]          # empty array if independent',
    '  acceptance_criteria:',
    '    - given: "<precondition>"',
    '      when:  "<action>"',
    '      then:  "<observable outcome>"',
    '  files_in_scope:               # worktree-relative paths (no leading /)',
    '    - <path>',
    '  estimated_iterations: <int>   # > 0',
    '  ---',
    '  ```',
    '- **YAML quoting:** wrap every `given` / `when` / `then` value in double quotes. YAML reserves leading `` ` `` `?` `!` `&` `*` `@` `%` as indicators; unquoted values starting with these fail to parse. Same for any value containing a colon-space (`: `).',
    '- Body: markdown rationale. Cite the brain theme(s) you consulted by path. No implementation code.',
    `- **Mandatory final step:** write \`.forge/work-items/_graph.md\` containing a single \`graph TD\` mermaid block. One node per WI; edges agree exactly with the union of all \`depends_on\` lists.`,
    '',
    '## Self-check (last step before stopping)',
    '',
    'Walk this checklist before your final tool call. The orchestrator validates each WI; missing or malformed fields fail the cycle.',
    '',
    '**Per work item — frontmatter completeness:**',
    '- `work_item_id` (matches `WI-<n>` and the filename)',
    `- \`initiative_id\` set exactly to \`${input.initiativeId}\``,
    '- `status: pending`',
    '- `depends_on` (array, possibly empty)',
    '- `acceptance_criteria` — at least 1 entry, each with `given` / `when` / `then`, all double-quoted',
    '- `files_in_scope` — at least 1 worktree-relative path, no leading `/`',
    '- `estimated_iterations` — a positive integer (>= 1)',
    '- `quality_gate_cmd` — REQUIRED; must fail on a clean tree; first arg must be real project tooling',
    '',
    "**AC coverage check:** every GWT block in the initiative body is exercised by ≥1 WI `quality_gate_cmd`. If any body AC has no corresponding WI gate, add the missing WI or expand an existing one.",
    '',
    "**Hidden-coupling check:** walk every pair of work items sharing a file in `files_in_scope`. If neither appears in the other's `depends_on` transitively, add the missing edge or merge them. The orchestrator's `detectHiddenCoupling()` hard-fails the cycle on violations.",
    '',
    "**Brain-cite sanity check:** the body's \"Brain themes consulted\" footer must reference files you actually `Read`-ed.",
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
function renderProjectContextBlock(
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
