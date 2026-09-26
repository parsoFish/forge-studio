/**
 * beats-page-read.test.ts — `resolveExpectations`'s together-rule, on its own.
 *
 * forge-8vfn.16, PR-B item 5. `resolveExpectations` got the together-rule in
 * `3ae38df5` (`beats.test.ts`'s `liveProjectsIndex` fixture pins the shape
 * against `beatVerdict`, one layer up), but nothing pins the function ITSELF
 * against DOM order — the together-rule's exact-match branch iterates
 * `records` and returns the first that satisfies every shared key, and a
 * reader could regress that into a first-match-wins or highest-index-wins rule
 * without either of `beatVerdict`'s existing fixtures noticing, because both
 * of those pin the FIRST record as the answer.
 *
 * So this beat's shape is the gitweave/mdtoc pair with the WANTED record
 * SECOND: two `[data-card-id]` records, `card-id: gitweave, health: stale`
 * first and `card-id: mdtoc, health: healthy` second, expecting
 * `{ 'card-id': 'mdtoc', health: 'healthy' }` — which only the second record
 * answers. `card-id` and `health` are each carried by two nested records, so
 * both stay under the together-rule (`beats-page-read.mjs`'s "bounded by
 * SOURCE COUNT" rule) rather than being read solo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveExpectations } from './beats-page-read.mjs';

test('the together-rule resolves the SECOND record when it is the one that matches, not the first', () => {
  const expected = { 'card-id': 'mdtoc', health: 'healthy' };
  const observed = {
    data: {},
    nested: [
      { 'card-id': 'gitweave', health: 'stale' },
      { 'card-id': 'mdtoc', health: 'healthy' },
    ],
  };
  const seen = resolveExpectations(expected, observed);
  assert.deepEqual(
    { 'card-id': seen['card-id'], health: seen.health },
    { 'card-id': 'mdtoc', health: 'healthy' },
  );
});

// ── ROW 113b (T1 1562): CO-OCCURRENCE GROUPS.
//
// The together-rule above is right for keys that name the SAME entity — but
// `resolveExpectations` judged EVERY shared key against ONE best record,
// which is too wide when a beat mixes keys from two entities that never share
// a carrying element. `section` is carried by several panels (including
// `ReviewFindingsPanel`, which renders `data-section="review-findings"` even
// in its absent state) — an entity wholly independent of the timeline rows
// that carry `timeline-row`/`node-id`/`status`. No timeline row carries
// `section`, so the single best-covering record was always a row, and
// `section` was reported "absent from the page" though the page rendered it.
//
// The fix partitions `shared` into co-occurrence groups — two keys share a
// group iff some record carries both, transitively — and applies the
// together-rule to each group independently. Keys that never co-occur can
// never name a competing entity for each other, so separating them cannot
// reopen the gitweave/mdtoc false-green; keys that DO co-occur stay together.

test('a `section` key naming an INDEPENDENT panel is not dropped by a best-record chosen for unrelated timeline-row keys', () => {
  // T1's exact reproduction shape: S10 beat 13 mixes timeline-row identity
  // keys with a `section` key belonging to a sibling panel. Before the fix,
  // the single best-covering record was a timeline row (it scores highest on
  // the majority of `shared` keys), and `section` — which no row carries —
  // was silently dropped from the winning record.
  const expected = {
    'timeline-row': 'true',
    'node-id': 'integrate',
    status: 'complete',
    section: 'review-findings',
  };
  const observed = {
    data: { page: 'flow-run' },
    nested: [
      { 'timeline-row': 'true', 'node-id': 'dev', status: 'complete' },
      { 'timeline-row': 'true', 'node-id': 'integrate', status: 'complete' },
      { 'timeline-row': 'true', 'node-id': 'adversarial-review', status: 'pending' },
      { section: 'run-trigger', 'trigger-kind': 'manual' },
      { section: 'review-findings', 'findings-state': 'absent' },
    ],
  };
  const seen = resolveExpectations(expected, observed);
  assert.deepEqual(
    {
      'timeline-row': seen['timeline-row'],
      'node-id': seen['node-id'],
      status: seen.status,
      section: seen.section,
    },
    { 'timeline-row': 'true', 'node-id': 'integrate', status: 'complete', section: 'review-findings' },
  );
});

test('the together-rule is NOT weakened: keys that co-occur on every record stay judged as ONE card', () => {
  // `card-id` and `health` co-occur on both cards, so they stay in the same
  // group — mixing gitweave's id with mdtoc's health must still be refused.
  const expected = { 'card-id': 'gitweave', health: 'attention' };
  const observed = {
    data: {},
    nested: [
      { 'card-id': 'gitweave', health: 'healthy' },
      { 'card-id': 'mdtoc', health: 'attention' },
    ],
  };
  const seen = resolveExpectations(expected, observed);
  // Neither card answers both keys, so the best-covering single card wins —
  // NOT an assembly of gitweave's id with mdtoc's (matching) health.
  assert.ok(
    (seen['card-id'] === 'gitweave' && seen.health === 'healthy')
      || (seen['card-id'] === 'mdtoc' && seen.health === 'attention'),
    JSON.stringify(seen),
  );
});

test('keys that co-occur only TRANSITIVELY (A+B on one record, B+C on another) stay one group', () => {
  // Neither A nor C ever shares a record with the other directly, but both
  // share one with B, so all three must be judged together — a record
  // answering A and B but not C should NOT win over one further away on A/B
  // but consistent on all three once the group is resolved as a whole.
  const expected = { a: 'wanted-a', b: 'wanted-b', c: 'wanted-c' };
  const observed = {
    data: {},
    nested: [
      { a: 'wanted-a', b: 'other-b' },
      { b: 'wanted-b', c: 'wanted-c' },
      { a: 'wanted-a', b: 'wanted-b', c: 'wanted-c' },
    ],
  };
  const seen = resolveExpectations(expected, observed);
  // The third record is the only one answering all three keys of the single
  // merged {a,b,c} group, so it must win outright.
  assert.deepEqual(
    { a: seen.a, b: seen.b, c: seen.c },
    { a: 'wanted-a', b: 'wanted-b', c: 'wanted-c' },
  );
});
