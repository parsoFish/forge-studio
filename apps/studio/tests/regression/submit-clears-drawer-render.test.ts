/**
 * Bead `forge-8vfn.7.6.6` — every control an operator must reach while a
 * session is WORKING carries `scroll-margin-bottom` bound to the activity
 * drawer's published height.
 *
 * The drawer is open by design while a session works
 * (`docs/reference/studio-dom-contract.md`: "renders in EVERY phase once
 * events exist — open while working, collapsed otherwise"). An architect
 * interview is a phase that is working AND waiting on the operator, so the
 * two overlap by design and the control must scroll clear of the drawer
 * rather than into it.
 *
 * This pins the CONSUMER half. `drawer-reservation.test.ts` pins the
 * publisher half, and both name the variable through the same exported
 * constant so a typo cannot make the binding silently fall back.
 *
 * RUN: npx vitest run tests/regression/submit-clears-drawer-render.test.ts (from apps/studio/)
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { DRAWER_HEIGHT_VAR } from '../../lib/drawer-reservation';
import { ArchitectQuestionForm } from '../../components/ArchitectQuestionForm';

/** What CSS must see. A control that scrolls only to the viewport edge lands
 *  inside a `position: fixed; bottom: 0` drawer; this is the margin that
 *  keeps the drawer's own height out of the way. */
const EXPECTED = `scroll-margin-bottom:var(${DRAWER_HEIGHT_VAR},0px)`;

function normalise(html: string): string {
  return html.replace(/\s+/g, '');
}

test("the architect interview's Submit clears the drawer's band", () => {
  const html = renderToStaticMarkup(
    React.createElement(ArchitectQuestionForm, {
      questions: [{ question: 'Fix the bug as well, or tests only?' }],
      onSubmit: async () => {},
    } as never),
  );
  expect(html).toContain('data-action="submit-answers"');
  expect(normalise(html)).toContain(normalise(EXPECTED));
});
