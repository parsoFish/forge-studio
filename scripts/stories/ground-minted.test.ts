/**
 * ground-minted.test.ts — ROW 102b finding 9 (M7-COMMON §6.15, T1 1512):
 * `mintedSessions`'s per-marker check folds EVERY stat failure (the marker
 * genuinely absent, OR unreadable for a real reason) into "not a marker", so
 * a session dir whose markers could not be CONFIRMED reads silently identical
 * to a directory that was never a session at all.
 *
 * Exercised through `mintedSessionPaths`, the public wrapper — `mintedSessions`
 * itself is private to `ground-minted.mjs` (the module this row's fix also
 * split out of `ground-hash.mjs` at the 800-line cap, SPLIT NEVER BASELINE,
 * T1 ruling 492).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mintedSessionPaths } from './ground-minted.mjs';

function withCapturedError<T>(fn: () => T): { result: T; logged: string[] } {
  const logged: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args.join(' ')); };
  try {
    return { result: fn(), logged };
  } finally {
    console.error = original;
  }
}

test('ROW 102b (RED) finding 9: a session dir whose markers could not be CONFIRMED (non-ENOENT) is named, not silently "not a session"', () => {
  const root = mkdtempSync(join(tmpdir(), 'ground-minted-unknown-'));
  const logsDir = join(root, '_logs');
  mkdirSync(logsDir, { recursive: true });
  const name = '_agent-x-2026-09-26T00-00-00-000-abcd';
  const dir = join(logsDir, name);
  mkdirSync(dir);
  writeFileSync(join(dir, 'turn.pid'), '4242');
  // Remove search/read permission on the SESSION DIR itself — every one of
  // the three marker stats fails with a real EACCES, never ENOENT.
  chmodSync(dir, 0o000);
  try {
    const { result: paths, logged } = withCapturedError(() => mintedSessionPaths([], [name], logsDir));
    assert.deepEqual(paths, [], 'the safe direction is unchanged: never grant the produced-licence on unverifiable evidence');
    assert.ok(
      logged.some((l) => l.includes(name) && /could not be confirmed/.test(l)),
      `expected a named warning distinguishing this from a genuine non-session dir: ${JSON.stringify(logged)}`,
    );
  } finally {
    chmodSync(dir, 0o755);
    rmSync(root, { recursive: true, force: true });
  }
});

test('control: a genuinely non-session dir (real ENOENT on every marker) is excluded silently, exactly as before', () => {
  const root = mkdtempSync(join(tmpdir(), 'ground-minted-unknown-ctrl-'));
  const logsDir = join(root, '_logs');
  mkdirSync(logsDir, { recursive: true });
  const name = '_agent-y-2026-09-26T00-00-00-000-efgh';
  mkdirSync(join(logsDir, name)); // no marker files at all — real ENOENT on each stat
  try {
    const { result: paths, logged } = withCapturedError(() => mintedSessionPaths([], [name], logsDir));
    assert.deepEqual(paths, [], 'not a session — unchanged from before this row');
    assert.deepEqual(logged, [], 'a genuinely absent marker set is an ordinary miss, never a warning');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('control: a real session (a readable marker present) is still recognised, unaffected by this row', () => {
  const root = mkdtempSync(join(tmpdir(), 'ground-minted-unknown-real-'));
  const logsDir = join(root, '_logs');
  mkdirSync(logsDir, { recursive: true });
  const name = '_agent-z-2026-09-26T00-00-00-000-ijkl';
  mkdirSync(join(logsDir, name));
  writeFileSync(join(logsDir, name, 'turn.pid'), '4242');
  try {
    const { result: paths, logged } = withCapturedError(() => mintedSessionPaths([], [name], logsDir));
    assert.deepEqual(paths, ['_agent/z-2026-09-26T00-00-00-000-ijkl']);
    assert.deepEqual(logged, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
