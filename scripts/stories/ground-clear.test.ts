/**
 * The run's own minted sessions, captured and cleared out of its own ground —
 * `forge-8vfn.7.6.123`.
 *
 * THE FINDING THESE DOORS ENCODE. Everything needed to catch this was already
 * computed and already correct; it reached a log line and stopped.
 * `groundManifest` is a FILESYSTEM walk (`find . -type f`, pruning only
 * `node_modules` and `.git`), so it sees gitignored content — it is the only
 * instrument in the run that does. `classifyOwnGroundDrift` already separates
 * the minted-session writes into `produced`, each line naming the session that
 * accounts for it. `run-story.mjs` prints them. Nothing consumed that, and
 * nothing cleared, so `projects/gitpulse/_architect/<ts>/` survived every
 * post-run check and the NEXT run's launcher refused on the ground hash. The
 * pin was the only thing standing between run N's plan and run N+1's ground.
 *
 * C's S10 run 18 is the same-run A/B and it is the whole defect in one
 * measurement: `_worktrees/INIT-…` (102 files) was CAUGHT, because `residue.sh`
 * gates it as a NAMED LOCATION counted with `ls`; the ground's
 * `_architect/2026-09-18T03-45-41-0b536f73/` (6 files) was MISSED, because the
 * ground is walked through git and the output is gitignored. Same instrument,
 * same run, opposite outcomes, and the only difference is whether git can see
 * the path.
 *
 * WHY THE CLEAR SET IS DERIVED AND NEVER A PATTERN. `projects/gitpulse` carries
 * exactly one `_*` directory, `_project-brain`, which is part of the pinned
 * ground and is NOT a session. A clear that matched `_*` would eat it. So the
 * set comes from `mintedSessionPaths` — this run's own `_logs` entries — which
 * is the same reasoning `ground-hash.mjs` already states for the classifier: a
 * list of allowed paths goes stale silently, a set derived from the run's own
 * evidence cannot.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, chmodSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { groundManifest, classifyOwnGroundDrift, groundIgnoreNoneForTests, mintedSessionPaths, mintedSessionDirNames } from './ground-hash.mjs';
import { runnerSourceContaining } from './runner-source.mjs';
import {
  groundClearDir,
  mintedSessionDirsToClear,
  captureAndClearMintedSessions,
  describeGroundClear,
  captureAndClearMintedLogs,
  describeLogsClear,
  mintedRunArtefactsToClear,
  captureAndClearMintedRunArtefacts,
} from './ground-clear.mjs';

const SESSION = '2026-09-18T03-45-41-0b536f73';
const MINTED = `_architect/${SESSION}`;

/**
 * A root with one ground and one minted architect session in it, shaped exactly
 * as `mintedSessionPaths` requires: the `_logs` dir must both PARSE as
 * `_<kind>-<id>` and CARRY session evidence (`events.jsonl`, `.heartbeat` or
 * `turn.pid`). That second condition is the product's own door against a licence
 * handed out by accident, and a fixture that skipped it would be testing a
 * shape the runner never produces.
 */
function fixture(): { root: string; ground: string } {
  const root = mkdtempSync(join(tmpdir(), 'ground-clear-'));
  const ground = join(root, 'projects', 'gitpulse');
  mkdirSync(join(ground, 'src'), { recursive: true });
  writeFileSync(join(ground, 'README.md'), '# gitpulse\n');
  writeFileSync(join(ground, 'src', 'index.ts'), 'export const x = 1;\n');
  // Part of the PINNED ground, and the acceptance criterion names it by name:
  // the clear must never touch it.
  mkdirSync(join(ground, '.forge', 'skills', 'demo-design'), { recursive: true });
  writeFileSync(join(ground, '.forge', 'skills', 'demo-design', 'SKILL.md'), 'skill\n');
  // Not a session, and part of the ground. A pattern-based clear eats this.
  mkdirSync(join(ground, '_project-brain'), { recursive: true });
  writeFileSync(join(ground, '_project-brain', 'themes.md'), 'themes\n');
  // The run's own `_logs` side, carrying the evidence that makes it a session.
  mkdirSync(join(root, '_logs', `_architect-${SESSION}`), { recursive: true });
  writeFileSync(join(root, '_logs', `_architect-${SESSION}`, 'turn.pid'), '4242\n');
  return { root, ground };
}

/** The residue itself: the session's output, inside the ground, gitignored. */
function plantMintedOutput(ground: string): void {
  mkdirSync(join(ground, MINTED), { recursive: true });
  writeFileSync(join(ground, MINTED, 'PLAN.md'), '# the plan\n');
  writeFileSync(join(ground, MINTED, 'status.json'), '{"phase":"ready-for-review"}\n');
}

test('7.6.123: the clear set is the dirs THIS RUN minted — never a `_*` pattern', () => {
  const dirs = mintedSessionDirsToClear([
    { kind: 'added', path: `${MINTED}/PLAN.md`, home: MINTED, writers: [] },
    { kind: 'added', path: `${MINTED}/status.json`, home: MINTED, writers: [] },
  ]);
  assert.deepEqual(dirs, [MINTED], 'two files in one minted dir are ONE dir to clear, not two');
});

test('7.6.123: `_project-brain` is never in the clear set — it has no minted home', () => {
  // It is part of the ground, so a real run never classifies it as produced at
  // all. The door states it from the other side too: an entry attributed only
  // by a WRITER has no `home`, and only a `home` licenses a removal.
  const dirs = mintedSessionDirsToClear([
    { kind: 'added', path: '_project-brain/themes.md', home: null, writers: ['_architect/x'] },
  ]);
  assert.deepEqual(dirs, [], 'a writer-attributed path is the run\'s product INSIDE the ground, not a minted dir');
});

test('7.6.123: `modified` and `removed` are never cleared — only `added` inside a minted dir', () => {
  const dirs = mintedSessionDirsToClear([
    { kind: 'modified', path: 'README.md', home: null, writers: ['_architect/x'] },
    { kind: 'modified', path: `${MINTED}/PLAN.md`, home: MINTED, writers: [] },
    { kind: 'removed', path: `${MINTED}/gone.md`, home: MINTED, writers: [] },
  ]);
  assert.deepEqual(
    dirs,
    [],
    'deleting a MODIFIED tracked ground file corrupts the ground, and a REMOVED path is already gone; ' +
      'neither is a licence to remove a directory',
  );
});

test('7.6.123: capture-then-clear — both steps happen, both are reported, and the ground hash comes back', () => {
  const { root, ground } = fixture();
  try {
    const before = groundManifest(ground);
    assert.notEqual(before, null);
    plantMintedOutput(ground);
    const during = groundManifest(ground);
    assert.notEqual(
      during!.digest,
      before!.digest,
      'the planted session must actually move the hash, or this door proves nothing',
    );

    const out = captureAndClearMintedSessions({
      root,
      project: 'gitpulse',
      storyId: 'S10',
      runStamp: '2026-09-18T03-45-22Z',
      producedPaths: [
        { kind: 'added', path: `${MINTED}/PLAN.md`, home: MINTED, writers: [] },
        { kind: 'added', path: `${MINTED}/status.json`, home: MINTED, writers: [] },
      ],
    });

    // CAPTURED — the bytes survive the removal.
    const dest = groundClearDir(root, 'S10', '2026-09-18T03-45-22Z');
    assert.deepEqual(out.captured, [MINTED]);
    assert.equal(out.dest, dest);
    assert.equal(
      readFileSync(join(dest, MINTED, 'PLAN.md'), 'utf8'),
      '# the plan\n',
      'the capture must hold the session\'s actual output, not a listing of it',
    );

    // CLEARED — and the ground is byte-identical to before the run.
    assert.deepEqual(out.cleared, [MINTED]);
    assert.equal(existsSync(join(ground, MINTED)), false);
    assert.equal(
      groundManifest(ground)!.digest,
      before!.digest,
      'the acceptance criterion: the ground hash is back at the pin after the clear',
    );

    // The ground's own furniture is untouched.
    assert.equal(existsSync(join(ground, '_project-brain', 'themes.md')), true);
    assert.equal(existsSync(join(ground, '.forge', 'skills', 'demo-design', 'SKILL.md')), true);
    assert.deepEqual(out.refused, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('7.6.123: a target that escapes the ground is REFUSED, and nothing outside it is touched', () => {
  const { root, ground } = fixture();
  try {
    const outsider = join(root, 'projects', 'other-ground');
    mkdirSync(outsider, { recursive: true });
    writeFileSync(join(outsider, 'keep.md'), 'not mine\n');

    const out = captureAndClearMintedSessions({
      root,
      project: 'gitpulse',
      storyId: 'S10',
      runStamp: 'stamp',
      producedPaths: [
        { kind: 'added', path: '../other-ground/keep.md', home: '../other-ground', writers: [] },
      ],
    });

    assert.deepEqual(out.cleared, []);
    assert.equal(out.refused.length, 1);
    assert.equal(out.refused[0]!.dir, '../other-ground');
    // The SHAPE check refuses it first — `../other-ground` is not `_<kind>/<id>`
    // — and that is the right order: the cheap syntactic refusal should fire
    // before anything touches the disk. The door asserts the OUTCOME (refused,
    // and the other ground still whole) rather than which guard spoke, because
    // pinning the message would make the order untouchable. The case that
    // reaches the containment guard proper is the symlink door below.
    assert.match(out.refused[0]!.reason, /not shaped/);
    assert.equal(existsSync(join(outsider, 'keep.md')), true, 'a refusal that still deleted is not a refusal');
    assert.equal(existsSync(ground), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('7.6.123: `.forge/` is REFUSED BY NAME even though a minted dir can never be shaped like it', () => {
  // `mintedSessionPaths` only ever yields `_<kind>/<id>`, so this is structurally
  // unreachable from a real run. The refusal is written and doored anyway: a
  // comment asserting a path cannot be reached is not a test, and `.forge/skills`
  // is the one path the acceptance criterion names.
  const { root, ground } = fixture();
  try {
    const out = captureAndClearMintedSessions({
      root,
      project: 'gitpulse',
      storyId: 'S10',
      runStamp: 'stamp',
      producedPaths: [
        { kind: 'added', path: '.forge/skills/demo-design/SKILL.md', home: '.forge/skills', writers: [] },
      ],
    });
    assert.deepEqual(out.cleared, []);
    assert.equal(out.refused.length, 1);
    assert.match(out.refused[0]!.reason, /\.forge/);
    assert.equal(existsSync(join(ground, '.forge', 'skills', 'demo-design', 'SKILL.md')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('7.6.123: a run that minted nothing writes no capture dir and says so at zero', () => {
  const { root } = fixture();
  try {
    const out = captureAndClearMintedSessions({
      root,
      project: 'gitpulse',
      storyId: 'S10',
      runStamp: 'stamp',
      producedPaths: [],
    });
    assert.deepEqual(out.captured, []);
    assert.deepEqual(out.cleared, []);
    assert.deepEqual(out.refused, []);
    assert.equal(out.dest, null, 'no minted session means no capture directory — an empty one reads as a failed capture');
    assert.equal(
      existsSync(join(root, '_logs', '_story-ground-clear')),
      false,
      'the zero case must not leave a directory behind: that would be residue created BY the residue check',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('7.6.123: the classifier hands out STRUCTURED paths, not its own display text', () => {
  // The consumer needs the PATH and its minted HOME. Re-parsing
  // `"A _architect/x/PLAN.md — inside _architect/x, a session this run minted"`
  // to find them would be reading a log line as an API — the same defect one
  // level down from the one this bead is about.
  const split = classifyOwnGroundDrift(
    { added: [`${MINTED}/PLAN.md`], removed: [], modified: ['README.md'] },
    [MINTED],
    new Map([['_architect/other', ['README.md']]]),
    groundIgnoreNoneForTests(),
  );
  assert.equal(split.produced.length, 2, 'both still render as lines for the operator');
  assert.deepEqual(
    split.producedPaths,
    [
      { kind: 'added', path: `${MINTED}/PLAN.md`, home: MINTED, writers: [] },
      { kind: 'modified', path: 'README.md', home: null, writers: ['_architect/other'] },
    ],
    'the structured half carries kind, path, minted home and attributing writers',
  );
  assert.deepEqual(
    mintedSessionDirsToClear(split.producedPaths),
    [MINTED],
    'and it feeds the clear directly, with no string parsing in between',
  );
});

test('7.6.123: a removal that CANNOT take is named, not swallowed, and the caller can go red on it', () => {
  // The gate in `run-story.mjs` reds on `unremoved`, so `unremoved` has to be
  // reachable or the gate is a branch nothing can enter. An unwritable ground
  // makes the unlink fail for real: `rmSync`'s `force` ignores a MISSING path
  // and nothing else, so this is EACCES from the kernel rather than a stubbed
  // failure. It also covers the crash that would otherwise happen here — an
  // uncaught throw at this point aborts the run AFTER the capture succeeded and
  // takes the whole end-of-run report with it.
  const { root, ground } = fixture();
  try {
    plantMintedOutput(ground);
    chmodSync(join(ground, '_architect'), 0o500); // r-x: cannot unlink the child
    const out = captureAndClearMintedSessions({
      root,
      project: 'gitpulse',
      storyId: 'S10',
      runStamp: 'stamp',
      producedPaths: [{ kind: 'added', path: `${MINTED}/PLAN.md`, home: MINTED, writers: [] }],
    });
    assert.deepEqual(out.captured, [MINTED], 'the capture must still have happened — the bytes are the point');
    assert.deepEqual(out.cleared, [], 'nothing may be reported cleared while it is still on disk');
    assert.deepEqual(out.unremoved, [MINTED]);
    assert.equal(out.refused.length, 1);
    assert.match(out.refused[0]!.reason, /removal threw/);
    assert.deepEqual(
      describeGroundClear(out, 'gitpulse').filter((l) => l.startsWith('own ground: CLEAR-DID-NOT-TAKE')).length,
      1,
      'the operator-facing line for this state must exist, or the finding reaches nobody',
    );
  } finally {
    try { chmodSync(join(ground, '_architect'), 0o700); } catch { /* already gone */ }
    rmSync(root, { recursive: true, force: true });
  }
});

test('7.6.123: a correctly-shaped minted dir that SYMLINKS out of the ground is refused, and the target survives', () => {
  // THE FINDING THIS DOOR EXISTS FOR. The first version of the containment
  // check was `resolve(groundDir, dir).startsWith(groundDir + sep)` — a lexical
  // claim about a string standing in for a physical claim about a filesystem.
  // `resolve` never touches the disk, so this exact shape passed it: a name
  // that IS `_<kind>/<id>`, sitting lexically inside the ground, pointing
  // anywhere at all. The `rmSync` would then have deleted the link's TARGET
  // while the guard reported success. `forge-8vfn.7.6.55a` found four
  // destructive `rmSync` calls that had skipped this guard; the prefix test
  // would have made this the fifth.
  const { root, ground } = fixture();
  try {
    const outside = join(root, 'NOT-THE-GROUND');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'precious.md'), 'must survive\n');
    mkdirSync(join(ground, '_architect'), { recursive: true });
    symlinkSync(outside, join(ground, MINTED));

    const out = captureAndClearMintedSessions({
      root,
      project: 'gitpulse',
      storyId: 'S10',
      runStamp: 'stamp',
      producedPaths: [{ kind: 'added', path: `${MINTED}/precious.md`, home: MINTED, writers: [] }],
    });

    assert.deepEqual(out.cleared, [], 'nothing may be reported cleared');
    assert.deepEqual(out.captured, [], 'and nothing may be captured out of a directory we refused');
    assert.equal(out.refused.length, 1);
    assert.match(out.refused[0]!.reason, /outside the ground|path guard/);
    assert.equal(
      readFileSync(join(outside, 'precious.md'), 'utf8'),
      'must survive\n',
      'the symlink target is outside the ground and must be untouched, bytes and all',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('7.6.123: the path-segment guard shape — over the length cap, and stringified nullish, are both refused', () => {
  // `mintedSessionPaths` derives the id from `/^_([A-Za-z][A-Za-z0-9]*)-(.+)$/`
  // against directory names READ OFF DISK, and `.+` bounds neither length nor
  // charset. `forge-8vfn.7.6.55a` found four destructive `rmSync` calls missing
  // exactly this, one of them for the length cap alone, so both halves of
  // `assertSafeSessionId`'s shape get a door rather than a comment.
  const root = mkdtempSync(join(tmpdir(), 'ground-clear-guard-'));
  try {
    mkdirSync(join(root, 'projects', 'gitpulse'), { recursive: true });
    const clear = (home: string) =>
      captureAndClearMintedSessions({
        root,
        project: 'gitpulse',
        storyId: 'S10',
        runStamp: 'stamp',
        producedPaths: [{ kind: 'added', path: `${home}/x`, home, writers: [] }],
      });

    const long = clear(`_architect/${'a'.repeat(200)}`);
    assert.deepEqual(long.cleared, []);
    assert.match(long.refused[0]!.reason, /over the 128-character cap/);

    const nullish = clear('_architect/undefined');
    assert.deepEqual(nullish.cleared, []);
    assert.match(nullish.refused[0]!.reason, /stringified-nullish/);

    // And the control: a well-formed id of ordinary length is NOT refused by
    // either — it reports absent, because nothing is there to remove. A guard
    // that refused everything would pass both assertions above and be useless.
    const fine = clear('_architect/2026-09-18T03-45-41-0b536f73');
    assert.deepEqual(fine.refused, [], 'a legitimate session id must reach the disk check, not a refusal');
    assert.deepEqual(fine.absent, ['_architect/2026-09-18T03-45-41-0b536f73']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('7.6.123: a symlink at the minted dir\'s PARENT is refused — this is the shape that actually destroys data', () => {
  // MEASURED, NOT ARGUED, and the measurement changed what this door is about.
  // Both symlink shapes passed the lexical prefix check and both reported
  // CLEARED, but their blast radii differ:
  //
  //   link AT the minted dir      `rmSync` unlinks the LINK; the target file
  //                               survives. A misreport, not data loss.
  //   link at its PARENT          `<ground>/_architect` -> outside, so
  //                               `<ground>/_architect/<id>` is a REAL directory
  //                               outside the ground, and `rmSync` recursive
  //                               DELETED the file in it. Measured: survives=false.
  //
  // So this is the shape with teeth, and it is the reason the containment check
  // has to realpath every segment rather than only the leaf.
  const { root, ground } = fixture();
  try {
    const outside = join(root, 'NOT-THE-GROUND');
    mkdirSync(join(outside, SESSION), { recursive: true });
    writeFileSync(join(outside, SESSION, 'precious.md'), 'must survive\n');
    symlinkSync(outside, join(ground, '_architect'));

    const out = captureAndClearMintedSessions({
      root,
      project: 'gitpulse',
      storyId: 'S10',
      runStamp: 'stamp',
      producedPaths: [{ kind: 'added', path: `${MINTED}/precious.md`, home: MINTED, writers: [] }],
    });

    assert.deepEqual(out.cleared, [], 'nothing outside the ground may ever be reported cleared');
    assert.deepEqual(out.captured, []);
    assert.equal(out.refused.length, 1);
    assert.match(out.refused[0]!.reason, /outside the ground|path guard/);
    assert.equal(
      readFileSync(join(outside, SESSION, 'precious.md'), 'utf8'),
      'must survive\n',
      'the lexical prefix check DELETED this file; the identity guard must not',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('7.6.123 WIRING: the runner actually calls the clear, with the classifier\'s own structured paths, and reds on a survivor', () => {
  // THE MODULE IS DOORED; THE CONNECTION IS THE UNTESTED PART, and that is the
  // exact species this bead is about — a fact that exists and reaches nothing.
  // No test in this repo imports `runStory`, so without this the whole fix
  // could be correct and unreachable: `producedPaths` computed, the clear
  // written, and nothing in the runner calling it.
  //
  // Static, and via `runnerSourceContaining` rather than a filename, because
  // `forge-0fli` already paid for the filename version: three doors did
  // `readFileSync('./run.mjs')`, the beat loop moved to `run-story.mjs`, and
  // all three went red without a behaviour changing. The anchors below carry
  // `=` and `(` so a comment cannot satisfy them, which is the one thing that
  // helper says it cannot enforce for itself.
  const CALL = 'ownGroundDrift.clear = captureAndClearMintedSessions(';
  const RED = 'ownGroundDrift.clear.unremoved.length > 0';
  const runner = runnerSourceContaining(CALL);

  assert.match(
    runner.source,
    /import \{[^}]*captureAndClearMintedSessions[^}]*\} from '\.\/ground-clear\.mjs'/s,
    'the caller must import the clear from ground-clear.mjs',
  );

  // THE ARGUMENT IS THE CLASSIFIER'S OWN OUTPUT. A call passing a list this
  // module re-derived would be a second notion of "what did the run mint", and
  // the two would drift apart silently — which is `handleFor`'s lesson and the
  // reason `producedPaths` exists at all.
  const callAt = runner.source.indexOf(CALL);
  const callBlock = runner.source.slice(callAt, runner.source.indexOf('});', callAt));
  assert.match(callBlock, /producedPaths:\s*split\.producedPaths/, 'the clear must be fed the classifier\'s structured paths');
  assert.match(callBlock, /root:\s*ROOT/);
  assert.match(callBlock, /project:\s*story\.ground\.project/);

  // BOTH HALVES REPORTED. A clear that ran and said nothing is the state this
  // bead started from, one step later.
  assert.match(runner.source, /describeGroundClear\(/, 'the clear\'s own lines must be printed');

  // AND THE GATE. A minted dir surviving the clear must end the run non-zero;
  // a reported-and-continue would leave the next run to refuse on the hash,
  // which is the behaviour being fixed.
  const redAt = runner.source.indexOf(RED);
  assert.notEqual(redAt, -1, 'the survivor check must exist in the runner');
  const redBlock = runner.source.slice(redAt, redAt + 900);
  assert.match(redBlock, /CONTAINMENT FAILURE/, 'and be named as a containment failure like its siblings');
  assert.match(redBlock, /return 1;/, 'and actually return non-zero');
  assert.ok(
    redBlock.indexOf('return 1;') < redBlock.indexOf('groundEscapes'),
    'the return must belong to THIS check and not to the next one down',
  );
});

/*
 * `forge-8vfn.7.6.137` — the runner clears the `_logs` sessions IT minted.
 *
 * 7.6.123 did the GROUND half. The `_logs` half was never done, so every costed
 * run left its own `_agent-*` behind and the NEXT run's §15.427 residue door
 * refused on it. Measured, not supposed: S9 run 7's leavings blocked run 8, and
 * run 8's blocked S3 run 3 — each time at $0, each time paid off by a hand
 * capture-then-clear. The door was right every time; the cost was that nothing
 * cleared up after itself.
 *
 * DERIVED FROM WHAT THIS RUN MINTED, NEVER FROM A `_*` PATTERN. A pattern would
 * sweep `_logs/INIT-*` fixtures and any sibling's dirs; the before/after diff
 * plus a session marker names only what appeared during this run.
 */
describe('7.6.137: the runner clears its own minted _logs sessions', () => {
  test('mintedSessionDirNames names what appeared, by the SAME predicate as mintedSessionPaths', () => {
    const dir = mkdtempSync(join(tmpdir(), 'logs-clear-'));
    const mk = (name: string, marker: string | null) => {
      mkdirSync(join(dir, name), { recursive: true });
      if (marker !== null) writeFileSync(join(dir, name, marker), '{}\n');
    };
    mk('_agent-onboarding-2026-09-18T01-02-03-abcd', 'events.jsonl');  // minted this run
    mk('_authoring-2026-09-18T01-02-04-efgh', '.heartbeat');           // minted this run
    mk('_bridge-2026-09-18T01-02-05-ijkl', null);                      // no marker: not a session
    mk('INIT-2026-01-01-spawn-capture', 'events.jsonl');               // not `_<kind>-<id>`
    mk('_agent-older-2026-09-01T00-00-00-zzzz', 'events.jsonl');       // present BEFORE

    const before = ['_agent-older-2026-09-01T00-00-00-zzzz'];
    const after = readdirSync(dir);
    const names = mintedSessionDirNames(before, after, dir);
    assert.deepEqual(names, [
      '_agent-onboarding-2026-09-18T01-02-03-abcd',
      '_authoring-2026-09-18T01-02-04-efgh',
    ], 'only dirs that APPEARED and carry a session marker — never a pattern, never a pre-existing dir');

    // The two forms must agree, because they are one fact in two shapes.
    const paths = mintedSessionPaths(before, after, dir);
    assert.equal(paths.length, names.length, 'the `_kind/id` and `_kind-id` forms must name the same set');
    rmSync(dir, { recursive: true, force: true });
  });

  test('capture-then-clear: captured first, removed second, confirmed by re-read', () => {
    const root = mkdtempSync(join(tmpdir(), 'logs-clear-root-'));
    const logsDir = join(root, '_logs');
    mkdirSync(join(logsDir, '_agent-x-2026-09-18T01-02-03-abcd'), { recursive: true });
    writeFileSync(join(logsDir, '_agent-x-2026-09-18T01-02-03-abcd', 'events.jsonl'), '{"a":1}\n');

    const res = captureAndClearMintedLogs({
      root, storyId: 'S3', runStamp: '2026-09-18T01-02-03Z',
      mintedNames: ['_agent-x-2026-09-18T01-02-03-abcd'],
    });
    assert.deepEqual(res.captured, ['_agent-x-2026-09-18T01-02-03-abcd']);
    assert.deepEqual(res.cleared, ['_agent-x-2026-09-18T01-02-03-abcd']);
    assert.equal(existsSync(join(logsDir, '_agent-x-2026-09-18T01-02-03-abcd')), false, 'removed from _logs');
    assert.equal(
      readFileSync(join(res.dest!, '_agent-x-2026-09-18T01-02-03-abcd', 'events.jsonl'), 'utf8'), '{"a":1}\n',
      'and its contents survive in the capture — a clear that loses the evidence is worse than no clear',
    );
    rmSync(root, { recursive: true, force: true });
  });

  test('a name that is not shaped _<kind>-<id> is REFUSED, not removed', () => {
    const root = mkdtempSync(join(tmpdir(), 'logs-clear-guard-'));
    mkdirSync(join(root, '_logs'), { recursive: true });
    mkdirSync(join(root, '_logs', 'INIT-fixture'), { recursive: true });
    const res = captureAndClearMintedLogs({
      root, storyId: 'S3', runStamp: 'x', mintedNames: ['INIT-fixture', '../escape', 'null'],
    });
    assert.deepEqual(res.cleared, [], 'nothing outside the shape is ever removed');
    assert.equal(res.refused.length, 3);
    assert.equal(existsSync(join(root, '_logs', 'INIT-fixture')), true, 'the fixture is still there');
    rmSync(root, { recursive: true, force: true });
  });

  test('zero minted renders as "no clear ran", never as "0 cleared"', () => {
    // The IGNORED-BY-GROUND rule: an absent case and an empty one must not read
    // the same way. A `0` from a directory that never existed once reached the
    // ledger as a measurement.
    const res = captureAndClearMintedLogs({ root: '/nonexistent', storyId: 'S3', runStamp: 'x', mintedNames: [] });
    assert.equal(res.dest, null);
    assert.deepEqual(res.captured, []);
    const lines = describeLogsClear(res);
    assert.match(lines.join('\n'), /minted no session/);
  });
});

/**
 * `forge-8vfn.7.6.146` (T1 1160/1164) — A RUN CLEARS EVERY ARTEFACT IT MINTED.
 *
 * 7.6.123 did the ground half, 7.6.137 the `_logs` sessions half. Run 20 and run
 * 21 then showed there are THREE more, and the next costed run's residue door
 * refused on each in turn, at $0 each:
 *
 *   run 21 dispatch 1  _queue/in-flight=1   the initiative's `.md.heartbeat`
 *   run 21 dispatch 2  _worktrees=2         `<id>` and the `wi` container
 *   (run 21 itself)    _logs/<ts>_INIT-*=1  the develop cycle dir
 *
 * Each refusal was correct. What was missing is that nothing in the PRODUCT
 * cleared them, so a human did it three times.
 *
 * DERIVED, NEVER A PATTERN — the ids come from the queue sweep that already
 * ATTRIBUTED those manifests to this run by `created_at`. A `_worktrees/*` sweep
 * would take a concurrent lane's trees with it.
 */
test('7.6.146: the artefacts of a claimed initiative are derived from its id, and nothing else is', () => {
  const root = mkdtempSync(join(tmpdir(), 'story-run-artefacts-'));
  const id = 'INIT-2026-09-18-exclude-author-filter';
  const other = 'INIT-someone-elses-run';

  mkdirSync(join(root, '_queue', 'in-flight'), { recursive: true });
  writeFileSync(join(root, '_queue', 'in-flight', `${id}.md.heartbeat`), 'x');
  writeFileSync(join(root, '_queue', 'in-flight', `${other}.md.heartbeat`), 'x');
  mkdirSync(join(root, '_worktrees', id), { recursive: true });
  mkdirSync(join(root, '_worktrees', 'wi', id), { recursive: true });
  mkdirSync(join(root, '_worktrees', other), { recursive: true });
  mkdirSync(join(root, '_logs', `2026-09-18T12-36-31_${id}`), { recursive: true });
  mkdirSync(join(root, '_logs', `2026-09-18T09-00-00_${other}`), { recursive: true });

  const found = mintedRunArtefactsToClear({ root, initiativeIds: [id] });
  const rel = found.map((p) => p.replace(`${root}/`, '')).sort();

  assert.deepEqual(rel, [
    `_logs/2026-09-18T12-36-31_${id}`,
    `_queue/in-flight/${id}.md.heartbeat`,
    `_worktrees/${id}`,
    `_worktrees/wi/${id}`,
  ], 'exactly this run\'s four, derived from the id the queue sweep attributed');

  assert.ok(!rel.some((p) => p.includes(other)),
    'another run\'s artefacts share every shape and differ only by id — a pattern sweep would take them');
  rmSync(root, { recursive: true, force: true });
});

/** The `wi` CONTAINER is emptied too, or residue still counts it. `residue.sh`
 *  gates on `ls -1 _worktrees | grep -c .`, so leaving an empty `wi/` behind
 *  scores 1 and the next run still refuses — the fix would look done and not be. */
test('7.6.146: clearing empties the wi container, because residue counts it', () => {
  const root = mkdtempSync(join(tmpdir(), 'story-run-artefacts-wi-'));
  const id = 'INIT-x';
  mkdirSync(join(root, '_worktrees', 'wi', id), { recursive: true });
  mkdirSync(join(root, '_worktrees', id), { recursive: true });

  const r = captureAndClearMintedRunArtefacts({ root, storyId: 'S10', runStamp: 'T', initiativeIds: [id] });
  assert.equal(r.refused.length, 0, JSON.stringify(r.refused));

  const left = readdirSync(join(root, '_worktrees'));
  assert.deepEqual(left, [], 'both the id tree and the emptied wi container are gone — residue gates on this count');
  rmSync(root, { recursive: true, force: true });
});

/** Capture is PROVEN before clear (T1 1164). A capture that fails leaves the
 *  artefact alone and says so — the same contract as the two clears above. */
test('7.6.146: what cannot be captured is not removed', () => {
  const root = mkdtempSync(join(tmpdir(), 'story-run-artefacts-cap-'));
  const id = 'INIT-y';
  mkdirSync(join(root, '_worktrees', id), { recursive: true });

  const r = captureAndClearMintedRunArtefacts({
    root, storyId: 'S10', runStamp: 'T', initiativeIds: [id],
    capture: () => { throw new Error('synthetic capture failure'); },
  });
  assert.equal(r.cleared.length, 0);
  assert.match(r.refused[0].reason, /not removing what was not captured/);
  assert.ok(existsSync(join(root, '_worktrees', id)), 'still there — nothing is removed on a failed capture');
  rmSync(root, { recursive: true, force: true });
});
