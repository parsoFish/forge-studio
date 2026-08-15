/**
 * Acceptance tests — KbSelector's zero-KB state (W6-IA-4 sweep finding
 * C4#2).
 *
 * `KbSelector` calls `useRouter()` (next/navigation) at the top of the
 * component. Outside a mounted Next.js app router (as under bare
 * `renderToStaticMarkup`), `useRouter()` THROWS ("invariant expected app
 * router to be mounted") rather than returning `null` the way
 * `usePathname()` does (`../../../lib/projects-index-render.test.ts`'s own
 * header documents that DIFFERENT, null-returning case) — confirmed by
 * running this file without the mock below before adding it. Mocked to a
 * no-op router object; `handleChange`'s `router.push(...)` call is never
 * exercised by a static render anyway (no event handlers run).
 *
 * RUN: npx vitest run components/studio/knowledge/KbSelector.test.ts   (from forge-ui/)
 */
import { test, expect, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
}));

import { KbSelector } from './KbSelector';
import type { Kb } from '@/lib/studio-client';

function makeKb(id: string, kind: 'flow' | 'project' | 'unique' = 'unique'): Kb {
  return {
    id, name: id, binding: { kind }, counts: { index: 0, themes: 0, raw: 0 },
    lint: null, provenance: 'unknown',
  };
}

test('a POPULATED roster renders normally — real optgroups, no placeholder, no zero-state markers', () => {
  const html = renderToStaticMarkup(React.createElement(KbSelector, { kbs: [makeKb('kb1')], currentId: 'kb1' }));
  expect(html).toContain('data-kb-select-empty="false"');
  expect(html).not.toContain('data-kb-select-placeholder');
  expect(html).not.toContain('data-action="new-kb-select-option"');
  expect(html).toContain('<option value="kb1"');
});

test('a ZERO-KB roster renders a disabled placeholder option, never a silently empty <select>', () => {
  const html = renderToStaticMarkup(React.createElement(KbSelector, { kbs: [], currentId: '' }));
  expect(html).toContain('data-kb-select-empty="true"');
  expect(html).toContain('data-kb-select-placeholder="true"');
  expect(html).toContain('disabled');
  expect(html).toContain('No knowledge bases yet');
});

test('a ZERO-KB roster ALSO renders a real, selectable "+ New knowledge base" entry', () => {
  const html = renderToStaticMarkup(React.createElement(KbSelector, { kbs: [], currentId: '' }));
  expect(html).toContain('data-action="new-kb-select-option"');
  expect(html).toContain('+ New knowledge base');
  // The new-kb option must NOT itself be disabled (it has to be selectable).
  const i = html.indexOf('data-action="new-kb-select-option"');
  const start = html.lastIndexOf('<option', i);
  const end = html.indexOf('>', i);
  const optionTag = html.slice(start, end + 1);
  expect(optionTag).not.toContain('disabled');
});
