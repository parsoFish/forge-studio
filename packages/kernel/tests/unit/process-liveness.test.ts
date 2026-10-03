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
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { resolve } from 'node:path';
import { isProcessRunning, isForgeServePid } from '../../process-liveness.ts';

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

// ---------------------------------------------------------------------------
// isForgeServePid — M7-E review finding (pid reuse): a pid is OUR `forge
// serve` only when its cmdline names BOTH this forgeRoot's launch form and
// the `serve` argument, AND its `/proc/<pid>/cwd` resolves to the root
// itself — the same ownership test
// `scripts/stories/sweep-teardown-scheduler.mjs`'s `ownSchedulerPidState`
// already applies to the scheduler's own pid. M7-E HIGH (row 205 follow-up):
// EITHER documented launch form matches — `apps/forge/cli.ts`
// (spawnServeDetached) or `bin/forge.mjs` (hand/systemd/pm2) — and a
// relative script token resolves against that same cwd.
// ---------------------------------------------------------------------------

function writeCmdline(root: string, pid: string, tokens: string[]): void {
  mkdirSync(join(root, pid), { recursive: true });
  writeFileSync(join(root, pid, 'cmdline'), tokens.join('\0') + '\0');
}

/** `cwd` must be a REAL directory — `realpathSync` follows the fixture's
 *  `/proc/<pid>/cwd` symlink exactly as it does the genuine kernel one. */
function writeCwd(root: string, pid: string, cwd: string): void {
  mkdirSync(join(root, pid), { recursive: true });
  symlinkSync(cwd, join(root, pid, 'cwd'));
}

test('isForgeServePid: cmdline naming this forgeRoot\'s cli.ts AND "serve", cwd resolving to the root → true', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-isserve-'));
  const forgeRoot = mkdtempSync(join(tmpdir(), 'forge-isserve-root-'));
  try {
    writeCmdline(root, '1', [process.execPath, resolve(forgeRoot, 'apps', 'forge', 'cli.ts'), 'serve']);
    writeCwd(root, '1', forgeRoot);
    assert.equal(isForgeServePid(1, forgeRoot, root), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('isForgeServePid: the OTHER documented launch form, bin/forge.mjs (hand/systemd/pm2) → true', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-isserve-'));
  const forgeRoot = mkdtempSync(join(tmpdir(), 'forge-isserve-root-'));
  try {
    writeCmdline(root, '1', [process.execPath, resolve(forgeRoot, 'bin', 'forge.mjs'), 'serve']);
    writeCwd(root, '1', forgeRoot);
    assert.equal(isForgeServePid(1, forgeRoot, root), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('isForgeServePid: a RELATIVE script token resolves against /proc/<pid>/cwd → true', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-isserve-'));
  const forgeRoot = mkdtempSync(join(tmpdir(), 'forge-isserve-root-'));
  try {
    writeCmdline(root, '1', [process.execPath, join('bin', 'forge.mjs'), 'serve']);
    writeCwd(root, '1', forgeRoot);
    assert.equal(isForgeServePid(1, forgeRoot, root), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('isForgeServePid: matching argv but a FOREIGN cwd → false', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-isserve-'));
  const forgeRoot = mkdtempSync(join(tmpdir(), 'forge-isserve-root-'));
  const elsewhere = mkdtempSync(join(tmpdir(), 'forge-isserve-elsewhere-'));
  try {
    writeCmdline(root, '1', [process.execPath, resolve(forgeRoot, 'apps', 'forge', 'cli.ts'), 'serve']);
    writeCwd(root, '1', elsewhere);
    assert.equal(isForgeServePid(1, forgeRoot, root), false, 'argv alone is never enough — cwd must resolve to the root too');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test('isForgeServePid: an unrelated process on the same pid → false (pid reuse)', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-isserve-'));
  const forgeRoot = '/opt/forge';
  try {
    writeCmdline(root, '1', ['/usr/bin/some-other-daemon', '--flag']);
    assert.equal(isForgeServePid(1, forgeRoot, root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('isForgeServePid: cli.ts present but missing the "serve" argument → false', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-isserve-'));
  const forgeRoot = '/opt/forge';
  try {
    writeCmdline(root, '1', [process.execPath, resolve(forgeRoot, 'apps', 'forge', 'cli.ts'), 'plan']);
    assert.equal(isForgeServePid(1, forgeRoot, root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('isForgeServePid: a DIFFERENT forgeRoot\'s cli.ts never matches', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-isserve-'));
  try {
    writeCmdline(root, '1', [process.execPath, resolve('/opt/other-forge', 'apps', 'forge', 'cli.ts'), 'serve']);
    assert.equal(isForgeServePid(1, '/opt/forge', root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('isForgeServePid: no cmdline file (pid gone) → false', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-isserve-'));
  try {
    assert.equal(isForgeServePid(1, '/opt/forge', root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
