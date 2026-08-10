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

test('a hook.yaml at the package root -> shape "hook", finalize section renders id + all hook fields', () => {
  const html = render('sid-1', filePackage([{ path: 'hook.yaml', body: 'name: x' }, { path: 'scripts/run.sh', body: '#!/bin/sh' }]));
  expect(html).toContain('data-authoring-shape="hook"');
  expect(html).toContain('data-section="authoring-finalize"');
  expect(html).toContain('data-field="authoring-id"');
  expect(html).toContain('data-field="authoring-hook-name"');
  expect(html).toContain('data-field="authoring-hook-description"');
  expect(html).toContain('data-field="authoring-hook-on"');
  expect(html).toContain('data-field="authoring-hook-matcher"');
  expect(html).toContain('Save hook');
});

test('the Save button carries data-action="finalize-authoring" and is disabled before an id is typed', () => {
  const html = render('sid-1', filePackage([{ path: 'SKILL.md', body: '# x' }]));
  const idx = html.indexOf('data-action="finalize-authoring"');
  const start = html.lastIndexOf('<', idx);
  const end = html.indexOf('>', idx);
  const tag = html.slice(start, end + 1);
  expect(tag).toContain('disabled=""');
});
