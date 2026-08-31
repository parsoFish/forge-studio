/**
 * Shared release-finalize invocation contract — system prompt + user prompt
 * builder + tool config.
 *
 * Single source of truth for what the release-finalizer agent sees. Called by
 * the live orchestrator (orchestrator/phases/release-finalize.ts).
 *
 * The release-finalizer is a **one-shot SDK invocation** (not a Ralph loop)
 * that runs AFTER the operator approves a merged-ready cycle and BEFORE forge
 * merges. It promotes the in-cycle DRAFT changelog into a finalised, versioned
 * release commit on the PR branch (semver bump + declared pre-merge steps +
 * optional version-file bump), then commits + pushes. Tag/publish stay with CI.
 *
 * Mirrors `phases/reflector-binding.ts`: derive the spec from SKILL.md (single
 * source of intent), resolve the model from the spec tier, keep the system
 * prompt stable (the SKILL.md contract) so per-cycle data goes in the user
 * prompt only.
 */

import { readFileSync } from 'node:fs';

import type { ReleaseStep } from './studio/types.ts';
import { modelForSpec } from './phase-agent.ts';
import { deriveAgentSpec } from './studio/derive.ts';
import { skillPath, skillPathRelative } from './skill-path.ts';

const SKILL_PATH = skillPath('release-finalizer');

export type ReleaseFinalizeAllowedTool = 'Read' | 'Edit' | 'Bash' | 'Grep' | 'Glob';
export type ReleaseFinalizeDisallowedTool = 'NotebookEdit' | 'WebFetch' | 'WebSearch';

/**
 * ADR 024 / M2-3: the release-finalizer spec derived from SKILL.md (single
 * source). The orchestrator resolves the model from the tier declared in the
 * frontmatter.
 */
export const releaseFinalizeAgentSpec = deriveAgentSpec(skillPathRelative('release-finalizer'));

/** Tool lists derived from the spec — exported for downstream consumers. */
export const RELEASE_FINALIZE_ALLOWED_TOOLS =
  releaseFinalizeAgentSpec.allowedTools as ReleaseFinalizeAllowedTool[];
export const RELEASE_FINALIZE_DISALLOWED_TOOLS =
  releaseFinalizeAgentSpec.disallowedTools as ReleaseFinalizeDisallowedTool[];

/** Concrete model, derived from the spec's tier (single source: the spec). */
export const RELEASE_FINALIZE_MODEL = modelForSpec(releaseFinalizeAgentSpec);

let cachedSkillText: string | null = null;
function loadSkillText(): string {
  if (cachedSkillText !== null) return cachedSkillText;
  cachedSkillText = readFileSync(SKILL_PATH, 'utf8');
  return cachedSkillText;
}

/**
 * Build the release-finalizer system prompt: the SKILL.md contract (ADR 024:
 * the single source of phase intent). Static; per-cycle data (branch,
 * changelog/version paths, declared steps) goes in the user prompt only so the
 * cache key holds across cycles.
 */
export function buildReleaseFinalizeSystemPrompt(): string {
  return loadSkillText();
}

export type ReleaseFinalizeUserPromptInput = {
  initiativeId: string;
  cycleId: string;
  projectName: string;
  /** The PR branch the finaliser commits + pushes to. */
  branch: string;
  /** Worktree-relative changelog path the unifier seeded with a draft entry. */
  changelogPath: string;
  /** Worktree-relative version file to bump (optional). */
  versionFile?: string;
  /** Worktree-relative docs directory (optional). */
  docsDir?: string;
  /** The resolved `pre-merge` release steps, in declaration order. */
  steps: ReleaseStep[];
};

/**
 * Render the per-cycle prompt body the release-finalizer reads. Walks the agent
 * through the finalisation with concrete paths + the declared step list.
 */
export function renderReleaseFinalizeUserPrompt(input: ReleaseFinalizeUserPromptInput): string {
  const stepLines =
    input.steps.length > 0
      ? input.steps
          .map((s, i) => {
            const cmd = s.command && s.command.length > 0 ? ` — run: \`${s.command.join(' ')}\`` : '';
            return `${i + 1}. [${s.kind.toUpperCase()}] ${s.text}${cmd}`;
          })
          .join('\n')
      : '_(no extra pre-merge steps declared — just compute the bump + finalise the changelog)_';

  return [
    '# Release-finalize brief',
    '',
    `> Initiative: **${input.initiativeId}** · Cycle: **${input.cycleId}** · Project: **${input.projectName}** · Branch: **${input.branch}**`,
    '',
    'The operator just **approved** this cycle. Finalise the release on the PR',
    'branch, then commit + push. Forge merges immediately after you finish.',
    '**Tag/publish are CI\'s job — never run them.**',
    '',
    '## Inputs (paths are worktree-relative; do NOT change them)',
    '',
    `- Changelog: \`${input.changelogPath}\` — carries a draft \`## [Unreleased]\` entry from the cycle.`,
    input.versionFile
      ? `- Version file: \`${input.versionFile}\` — bump it to the computed version.`
      : '- Version file: _(none declared — derive the version from the changelog headings)_',
    input.docsDir
      ? `- Docs directory: \`${input.docsDir}\` — refresh changed surface via the doc-updater skill.`
      : '- Docs directory: _(none declared)_',
    '',
    '## Pre-merge steps (run in order)',
    '',
    stepLines,
    '',
    '## What to do',
    '',
    '1. **Compute the semver bump** (compose `changelog-semver`) from the draft entry categories + the current version.',
    `2. **Finalise the changelog**: rewrite the draft \`## [Unreleased]\` heading in \`${input.changelogPath}\` to \`## [<version>] - <YYYY-MM-DD>\`, leaving a fresh empty \`## [Unreleased]\` above it.`,
    '3. **Run each declared pre-merge step** in order (Bash for steps with a command; doc-updater for `docs` steps).',
    input.versionFile
      ? `4. **Bump \`${input.versionFile}\`** to the computed version (respect its existing format).`
      : '4. _(no version file to bump)_',
    '5. **Commit** as `chore(release): finalise <version>` (skip if nothing changed).',
    `6. **Push** \`${input.branch}\` so origin == HEAD. Then **stop**.`,
    '',
    '## Constraints',
    '',
    '- Never run `git tag`, `gh release create`, `npm publish`, or any tag/publish command — CI owns that off merge-to-main.',
    '- Never run `gh pr merge` — forge merges after you finish.',
    '- Stay in scope: changelog, version file, docs dir, and whatever the declared steps touch.',
  ].join('\n');
}

/** Tool-use telemetry surfaced by the live cycle. */
export type ReleaseFinalizeToolUseSummary = {
  editWrites: number;
  bashCalls: number;
};

/**
 * Inspect a streamed assistant message and increment the summary in place.
 * - `editWrites` — Edit/Write tool calls (changelog / version / docs edits).
 * - `bashCalls`  — any Bash invocation (declared step commands, commit, push).
 */
export function tallyToolUse(
  message: { content?: Array<{ type?: string; name?: string; input?: unknown }> } | undefined,
  summary: ReleaseFinalizeToolUseSummary,
): void {
  const blocks = message?.content ?? [];
  for (const block of blocks) {
    if (block?.type !== 'tool_use') continue;
    const name = block.name ?? '';
    if (name === 'Bash') {
      summary.bashCalls += 1;
      continue;
    }
    if (name === 'Edit' || name === 'Write' || name === 'MultiEdit') {
      summary.editWrites += 1;
    }
  }
}
