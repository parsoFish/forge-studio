/**
 * Row 206 (forge-8vfn.8.5.56) — `DispatchInFlight` + `sendIfDispatchInFlight`
 * (`packages/kernel/http-envelope.ts`), the ONE shared mapping every route
 * that calls the agent-dispatch seam (`apps/forge/bridge-agent-dispatch.ts`)
 * reuses instead of copying an `instanceof DispatchInFlight` branch into its
 * own catch block ("one shared helper, not per-route copies").
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';

import { DispatchInFlight, sendIfDispatchInFlight } from '../../http-envelope.ts';

type Captured = { status: number | null; body: string };

function mockRes(): { res: ServerResponse; captured: Captured } {
  const captured: Captured = { status: null, body: '' };
  const res = {
    writeHead(status: number) { captured.status = status; return res; },
    end(payload?: string) { if (payload !== undefined) captured.body = payload; return res; },
  } as unknown as ServerResponse;
  return { res, captured };
}

test('DispatchInFlight carries holderPid and runId, with a message naming both', () => {
  const err = new DispatchInFlight(4242, 'run-abc');
  assert.equal(err.holderPid, 4242);
  assert.equal(err.runId, 'run-abc');
  assert.equal(err.name, 'DispatchInFlight');
  assert.match(err.message, /4242/);
  assert.match(err.message, /run-abc/);
  assert.ok(err instanceof Error, 'must remain a real Error (stack, instanceof Error) — not a bare object');
});

test('sendIfDispatchInFlight: a DispatchInFlight -> writes 409 naming the holder pid and run id, returns true', () => {
  const { res, captured } = mockRes();
  const handled = sendIfDispatchInFlight(res, new DispatchInFlight(99, 'run-xyz'), 'http://localhost:4124');
  assert.equal(handled, true, 'must report that it handled the error');
  assert.equal(captured.status, 409);
  const body = JSON.parse(captured.body) as { error: string; holderPid: number; runId: string };
  assert.equal(body.holderPid, 99);
  assert.equal(body.runId, 'run-xyz');
  assert.match(body.error, /99/);
});

test('sendIfDispatchInFlight: any OTHER error -> writes nothing, returns false, so the caller\'s own 500 still runs', () => {
  const { res, captured } = mockRes();
  const handled = sendIfDispatchInFlight(res, new Error('some unrelated failure'));
  assert.equal(handled, false);
  assert.equal(captured.status, null, 'must not have written a response — the caller\'s own catch-all owns this error');
});

test('sendIfDispatchInFlight: a non-Error thrown value (e.g. a string) also falls through to false', () => {
  const { res, captured } = mockRes();
  assert.equal(sendIfDispatchInFlight(res, 'plain string throw'), false);
  assert.equal(captured.status, null);
});
