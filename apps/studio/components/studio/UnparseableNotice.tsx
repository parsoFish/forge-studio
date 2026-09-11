'use client';

import type * as React from 'react';

/**
 * `forge-8vfn.7.6.23` — the manifests a project's queue holds that the PARSER
 * REFUSED, named with the parser's own message.
 *
 * `parseManifest` is deliberately fail-fast (`class` is required — ADR-051,
 * `packages/flows/manifest.ts:117`, "There is no default"), and
 * `scanProjectManifests` used to discard that verdict with a bare `continue`.
 * The roadmap then reported *"No initiatives found for this project"* — a
 * true-sounding sentence about a different problem, with a different fix.
 *
 * Rendered in BOTH roadmap branches on purpose: a canvas can render while a
 * sibling manifest could not be read, so a notice that lived only in the empty
 * state would stay silent in exactly the case that is hardest to notice.
 *
 * Contract row: `docs/reference/studio-dom-contract.md`.
 */
export function UnparseableNotice({ items }: { items?: { path: string; message: string }[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div
      data-component="roadmap-unparseable"
      style={{ border: '1px solid var(--ember, #9e6a03)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: 12, color: 'var(--ember, #9e6a03)' }}
    >
      {items.length} manifest{items.length === 1 ? '' : 's'} in this project&apos;s queue failed to parse
      and {items.length === 1 ? 'is' : 'are'} not shown — {items[0]!.message}
    </div>
  );
}

/**
 * The shell both roadmap dead-ends share. They were byte-duplicated apart from
 * two things, and one of those is load-bearing: `data-dep-count="0"` is stamped
 * ONLY when the roadmap LOADED and was empty, never when it never loaded, and
 * that attribute is what told `forge-8vfn.7.6.22` apart from a failed fetch. It
 * stays optional here rather than being unified away.
 */
export function RoadmapEmpty({ projectId, depCount, unparseable, children }: {
  projectId: string;
  depCount?: string;
  unparseable?: { path: string; message: string }[];
  children: React.ReactNode;
}) {
  return (
    <div
      data-section="project-roadmap"
      data-project-id={projectId}
      {...(depCount !== undefined ? { 'data-dep-count': depCount } : {})}
      data-unparseable-count={String(unparseable?.length ?? 0)}
      style={{ padding: '32px 28px', color: 'var(--faint)', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start' }}
    >
      <UnparseableNotice items={unparseable} />
      {children}
    </div>
  );
}
