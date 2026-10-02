/**
 * Row 187 (forge-8vfn.8.5.23) — a killed run's DETACHED agent turns.
 *
 * Measured (run 4): after a SIGINT to the story runner, S10's architect turn
 * — spawned by the bridge with `detached: true` + `unref()`, its own process
 * group, its pid in `_logs/_architect-<sid>/turn.pid` — outlived both the
 * runner and the bridge and wrote `projects/gitpulse/_architect/<sid>/…` into
 * the REAL ground seven minutes later, after the stop path's capture+clear
 * had already run. And (run 5) the bridge took ~20 s to exit after its group
 * SIGTERM, with the stop path long since "done".
 *
 * The turn here is the real shape: a node process in its OWN session and
 * group (`setsid`), re-parented away from this test (the `sh` that launched
 * it exits at once), cwd inside the run root, recording its own pid in a
 * `_logs/_architect-*` dir — exactly what `spawnAgentTurn` leaves behind.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runStopPath } from './stop-path.mjs';
import { groundManifest } from './ground-hash.mjs';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function alive(pid: number) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] !== 'Z';
  } catch {
    return false;
  }
}

/** A detached turn that writes into the ground `delayMs` after it starts. */
function spawnDetachedTurn(root: string, sid: string, delayMs: number) {
  const logDir = join(root, '_logs', `_architect-${sid}`);
  mkdirSync(logDir, { recursive: true });
  const late = join(root, 'projects', 'ground', '_architect', sid, 'late.md');
  const script =
    `require('fs').writeFileSync(${JSON.stringify(join(logDir, 'turn.pid'))}, process.pid + '\\n');` +
    `setTimeout(() => { require('fs').mkdirSync(require('path').dirname(${JSON.stringify(late)}), { recursive: true });` +
    ` require('fs').writeFileSync(${JSON.stringify(late)}, 'written after the stop'); }, ${delayMs});` +
    'setTimeout(() => {}, 60000);';
  execFileSync('sh', ['-c', `setsid ${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)} </dev/null >/dev/null 2>&1 &`], { cwd: root });
  return { pidFile: join(logDir, 'turn.pid'), late };
}

async function waitForFile(path: string, ms = 5_000) {
  const until = Date.now() + ms;
  while (!existsSync(path) && Date.now() < until) await sleep(20);
  assert.ok(existsSync(path), `${path} never appeared`);
}

test('row 187 (RED before the fix): a killed run reaps its story\'s detached turn BEFORE the clear, so the ground ends where it started', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'stop-path-'));
  mkdirSync(join(root, 'projects', 'ground'), { recursive: true });
  writeFileSync(join(root, 'projects', 'ground', 'README.md'), 'the pinned ground\n');
  const startedMs = Date.now() - 1_000;
  const before = groundManifest(join(root, 'projects', 'ground'));

  const turn = spawnDetachedTurn(root, '2026-10-02T13-00-00-deadbeef', 1_500);
  await waitForFile(turn.pidFile);
  const pid = Number(readFileSync(turn.pidFile, 'utf8').trim());
  t.after(() => { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } });
  assert.ok(alive(pid));

  let aliveAtClear: boolean | null = null;
  await runStopPath({
    root, startedMs, bridgeProc: null,
    clear: () => { aliveAtClear = alive(pid); },
    log: () => {},
  });

  assert.equal(aliveAtClear, false, 'the turn must be gone BEFORE the capture+clear reads the ground');
  await sleep(2_000); // well past the turn's own 1.5 s write
  assert.equal(existsSync(turn.late), false, 'a reaped turn wrote into the ground after the stop path finished');
  assert.deepEqual(groundManifest(join(root, 'projects', 'ground')), before, 'the ground must equal its start hash');
});

test('row 187: the stop path waits for the bridge group to exit, escalating to SIGKILL past its bound', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'stop-path-'));
  // A bridge that ignores SIGTERM entirely — its own group, like `forge studio`.
  const bridge = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], {
    detached: true, stdio: 'ignore',
  });
  bridge.unref();
  t.after(() => { try { process.kill(-(bridge.pid as number), 'SIGKILL'); } catch { /* gone */ } });
  await sleep(300);
  let bridgeAliveAtClear: boolean | null = null;
  const began = Date.now();
  const report = await runStopPath({
    root, startedMs: Date.now(), bridgeProc: bridge as never,
    clear: () => { bridgeAliveAtClear = alive(bridge.pid as number); },
    log: () => {},
    bridgeExitBoundMs: 500,
  });
  const took = Date.now() - began;
  assert.equal(bridgeAliveAtClear, false, 'the bridge group must be gone before the stop path declares done');
  assert.ok(took >= 450, `must actually wait out the bound before SIGKILL — took ${took} ms`);
  assert.ok(took < 5_000, `bounded — took ${took} ms`);
  assert.match(JSON.stringify(report), /SIGKILL/);
});
