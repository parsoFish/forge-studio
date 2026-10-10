/**
 * `isAwaitingKickoff` — the ONE kickoff-gate derivation (bead forge-mfv5.1.25).
 * Every fact is proved to break it ALONE, and every "built" signal names itself.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fixRoundOf, isAwaitingKickoff, kickoffBuiltReason, type KickoffFacts } from '../../index.ts';

const AT_KICKOFF: KickoffFacts = {
  queueDir: 'ready-for-review',
  flowId: 'forge-architect',
  workItemStatuses: ['pending', 'pending', 'pending', 'pending', 'pending'],
  branchHasCommits: () => false,
  resumeFrom: null,
  reviewRounds: 0,
  pendingFixWorkItems: 0,
};

test('a decomposed, unbuilt forge-architect manifest in ready-for-review is awaiting kickoff', () => {
  assert.equal(isAwaitingKickoff(AT_KICKOFF), true);
  assert.equal(kickoffBuiltReason(AT_KICKOFF), null);
});

test('each placement fact alone breaks it', () => {
  assert.equal(isAwaitingKickoff({ ...AT_KICKOFF, queueDir: 'pending' }), false);
  assert.equal(isAwaitingKickoff({ ...AT_KICKOFF, flowId: 'forge-develop' }), false);
  assert.equal(isAwaitingKickoff({ ...AT_KICKOFF, flowId: null }), false);
  assert.equal(isAwaitingKickoff({ ...AT_KICKOFF, workItemStatuses: [] }), false);
});

test('each built signal alone breaks it and names itself', () => {
  const cases: Array<[Partial<KickoffFacts>, RegExp]> = [
    [{ workItemStatuses: ['pending', 'complete'] }, /complete/],
    [{ workItemStatuses: ['in-progress'] }, /in-progress/],
    [{ branchHasCommits: () => true }, /branch/],
    [{ resumeFrom: 'develop' }, /resume/],
    [{ reviewRounds: 1 }, /review round/],
  ];
  for (const [delta, reason] of cases) {
    const facts = { ...AT_KICKOFF, ...delta };
    assert.equal(isAwaitingKickoff(facts), false, JSON.stringify(delta));
    assert.match(kickoffBuiltReason(facts) ?? '', reason);
  }
});

test('the branch probe is not run when a cheaper fact already decides', () => {
  let probed = false;
  const probe = () => { probed = true; return false; };
  isAwaitingKickoff({ ...AT_KICKOFF, queueDir: 'pending', branchHasCommits: probe });
  isAwaitingKickoff({ ...AT_KICKOFF, workItemStatuses: ['complete'], branchHasCommits: probe });
  assert.equal(probed, false);
});

// forge-mfv5.1.27 — the live gate-red park: 5 delivered + 1 pending gate-fix WI,
// review_rounds 1, resume_from develop, in ready-for-review.
const FIX_ROUND: KickoffFacts = {
  ...AT_KICKOFF, flowId: 'forge-develop', resumeFrom: 'develop', reviewRounds: 1, pendingFixWorkItems: 1,
  workItemStatuses: ['complete', 'complete', 'complete', 'complete', 'complete', 'pending'],
};

test('fixRoundOf: a parked fix round reads its round; it is never a kickoff', () => {
  assert.equal(fixRoundOf(FIX_ROUND), 1);
  assert.equal(isAwaitingKickoff(FIX_ROUND), false);
});

test('fixRoundOf: each fact alone breaks it', () => {
  assert.equal(fixRoundOf({ ...FIX_ROUND, queueDir: 'in-flight' }), null);
  assert.equal(fixRoundOf({ ...FIX_ROUND, resumeFrom: null }), null);
  assert.equal(fixRoundOf({ ...FIX_ROUND, pendingFixWorkItems: 0 }), null);
  assert.equal(fixRoundOf(AT_KICKOFF), null);
});
