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
import { relativiseToRoot, machinePathsIn, portableArtifact, portableFenceEscapes } from './artifact-paths.mjs';

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

/*
 * `forge-8vfn.7.6.120` — an ATTRIBUTED sibling escape serialises without a
 * machine path. T1 ruling 1093a.
 *
 * WHAT WAS BROKEN. `siblingWorktreeEscapes` correctly reports growth in a tree
 * somebody else is working in as NOT-RED (ruling 340) — and then writes `root`
 * and `live.cwd` as ABSOLUTE paths, which `MACHINE_ROOTS` refuses. So a green
 * costed run wrote NO artifact whenever a neighbour touched one file. S9 run 7
 * went 16/16 for $0.4567 and produced nothing, naming `/home/parso/forge-m6-c`.
 *
 * PROVED STRUCTURAL BY MIRRORING, which is why this is a product bug and not a
 * lane's mess: D's S4 artifact named lane A's tree, A's S9 artifact named lane
 * C's tree. Neither lane caused its own. D's S4 run 3 then passed
 * `portableArtifact` only because every other lane was held quiet for 30
 * minutes — that window is the CONTROL showing the fix belongs here, not in
 * scheduling.
 *
 * WHY NOT A `../` RELATIVE FORM: it encodes the assumption that both trees
 * share a parent. The first time that is false it yields `../../../mnt/x/…` —
 * a machine path in disguise, straight past a `MACHINE_ROOTS` check that only
 * matches a LEADING `/home/`. A guard evaded by the value it exists to catch is
 * this campaign's most repeated defect; it is not worth reintroducing on
 * purpose.
 *
 * ONE FRAME PER FIELD. The first draft wrote `cwd` as
 * `forge-m6-c/scripts/stories` — basename AND remainder in one string, so
 * nothing downstream can tell where the sibling name ends. `root` carries
 * `rootKind`, `cwd` carries `cwdKind`, and neither field mixes two frames.
 */
test('7.6.120: an ATTRIBUTED escape serialises with no machine path — the run-7 shape', () => {
  const escapes = portableFenceEscapes([{
    root: '/home/parso/forge-m6-c',
    paths: ['scripts/stories/beats-agent-proc.mjs'],
    live: { pid: 1471815, cwd: '/home/parso/forge-m6-c', via: 'cwd' },
  }]);
  assert.deepEqual(machinePathsIn(escapes), [],
    'the whole point: no field of an attributed escape may name this machine');
  assert.equal(escapes[0].root, 'forge-m6-c');
  assert.equal(escapes[0].rootKind, 'sibling-basename');
  assert.equal(escapes[0].live.cwd, '.');
  assert.equal(escapes[0].live.cwdKind, 'relative-to-sibling-root');
});

test('7.6.120: the sibling stays IDENTIFIABLE — pid and grown paths are untouched', () => {
  const escapes = portableFenceEscapes([{
    root: '/home/parso/forge-m6-c',
    paths: ['scripts/stories/beats-agent-proc.mjs', 'scripts/stories/beats-cycle-terminal.test.ts'],
    live: { pid: 1471815, cwd: '/home/parso/forge-m6-c', via: 'cwd' },
  }]);
  assert.equal(escapes[0].live.pid, 1471815,
    'the pid is what made run 7\'s attribution checkable at all (readlink /proc/<pid>/cwd)');
  assert.equal(escapes[0].live.via, 'cwd');
  assert.deepEqual(escapes[0].paths,
    ['scripts/stories/beats-agent-proc.mjs', 'scripts/stories/beats-cycle-terminal.test.ts'],
    'grown paths are already relative and carry the finding — they must survive verbatim');
});

test('7.6.120: a cwd BELOW the sibling root keeps the relation, it does not collapse', () => {
  // `liveProcessRoots` matches by PREFIX (`cwd === resolved || cwd.startsWith(
  // resolved + sep)`), so a subdir cwd is the NORMAL case. Collapsing it to the
  // root would be a true statement that loses the finding: "somebody was working
  // in that tree" is weaker than "somebody was working in scripts/stories of it".
  const escapes = portableFenceEscapes([{
    root: '/home/parso/forge-m6-c',
    paths: ['a.mjs'],
    live: { pid: 42, cwd: '/home/parso/forge-m6-c/scripts/stories', via: 'cwd' },
  }]);
  assert.equal(escapes[0].live.cwd, 'scripts/stories');
  assert.equal(escapes[0].live.cwdKind, 'relative-to-sibling-root');
  assert.deepEqual(machinePathsIn(escapes), []);
});

test('7.6.120: an UNATTRIBUTED escape is left ALONE — it must still reach the refusal', () => {
  // THE DOOR THAT MATTERS. The way this bead goes wrong is by making EVERY
  // escape serialise nicely, including the ones that should have ended the run.
  // `live: null` is what `unownedEscapes` filters on to red the run (340); if
  // this function tidied those too, a real containment breach would serialise
  // portably and ship.
  const raw = [{ root: '/home/parso/forge-m6-b', paths: ['x.mjs'], live: null }];
  const escapes = portableFenceEscapes(raw);
  assert.equal(escapes[0].root, '/home/parso/forge-m6-b',
    'an unowned escape keeps its absolute root so portableArtifact still REFUSES it');
  assert.equal(escapes[0].live, null, 'and stays unattributed, so unownedEscapes still reds the run');
  assert.equal(machinePathsIn(escapes).length, 1,
    'it must remain a machine path — that is how a breach is stopped from reaching an artifact');
});

test('7.6.120: the whole artifact now passes portableArtifact — run 7 end to end', () => {
  const result = {
    id: 'S9',
    fence: { escapes: portableFenceEscapes([{
      root: '/home/parso/forge-m6-c',
      paths: ['scripts/stories/beats-agent-proc.mjs'],
      live: { pid: 1471815, cwd: '/home/parso/forge-m6-c', via: 'cwd' },
    }]) },
  };
  const out = portableArtifact(result, '/home/parso/forge-clean-m6a');
  assert.deepEqual(machinePathsIn(out), []);
  assert.equal(out.fence.escapes[0].root, 'forge-m6-c');
});

test('7.6.120: a MALFORMED escape is left for the backstop, never emitted as an empty string', () => {
  // `root: ""` would pass `machinePathsIn` — portable-looking, naming no sibling
  // at all. A record that reconciles because it is empty is the species this
  // campaign keeps meeting; an unreadable input resolves toward the refusal.
  //
  // C's statement of why the `rootKind` assertion is the stronger half, recorded
  // so it survives a rename: `rootKind` is a CLAIM — "this was made safe" — so a
  // future version that sanitised `root` but still stamped the claim would pass
  // a pass-through check and fail this one.
  for (const bad of [
    { root: null, paths: [], live: { pid: 1, cwd: '/home/parso/forge-m6-c', via: 'cwd' } },
    { root: '', paths: [], live: { pid: 1, cwd: '/home/parso/forge-m6-c', via: 'cwd' } },
    { root: '/home/parso/forge-m6-c', paths: [], live: { pid: 1, via: 'cwd' } },
  ]) {
    const [out] = portableFenceEscapes([bad]);
    assert.deepEqual(out, bad, `a malformed escape must pass through untouched, got ${JSON.stringify(out)}`);
    assert.equal(out.rootKind, undefined,
      'and must NOT be stamped portable — rootKind is the claim "this was made safe", '
      + 'and claiming it over an unreadable input is the fallback this refuses to be');
  }
});
