/**
 * forge-8vfn.6.11.48 — the session page's `[data-action="open-plan"]` link
 * must not freeze the plan's mode from one poll.
 *
 * The session page runs two independent 3 s polls: the SHELL poll stamps
 * `data-session-phase` on the page, and the SUMMARY poll feeds this panel.
 * The link used to bake `mode=view` into its href whenever the summary it
 * rendered from was not yet `awaiting-verdict` — so an operator (or a story)
 * who saw the shell say `awaiting-verdict` and pressed the link inside the
 * summary poll's lag landed on a read-only plan with no Approve. Measured on
 * S1: PLAN.md written 03:46:13, open-plan pressed 03:46:15, mode `view`.
 *
 * The artifact page already arms the plan gate from the LIVE session phase
 * when no mode is requested (`resolveArtifactMode`'s architect branch); an
 * explicit `mode=view` deliberately wins over that (artifact-plan-43). So
 * the only correct href for this link is one that asks for no mode.
 *
 * Kills: a panel href that carries `mode=view` (or `mode=gate`) derived from
 * the panel's own render-time phase.
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SessionArchitectPanel } from '../../components/studio/session/SessionArchitectPanel';
import { resolveArtifactMode } from '../../lib/artifact-mode';
import type { ArchitectSessionSummary } from '../../lib/bridge-client';

function session(phase: ArchitectSessionSummary['phase']): ArchitectSessionSummary {
  return {
    sessionId: '2026-09-07T03-40-00-6a1b2c3d',
    project: 'gitweave',
    projectRepoPath: '/x/gitweave',
    phase,
    round: 2,
    idea: 'overlay team grant lint',
    questions: null,
    planUrl: '/api/architect/file/gitweave/2026-09-07T03-40-00-6a1b2c3d/PLAN.html',
    completenessCritic: null,
    initiativeIds: [],
  };
}

function openPlanHref(phase: ArchitectSessionSummary['phase']): URL {
  const html = renderToStaticMarkup(
    React.createElement(SessionArchitectPanel, { session: session(phase), events: [], nowMs: 0 }),
  );
  const anchors = [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]).filter((a) => a.includes('data-action="open-plan"'));
  expect(anchors, `exactly one open-plan link at ${phase}`).toHaveLength(1);
  const href = /href="([^"]*)"/.exec(anchors[0])?.[1];
  expect(href, 'the open-plan link carries an href').toBeTruthy();
  return new URL(href!.replace(/&amp;/g, '&'), 'http://studio.local');
}

test('a link rendered from a phase BEFORE awaiting-verdict still opens the gate once the live session is armed', () => {
  for (const stale of ['drafting', 'exploring', 'interviewing'] as const) {
    const url = openPlanHref(stale);
    const mode = resolveArtifactMode(url.searchParams.get('mode'), 'plan', null, { architect: true, architectArmed: true });
    expect(mode, `rendered at ${stale}, pressed after the session armed`).toBe('gate');
  }
});

test('the same link opens read-only while the live session is NOT armed — the gate is armed by phase, never by the URL', () => {
  for (const phase of ['awaiting-verdict', 'committed', 'rejected', 'drafting'] as const) {
    const url = openPlanHref(phase);
    const mode = resolveArtifactMode(url.searchParams.get('mode'), 'plan', null, { architect: true, architectArmed: false });
    expect(mode, `rendered at ${phase}, session not armed`).toBe('view');
  }
});

test('the href names the session plan and requests no mode of its own', () => {
  const url = openPlanHref('awaiting-verdict');
  expect(url.pathname).toBe('/artifact');
  expect(url.searchParams.get('run')).toBe('_architect-2026-09-07T03-40-00-6a1b2c3d');
  expect(url.searchParams.get('type')).toBe('plan');
  expect(url.searchParams.has('mode')).toBe(false);
});
