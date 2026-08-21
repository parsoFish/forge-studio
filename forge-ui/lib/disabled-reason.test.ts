/**
 * W7-C3 review (A-M12) — the ONE derivation behind a disabled CTA's reason.
 *
 * RUN: cd forge-ui && npx vitest run lib/disabled-reason.test.ts
 */
import { test, expect } from 'vitest';
import { disabledAttrs } from './disabled-reason';

test('a reason disables the control AND says why, in both slots', () => {
  const attrs = disabledAttrs('Fill in the required fields first');
  expect(attrs.disabled).toBe(true);
  expect(attrs.title).toBe('Fill in the required fields first');
  expect(attrs['data-disabled-reason']).toBe('Fill in the required fields first');
});

test('no reason means enabled, with no stale reason left behind', () => {
  const attrs = disabledAttrs(null);
  expect(attrs.disabled).toBe(false);
  expect(attrs.title).toBeUndefined();
  expect(attrs['data-disabled-reason']).toBeUndefined();
});

test('a blank reason is NOT a reason — it would render an empty tooltip', () => {
  for (const blank of ['', '   ', undefined]) {
    expect(disabledAttrs(blank as string | undefined).disabled, `${JSON.stringify(blank)} must not disable`).toBe(false);
    expect(disabledAttrs(blank as string | undefined)['data-disabled-reason']).toBeUndefined();
  }
});

test('an enabled-state tooltip survives, and never competes with the reason', () => {
  expect(disabledAttrs(null, 'Dispatch this agent standalone').title).toBe('Dispatch this agent standalone');
  // While disabled, the reason takes the slot — a stale "you can do this"
  // tooltip on a dead button is the defect, not the fix.
  expect(disabledAttrs('Save the agent first', 'Dispatch this agent standalone').title).toBe('Save the agent first');
});
