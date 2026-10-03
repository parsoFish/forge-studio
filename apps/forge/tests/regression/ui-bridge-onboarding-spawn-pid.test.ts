/**
 * PR #183 — W7-FIX-A2 (W7A2-01): onboarding's dispatch pid was never recorded, so cancel could not kill it.
 *
 * W7-FIX-A2 (W7A2-01, HIGH) — the onboarding dispatch (since ruling 441,
 * the brief's question-form write, never `POST /api/studio/onboarding/start`)
 * records its dispatch child's pid where the generic cancel route looks.
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
 * Row 202 (bead forge-8vfn.8.5.42), T1 ruling 1973hq — ONE dispatch per
 * onboarding run. MEASURED on the costed gate's S1 run
 * (`_1.0/evidence/m7-e-gate1-s1-capture/_story-logs-clear/_agent-onboarding-agent-2026-10-03T01-23-10-524-pyvr/events.jsonl`):
 * ONE run id carried TWO `start` rows 37 ms apart (01:23:11.204Z and
 * .241Z, distinct event_ids, heartbeats parented to each) and TWO run-level
 * `end` rows ($0.80 at 01:28:34Z, $1.37 at 01:32:28Z) — two whole agents on
 * one ground, not two passes of one. Ruling 441 (commit 462c977dd) moved the
 * dispatch to the brief and the t0 marker with it, but left
 * `ctx.spawnAgentDispatch` behind in the start route, so the project page's
 * one press (start, then the brief) spawned twice. The 441 pins in
 * apps/forge/tests/integration/ui-bridge-onboarding-briefing.test.ts read the
 * MARKER as their "was it dispatched" proxy under FORGE_ARCHITECT_NO_SPAWN —
 * the marker moved, the spawn did not, and the proxy could not see it. This
 * file spawns for real, so the child's own `_logs/<runId>/` dir is the
 * observable: start alone must create none.
 *
 * RUN: node --test --experimental-strip-types apps/forge/tests/regression/ui-bridge-onboarding-spawn-pid.test.ts
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startBridge } from '../../ui-bridge.ts';
import { sessionLogDirName } from '@forge/sessions';

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
  // The brief route resolves the kind from the REAL, checked-in
  // `studio/session-kinds.yaml` — copied byte-for-byte, as
  // apps/forge/tests/integration/ui-bridge-onboarding-briefing.test.ts does.
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'session-kinds.yaml'), readFileSync(join(repoRoot, 'studio', 'session-kinds.yaml'), 'utf8'));
  writeFileSync(
    join(forgeRoot, 'studio', 'catalog.yaml'),
    ['sdks: []', 'models: []', 'tools: []', 'mcps: []', 'guards: []', 'community-skills: []', ''].join('\n'),
  );
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

/** The project page's press, as S1 beat 4 makes it: start carrying the north
 *  star, then the brief through the generic question-form affordance. */
async function startOnboarding(): Promise<{ sessionId: string; runId: string }> {
  const res = await fetch(`${url}/api/studio/onboarding/start`, {
    method: 'POST', headers: CSRF, body: JSON.stringify({ project: PROJECT, inputs: { northStar: 'ship it' } }),
  });
  const text = await res.text();
  assert.equal(res.status, 200, `start must succeed: ${text}`);
  const body = JSON.parse(text) as { ok: boolean; sessionId: string; runId: string };
  assert.equal(body.ok, true);
  assert.equal(typeof body.sessionId, 'string');
  return body;
}

async function brief(sessionId: string): Promise<void> {
  const res = await fetch(`${url}/api/studio/sessions/onboarding/${sessionId}/briefing-question-form`, {
    method: 'POST',
    headers: CSRF,
    body: JSON.stringify({ project: PROJECT, answers: [{ question: 'brief', answer: 'ship it; the gate is npm test' }] }),
  });
  const text = await res.text();
  assert.equal(res.status, 200, `the brief must be accepted: ${text}`);
}

test('row 202: start ALONE spawns no agent — no child, so no `_logs/<runId>/` and no session turn.pid', async () => {
  const { sessionId, runId } = await startOnboarding();
  // `spawnAgentDispatch` (apps/forge/bridge-agent-dispatch.ts) creates
  // `_logs/<runId>/stderr.log` and `turn.pid` for EVERY real spawn, before the
  // child has run a line; the start route writes nothing else under that dir
  // since 441 moved the t0 marker to the brief. Its presence here is the
  // second dispatch the S1 capture measured.
  assert.ok(!existsSync(join(forgeRoot, '_logs', runId)), `start spawned a dispatch child for ${runId} — the brief spawns another, two agents on one run id (row 202)`);
  assert.ok(!existsSync(join(forgeRoot, '_logs', sessionLogDirName('onboarding', sessionId), 'turn.pid')), 'no child, so no session pid either');
});

test('W7-FIX-A2: the brief\'s dispatch writes its child\'s pid to _logs/_onboarding-<sid>/turn.pid — the SAME dir the cancel route\'s killTrackedTurn reads', async () => {
  const body = await startOnboarding();
  await brief(body.sessionId);

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
