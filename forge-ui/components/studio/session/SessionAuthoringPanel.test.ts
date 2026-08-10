/**
 * DOM regression tests for `SessionAuthoringPanel.tsx` (R4-21 T3, BLOCKER-2
 * fix — the "authoring" kind's live interactive affordance on the generic
 * session shell, `/sessions/authoring/<sessionId>`).
 *
 * Mirrors `forge-ui/lib/run-panel-render.test.ts`'s own pattern: renders the
 * REAL component via `react-dom/server`'s `renderToStaticMarkup` and asserts
 * on the resulting markup string. `useState`/click-handler interaction does
 * not run under `renderToStaticMarkup`; this file pins the INITIAL-render
 * DOM contract for each draft SHAPE (none / skill / hook) the component's
 * pure, file-presence-driven `draftShapeOf` detection can produce.
 *
 * AMENDMENT ROUND 2 (R4-21 phase 2, T3, correction A/C —
 * `_wave5/unit-specs/R4-21-phase2.md` + the T3 amendment brief): the
 * hook-specific form fields (`authoring-hook-name`, `authoring-hook-
 * description`, `authoring-hook-on`, `authoring-hook-matcher`) this file's
 * round-1 body pinned as PRESENT are now pinned ABSENT. Those fields were the
 * divergence source correction A removes: hook metadata now comes from the
 * DRAFTED hook.yaml the operator already reviews in the artifact pane, not
 * from a parallel form the operator could fill in differently — if the
 * installed hook's `on`/`matcher` came from these fields instead of the
 * reviewed artifact, the reviewed artifact would not be what ships. Only
 * `authoring-id` (the library id — still an operator decision the drafted
 * package cannot make for itself, D4) and the `finalize-authoring` action
 * survive for a hook draft, exactly as they already do for a skill draft.
 *
 * RED-NOW: `SessionAuthoringPanel.tsx` still renders all four hook-specific
 * fields (BLOCKER-2's original shape) — this file's hook-shape test is
 * expected to fail at THIS pin until the panel is cut over. That is correct
 * and intended (T3 writes tests only; production stays untouched by this
 * agent).
 *
 * RUN: npx vitest run components/studio/session/SessionAuthoringPanel.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SessionAuthoringPanel } from './SessionAuthoringPanel';
import type { SessionArtifactPayload } from '@/lib/session-client';

function filePackage(files: Array<{ path: string; body: string }>): SessionArtifactPayload {
  return { kind: 'file-package', label: 'Package', files };
}

function render(sessionId: string, artifact: SessionArtifactPayload | null): string {
  return renderToStaticMarkup(React.createElement(SessionAuthoringPanel, { sessionId, artifact }));
}

test('no artifact yet (null) -> "still drafting" status, shape "unknown", no finalize section', () => {
  const html = render('sid-1', null);
  expect(html).toContain('data-component="authoring-panel"');
  expect(html).toContain('data-section="authoring-status"');
  expect(html).toContain('data-authoring-shape="unknown"');
  expect(html).toContain('creation agent is drafting');
  expect(html).not.toContain('data-section="authoring-finalize"');
});

test('an empty file-package (agent started, nothing written yet) -> shape "unknown", no finalize section', () => {
  const html = render('sid-1', filePackage([]));
  expect(html).toContain('data-authoring-shape="unknown"');
  expect(html).not.toContain('data-section="authoring-finalize"');
});

test('a SKILL.md at the package root -> shape "skill", finalize section renders id field only (no hook fields)', () => {
  const html = render('sid-1', filePackage([{ path: 'SKILL.md', body: '# x' }, { path: 'reference.md', body: 'y' }]));
  expect(html).toContain('data-authoring-shape="skill"');
  expect(html).toContain('data-section="authoring-finalize"');
  expect(html).toContain('data-field="authoring-id"');
  expect(html).toContain('Save skill');
  expect(html).not.toContain('data-field="authoring-hook-name"');
});

test('a hook.yaml at the package root -> shape "hook", finalize section renders id ONLY — the hook-specific form fields are GONE (correction A: hook metadata comes from the drafted hook.yaml, not a parallel form)', () => {
  const html = render('sid-1', filePackage([{ path: 'hook.yaml', body: 'name: x' }, { path: 'scripts/run.sh', body: '#!/bin/sh' }]));
  expect(html).toContain('data-authoring-shape="hook"');
  expect(html).toContain('data-section="authoring-finalize"');
  expect(html).toContain('data-field="authoring-id"');
  expect(html).toContain('data-action="finalize-authoring"');
  // The divergence source correction A removes — a hook draft's fields must
  // come ONLY from the drafted hook.yaml the operator already reviews in the
  // artifact pane, never from a parallel, independently-editable form.
  expect(html).not.toContain('data-field="authoring-hook-name"');
  expect(html).not.toContain('data-field="authoring-hook-description"');
  expect(html).not.toContain('data-field="authoring-hook-on"');
  expect(html).not.toContain('data-field="authoring-hook-matcher"');
});

test('the Save button carries data-action="finalize-authoring" and is disabled before an id is typed (id is the ONLY input finalize needs — for both skill and hook shapes)', () => {
  const html = render('sid-1', filePackage([{ path: 'SKILL.md', body: '# x' }]));
  const idx = html.indexOf('data-action="finalize-authoring"');
  const start = html.lastIndexOf('<', idx);
  const end = html.indexOf('>', idx);
  const tag = html.slice(start, end + 1);
  expect(tag).toContain('disabled=""');
});

