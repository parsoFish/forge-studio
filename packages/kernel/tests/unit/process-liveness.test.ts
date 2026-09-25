/**
 * process-liveness.test.ts — the ONE `/proc`-based liveness rule.
 *
 * GAP `forge-8vfn.8.1.6` follow-up (T1 review). Moved here so
 * `scripts/stories/sweep-teardown.mjs`'s `isRunning` and
 * `packages/flows/daemon.ts`'s `isAlive` share ONE reading of "is this pid
 * actually running" rather than two that can drift — they had: `isAlive`'s
 * old `process.kill(pid, 0)` counts a ZOMBIE as alive, `isRunning`'s
 * `/proc/<pid>/stat` read never did, and a zombie scheduler pid passed the
 * story runner's preflight while the product's own `spawnServeDetached`
 * silently started nothing new.
 *
 * These cases are the SAME doors `scripts/stories/sweep-teardown.test.ts`
 * already proved against the pre-move `isRunning` — moved here rather than
 * duplicated in spirit only, so the module and its coverage travel together.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { isProcessRunning } from '../../process-liveness.ts';

test('isProcessRunning: ENOENT means gone', () => {
  assert.equal(isProcessRunning('999999', '/no-such-proc-root-for-this-test'), false);
});

test('isProcessRunning: a read failure OTHER than ENOENT is never read as "exited"', () => {
  // A real EACCES via chmodSync — Linux enforces it for the owning user too,
  // so this is not simulated. The safe direction for an unexplained failure
  // is "still running", never "concluded exited".
  const root = mkdtempSync(join(tmpdir(), 'forge-liveness-eacces-'));
  mkdirSync(join(root, '12345'));
  writeFileSync(join(root, '12345', 'stat'), '12345 (fixture) S 1 1 1 0 -1 4194304 0 0 0 0 0 0 0 0 20 0 1 0 42');
  chmodSync(join(root, '12345', 'stat'), 0o000);
  try {
    assert.equal(
      isProcessRunning('12345', root), true,
      'an unreadable-for-a-reason-other-than-ENOENT pid must be treated as still running, never concluded exited',
    );
  } finally {
    chmodSync(join(root, '12345', 'stat'), 0o644);
    rmSync(root, { recursive: true, force: true });
  }
});

test('isProcessRunning: fixture states Z (zombie) and X (dead) both read as NOT running', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-liveness-states-'));
  try {
    for (const [pid, state] of [['111', 'Z'], ['222', 'X']] as const) {
      mkdirSync(join(root, pid));
      writeFileSync(join(root, pid, 'stat'), `${pid} (fixture) ${state} 1 1 1 0 -1 4194304 0 0 0 0 0 0 0 0 20 0 1 0 42`);
      assert.equal(isProcessRunning(pid, root), false, `state ${state} must read as not running`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('isProcessRunning: the state char is read after the LAST ")" — a comm field with spaces/parens does not confuse it', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-liveness-comm-'));
  mkdirSync(join(root, '333'));
  // A `comm` field containing both a space and a stray ')' — the naive
  // `split(' ')[2]` would read the WRONG field here.
  writeFileSync(join(root, '333', 'stat'), '333 (weird proc)name) S 1 1 1 0 -1 4194304 0 0 0 0 0 0 0 0 20 0 1 0 42');
  try {
    assert.equal(isProcessRunning('333', root), true, 'state S, correctly located after the LAST ")"');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('isProcessRunning: a real, live process reads as running', () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  try {
    assert.equal(isProcessRunning(child.pid!), true);
  } finally {
    child.kill('SIGKILL');
  }
});
