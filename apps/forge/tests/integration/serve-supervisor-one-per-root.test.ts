/**
 * One `forge serve` per forge root (M7-E row 205): every serve takes the
 * per-root lock and writes its own `_logs/daemon/forge.pid`, however it was
 * started — by `forge studio`, by hand, or under systemd/pm2. So `forge studio` booting
 * beside a hand-started serve adopts it and spawns nothing.
 *
 * REAL processes, in a REAL temp forge root — not fakes. A genuine `forge
 * serve` cannot run rooted at a temp dir (`apps/forge/cli.ts`'s `FORGE_ROOT`
 * is hard-derived from its own file location, never overridable — see
 * `apps/forge/tests/regression/cli-own-tree.test.ts`'s D2), so this spawns a
 * STAND-IN launch target at the documented path `<root>/apps/forge/cli.ts`
 * — matching `spawnServeDetached`'s real spawn target and the real
 * `node --experimental-strip-types <path> serve` launch form — whose own
 * body calls the REAL `startServeLock`/`clearOwnPidFile`
 * (`packages/flows/daemon.ts`). Everything ELSE here is the real thing:
 * `superviseServe` (`apps/forge/serve-supervisor.ts`) with its real default
 * `readPid`/`isAlive`/`isForgeServe` deps, reading the real `/proc` and the
 * real `forge.pid`. Only `spawn` is overridden, and only to ASSERT it is
 * never called — the whole point being that a hand-started serve using the
 * real lock is ADOPTED, never spawned over.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isProcessRunning } from '@forge/kernel';

import { superviseServe } from '../../serve-supervisor.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const DAEMON_TS = resolve(REPO_ROOT, 'packages', 'flows', 'daemon.ts');

function tmpRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'forge-one-per-root-'));
  mkdirSync(join(root, '_logs'), { recursive: true });
  mkdirSync(join(root, '_queue'), { recursive: true });
  mkdirSync(join(root, 'apps', 'forge'), { recursive: true });
  return root;
}

/** Writes the stand-in `forge serve` launch target at the documented path
 *  `<root>/apps/forge/cli.ts` — the same path `spawnServeDetached` always
 *  targets, so an adopted-vs-spawned distinction is observable for real.
 *  Its own `FORGE_ROOT`-equivalent is derived from ITS OWN file location,
 *  exactly like the real `cli.ts`, so no root needs passing via argv. */
function writeStandin(root: string): void {
  writeFileSync(
    join(root, 'apps', 'forge', 'cli.ts'),
    [
      `import { startServeLock, clearOwnPidFile } from ${JSON.stringify(DAEMON_TS)};`,
      "import { resolve as res, dirname as dn } from 'node:path';",
      "import { fileURLToPath as f2p } from 'node:url';",
      "const root = res(dn(f2p(import.meta.url)), '..', '..');",
      'const release = await startServeLock(root);',
      'if (!release) { console.error("STANDIN-REFUSED"); process.exit(1); }',
      "process.on('SIGTERM', async () => { await release(); process.exit(0); });",
      "console.log('STANDIN-READY pid=' + process.pid);",
      'setInterval(() => {}, 60_000);',
    ].join('\n'),
  );
}

function spawnStandin(root: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['--experimental-strip-types', join(root, 'apps', 'forge', 'cli.ts'), 'serve'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return new Promise((resolveReady, reject) => {
    child.stdout!.once('data', (chunk: Buffer) => {
      const line = chunk.toString('utf8');
      if (line.includes('STANDIN-READY')) resolveReady(child);
      else reject(new Error(`stand-in did not report ready: ${line}`));
    });
    child.once('error', reject);
  });
}

async function killByPid(pid: number | undefined): Promise<void> {
  if (!pid) return;
  try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
}

test('M7-E HIGH: a hand-started serve using the real lock is ADOPTED by the real supervisor — exactly ONE serve process for the root, never spawned over', async () => {
  const root = tmpRoot();
  writeStandin(root);
  const handStarted = await spawnStandin(root);

  try {
    const handle = superviseServe({
      forgeRoot: root,
      log: () => {},
      spawn: () => {
        throw new Error('must not spawn — a hand-started serve holding the real lock must be ADOPTED');
      },
    });

    // Give the boot-time adopt check (synchronous inside `superviseServe`,
    // but the pid file + lock were written by a separate real process) a
    // moment to settle, then confirm adoption rather than polling blind.
    await new Promise((r) => setTimeout(r, 200));

    const status = handle.getStatus();
    assert.equal(status.state, 'running', 'the hand-started serve is recognised as running, not missing');
    assert.equal(status.pid, handStarted.pid, 'the supervisor adopted the EXACT hand-started pid');
    assert.equal(isProcessRunning(handStarted.pid!), true, 'the hand-started process is still the one and only live serve');

    handle.stop();
  } finally {
    await killByPid(handStarted.pid);
    rmSync(root, { recursive: true, force: true });
  }
});
