/**
 * W7-A3 (flows-01 / flows-23 / projects-16) — DOM contract pins for the
 * SchedulerCard's pure presentational half, `SchedulerCardView`
 * (`components/SchedulerCard.tsx`), rendered via renderToStaticMarkup (the
 * `./home-sessions-strip-render.test.ts` precedent).
 *
 * Kills: a card that renders a Start button while running (or Pause while
 * stopped); an unknown/unread status that offers controls; a card that hides
 * the action error; a card that lies about readiness.
 *
 * RUN: npx vitest run lib/scheduler-card-render.test.ts   (from forge-ui/)
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SchedulerCardView } from '@/components/SchedulerCard';
import type { SchedulerStatus } from './bridge-client.ts';

function render(props: Partial<React.ComponentProps<typeof SchedulerCardView>> & { status: SchedulerStatus | null; ready: boolean }): string {
  return renderToStaticMarkup(React.createElement(SchedulerCardView, props));
}

function actions(html: string): string[] {
  return [...html.matchAll(/data-action="(scheduler-[a-z]+)"/g)].map((m) => m[1]);
}

test('not ready → status unknown, honest reading text, NO buttons', () => {
  const html = render({ status: null, ready: false });
  expect(html).toContain('data-component="scheduler-card"');
  expect(html).toContain('data-scheduler-status="unknown"');
  expect(html).toContain('data-scheduler-ready="false"');
  expect(html).toContain('Reading scheduler status…');
  expect(actions(html)).toEqual([]);
});

test('ready + null status → unknown with the honest hint and still no controls (fail-closed)', () => {
  const html = render({ status: null, ready: true });
  expect(html).toContain('data-scheduler-status="unknown"');
  expect(html).toContain('data-scheduler-ready="true"');
  expect(html).toContain('Could not read the scheduler from the bridge.');
  expect(actions(html)).toEqual([]);
});

test('stopped → Start only, queued count surfaced, hint says queued runs will NOT start', () => {
  const html = render({ status: { running: false }, ready: true, queuedCount: 2 });
  expect(html).toContain('data-scheduler-status="stopped"');
  expect(html).toContain('data-scheduler-queued="2"');
  expect(html).toContain('Scheduler stopped');
  expect(html).toContain('2 queued runs will not start until the scheduler runs.');
  expect(actions(html)).toEqual(['scheduler-start']);
  expect(html).not.toContain('data-scheduler-pid=');
});

test('running → Pause + Stop, pid surfaced, never a Start button', () => {
  const html = render({ status: { running: true, pid: 4917, paused: false }, ready: true });
  expect(html).toContain('data-scheduler-status="running"');
  expect(html).toContain('data-scheduler-pid="4917"');
  expect(actions(html)).toEqual(['scheduler-pause', 'scheduler-stop']);
  expect(html).not.toContain('scheduler-start');
});

test('paused → Resume + Stop', () => {
  const html = render({ status: { running: true, pid: 1, paused: true }, ready: true });
  expect(html).toContain('data-scheduler-status="paused"');
  expect(actions(html)).toEqual(['scheduler-resume', 'scheduler-stop']);
});

test('busy → every button disabled + data-scheduler-busy="true"; error → [data-scheduler-error] verbatim', () => {
  const html = render({ status: { running: false }, ready: true, busy: true, error: 'spawn failed: EACCES' });
  expect(html).toContain('data-scheduler-busy="true"');
  expect(html).toMatch(/<button[^>]*data-action="scheduler-start"[^>]*disabled/);
  expect(html).toContain('data-scheduler-error');
  expect(html).toContain('spawn failed: EACCES');
});

test('variant is mirrored to the DOM (card by default, strip on request)', () => {
  expect(render({ status: { running: false }, ready: true })).toContain('data-scheduler-variant="card"');
  expect(render({ status: { running: false }, ready: true, variant: 'strip' })).toContain('data-scheduler-variant="strip"');
});
