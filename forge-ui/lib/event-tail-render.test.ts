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
