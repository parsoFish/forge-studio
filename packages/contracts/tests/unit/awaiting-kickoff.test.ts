/**
 * `isAwaitingKickoff` — the ONE kickoff-gate derivation (bead forge-mfv5.1.25).
 * Every fact is proved to break it ALONE, and every "built" signal names itself.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { developRunningOf, fixRoundDeliveredHead, fixRoundHeadVerdict, fixRoundOf, isAwaitingKickoff, kickoffBuiltReason, type KickoffFacts } from '../../index.ts';

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

test('fixRoundOf: a parked fix round reads its round, not running; it is never a kickoff', () => {
  assert.deepEqual(fixRoundOf(FIX_ROUND), { round: 1, running: false });
  assert.equal(isAwaitingKickoff(FIX_ROUND), false);
});

test('fixRoundOf: each fact alone breaks it', () => {
  assert.equal(fixRoundOf({ ...FIX_ROUND, queueDir: 'pending' }), null);
  assert.equal(fixRoundOf({ ...FIX_ROUND, resumeFrom: null }), null);
  assert.equal(fixRoundOf({ ...FIX_ROUND, pendingFixWorkItems: 0 }), null);
  assert.equal(fixRoundOf(AT_KICKOFF), null);
});

// forge-nk1y.23 — the drain re-entered the fix WI: manifest back in `in-flight/`, still resume_from develop.
const FIX_RUNNING: KickoffFacts = { ...FIX_ROUND, queueDir: 'in-flight' };

test('fixRoundOf: the same fix round re-entered in-flight reads its round AND says it is running', () => {
  assert.deepEqual(fixRoundOf(FIX_RUNNING), { round: 1, running: true });
  assert.deepEqual(fixRoundOf({ ...FIX_RUNNING, workItemStatuses: [...FIX_RUNNING.workItemStatuses.slice(0, 5), 'in-progress'] }), { round: 1, running: true });
});

test('fixRoundOf: an in-flight run that is not a fix round reads null (each fact alone)', () => {
  assert.equal(fixRoundOf({ ...FIX_RUNNING, resumeFrom: null }), null);
  assert.equal(fixRoundOf({ ...FIX_RUNNING, resumeFrom: 'plan' }), null);
  assert.equal(fixRoundOf({ ...FIX_RUNNING, pendingFixWorkItems: 0 }), null);
});

test('developRunningOf: in-flight with any pending or in-progress work item is running', () => {
  assert.equal(developRunningOf(FIX_RUNNING), true);
  assert.equal(developRunningOf({ ...AT_KICKOFF, queueDir: 'in-flight', resumeFrom: null, workItemStatuses: ['complete', 'in-progress'] }), true);
  assert.equal(developRunningOf({ ...AT_KICKOFF, queueDir: 'in-flight', workItemStatuses: ['complete', 'pending'] }), true, 'a plain dev WI counts too');
});

test('developRunningOf: not running when parked, not in-flight, or nothing left to build', () => {
  assert.equal(developRunningOf(FIX_ROUND), false, 'parked in ready-for-review');
  assert.equal(developRunningOf({ ...FIX_RUNNING, queueDir: 'pending' }), false);
  assert.equal(developRunningOf({ ...FIX_RUNNING, queueDir: 'done' }), false);
  assert.equal(developRunningOf({ ...FIX_RUNNING, workItemStatuses: ['complete', 'complete'], pendingFixWorkItems: 0 }), false);
  assert.equal(developRunningOf({ ...FIX_RUNNING, workItemStatuses: [], pendingFixWorkItems: 0 }), false, 'no work items at all');
  assert.equal(developRunningOf({ ...FIX_RUNNING, workItemStatuses: ['complete', 'unreadable'], pendingFixWorkItems: 0 }), false, 'unreadable is not running');
});

// forge-mfv5.1.27 security review (items 1–2): the delivered head is read from exact, parsed events only.
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const ev = (message: string, metadata: Record<string, unknown>, extra: Record<string, unknown> = {}) => JSON.stringify({ phase: 'orchestrator', skill: 'cycle', message, metadata, ...extra });

test('fixRoundDeliveredHead: the last exact delivered-head event wins; text mentions, other emitters and torn rows do not', () => {
  assert.equal(fixRoundDeliveredHead([ev('cycle.dev-close-invariant-ok', { local_head: SHA_A })]), SHA_A);
  assert.equal(fixRoundDeliveredHead([ev('cycle.dev-close-invariant-ok', { local_head: SHA_A }), ev('merge-gate.fix-loop.compiled', { head_sha: SHA_B })]), SHA_B);
  assert.equal(fixRoundDeliveredHead([ev('cycle.dev-close-invariant-ok', { local_head: SHA_A }), ev('cycle.note', { text: 'cycle.dev-close-invariant-ok', local_head: SHA_B })]), SHA_A);
  assert.equal(fixRoundDeliveredHead([ev('cycle.dev-close-invariant-ok', { local_head: SHA_A }), ev('cycle.dev-close-invariant-ok', { local_head: SHA_B }, { skill: 'developer-ralph' })]), SHA_A);
  assert.equal(fixRoundDeliveredHead([ev('cycle.dev-close-invariant-ok', { local_head: SHA_A }), '{torn']), SHA_A);
});

test('fixRoundDeliveredHead: a non-40-hex head on the last event fails closed (null); a compile without head_sha keeps the prior head', () => {
  assert.equal(fixRoundDeliveredHead([ev('cycle.dev-close-invariant-ok', { local_head: SHA_A }), ev('cycle.dev-close-invariant-ok', { local_head: 'HEAD' })]), null);
  assert.equal(fixRoundDeliveredHead([ev('cycle.dev-close-invariant-ok', { local_head: SHA_A.slice(0, 7) })]), null);
  assert.equal(fixRoundDeliveredHead([ev('cycle.dev-close-invariant-ok', { local_head: SHA_A }), ev('merge-gate.fix-loop.compiled', { round: 1 })]), SHA_A);
});

test('fixRoundHeadVerdict: null only when the found head IS the delivered head; every refusal is named', () => {
  assert.equal(fixRoundHeadVerdict(SHA_A, SHA_A), null);
  assert.match(fixRoundHeadVerdict(SHA_A, SHA_B) ?? '', /expected aaaaaaa, found bbbbbbb\) — not resuming/);
  assert.match(fixRoundHeadVerdict(null, SHA_A) ?? '', /no 40-hex delivered head recorded/);
  assert.match(fixRoundHeadVerdict(SHA_A, null) ?? '', /found \(no branch\)/);
});
