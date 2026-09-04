/**
 * bead forge-8vfn.17, defect 1 of 3 — the G1 gate failure of 2026-09-04.
 *
 * `captureCheckpoints` interpolated a checkpoint LABEL straight into a path at
 * two sites (`${label}.out`, `${label}.png`). The labels come from the
 * initiative's `demo.json`, which an agent authors, so a label containing `/`
 * both CRASHED the capture (ENOENT — the parent directory does not exist) and,
 * had the parent existed, would have written the artifact OUTSIDE the capture
 * directory. The live run hit the first; the second is the same bug with a
 * luckier directory tree.
 *
 * `demo.test.ts` says of this path: "side-effecting and validated via the live
 * trafficGame run". That is why the defect survived — the only test of it was a
 * run nobody had made in months. The decision is extracted here so it can be
 * tested as a decision.
 *
 * The containment claim is asserted on the ARTIFACT, not on the return value:
 * the file must exist inside the capture dir and nothing may appear outside it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

import { checkpointArtifactName, checkpointArtifactStem } from './demo-types.ts';
import { mergeCapturedMedia, type DemoModel } from './demo-model.ts';

test('a safe label is returned UNCHANGED — existing demo bundles keep their filenames', () => {
  for (const label of ['home', 'run-detail', 'flow_builder', 'step.2', 'A1']) {
    assert.equal(checkpointArtifactName(label, 'out'), `${label}.out`,
      'renaming a safe label would break pairing with every demo.json already on disk');
  }
});

test('a label carrying a path separator cannot name anything outside its directory', () => {
  for (const label of ['a/b', '../../etc/passwd', 'x\\y', '..', '.', '/abs', 'a/../../b']) {
    const name = checkpointArtifactName(label, 'png');
    assert.ok(!name.includes('/'), `"${label}" -> "${name}" still contains /`);
    assert.ok(!name.includes('\\'), `"${label}" -> "${name}" still contains \\`);
    assert.ok(!name.includes(sep), `"${label}" -> "${name}" still contains the platform separator`);
    assert.ok(!name.split('.').includes('..'), `"${label}" -> "${name}" still contains a ".." segment`);
    assert.ok(name.length > 0 && name !== '.png', `"${label}" -> "${name}" is empty or extension-only`);
  }
});

test('CONTAINMENT, asserted on the artifact: writing under a hostile label lands inside the capture dir and nowhere else', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-cp-name-'));
  try {
    const capDir = join(root, 'bundle', 'before');
    mkdirSync(capDir, { recursive: true });
    const outsideMarker = join(root, 'OUTSIDE-SHOULD-NOT-EXIST');
    // The label the live G1 run actually carried a separator in, plus a climb.
    for (const label of ['forge studio/home', '../../OUTSIDE-SHOULD-NOT-EXIST']) {
      const target = join(capDir, checkpointArtifactName(label, 'out'));
      writeFileSync(target, 'evidence\n');
      assert.ok(resolve(target).startsWith(resolve(capDir) + sep),
        `"${label}" resolved to ${target}, outside ${capDir}`);
    }
    assert.ok(!existsSync(outsideMarker), 'a capture wrote outside the capture directory');
    assert.deepEqual(readdirSync(root).sort(), ['bundle'], 'the capture dir must be the only thing created');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('two different hostile labels do not collide into one filename (evidence would silently overwrite evidence)', () => {
  const a = checkpointArtifactName('a/b', 'out');
  const b = checkpointArtifactName('a-b', 'out');
  assert.notEqual(a, b, 'distinct labels must keep distinct artifacts');
});

test('the stem is what a captured filename yields back, so the merger can pair a slugged artifact to its checkpoint', () => {
  for (const label of ['home', 'forge studio/home', '../../etc/passwd']) {
    const name = checkpointArtifactName(label, 'out');
    assert.equal(name.replace(/\.out$/, ''), checkpointArtifactStem(label),
      'collectCapturedMedia derives a label by stripping the extension; the merger must be able to recompute it from the checkpoint label');
  }
});

test('END TO END: a hostile label\'s evidence reaches the checkpoint the operator declared, and no duplicate is appended', () => {
  const label = 'forge studio/home';
  // What `collectCapturedMedia` would hand back: it derives its label from the
  // FILENAME, which is now the slugged stem, not the operator's label.
  const captured = [{ label: checkpointArtifactStem(label), beforeOutput: 'BEFORE\n', afterOutput: 'AFTER\n' }];
  const model: DemoModel = {
    title: 'T', essence: 'E', project: 'gitpulse', diffStat: 'd',
    checkpoints: [{ label, caption: 'CLI run', command: 'node dist/cli.js home' }],
  };
  const merged = mergeCapturedMedia(model, captured);
  assert.equal(merged.checkpoints.length, 1,
    'the captured entry must pair with the declared checkpoint, not be appended as a second one');
  assert.equal(merged.checkpoints[0].label, label, 'the operator\'s label survives');
  assert.equal(merged.checkpoints[0].beforeOutput, 'BEFORE\n');
  assert.equal(merged.checkpoints[0].afterOutput, 'AFTER\n');
});

// --- attacking the fix itself (adversarial-containment-review: a containment fix
// --- is where the next containment bug ships). Both of these were live against
// --- the first draft of `checkpointArtifactStem`.

test('ATTACK: an over-long label is capped — the first draft returned it unchanged and the write died with ENAMETOOLONG', () => {
  const name = checkpointArtifactName('a'.repeat(300), 'out');
  assert.ok(name.length < 160, `a ${name.length}-character filename is the original defect through a different errno`);
  assert.ok(!name.includes('/'), 'capping must not reintroduce a separator');
});

test('ATTACK: the literal dot segments are the only traversal-capable safe strings, and both are slugged', () => {
  for (const label of ['.', '..']) {
    const stem = checkpointArtifactStem(label);
    assert.notEqual(stem, label, `"${label}" must not survive as a filename`);
    assert.ok(!['.', '..'].includes(stem));
  }
  // ...and legitimate dotted names are NOT over-rejected (a false rejection here
  // silently renames an operator's checkpoint for no reason).
  for (const label of ['...', '..a', 'a..b', '.hidden', 'a.']) {
    assert.equal(checkpointArtifactStem(label), label, `"${label}" is a legal filename and must pass through`);
  }
});
