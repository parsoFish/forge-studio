/**
 * The fence's second dimension: what a run did INSIDE a ground it does not own.
 *
 * Bead `forge-8vfn.6.11.26` / §15.219. `snapshotSiblingWorktrees` lists the
 * immediate CHILDREN of each ignored root, so a whole new ground appearing is
 * visible — but an edit inside a ground that already exists is not, and its own
 * comment said so before the incident proved it. S1 run 8 onboarded the MAIN
 * CHECKOUT's `projects/gitweave` (`adebdb6399d7453d` → `7fb19c79739ddd7c`:
 * `.gitignore` +5, `CLAUDE.md` +3, a whole `.forge/`, `roadmap.md`) and the
 * fence reported nothing, because `projects/gitweave` already existed. What
 * caught it was the launcher's own before/after hash, by hand. This makes that
 * hand check the fence's own.
 *
 * The digest is METHOD C — the campaign's recorded ground references
 * (`adebdb6399d7453d`, `3f4d76708ff073b3`, `2343d907ddb5703f`) are method-C
 * numbers, and a fence that printed a different number for the same tree could
 * not be compared with them. Parity is asserted below against the real
 * pipeline rather than assumed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { METHOD_C_CMD, groundManifest, groundChanges, snapshotSiblingGrounds, siblingGroundEscapes } from './ground-hash.mjs';

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ground-hash-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'CLAUDE.md'), 'project instructions\n');
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n');
  writeFileSync(join(dir, 'src', 'main.py'), 'print("hi")\n');
  // Both excluded by method C — a ground is a real clone and walking these
  // twice a run is exactly the cost the depth-one listing existed to avoid.
  mkdirSync(join(dir, 'node_modules', 'left-pad'), { recursive: true });
  writeFileSync(join(dir, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1;\n');
  mkdirSync(join(dir, '.git'), { recursive: true });
  writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  return dir;
}

/** The literal pipeline the launcher runs, so parity is measured, not claimed. */
function methodCByShell(dir: string): string {
  const out = execFileSync('sh', ['-c', `${METHOD_C_CMD} | sha256sum | cut -c1-16`], { cwd: dir, encoding: 'utf8' });
  return out.trim();
}

test('groundManifest: the digest IS method C — byte-for-byte the number the launcher records', () => {
  const dir = fixture();
  try {
    const m = groundManifest(dir);
    assert.notEqual(m, null, 'a present ground must produce a manifest');
    assert.equal(m!.digest, methodCByShell(dir), 'the fence and the launcher must name the same ground by the same number');
    assert.match(m!.digest, /^[0-9a-f]{16}$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('groundManifest: node_modules and .git are excluded — the cost objection the depth-one listing raised', () => {
  const dir = fixture();
  try {
    const files = [...groundManifest(dir)!.files.keys()];
    assert.ok(files.every((f) => !f.includes('node_modules') && !f.includes('.git/')), `excluded paths leaked in: ${files.join(', ')}`);
    assert.deepEqual(files.sort(), ['./.gitignore', './CLAUDE.md', './src/main.py']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('groundManifest: an absent ground is null, not an empty manifest — "never existed" and "emptied" are different findings', () => {
  assert.equal(groundManifest(join(tmpdir(), 'ground-hash-no-such-dir-xyz')), null);
});

test('groundChanges: names the files — a digest alone tells the operator something moved, not what', () => {
  const dir = fixture();
  try {
    const before = groundManifest(dir)!;
    writeFileSync(join(dir, 'CLAUDE.md'), 'project instructions\nplus a gate command\n');
    writeFileSync(join(dir, 'roadmap.md'), '# roadmap\n');
    rmSync(join(dir, 'src', 'main.py'));
    const changes = groundChanges(before, groundManifest(dir)!);
    assert.deepEqual(changes.modified, ['./CLAUDE.md']);
    assert.deepEqual(changes.added, ['./roadmap.md']);
    assert.deepEqual(changes.removed, ['./src/main.py']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('siblingGroundEscapes: a planted edit inside a sibling worktree\'s ground is a finding, naming the file', () => {
  const sibling = mkdtempSync(join(tmpdir(), 'ground-sibling-'));
  try {
    const ground = join(sibling, 'projects', 'gitweave');
    mkdirSync(ground, { recursive: true });
    writeFileSync(join(ground, 'CLAUDE.md'), 'instructions\n');

    const dirs = () => [sibling];
    const before = snapshotSiblingGrounds('gitweave', { dirs });

    // Exactly the shape of S1 run 8: the agent appended the C2 .gitignore block
    // and the gate command to a ground in a tree the run did not own.
    writeFileSync(join(ground, '.gitignore'), '.forge/work-items/\n');
    writeFileSync(join(ground, 'CLAUDE.md'), 'instructions\nrun: pytest\n');

    const found = siblingGroundEscapes('gitweave', before, { dirs });
    assert.equal(found.length, 1, 'the changed ground must be reported');
    assert.equal(found[0].root, sibling);
    assert.deepEqual(found[0].changes.added, ['./.gitignore']);
    assert.deepEqual(found[0].changes.modified, ['./CLAUDE.md']);
    assert.notEqual(found[0].before, found[0].after, 'the two method-C digests must differ and both be reported');
  } finally {
    rmSync(sibling, { recursive: true, force: true });
  }
});

test('siblingGroundEscapes: an UNTOUCHED ground is not a finding — the positive control', () => {
  const sibling = mkdtempSync(join(tmpdir(), 'ground-sibling-clean-'));
  try {
    const ground = join(sibling, 'projects', 'gitweave');
    mkdirSync(ground, { recursive: true });
    writeFileSync(join(ground, 'CLAUDE.md'), 'instructions\n');
    const dirs = () => [sibling];
    const before = snapshotSiblingGrounds('gitweave', { dirs });
    assert.deepEqual(siblingGroundEscapes('gitweave', before, { dirs }), []);
  } finally {
    rmSync(sibling, { recursive: true, force: true });
  }
});

test('siblingGroundEscapes: a ground APPEARING in a tree that had none is a finding too', () => {
  const sibling = mkdtempSync(join(tmpdir(), 'ground-sibling-new-'));
  try {
    const dirs = () => [sibling];
    const before = snapshotSiblingGrounds('gitweave', { dirs });
    const ground = join(sibling, 'projects', 'gitweave');
    mkdirSync(ground, { recursive: true });
    writeFileSync(join(ground, 'CLAUDE.md'), 'planted\n');
    const found = siblingGroundEscapes('gitweave', before, { dirs });
    assert.equal(found.length, 1);
    assert.equal(found[0].before, null, 'the ground was absent before');
    assert.deepEqual(found[0].changes.added, ['./CLAUDE.md']);
  } finally {
    rmSync(sibling, { recursive: true, force: true });
  }
});

test('siblingGroundEscapes: with no ground declared the fence asks nothing — a story without a ground has none to protect', () => {
  assert.deepEqual(siblingGroundEscapes(null, new Map(), { dirs: () => ['/nonexistent'] }), []);
});
