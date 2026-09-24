/**
 * forge-ler4 — `acquireBrainWriteLease` is the ONE mutex a brain-writing turn
 * takes around itself. These tests pin the primitive in isolation: a second
 * acquire while the first is held must be REFUSED (typed, visible, bounded —
 * never a silent proceed), and a released lease must not stay wedged.
 *
 * See `packages/knowledge/brain-write-lease.ts`'s own doc for the race this
 * closes and why `proper-lockfile` (already a direct dependency, already this
 * repo's primitive for the identical shape in `community-registry-lock.ts`)
 * is reused rather than hand-rolled.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  acquireBrainWriteLease,
  BrainWriteLeaseContentionError,
  BRAIN_WRITE_LEASE_STALE_MS,
} from '../../brain-write-lease.ts';
import { brainRootDir } from '../../kb-drain-edit-soundness.ts';

function buildForgeRoot(): string {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'brain-write-lease-test-'));
  mkdirSync(join(forgeRoot, 'brain'), { recursive: true });
  return forgeRoot;
}

test('forge-ler4: a second acquire while the first holds the lease is REFUSED with a typed contention error, not silently allowed to proceed', async () => {
  const forgeRoot = buildForgeRoot();
  try {
    const release = await acquireBrainWriteLease(forgeRoot);
    try {
      let caught: unknown;
      try {
        await acquireBrainWriteLease(forgeRoot);
      } catch (err) {
        caught = err;
      }
      assert.ok(
        caught instanceof BrainWriteLeaseContentionError,
        `expected BrainWriteLeaseContentionError, got ${String(caught)}`,
      );
      assert.match((caught as Error).message, /locked by another writer/);
    } finally {
      await release();
    }
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('forge-ler4: once released, a following acquire succeeds — the lease is not permanently wedged', async () => {
  const forgeRoot = buildForgeRoot();
  try {
    const release1 = await acquireBrainWriteLease(forgeRoot);
    await release1();
    const release2 = await acquireBrainWriteLease(forgeRoot);
    await release2();
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// forge-ler4 follow-up: `runReflector` derives its OWN forgeRoot from
// `import.meta.dirname` (never injectable — reflector-spawn-capture.test.ts's
// own header explains why), so every reflector test that reaches the real
// lease necessarily targets the SAME real repo `brain/`. Two SEPARATE
// `node --test` worker processes (one per test FILE) acquiring that same
// default lock concurrently is exactly the cross-file contention this bead's
// prior worker reproduced (reflector.test.ts + reflector-write-lease.test.ts
// + reflector-spawn-capture.test.ts run together: 8/10 reds, `'failed' !==
// 'closed'`). The structural fix is `lockfilePath` — `acquireBrainWriteLease`
// lets a caller point the PHYSICAL lock file somewhere private while still
// validating the same conceptual `forgeRoot`/brain target, so each reflector
// test file can hold its own lock and never see another file's turn.
test('forge-ler4: acquireBrainWriteLease(forgeRoot, { lockfilePath }) uses a PRIVATE physical lock, so two callers pointed at DIFFERENT lockfilePaths on the SAME forgeRoot never contend', async () => {
  const forgeRoot = buildForgeRoot();
  try {
    const lockA = join(forgeRoot, 'lease-a.lock');
    const lockB = join(forgeRoot, 'lease-b.lock');
    const releaseA = await acquireBrainWriteLease(forgeRoot, { lockfilePath: lockA });
    try {
      // Must NOT throw BrainWriteLeaseContentionError — lockB is a distinct
      // physical lock from lockA even though both target the same forgeRoot.
      const releaseB = await acquireBrainWriteLease(forgeRoot, { lockfilePath: lockB });
      await releaseB();
    } finally {
      await releaseA();
    }
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('forge-ler4: a lock directory left behind by a killed process (mtime older than BRAIN_WRITE_LEASE_STALE_MS, never refreshed) is reclaimed, not refused forever', async () => {
  const forgeRoot = buildForgeRoot();
  try {
    // Simulate a holder that crashed instead of releasing: the lockfile
    // exists on disk (proper-lockfile's lock is a directory, created via an
    // atomic mkdir) but nothing is alive to keep refreshing its mtime every
    // `stale / 2` ms the way a live holder does.
    const orphanedLockPath = `${brainRootDir(forgeRoot)}.lock`;
    mkdirSync(orphanedLockPath);
    const longDead = new Date(Date.now() - BRAIN_WRITE_LEASE_STALE_MS - 5_000);
    utimesSync(orphanedLockPath, longDead, longDead);

    // A fresh acquire must reclaim the stale lock rather than reporting
    // contention — the crashed holder must never wedge brain/ forever.
    const release = await acquireBrainWriteLease(forgeRoot);
    await release();
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
