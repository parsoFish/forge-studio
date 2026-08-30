/**
 * The two `forge-8vfn.5.7` instances, pinned at the DOM.
 *
 * S2 beat 2 reads `[data-section="project-create"][data-app-type-count]` and
 * beat 9 reads `[data-roster-state="ok"]`; both were red because the route
 * declared itself ready before the fetch those keys come from had settled.
 *
 * The `/projects/new` pin also holds the defect the bead text did not carry:
 * the create panel was rendered as a SIBLING of `main[data-page]`, and
 * `scripts/stories/beats.mjs`'s `readObserved` reads the page root and its
 * DESCENDANTS. A panel outside the root is outside the contract anchored to
 * it, so no amount of waiting could have made beat 2 green.
 */
import { test, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/projects/new',
}));

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/** The `<main ...>` open tag, so an attribute assertion is scoped to the root. */
function mainOpenTag(html: string): string {
  const start = html.indexOf('<main');
  expect(start).toBeGreaterThanOrEqual(0);
  return html.slice(start, html.indexOf('>', start) + 1);
}

test('/projects/new: the route root is NOT ready before its curated-starter fetch settles', async () => {
  const { default: ProjectBuilderPage } = await import('@/app/projects/[id]/page');
  const html = renderToStaticMarkup(React.createElement(ProjectBuilderPage, { params: { id: 'new' } }));
  expect(mainOpenTag(html)).toContain('data-page-ready="false"');
});

test('/projects/new: BOTH doors live inside the one page root, so the contract is readable where it is anchored', async () => {
  const { default: ProjectBuilderPage } = await import('@/app/projects/[id]/page');
  const html = renderToStaticMarkup(React.createElement(ProjectBuilderPage, { params: { id: 'new' } }));

  expect(html.match(/<main /g)).toHaveLength(1);
  const rootStart = html.indexOf('<main');
  const rootEnd = html.indexOf('</main>');
  for (const section of ['data-section="project-onboard"', 'data-section="project-create"', 'data-app-type-count']) {
    const at = html.indexOf(section);
    expect(at, `${section} must be inside main[data-page]`).toBeGreaterThan(rootStart);
    expect(at, `${section} must be inside main[data-page]`).toBeLessThan(rootEnd);
  }
});

test('/architect/new: the root cannot say ready while the roster it renders says loading', async () => {
  const { default: ArchitectNewPage } = await import('@/app/architect/new/page');
  const html = renderToStaticMarkup(React.createElement(ArchitectNewPage));
  expect(html).toContain('data-roster-state="loading"');
  expect(mainOpenTag(html)).toContain('data-page-ready="false"');
});
