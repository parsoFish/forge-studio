/**
 * RED — forge-8vfn.8.3.4: two independent controls used to lock one demo
 * generation. `GenerationGallery`'s own per-item "finalize-generation" and
 * `SessionInteractivePanel`'s verdict-approve generation picker each owned
 * an INDEPENDENT `useState` for "which generation is selected", so picking
 * generation B in one control left the other still pointed at generation A
 * (or its own default) — approving from the panel could lock a DIFFERENT
 * generation than the one the gallery showed as selected.
 *
 * THE FIX lifts the selection to the session page (one `useState` in
 * `app/sessions/[kind]/[sessionId]/page.tsx`), threaded into BOTH
 * `GenerationGallery` (`selection`/`onSelect`) and `SessionInteractivePanel`
 * (`selectedGeneration`/`onSelectGeneration`) — see
 * `scripts/session-generation-lock-one.test.ts` for the page-level
 * call-site pin proving ONE state variable feeds both controls.
 *
 * This file pins the RENDER-level half: given the SAME controlled selection
 * value, both components must render it as selected — and a selection
 * belonging to a DIFFERENT session must never leak in. `renderToStaticMarkup`
 * (this suite's established technique — no jsdom, see
 * `SessionInteractivePanel.test.ts`'s own header) proves INITIAL render
 * only, which is sufficient here: both components are now CONTROLLED (no
 * internal fallback state), so the initial render already reveals whether a
 * passed-in selection is honoured.
 *
 * RUN: npx vitest run --root apps/studio tests/contract/SessionGenerationLockOne.test.ts
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { GenerationGallery } from '../../components/studio/GenerationGallery';
import { SessionInteractivePanel } from '../../components/studio/session/SessionInteractivePanel';
import type { SessionAffordance, SessionArtifactPayload } from '@/lib/session-client';

function generationGallery(numbers: number[]): SessionArtifactPayload {
  return {
    kind: 'generation-gallery',
    label: 'Demo generations',
    sourcesScanned: [],
    generations: numbers.map((n) => ({ number: n, createdAt: '2026-08-15T00:00:00Z', feedback: null, targetElement: null, items: [] })),
  } as never;
}

const GALLERY_ARTIFACT = generationGallery([1, 2, 3]);

const VERDICT_AFFORDANCE: SessionAffordance = {
  id: 'awaiting-review-verdict',
  kind: 'verdict',
  phase: 'awaiting-review',
  meta: { verdicts: ['approve', 'reject'] },
};

function selectTag(html: string): string {
  const idx = html.indexOf('data-field="session-generation-pick"');
  expect(idx, `expected to find the generation picker in: ${html}`).toBeGreaterThanOrEqual(0);
  const start = html.lastIndexOf('<select', idx);
  const end = html.indexOf('>', idx);
  return html.slice(start, end + 1);
}

test('GenerationGallery renders the CONTROLLED selection, not an internal default — generation 2 chosen elsewhere must render as selected here', () => {
  const html = renderToStaticMarkup(
    React.createElement(GenerationGallery, {
      artifact: GALLERY_ARTIFACT,
      sessionId: 'sid-1',
      selection: { sessionId: 'sid-1', number: 2 },
      onSelect: () => {},
    } as never),
  );
  expect(html).toContain('data-selected-generation="2"');
  expect(html).toMatch(/data-action="select-generation" data-generation-number="2" data-generation-selected="true"/);
});

test("SessionInteractivePanel's generation picker renders the CONTROLLED selection — generation 2 chosen in the gallery must render as the picker's value, not the panel's own default", () => {
  const html = renderToStaticMarkup(
    React.createElement(SessionInteractivePanel, {
      kind: 'demo',
      sessionId: 'sid-1',
      project: 'demoproj',
      phase: 'awaiting-review',
      affordances: [VERDICT_AFFORDANCE],
      artifact: GALLERY_ARTIFACT,
      events: [],
      terminal: false,
      selectedGeneration: { sessionId: 'sid-1', number: 2 },
      onSelectGeneration: () => {},
    } as never),
  );
  expect(selectTag(html)).toContain('data-selected-generation="2"');
});

test("a selection made in a DIFFERENT session never leaks in — SessionInteractivePanel falls back to the newest generation (the same default GenerationGallery uses) when selectedGeneration.sessionId does not match the panel's own sessionId", () => {
  const html = renderToStaticMarkup(
    React.createElement(SessionInteractivePanel, {
      kind: 'demo',
      sessionId: 'sid-2',
      project: 'demoproj',
      phase: 'awaiting-review',
      affordances: [VERDICT_AFFORDANCE],
      artifact: GALLERY_ARTIFACT,
      events: [],
      terminal: false,
      selectedGeneration: { sessionId: 'sid-1', number: 2 },
      onSelectGeneration: () => {},
    } as never),
  );
  expect(selectTag(html)).toContain('data-selected-generation="3"');
});

test('with no controlled selection at all, both controls default to the newest generation (#3) — the pre-existing, still-honoured default', () => {
  const galleryHtml = renderToStaticMarkup(
    React.createElement(GenerationGallery, {
      artifact: GALLERY_ARTIFACT,
      sessionId: 'sid-1',
      selection: null,
      onSelect: () => {},
    } as never),
  );
  expect(galleryHtml).toContain('data-selected-generation="3"');

  const panelHtml = renderToStaticMarkup(
    React.createElement(SessionInteractivePanel, {
      kind: 'demo',
      sessionId: 'sid-1',
      project: 'demoproj',
      phase: 'awaiting-review',
      affordances: [VERDICT_AFFORDANCE],
      artifact: GALLERY_ARTIFACT,
      events: [],
      terminal: false,
      selectedGeneration: null,
      onSelectGeneration: () => {},
    } as never),
  );
  expect(selectTag(panelHtml)).toContain('data-selected-generation="3"');
});
