/**
 * DOM regression tests for `SessionInteractivePanel.tsx` (W6-B6 — the
 * generic interaction panel, ADR-043 docs/decisions/043-generic-
 * interactive-surface.md 2026-08-15 amendment §1).
 *
 * Mirrors `SessionAuthoringPanel.test.ts`'s / `SessionCleanupPanel.test.ts`'s
 * own pattern: renders the REAL component via `react-dom/server`'s
 * `renderToStaticMarkup` and asserts on the resulting markup string.
 * `useState`/click-handler interaction does not run under
 * `renderToStaticMarkup` (no jsdom in this suite) — this file pins the
 * INITIAL-render DOM contract for every affordance-kind shape the panel can
 * receive, per this file set's established, disclosed limitation.
 *
 * RUN: npx vitest run components/studio/session/SessionInteractivePanel.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SessionInteractivePanel } from './SessionInteractivePanel';
import type { SessionAffordance, SessionArtifactPayload } from '@/lib/session-client';

function render(props: {
  kind: string;
  sessionId?: string;
  project?: string | null;
  phase: string;
  affordances: SessionAffordance[];
  artifact?: SessionArtifactPayload | null;
  modelTier?: string | null;
}): string {
  return renderToStaticMarkup(
    React.createElement(SessionInteractivePanel, {
      sessionId: 'sid-1',
      project: 'demoproj',
      ...props,
    }),
  );
}

function actionTag(html: string, action: string): string {
  const idx = html.indexOf(`data-action="${action}"`);
  expect(idx, `expected to find data-action="${action}" in: ${html}`).toBeGreaterThanOrEqual(0);
  const start = html.lastIndexOf('<', idx);
  const end = html.indexOf('>', idx);
  return html.slice(start, end + 1);
}

// ---------------------------------------------------------------------------
// Empty affordances — the honest "no operator action" state (never null,
// never rendered as nothing at all — this is what closes the demo/onboarding
// "render null today" gap the page-level wiring change fixes).
// ---------------------------------------------------------------------------

test('affordances: [] renders the honest no-affordances state, not an empty shell', () => {
  const html = render({ kind: 'onboarding', phase: 'running', affordances: [] });
  expect(html).toContain('data-component="session-interactive-panel"');
  expect(html).toContain('data-affordance-count="0"');
  expect(html).toContain('data-section="session-no-affordances"');
  expect(html).toContain('No operator action available');
  expect(html).not.toContain('data-section="session-affordance"');
});

// ---------------------------------------------------------------------------
// Provenance strip + model chip (task spec: 'derived from phase <phase>',
// mock №7) — always rendered, both on the empty and populated paths.
// ---------------------------------------------------------------------------

test('provenance strip reads "derived from phase <phase>" verbatim, and the model chip is read-only, showing the real tier or "default"', () => {
  const html = render({ kind: 'demo', phase: 'awaiting-review', affordances: [], modelTier: 'opus' });
  expect(html).toContain('data-section="session-provenance"');
  expect(html).toContain('derived from phase awaiting-review');
  expect(html).toContain('data-component="session-model-chip"');
  expect(html).toContain('data-model-tier="opus"');
  expect(html).toContain('model: opus');

  const htmlNoTier = render({ kind: 'demo', phase: 'generating', affordances: [], modelTier: null });
  expect(htmlNoTier).toContain('model: default');
  expect(htmlNoTier).toContain('data-model-tier=""');
});

// ---------------------------------------------------------------------------
// question-form
// ---------------------------------------------------------------------------

test('question-form affordance renders an answer field + disabled submit-answers button until text is entered', () => {
  const html = render({
    kind: 'instructions',
    phase: 'awaiting-answers',
    affordances: [{ id: 'awaiting-answers-question-form', kind: 'question-form', phase: 'awaiting-answers' }],
  });
  expect(html).toContain('data-affordance-kind="question-form"');
  expect(html).toContain('data-field="session-answer"');
  const tag = actionTag(html, 'submit-answers');
  expect(tag).toContain('disabled=""');
});

// ---------------------------------------------------------------------------
// verdict — W6-B6 post-merge review (HIGH): rendered ONLY from the
// server-derived `affordance.meta.verdicts` — never a client-side per-kind
// name table (deleted APPROVE_ONLY_KINDS). `kind` here is just an arbitrary
// string; these tests prove the panel reads NOTHING from it to decide which
// verdict buttons render — only `meta.verdicts` and (for the generation
// picker) the real artifact kind.
// ---------------------------------------------------------------------------

function generationGallery(numbers: number[]): SessionArtifactPayload {
  return {
    kind: 'generation-gallery',
    label: 'Demo generations',
    sourcesScanned: [],
    generations: numbers.map((n) => ({ number: n, createdAt: '2026-08-15T00:00:00Z', feedback: null, targetElement: null, items: [] })),
  };
}

test('verdict affordance with meta.verdicts:[approve,reject] renders BOTH buttons, plus a generation picker sourced from the real artifact (never a kind==="demo" compare)', () => {
  const html = render({
    kind: 'not-actually-demo', // proves the picker is artifact-driven, not name-driven
    phase: 'awaiting-review',
    affordances: [{ id: 'awaiting-review-verdict', kind: 'verdict', phase: 'awaiting-review', meta: { verdicts: ['approve', 'reject'] } }],
    artifact: generationGallery([1, 2, 3]),
  });
  expect(html).toContain('data-affordance-kind="verdict"');
  expect(html).toContain('data-action="verdict-approve"');
  expect(html).toContain('data-action="verdict-reject"');
  expect(html).toContain('data-field="session-generation-pick"');
  expect(html).toContain('auto (latest — #3)');
  expect(html).toContain('generation #1');
  expect(html).toContain('generation #2');
});

test('verdict affordance with NO generations yet renders no picker (never a picker with nothing to pick), regardless of kind', () => {
  const html = render({
    kind: 'demo',
    phase: 'awaiting-review',
    affordances: [{ id: 'awaiting-review-verdict', kind: 'verdict', phase: 'awaiting-review', meta: { verdicts: ['approve', 'reject'] } }],
    artifact: generationGallery([]),
  });
  expect(html).not.toContain('data-field="session-generation-pick"');
});

test('a generation-gallery artifact under a NON-demo kind still renders the picker — proves the picker is driven by artifact.kind, never a kind==="demo" compare (W6-B6 post-merge review MEDIUM finding)', () => {
  const html = render({
    kind: 'kb-cleanup',
    phase: 'awaiting-review',
    affordances: [{ id: 'awaiting-review-verdict', kind: 'verdict', phase: 'awaiting-review', meta: { verdicts: ['approve', 'reject'] } }],
    artifact: generationGallery([5]),
  });
  expect(html).toContain('data-field="session-generation-pick"');
});

// ---------------------------------------------------------------------------
// verdict — approve-only (kb-cleanup/authoring's real shape): B4's table
// declares no rejection path for either, expressed here purely as
// meta.verdicts:['approve'] — the panel never checks the session kind name.
// ---------------------------------------------------------------------------

for (const kind of ['kb-cleanup', 'authoring']) {
  test(`verdict affordance with meta.verdicts:['approve'] (kind "${kind}"'s real shape) renders approve ONLY — no reject button`, () => {
    const html = render({
      kind,
      phase: 'awaiting-approval',
      affordances: [{ id: 'awaiting-approval-verdict', kind: 'verdict', phase: 'awaiting-approval', meta: { verdicts: ['approve'] } }],
    });
    expect(html).toContain('data-action="verdict-approve"');
    expect(html).not.toContain('data-action="verdict-reject"');
  });
}

test('a verdict affordance with meta.verdicts:["reject"] only (a hypothetical future row) renders reject ONLY — proves neither button is hardcoded to a fixed pairing', () => {
  const html = render({
    kind: 'anything',
    phase: 'awaiting-review',
    affordances: [{ id: 'awaiting-review-verdict', kind: 'verdict', phase: 'awaiting-review', meta: { verdicts: ['reject'] } }],
  });
  expect(html).not.toContain('data-action="verdict-approve"');
  expect(html).toContain('data-action="verdict-reject"');
});

test('a verdict affordance with meta.verdicts ABSENT entirely renders NEITHER button — the defensive fallback for a malformed/older payload, never a fabricated default', () => {
  const html = render({
    kind: 'anything',
    phase: 'awaiting-review',
    affordances: [{ id: 'awaiting-review-verdict', kind: 'verdict', phase: 'awaiting-review' }],
  });
  expect(html).not.toContain('data-action="verdict-approve"');
  expect(html).not.toContain('data-action="verdict-reject"');
});

// ---------------------------------------------------------------------------
// staged-review / next-turn — disabled, honestly labelled "not yet wired"
// (B4 returns 501 for both).
// ---------------------------------------------------------------------------

test('staged-review and next-turn affordances render disabled with an honest "not yet wired" label', () => {
  const html = render({
    kind: 'instructions',
    phase: 'drafting',
    affordances: [
      { id: 'drafting-staged-review', kind: 'staged-review', phase: 'drafting', meta: { writes: ['draft'] } },
      { id: 'drafting-next-turn', kind: 'next-turn', phase: 'drafting', meta: { next: 'awaiting-verdict' } },
    ],
  });
  expect(html).toContain('data-affordance-kind="staged-review"');
  expect(html).toContain('data-affordance-kind="next-turn"');
  const notYetWiredCount = html.split('not yet wired').length - 1;
  expect(notYetWiredCount).toBe(2);
  // Both controls in this state are plain disabled buttons — no data-action
  // (there is no operator write act for either), so neither
  // "verdict-approve"/"submit-answers" leak in for this shape.
  expect(html).not.toContain('data-action="verdict-approve"');
  expect(html).not.toContain('data-action="submit-answers"');
});

// ---------------------------------------------------------------------------
// Multiple affordances on one phase row (e.g. a noop row that ALSO carries
// `next`) all render together, in order.
// ---------------------------------------------------------------------------

test('a phase yielding multiple affordances (question-form + next-turn) renders both sections', () => {
  const html = render({
    kind: 'instructions',
    phase: 'awaiting-answers',
    affordances: [
      { id: 'awaiting-answers-question-form', kind: 'question-form', phase: 'awaiting-answers' },
      { id: 'awaiting-answers-next-turn', kind: 'next-turn', phase: 'awaiting-answers', meta: { next: 'interviewing' } },
    ],
  });
  expect(html).toContain('data-affordance-kind="question-form"');
  expect(html).toContain('data-affordance-kind="next-turn"');
  expect(html).toContain('data-affordance-count="2"');
});
