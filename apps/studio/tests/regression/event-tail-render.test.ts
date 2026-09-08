/**
 * W7-FIX-A3 (A3-09) — DOM contract pin for the flow monitor's `EventTail`
 * (`components/studio/EventTail.tsx`), rendered via renderToStaticMarkup.
 *
 * `[data-tail-state="live|finished|failed|queued|none"]` is documented as the
 * event tail's status-keyed empty copy, but the attribute used to live on the
 * per-run count span that renders ONLY when a run is selected — so the
 * documented `none` value was unreachable. The attribute now sits on the tail
 * CONTAINER (`[data-component="event-tail"]`) in every state.
 *
 * RUN: npx vitest run lib/event-tail-render.test.ts   (from forge-ui/)
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { EventTail } from '@/components/studio/EventTail';

function render(props: React.ComponentProps<typeof EventTail>): string {
  return renderToStaticMarkup(React.createElement(EventTail, props));
}

test('no active run → the container carries data-tail-state="none" and the honest empty copy', () => {
  const html = render({ events: [], activeRunId: null, runStatus: null });
  expect(html).toMatch(/<div[^>]*data-component="event-tail"[^>]*data-tail-state="none"/);
  expect(html).toContain('No active run selected.');
  expect(html).not.toContain('Waiting for events…');
});

test('the container mirrors every run-keyed state (finished/failed/queued/live) — one element, every state', () => {
  const cases: Array<[Parameters<typeof render>[0]['runStatus'], string, string]> = [
    ['complete', 'finished', 'This run finished — open a phase hex for its logs.'],
    ['failed', 'failed', 'This run failed — open a phase hex for its logs.'],
    ['planned', 'queued', 'Queued — no events until the scheduler claims it.'],
    ['active', 'live', 'Waiting for events…'],
  ];
  for (const [status, state, copy] of cases) {
    const html = render({ events: [], activeRunId: '2026-01-01T00-00-00_INIT-x', runStatus: status });
    expect(html).toMatch(new RegExp(`<div[^>]*data-component="event-tail"[^>]*data-tail-state="${state}"`));
    expect(html).toContain(copy);
    // Exactly one carrier of the attribute — the one-element DOM contract.
    expect(html.match(/data-tail-state=/g)?.length).toBe(1);
  }
});

// ---------------------------------------------------------------------------
// WI-1b (ON-7) — GAP 2: the header's `.status-dot` `data-status` used to be
// computed from a SECOND, independent read of `activeRunId`/`events.length`
// (never from `tailState`, despite `tailState` already carrying the real run
// outcome) — so a FAILED run's dot rendered identically to a live one with
// no events yet ("pending") or with events ("active"): the colour cue the
// operator actually scans never turned red on failure. Fixed: `dotStatus` is
// now DERIVED from `tailState` alone — one source, not two that can
// disagree.
// ---------------------------------------------------------------------------

test('WI-1b: the status-dot data-status is derived from data-tail-state — every TailState maps to a real token from the shared 5-value vocabulary (pending|active|complete|retrying|failed), and a FAILED run turns the dot "failed" (previously stuck at "active"/"pending" regardless of the failure — the exact ON-7 gap)', () => {
  const cases: Array<{ activeRunId: string | null; runStatus: Parameters<typeof render>[0]['runStatus']; tailState: string; dotToken: string }> = [
    { activeRunId: null, runStatus: null, tailState: 'none', dotToken: 'pending' },
    { activeRunId: 'r1', runStatus: 'active', tailState: 'live', dotToken: 'active' },
    { activeRunId: 'r1', runStatus: 'complete', tailState: 'finished', dotToken: 'complete' },
    { activeRunId: 'r1', runStatus: 'failed', tailState: 'failed', dotToken: 'failed' },
    { activeRunId: 'r1', runStatus: 'planned', tailState: 'queued', dotToken: 'pending' },
  ];
  for (const { activeRunId, runStatus, tailState, dotToken } of cases) {
    const html = render({ events: [], activeRunId, runStatus });
    expect(html, `tailState=${tailState}`).toContain(`data-tail-state="${tailState}"`);
    expect(html, `tailState=${tailState} -> expected dot token "${dotToken}"`).toContain(`data-status="${dotToken}"`);
  }
});

test('WI-1b: a FAILED run\'s dot reads "failed" regardless of whether any events already arrived (kills a fix that special-cases only the events.length===0 branch and leaves a failed-with-events tail still "active")', () => {
  const events = [{ event_id: 'e1', initiative_id: 'x', started_at: '2026-01-01T00:00:00.000Z', phase: 'dev', skill: 'developer-loop', event_type: 'progress', message: 'hi' }];
  const html = render({ events, activeRunId: '2026-01-01T00-00-00_INIT-x', runStatus: 'failed' });
  expect(html).toContain('data-status="failed"');
  expect(html).not.toContain('data-status="active"');
});

test('WI-1b: a LIVE run with events already flowing still shows the pre-existing "active" dot token — the fix does not regress the healthy case', () => {
  const events = [{ event_id: 'e1', initiative_id: 'x', started_at: '2026-01-01T00:00:00.000Z', phase: 'dev', skill: 'developer-loop', event_type: 'progress', message: 'hi' }];
  const html = render({ events, activeRunId: '2026-01-01T00-00-00_INIT-x', runStatus: 'active' });
  expect(html).toContain('data-status="active"');
});
