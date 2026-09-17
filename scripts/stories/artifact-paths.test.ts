/**
 * artifact-paths.test.ts — the doors for `forge-8vfn.26` part (a).
 *
 * The subject is the REFUSAL as much as the rewrite. A relativiser that quietly
 * missed a new emitter would write the lane's checkout path into a committed
 * artifact and say nothing, which is the shape the bead is about: ten dirty
 * committed files after a run whose own fences all read clean.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relativiseToRoot, machinePathsIn, portableArtifact } from './artifact-paths.mjs';

const ROOT = '/home/parso/forge-m6-c';

test('a root-prefixed path becomes worktree-relative', () => {
  const out = relativiseToRoot({ removed: [`${ROOT}/projects/story-proof`] }, ROOT);
  assert.deepEqual(out, { removed: ['projects/story-proof'] });
});

test('the path is replaced INSIDE prose, not only as a prefix', () => {
  // `sweep.lines` embeds it mid-sentence, which a prefix-only rewrite misses.
  const out = relativiseToRoot(
    { sweep: { lines: [`[stories] trailing sweep removed ${ROOT}/brain/projects/story-proof`] } },
    ROOT,
  );
  assert.deepEqual(out.sweep.lines, ['[stories] trailing sweep removed brain/projects/story-proof']);
});

test('nesting is walked to any depth, through arrays and objects alike', () => {
  const out = relativiseToRoot({ a: [{ b: { c: [`${ROOT}/x`] } }] }, ROOT);
  assert.equal(out.a[0].b.c[0], 'x');
});

test('ROUTES ARE NOT PATHS — /projects/mdtoc and /api/health survive untouched', () => {
  // A guard keyed on "starts with a slash" would refuse the artifact's own
  // subject. This is the case that makes the rule "machine roots", not "absolute".
  const artifact = { route: '/projects/mdtoc', health: 'http://localhost:4123/api/health' };
  assert.deepEqual(portableArtifact(artifact, ROOT), artifact);
  assert.deepEqual(machinePathsIn(artifact), []);
});

test('REFUSES on a machine path it could not relativise — ANOTHER lane\'s root', () => {
  // The case a key-list guard cannot cover: a value that never passed through
  // this run's root at all.
  assert.throws(
    () => portableArtifact({ sweep: { removed: ['/home/parso/forge-m6-a/projects/x'] } }, ROOT),
    (e: Error) => {
      assert.match(e.message, /still names this machine/);
      assert.match(e.message, /sweep\.removed\[0\]/, 'the refusal must say WHERE');
      assert.match(e.message, /forge-8vfn\.26/);
      return true;
    },
  );
});

test('REFUSES for an emitter nobody has written yet — the whole object is walked', () => {
  // The point of walking everything: this key is on no list.
  assert.throws(
    () => portableArtifact({ someFutureEmitter: { detail: 'wrote /tmp/forge-run-42/out' } }, ROOT),
    /someFutureEmitter\.detail/,
  );
});

test('machinePathsIn names every offender, not just the first', () => {
  const found = machinePathsIn({ a: '/home/x/1', b: ['/root/2', 'fine'], c: { d: '/Users/y/3' } });
  assert.deepEqual(found.map((f) => f.at), ['a', 'b[0]', 'c.d']);
});

test('a clean artifact passes through unchanged and equal by value', () => {
  const artifact = { story: { id: 'proof' }, beats: [{ act: 'x', status: 'green' }] };
  assert.deepEqual(portableArtifact(artifact, ROOT), artifact);
});
