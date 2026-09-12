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

test('the SERVED reason wins over the in-session one — it is what survives a reload', () => {
  // S8 run 5's defect, pinned from the other side: the in-session outcomes die
  // with the page, so a chip that preferred them would go quiet on reload while
  // every other attribute on it survived.
  const inSession = [{ hubId: 'skills-sh', discovered: 0, reason: 'stale-in-session' }];
  expect(hubReason(inSession, 'skills-sh', 'not-reachable')).toBe('not-reachable');
  expect(declaredOnlyLabel(inSession, 'skills-sh', 'not-reachable')).toBe('declared — nothing indexed (fetch: not-reachable)');
});

test('with nothing served, the in-session reason still explains a refresh immediately', () => {
  // The fallback earns its place: after pressing refresh, before any reload,
  // the page can say why without waiting for a round trip.
  expect(hubReason([{ hubId: 'skills-sh', discovered: 0, reason: 'not-reachable' }], 'skills-sh', undefined)).toBe('not-reachable');
});

test('a served empty string is not a reason', () => {
  // A server that sends "" is saying nothing, and "" must not render as
  // "(fetch: )" — the absent case and the empty case mean the same thing.
  expect(hubReason([], 'skills-sh', '')).toBeNull();
  expect(declaredOnlyLabel([], 'skills-sh', '')).toBe('declared — nothing indexed');
});

// ---------------------------------------------------------------- 7.6.91
test('no-installable-kind does NOT borrow the fetch wording, and names the kinds', () => {
  // A hub forge READ PERFECTLY and that publishes nothing this installer accepts
  // is not a fetch failure. "(fetch: no-installable-kind)" would be true about
  // the token and false about the world, which is the paraphrase the DOM
  // contract forbids — and the operator would go looking for a network problem.
  const outcomes = [{ hubId: 'cc-templates', discovered: 0, reason: 'no-installable-kind' }];
  expect(declaredOnlyLabel(outcomes, 'cc-templates', 'no-installable-kind', 'hooks'))
    .toBe('declared — nothing forge can install (publishes: hooks)');
  // The ATTRIBUTE stays the bare token like its three siblings (T1 973), so the
  // story beat asserts a token rather than a sentence that moves with the yaml.
  expect(hubReason(outcomes, 'cc-templates', 'no-installable-kind')).toBe('no-installable-kind');
});

test('no-installable-kind without kinds still refuses the fetch wording', () => {
  // The kinds come from the live hub declaration, so they can be absent for a
  // caller that has the reason and not the hub. The label degrades to the true
  // half rather than to the false one.
  expect(declaredOnlyLabel([], 'cc-templates', 'no-installable-kind'))
    .toBe('declared — nothing forge can install');
});

test('the other three reasons keep the fetch wording', () => {
  // The negative that stops the new branch swallowing its siblings.
  for (const r of ['not-reachable', 'fetch-failed', 'tree-truncated']) {
    expect(declaredOnlyLabel([], 'h', r, 'skills')).toBe(`declared — nothing indexed (fetch: ${r})`);
  }
});
