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
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  acquireBrainWriteLease,
  BrainWriteLeaseContentionError,
} from '../../brain-write-lease.ts';

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
