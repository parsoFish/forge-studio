/**
 * W8-A3 — `RepointGate`, the structural cure for the defect adversarial review
 * found FOUR times on four different controls across three fix rounds:
 *
 *   a control that raises a repoint confirmation stays live beside it and
 *   re-posts the identical unconfirmed request, forever.
 *
 * Each round fixed the call sites the review named and left the others, because
 * "remember to suppress the button" is a rule a person applies N times and
 * forgets on N+1. The gate makes it impossible: the originating control is
 * `children`, and `children` cannot render while `pending` is set. This file is
 * the one test that has to hold for all nine controls, instead of nine tests
 * that each have to be remembered.
 *
 * It also pins the display/payload identity: `onConfirm` receives the SAME flow
 * string the bar displays, so no surface can show one flow and confirm another
 * (the confirmation is a compare-and-swap — see `orchestrator/enqueue-flow-run.ts`).
 */
import { test, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { RepointGate } from '../components/studio/RepointGate.tsx';

function markup(props: Record<string, unknown>): string {
  return renderToStaticMarkup(
    React.createElement(
      RepointGate as never,
      { initiativeId: 'INIT-2026-08-18-alpha', verb: 'Plan', onConfirm: () => {}, onCancel: () => {}, ...props } as never,
      React.createElement('button', { 'data-action': 'the-originating-control' }, 'Plan →') as never,
    ),
  );
}

test('nothing pending: the control renders and no confirmation does', () => {
  const html = markup({ pending: null });
  expect(html).toContain('data-action="the-originating-control"');
  expect(html).not.toContain('data-component="repoint-confirm"');
});

test('pending: the confirmation renders and the control CANNOT — this is the whole point of the component', () => {
  // KILLS: every version of "render the bar next to the button", which is what
  // shipped on four separate controls and re-posted unconfirmed on the second
  // click each time.
  const html = markup({ pending: { currentFlowId: 'my-authored-flow', targetFlowId: 'forge-develop' } });
  expect(html).toContain('data-component="repoint-confirm"');
  expect(html, 'the control that raised the confirmation must not be clickable beside it')
    .not.toContain('data-action="the-originating-control"');
});

test('the bar carries the flow of origin the caller was given, verbatim', () => {
  const html = markup({ pending: { currentFlowId: 'my-authored-flow', targetFlowId: 'forge-develop' } });
  expect(html).toContain('data-current-flow="my-authored-flow"');
  expect(html).toContain('data-target-flow="forge-develop"');
  expect(html).toContain('my-authored-flow');
});

test('the gate is the ONLY thing that can reach onConfirm, so display and payload cannot diverge', () => {
  // `confirmRepointFrom` is a compare-and-swap, so a surface that displays one
  // flow and confirms another produces either a refusal the operator cannot
  // satisfy or a move off a flow they were never shown. The gate closes that by
  // construction rather than by assertion: `onConfirm` is invoked in exactly one
  // place, with `pending.currentFlowId` — the same expression the bar displays —
  // and callers hand the gate a `(fromFlowId) => …` callback rather than
  // supplying the value themselves.
  //
  // Click simulation is out of reach in this harness (jsdom and
  // testing-library are not installed, and this file deliberately does not add
  // them), so what is asserted here is the OBSERVABLE half: the bar's rendered
  // flow of origin is the one the caller passed, on both attributes and in the
  // visible copy. The wiring to the click is covered per-route over the wire —
  // `apps/forge/ui-bridge-flow-run-repoint.test.ts` pins that the WRONG flow string is
  // refused, which is what a divergence would produce.
  const html = markup({ pending: { currentFlowId: 'retro-flow', targetFlowId: 'forge-develop' } });
  expect(html).toContain('data-current-flow="retro-flow"');
  expect(html).toContain('retro-flow');
  expect(html).not.toContain('my-authored-flow');
});
