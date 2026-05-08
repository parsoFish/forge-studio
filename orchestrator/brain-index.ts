/**
 * Brain navigation-index loader.
 *
 * The brain's category indexes (`brain/forge/{patterns,antipatterns,decisions,operations,reference}.md`)
 * + per-project profiles list every theme with a one-line description. Loading
 * them as a stable prefix on a brain-query prompt gives the model the candidate
 * set without paying for repeated index-grep tool calls per question.
 *
 * Exposed as a programmatic API (`loadBrainIndex`) so any phase that wants the
 * navigation prefix can import it directly. The `forge brain index` CLI is a
 * thin wrapper that prints whatever this returns.
 *
 * The output is a single string with `<!-- BRAIN INDEX: <path> -->` section
 * markers so the model knows where each block came from. Stable across runs —
 * good for prompt caching.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type BrainCategory = 'pattern' | 'antipattern' | 'decision' | 'operation' | 'reference';

export type LoadBrainIndexOptions = {
  /** Forge root. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Project scope. When set, also loads `brain/projects/<scope>/{profile,patterns,antipatterns,decisions}.md`. */
  scope?: string | null;
  /** Category narrowing. When set, only loads `brain/INDEX.md` + the matching forge category index — keeps the prefix small enough that small models can find candidates without scanning 5×. */
  category?: BrainCategory | null;
};

const FORGE_CATEGORY_INDEXES = [
  'brain/INDEX.md',
  'brain/forge/patterns.md',
  'brain/forge/antipatterns.md',
  'brain/forge/decisions.md',
  'brain/forge/operations.md',
  'brain/forge/reference.md',
] as const;

const CATEGORY_TO_INDEX: Record<BrainCategory, string> = {
  pattern: 'brain/forge/patterns.md',
  antipattern: 'brain/forge/antipatterns.md',
  decision: 'brain/forge/decisions.md',
  operation: 'brain/forge/operations.md',
  reference: 'brain/forge/reference.md',
};

const PROJECT_INDEX_FILES = [
  'profile.md',
  'patterns.md',
  'antipatterns.md',
  'decisions.md',
] as const;

export function loadBrainIndex(opts: LoadBrainIndexOptions = {}): string {
  const cwd = opts.cwd ?? process.cwd();
  const sections: string[] = [];

  if (opts.category) {
    sections.push(renderSection(cwd, 'brain/INDEX.md'));
    sections.push(renderSection(cwd, CATEGORY_TO_INDEX[opts.category]));
  } else {
    for (const rel of FORGE_CATEGORY_INDEXES) {
      sections.push(renderSection(cwd, rel));
    }
  }

  if (opts.scope) {
    for (const file of PROJECT_INDEX_FILES) {
      const rel = `brain/projects/${opts.scope}/${file}`;
      const full = resolve(cwd, rel);
      if (existsSync(full)) sections.push(renderSection(cwd, rel));
    }
  }

  return sections.join('\n\n---\n\n');
}

function renderSection(cwd: string, rel: string): string {
  const full = resolve(cwd, rel);
  if (!existsSync(full)) return `<!-- BRAIN INDEX: ${rel} (missing) -->`;
  const body = readFileSync(full, 'utf8').trimEnd();
  return `<!-- BRAIN INDEX: ${rel} -->\n${body}`;
}
