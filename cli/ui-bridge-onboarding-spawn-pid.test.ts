/**
 * W7-FIX-A2 (W7A2-01, HIGH) — `POST /api/studio/onboarding/start` records
 * its dispatch child's pid where the generic cancel route looks.
 *
 * The sweep confirmed `turn.pid` was written in exactly ONE place
 * (`spawnAgentTurn`, gated on SPAWN_AGENT_SPECS) and onboarding goes through
 * `spawnAgentDispatch` instead — so `_logs/_onboarding-<sid>/turn.pid` was a
 * path nothing ever wrote, `killTrackedTurn` returned false unconditionally
 * for onboarding, and cancel could never kill an onboarding turn.
 *
 * This pin spawns for REAL (FORGE_ARCHITECT_NO_SPAWN unset, no dry-bridge)
 * against a scratch forgeRoot: the child is `node --experimental-strip-types
 * orchestrator/cli.ts agent dispatch …` with cwd = the scratch root, where no
 * `orchestrator/cli.ts` exists — so it exits within milliseconds and no
 * agent ever runs; the spawn still yields a pid, and THAT is what must land
 * in `_logs/_onboarding-<sid>/turn.pid` (the SAME `sessionLogDirName(kind,
 * sid)` template the lifecycle derivation and `killTrackedTurn` read).
 *
 * RUN: node --test --experimental-strip-types cli/ui-bridge-onboarding-spawn-pid.test.ts
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startBridge } from './ui-bridge.ts';
import { sessionLogDirName } from './bridge-studio-lifecycle.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };
const PROJECT = 'demoproj';

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;
let priorNoSpawn: string | undefined;
let priorDryBridge: string | undefined;

before(async () => {
  priorNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  priorDryBridge = process.env.FORGE_DRY_BRIDGE;
  delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  delete process.env.FORGE_DRY_BRIDGE;

  forgeRoot = mkdtempSync(join(tmpdir(), 'onboarding-spawn-pid-'));
  for (const state of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'projects', PROJECT), { recursive: true });
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
  if (priorNoSpawn === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  else process.env.FORGE_ARCHITECT_NO_SPAWN = priorNoSpawn;
  if (priorDryBridge === undefined) delete process.env.FORGE_DRY_BRIDGE;
  else process.env.FORGE_DRY_BRIDGE = priorDryBridge;
});

test('W7-FIX-A2: POST /api/studio/onboarding/start writes the dispatch child\'s pid to _logs/_onboarding-<sid>/turn.pid — the SAME dir the cancel route\'s killTrackedTurn reads', async () => {
  const res = await fetch(`${url}/api/studio/onboarding/start`, {
    method: 'POST', headers: CSRF, body: JSON.stringify({ project: PROJECT, inputs: { northStar: 'ship it' } }),
  });
  const text = await res.text();
  assert.equal(res.status, 200, `start must succeed: ${text}`);
  const body = JSON.parse(text) as { ok: boolean; sessionId: string; runId: string };
  assert.equal(body.ok, true);
  assert.equal(typeof body.sessionId, 'string');

  const pidPath = join(forgeRoot, '_logs', sessionLogDirName('onboarding', body.sessionId), 'turn.pid');
  assert.ok(existsSync(pidPath), `expected ${pidPath} — onboarding's turn was never pid-tracked before this fix (killTrackedTurn found nothing, cancel was a no-op)`);
  const raw = readFileSync(pidPath, 'utf8').trim();
  assert.match(raw, /^\d+$/, `turn.pid must hold a bare pid, got ${JSON.stringify(raw)}`);
  const pid = Number.parseInt(raw, 10);
  assert.ok(pid > 1 && pid !== process.pid, 'the recorded pid is a real child, never the bridge itself');

  // The dispatch run's own log dir (stderr for the monitor) is untouched by
  // this change — both files coexist: `_logs/<runId>/stderr.log` and
  // `_logs/_onboarding-<sid>/turn.pid`.
  assert.ok(existsSync(join(forgeRoot, '_logs', body.runId, 'stderr.log')), 'the run-id log dir (stderr.log) must still be created');
});
