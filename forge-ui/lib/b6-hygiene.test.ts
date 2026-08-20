/**
 * W7-B6 WI-6 — project-page hygiene pins
 * (projects-07/-09/-25, crosscut-25 greenfield hint).
 *
 * Killed implementations:
 *  - an onboarding launch button whose `disabled` only covers the dispatch
 *    round-trip (two concurrent onboarding agents at one project);
 *  - a skill-chip remove control that is a bare click-only <span>;
 *  - a projects index whose greenfield entry exists only in the EMPTY state.
 *
 * RUN: npx vitest run lib/b6-hygiene.test.ts   (from forge-ui/)
 */
import { test, expect, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// StudioNav calls usePathname() (next/navigation) — null under
// renderToStaticMarkup; same mock precedent as projects-index-render.test.ts.
vi.mock('next/navigation', () => ({
  usePathname: () => '/projects',
}));

import { onboardLaunchState } from '../components/studio/project-builder/OnboardWithAgent';
import { SkillsBind } from '../components/studio/project-builder/SkillsBind';
import { ProjectsIndexBody } from '../components/studio/ProjectsIndex';
import type { Project } from './studio-client';

test('onboardLaunchState (projects-25): a LIVE run disables the launch with a stated reason; idle enables; dispatch round-trip disables without one', () => {
  expect(onboardLaunchState(false, 'running')).toEqual({
    disabled: true,
    label: 'Onboarding running…',
    reason: 'an onboarding run is already in flight for this project',
  });
  expect(onboardLaunchState(false, 'idle')).toEqual({ disabled: false, label: 'Run onboarding agent', reason: null });
  expect(onboardLaunchState(true, 'idle').disabled).toBe(true);
  // Terminal states re-enable — a finished run must not lock the button forever.
  expect(onboardLaunchState(false, 'complete').disabled).toBe(false);
});

test('SkillsBind (projects-07): the chip remove control is a real BUTTON with an aria-label naming the skill', () => {
  const html = renderToStaticMarkup(
    React.createElement(SkillsBind, {
      skills: ['git-log-analysis'],
      onChange: () => {},
      catalog: [{ id: 'git-log-analysis', name: 'Git log analysis' }],
    }),
  );
  const removeControl = html.match(/<button[^>]*aria-label="Remove skill Git log analysis"[^>]*>/)?.[0];
  expect(removeControl, 'the × must be a <button aria-label="Remove skill …">, not a bare span').toBeTruthy();
  expect(html).not.toMatch(/<span[^>]*class="x"/);
});

test('ProjectsIndexBody (projects-09): BOTH entry CTAs render in the header with a populated roster, not only in the empty state', () => {
  const projects = [{ id: 'p1', name: 'P one' }] as Project[];
  const html = renderToStaticMarkup(
    React.createElement(ProjectsIndexBody, { projects, kbs: [], ready: true }),
  );
  expect(html).toContain('data-action="onboard-project-cta"');
  expect(html).toContain('data-action="create-project-cta"');
  expect(html).toContain('Start a greenfield project');
});
