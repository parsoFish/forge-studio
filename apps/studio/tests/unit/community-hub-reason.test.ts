/**
 * 7.6.84 PR C — an empty hub chip says WHY it is empty. T1 890(2)/893(2).
 *
 * A SEPARATE FILE on purpose. `community-view.test.ts` is baselined over the
 * 800-line cap, and a baseline is a CEILING, not a licence — adding these there
 * grew it 867 → 913 and `check-file-size` refused, correctly. A new concern
 * gets a new file rather than a bigger exemption.
 *
 * The concern: "declared — nothing indexed" is true of a source forge read and
 * found empty AND of one it could not read at all. Those are different facts
 * about an operator's registry — the second is forge's limit, not the source's.
 */
import { test, expect } from 'vitest';

import { hubReason, declaredOnlyLabel } from '../../lib/community-view.ts';

test('declaredOnlyLabel: a hub forge could not read says so, with the READER’S OWN reason', () => {
  const label = declaredOnlyLabel([{ hubId: 'skills-sh', discovered: 0, reason: 'blocked-origin' }], 'skills-sh');
  // The reason is the reader's token, not a paraphrase of it: a label that
  // re-words the decision drifts from what the code actually decided.
  expect(label).toBe('declared — nothing indexed (fetch: blocked-origin)');
});

test('declaredOnlyLabel: a hub that was READ and published nothing keeps the plain label', () => {
  // No reason means the reader reached it and it had nothing — the source's
  // own emptiness, which is not a failure and must not read as one.
  expect(declaredOnlyLabel([{ hubId: 'forge-seed', discovered: 0 }], 'forge-seed')).toBe('declared — nothing indexed');
});

test('declaredOnlyLabel: before any refresh has settled, the chip claims nothing about why', () => {
  // An outcome list is empty until a pass settles. Inventing a reason here —
  // or carrying the previous pass's — is the stale-view lie the refresh region
  // already refuses.
  expect(declaredOnlyLabel([], 'skills-sh')).toBe('declared — nothing indexed');
});

test('hubReason: only this hub’s outcome answers for this hub', () => {
  const outcomes = [
    { hubId: 'skills-sh', discovered: 0, reason: 'blocked-origin' },
    { hubId: 'cc-templates', discovered: 0, reason: 'not-reachable' },
    { hubId: 'mcp-registry', discovered: 206, partial: true },
  ];
  expect(hubReason(outcomes, 'skills-sh')).toBe('blocked-origin');
  expect(hubReason(outcomes, 'cc-templates')).toBe('not-reachable');
  // A hub that contributed rows has no reason to give, even when its read was
  // partial — `partial` is about how much was read, not about a failure.
  expect(hubReason(outcomes, 'mcp-registry')).toBeNull();
  expect(hubReason(outcomes, 'a-hub-not-in-this-pass')).toBeNull();
});
