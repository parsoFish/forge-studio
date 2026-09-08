/**
 * W7-A3 (projects-16/17/32, flows-02) — DOM contract pins for
 * `EnqueueOutcomeLineView` (`components/studio/EnqueueOutcomeLine.tsx`), the
 * honest post-enqueue line under Plan / Start development / Start Run.
 *
 * Kills: "Development started — the unifier will open a PR" while the daemon
 * is stopped; a "view run →" that links the flow index instead of the run the
 * enqueue returned; a stopped scheduler with no Start control in reach.
 *
 * RUN: npx vitest run lib/enqueue-outcome-render.test.ts   (from forge-ui/)
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { EnqueueOutcomeLineView } from '@/components/studio/EnqueueOutcomeLine';

const INIT = 'INIT-2026-08-18-add-version-flag';

function render(props: Partial<React.ComponentProps<typeof EnqueueOutcomeLineView>>): string {
  return renderToStaticMarkup(React.createElement(EnqueueOutcomeLineView, {
    kind: 'develop',
    runAction: 'open-develop-run',
    scheduler: { running: true },
    schedulerReady: true,
    ...props,
  }));
}

test('develop enqueue, scheduler running → develop-flow claim (no unifier), run link carries flow + the initiative (stable run handle)', () => {
  const html = render({ runId: INIT, flowId: 'forge-develop' });
  expect(html).toContain('data-component="enqueue-outcome"');
  expect(html).toContain('data-enqueue-kind="develop"');
  expect(html).toContain('Development enqueued — the develop flow will open a PR for review.');
  expect(html.toLowerCase()).not.toContain('unifier');
  expect(html).toMatch(new RegExp(`<a[^>]*data-action="open-develop-run"[^>]*href="/flows/forge-develop/run/${INIT}"`));
  expect(html).toContain('data-needs-scheduler-start="false"');
  expect(html).not.toContain('data-action="scheduler-start"');
});

test('plan enqueue, scheduler stopped → honest "nothing will run" + Start control right here + the run link kept', () => {
  const html = render({ kind: 'plan', runAction: 'open-plan-run', runId: 'c1', flowId: 'forge-architect', scheduler: { running: false } });
  expect(html).toContain('Enqueued — the scheduler is stopped, so nothing will run until you start it.');
  expect(html).toContain('data-needs-scheduler-start="true"');
  expect(html).toContain('data-action="scheduler-start"');
  expect(html).toMatch(/<a[^>]*data-action="open-plan-run"[^>]*href="\/flows\/forge-architect\/run\/c1"/);
});

test('scheduler not yet read → neither claim is asserted (reading…), no Start button', () => {
  const html = render({ scheduler: null, schedulerReady: false, runId: 'c1', flowId: 'forge-develop' });
  expect(html).toContain('Enqueued — reading the scheduler…');
  expect(html).not.toContain('data-action="scheduler-start"');
});

test('no cycle/flow in the result → no run link fabricated', () => {
  const html = render({});
  expect(html).not.toContain('data-action="open-develop-run"');
});
