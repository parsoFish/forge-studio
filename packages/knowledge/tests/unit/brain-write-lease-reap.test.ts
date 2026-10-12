/**
 * forge-nk1y.28 — the brain-write lease leaves nothing behind in the repo root, is released when
 * the bridge shuts down, and a starting bridge reaps a lock whose holder is dead.
 *
 * 2026-10-10 19:05: the capstone's reflector held the lease inside the bridge; T1's coordinated
 * Studio stop SIGTERMed the bridge (pid 3617325) and `/home/parso/forge/brain.lock.holder-pid`
 * (7 bytes, the dead pid) stayed untracked in the repo root, showing in `git status`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  acquireBrainWriteLease,
  brainWriteLockPath,
  reapDeadBrainWriteLease,
  releaseHeldBrainWriteLeases,
} from '../../brain-write-lease.ts';
import { brainRootDir } from '../../kb-drain-edit-soundness.ts';

function forgeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'brain-lease-reap-'));
  mkdirSync(join(root, 'brain'), { recursive: true });
  return root;
}

/** A pid that certainly belonged to a process and is now dead. */
function deadPid(): number {
  const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  return Number(r.stdout);
}

/** A held-looking lock (proper-lockfile's dir + the holder record) at `lockPath`. */
function plantLock(lockPath: string, holder: string): void {
  mkdirSync(lockPath, { recursive: true });
  writeFileSync(`${lockPath}.holder-pid`, holder);
}

test('the lease lives under _logs/, never beside brain/ in the repo root', async () => {
  const root = forgeRoot();
  try {
    const release = await acquireBrainWriteLease(root);
    try {
      assert.equal(brainWriteLockPath(root), join(root, '_logs', 'brain.lock'));
      assert.ok(existsSync(join(root, '_logs', 'brain.lock')), 'lock dir under _logs/');
      assert.ok(existsSync(join(root, '_logs', 'brain.lock.holder-pid')), 'holder record under _logs/');
      assert.equal(existsSync(`${brainRootDir(root)}.lock`), false);
      assert.equal(existsSync(`${brainRootDir(root)}.lock.holder-pid`), false);
    } finally {
      await release();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('releaseHeldBrainWriteLeases (the bridge shutdown path) releases what this process holds: no lock, no holder record', async () => {
  const root = forgeRoot();
  try {
    await acquireBrainWriteLease(root);
    assert.equal(await releaseHeldBrainWriteLeases(), 1);
    assert.equal(existsSync(brainWriteLockPath(root)), false);
    assert.equal(existsSync(`${brainWriteLockPath(root)}.holder-pid`), false);
    assert.equal(await releaseHeldBrainWriteLeases(), 0, 'released once, not twice');
    const again = await acquireBrainWriteLease(root);
    await again();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a starting bridge reaps a lock whose holder pid is dead — at _logs/ and at the old repo-root path', () => {
  for (const where of ['current', 'legacy'] as const) {
    const root = forgeRoot();
    try {
      const lockPath = where === 'current' ? brainWriteLockPath(root) : `${brainRootDir(root)}.lock`;
      const pid = deadPid();
      plantLock(lockPath, String(pid));
      const outcome = reapDeadBrainWriteLease(root);
      assert.deepEqual(outcome, [{ action: 'reaped', lockPath, pid }]);
      assert.equal(existsSync(lockPath), false);
      assert.equal(existsSync(`${lockPath}.holder-pid`), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('refusal: a live holder\'s lock is refused by name and left in place', () => {
  const root = forgeRoot();
  try {
    plantLock(brainWriteLockPath(root), String(process.pid));
    const outcome = reapDeadBrainWriteLease(root);
    assert.deepEqual(outcome, [{ action: 'refused', lockPath: brainWriteLockPath(root), reason: `holder pid ${process.pid} is alive` }]);
    assert.ok(existsSync(`${brainWriteLockPath(root)}.holder-pid`));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refusal: an unreadable or malformed holder record is UNKNOWN — never reaped (§6.15)', () => {
  const root = forgeRoot();
  try {
    plantLock(brainWriteLockPath(root), 'not-a-pid');
    const [outcome] = reapDeadBrainWriteLease(root);
    assert.equal(outcome.action, 'refused');
    assert.match((outcome as { reason: string }).reason, /UNKNOWN/);
    assert.ok(existsSync(brainWriteLockPath(root)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('nothing held: nothing reported', () => {
  const root = forgeRoot();
  try {
    assert.deepEqual(reapDeadBrainWriteLease(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
