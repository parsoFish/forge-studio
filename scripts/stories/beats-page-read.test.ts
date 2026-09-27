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

import { resolveExpectations, answers } from './beats-page-read.mjs';

/** Mirrors `beatVerdict`'s own per-key check (`beats-page.mjs`) — the thing
 *  that actually decides pass/fail from `resolveExpectations`'s output. A
 *  test that only inspected `seen` and eyeballed it could miss a key
 *  `resolveExpectations` dropped; this is the same predicate the runner uses. */
function beatWouldPass(expected: Record<string, string>, seen: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([k, v]) => Object.hasOwn(seen, k) && answers(seen[k] as string, v));
}

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

// ── ROW 149 ROUND 2/3 (bead `forge-8vfn.8.1.40`, rulings 1771/1774/1794):
// S10's ACT 2 asserts a specific work item's hex status on the flow monitor,
// which lists BOTH the first and the second run it started. `data-run-id` is
// rendered on every rail card (`RunRail.tsx:232`) AND on the `RunControls`
// section for whichever run is currently SELECTED (`RunControls.tsx:191`) —
// so a bare `run-id` key is SHARED across all of them, and the together-rule
// is satisfied the moment ANY ONE record carries the wanted value. ACT 2's
// own rail card always carries the second run's id, selected or not, so
// `run-id` alone never actually proves the SELECTED run (RunControls, and
// the topology hexes derived from the same `view.activeRun`) is the one
// being read.
//
// The fix pairs `run-id` with `section: 'run-controls'`
// (`RunControls.tsx:189`) — a value no rail card carries — so the two keys
// can only co-occur, and therefore only be judged together, on
// `RunControls`' own record. That pairing itself depends on `section` having
// a SECOND carrier on the page: `HistoryLedger`'s always-rendered
// `data-section="history-ledger"` (`HistoryLedger.tsx:106-108`, no guard,
// mounted at `app/flows/[id]/page.tsx:887`). Without it `section` would have
// exactly one carrier, `resolveExpectations` would read it SOLO (bypassing
// the together-rule entirely), and the fix would be as vacuous as the bare
// `run-id` it replaces — the third test below pins that boundary too.
const RUN_ID_FIXTURE = {
  data: {},
  nested: [
    { 'run-id': 'cycle1' }, // ACT 1's rail card
    { 'run-id': 'cycle2' }, // ACT 2's rail card
    { section: 'run-controls', 'run-id': 'cycle1' }, // RunControls: ACT 1 is SELECTED
    { section: 'history-ledger' }, // always-rendered, unrelated to any run
    { 'hex-kind': 'wi', 'node-id': 'dev', 'wi-id': 'WI-1', status: 'complete' },
  ],
};

test('ROW 149 ROUND 2: a bare run-id is VACUOUS — satisfied by the WRONG run\'s own rail card', () => {
  const expected = {
    'run-id': 'cycle2', 'hex-kind': 'wi', 'node-id': 'dev', 'wi-id': 'WI-1', status: 'complete',
  };
  const seen = resolveExpectations(expected, RUN_ID_FIXTURE);
  assert.ok(
    beatWouldPass(expected, seen),
    'demonstrating the defect: this must be true even though RunControls (the SELECTED run) is ' +
      'still cycle1 — a bare run-id is answered by ACT 2\'s own rail card regardless',
  );
});

test('ROW 149 ROUND 3: section + run-id together are NOT satisfied while RunControls is wrong', () => {
  const expected = {
    section: 'run-controls', 'run-id': 'cycle2',
    'hex-kind': 'wi', 'node-id': 'dev', 'wi-id': 'WI-1', status: 'complete',
  };
  const seen = resolveExpectations(expected, RUN_ID_FIXTURE);
  assert.ok(
    !beatWouldPass(expected, seen),
    'RunControls still reads cycle1 in this fixture — the pinned form must not pass on cycle2\'s ' +
      'own rail card the way the bare run-id did',
  );
});

test('ROW 149 ROUND 3: section + run-id ARE satisfied once RunControls itself shows the right run', () => {
  const expected = {
    section: 'run-controls', 'run-id': 'cycle2',
    'hex-kind': 'wi', 'node-id': 'dev', 'wi-id': 'WI-1', status: 'complete',
  };
  const observed = {
    ...RUN_ID_FIXTURE,
    nested: RUN_ID_FIXTURE.nested.map((r) =>
      (Object.hasOwn(r, 'section') && r.section === 'run-controls'
        ? { section: 'run-controls', 'run-id': 'cycle2' }
        : r)),
  };
  const seen = resolveExpectations(expected, observed);
  assert.ok(beatWouldPass(expected, seen), 'flipping RunControls to cycle2 must make the pinned form pass');
});

test('ROW 149 ROUND 3: WITHOUT the history-ledger\'s second `section` carrier, the pinned form is ' +
  'vacuous too — section is read SOLO', () => {
  const expected = {
    section: 'run-controls', 'run-id': 'cycle2',
    'hex-kind': 'wi', 'node-id': 'dev', 'wi-id': 'WI-1', status: 'complete',
  };
  const observedNoLedger = {
    data: {},
    nested: RUN_ID_FIXTURE.nested.filter((r) => r.section !== 'history-ledger'),
  };
  const seen = resolveExpectations(expected, observedNoLedger);
  assert.ok(
    beatWouldPass(expected, seen),
    'documenting the boundary this fix depends on: with only ONE data-section carrier on the ' +
      'page, section is read solo (bypassing the together-rule), and the pin would be as vacuous ' +
      'as the bare run-id it replaces — this is why the always-rendered history-ledger section matters',
  );
});
