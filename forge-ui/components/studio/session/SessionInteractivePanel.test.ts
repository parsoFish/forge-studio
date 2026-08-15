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
import type { EventLogEntry } from '@/lib/bridge-client';

function render(props: {
  kind: string;
  sessionId?: string;
  project?: string | null;
  phase: string;
  affordances: SessionAffordance[];
  artifact?: SessionArtifactPayload | null;
  modelTier?: string | null;
  events?: EventLogEntry[];
  terminal?: boolean;
}): string {
  return renderToStaticMarkup(
    React.createElement(SessionInteractivePanel, {
      sessionId: 'sid-1',
      project: 'demoproj',
      // W6-B8 — every existing call site below predates `events`/`terminal`;
      // defaulted here (not in the component, which keeps both required —
      // mirrors `phase`) so this file's pre-existing tests need no mechanical
      // per-call-site update. `terminal: false` matches the ADR-043 default
      // reading of an affordance-bearing/working session; individual tests
      // below override it to exercise the ActivityLog gate itself.
      events: [],
      terminal: false,
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

// ---------------------------------------------------------------------------
// W6-B8 — the file-package id field. Driven by `artifact.kind ===
// 'file-package'`, never by `kind === 'authoring'` (the panel is generic
// over every session kind — a future kind whose artifact happens to be a
// file-package gets the SAME id field, for free). `handleAuthoringVerdict`
// (cli/bridge-studio-affordances.ts) needs a non-empty `body.id` — this is
// the ONLY affordance-kind shape whose verdict submit needs more than
// `{verdict}`. `kind` is NEVER sent (W6-B9): the write route derives it
// server-side from the real staged files.
//
// W6-B9 (reviewer finding on W6-B8): the Approve gate is now driven by
// `affordance.meta.requires` (server-derived, wire data) — NOT by a
// client-side "file-package implies an id is needed" assumption. Two
// verdict fixtures below make this explicit: `APPROVE_ONLY_VERDICT` (no
// `requires`, kb-cleanup's real shape) vs
// `APPROVE_ONLY_VERDICT_REQUIRES_ID` (authoring's real shape) — the SAME
// `file-package` artifact under the FORMER would leave Approve enabled with
// no id typed (nothing is required), proving the gate reads the wire
// field, never the artifact kind directly.
// ---------------------------------------------------------------------------

function filePackage(files: { path: string; body: string }[]): SessionArtifactPayload {
  return { kind: 'file-package', label: 'Package', files };
}

const APPROVE_ONLY_VERDICT: SessionAffordance = {
  id: 'awaiting-review-verdict',
  kind: 'verdict',
  phase: 'awaiting-review',
  meta: { verdicts: ['approve'] },
};

const APPROVE_ONLY_VERDICT_REQUIRES_ID: SessionAffordance = {
  id: 'awaiting-review-verdict',
  kind: 'verdict',
  phase: 'awaiting-review',
  meta: { verdicts: ['approve'], requires: ['id'] },
};

test('a file-package artifact with a SKILL.md renders the package-id field labelled for a skill, and Approve stays disabled (meta.requires:["id"]) until an id is entered', () => {
  const html = render({
    kind: 'authoring',
    phase: 'awaiting-review',
    affordances: [APPROVE_ONLY_VERDICT_REQUIRES_ID],
    artifact: filePackage([{ path: 'SKILL.md', body: '# A skill' }]),
  });
  expect(html).toContain('data-field="session-package-id"');
  expect(html).toContain('Skill id (directory name)');
  const tag = actionTag(html, 'verdict-approve');
  expect(tag).toContain('disabled=""');
});

test('the SAME file-package artifact under a verdict affordance with NO meta.requires leaves Approve ENABLED with no id typed — the gate reads the wire field, never a client-side "file-package needs an id" assumption', () => {
  const html = render({
    kind: 'authoring',
    phase: 'awaiting-review',
    affordances: [APPROVE_ONLY_VERDICT],
    artifact: filePackage([{ path: 'SKILL.md', body: '# A skill' }]),
  });
  const tag = actionTag(html, 'verdict-approve');
  expect(tag).not.toContain('disabled=""');
});

test('a file-package artifact with a hook.yaml renders the package-id field labelled for a hook (never a kind==="authoring" compare)', () => {
  const html = render({
    kind: 'not-actually-authoring',
    phase: 'awaiting-review',
    affordances: [APPROVE_ONLY_VERDICT_REQUIRES_ID],
    artifact: filePackage([{ path: 'hook.yaml', body: 'on: pre-commit' }]),
  });
  expect(html).toContain('data-field="session-package-id"');
  expect(html).toContain('Hook id (directory name)');
});

test('a file-package artifact with NEITHER SKILL.md nor hook.yaml yet (shape "unknown") still renders the id field, honestly disabled — never a button known in advance to 400', () => {
  const html = render({
    kind: 'authoring',
    phase: 'awaiting-review',
    affordances: [APPROVE_ONLY_VERDICT_REQUIRES_ID],
    artifact: filePackage([{ path: 'README.md', body: 'not a package marker file' }]),
  });
  expect(html).toContain('data-field="session-package-id"');
  const tag = actionTag(html, 'verdict-approve');
  expect(tag).toContain('disabled=""');
  expect(html).toContain('Waiting for the draft to include');
});

test('a NON-file-package artifact (cleanup-plan) never renders the package-id field — the approve button is enabled by the ordinary busy-only gate', () => {
  const html = render({
    kind: 'kb-cleanup',
    phase: 'awaiting-approval',
    affordances: [APPROVE_ONLY_VERDICT],
    artifact: { kind: 'cleanup-plan', label: 'Cleanup plan', plan: null, actions: [], openFindingCount: 0 },
  });
  expect(html).not.toContain('data-field="session-package-id"');
  const tag = actionTag(html, 'verdict-approve');
  expect(tag).not.toContain('disabled=""');
});

// ---------------------------------------------------------------------------
// W6-B8 — the ActivityLog drawer, gated on `!terminal`. Wired generically
// (every GENERIC_PANEL_KINDS kind gets it, driven by the `terminal` prop —
// never a per-kind compare).
// ---------------------------------------------------------------------------

const FIXTURE_EVENT: EventLogEntry = {
  event_id: 'e1',
  initiative_id: 'sid-1',
  started_at: '2026-08-15T00:00:00Z',
  phase: 'analyzing',
  skill: 'creation-agent',
  event_type: 'log',
  message: 'working…',
};

test('terminal:false renders the ActivityLog drawer', () => {
  const html = render({
    kind: 'authoring',
    phase: 'analyzing',
    affordances: [],
    events: [FIXTURE_EVENT],
    terminal: false,
  });
  expect(html).toContain('data-component="activity-drawer"');
});

test('terminal:true hides the ActivityLog drawer — a settled session is not "working"', () => {
  const html = render({
    kind: 'kb-cleanup',
    phase: 'applied',
    affordances: [],
    events: [FIXTURE_EVENT],
    terminal: true,
  });
  expect(html).not.toContain('data-component="activity-drawer"');
});
