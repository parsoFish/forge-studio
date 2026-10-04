/**
 * Row 206 (forge-8vfn.8.5.56) — `guardedWriteFileExclusive`/`guardedUnlink`
 * (`packages/kernel/path-guard.ts`), the two primitives the agent-dispatch
 * seam's atomic claim (`claimDispatchSlot`, `apps/forge/bridge-agent-dispatch.ts`)
 * is built on. Split into its own file rather than grown onto
 * `path-guard.test.ts` (already over the 800-line cap under its own
 * grandfathered exemption — a cap exemption is a ceiling, not a licence to
 * keep adding to that file).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  realpathSync,
  symlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { guardedWriteFile, guardedWriteFileExclusive, guardedUnlink } from '../../path-guard.ts';

test('row 206 (forge-8vfn.8.5.56) A: guardedWriteFileExclusive creates a not-yet-existing leaf and returns its path (create-mode, same as guardedWriteFile)', () => {
  const root = mkdtempSync(join(tmpdir(), 'row206-exclusive-create-'));
  try {
    const realRoot = realpathSync(root);
    const written = guardedWriteFileExclusive(root, ['run-1', 'turn.pid'], '123\n');
    assert.equal(written, join(realRoot, 'run-1', 'turn.pid'), 'must return the reassembled path');
    assert.equal(readFileSync(written!, 'utf8'), '123\n', 'must have written the given contents');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('row 206 B: guardedWriteFileExclusive throws EEXIST — not a silent overwrite — when the leaf already exists', () => {
  const root = mkdtempSync(join(tmpdir(), 'row206-exclusive-eexist-'));
  try {
    guardedWriteFileExclusive(root, ['run-1', 'turn.pid'], 'first\n');
    assert.throws(
      () => guardedWriteFileExclusive(root, ['run-1', 'turn.pid'], 'second\n'),
      (err: unknown) => (err as NodeJS.ErrnoException)?.code === 'EEXIST',
      'a second exclusive create of the same leaf must throw EEXIST',
    );
    assert.equal(readFileSync(join(root, 'run-1', 'turn.pid'), 'utf8'), 'first\n', 'the original content must be unchanged — never silently overwritten');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('row 206 C: guardedWriteFileExclusive on a symlinked create-mode leaf is rejected (null) — same escape closed as guardedWriteFile', () => {
  const root = mkdtempSync(join(tmpdir(), 'row206-exclusive-sym-'));
  const outside = mkdtempSync(join(tmpdir(), 'row206-exclusive-sym-OUTSIDE-'));
  try {
    const runDir = join(root, 'run-1');
    mkdirSync(runDir);
    symlinkSync(outside, join(runDir, 'turn.pid')); // dangling-ish: points at a real dir, not a file, but still a symlink leaf
    assert.equal(guardedWriteFileExclusive(root, ['run-1', 'turn.pid'], 'ATTACKER'), null, 'a symlinked leaf must be rejected, nothing written');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('row 206 D: guardedUnlink removes a real leaf and returns true', () => {
  const root = mkdtempSync(join(tmpdir(), 'row206-unlink-'));
  try {
    guardedWriteFile(root, ['run-1', 'turn.pid'], '123\n');
    assert.equal(guardedUnlink(root, ['run-1', 'turn.pid']), true, 'must report the removal');
    assert.ok(!existsSync(join(root, 'run-1', 'turn.pid')), 'the leaf must actually be gone');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('row 206 E: guardedUnlink on an absent leaf is a no-op that returns false (no oracle, mirrors guardedReadFile\'s collapse)', () => {
  const root = mkdtempSync(join(tmpdir(), 'row206-unlink-absent-'));
  try {
    assert.equal(guardedUnlink(root, ['run-1', 'turn.pid']), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
