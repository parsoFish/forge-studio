/**
 * R3-05-F3 — match instruction seeds to a project.
 *
 * Turns the instructions-creator interview from generation-from-nothing into
 * composition-from-vetted-blocks: detect a project's shape/language tags from
 * what's actually on disk, then select the library seeds whose `appliesTo` tags
 * intersect. Deterministic + pure (I/O confined to `detectProjectTags`) so the
 * runner's prompt assembly stays unit-testable.
 *
 * Additive by design: no matching seeds ⇒ an empty match ⇒ the runner falls
 * back to today's from-scratch interview.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { InstructionSeed } from '@forge/contracts/studio/types.ts';

/** Every forge-managed project matches the contract seed. */
const FORGE_MANAGED_TAG = 'forge-managed';

/**
 * Detect a project's shape/language tags from the files on disk. Conservative —
 * only emits a tag when there's concrete on-disk evidence, so a match is never
 * fabricated. Always includes `forge-managed` (this IS a forge-managed project).
 */
export function detectProjectTags(repoPath: string): string[] {
  const tags = new Set<string>([FORGE_MANAGED_TAG]);
  const has = (rel: string): boolean => existsSync(join(repoPath, rel));

  // TypeScript / Node / JS.
  const hasPackageJson = has('package.json');
  if (hasPackageJson) {
    tags.add('node');
    tags.add('javascript');
    let pkgRaw = '';
    try {
      pkgRaw = readFileSync(join(repoPath, 'package.json'), 'utf8');
    } catch {
      /* unreadable → treat as bare node */
    }
    if (has('tsconfig.json') || /"typescript"\s*:/.test(pkgRaw)) tags.add('typescript');
    // A `bin` field (or a bin/ dir) is the CLI signal.
    if (/"bin"\s*:/.test(pkgRaw) || has('bin')) tags.add('cli');
  }

  // Go.
  if (has('go.mod')) {
    tags.add('go');
    let goMod = '';
    try {
      goMod = readFileSync(join(repoPath, 'go.mod'), 'utf8');
    } catch {
      /* ignore */
    }
    if (/terraform-provider|terraform-plugin/.test(goMod)) {
      tags.add('terraform');
      tags.add('terraform-provider');
    }
  }

  // Terraform / provider by convention (repo name or top-level HCL).
  const base = repoPath.replace(/\/+$/, '').split('/').pop() ?? '';
  if (base.startsWith('terraform-provider-')) {
    tags.add('terraform');
    tags.add('terraform-provider');
  }
  if (hasTopLevelExt(repoPath, '.tf')) tags.add('terraform');

  return [...tags].sort();
}

function hasTopLevelExt(repoPath: string, ext: string): boolean {
  try {
    return readdirSync(repoPath).some((f) => f.endsWith(ext));
  } catch {
    return false;
  }
}

/**
 * Select the seeds whose `appliesTo` intersects the project's tags, restricted
 * to seeds usable on the project side (`scope` of `project` or `both`). Sorted
 * by id for a stable prompt. Empty ⇒ the caller falls back to from-scratch.
 *
 * Note: with the shipped corpus the `forge-managed-project` seed
 * (`appliesTo: [forge-managed]`) matches EVERY real project (`detectProjectTags`
 * always emits `forge-managed`), so the empty-match/from-scratch branch is in
 * practice a library-absence fallback (no seeds installed, or a bespoke library
 * lacking the contract seed), not a per-project one.
 */
export function matchInstructionSeeds(
  seeds: readonly InstructionSeed[],
  tags: readonly string[],
): InstructionSeed[] {
  const tagSet = new Set(tags);
  return seeds
    .filter((s) => s.scope === 'project' || s.scope === 'both')
    .filter((s) => s.appliesTo.some((t) => tagSet.has(t)))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Render matched seeds as a prompt section the interview/draft steps inject.
 * Empty match ⇒ `''` (no section, from-scratch fallback).
 */
export function renderSeedPromptSection(matched: readonly InstructionSeed[]): string {
  if (matched.length === 0) return '';
  const blocks = matched
    .map((s) => `### seed: ${s.id} — ${s.title} (${s.kind}; applies-to: ${s.appliesTo.join(', ')})\n${s.body}`)
    .join('\n\n');
  return [
    '',
    '## Matching instruction seeds (pre-vetted building blocks)',
    '',
    'These are proven AGENTS.md building blocks the library matched to this ' +
      "project's shape/language. COMPOSE from them where they genuinely fit this " +
      'repo — adapt commands to what you actually find, drop what does not apply. ' +
      'They are starting material, not a template to copy wholesale. List the seed ' +
      'ids you actually composed from in `composed_seed_ids`.',
    '',
    blocks,
  ].join('\n');
}

/**
 * The single marker literal for the composed-seeds footer — shared by the
 * writer (`composedSeedsFooter`) and the stripper regex so they can never drift
 * (a one-sided rename would silently stop the stripper matching → the
 * footer-duplication bug regresses).
 */
const COMPOSED_FOOTER_MARKER = 'forge:composed-instruction-seeds';

/** The machine-greppable footer recording which seeds an AGENTS.md composed from (R3-05-F3 traceability). */
export function composedSeedsFooter(ids: readonly string[]): string {
  const clean = [...new Set(ids.filter((id) => id.trim().length > 0))].sort();
  if (clean.length === 0) return '';
  return `\n<!-- ${COMPOSED_FOOTER_MARKER}: ${clean.join(', ')} -->\n`;
}

/** Matches the composed-seeds footer comment (any leading/trailing whitespace). */
const COMPOSED_FOOTER_RE = new RegExp(`\\n*<!--\\s*${COMPOSED_FOOTER_MARKER}:[^>]*-->\\s*$`);

/**
 * Strip an existing composed-seeds footer from an AGENTS.md body so re-appending
 * on an edit-mode revision stays idempotent (the LLM echoes the prior footer as
 * part of "the existing file, revised"). Returns the body with the trailing
 * footer removed; a body without one is returned unchanged.
 */
export function stripComposedSeedsFooter(md: string): string {
  return md.replace(COMPOSED_FOOTER_RE, '');
}
