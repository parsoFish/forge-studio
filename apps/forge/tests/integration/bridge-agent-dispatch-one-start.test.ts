/**
 * Row 206 (forge-8vfn.8.5.56) — "one run-level start per run id, refused in
 * code" — `_1.0/plans/M7-E-r206-design.md`'s "Enforcement point".
 *
 * `spawnAgentTurn`/`spawnAgentDispatch` (`apps/forge/bridge-agent-dispatch.ts`)
 * are the ONE seam every session turn and generic dispatch passes through.
 * Before either spawns, the seam checks the run dir's `turn.pid` via the
 * existing `isTurnAlive` (`@forge/sessions`); a live, OWNED turn refuses a
 * second spawn with a typed `DispatchInFlight` (`@forge/kernel`) BEFORE
 * anything is spawned — never two children for one run id (row 202's
 * precedent: one operator press spawned two agents under one run id).
 *
 * REAL SPAWN, deliberately — `FORGE_ARCHITECT_NO_SPAWN` is never set in this
 * file. A stand-in `apps/forge/cli.ts` (a tiny script that stays alive,
 * mirroring `apps/forge/tests/integration/ui-bridge-authoring-start.test.ts`'s own stub-CLI
 * technique) stands in for the real agent process so the test proves the
 * seam against an ACTUAL live child, not a mock.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { spawn } from 'node:child_process';

import { spawnAgentTurn, spawnAgentDispatch } from '../../bridge-agent-dispatch.ts';
import { DispatchInFlight } from '@forge/kernel';

let forgeRoot: string;
const savedNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
const savedDryBridge = process.env.FORGE_DRY_BRIDGE;
const livePids: number[] = [];

/** A minimal `apps/forge/cli.ts` stand-in that STAYS ALIVE (unlike the
 *  immediate-exit stub `ui-bridge-authoring-start.test.ts` uses) so the test
 *  controls exactly when the child exits. Writes its own argv to a fixed
 *  file so the test can confirm a real process was actually spawned, then
 *  blocks forever on an interval — a plain SIGTERM (default disposition)
 *  ends it. */
function writeStubCli(root: string): void {
  mkdirSync(join(root, 'apps', 'forge'), { recursive: true });
  writeFileSync(
    join(root, 'apps', 'forge', 'cli.ts'),
    [
      "import { writeFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      `writeFileSync(join(import.meta.dirname, '..', '..', 'spawned.json'), JSON.stringify({ argv: process.argv.slice(2), pid: process.pid }));`,
      // Stay alive until signalled — the whole point of this stub.
      'setInterval(() => {}, 1000);',
      '',
    ].join('\n'),
  );
}

before(() => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-agent-dispatch-one-start-'));
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  writeStubCli(forgeRoot);
  // Real spawn path — the whole point of this file.
  delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  delete process.env.FORGE_DRY_BRIDGE;
});

after(() => {
  for (const pid of livePids) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  if (savedNoSpawn !== undefined) process.env.FORGE_ARCHITECT_NO_SPAWN = savedNoSpawn; else delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  if (savedDryBridge !== undefined) process.env.FORGE_DRY_BRIDGE = savedDryBridge; else delete process.env.FORGE_DRY_BRIDGE;
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

/** Bounded poll — spawn is detached/fire-and-forget, so the caller returns
 *  before the child has necessarily run. */
async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('timed out waiting for condition');
}

function readTurnPid(sessionId: string): number {
  const raw = readFileSync(join(forgeRoot, '_logs', `_architect-${sessionId}`, 'turn.pid'), 'utf8');
  return Number.parseInt(raw.trim(), 10);
}

function readRunTurnPid(runId: string): number {
  const raw = readFileSync(join(forgeRoot, '_logs', runId, 'turn.pid'), 'utf8');
  return Number.parseInt(raw.trim(), 10);
}

async function waitForExit(pid: number, timeoutMs = 5000): Promise<void> {
  await waitFor(() => {
    try { process.kill(pid, 0); return false; } catch { return true; }
  }, timeoutMs);
}

test('row 206: two dispatches for one run id -> exactly one child born, the second refused as a typed DispatchInFlight naming the holder pid', async () => {
  const sessionId = `row206-onestart-${Date.now()}`;

  const first = spawnAgentTurn(forgeRoot, 'architect', 'demoproj', sessionId);
  assert.deepEqual(first, { ok: true, spawned: true }, `first dispatch must actually spawn, got ${JSON.stringify(first)}`);

  await waitFor(() => existsSync(join(forgeRoot, 'spawned.json')), 5000);
  const spawnedPid = readTurnPid(sessionId);
  assert.ok(Number.isInteger(spawnedPid) && spawnedPid > 1, `turn.pid must name the real child, got ${spawnedPid}`);
  livePids.push(spawnedPid);

  // Second dispatch for the SAME run id, with the first child still alive —
  // must be refused before anything spawns a second time.
  assert.throws(
    () => spawnAgentTurn(forgeRoot, 'architect', 'demoproj', sessionId),
    (err: unknown) => {
      assert.ok(err instanceof DispatchInFlight, `expected a typed DispatchInFlight, got ${err}`);
      assert.equal((err as DispatchInFlight).holderPid, spawnedPid, 'the refusal must name the REAL holder pid');
      assert.equal((err as DispatchInFlight).runId, sessionId);
      return true;
    },
    'a second dispatch for an in-flight run id must throw DispatchInFlight, not spawn a second child',
  );

  // turn.pid must still name the ORIGINAL child — the refused second call
  // must not have clobbered the claim.
  assert.equal(readTurnPid(sessionId), spawnedPid, 'the refused second dispatch must not overwrite the live holder\'s turn.pid');

  // End the first child, then prove the run id becomes dispatchable again.
  process.kill(spawnedPid, 'SIGTERM');
  await waitForExit(spawnedPid);
  rmSync(join(forgeRoot, 'spawned.json'), { force: true });

  const third = spawnAgentTurn(forgeRoot, 'architect', 'demoproj', sessionId);
  assert.deepEqual(third, { ok: true, spawned: true }, `a dispatch for the same run id must succeed once the prior turn has exited, got ${JSON.stringify(third)}`);
  await waitFor(() => existsSync(join(forgeRoot, 'spawned.json')), 5000);
  const secondPid = readTurnPid(sessionId);
  assert.notEqual(secondPid, spawnedPid, 'the new turn must be a genuinely NEW child, not the dead one\'s stale pid');
  livePids.push(secondPid);
  process.kill(secondPid, 'SIGTERM');
  await waitForExit(secondPid);
});

/** Spawn a trivial, genuinely short-lived child and resolve its pid only
 *  after it has exited — a reliably DEAD pid to seed a stale turn.pid with,
 *  without racing a real process's own exit timing. */
async function deadPid(): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', 'process.exit(0)']);
    child.once('exit', () => {
      if (typeof child.pid === 'number') resolve(child.pid); else reject(new Error('no pid'));
    });
    child.once('error', reject);
  });
}

test('row 206 (stale claim): a turn.pid naming a DEAD pid is removed and reclaimed, not refused as in-flight', async () => {
  const sessionId = `row206-stale-${Date.now()}`;
  const logDir = join(forgeRoot, '_logs', `_architect-${sessionId}`);
  mkdirSync(logDir, { recursive: true });
  const stalePid = await deadPid();
  writeFileSync(join(logDir, 'turn.pid'), `${stalePid}\n`);
  rmSync(join(forgeRoot, 'spawned.json'), { force: true }); // no leftover from an earlier test's write

  const result = spawnAgentTurn(forgeRoot, 'architect', 'demoproj', sessionId);
  assert.deepEqual(result, { ok: true, spawned: true }, `a stale (dead-pid) claim must not refuse a fresh dispatch, got ${JSON.stringify(result)}`);

  await waitFor(() => existsSync(join(forgeRoot, 'spawned.json')), 5000);
  const newPid = readTurnPid(sessionId);
  assert.notEqual(newPid, stalePid, 'turn.pid must now name the NEW real child, not the removed stale pid');
  livePids.push(newPid);
  process.kill(newPid, 'SIGTERM');
  await waitForExit(newPid);
});

// ---------------------------------------------------------------------------
// spawnAgentDispatch — the generic sibling seam (standalone `forge agent
// dispatch`). Same claim, keyed on runId instead of sessionId.
// ---------------------------------------------------------------------------

test('row 206 (spawnAgentDispatch): two dispatches for one run id -> exactly one child born, the second refused as a typed DispatchInFlight', async () => {
  const runId = `row206-dispatch-onestart-${Date.now()}`;
  rmSync(join(forgeRoot, 'spawned.json'), { force: true });

  spawnAgentDispatch(forgeRoot, 'project-scoped-review', runId);
  await waitFor(() => existsSync(join(forgeRoot, 'spawned.json')), 5000);
  const spawnedPid = readRunTurnPid(runId);
  assert.ok(Number.isInteger(spawnedPid) && spawnedPid > 1, `turn.pid must name the real child, got ${spawnedPid}`);
  livePids.push(spawnedPid);

  assert.throws(
    () => spawnAgentDispatch(forgeRoot, 'project-scoped-review', runId),
    (err: unknown) => {
      assert.ok(err instanceof DispatchInFlight, `expected a typed DispatchInFlight, got ${err}`);
      assert.equal((err as DispatchInFlight).holderPid, spawnedPid);
      assert.equal((err as DispatchInFlight).runId, runId);
      return true;
    },
    'a second dispatch for an in-flight run id must throw DispatchInFlight, not spawn a second child',
  );
  assert.equal(readRunTurnPid(runId), spawnedPid, 'the refused second dispatch must not overwrite the live holder\'s turn.pid');

  process.kill(spawnedPid, 'SIGTERM');
  await waitForExit(spawnedPid);
});
