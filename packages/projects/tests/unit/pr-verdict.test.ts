/**
 * forge-mfv5.1.23 — the PURE verdict over a forge-studio PR's state, read from one
 * `gh api graphql` call. Red wins over pending; no required check is never green;
 * unreadable output is a named state, never a pass. No gh, no git.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { NO_REQUIRED_CHECK, parsePrRead, prVerdict } from '../../project-pr-verdict.ts';
import { HEAD_OID, checkRun, graphqlPr, statusContext } from '../test-fixtures/save-origin.ts';

const verdict = (nodes: unknown[], over: Record<string, unknown> = {}, head = HEAD_OID) => prVerdict(parsePrRead(graphqlPr(nodes, over)), head);

test('verdict: merged PR → merged', () => {
  assert.equal(verdict([], { state: 'MERGED', merged: true }).state, 'merged');
});

test('verdict: no context is required → blocked-no-required-check with the exact hand-off text', () => {
  for (const nodes of [[], [checkRun('lint', 'COMPLETED', 'SUCCESS', false)], [statusContext('ci/x', 'FAILURE', false)]]) {
    const v = verdict(nodes);
    assert.equal(v.state, 'blocked-no-required-check');
    assert.equal(v.detail, 'no required check reports on this branch — merge on GitHub yourself or add a required check');
    assert.equal(v.detail, NO_REQUIRED_CHECK);
  }
});

test('verdict: a required completed red check → failing, every failing check named', () => {
  for (const conclusion of ['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE']) {
    const v = verdict([checkRun('build', 'COMPLETED', conclusion), checkRun('test', 'COMPLETED', 'SUCCESS')]);
    assert.equal(v.state, 'failing', conclusion);
    assert.match(v.detail, /build/);
    assert.doesNotMatch(v.detail, /test/);
  }
  for (const state of ['FAILURE', 'ERROR']) {
    const v = verdict([statusContext('ci/legacy', state), checkRun('test', 'COMPLETED', 'FAILURE')]);
    assert.equal(v.state, 'failing', state);
    assert.match(v.detail, /ci\/legacy/);
    assert.match(v.detail, /test/);
  }
});

test('verdict: red wins over pending', () => {
  const v = verdict([checkRun('slow', 'IN_PROGRESS', null), checkRun('fast', 'COMPLETED', 'FAILURE'), statusContext('ci/q', 'PENDING')]);
  assert.equal(v.state, 'failing');
  assert.match(v.detail, /fast/);
});

test('verdict: a required check not complete, none failed → pending, pending checks named', () => {
  const v = verdict([checkRun('build', 'QUEUED', null), checkRun('lint', 'COMPLETED', 'SUCCESS'), statusContext('ci/expected', 'EXPECTED')]);
  assert.equal(v.state, 'pending');
  assert.match(v.detail, /build/);
  assert.match(v.detail, /ci\/expected/);
  assert.doesNotMatch(v.detail, /lint/);
});

test('verdict: every required check green (success, neutral, skipped, SUCCESS) → green; non-required red is ignored', () => {
  const v = verdict([
    checkRun('a', 'COMPLETED', 'SUCCESS'), checkRun('b', 'COMPLETED', 'NEUTRAL'), checkRun('c', 'COMPLETED', 'SKIPPED'),
    statusContext('ci/d', 'SUCCESS'), checkRun('optional', 'COMPLETED', 'FAILURE', false),
  ]);
  assert.equal(v.state, 'green');
});

test('verdict: a completed check with no conclusion is red, never green', () => {
  assert.equal(verdict([checkRun('a', 'COMPLETED', null)]).state, 'failing');
});

test('verdict: a head other than the pushed commit → stale-head, named, before anything else', () => {
  const v = verdict([checkRun('a', 'COMPLETED', 'SUCCESS')], { headRefOid: 'f'.repeat(40) });
  assert.equal(v.state, 'stale-head');
  assert.match(v.detail, /fffffff/);
  assert.match(v.detail, new RegExp(HEAD_OID.slice(0, 7)));
});

test('verdict: unparseable or shapeless graphql output → unreadable with the reason, never a pass', () => {
  for (const out of ['', 'not json', '{}', JSON.stringify({ data: { repository: { pullRequest: null } } }), JSON.stringify({ errors: [{ message: 'x' }] })]) {
    const v = prVerdict(parsePrRead(out), HEAD_OID);
    assert.equal(v.state, 'unreadable', out);
    assert.ok(v.detail.length > 0);
  }
  const failed = prVerdict({ ok: false, reason: 'gh api graphql failed: HTTP 502' }, HEAD_OID);
  assert.equal(failed.state, 'unreadable');
  assert.match(failed.detail, /HTTP 502/);
});
