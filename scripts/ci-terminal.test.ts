/**
 * `ci-terminal.sh` — the predicate every lane's CI waiter is built on.
 *
 * Its whole job is to answer one question about a head SHA, and every way it has been wrong has
 * been a PRECEDENCE bug, not an API bug:
 *
 *   §15.154  it reported `PENDING 3/4` for 45 minutes on a head whose `build-and-test` had
 *            already FAILED, because it asked "have all checks completed?" before "has any
 *            check failed?". A failure cannot be undone by a sibling finishing.
 *   §15.103  `until [ "$(gh …)" != "OPEN" ]` fired FALSE-positive when the API flapped: empty
 *            is not a state. An empty read is a named retryable outcome, never a transition.
 *   §15.92   a waiter that matched the PREVIOUS head's checks looked like a finished run.
 *   §15.84   the root cause of every stalled merge in one wave: a `jq` that is not installed
 *            made the predicate unsatisfiable, and an unsatisfiable predicate is
 *            indistinguishable from work still running.
 *
 * So the classifier is a pure function of `name|status|conclusion` rows plus two SHAs, and it is
 * tested with the rows planted rather than by waiting on a real PR.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const CI = join(import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'ci-terminal.sh');
const HEAD = 'b2d1c640e6b3fc4b76af06f80ee4f43bafc6c955';

/** classify <want-head> <got-head> < rows — the pure function, fed directly. */
function classify(want: string, got: string, rows: string[]) {
  const r = spawnSync('bash', [CI, 'classify', want, got], { input: rows.join('\n'), encoding: 'utf8' });
  return { status: r.status, out: (r.stdout ?? '').trim(), err: r.stderr ?? '' };
}
const ok = (name: string) => `${name}|COMPLETED|SUCCESS`;
const failed = (name: string) => `${name}|COMPLETED|FAILURE`;
const running = (name: string) => `${name}|IN_PROGRESS|`;

describe('ci-terminal.sh classify — ordered by what can still change the answer', () => {
  test('§15.154: a completed FAILURE beside pending siblings is TERMINAL, and names the check', () => {
    const r = classify(HEAD, HEAD, [failed('build-and-test'), running('stories'), running('deadpaths'), running('ui-walkthrough')]);

    assert.equal(r.status, 1, 'a head that can never merge is a terminal answer, not a wait');
    assert.match(r.out, /^TERMINAL_FAILURE/);
    assert.match(r.out, /build-and-test:FAILURE/, 'the failing check is named — never reported as a count (§15.92)');
    assert.doesNotMatch(r.out, /PENDING/);
  });

  test('every check COMPLETED and SUCCESS is TERMINAL_SUCCESS, with the count and the head', () => {
    const r = classify(HEAD, HEAD, [ok('build-and-test'), ok('stories'), ok('ui-walkthrough'), ok('deadpaths')]);

    assert.equal(r.status, 0);
    assert.match(r.out, /^TERMINAL_SUCCESS 4\/4 b2d1c640/);
  });

  test('a check still running, with nothing failed, is PENDING with its progress', () => {
    const r = classify(HEAD, HEAD, [ok('build-and-test'), ok('stories'), running('deadpaths')]);

    assert.equal(r.status, 2);
    assert.match(r.out, /^PENDING 2\/3 b2d1c640/);
  });

  test('a COMPLETED row with an EMPTY conclusion is pending — a run in progress reports no conclusion', () => {
    const r = classify(HEAD, HEAD, [ok('build-and-test'), 'stories|COMPLETED|']);

    assert.equal(r.status, 2);
    assert.match(r.out, /^PENDING 1\/2/, 'an empty conclusion is not a SUCCESS and is not a FAILURE');
  });

  test('zero checks is NO_CHECKS — never a green gate (a gate that reports nothing is not green)', () => {
    const r = classify(HEAD, HEAD, []);

    assert.equal(r.status, 2);
    assert.match(r.out, /^NO_CHECKS b2d1c640/);
  });

  test('§15.103: an empty read is API_UNAVAILABLE, a named retryable outcome, never a state', () => {
    const r = classify(HEAD, '', []);

    assert.equal(r.status, 2);
    assert.equal(r.out, 'API_UNAVAILABLE');
  });

  test('§15.92: a head that moved is HEAD_MISMATCH, naming both SHAs', () => {
    const r = classify(HEAD, '0f33ce6299887766554433221100aabbccddeeff', [ok('build-and-test')]);

    assert.equal(r.status, 3);
    assert.match(r.out, /^HEAD_MISMATCH want=b2d1c640 got=0f33ce62/);
  });

  test('the head check outranks the rows: a green run on the WRONG head is not a green gate', () => {
    const r = classify(HEAD, '0f33ce6299887766554433221100aabbccddeeff', [ok('build-and-test'), ok('stories'), ok('ui-walkthrough'), ok('deadpaths')]);

    assert.equal(r.status, 3, 'four SUCCESS rows about another commit say nothing about this one');
    assert.match(r.out, /^HEAD_MISMATCH/);
  });

  test('the classifier is a pure function — no network, no gh, no jq (§15.84)', () => {
    const r = spawnSync('bash', [CI, 'classify', HEAD, HEAD], {
      input: [ok('a')].join('\n'),
      encoding: 'utf8',
      // PATH stripped to a shell-only minimum: if the classifier reached for `gh` or `jq`
      // it would fail here, which is the point — an undefined command silently takes the
      // failure branch, and that is what §15.84 cost a whole wave.
      env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME ?? '' },
    });

    assert.equal(r.status, 0, r.stderr);
    assert.match((r.stdout ?? '').trim(), /^TERMINAL_SUCCESS 1\/1/);
  });
});
