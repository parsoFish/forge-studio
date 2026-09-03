/**
 * routes-dispatch.test.ts — drive the carved route table directly.
 *
 * Ruling 5: package tests never boot the bridge. `startBridge` is a
 * 6,602-line host that resolves config, runs a reflect-reconcile startup pass
 * and wires every route family; none of that is under test here. These tests
 * call `dispatchRoute` against `knowledgeRoutes` with a mock `req`/`res` pair,
 * which is the whole point of carving the dispatch out of the host.
 *
 * WHICH WRONG IMPLEMENTATION EACH TEST KILLS:
 *
 *  1. THE QUERY-STRING 404 — the defect this file was written for, found by
 *     review before it shipped. The extracted handlers each rebuild their own
 *     anchored regex (`…/drain$`). Inside the old if-chain they were only ever
 *     reached through `handleStudioKbDrainRoutes`, which had ALREADY called
 *     `pathOnly(rawUrl)`. The table hands them the RAW url on purpose (so an
 *     arm that later needs the query string still has it), and a handler that
 *     does not normalise for itself fails `…/drain$` against
 *     `…/drain?x=1`, declines, and the request 404s with nothing red — a
 *     route that worked through the bridge and silently stops working through
 *     the table. `dispatchesAQueryBearingUrl` pins it.
 *  2. THE ORDER COLLISION — `…/drain/cancel` also matches the `drain/:runId`
 *     pattern with `runId === 'cancel'`. `routes-table.test.ts` proves the
 *     right ENTRY claims it; this file proves the right HANDLER runs, which is
 *     the thing that actually matters and the thing a status code cannot show.
 *  3. THE FALL-THROUGH CONTRACT — `dispatchRoute` must return `false`, not
 *     throw and not answer, for a URL no entry owns, or the host cannot fall
 *     through to its remaining switch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { dispatchRoute } from '@forge/kernel';
import { knowledgeRoutes, type KnowledgeRouteContext } from '../../routes.ts';

/**
 * `knowledgeRoutes` is a factory (M4-knowledge s5): `listFlowIds` is the
 * Flow-kind loader in the legacy registry, which a rank-2 package may not
 * import, so the host supplies it. These stubs are deliberately NOT the real
 * loaders — a table test asserts on the table's shape, and a dispatch test on
 * a handler's response; neither should depend on what flows exist on disk.
 */
const routes = knowledgeRoutes({
  listFlowIds: () => ['forge-develop'],
  listFlowBandIds: () => ['review-band', 'demo-band'],
  // M4 ruling 86: the real fix turn is injected by the assembly, so route
  // tests declare one. It THROWS: no assertion in this file expects a fix turn
  // to be dispatched, and a stub that returned a plausible result would let a
  // future change dispatch one here unnoticed.
  runFixTurn: async () => {
    throw new Error('unexpected brain-fix dispatch in this test');
  },
});

type Captured = { status: number | null; body: string };

/** The smallest `res` `sendJson` needs: `writeHead(status, headers)` + `end(payload)`. */
function mockRes(): { res: ServerResponse; captured: Captured } {
  const captured: Captured = { status: null, body: '' };
  const res = {
    writeHead(status: number) { captured.status = status; return res; },
    end(payload?: string) { if (payload !== undefined) captured.body = payload; return res; },
  } as unknown as ServerResponse;
  return { res, captured };
}

/** `allowedOrigin` reads `req.headers.origin` and nothing else. */
const mockReq = () => ({ headers: {} }) as unknown as IncomingMessage;

/** `readBody` is the HOST's supplier (T1 ruling 30): the host applies the CSRF
 *  and transport policy and hands the RESULT down, so a test drives the seam by
 *  supplying the result — not by faking a request stream, which would be
 *  re-testing the host's body policy inside a package test. A handler that
 *  needs no body never calls it, so the default throws rather than returning
 *  `undefined`: a handler reading a body it was not given should fail loudly. */
function ctx(body?: unknown): KnowledgeRouteContext {
  const root = mkdtempSync(join(tmpdir(), 'forge-knowledge-routes-'));
  mkdirSync(join(root, 'brain'), { recursive: true });
  return {
    forgeRoot: root,
    logsRoot: join(root, '_logs'),
    readBody: async () => {
      if (arguments.length === 0 && body === undefined) throw new Error('readBody() called by a handler this test gave no body');
      return body;
    },
  };
}

test('routes-dispatch: a query-bearing url reaches its handler — the table hands handlers the RAW url, so a handler that does not normalise for itself 404s silently', async () => {
  const { res, captured } = mockRes();
  const answered = await dispatchRoute(
    routes, mockReq(), res, ctx(),
    '/api/studio/kbs/cycles/drain?cacheBust=1', 'GET',
  );
  assert.equal(answered, true,
    'no entry answered GET /api/studio/kbs/cycles/drain?cacheBust=1. ' +
    'The entry MATCHES (routes.ts strips the query before testing its regex), so the ' +
    'decline came from inside the handler: it rebuilt an anchored regex against the raw ' +
    'url and lost. Through the bridge this route worked, because the old dispatcher ' +
    'called pathOnly() first. Every extracted handler must normalise its own url.');
  assert.notEqual(captured.status, null, 'the handler claimed the request but never answered it — the host would hang');
});

test('routes-dispatch: the same url without a query behaves identically — proves the test above is about the query, not about the route being broken outright', async () => {
  const { res, captured } = mockRes();
  const answered = await dispatchRoute(
    routes, mockReq(), res, ctx(),
    '/api/studio/kbs/cycles/drain', 'GET',
  );
  assert.equal(answered, true, 'the bare route must answer');
  assert.notEqual(captured.status, null, 'the handler must send a response');
});

test('routes-dispatch: POST /drain/cancel runs the CANCEL handler, not the drain/:runId handler that also matches it with runId="cancel"', async () => {
  const c = ctx();
  const { res, captured } = mockRes();
  const answered = await dispatchRoute(
    routes, mockReq(), res, c,
    '/api/studio/kbs/cycles/drain/cancel', 'POST',
  );
  assert.equal(answered, true, 'POST /api/studio/kbs/:id/drain/cancel must be claimed and answered');
  // The run-status handler is GET-only and would decline a POST outright; the
  // cancel handler answers. Asserting SOMETHING answered a POST here is
  // therefore the discriminating check — a table that let the run handler take
  // this URL would return false and the request would 404.
  assert.notEqual(captured.status, null, 'the cancel handler must send a response');
});

test('routes-dispatch: a url no entry owns returns false without answering — the host must be able to fall through to its remaining switch', async () => {
  const { res, captured } = mockRes();
  const answered = await dispatchRoute(
    routes, mockReq(), res, ctx(),
    '/api/studio/projects', 'GET',
  );
  assert.equal(answered, false, 'the knowledge table must not claim another package\'s route');
  assert.equal(captured.status, null,
    'declining is silent: an entry that answers AND returns false makes the host send a second response');
});

test('routes-dispatch: a method no entry declares returns false — DELETE on a drain route is not silently treated as GET', async () => {
  const { res, captured } = mockRes();
  const answered = await dispatchRoute(
    routes, mockReq(), res, ctx(),
    '/api/studio/kbs/cycles/drain', 'DELETE',
  );
  assert.equal(answered, false, 'no entry declares DELETE on /drain');
  assert.equal(captured.status, null, 'nothing should have been sent');
});

// ---------------------------------------------------------------------------
// DRY-BRIDGE POSITIVE CONTROL — the falsifier for the table's one judgement
// ---------------------------------------------------------------------------

/**
 * `routes.ts` classifies `POST /api/studio/kbs/:id/maintenance` as ONE row
 * valued `stub-actions` (T1 ruling 29: `op` is a BODY field, and a
 * discriminator `matches: (url) => boolean` cannot read is not one the table
 * can split on). `routes-table.test.ts` asserts that string.
 *
 * A string is not a guarantee. `stub-actions` is a claim about what the
 * HANDLER does under `FORGE_DRY_BRIDGE=1`, and a claim about a handler that
 * the handler cannot falsify is exactly the declared-data-fails-open shape
 * this campaign exists to kill — the same shape H8 spent a PR removing from
 * the KB seam. These two tests are the control, and they are a PAIR on
 * purpose: one direction alone proves nothing.
 *
 *   · If the inline `isDryBridge()` guard were DELETED, the first test fails —
 *     `op=fix-agent` would spawn under a dry bridge, which is the incident the
 *     whole dry-bridge seam exists to prevent.
 *   · If the row were widened to `refuse` (or the guard hoisted to cover every
 *     op), the second test fails — the three harmless ops would lose an
 *     exemption harness runs have today, and `stub-actions` would be the wrong
 *     word for a route that refuses everything.
 *
 * They boot no bridge (ruling 5): `dispatchRoute` against the real table with
 * a mock req/res, which is the whole point of carving dispatch out of the host.
 */
/** Set `FORGE_DRY_BRIDGE=1` for one call and restore whatever was there —
 *  including the `undefined` case, which a naive save/restore turns into the
 *  literal string 'undefined' and leaks into every later test in the file. */
async function underDryBridge<T>(fn: () => Promise<T>): Promise<T> {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'FORGE_DRY_BRIDGE');
  const prev = process.env.FORGE_DRY_BRIDGE;
  process.env.FORGE_DRY_BRIDGE = '1';
  try {
    return await fn();
  } finally {
    if (had) process.env.FORGE_DRY_BRIDGE = prev;
    else delete process.env.FORGE_DRY_BRIDGE;
  }
}

test('dry-bridge positive control: under FORGE_DRY_BRIDGE=1 the maintenance route REFUSES op=fix-agent — the one op that spawns', async () => {
  const { res, captured } = mockRes();
  const answered = await underDryBridge(() => dispatchRoute(
    routes, mockReq(), res,
    ctx({ op: 'fix-agent', file: 'brain/forge-dev/themes/x.md', check: 'frontmatter', kind: 'agent', message: 'x' }),
    '/api/studio/kbs/cycles/maintenance', 'POST',
  ));
  assert.equal(answered, true, 'no entry claimed POST /api/studio/kbs/cycles/maintenance');
  assert.equal(captured.status, 409,
    'op=fix-agent must be REFUSED under a dry bridge. This is the branch that spawns a real ' +
    '`forge brain fix` child process; the inline isDryBridge() guard is the only thing stopping it, ' +
    'and the route table\'s `stub-actions` classification is a claim that the guard is there. ' +
    `Got status ${captured.status}.`);
  assert.equal(JSON.parse(captured.body).error, 'dry-bridge',
    'a 409 from somewhere else is not the refusal — the body must carry the typed dry-bridge shape');
});

test('dry-bridge positive control: under FORGE_DRY_BRIDGE=1 the SAME route lets op=lint proceed — which is why the row is stub-actions and not refuse', async () => {
  const { res, captured } = mockRes();
  const answered = await underDryBridge(() => dispatchRoute(
    routes, mockReq(), res, ctx({ op: 'lint' }), '/api/studio/kbs/cycles/maintenance', 'POST',
  ));
  assert.equal(answered, true, 'no entry claimed POST /api/studio/kbs/cycles/maintenance');
  assert.notEqual(captured.status, 409,
    'op=lint must NOT be refused under a dry bridge — it reads and lints local files and spawns ' +
    'nothing. If this now 409s, the guard was hoisted above the op switch and three harmless ops ' +
    'lost an exemption harness runs depend on; the row would have to become `refuse`, and ruling 29 ' +
    'chose `stub-actions` precisely to avoid that cost.');
  assert.equal(captured.status, 200, `op=lint should answer 200; got ${captured.status} body=${captured.body}`);
});
