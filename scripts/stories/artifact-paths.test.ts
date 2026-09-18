/**
 * artifact-paths.test.ts — the doors for `forge-8vfn.26` part (a).
 *
 * The subject is the REFUSAL as much as the rewrite. A relativiser that quietly
 * missed a new emitter would write the lane's checkout path into a committed
 * artifact and say nothing, which is the shape the bead is about: ten dirty
 * committed files after a run whose own fences all read clean.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relativiseToRoot, machinePathsIn, portableArtifact, portableFenceEscapes, portableReapEntries, portableSweepPaths } from './artifact-paths.mjs';

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

/*
 * `forge-8vfn.7.6.125` — THE SECOND SEAM. 7.6.120 made `fence.escapes`
 * portable; the reap ledger still names other checkouts, so S2, S3 and S5
 * cannot be regenerated: `portableArtifact` over the COMMITTED
 * `demos/stories/S3/story.json` throws today on `reap.reaped[].dir`.
 *
 * THE SPLIT IS NOT attributed/unattributed. That was the shape ruled from
 * 7.6.120, and measuring the artifacts showed it does not map: `reaped` and
 * `skipped` always carry a pid, `cancelled` NEVER does — and S2 and S5 carry a
 * machine path in BOTH `reaped[].dir` and `cancelled[].dir`. A pid-based split
 * would have left `cancelled` absolute and those two still unwritable, so the
 * fix would not have fixed them.
 *
 * The real split is OWN ROOT vs FOREIGN ROOT. Of 21 `dir` fields across six
 * committed artifacts, 12 are already `_logs/…` — the form `relativiseToRoot`
 * leaves after stripping the run's own root — and 9 are absolute.
 *
 * WHY `dirRoot` IS LOAD-BEARING AND NOT DECORATION: without it a foreign
 * `_logs/x` and an own `_logs/x` serialise IDENTICALLY, quietly asserting that
 * another lane's reaped process was this run's own. Two facts, one
 * representation. Its ABSENCE is the signal for "the run's own tree", which is
 * also what keeps the twelve already-portable entries byte-identical.
 */
describe('7.6.125: the reap ledger serialises without a machine path', () => {
  const OWN = '/home/parso/forge-clean-m6a';

  test('a FOREIGN-root reap dir becomes root + relative, with the pid kept', () => {
    const [e] = portableReapEntries([{
      pid: 349829,
      dir: '/home/parso/forge-m5-b-author/_logs/_agent-onboarding-agent-2026-09-05T02-14-24-082-a16l',
      signal: 'SIGTERM', via: 'descendant',
    }], OWN);
    assert.equal(e.dirRoot, 'forge-m5-b-author');
    assert.equal(e.dirRootKind, 'sibling-basename');
    assert.equal(e.dir, '_logs/_agent-onboarding-agent-2026-09-05T02-14-24-082-a16l');
    assert.equal(e.pid, 349829, 'the pid is the entry\'s identity and must survive');
    assert.equal(e.signal, 'SIGTERM');
    assert.deepEqual(machinePathsIn([e]), []);
  });

  test('an OWN-root entry is BYTE-IDENTICAL — no dirRoot, nothing added', () => {
    // THE REGRESSION-LOCK. Twelve entries across six committed artifacts are
    // already `_logs/…`; if this fix stamped them too, every one of those
    // artifacts would churn and the "already portable" shape would change under
    // stories nobody touched.
    const own = { pid: 1, dir: '_logs/_agent-x', signal: 'SIGTERM', via: 'cwd' };
    const [e] = portableReapEntries([own], OWN);
    assert.deepEqual(e, own, 'an entry already relative to the run root must pass through untouched');
    assert.equal('dirRoot' in e, false, 'absence of dirRoot IS the signal for "the run\'s own tree"');
  });

  test('an absolute dir UNDER the run root is relativised, not stamped foreign', () => {
    const [e] = portableReapEntries([{ pid: 2, dir: `${OWN}/_logs/_agent-y`, signal: 'SIGTERM' }], OWN);
    assert.equal(e.dir, '_logs/_agent-y');
    assert.equal('dirRoot' in e, false, 'its own root is not a sibling');
    assert.deepEqual(machinePathsIn([e]), []);
  });

  test('CANCELLED entries are transformed too, though they carry NO pid', () => {
    // The door that T1's attributed/unattributed framing would have missed, and
    // the one that decides whether S2 and S5 become regenerable at all.
    const [e] = portableReapEntries([{
      dir: '/home/parso/forge-m6-d/_logs/_agent-story-s5',
      kind: 'agent', sessionId: null, project: 'mdtoc', written: true, reason: null,
    }], OWN);
    assert.equal(e.dirRoot, 'forge-m6-d');
    assert.equal(e.dir, '_logs/_agent-story-s5');
    assert.equal(e.pid, undefined, 'a cancelled entry never had a pid and must not gain one');
    assert.deepEqual(machinePathsIn([e]), []);
  });

  test('a dir that cannot be decomposed is LEFT ABSOLUTE and still refuses', () => {
    // 7.6.120's malformed case in this seam: an input we cannot parse must not
    // be stamped portable, and a dirRoot on a path we could not decompose is
    // exactly that false claim.
    const bad = { pid: 3, dir: '/home/parso/somewhere-else/no-logs-segment', signal: 'SIGTERM' };
    const [e] = portableReapEntries([bad], OWN);
    assert.deepEqual(e, bad, 'left exactly as it was, for the backstop to refuse');
    assert.equal('dirRootKind' in e, false, 'never stamped portable when it could not be read');
    assert.equal(machinePathsIn([e]).length, 1, 'it must remain a machine path so the write still refuses');
  });
});

/*
 * `forge-8vfn.7.6.127` — THE THIRD SEAM. After 7.6.125, S2 is still unwritable:
 * `portableArtifact` throws on `sweep.removed[0..1]`
 * (`/home/parso/forge-m5-b/projects/story-s2` and its brain sibling).
 *
 * THE SHAPE PROBLEM IS REAL AND DIFFERENT FROM THE OTHER TWO SEAMS.
 * `sweep.removed` is a `string[]`, not an array of objects, so there is no
 * sibling field to hang a root on the way `fence.escapes[].root` and
 * `reap.*[].dirRoot` have one. Naming the frame per element would mean
 * concatenating basename and remainder into one string — the two-frames-in-one-
 * field defect C caught in 7.6.120's first draft.
 *
 * So the frame is named ONCE FOR THE ARRAY (`removedRoot` /
 * `removedRootKind`), and each element stays a single frame: a path relative to
 * that root.
 *
 * AND THAT SHAPE CANNOT REPRESENT TWO DIFFERENT FOREIGN ROOTS AT ONCE. Rather
 * than invent a per-element encoding that mixes frames, the mixed case is LEFT
 * ABSOLUTE and refused. A schema that cannot say the true thing must not be
 * made to say a convenient one; failing closed keeps the artifact honest and
 * the refusal readable. Every artifact today has at most one foreign sweep root,
 * so this refuses nothing that currently works.
 */
describe('7.6.127: sweep paths serialise without a machine path', () => {
  const OWN = '/home/parso/forge-clean-m6a';

  test('the S2 shape: one foreign root — elements relative, frame named once', () => {
    const out = portableSweepPaths({
      removed: ['/home/parso/forge-m5-b/projects/story-s2', '/home/parso/forge-m5-b/brain/projects/story-s2'],
      failed: [],
    }, OWN);
    assert.deepEqual(out.removed, ['projects/story-s2', 'brain/projects/story-s2']);
    assert.equal(out.removedRoot, 'forge-m5-b');
    assert.equal(out.removedRootKind, 'sibling-basename');
    assert.deepEqual(machinePathsIn(out), []);
  });

  test('own-root sweep paths stay as they are — the regression lock', () => {
    // `relativiseToRoot` already strips the run's own root, and the six artifacts
    // that write today depend on that exact form. No root field is added.
    const sweep = { removed: ['projects/story-x'], failed: [] };
    const out = portableSweepPaths(sweep, OWN);
    assert.deepEqual(out, sweep);
    assert.equal('removedRoot' in out, false, 'absence of a root field IS the signal for the run\'s own tree');
  });

  test('an absolute path UNDER the run root is relativised, not called foreign', () => {
    const out = portableSweepPaths({ removed: [`${OWN}/projects/story-y`], failed: [] }, OWN);
    assert.deepEqual(out.removed, ['projects/story-y']);
    assert.equal('removedRoot' in out, false);
  });

  test('TWO different foreign roots are LEFT ABSOLUTE and still refuse', () => {
    // The shape cannot say "these two came from different trees" without a
    // per-element frame, so it does not pretend to. Fail closed.
    const sweep = { removed: ['/home/parso/forge-m5-b/a', '/home/parso/forge-m6-d/b'], failed: [] };
    const out = portableSweepPaths(sweep, OWN);
    assert.deepEqual(out, sweep, 'left exactly as it was for the backstop to refuse');
    assert.equal('removedRoot' in out, false, 'never a root field that describes only some of the elements');
    assert.equal(machinePathsIn(out).length, 2, 'both must remain machine paths so the write refuses');
  });

  test('claim.claimed[].path is an OBJECT, so it takes the 7.6.125 per-element frame', () => {
    const out = portableSweepPaths({
      removed: [],
      claim: { claimed: [{ path: '/home/parso/forge-m5-b/_queue/pending/INIT-x.md', id: 'INIT-x' }], lines: [] },
    }, OWN);
    const c = out.claim.claimed[0];
    assert.equal(c.path, '_queue/pending/INIT-x.md');
    assert.equal(c.pathRoot, 'forge-m5-b');
    assert.equal(c.pathRootKind, 'sibling-basename');
    assert.equal(c.id, 'INIT-x', 'the entry\'s own fields survive');
    assert.deepEqual(machinePathsIn(out), []);
  });

  test('the committed S2 artifact becomes writable — end to end, on real data', () => {
    const a = JSON.parse(readFileSync(new URL('../../demos/stories/S2/story.json', import.meta.url), 'utf8'));
    for (const k of ['reaped', 'skipped', 'cancelled']) {
      if (Array.isArray(a.reap?.[k])) a.reap[k] = portableReapEntries(a.reap[k], OWN);
    }
    a.sweep = portableSweepPaths(a.sweep, OWN);
    const out = portableArtifact(a, OWN);
    assert.deepEqual(machinePathsIn(out), [], 'S2 is the artifact this bead exists for');
  });
});
