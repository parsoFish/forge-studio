/**
 * Pure view-state derivation for the /templates library page (R3-06, WI-4).
 *
 * Mirrors forge-ui/lib/skill-library-view.ts's testability convention: no
 * DOM, no React, no network — the page component stays thin and calls these
 * directly off the fetched `TemplateLibraryEntry[]`. Immutability: every
 * function here returns NEW arrays/objects, never mutates its input.
 *
 * Pinned by AT-48..AT-51 in ./template-library-view.test.ts.
 */

import type { TemplateLibraryEntry, TemplatePreviewKind } from './template-client';

// ---------------------------------------------------------------------------
// Grouping + counts
// ---------------------------------------------------------------------------

export interface GroupedTemplateLibrary {
  planning: TemplateLibraryEntry[];
  demoOutput: TemplateLibraryEntry[];
  projectScaffold: TemplateLibraryEntry[];
  total: number;
  planningCount: number;
  demoOutputCount: number;
  projectScaffoldCount: number;
}

/** Split the library into its three categories, preserving each group's
 *  order. Counts are derived from the resulting arrays' own lengths — never
 *  an independently-set field that could drift from reality. */
export function groupTemplateLibrary(entries: readonly TemplateLibraryEntry[]): GroupedTemplateLibrary {
  const planning = entries.filter((e) => e.category === 'planning');
  const demoOutput = entries.filter((e) => e.category === 'demo-output');
  const projectScaffold = entries.filter((e) => e.category === 'project-scaffold');
  return {
    planning,
    demoOutput,
    projectScaffold,
    total: planning.length + demoOutput.length + projectScaffold.length,
    planningCount: planning.length,
    demoOutputCount: demoOutput.length,
    projectScaffoldCount: projectScaffold.length,
  };
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/** Case-insensitive match on name + description. Empty query returns a NEW
 *  array of every entry (never the same reference, never mutates input). */
export function filterTemplates(entries: readonly TemplateLibraryEntry[], query: string): TemplateLibraryEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...entries];
  return entries.filter((e) => {
    const name = e.name.toLowerCase();
    const description = (e.description ?? '').toLowerCase();
    return name.includes(q) || description.includes(q);
  });
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

/**
 * Badge tokens derived from real, verifiable fields only — never from
 * free-text `description`, even one that happens to mention "unverified" or
 * "errors" (AT-50's decoy case). `unverified` fires only when
 * `endpointsVerified === false` (a planning entry that declares a
 * producer/consumer the flow graph could not confirm); `error` fires only
 * when the definition failed to parse.
 */
export type TemplateBadge = 'unverified' | 'error';

export function templateBadges(entry: TemplateLibraryEntry): TemplateBadge[] {
  const badges: TemplateBadge[] = [];
  if (entry.endpointsVerified === false) badges.push('unverified');
  if (entry.error) badges.push('error');
  return badges;
}

// ---------------------------------------------------------------------------
// Preview thumbnail class
// ---------------------------------------------------------------------------

/** Maps each `previewKind` to its cheap CSS-approximation class (see
 *  app/globals.css's `.tpl-preview-*` rules). A TOTAL function with no
 *  silent default — an unrecognised kind is a malformed response, not a
 *  value to guess a thumbnail for, so it throws (AT-51). */
const PREVIEW_CLASS_BY_KIND: Record<TemplatePreviewKind, string> = {
  html: 'tpl-preview-html',
  video: 'tpl-preview-video',
  shots: 'tpl-preview-shots',
  mock: 'tpl-preview-mock',
  doc: 'tpl-preview-doc',
  scaffold: 'tpl-preview-scaffold',
};

export function previewClassFor(previewKind: TemplatePreviewKind): string {
  const cls = PREVIEW_CLASS_BY_KIND[previewKind];
  if (!cls) throw new Error(`unrecognised template previewKind: ${JSON.stringify(previewKind)}`);
  return cls;
}
