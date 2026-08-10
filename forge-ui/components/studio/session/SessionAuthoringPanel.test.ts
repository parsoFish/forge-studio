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
 * description`, `authoring-hook-on`, `authoring-hook-matcher`) a round-1
 * body of this file once pinned as PRESENT are pinned ABSENT below. Those
 * fields were the divergence source correction A removes: hook metadata now
 * comes from the DRAFTED hook.yaml the operator already reviews in the
 * artifact pane, not from a parallel form the operator could fill in
 * differently — if the installed hook's `on`/`matcher` came from these
 * fields instead of the reviewed artifact, the reviewed artifact would not
 * be what ships. Only `authoring-id` (the library id — still an operator
 * decision the drafted package cannot make for itself, D4) and the
 * `finalize-authoring` action survive for a hook draft, exactly as they
 * already do for a skill draft.
 *
 * STATUS (R4-21 phase 2, T3 pin round 5, P9 correction): the panel HAS been
 * cut over — `SessionAuthoringPanel.tsx` renders `authoring-id` only for
 * both shapes and no `authoring-hook-*` field exists anywhere in the
 * component. Every test below is GREEN against the current implementation;
 * this file pins that as the standing regression contract, not a RED
 * expectation against an unmigrated panel (a prior header revision of this
 * file said otherwise — that was true only until the cutover landed, and is
 * corrected here since it now contradicts the code it sits beside).
 *
 * P8 (AMENDMENT ROUND 5): `canSave` in the component is `id.trim().length >
 * 0 && Boolean(project)` — a two-factor AND-gate — but every test above only
 * ever calls `render()`, which never passes `project` at all (it defaults to
 * `null`), so nothing here ever exercised the `project` half of that gate.
 * A first attempt at closing this gap tried `vi.spyOn(React, 'useState')` to
 * force the component's internal `id` state non-empty for one render pass
 * (so both AND-factors could be varied independently) — that throws
 * `TypeError: Cannot spy on export "useState". Module namespace is not
 * configurable in ESM` under this repo's real ESM/vitest setup (proven by
 * running it, not assumed); ESM module namespace objects are non-writable,
 * so a real `react` export cannot be monkey-patched here. `id` therefore
 * stays pinned at its mount-time `''` in every render this harness can
 * produce, which makes ONE direction of the AND-gate provable and the other
 * NOT:
 *
 *   - PROVABLE: "project present, id still empty ⇒ save disabled" — kills a
 *     mutant that drops the id half of the gate (e.g. `canSave =
 *     Boolean(project)`), since a broken implementation like that would
 *     render the button ENABLED here.
 *   - NOT provable by this harness: "id present, project missing ⇒ save
 *     disabled" (or its enabled-when-both-present flip side) — both need
 *     `id` to be non-empty, which requires either a real interaction
 *     harness (jsdom/`@testing-library/react`, a new-dependency decision —
 *     see `run-panel-render.test.ts`'s own header for this exact,
 *     previously-disclosed limitation) or a production-code change (an
 *     `initialId` prop) this test-writer pass may not make. Disclosed, not
 *     silently skipped.
 *
 * The two tests below therefore pin: (a) the explicit "project missing"
 * baseline with `project: null` passed by name rather than relying on an
 * implicit default (so the assertion survives if that default ever
 * changes), and (b) the one direction of the AND-gate this harness CAN
 * discriminate.
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

/** P8 helper — same render, but with an explicit `project` prop (every test
 *  above only ever calls `render()`, which never threads `project` through
 *  at all). `id` cannot be preset (see file header) so this only varies the
 *  `project` factor of `canSave`. */
function renderWithProject(sessionId: string, artifact: SessionArtifactPayload | null, project: string | null): string {
  return renderToStaticMarkup(React.createElement(SessionAuthoringPanel, { sessionId, artifact, project }));
}

function finalizeButtonTag(html: string): string {
  const idx = html.indexOf('data-action="finalize-authoring"');
  const start = html.lastIndexOf('<', idx);
  const end = html.indexOf('>', idx);
  return html.slice(start, end + 1);
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

// ===========================================================================
// P8 (T3 pin round 5) — the `project` half of canSave's AND-gate. Neither
// case below was exercised anywhere in this file before this pin: every
// prior test calls `render()`, which never passes `project` at all (it
// defaults to `null`), so a regression that dropped `&& Boolean(project)`
// from `canSave` entirely would have gone uncaught. See the file header for
// why only ONE direction of the two-factor gate is provable by this
// no-jsdom harness (id cannot be preset).
// ===========================================================================

test('canSave gate: project explicitly MISSING (project: null, not merely omitted) -> save stays disabled', () => {
  const html = renderWithProject('sid-1', filePackage([{ path: 'SKILL.md', body: '# x' }]), null);
  const tag = finalizeButtonTag(html);
  expect(tag).toContain('disabled=""');
});

test('canSave gate: project PRESENT but id still empty -> save stays disabled (project alone is not enough — kills a mutant like `canSave = Boolean(project)` that drops the id check)', () => {
  const html = renderWithProject('sid-1', filePackage([{ path: 'SKILL.md', body: '# x' }]), 'demoproj');
  const tag = finalizeButtonTag(html);
  expect(tag).toContain('disabled=""');
});

