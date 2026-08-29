/**
 * preflight.test.ts — memory preflight and the host lock.
 *
 * MEMORY. Measured (tiered-orchestration, wave-8): a foreign leaked process at
 * 10 GB on this 13 GB host OOM-kills the browser and produces a trailing
 * cluster of `Target crashed` failures **that read exactly like code defects**.
 * Diagnosing it with the cheap tool costs 3 minutes; chasing it as a code
 * defect costs a 45-minute blind re-run and risks re-scoping a healthy beat.
 * So the runner refuses up front and says why, rather than producing a
 * plausible-looking red.
 *
 * HOST LOCK. Ports 4123/4124 are host-global (`journey-sync` rule 6). Two
 * story runs on one host collide on the bridge and the UI, and M0 finding 3
 * measured concurrent suites flaking a wall-clock assertion on this box.
 *
 * Pinned before implementation (`_1.0/gate-manifests/M1-B.txt`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryVerdict, MIN_AVAILABLE_MB, hostLockPath } from './preflight.mjs';

test('ample memory passes', () => {
  const v = memoryVerdict(8000);
  assert.equal(v.ok, true);
});

test('memory below the floor REFUSES, and the reason names the number and the symptom', () => {
  // Kills a warn-and-continue preflight. The whole value of this check is
  // that the operator is told "this is memory, not code" BEFORE they spend 45
  // minutes reading a crash as a defect.
  const v = memoryVerdict(300);
  assert.equal(v.ok, false);
  assert.match(v.reason, /300/);
  assert.match(v.reason, new RegExp(String(MIN_AVAILABLE_MB)));
  assert.match(v.reason, /Target crashed|memory/i);
});

test('exactly at the floor passes; one below refuses', () => {
  // Measure the boundary rather than trusting a magic number reads "large".
  assert.equal(memoryVerdict(MIN_AVAILABLE_MB).ok, true);
  assert.equal(memoryVerdict(MIN_AVAILABLE_MB - 1).ok, false);
});

test('an unreadable memory figure REFUSES rather than assuming plenty', () => {
  // Kills `available ?? Infinity`. If we cannot tell, we do not proceed to
  // spend a browser boot and a set of beats on it.
  assert.equal(memoryVerdict(null).ok, false);
  assert.equal(memoryVerdict(NaN).ok, false);
});

test('the floor is a stated constant, not a literal buried in a branch', () => {
  assert.equal(typeof MIN_AVAILABLE_MB, 'number');
  assert.ok(MIN_AVAILABLE_MB > 0);
});

test('the host lock lives OUTSIDE the worktree, so two worktrees contend for one lock', () => {
  // The bug this kills: a lock at `<root>/_local/stories.lock` gives every
  // worktree its OWN lock file, so two lanes each acquire "the" lock and both
  // run — while the thing being guarded, ports 4123/4124, is host-global.
  // A per-repo lock on a host-global resource is not a lock at all.
  // hostLockPath takes no argument BY DESIGN — that is the property:
  // it cannot vary with the tree it is called from.
  const a = hostLockPath();
  const b = hostLockPath();
  assert.equal(a, b, 'every tree on this host must resolve the SAME lock path');
  assert.ok(!a.startsWith('/home/parso/forge'), 'the lock must not live inside any worktree');
});
