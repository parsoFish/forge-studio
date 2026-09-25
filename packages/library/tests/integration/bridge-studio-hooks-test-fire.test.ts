/**
 * forge-6gv.8.1 (library-33) — `POST /api/studio/hooks/:id/test-fire`: an
 * operator-initiated control that runs a hook through the SAME prepare step
 * production dispatch uses (`runHookScriptAsync`'s `prepareHookRun` gate:
 * approval + package pin + env fence), never a bypass, and records the run
 * in a small bounded per-hook log (`@forge/kernel`'s `readBoundedLog`).
 *
 * Driven via the CARVED HANDLER directly (`dispatchRoute` + `libraryRoutes`),
 * mirroring `bridge-studio-hooks-fire-activity.test.ts`'s own seam.
 *
 * WHAT EACH TEST KILLS:
 *  - "unknown hook -> 404" kills a handler that spawns before checking the
 *    hook exists.
 *  - "unapproved hook -> 409, clear message, NOTHING spawned, nothing
 *    logged" kills a route that bypasses the real gate (spawns anyway) or
 *    that silently swallows the refusal into a 200.
 *  - "unbound (carriedByCount 0) hook can still test-fire once approved"
 *    kills a route that wrongly also requires a binding.
 *  - "approved hook runs for real and is recorded" kills a route that
 *    fakes success without a real spawn, or that never writes the log.
 *  - "dry-bridge refuses without spawning" kills a route with no dry-bridge
 *    guard on a route that spawns a real subprocess.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import yaml from 'js-yaml';

import { dispatchRoute, DRY_BRIDGE_ENV, readBoundedLog, boundedLogSegments } from '@forge/kernel';
import { approveHook } from '../../studio/hook-approval-ledger.ts';
import { libraryRoutes, type LibraryRouteContext } from '../../routes.ts';
import { HOOK_TEST_FIRE_LOG_DIR } from '../../bridge-studio-hooks-test-fire.ts';
import { fixtureAgentFacts } from '../test-fixtures/agent-fixture.ts';
import { fixtureFlowSource } from '../test-fixtures/flow-fixture.ts';
import { inertAuthoringSession } from '../test-fixtures/authoring-session-fixture.ts';

let forgeRoot: string;
let logsRoot: string;
let routes: ReturnType<typeof libraryRoutes>;

before(() => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-hooks-test-fire-'));
  logsRoot = join(forgeRoot, '_logs');
  mkdirSync(logsRoot, { recursive: true });
  routes = libraryRoutes({
    agentFacts: fixtureAgentFacts(forgeRoot),
    isSdkAvailable: () => false,
    flowSource: fixtureFlowSource,
    authoringSession: inertAuthoringSession,
  });
});

after(() => {
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

function writeHook(id: string, scriptBody = '#!/usr/bin/env bash\necho hi\n'): void {
  const dir = join(forgeRoot, 'studio', 'hooks', id);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'scripts', 'run.sh'), scriptBody, 'utf8');
  writeFileSync(
    join(dir, 'hook.yaml'),
    yaml.dump({ id, name: id, description: `Test hook ${id}.`, on: 'SessionEnd', script: 'scripts/run.sh', permissions: { env: [], read: [], network: false } }),
    'utf8',
  );
}

function mockRes(): { res: ServerResponse; status: () => number; body: () => Record<string, unknown> } {
  let payload = '{}';
  let code = 0;
  const res = {
    writeHead: (s: number) => { code = s; return res; },
    end: (chunk?: string) => { if (chunk !== undefined) payload = chunk; return res; },
  } as unknown as ServerResponse;
  return { res, status: () => code, body: () => JSON.parse(payload) as Record<string, unknown> };
}

async function postTestFire(id: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const { res, status, body } = mockRes();
  const ctx: LibraryRouteContext = { forgeRoot, logsRoot, readBody: async () => ({}) };
  const handled = await dispatchRoute(routes, {} as IncomingMessage, res, ctx, `/api/studio/hooks/${id}/test-fire`, 'POST');
  assert.ok(handled, `POST /api/studio/hooks/${id}/test-fire was not claimed by any route`);
  return { status: status(), body: body() };
}

test('unknown hook id -> 404', async () => {
  const { status, body } = await postTestFire('nope-not-a-hook');
  assert.equal(status, 404);
  assert.ok(typeof body.error === 'string');
});

test('an UNAPPROVED hook is refused: 409, a clear message, nothing recorded', async () => {
  writeHook('unapproved-test-fire-hook'); // deliberately NOT approved
  const { status, body } = await postTestFire('unapproved-test-fire-hook');
  assert.equal(status, 409);
  assert.match(String(body.error), /not approved/i);
  const log = readBoundedLog(logsRoot, boundedLogSegments(HOOK_TEST_FIRE_LOG_DIR, 'unapproved-test-fire-hook'));
  assert.deepEqual(log, [], 'an unapproved test-fire attempt must not be recorded as a run');
});

test('an approved, UNBOUND hook still test-fires (binding is not required)', async () => {
  writeHook('approved-unbound-hook');
  approveHook({ forgeRoot, id: 'approved-unbound-hook' });

  const { status, body } = await postTestFire('approved-unbound-hook');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.outcome, 'ran');
  assert.equal(body.exitCode, 0);
  assert.equal(body.event, 'SessionEnd');

  const log = readBoundedLog<Record<string, unknown>>(logsRoot, boundedLogSegments(HOOK_TEST_FIRE_LOG_DIR, 'approved-unbound-hook'));
  assert.equal(log.length, 1);
  assert.equal(log[0]!.outcome, 'ran');
  assert.equal(log[0]!.exitCode, 0);
});

test('dry-bridge mode refuses the test-fire without spawning', async () => {
  const markerDir = mkdtempSync(join(tmpdir(), 'hook-test-fire-marker-'));
  const markerPath = join(markerDir, 'must-not-exist.marker');
  writeHook('dry-bridge-hook', `#!/usr/bin/env bash\necho ran > ${JSON.stringify(markerPath)}\n`);
  approveHook({ forgeRoot, id: 'dry-bridge-hook' });

  process.env[DRY_BRIDGE_ENV] = '1';
  try {
    const { status, body } = await postTestFire('dry-bridge-hook');
    assert.equal(status, 409);
    assert.equal(body.error, 'dry-bridge');
  } finally {
    delete process.env[DRY_BRIDGE_ENV];
    rmSync(markerDir, { recursive: true, force: true });
  }
  assert.equal(existsSync(markerPath), false, 'dry-bridge must never actually spawn the hook script');
});

test('a test-fire is surfaced on GET /api/studio/hooks/:id as testFireRuns', async () => {
  writeHook('detail-test-fire-hook');
  approveHook({ forgeRoot, id: 'detail-test-fire-hook' });
  await postTestFire('detail-test-fire-hook');

  const { res, body } = mockRes();
  const ctx: LibraryRouteContext = { forgeRoot, logsRoot, readBody: async () => ({}) };
  const handled = await dispatchRoute(routes, {} as IncomingMessage, res, ctx, '/api/studio/hooks/detail-test-fire-hook', 'GET');
  assert.ok(handled);
  const detail = body();
  const runs = detail['testFireRuns'] as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(runs), `expected testFireRuns to be an array, got ${JSON.stringify(detail['testFireRuns'])}`);
  assert.equal(runs.length, 1);
  assert.equal(runs[0]!.outcome, 'ran');
});
