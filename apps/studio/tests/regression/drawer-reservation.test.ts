/**
 * Bead `forge-8vfn.7.6.6` — the activity drawer must never sit over the
 * interactive panel's controls.
 *
 * MEASURED, not theorised. M6-D's S4 run 2, beat 12, Playwright verbatim:
 * the button was "visible, enabled and stable", it scrolled it into view, it
 * finished scrolling — and then
 *   `<span>{"done":false,"questions":[{"question":"I checked…</span>` from
 *   `<div data-drawer-open="true" data-activity-count="18"
 *    data-component="activity-drawer">` subtree intercepts pointer events
 * A human at that screen clicks Submit and nothing happens.
 *
 * WHY THE EXISTING FIX DID NOT COVER IT. `ActivityLog` has reserved its own
 * height on `document.body.style.paddingBottom` since wave-6, when the same
 * class made the agent builder's Save button unclickable. That reservation
 * extends the DOCUMENT, so nothing is permanently unreachable BELOW the
 * drawer — and it says nothing about where a MINIMAL scroll parks an element
 * mid-document. `scrollIntoViewIfNeeded` moves an element just far enough to
 * be inside the viewport, which is exactly the drawer's band. Padding cannot
 * fix that; `scroll-margin-bottom` is the property that can, and it needs the
 * drawer's measured height to be readable from CSS.
 *
 * So the drawer publishes ONE measurement to TWO consumers, and this file
 * pins that they cannot disagree — the "two notions of one thing" class this
 * campaign keeps paying for.
 *
 * RUN: npx vitest run tests/regression/drawer-reservation.test.ts (from apps/studio/)
 */
import { test, expect } from 'vitest';

import { DRAWER_HEIGHT_VAR, reserveDrawerSpace, type ReservationTarget } from '../../lib/drawer-reservation';

function stubDoc(): ReservationTarget & { readonly props: Map<string, string> } {
  const props = new Map<string, string>();
  return {
    props,
    body: { style: { paddingBottom: '' } },
    documentElement: { style: { setProperty: (k: string, v: string) => { props.set(k, v); } } },
  };
}

test('one measurement drives BOTH consumers — the reserved padding and the CSS variable cannot disagree', () => {
  const doc = stubDoc();
  reserveDrawerSpace(268, doc);
  expect(doc.body.style.paddingBottom).toBe('268px');
  expect(doc.props.get(DRAWER_HEIGHT_VAR)).toBe('268px');
});

test('a collapsed drawer still writes both — a skipped write leaves a stale reservation, which is worse than none', () => {
  const doc = stubDoc();
  reserveDrawerSpace(268, doc);
  reserveDrawerSpace(0, doc);
  expect(doc.body.style.paddingBottom).toBe('0px');
  expect(doc.props.get(DRAWER_HEIGHT_VAR)).toBe('0px');
});

test('the variable name is exported, so no consumer can spell it its own way', () => {
  // The drift this kills: a component writing `var(--activity-drawer-height)`
  // against a drawer publishing `--activity-drawer-h` fails silently — the
  // fallback applies and the control goes right back under the drawer.
  expect(DRAWER_HEIGHT_VAR).toMatch(/^--[a-z-]+$/);
});

test('a non-finite measurement is REFUSED, not written — NaN px is a reservation that silently does nothing', () => {
  const doc = stubDoc();
  reserveDrawerSpace(268, doc);
  reserveDrawerSpace(Number.NaN, doc);
  expect(doc.body.style.paddingBottom).toBe('268px');
  expect(doc.props.get(DRAWER_HEIGHT_VAR)).toBe('268px');
});
