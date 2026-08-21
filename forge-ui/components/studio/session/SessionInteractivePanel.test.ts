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
import { resolve } from 'node:path';

import { SessionInteractivePanel } from './SessionInteractivePanel';
import type { SessionAffordance, SessionArtifactPayload } from '@/lib/session-client';
import type { EventLogEntry } from '@/lib/bridge-client';
// community-14 — the real session-kind loader + affordance derivation, so the
// community-refresh regression test at the bottom of this file drives the
// SAME wire affordance the bridge sends, not a hand-written stand-in.
import { loadSessionKinds, deriveSessionAffordances } from '../../../../orchestrator/studio/session-kinds.ts';

const FORGE_ROOT = resolve(__dirname, '..', '..', '..', '..');

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
  // W7-A2: the copy is lifecycle-aware (a working phase says the agent is
  // working; see lib/session-lifecycle-render.test.ts) — never the old flat
  // "No operator action available" sentence for every state.
  expect(html).toContain('data-no-affordance-reason="working"');
  expect(html).toContain('no operator action needed right now');
  expect(html).not.toContain('data-section="session-affordance"');
});

// ---------------------------------------------------------------------------
// Provenance strip + model chip (task spec: 'derived from phase <phase>',
// mock №7) — always rendered, both on the empty and populated paths.
// ---------------------------------------------------------------------------

test('provenance strip reads "derived from phase <phase>" verbatim, and the model chip is read-only, showing the real tier or "not recorded" (W7-A2: never the literal "default")', () => {
  const html = render({ kind: 'demo', phase: 'awaiting-review', affordances: [], modelTier: 'opus' });
  expect(html).toContain('data-section="session-provenance"');
  expect(html).toContain('derived from phase awaiting-review');
  expect(html).toContain('data-component="session-model-chip"');
  expect(html).toContain('data-model-tier="opus"');
  expect(html).toContain('model: opus');

  const htmlNoTier = render({ kind: 'demo', phase: 'generating', affordances: [], modelTier: null });
  expect(htmlNoTier).toContain('model: not recorded');
  expect(htmlNoTier).not.toContain('model: default');
  expect(htmlNoTier).toContain('data-model-tier=""');
});

// ---------------------------------------------------------------------------
// question-form
// ---------------------------------------------------------------------------

test('question-form affordance renders an answer field + an ENABLED submit-answers button on initial render (W6-B9: no non-empty requirement — a briefing note is genuinely optional)', () => {
  const html = render({
    kind: 'instructions',
    phase: 'awaiting-answers',
    affordances: [{ id: 'awaiting-answers-question-form', kind: 'question-form', phase: 'awaiting-answers' }],
  });
  expect(html).toContain('data-affordance-kind="question-form"');
  expect(html).toContain('data-field="session-answer"');
  const tag = actionTag(html, 'submit-answers');
  expect(tag).not.toContain('disabled=""');
});

test("question-form affordance renders identically for instructions' 'briefing' phase (same reused affordance kind, different phase)", () => {
  const html = render({
    kind: 'instructions',
    phase: 'briefing',
    affordances: [{ id: 'briefing-question-form', kind: 'question-form', phase: 'briefing' }],
  });
  expect(html).toContain('data-affordance-kind="question-form"');
  expect(html).toContain('data-field="session-answer"');
  const tag = actionTag(html, 'submit-answers');
  expect(tag).not.toContain('disabled=""');
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
// staged-review / next-turn — HIDDEN entirely (W6-B9 reviewer fix; a
// placeholder "not yet wired" block used to render for both — B4 returns 501
// for both, so neither has ever had a real operator control here).
// ---------------------------------------------------------------------------

test('staged-review and next-turn affordances render NOTHING — no section, no "not yet wired" placeholder — and the panel falls back to the honest no-affordances state', () => {
  const html = render({
    kind: 'instructions',
    phase: 'drafting',
    affordances: [
      { id: 'drafting-staged-review', kind: 'staged-review', phase: 'drafting', meta: { writes: ['draft'] } },
      { id: 'drafting-next-turn', kind: 'next-turn', phase: 'drafting', meta: { next: 'awaiting-verdict' } },
    ],
  });
  expect(html).not.toContain('data-affordance-kind="staged-review"');
  expect(html).not.toContain('data-affordance-kind="next-turn"');
  expect(html).not.toContain('not yet wired');
  expect(html).toContain('data-affordance-count="0"');
  expect(html).toContain('data-section="session-no-affordances"');
  expect(html).not.toContain('data-action="verdict-approve"');
  expect(html).not.toContain('data-action="submit-answers"');
});

// ---------------------------------------------------------------------------
// ActivityLog (W6-B10) — shown exactly when every derived affordance is a
// disabled "not yet wired" one (a working phase with nothing actionable),
// generic over `kind` — mirrors the retired DemoBuilderPanel's own
// generating/locking coverage without a kind==='demo' compare.
// ---------------------------------------------------------------------------

test('ActivityLog renders when every affordance is not-yet-wired (a working phase, e.g. demo generating: writes+next)', () => {
  const html = render({
    kind: 'demo',
    phase: 'generating',
    affordances: [
      { id: 'generating-staged-review', kind: 'staged-review', phase: 'generating', meta: { writes: ['demo'] } },
      { id: 'generating-next-turn', kind: 'next-turn', phase: 'generating', meta: { next: 'awaiting-review' } },
    ],
    events: [],
  });
  expect(html).toContain('data-component="activity-drawer"');
});

test('ActivityLog does NOT render when a verdict affordance is present (something actionable)', () => {
  const html = render({
    kind: 'demo',
    phase: 'awaiting-review',
    affordances: [{ id: 'awaiting-review-verdict', kind: 'verdict', phase: 'awaiting-review', meta: { verdicts: ['approve', 'reject'] } }],
  });
  expect(html).not.toContain('data-component="activity-drawer"');
});

test('ActivityLog does NOT render on zero affordances at a genuinely TERMINAL phase (demo "locked")', () => {
  // Merge-reconciled (W6-B8 x W6-B10): the zero-affordances branch renders
  // `!terminal && <ActivityLog/>` (B8) — 'locked' is demo's real terminal
  // phase, so this must pass `terminal: true` explicitly (the wire's own
  // honest value for this phase) to keep asserting what it always meant to:
  // a SETTLED session shows no drawer. The companion case this test used to
  // conflate — a NON-terminal, zero-affordance phase (onboarding's
  // 'running') — is covered separately below ("terminal:false renders the
  // ActivityLog drawer"), which is the real gap B8 closed: W6-B10's own
  // `affordances.length > 0` guard would have hidden the drawer there too.
  const html = render({ kind: 'demo', phase: 'locked', affordances: [], terminal: true });
  expect(html).not.toContain('data-component="activity-drawer"');
});

test('ActivityLog does NOT render when affordances mix an actionable kind with a not-yet-wired one', () => {
  const html = render({
    kind: 'instructions',
    phase: 'awaiting-answers',
    affordances: [
      { id: 'awaiting-answers-question-form', kind: 'question-form', phase: 'awaiting-answers' },
      { id: 'awaiting-answers-next-turn', kind: 'next-turn', phase: 'awaiting-answers', meta: { next: 'interviewing' } },
    ],
  });
  expect(html).not.toContain('data-component="activity-drawer"');
});

// ---------------------------------------------------------------------------
// Multiple affordances on one phase row (e.g. a noop row that ALSO carries
// `next`) — only the RENDERABLE ones render (W6-B9 reviewer fix: next-turn
// is filtered out of the DOM even though the server-derived affordances[]
// legitimately carries it).
// ---------------------------------------------------------------------------

test('a phase yielding a renderable affordance (question-form) alongside a non-renderable one (next-turn) renders ONLY the renderable section — count reflects the DOM, not the wire array', () => {
  const html = render({
    kind: 'instructions',
    phase: 'awaiting-answers',
    affordances: [
      { id: 'awaiting-answers-question-form', kind: 'question-form', phase: 'awaiting-answers' },
      { id: 'awaiting-answers-next-turn', kind: 'next-turn', phase: 'awaiting-answers', meta: { next: 'interviewing' } },
    ],
  });
  expect(html).toContain('data-affordance-kind="question-form"');
  expect(html).not.toContain('data-affordance-kind="next-turn"');
  expect(html).toContain('data-affordance-count="1"');
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

// ===========================================================================
// W7-C2 — revise verdict + rationale + per-question form + requires hint +
// finalized link (sessions-kinds-09/17/23/29/36, library-22/24, beads
// forge-4ei / forge-lzv)
// ===========================================================================

test('C2-UI-1: meta.verdicts [approve, revise, reject] renders all three actions — revise included', () => {
  const html = render({
    kind: 'instructions',
    phase: 'awaiting-verdict',
    affordances: [{ id: 'awaiting-verdict-verdict', kind: 'verdict', phase: 'awaiting-verdict', meta: { verdicts: ['approve', 'revise', 'reject'] } }],
  });
  expect(html).toContain('data-action="verdict-approve"');
  expect(html).toContain('data-action="verdict-revise"');
  expect(html).toContain('data-action="verdict-reject"');
});

test('C2-UI-2: meta.verdicts [approve] renders NO revise action (still driven by the wire list only)', () => {
  const html = render({
    kind: 'instructions',
    phase: 'awaiting-verdict',
    affordances: [{ id: 'awaiting-verdict-verdict', kind: 'verdict', phase: 'awaiting-verdict', meta: { verdicts: ['approve'] } }],
  });
  expect(html).not.toContain('data-action="verdict-revise"');
});

test('C2-UI-3: every verdict affordance offers a notes field — the rationale recorded with the decision (sessions-kinds-29)', () => {
  const html = render({
    kind: 'instructions',
    phase: 'awaiting-verdict',
    affordances: [{ id: 'awaiting-verdict-verdict', kind: 'verdict', phase: 'awaiting-verdict', meta: { verdicts: ['approve', 'reject'] } }],
  });
  expect(html).toContain('data-field="session-verdict-notes"');
});

test('C2-UI-4: meta.questions renders one control per question (the real question text), never the single flattened box', () => {
  const html = render({
    kind: 'instructions',
    phase: 'awaiting-answers',
    affordances: [{
      id: 'awaiting-answers-question-form',
      kind: 'question-form',
      phase: 'awaiting-answers',
      meta: {
        questions: [
          { question: 'What language and build toolchain does this project use?', header: 'Toolchain', options: [{ label: 'Node + npm', description: 'package.json driven' }] },
          { question: 'What is the single quality-gate command?', header: 'Gate', options: [] },
        ],
      },
    } as never],
  });
  expect(html).toContain('data-section="session-interview"');
  expect(html).toContain('What language and build toolchain does this project use?');
  expect(html).toContain('What is the single quality-gate command?');
  expect(html).toContain('Node + npm');
  expect(html).not.toContain('data-field="session-answer"');
});

test('C2-UI-5: the briefing phase keeps the free-text box but with its own honest copy (not "Answer" to no question)', () => {
  const html = render({
    kind: 'instructions',
    phase: 'briefing',
    affordances: [{ id: 'briefing-question-form', kind: 'question-form', phase: 'briefing' }],
  });
  expect(html).toContain('data-field="session-answer"');
  expect(html).toContain('Brief the agent');
});

test('C2-UI-6: an unmet requires field renders an inline hint naming what Approve needs (sessions-kinds-23)', () => {
  const files = [{ path: 'SKILL.md', body: '# skill' }];
  const html = render({
    kind: 'authoring',
    phase: 'awaiting-review',
    artifact: { kind: 'file-package', label: 'Package', files },
    affordances: [{ id: 'awaiting-review-verdict', kind: 'verdict', phase: 'awaiting-review', meta: { verdicts: ['approve'], requires: ['id'] } }],
  });
  expect(html).toContain('data-requires-hint');
  expect(html).toMatch(/[Ee]nter .*id.* to enable Approve|id .*to enable Approve/);
});

test('C2-UI-7: a committed session with finalized {kind, id} renders a PERMANENT link to the object it produced (sessions-kinds-36)', () => {
  const html = render({
    kind: 'authoring',
    phase: 'committed',
    affordances: [],
    terminal: true,
    finalized: { kind: 'skill', id: 'pr-diff-summary', exists: true },
  } as never);
  expect(html).toContain('data-action="open-finalized"');
  expect(html).toContain('/skills/pr-diff-summary');
});

test('C2-UI-8: finalized kind "hook" links to /hooks/<id>; "community-registry" links to /community', () => {
  const hook = render({ kind: 'authoring', phase: 'committed', affordances: [], terminal: true, finalized: { kind: 'hook', id: 'auto-lint', exists: true } } as never);
  expect(hook).toContain('/hooks/auto-lint');
  const community = render({ kind: 'community-refresh', phase: 'committed', affordances: [], terminal: true, finalized: { kind: 'community-registry', id: 'registry', exists: true } } as never);
  expect(community).toContain('data-action="open-finalized"');
  expect(community).toContain('/community');
});

// ===========================================================================
// W7-C2 T1 review — the fix round's own DOM pins.
// ===========================================================================

test('C2-FIX-P04-2: a finalized pointer at an object that is GONE renders the honest record with NO link — never a dead /skills/<id>', () => {
  const html = render({
    kind: 'authoring',
    phase: 'committed',
    affordances: [],
    terminal: true,
    finalized: { kind: 'skill', id: 'deleted-skill', exists: false },
  } as never);
  expect(html).toContain('data-section="session-finalized"');
  expect(html).toContain('data-finalized-exists="false"');
  expect(html).not.toContain('data-action="open-finalized"');
  expect(html).not.toContain('/skills/deleted-skill');
});

test('C2-FIX-P04-3: the three kinds whose producers used to write NO pointer each render their own permanent link', () => {
  const agents = render({ kind: 'instructions', phase: 'committed', affordances: [], terminal: true, finalized: { kind: 'agents-md', id: 'demo-project', exists: true } } as never);
  expect(agents).toContain('data-action="open-finalized"');
  expect(agents).toContain('/projects/demo-project');

  const demo = render({ kind: 'demo', phase: 'locked', affordances: [], terminal: true, finalized: { kind: 'demo', id: 'demo-project', exists: true } } as never);
  expect(demo).toContain('/projects/demo-project/showcase');

  const kb = render({ kind: 'kb-cleanup', phase: 'applied', affordances: [], terminal: true, finalized: { kind: 'kb', id: 'forge-dev', exists: true } } as never);
  expect(kb).toContain('data-action="open-finalized"');
  expect(kb).toContain('/knowledge');
});

test('C2-FIX-A3-3: the per-question interview form carries each question\'s correlation id through to its fieldset', () => {
  const html = render({
    kind: 'instructions',
    phase: 'awaiting-answers',
    project: 'demo-project',
    affordances: [{
      id: 'awaiting-answers-question-form',
      kind: 'question-form',
      phase: 'awaiting-answers',
      meta: { questions: [{ id: 'q1', question: 'Same text?', options: [] }, { id: 'q2', question: 'Same text?', options: [] }] },
    }],
  });
  // Two identically-worded questions still render as two distinct controls —
  // the id, not the text, is what binds each answer server-side.
  expect(html).toContain('data-question-index="0"');
  expect(html).toContain('data-question-index="1"');
  expect(html).toContain('data-question-freetext="0"');
  expect(html).toContain('data-question-freetext="1"');
});

// ===========================================================================
// community-14 (W7 re-gate, S1) — the community-refresh registry draft's
// Approve button was PERMANENTLY disabled, so no refresh could ever be
// committed from Studio.
//
// `shapeResolved` (the SKILL.md/hook.yaml advisory `draftShapeOf` feeds) was
// ORed into the Approve gate for EVERY file-package artifact, but
// community-refresh's staging package is `registry.yaml` + `evidence.*` BY
// DESIGN — it never contains either marker file, so `packageShape` stayed
// 'unknown' forever. The advisory only ever meant "the id you must type is
// derived from a shape we can't see yet", so it may only gate a kind whose
// OWN `meta.requires` actually asks for that id (authoring / kb-cleanup);
// community-refresh's awaiting-review row declares no `requires` at all, and
// the server (`handleCommunityRefreshVerdict`) applies no such check.
//
// The affordance below is NOT hand-written: it is the real one
// `deriveSessionAffordances` emits for the real `community-refresh`
// descriptor in studio/session-kinds.yaml, so this test fails the day that
// row starts requiring an id (at which point the gate SHOULD return).
// ===========================================================================

test('community-14: a community-refresh registry draft (registry.yaml + evidence.*, no SKILL.md/hook.yaml) leaves Approve ENABLED — the SKILL.md/hook.yaml shape advisory only gates kinds whose own meta.requires asks for an id', () => {
  const descriptor = loadSessionKinds(FORGE_ROOT).find((k) => k.id === 'community-refresh');
  expect(descriptor, 'community-refresh must exist in studio/session-kinds.yaml').toBeTruthy();
  const derived = deriveSessionAffordances(descriptor!, 'awaiting-review');
  const verdict = derived.find((a) => a.kind === 'verdict');
  expect(verdict, 'awaiting-review must derive a verdict affordance').toBeTruthy();
  // Pin the premise this test rests on: the real row asks for NO fields.
  expect(verdict!.meta?.requires ?? []).toEqual([]);
  expect(verdict!.meta?.verdicts).toEqual(['approve', 'revise', 'reject']);

  const html = render({
    kind: 'community-refresh',
    phase: 'awaiting-review',
    affordances: [verdict as SessionAffordance],
    artifact: filePackage([
      { path: 'registry.yaml', body: 'entries: []' },
      { path: 'evidence.md', body: '# Evidence' },
      { path: 'evidence.json', body: '{}' },
    ]),
  });
  const tag = actionTag(html, 'verdict-approve');
  expect(tag).not.toContain('disabled=""');
  expect(tag).not.toContain('data-disabled-reason');
  // Reject/revise were never blocked — the operator's loop is only whole
  // once approve joins them.
  expect(html).toContain('data-action="verdict-reject"');
});
