/**
 * Acceptance test — the Knowledge page's honest "no KBs yet" empty state
 * (W6-IA-4 sweep finding C4#1).
 *
 * `components/studio/knowledge/KnowledgeEmptyState.tsx` — a pure leaf
 * component, no fetch, no `next/navigation` hooks — renders cleanly under
 * `react-dom/server`'s `renderToStaticMarkup` with no mocking at all.
 *
 * RUN: npx vitest run lib/knowledge-empty-state-render.test.ts   (from forge-ui/)
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KnowledgeEmptyState } from '@/components/studio/knowledge/KnowledgeEmptyState';

test('renders data-component="knowledge-empty" with a "no knowledge bases yet" message', () => {
  const html = renderToStaticMarkup(React.createElement(KnowledgeEmptyState));
  expect(html).toContain('data-component="knowledge-empty"');
  expect(html).toContain('No knowledge bases yet');
});

test('renders a "+ New knowledge base" CTA to /knowledge/new, under its OWN distinct action id', () => {
  const html = renderToStaticMarkup(React.createElement(KnowledgeEmptyState));
  expect(html).toContain('data-action="new-kb-empty-cta"');
  expect(html).toContain('href="/knowledge/new"');
  // Distinct from the page header's always-present data-action="new-kb" —
  // never the SAME action id, or a selector for either becomes ambiguous
  // whenever both render at once.
  expect(html).not.toContain('data-action="new-kb"');
});
