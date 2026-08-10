/**
 * DOM regression tests for `AuthoringLauncher.tsx` (R4-21 T3, BLOCKER-2 fix
 * — the entry point into the creation-agent authoring session, rendered from
 * `/skills/new` and `/hooks/new`).
 *
 * Mirrors `forge-ui/lib/run-panel-render.test.ts`'s own pattern: renders the
 * REAL component via `react-dom/server`'s `renderToStaticMarkup` and asserts
 * on the resulting markup string — no jsdom, no `@testing-library/react`
 * (neither is installed). `useState`/click-handler interaction does not run
 * under `renderToStaticMarkup`; this file pins the INITIAL-render DOM
 * contract only (the `data-*` hooks scripts/journeys/*.mjs will drive).
 *
 * RUN: npx vitest run components/AuthoringLauncher.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AuthoringLauncher } from './AuthoringLauncher';

type Props = {
  knownProjects?: string[];
  onStarted?: (sessionId: string, project: string) => void;
};

function render(props: Props = {}): string {
  return renderToStaticMarkup(React.createElement(AuthoringLauncher, props));
}

test('initial render carries the launcher section + all its field/action data-* hooks', () => {
  const html = render();
  expect(html).toContain('data-section="authoring-launcher"');
  expect(html).toContain('data-authoring-launcher-ready="false"'); // nothing typed yet
  expect(html).toContain('data-field="authoring-launcher-project"');
  expect(html).toContain('data-field="authoring-launcher-prompt"');
  expect(html).toContain('data-action="start-authoring"');
});

test('the submit button is disabled (canSubmit=false) before any field is filled in', () => {
  const html = render();
  const idx = html.indexOf('data-action="start-authoring"');
  const start = html.lastIndexOf('<', idx);
  const end = html.indexOf('>', idx);
  const tag = html.slice(start, end + 1);
  expect(tag).toContain('disabled=""');
});

test('known projects render as <option> entries in the project datalist', () => {
  const html = render({ knownProjects: ['gitpulse', 'mdtoc'] });
  expect(html).toContain('id="forge-authoring-known-projects"');
  expect(html).toContain('value="gitpulse"');
  expect(html).toContain('value="mdtoc"');
});

test('copy is honest about the project field being scratch space, not ownership — "not what this belongs to"', () => {
  const html = render();
  expect(html).toContain('not what this belongs to');
});

test('no error banner renders on initial mount (nothing submitted yet)', () => {
  const html = render();
  expect(html).not.toContain('data-authoring-launcher-error');
});
