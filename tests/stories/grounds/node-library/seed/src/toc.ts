/**
 * Table-of-contents rendering.
 *
 * Pure: given markdown source + options, return the rendered TOC string. The
 * pipeline is `extractHeadings` → filter by min/max level → `createSlugger` for
 * anchors → indent by relative depth → join. No mutation of inputs.
 */

import { extractHeadings, type Heading } from './headings.ts';
import { createSlugger } from './anchor.ts';

export type TocOptions = {
  /** Shallowest heading level to include (default 1). */
  readonly minLevel?: number;
  /** Deepest heading level to include (default 6). */
  readonly maxLevel?: number;
  /** Spaces per indent step (default 2). */
  readonly indent?: number;
  /** List bullet to use (default `-`). */
  readonly bullet?: string;
};

const DEFAULTS = {
  minLevel: 1,
  maxLevel: 6,
  indent: 2,
  bullet: '-',
} as const;

/**
 * Render a Markdown table of contents for `markdown`. Each retained heading
 * becomes a nested list item `- [text](#anchor)`, indented by its depth
 * relative to the shallowest retained heading. Returns `''` when no headings
 * survive the level filter.
 */
export function renderToc(markdown: string, options: TocOptions = {}): string {
  const minLevel = options.minLevel ?? DEFAULTS.minLevel;
  const maxLevel = options.maxLevel ?? DEFAULTS.maxLevel;
  const indent = options.indent ?? DEFAULTS.indent;
  const bullet = options.bullet ?? DEFAULTS.bullet;

  if (minLevel < 1 || maxLevel > 6 || minLevel > maxLevel) {
    throw new RangeError(
      `renderToc: invalid level window [${minLevel}, ${maxLevel}] (must satisfy 1 ≤ min ≤ max ≤ 6)`,
    );
  }
  if (!Number.isInteger(indent) || indent < 0) {
    throw new RangeError(`renderToc: indent must be a non-negative integer (got ${indent})`);
  }

  const kept: readonly Heading[] = extractHeadings(markdown).filter(
    (h) => h.level >= minLevel && h.level <= maxLevel,
  );
  if (kept.length === 0) return '';

  const baseLevel = Math.min(...kept.map((h) => h.level));
  const slug = createSlugger();

  return kept
    .map((h) => {
      const pad = ' '.repeat((h.level - baseLevel) * indent);
      return `${pad}${bullet} [${h.text}](#${slug(h.text)})`;
    })
    .join('\n');
}
