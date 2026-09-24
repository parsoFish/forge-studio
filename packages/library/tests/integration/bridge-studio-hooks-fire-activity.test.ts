/**
 * forge-8vfn.5.16 (M7-C U2) — the hook detail route (`GET
 * /api/studio/hooks/:id`) must surface a hook's last-fire facts
 * (`lastFireAt`/`lastFireOutcome`/`recentFireCount`), derived from the SAME
 * `hook.fire` events `packages/agents/studio/hook-dispatch.ts`'s
 * `emitHookFire` appends (see `packages/library/studio/hook-fire-summary.ts`
 * for the pure fold + the bounded scan engine).
 *
 * Driven via the CARVED HANDLER directly (`dispatchRoute` + `libraryRoutes`),
 * the same lightweight seam `bridge-studio-hooks.test.ts`'s own "handler
 * contract — direct invocation" block and
 * `packages/knowledge/tests/unit/bridge-studio-kb-drain-routes.test.ts` use —
 * no real HTTP server, no SDK spawn.
 *
 * WHAT EACH TEST KILLS:
 *  - "never fired -> absent, not fabricated" kills an implementation that
 *    defaults to `recentFireCount: 0` alone without checking there IS such a
 *    key, or that invents a `lastFireAt`/`lastFireOutcome` for a hook with
 *    no fire history.
 *  - "real fires across TWO cycles -> latest wins, total counted" kills a
 *    route that only scans the hook's own most-recent binding cycle, or
 *    that stops at the first cycle `listCycles` returns.
 *  - "a fire recorded for a DIFFERENT hook id never counts" kills a route
 *    that filters on `message==='hook.fire'` alone.
 *  - "the route never opens more than HOOK_FIRE_SCAN_MAX_CYCLES cycle dirs"
 *    (T2 review of 95cb287f) kills a route that reverted to (or never
 *    wired) the bounded engine — real files, real directory mtimes (via
 *    `utimesSync`), no fakes: a fire recorded ONLY in cycles older than the
 *    scanned window must be genuinely invisible on the wire.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import yaml from 'js-yaml';

import { createLogger, dispatchRoute } from '@forge/kernel';
import { approveHook } from '@forge/library/studio/hook-approval-ledger.ts';
import { libraryRoutes, type LibraryRouteContext } from '../../routes.ts';
import { HOOK_FIRE_SCAN_MAX_CYCLES } from '../../studio/hook-fire-summary.ts';
import { fixtureAgentFacts } from '../test-fixtures/agent-fixture.ts';
import { fixtureFlowSource } from '../test-fixtures/flow-fixture.ts';
import { inertAuthoringSession } from '../test-fixtures/authoring-session-fixture.ts';

let forgeRoot: string;
let routes: ReturnType<typeof libraryRoutes>;

before(() => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-hooks-fire-activity-'));
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  // Built AFTER forgeRoot exists — fixtureAgentFacts closes over the value at
  // call time, so building this before `before()` ran would bind it to an
  // unassigned root forever.
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

function writeHook(id: string): void {
  const dir = join(forgeRoot, 'studio', 'hooks', id);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'scripts', 'run.sh'), '#!/usr/bin/env bash\necho ok\n', 'utf8');
  writeFileSync(
    join(dir, 'hook.yaml'),
    yaml.dump({
      id, name: id, description: `Test hook ${id}.`, on: 'SessionEnd',
      script: 'scripts/run.sh', permissions: { env: [], read: [], network: false },
    }),
    'utf8',
  );
  approveHook({ forgeRoot, id });
}

/** Appends a real `hook.fire` event into `_logs/<cycleId>/events.jsonl`, the
 *  exact shape `emitHookFire` (hook-dispatch.ts) writes. */
function recordFire(cycleId: string, hookId: string, outcome: string, startedAt: string): void {
  const logger = createLogger(cycleId, join(forgeRoot, '_logs'));
  logger.emit({
    initiative_id: cycleId, phase: 'orchestrator', skill: `hook:${hookId}`,
    event_type: outcome === 'ran' ? 'log' : 'error', input_refs: [], output_refs: [],
    message: 'hook.fire', started_at: startedAt,
    metadata: { hookId, event: 'SessionEnd', outcome, exitCode: outcome === 'ran' ? 0 : null, durationMs: outcome === 'ran' ? 42 : null },
  });
}

function mockRes(): { res: ServerResponse; body: () => Record<string, unknown> } {
  let payload = '{}';
  const res = {
    writeHead: () => res,
    end: (chunk?: string) => { if (chunk !== undefined) payload = chunk; return res; },
  } as unknown as ServerResponse;
  return { res, body: () => JSON.parse(payload) as Record<string, unknown> };
}

async function getDetail(id: string): Promise<Record<string, unknown>> {
  const { res, body } = mockRes();
  const ctx: LibraryRouteContext = { forgeRoot, logsRoot: join(forgeRoot, '_logs'), readBody: async () => ({}) };
  const handled = await dispatchRoute(routes, {} as IncomingMessage, res, ctx, `/api/studio/hooks/${id}`, 'GET');
  assert.ok(handled, `GET /api/studio/hooks/${id} was not claimed by any route`);
  return body();
}

test('a hook that has never fired reports recentFireCount:0 and no last-fire fields at all (never fabricated)', async () => {
  writeHook('never-fired-hook');
  const detail = await getDetail('never-fired-hook');
  assert.equal(detail['recentFireCount'], 0);
  assert.equal('lastFireAt' in detail, false, 'lastFireAt must be ABSENT, not an invented value, for a hook with no fire history');
  assert.equal('lastFireOutcome' in detail, false);
});

test('real fires recorded across TWO cycles: the LATEST wins and every fire is counted', async () => {
  writeHook('multi-cycle-hook');
  recordFire('cycle-a', 'multi-cycle-hook', 'ran', '2026-09-25T09:00:00.000Z');
  recordFire('cycle-b', 'multi-cycle-hook', 'refused', '2026-09-25T11:00:00.000Z');
  recordFire('cycle-a', 'multi-cycle-hook', 'ran', '2026-09-25T10:00:00.000Z');

  const detail = await getDetail('multi-cycle-hook');
  assert.equal(detail['recentFireCount'], 3, `expected 3 fires across both cycles, got ${JSON.stringify(detail)}`);
  assert.equal(detail['lastFireAt'], '2026-09-25T11:00:00.000Z');
  assert.equal(detail['lastFireOutcome'], 'refused');
});

test('a fire recorded for a DIFFERENT hook id is never counted here', async () => {
  writeHook('hook-x');
  writeHook('hook-y');
  recordFire('cycle-c', 'hook-y', 'ran', '2026-09-25T12:00:00.000Z');

  const detail = await getDetail('hook-x');
  assert.equal(detail['recentFireCount'], 0);
  assert.equal('lastFireAt' in detail, false);
});

test(`T2 review of 95cb287f: the route never opens more than HOOK_FIRE_SCAN_MAX_CYCLES (${HOOK_FIRE_SCAN_MAX_CYCLES}) cycle dirs — a fire only in an older-than-bound cycle is invisible`, async () => {
  writeHook('bounded-hook');
  const OLD_CYCLES = 5;
  const NEW_CYCLES = HOOK_FIRE_SCAN_MAX_CYCLES; // exactly fills the window on its own
  const now = Date.now();

  // The OLDEST cycles carry the only real fires for this hook.
  for (let i = 0; i < OLD_CYCLES; i++) {
    const cycleId = `bounded-old-${i}`;
    recordFire(cycleId, 'bounded-hook', 'ran', new Date(now - 100_000_000).toISOString());
    utimesSync(join(forgeRoot, '_logs', cycleId), new Date(now - 100_000_000), new Date(now - 100_000_000));
  }
  // Exactly HOOK_FIRE_SCAN_MAX_CYCLES NEWER cycles, none of which carry a
  // fire for this hook — filling the window entirely on their own.
  for (let i = 0; i < NEW_CYCLES; i++) {
    const cycleId = `bounded-new-${i}`;
    const logger = createLogger(cycleId, join(forgeRoot, '_logs'));
    logger.emit({
      initiative_id: cycleId, phase: 'orchestrator', skill: 'noise', event_type: 'log',
      input_refs: [], output_refs: [], message: 'noise.unrelated',
    });
    const mtime = new Date(now - i * 1000); // still all far newer than the old cycles above
    utimesSync(join(forgeRoot, '_logs', cycleId), mtime, mtime);
  }

  const detail = await getDetail('bounded-hook');
  assert.equal(
    detail['recentFireCount'],
    0,
    `the ${OLD_CYCLES} real fires live outside the ${HOOK_FIRE_SCAN_MAX_CYCLES}-cycle newest-first window and must not be counted, got ${JSON.stringify(detail)}`,
  );
  assert.equal('lastFireAt' in detail, false);
});
