/**
 * W7-A3 (artifact-plan-03/04/09/10/21/27/33, sessions-kinds-14) — DOM contract
 * pins for `ArchitectPlanGate` (`components/studio/artifact/ArchitectPlanGate.tsx`),
 * the ONLY gate control set an architect plan renders on /artifact.
 *
 * Kills: an empty body for drafting/rejected/awaiting-answers sessions; a
 * fully-armed gate for a session that does not exist; the plan hidden off
 * awaiting-verdict; the send-back stranding (no link back to the questions);
 * a second Approve.
 *
 * RUN: npx vitest run lib/architect-plan-gate-render.test.ts   (from forge-ui/)
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ArchitectPlanGate } from '@/components/studio/artifact/ArchitectPlanGate';
import type { ArchitectSessionSummary } from './bridge-client.ts';

const SID = '2026-08-18T13-27-13-8ee491f5';

function session(phase: ArchitectSessionSummary['phase'], extra: Partial<ArchitectSessionSummary> = {}): ArchitectSessionSummary {
  return {
    sessionId: SID,
    project: 'demo-project',
    projectRepoPath: '/x/demo-project',
    phase,
    round: 2,
    idea: 'add a --version flag',
    questions: null,
    planUrl: `/api/architect/file/demo-project/${SID}/PLAN.html`,
    completenessCritic: null,
    initiativeIds: ['INIT-2026-08-18-add-version-flag'],
    ...extra,
  };
}

function render(props: Partial<React.ComponentProps<typeof ArchitectPlanGate>>): string {
  return renderToStaticMarkup(React.createElement(ArchitectPlanGate, {
    session: null,
    sessionId: SID,
    sessionResolved: true,
    linkage: [],
    linkageReady: true,
    scheduler: { running: false },
    schedulerReady: true,
    ...props,
  }));
}

test('unknown session (resolved, null) → honest not-found, NO gate, NO iframe, back link', () => {
  const html = render({ session: null, sessionResolved: true });
  expect(html).toContain('data-section="architect-plan"');
  expect(html).toContain('data-architect-phase="not-found"');
  expect(html).toContain('data-gate-armed="false"');
  expect(html).toContain('data-component="run-not-found"');
  expect(html).toContain('data-run-kind="architect-session"');
  expect(html).toContain(SID);
  expect(html).toMatch(/<a[^>]*data-action="back-to-sessions"[^>]*href="\/sessions"/);
  expect(html).not.toContain('data-action="approve-plan"');
  expect(html).not.toContain('data-plan-iframe');
});

test('session not resolved yet → loading only (not-found is never asserted before the fetch settles)', () => {
  const html = render({ session: null, sessionResolved: false });
  expect(html).not.toContain('data-component="run-not-found"');
  expect(html).not.toContain('data-action="approve-plan"');
  expect(html).toContain('Loading');
});

test('awaiting-verdict → the PlanGate (one Approve, send-back, reject) and the gate is armed', () => {
  const html = render({ session: session('awaiting-verdict') });
  expect(html).toContain('data-architect-phase="awaiting-verdict"');
  expect(html).toContain('data-gate-armed="true"');
  expect(html).toContain('data-section="plan-gate"');
  expect(html.match(/data-action="approve-plan"/g)?.length).toBe(1);
  expect(html).toContain('data-action="revise-plan"');
});

test('awaiting-answers → status + a link to the questions on the session page + the plan stays readable (artifact-plan-33)', () => {
  const html = render({ session: session('awaiting-answers') });
  expect(html).toContain('data-architect-phase="awaiting-answers"');
  expect(html).toContain('data-gate-armed="false"');
  expect(html).toContain('The architect is waiting for your answers.');
  expect(html).toMatch(new RegExp(`<a[^>]*data-action="answer-questions"[^>]*href="/sessions/architect/${SID}\\?project=demo-project"`));
  expect(html).toContain('data-plan-iframe');
  expect(html).toContain('data-plan-readonly="true"');
  expect(html).not.toContain('data-action="approve-plan"');
});

test('drafting → status copy + follow-the-architect link, no gate (artifact-plan-27)', () => {
  const html = render({ session: session('drafting') });
  expect(html).toContain('data-architect-phase="working"');
  expect(html).toContain('The architect is drafting the plan…');
  expect(html).toMatch(/<a[^>]*data-action="open-session"/);
  expect(html).not.toContain('data-action="approve-plan"');
});

test('rejected → says rejected, plan readable, no gate, no "building" claim', () => {
  const html = render({ session: session('rejected') });
  expect(html).toContain('data-architect-phase="rejected"');
  expect(html).toContain('This plan was rejected — it stays readable below.');
  expect(html).toContain('data-plan-readonly="true"');
  expect(html).not.toContain('data-action="approve-plan"');
  expect(html).not.toContain('the autonomous loop is building');
});

test('committed → the shared committed panel (linkage + scheduler), the plan still readable (artifact-plan-22)', () => {
  const html = render({
    session: session('committed'),
    linkage: [{ initiativeId: 'INIT-2026-08-18-add-version-flag', runId: 'INIT-2026-08-18-add-version-flag', flowId: 'forge-architect', runStatus: 'planned', queueState: 'queued', runHref: '/flows/forge-architect/run/INIT-2026-08-18-add-version-flag', monitorHref: '/flows/forge-architect' }],
    scheduler: { running: false },
  });
  expect(html).toContain('data-architect-phase="committed"');
  expect(html).toContain('data-section="architect-committed"');
  expect(html).toContain('data-initiative-id="INIT-2026-08-18-add-version-flag"');
  expect(html).toContain('data-action="scheduler-start"');
  expect(html).toContain('data-action="watch-it-build"');
  expect(html).toContain('data-plan-readonly="true"');
  expect(html).not.toContain('data-action="approve-plan"');
});

test('finalizing → the payoff shows (post-approve phase), never a re-armed gate (artifact-plan-10)', () => {
  const html = render({ session: session('finalizing') });
  expect(html).toContain('data-architect-phase="finalizing"');
  expect(html).toContain('data-section="architect-committed"');
  expect(html).not.toContain('data-action="approve-plan"');
});
