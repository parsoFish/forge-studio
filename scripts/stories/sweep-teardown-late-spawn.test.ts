/**
 * sweep-teardown-late-spawn.test.ts — bead forge-8vfn.30.16: a RESUMED run's
 * agent outlived the batch teardown.
 *
 * MEASURED (S10, 2026-10-06). Act 2 resumes a stopped run; beat 61 ends with it
 * in flight. `stopStudioThenScheduler` ends studio, whose exit sequence sends
 * serve its ONE SIGTERM; serve then DRAINS — it keeps running the in-flight
 * cycle, and dispatches the NEXT phase agent (the reviewer) — for up to 30 s,
 * after which `stopOwnScheduler` SIGKILLs it. The descendant snapshot
 * (`stopSchedulerCensusAndRelease`) was read BEFORE that 30 s, so the reviewer,
 * spawned INSIDE it, was never recorded: the census saw nothing, the claim and
 * `_logs` dir were archived, RUN-END printed, and the reviewer (detached,
 * reparented to init by the daemon's SIGKILL) wrote into the removed worktree
 * two minutes later.
 *
 * THE PLANT has exactly that shape and is deterministic: a daemon that ignores
 * SIGTERM and, ON that SIGTERM, spawns a detached "agent" that writes a file
 * well after the teardown has finished. Nothing is slept-and-hoped: the agent
 * only exists once the drain has begun, i.e. after any pre-signal snapshot.
 *
 * REFUSAL-PATH RULE: tmp root only. The only pids signalled are descendants of
 * the planted daemon (identity-verified), and the real `/proc` is read, never
 * a real story run's tree; `_logs`, `_queue` and the ground live under the tmp
 * root and nowhere else.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stopSchedulerCensusAndRelease } from './sweep-teardown.mjs';
import { DAEMON_PID_FILE } from './sweep-teardown-scheduler.mjs';
import { killIfAlive, waitForFileToExist, withReady } from './sweep-teardown-plant.mjs';

const AGENT_WRITES_AFTER_MS = 3500;
const GRACE_MS = 800;

test('forge-8vfn.30.16: an agent the draining daemon dispatches AFTER the pre-signal snapshot is stopped by recorded pid and never writes', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'forge-late-spawn-'));
  const agentPidFile = join(root, 'agent.pid');
  const lateFile = join(root, 'late-write.txt');
  const daemonReady = join(root, 'daemon.ready');
  mkdirSync(join(root, '_logs', 'daemon'), { recursive: true });

  // The agent: detached (its own group, like `spawnAgentTurn`), writes only
  // AFTER the teardown has finished.
  const agentScript = `setTimeout(() => { require('node:fs').writeFileSync(${JSON.stringify(lateFile)}, 'late'); process.exit(0); }, ${AGENT_WRITES_AFTER_MS});`;
  const daemon = spawn(process.execPath, ['-e', withReady(`
    const { spawn } = require('node:child_process');
    let spawned = false;
    // The drain: a SIGTERM does not stop the daemon, it starts the next phase.
    process.on('SIGTERM', () => {
      if (spawned) return;
      spawned = true;
      const child = spawn(process.execPath, ['-e', ${JSON.stringify(agentScript)}], {
        cwd: ${JSON.stringify(root)}, detached: true, stdio: 'ignore',
      });
      require('node:fs').writeFileSync(${JSON.stringify(agentPidFile)}, String(child.pid));
    });
    setInterval(() => {}, 1000);
  `, daemonReady), join(root, 'apps', 'forge', 'cli.ts'), 'serve'], { cwd: root, stdio: 'ignore' });
  writeFileSync(join(root, DAEMON_PID_FILE), String(daemon.pid));
  // Cleanup order is load-bearing: kill both pids BEFORE the tmp root goes.
  t.after(() => rmSync(root, { recursive: true, force: true }));
  t.after(() => {
    killIfAlive(daemon.pid!);
    try { killIfAlive(Number(readFileSync(agentPidFile, 'utf8'))); } catch { /* never spawned */ }
  });
  assert.equal(await waitForFileToExist(daemonReady), true, 'the planted daemon never reached its own ready marker');

  const result = await stopSchedulerCensusAndRelease(root, {
    graceMs: GRACE_MS, censusBoundMs: 3000, censusPollMs: 20, rereadDelayMs: 50, sinceMs: Date.now() - 60_000,
  });

  const agentPid = Number(readFileSync(agentPidFile, 'utf8'));
  assert.ok(Number.isInteger(agentPid) && agentPid > 0, 'the daemon must have dispatched the agent during the drain');
  assert.equal(result.sched.how, 'SIGKILL', 'the plant ignores SIGTERM, so the daemon is force-killed after the grace');

  // The agent is gone BEFORE teardown returns — not merely "will be".
  assert.throws(() => process.kill(agentPid, 0), `RED: agent pid ${agentPid} still alive after teardown: ${JSON.stringify(result.lines)}`);
  // ...and the teardown output names the pid it stopped, by number.
  assert.ok(
    result.lines.some((l: string) => l.includes(`pid ${agentPid}`) && /stopped|SIGTERM|SIGKILL/.test(l) && !/not signalled/.test(l)),
    `teardown must name agent pid ${agentPid} as stopped: ${JSON.stringify(result.lines)}`,
  );

  // The proof that matters: wait past the moment it would have written.
  await new Promise((r) => setTimeout(r, AGENT_WRITES_AFTER_MS + 700));
  assert.equal(existsSync(lateFile), false, 'RED: the late agent wrote its file after teardown — it was never stopped');
});
