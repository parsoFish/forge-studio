/**
 * Row 206 (forge-8vfn.8.5.56) orchestrator review HIGH-1/MEDIUM-2/MEDIUM-3 —
 * `claimDispatchSlot`/`releaseDispatchSlot` as a standalone kernel primitive,
 * so `spawnPreflightFix` (apps/forge) and `spawnBrainFix` (@forge/knowledge)
 * can reuse the SAME claim the agent-dispatch seam uses, instead of each
 * copying it. `isAlive` is an injected parameter rather than an import of
 * `@forge/sessions`' real `isTurnAlive` — this package is rank 1 and sessions
 * is rank 4 (the same rank problem `packages/agents/bridge-agents-run-state.ts`
 * already documents for the same function).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { claimDispatchSlot, releaseDispatchSlot, CLAIM_PLACEHOLDER_STALE_MS, newRunStamp, randomRunSuffix } from '../../dispatch-claim.ts';
import { DispatchInFlight } from '../../http-envelope.ts';

const alwaysAlive = () => true;
const neverAlive = () => false;

function readPid(logsRoot: string, logDirName: string): string {
  return readFileSync(join(logsRoot, logDirName, 'turn.pid'), 'utf8');
}

test('claimDispatchSlot: an empty slot claims cleanly, leaving the CLAIMING placeholder', () => {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-claim-empty-'));
  try {
    mkdirSync(join(root, '_logs'), { recursive: true });
    claimDispatchSlot(root, 'run-1', 'run-1', neverAlive);
    assert.match(readPid(join(root, '_logs'), 'run-1'), /claiming/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('claimDispatchSlot: a live, owned holder refuses a second claim with a typed DispatchInFlight naming the holder pid', () => {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-claim-live-'));
  const logsRoot = join(root, '_logs');
  try {
    mkdirSync(join(logsRoot, 'run-1'), { recursive: true });
    writeFileSync(join(logsRoot, 'run-1', 'turn.pid'), '4242\n');
    assert.throws(
      () => claimDispatchSlot(root, 'run-1', 'run-1', alwaysAlive),
      (err: unknown) => {
        assert.ok(err instanceof DispatchInFlight);
        assert.equal((err as DispatchInFlight).holderPid, 4242);
        return true;
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('claimDispatchSlot: a dead-pid holder (isAlive -> false) is cleared and reclaimed', () => {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-claim-dead-'));
  const logsRoot = join(root, '_logs');
  try {
    mkdirSync(join(logsRoot, 'run-1'), { recursive: true });
    writeFileSync(join(logsRoot, 'run-1', 'turn.pid'), '9999\n');
    claimDispatchSlot(root, 'run-1', 'run-1', neverAlive);
    assert.match(readPid(logsRoot, 'run-1'), /claiming/i, 'the dead pid must be replaced by a fresh claim');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('MEDIUM-2: a CLAIMING placeholder older than CLAIM_PLACEHOLDER_STALE_MS is cleared and reclaimed (a crash mid-claim must not wedge the run id forever)', () => {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-claim-stale-placeholder-'));
  const logsRoot = join(root, '_logs');
  try {
    mkdirSync(logsRoot, { recursive: true });
    // First claim leaves the CLAIMING placeholder, as a crash between the
    // claim and the real pid overwrite would.
    claimDispatchSlot(root, 'run-1', 'run-1', neverAlive);
    const pidPath = join(logsRoot, 'run-1', 'turn.pid');
    // Back-date the placeholder past the stale bound.
    const old = (Date.now() - CLAIM_PLACEHOLDER_STALE_MS - 1_000) / 1000;
    utimesSync(pidPath, old, old);

    // A SECOND claim must not be refused as in-flight — the placeholder is
    // abandoned, not a live claim.
    assert.doesNotThrow(() => claimDispatchSlot(root, 'run-1', 'run-1', neverAlive));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('MEDIUM-2 (negative): a CLAIMING placeholder YOUNGER than the stale bound is treated as genuinely in flight', () => {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-claim-fresh-placeholder-'));
  const logsRoot = join(root, '_logs');
  try {
    mkdirSync(logsRoot, { recursive: true });
    claimDispatchSlot(root, 'run-1', 'run-1', neverAlive);
    // Fresh placeholder (no utimesSync back-dating) — a second claim right
    // behind it must be refused, not silently reclaimed.
    assert.throws(
      () => claimDispatchSlot(root, 'run-1', 'run-1', neverAlive),
      (err: unknown) => err instanceof DispatchInFlight,
      'a fresh CLAIMING placeholder must refuse a second claim, not be treated as abandoned',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('MEDIUM-3: a containment-rejected claim (guardedWriteFileExclusive -> null) fails closed — refuses, never proceeds unclaimed', () => {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-claim-containment-'));
  const outside = mkdtempSync(join(tmpdir(), 'dispatch-claim-containment-OUTSIDE-'));
  const logsRoot = join(root, '_logs');
  try {
    // A symlinked leaf makes guardedWriteFileExclusive return null (the
    // same escape path-guard-exclusive-write.test.ts's row-206-C pins).
    mkdirSync(join(logsRoot, 'run-1'), { recursive: true });
    symlinkSync(outside, join(logsRoot, 'run-1', 'turn.pid'));
    assert.throws(
      () => claimDispatchSlot(root, 'run-1', 'run-1', neverAlive),
      /refus|contain/i,
      'a containment rejection must throw, not silently return as if claimed',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('releaseDispatchSlot: removes the claim; a no-op (never throws) when nothing is claimed', () => {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-claim-release-'));
  const logsRoot = join(root, '_logs');
  try {
    mkdirSync(logsRoot, { recursive: true });
    claimDispatchSlot(root, 'run-1', 'run-1', neverAlive);
    releaseDispatchSlot(root, 'run-1');
    // Released -> claimable again with no trace of the old placeholder.
    assert.doesNotThrow(() => claimDispatchSlot(root, 'run-1', 'run-1', neverAlive));
    releaseDispatchSlot(root, 'never-claimed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('HIGH-1: two run-id mints within the same millisecond (stubbed Date.now) are distinct, via randomRunSuffix', () => {
  const realNow = Date.now;
  try {
    Date.now = () => 1_700_000_000_000;
    const a = `prefix-${Date.now().toString(36)}-${randomRunSuffix()}`;
    const b = `prefix-${Date.now().toString(36)}-${randomRunSuffix()}`;
    assert.notEqual(a, b, 'two mints in the same millisecond must not collide');
  } finally {
    Date.now = realNow;
  }
});

test('newRunStamp: sortable leading timestamp, non-empty random tail, charset safe for a path segment', () => {
  const a = newRunStamp();
  const b = newRunStamp();
  assert.notEqual(a, b);
  assert.match(a, /^[0-9A-Za-z-]+$/, 'must be a safe path segment (no colons/dots/slashes)');
});
