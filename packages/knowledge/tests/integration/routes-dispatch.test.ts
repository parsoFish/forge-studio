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

function ctx(): KnowledgeRouteContext {
  const root = mkdtempSync(join(tmpdir(), 'forge-knowledge-routes-'));
  mkdirSync(join(root, 'brain'), { recursive: true });
  return { forgeRoot: root, logsRoot: join(root, '_logs') };
}

test('routes-dispatch: a query-bearing url reaches its handler — the table hands handlers the RAW url, so a handler that does not normalise for itself 404s silently', async () => {
  const { res, captured } = mockRes();
  const answered = await dispatchRoute(
    knowledgeRoutes, mockReq(), res, ctx(),
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
    knowledgeRoutes, mockReq(), res, ctx(),
    '/api/studio/kbs/cycles/drain', 'GET',
  );
  assert.equal(answered, true, 'the bare route must answer');
  assert.notEqual(captured.status, null, 'the handler must send a response');
});

test('routes-dispatch: POST /drain/cancel runs the CANCEL handler, not the drain/:runId handler that also matches it with runId="cancel"', async () => {
  const c = ctx();
  const { res, captured } = mockRes();
  const answered = await dispatchRoute(
    knowledgeRoutes, mockReq(), res, c,
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
    knowledgeRoutes, mockReq(), res, ctx(),
    '/api/studio/projects', 'GET',
  );
  assert.equal(answered, false, 'the knowledge table must not claim another package\'s route');
  assert.equal(captured.status, null,
    'declining is silent: an entry that answers AND returns false makes the host send a second response');
});

test('routes-dispatch: a method no entry declares returns false — DELETE on a drain route is not silently treated as GET', async () => {
  const { res, captured } = mockRes();
  const answered = await dispatchRoute(
    knowledgeRoutes, mockReq(), res, ctx(),
    '/api/studio/kbs/cycles/drain', 'DELETE',
  );
  assert.equal(answered, false, 'no entry declares DELETE on /drain');
  assert.equal(captured.status, null, 'nothing should have been sent');
});
