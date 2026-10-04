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

// ---------------------------------------------------------------------------
// Row 206 follow-up (m7-e-r206-fixgate-s1 capture) — "a turn writes its
// run-level `end` and then takes a moment to exit; LIVE must mean 'has not
// written its end', never 'pid not yet reaped'." These three stand-in CLIs
// write REAL run-level rows (matching `runKindTurn`'s own
// `metadata.phase`-bearing shape) into the architect session's own
// `events.jsonl`, so the claim's `sessionTurnShape: true` discrimination is
// exercised against real file content, not a fixture shaped by hand.
// ---------------------------------------------------------------------------

/** Writes spawned.json, then a run-level start+end pair into the session's
 *  own events.jsonl, then stays alive for `aliveMs` more before exiting —
 *  the captured evidence's own shape (end written, exit still pending). */
function writeEndedStubCli(root: string, aliveMs: number): void {
  mkdirSync(join(root, 'apps', 'forge'), { recursive: true });
  writeFileSync(
    join(root, 'apps', 'forge', 'cli.ts'),
    [
      "import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';",
      "import { join } from 'node:path';",
      "const sessionId = process.argv[4];", // argv: ['architect', 'run', sessionId, '--project', project]
      "const root = join(import.meta.dirname, '..', '..');",
      "writeFileSync(join(root, 'spawned.json'), JSON.stringify({ argv: process.argv.slice(2), pid: process.pid }));",
      "const logDir = join(root, '_logs', `_architect-${sessionId}`);",
      'mkdirSync(logDir, { recursive: true });',
      "const row = (type, phase) => JSON.stringify({ event_id: `EV_${type}_${process.pid}`, phase: 'architect', skill: 'architect-runner', event_type: type, input_refs: [], output_refs: [], started_at: new Date().toISOString(), metadata: { session_id: sessionId, phase } }) + '\\n';",
      "appendFileSync(join(logDir, 'events.jsonl'), row('start', 'drafting'));",
      "appendFileSync(join(logDir, 'events.jsonl'), row('end', 'awaiting-review'));",
      `setTimeout(() => process.exit(0), ${aliveMs});`,
      '',
    ].join('\n'),
  );
}

/** Writes spawned.json and a run-level START ONLY — never an end — then
 *  stays alive forever (SIGTERM-ended), for the "open start" refusal test. */
function writeOpenStartStubCli(root: string): void {
  mkdirSync(join(root, 'apps', 'forge'), { recursive: true });
  writeFileSync(
    join(root, 'apps', 'forge', 'cli.ts'),
    [
      "import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';",
      "import { join } from 'node:path';",
      "const sessionId = process.argv[4];",
      "const root = join(import.meta.dirname, '..', '..');",
      "writeFileSync(join(root, 'spawned.json'), JSON.stringify({ argv: process.argv.slice(2), pid: process.pid }));",
      "const logDir = join(root, '_logs', `_architect-${sessionId}`);",
      'mkdirSync(logDir, { recursive: true });',
      "appendFileSync(join(logDir, 'events.jsonl'), JSON.stringify({ event_id: `EV_start_${process.pid}`, phase: 'architect', skill: 'architect-runner', event_type: 'start', input_refs: [], output_refs: [], started_at: new Date().toISOString(), metadata: { session_id: sessionId, phase: 'drafting' } }) + '\\n');",
      'setInterval(() => {}, 1000);',
      '',
    ].join('\n'),
  );
}

/** Writes spawned.json immediately, but waits `delayMs` before writing ANY
 *  run-level row — the exact boot window a double-press races: the real pid
 *  is already on disk (turn.pid), but the child has not logged its own
 *  start yet. */
function writeDelayedStubCli(root: string, delayMs: number): void {
  mkdirSync(join(root, 'apps', 'forge'), { recursive: true });
  writeFileSync(
    join(root, 'apps', 'forge', 'cli.ts'),
    [
      "import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';",
      "import { join } from 'node:path';",
      "const sessionId = process.argv[4];",
      "const root = join(import.meta.dirname, '..', '..');",
      "writeFileSync(join(root, 'spawned.json'), JSON.stringify({ argv: process.argv.slice(2), pid: process.pid }));",
      "const logDir = join(root, '_logs', `_architect-${sessionId}`);",
      'mkdirSync(logDir, { recursive: true });',
      "const row = (type, phase) => JSON.stringify({ event_id: `EV_${type}_${process.pid}`, phase: 'architect', skill: 'architect-runner', event_type: type, input_refs: [], output_refs: [], started_at: new Date().toISOString(), metadata: { session_id: sessionId, phase } }) + '\\n';",
      `setTimeout(() => {`,
      "  appendFileSync(join(logDir, 'events.jsonl'), row('start', 'drafting'));",
      "  appendFileSync(join(logDir, 'events.jsonl'), row('end', 'awaiting-review'));",
      `  setTimeout(() => process.exit(0), 1500);`,
      `}, ${delayMs});`,
      '',
    ].join('\n'),
  );
}

function readEventsText(sessionId: string): string {
  try {
    return readFileSync(join(forgeRoot, '_logs', `_architect-${sessionId}`, 'events.jsonl'), 'utf8');
  } catch {
    return '';
  }
}

test('row 206 follow-up (REAL spawn): a holder still alive but whose own run-level END is already written -> the next dispatch proceeds, exactly one NEW child', async () => {
  const sessionId = `row206-ended-${Date.now()}`;
  writeEndedStubCli(forgeRoot, 2000);
  rmSync(join(forgeRoot, 'spawned.json'), { force: true });

  const first = spawnAgentTurn(forgeRoot, 'architect', 'demoproj', sessionId);
  assert.deepEqual(first, { ok: true, spawned: true });
  await waitFor(() => existsSync(join(forgeRoot, 'spawned.json')), 5000);
  const firstPid = readTurnPid(sessionId);
  livePids.push(firstPid);

  // Wait for the child's own run-level end, while it is STILL ALIVE (its
  // 2000ms sleep has not elapsed).
  await waitFor(() => readEventsText(sessionId).includes('"event_type":"end"'), 5000);
  assert.doesNotThrow(() => process.kill(firstPid, 0), 'the holder must still be alive at the moment of the second dispatch');

  const second = spawnAgentTurn(forgeRoot, 'architect', 'demoproj', sessionId);
  assert.deepEqual(second, { ok: true, spawned: true }, 'a holder that already wrote its own end must not refuse the next dispatch, even while its process is still exiting');
  await waitFor(() => readTurnPid(sessionId) !== firstPid, 5000);
  const secondPid = readTurnPid(sessionId);
  assert.notEqual(secondPid, firstPid, 'the second dispatch must be a genuinely NEW child');
  livePids.push(secondPid);

  process.kill(firstPid, 'SIGKILL'); // best-effort — it may have already exited on its own
  process.kill(secondPid, 'SIGTERM');
  await waitForExit(secondPid);
  writeStubCli(forgeRoot); // restore the default stand-in for any test that follows
});

test('row 206 follow-up (REAL spawn): a holder alive with only an OPEN run-level start (no end) is still refused as DispatchInFlight', async () => {
  const sessionId = `row206-openstart-${Date.now()}`;
  writeOpenStartStubCli(forgeRoot);
  rmSync(join(forgeRoot, 'spawned.json'), { force: true });

  const first = spawnAgentTurn(forgeRoot, 'architect', 'demoproj', sessionId);
  assert.deepEqual(first, { ok: true, spawned: true });
  await waitFor(() => existsSync(join(forgeRoot, 'spawned.json')), 5000);
  const firstPid = readTurnPid(sessionId);
  livePids.push(firstPid);
  await waitFor(() => readEventsText(sessionId).includes('"event_type":"start"'), 5000);

  assert.throws(
    () => spawnAgentTurn(forgeRoot, 'architect', 'demoproj', sessionId),
    (err: unknown) => err instanceof DispatchInFlight,
    'an open start with no end yet must refuse a second dispatch while the holder is alive',
  );

  process.kill(firstPid, 'SIGTERM');
  await waitForExit(firstPid);
  writeStubCli(forgeRoot);
});

test('row 202 double-start (REAL spawn, mark-based fix): two dispatches back-to-back right after a reclaim -> exactly ONE new child, the second gets 409', async () => {
  const sessionId = `row202-doublepress-${Date.now()}`;
  const logDir = join(forgeRoot, '_logs', `_architect-${sessionId}`);
  mkdirSync(logDir, { recursive: true });
  // Pre-existing history: a PREVIOUS turn already ran to completion in this
  // SAME session dir, and its holder has since died (dead-pid stale claim —
  // the ordinary reclaim path).
  const priorEnd = JSON.stringify({
    event_id: 'EV_prior_end', phase: 'architect', skill: 'architect-runner', event_type: 'end',
    input_refs: [], output_refs: [], started_at: new Date().toISOString(),
    metadata: { session_id: sessionId, phase: 'awaiting-review' },
  });
  writeFileSync(join(logDir, 'events.jsonl'), `${JSON.stringify({ event_id: 'EV_prior_start', phase: 'architect', skill: 'architect-runner', event_type: 'start', input_refs: [], output_refs: [], started_at: new Date().toISOString(), metadata: { session_id: sessionId, phase: 'drafting' } })}\n${priorEnd}\n`);
  const deadHolder = await deadPid();
  writeFileSync(join(logDir, 'turn.pid'), `${deadHolder}\n`);

  // The real holder, once dispatched, waits 1200ms before writing ANYTHING —
  // the exact boot window row 202's double-start raced.
  writeDelayedStubCli(forgeRoot, 1200);
  rmSync(join(forgeRoot, 'spawned.json'), { force: true });

  const first = spawnAgentTurn(forgeRoot, 'architect', 'demoproj', sessionId);
  assert.deepEqual(first, { ok: true, spawned: true }, 'the first dispatch reclaims the dead prior holder');
  const firstPid = readTurnPid(sessionId);
  assert.notEqual(firstPid, deadHolder);
  livePids.push(firstPid);

  // Immediately (no wait) — the child has not written its own start/end yet
  // (events.jsonl still ends with the PRIOR holder's `end`). Without the
  // claim mark this would misread that stale `end` as "this holder is
  // finished" and spawn a SECOND child.
  assert.throws(
    () => spawnAgentTurn(forgeRoot, 'architect', 'demoproj', sessionId),
    (err: unknown) => {
      assert.ok(err instanceof DispatchInFlight);
      assert.equal((err as DispatchInFlight).holderPid, firstPid, 'must name the just-claimed REAL holder, not the dead prior one');
      return true;
    },
    'a dispatch immediately after a reclaim must not spawn a second child before the new holder has logged anything',
  );
  assert.equal(readTurnPid(sessionId), firstPid, 'the refused second dispatch must not touch the live holder\'s turn.pid');

  process.kill(firstPid, 'SIGTERM');
  await waitForExit(firstPid);
  writeStubCli(forgeRoot);
});

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
