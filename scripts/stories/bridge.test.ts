/**
 * bridge.test.ts — port identity, the ported lesson the old harness got wrong.
 *
 * 1.0.md §3.1 states the defect it closes directly: "today `verify-cycle.mjs`
 * reuses any healthy bridge and the journey harness force-takes-over — **both
 * would test the wrong tree**." A story run that drives a bridge serving a
 * different worktree produces a green verdict about code it never loaded.
 * That is the worst failure a gate can have: not a red that should be green,
 * but a green that means nothing.
 *
 * So the rule is three-way, and deliberately NOT the launcher's own
 * `decidePortStrategy` (`cli/forge-watch.ts`), whose default is
 * attach-if-healthy — correct for an operator opening a second window, wrong
 * for a gate:
 *
 *   boot    4123 is free            -> start our own bridge from THIS tree
 *   reuse   healthy AND its cwd is THIS worktree
 *   refuse  healthy AND anything else
 *
 * `--force-takeover` (`scripts/e2e-journey.mjs:135-140`) is deliberately NOT
 * ported: it guarantees the harness binds *a* bridge while saying nothing
 * about which tree that bridge serves, and SIGKILLing a bridge can hard-reset
 * another lane's in-flight cycle.
 *
 * Pinned before implementation (`_1.0/gate-manifests/M1-B.txt`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideStoryBridge } from './bridge.mjs';

const OWN = '/home/parso/forge-m1-b';
const HEALTHY = { service: 'forge-bridge', pid: 4242, startedAt: '2026-08-29T00:00:00.000Z' };

test('a free port boots our own bridge from the tree we run in', () => {
  assert.equal(decideStoryBridge(null, { ownRoot: OWN, cwdOf: () => null }), 'boot');
});

test('a healthy bridge whose cwd IS our worktree is reused', () => {
  assert.equal(decideStoryBridge(HEALTHY, { ownRoot: OWN, cwdOf: () => OWN }), 'reuse');
});

test('a healthy FOREIGN bridge is REFUSED, never taken over', () => {
  // The live case as this lane starts: T1's campaign bridge runs from
  // /home/parso/forge. Taking it over would SIGKILL it and hard-reset any
  // in-flight cycle; attaching to it would test the wrong tree.
  assert.equal(
    decideStoryBridge(HEALTHY, { ownRoot: OWN, cwdOf: () => '/home/parso/forge' }),
    'refuse',
  );
});

test('a healthy bridge whose cwd cannot be read is REFUSED, not assumed ours', () => {
  // Kills `cwd === ownRoot || cwd === null` and every other fail-open reading
  // of an unreadable /proc entry. Unknown provenance is not our provenance.
  assert.equal(decideStoryBridge(HEALTHY, { ownRoot: OWN, cwdOf: () => null }), 'refuse');
});

test('a listener that does not identify as a forge bridge is booted over, not reused', () => {
  // probeBridgeIdentity returns null for a foreign server, a pre-identity
  // bridge, a non-2xx or malformed JSON. All of those are "nothing of ours is
  // there", which is the boot case.
  assert.equal(decideStoryBridge(null, { ownRoot: OWN, cwdOf: () => OWN }), 'boot');
});

test('a bridge reporting a different service name is not treated as ours', () => {
  // Kills a check that trusts the presence of a JSON body over its content.
  assert.equal(
    decideStoryBridge({ service: 'something-else', pid: 1, startedAt: 'x' }, { ownRoot: OWN, cwdOf: () => OWN }),
    'boot',
  );
});

test('the decision never consults the process cwd when the port is free', () => {
  // Kills an implementation that reads /proc unconditionally: with a free
  // port there is no pid to read, and calling cwdOf would throw.
  let called = false;
  const r = decideStoryBridge(null, { ownRoot: OWN, cwdOf: () => { called = true; return null; } });
  assert.equal(r, 'boot');
  assert.equal(called, false);
});

test('cwdOf is asked about the identified pid, not guessed', () => {
  let askedAbout: number | null = null;
  decideStoryBridge(HEALTHY, { ownRoot: OWN, cwdOf: (pid) => { askedAbout = pid; return OWN; } });
  assert.equal(askedAbout, 4242);
});
