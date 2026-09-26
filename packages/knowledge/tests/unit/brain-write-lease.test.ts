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
import { mkdtempSync, rmSync, mkdirSync, utimesSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  acquireBrainWriteLease,
  BrainWriteLeaseContentionError,
  BRAIN_WRITE_LEASE_STALE_MS,
  BRAIN_WRITE_LEASE_PID_TRUST_MS,
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
//
// This is proven at the disk level (custom path used INSTEAD of the default,
// never touching it) rather than by holding two concurrent in-process leases
// on the same forgeRoot: `proper-lockfile`'s `lock()`/`unlock()` bookkeeping
// (`lib/lockfile.js`'s module-level `locks` map) is keyed by the canonical
// TARGET path only, one entry per process — a second successful acquire
// against the same target (even with a different `lockfilePath`) overwrites
// the first's bookkeeping entry and breaks its later `release()`. That
// collision is a same-PROCESS artifact of the high-level wrapper; it does
// not occur in the real fix, where each `node --test` worker file is its own
// process with its own independent `locks` map.
test('forge-ler4: acquireBrainWriteLease(forgeRoot, { lockfilePath }) holds its lock at the CUSTOM path, leaving the default target-derived lock path untouched', async () => {
  const forgeRoot = buildForgeRoot();
  try {
    const customLockPath = join(forgeRoot, 'private.lock');
    const defaultLockPath = `${brainRootDir(forgeRoot)}.lock`;
    assert.ok(!existsSync(defaultLockPath), 'sanity: no default lock exists yet');

    const release = await acquireBrainWriteLease(forgeRoot, { lockfilePath: customLockPath });
    try {
      assert.ok(existsSync(customLockPath), 'the lease must be held at the CUSTOM lockfilePath');
      assert.ok(
        !existsSync(defaultLockPath),
        'holding the override must NOT create the default target-derived lock — a caller using the default path (e.g. another test FILE / process) must see it as free',
      );
    } finally {
      await release();
    }
    assert.ok(!existsSync(customLockPath), 'release must remove the custom lock');
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

// forge-8vfn.8.1.21 — under full-suite CPU load a LIVE holder's mtime refresh lagged past
// BRAIN_WRITE_LEASE_STALE_MS, a contender reclaimed the lease on mtime staleness alone, and the
// holder's own release() then threw ENOTACQUIRED. Backdating the real lock directory reproduces
// that on-disk state deterministically.
test('forge-ler4: a live holder lease is never reclaimed on mtime staleness alone', async () => {
  const forgeRoot = buildForgeRoot();
  try {
    const release = await acquireBrainWriteLease(forgeRoot);
    let caught: unknown;
    try {
      // Reproduce a holder whose periodic mtime refresh lagged past the
      // stale bound under a starved event loop, without waiting out a real
      // stall: back-date the REAL lock directory this `release` owns. The
      // holder (this same process) never crashed and never released.
      const lockDir = `${brainRootDir(forgeRoot)}.lock`;
      const longAgo = new Date(Date.now() - BRAIN_WRITE_LEASE_STALE_MS - 5_000);
      utimesSync(lockDir, longAgo, longAgo);

      try {
        await acquireBrainWriteLease(forgeRoot);
      } catch (err) {
        caught = err;
      }
    } finally {
      // The invariant: the ORIGINAL holder must still own its lease and
      // release cleanly — this is the exact call that threw ENOTACQUIRED
      // under the real failure once a contender had wrongly taken over.
      await release();
    }
    assert.ok(
      caught instanceof BrainWriteLeaseContentionError,
      `a live holder's lease must be refused, not stolen on mtime staleness — got ${String(caught)}`,
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// forge-8vfn.8.1.21 (§6.15) — a hand-built lock whose holder record says something about a LIVE
// process: the lease is refused while the record is inside its trust window, whatever mtime says.
function heldLock(forgeRoot: string, pidFile: string | null, ageMs: number): void {
  const lockDir = `${brainRootDir(forgeRoot)}.lock`;
  mkdirSync(lockDir);
  if (pidFile !== null) writeFileSync(`${lockDir}.holder-pid`, pidFile);
  const when = new Date(Date.now() - ageMs);
  utimesSync(lockDir, when, when);
}

async function acquireOutcome(forgeRoot: string): Promise<'acquired' | 'refused'> {
  try {
    const release = await acquireBrainWriteLease(forgeRoot);
    await release();
    return 'acquired';
  } catch (err) {
    if (err instanceof BrainWriteLeaseContentionError) return 'refused';
    throw err;
  }
}

test('forge-8vfn.8.1.21: an unreadable holder record is UNKNOWN, and UNKNOWN refuses', async () => {
  const forgeRoot = buildForgeRoot();
  try {
    heldLock(forgeRoot, null, BRAIN_WRITE_LEASE_STALE_MS + 5_000);
    mkdirSync(`${brainRootDir(forgeRoot)}.lock.holder-pid`);
    assert.equal(await acquireOutcome(forgeRoot), 'refused');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('forge-8vfn.8.1.21: a malformed holder record refuses — never reclaims', async () => {
  const forgeRoot = buildForgeRoot();
  try {
    heldLock(forgeRoot, 'not-a-pid', BRAIN_WRITE_LEASE_STALE_MS + 5_000);
    assert.equal(await acquireOutcome(forgeRoot), 'refused');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('forge-8vfn.8.1.21: a live PID past the trust window is not trusted (PID reuse)', async () => {
  const forgeRoot = buildForgeRoot();
  try {
    heldLock(forgeRoot, String(process.pid), BRAIN_WRITE_LEASE_PID_TRUST_MS + 5_000);
    assert.equal(await acquireOutcome(forgeRoot), 'acquired');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('forge-8vfn.8.1.21: a live PID inside the trust window refuses though mtime is stale', async () => {
  const forgeRoot = buildForgeRoot();
  try {
    heldLock(forgeRoot, String(process.pid), BRAIN_WRITE_LEASE_STALE_MS + 5_000);
    assert.equal(await acquireOutcome(forgeRoot), 'refused');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
