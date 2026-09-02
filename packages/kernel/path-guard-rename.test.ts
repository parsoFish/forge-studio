/**
 * path-guard-rename.test.ts — containment tests for `guardedRename`, the
 * additive directory-move primitive added to `path-guard.ts` for the
 * project-contract reset (which relocates directories inside a managed
 * project's repo from a request-supplied project id).
 *
 * Every case below names the ESCAPE SHAPE it kills, per the
 * `adversarial-containment-review` skill's catalogue: directory symlink,
 * nested/intermediate symlink (not just the leaf), `..`-traversal, an
 * absolute-path-shaped segment, a dangling symlink, and a clobber attempt.
 * Each rejection test additionally asserts the FILESYSTEM STATE after the
 * throw — not merely that it threw — because a guard that throws AFTER
 * already writing something is not a guard.
 *
 * No mocks of `node:fs`: this is a containment guard over real filesystem
 * identity (symlinks, hardlinks, realpath), which a mock cannot model
 * faithfully. Every fixture is a real temp directory, cleaned up in a
 * `finally`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  lstatSync,
  readlinkSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { guardedRename, PathGuardContainmentError } from './path-guard.ts';

function withRoot(fn: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'guard-rename-'));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function withRootAndOutside(fn: (root: string, outside: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'guard-rename-'));
  const outside = mkdtempSync(join(tmpdir(), 'guard-rename-OUTSIDE-'));
  try {
    fn(root, outside);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
}

function snapshot(root: string): string[] {
  return (readdirSync(root, { recursive: true } as { recursive: true }) as string[]).sort();
}

test('happy path: a real directory moves under the same root, contents intact, source gone', () => {
  withRoot((root) => {
    const srcDir = join(root, 'srcdir');
    mkdirSync(srcDir);
    mkdirSync(join(srcDir, 'nested'));
    writeFileSync(join(srcDir, 'file.txt'), 'payload');
    writeFileSync(join(srcDir, 'nested', 'inner.txt'), 'inner-payload');

    guardedRename(root, ['srcdir'], ['dstdir']);

    assert.equal(existsSync(srcDir), false, 'the source directory must be gone');
    const dstDir = join(root, 'dstdir');
    assert.equal(existsSync(dstDir), true, 'the destination directory must exist');
    assert.equal(readFileSync(join(dstDir, 'file.txt'), 'utf8'), 'payload', 'top-level file contents must survive the move');
    assert.equal(
      readFileSync(join(dstDir, 'nested', 'inner.txt'), 'utf8'),
      'inner-payload',
      'nested file contents must survive the move',
    );
  });
});

test('a ".." segment in fromSegments is rejected — traversal cannot select the rename source', () => {
  withRoot((root) => {
    mkdirSync(join(root, 'child'));
    writeFileSync(join(root, 'secret.txt'), 'do-not-move-me');

    assert.throws(
      () => guardedRename(root, ['child', '..', 'secret.txt'], ['stolen.txt']),
      PathGuardContainmentError,
      'a ".." segment anywhere in fromSegments must be rejected',
    );
    assert.equal(existsSync(join(root, 'stolen.txt')), false, 'nothing must have been created at the destination');
    assert.equal(readFileSync(join(root, 'secret.txt'), 'utf8'), 'do-not-move-me', 'the real file must be untouched');
  });
});

test('a ".." segment in toSegments is rejected — traversal cannot select the rename destination', () => {
  withRoot((root) => {
    const srcDir = join(root, 'srcdir');
    mkdirSync(srcDir);
    writeFileSync(join(srcDir, 'file.txt'), 'payload');
    mkdirSync(join(root, 'sub'));

    assert.throws(
      () => guardedRename(root, ['srcdir'], ['sub', '..', '..', 'escaped']),
      PathGuardContainmentError,
      'a ".." segment anywhere in toSegments must be rejected',
    );
    assert.equal(existsSync(srcDir), true, 'the source directory must still be there');
    assert.equal(readFileSync(join(srcDir, 'file.txt'), 'utf8'), 'payload', 'the source contents must be untouched');
  });
});

test('an absolute-path-shaped segment in fromSegments is rejected (isSafeSegment denies an embedded "/")', () => {
  withRoot((root) => {
    assert.throws(
      () => guardedRename(root, ['/etc/passwd'], ['dest']),
      PathGuardContainmentError,
      'a segment carrying an embedded "/" must be rejected as unsafe, never joined literally',
    );
    assert.equal(existsSync(join(root, 'dest')), false, 'nothing must have been created');
  });
});

test('an absolute-path-shaped segment in toSegments is rejected (isSafeSegment denies an embedded "/")', () => {
  withRoot((root) => {
    const srcDir = join(root, 'srcdir');
    mkdirSync(srcDir);
    writeFileSync(join(srcDir, 'file.txt'), 'payload');

    assert.throws(
      () => guardedRename(root, ['srcdir'], ['/etc/passwd']),
      PathGuardContainmentError,
      'a destination segment carrying an embedded "/" must be rejected',
    );
    assert.equal(existsSync(srcDir), true, 'the source directory must still be there');
  });
});

test('a symlinked SOURCE directory is rejected — identity mismatch, the link itself is never renamed', () => {
  withRootAndOutside((root, outside) => {
    const link = join(root, 'link');
    symlinkSync(outside, link);
    assert.ok(lstatSync(link).isSymbolicLink(), 'arrange: the source entry must be a symlink or the test is vacuous');

    // Containment requires the SOURCE to be a real, identity-verified entry —
    // "somewhere under root" (which a symlinked entry lexically is) is not
    // the guarantee; "exactly this expected path, not a link" is. Renaming a
    // planted symlink would let an attacker relocate/rename an out-of-root
    // pointer under a supposedly controlled root, which is refused outright
    // rather than asking what raw `renameSync` would have done with it.
    assert.throws(
      () => guardedRename(root, ['link'], ['dest']),
      PathGuardContainmentError,
      'a symlinked source must be rejected before any rename is attempted',
    );

    assert.ok(lstatSync(link).isSymbolicLink(), 'the link itself must still be there, unrenamed');
    assert.equal(readlinkSync(link), outside, 'the link must still point at its original target, untouched');
    assert.equal(existsSync(join(root, 'dest')), false, 'no destination must have been created');
  });
});

test('a symlinked DESTINATION parent directory pointing outside root is rejected', () => {
  withRootAndOutside((root, outside) => {
    const srcDir = join(root, 'srcdir');
    mkdirSync(srcDir);
    writeFileSync(join(srcDir, 'file.txt'), 'payload');

    const parentLink = join(root, 'plink');
    symlinkSync(outside, parentLink);
    assert.ok(lstatSync(parentLink).isSymbolicLink(), 'arrange: the destination parent must be a symlink or the test is vacuous');

    assert.throws(
      () => guardedRename(root, ['srcdir'], ['plink', 'child']),
      PathGuardContainmentError,
      'a symlinked destination parent must be rejected',
    );

    assert.equal(existsSync(srcDir), true, 'the source directory must still be there');
    assert.equal(readFileSync(join(srcDir, 'file.txt'), 'utf8'), 'payload', 'source contents untouched');
    assert.equal(existsSync(join(outside, 'child')), false, 'nothing must have been written through the symlink target');
    assert.equal(readlinkSync(parentLink), outside, 'the parent link itself must be untouched');
  });
});

test('a symlinked intermediate (non-leaf, non-parent) component on the SOURCE side is rejected', () => {
  withRootAndOutside((root, outside) => {
    // fromSegments = ['a', 'mid', 'leafdir'] — 'a' is a REAL directory, 'mid'
    // is a symlink one level BELOW it (not the immediate root child, not the
    // leaf). Validating the root, or even the first segment, does not
    // validate what is written beneath it — every segment must be walked.
    const a = join(root, 'a');
    mkdirSync(a);
    const mid = join(a, 'mid');
    symlinkSync(outside, mid);
    assert.ok(lstatSync(mid).isSymbolicLink(), 'arrange: the intermediate segment must be a symlink or the test is vacuous');

    assert.throws(
      () => guardedRename(root, ['a', 'mid', 'leafdir'], ['dest']),
      PathGuardContainmentError,
      'a symlinked intermediate segment on the source side must be rejected, not just a symlinked leaf',
    );

    assert.equal(existsSync(join(root, 'dest')), false, 'nothing must have been created at the destination');
    assert.equal(existsSync(join(outside, 'leafdir')), false, 'nothing must have been written through the symlink target');
    assert.equal(readlinkSync(mid), outside, 'the intermediate link itself must be untouched');
  });
});

test('a symlinked intermediate (non-leaf, non-parent) component on the DESTINATION side is rejected', () => {
  withRootAndOutside((root, outside) => {
    const srcDir = join(root, 'srcdir');
    mkdirSync(srcDir);
    writeFileSync(join(srcDir, 'file.txt'), 'payload');

    const a = join(root, 'a');
    mkdirSync(a);
    const mid = join(a, 'mid');
    symlinkSync(outside, mid);
    assert.ok(lstatSync(mid).isSymbolicLink(), 'arrange: the intermediate segment must be a symlink or the test is vacuous');

    assert.throws(
      () => guardedRename(root, ['srcdir'], ['a', 'mid', 'leafdir']),
      PathGuardContainmentError,
      'a symlinked intermediate segment on the destination side must be rejected, not just a symlinked leaf',
    );

    assert.equal(existsSync(srcDir), true, 'the source directory must still be there');
    assert.equal(readFileSync(join(srcDir, 'file.txt'), 'utf8'), 'payload', 'source contents untouched');
    assert.equal(existsSync(join(outside, 'leafdir')), false, 'nothing must have been written through the symlink target');
  });
});

test('a dangling symlink at the destination leaf is rejected, not mistaken for a free slot', () => {
  withRoot((root) => {
    const srcDir = join(root, 'srcdir');
    mkdirSync(srcDir);
    writeFileSync(join(srcDir, 'file.txt'), 'payload');

    const danglink = join(root, 'danglink');
    symlinkSync(join(root, 'does-not-exist'), danglink);
    assert.throws(() => lstatSync(join(root, 'does-not-exist')), 'arrange: the dangling target must genuinely not exist');
    assert.ok(lstatSync(danglink).isSymbolicLink(), 'arrange: the destination leaf must be a symlink');

    assert.throws(
      () => guardedRename(root, ['srcdir'], ['danglink']),
      PathGuardContainmentError,
      'a dangling symlink at the destination must be rejected, not treated as a free creation slot',
    );

    assert.equal(existsSync(srcDir), true, 'the source directory must still be there');
    assert.ok(lstatSync(danglink).isSymbolicLink(), 'the dangling symlink itself must still be there, unrenamed-over');
  });
});

test('an already-existing destination is refused, never clobbered — and the source survives', () => {
  withRoot((root) => {
    const srcDir = join(root, 'srcdir');
    mkdirSync(srcDir);
    writeFileSync(join(srcDir, 'file.txt'), 'source-payload');

    const dstDir = join(root, 'dstdir');
    mkdirSync(dstDir);
    writeFileSync(join(dstDir, 'existing.txt'), 'dest-payload');

    assert.throws(
      () => guardedRename(root, ['srcdir'], ['dstdir']),
      PathGuardContainmentError,
      'renaming onto an already-existing destination must be refused',
    );

    assert.equal(existsSync(srcDir), true, 'the source directory must still be there');
    assert.equal(readFileSync(join(srcDir, 'file.txt'), 'utf8'), 'source-payload', 'source contents untouched');
    assert.equal(readFileSync(join(dstDir, 'existing.txt'), 'utf8'), 'dest-payload', 'the pre-existing destination contents must be unchanged, never overwritten');
  });
});

test('a percent-encoded segment ("..%2F..") is a literal directory-entry name, never decoded into a separator', () => {
  withRoot((root) => {
    // If this were ever decoded (%2F -> '/'), "..%2F.." would become the two
    // segments "..", ".." — both of which `isSafeSegment` rejects outright.
    // A SUCCESSFUL rename here is the proof that the literal string is used
    // as one opaque directory-entry name, never split or decoded.
    const literalDir = join(root, '..%2F..');
    mkdirSync(literalDir);
    writeFileSync(join(literalDir, 'marker.txt'), 'literal-name-marker');

    guardedRename(root, ['..%2F..'], ['moved']);

    assert.equal(existsSync(literalDir), false, 'the literally-named source must be gone');
    const moved = join(root, 'moved');
    assert.equal(existsSync(moved), true, 'the destination must exist');
    assert.equal(readFileSync(join(moved, 'marker.txt'), 'utf8'), 'literal-name-marker', 'contents must survive the move');
  });
});

test('any rejection leaves nothing on disk at either endpoint (filesystem snapshot before/after)', () => {
  withRoot((root) => {
    mkdirSync(join(root, 'child'));
    mkdirSync(join(root, 'child', 'grandchild'));
    writeFileSync(join(root, 'child', 'a.txt'), 'a');
    writeFileSync(join(root, 'child', 'grandchild', 'b.txt'), 'b');

    const before = snapshot(root);

    assert.throws(
      () => guardedRename(root, ['child', '..', 'child'], ['stolen']),
      PathGuardContainmentError,
      'this call must be rejected (".." segment)',
    );

    const after = snapshot(root);
    assert.deepEqual(after, before, 'a rejected rename must leave the filesystem byte-for-byte as it was — no new files, no removed files, at either endpoint');
  });
});
