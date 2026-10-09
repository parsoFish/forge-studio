import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { MalformedUrlEncodingError } from '@forge/kernel';
import { safeDispatch } from '../../bridge-safe-dispatch.ts';

type FakeState = { headersSent: boolean; writableEnded: boolean; ended: boolean; status?: number; body?: string };
type FakeRes = ServerResponse & FakeState;

function fakeRes(headersSent = false): FakeRes {
  const state: FakeState = { headersSent, writableEnded: false, ended: false };
  const res = Object.assign(state, {
    writeHead(status: number) { state.status = status; state.headersSent = true; return res; },
    end(body?: string) { state.body = body; state.ended = true; state.writableEnded = true; return res; },
  });
  return res as unknown as FakeRes;
}
const req = { headers: {} } as IncomingMessage;

test('safeDispatch: a MalformedUrlEncodingError becomes the named 400', async () => {
  const res = fakeRes();
  await safeDispatch(req, res, async () => { throw new MalformedUrlEncodingError('%E0%A4%A'); }, () => {});
  assert.equal(res.status, 400);
  assert.deepEqual(JSON.parse(res.body ?? ''), { error: 'malformed percent-encoding in request URL' });
});

test('safeDispatch: any other error becomes a FIXED 500 body (no detail leaks) and is logged in full', async () => {
  const res = fakeRes();
  const logged: unknown[] = [];
  const err = new Error('boom at /home/x/my secret dir/secret.txt');
  await safeDispatch(req, res, async () => { throw err; }, (e) => logged.push(e));
  assert.equal(res.status, 500);
  assert.deepEqual(JSON.parse(res.body ?? ''), { error: 'internal error' });
  assert.deepEqual(logged, [err]);
});

test('safeDispatch: a non-Error throw is still a 500, never a rejection', async () => {
  const res = fakeRes();
  await safeDispatch(req, res, () => Promise.reject('plain string'), () => {});
  assert.equal(res.status, 500);
});

test('safeDispatch: a synchronous throw from the handler is caught too', async () => {
  const res = fakeRes();
  await safeDispatch(req, res, () => { throw new Error('sync'); }, () => {});
  assert.equal(res.status, 500);
});

test('safeDispatch: when headers are already sent it just ends the response', async () => {
  const res = fakeRes(true);
  await safeDispatch(req, res, async () => { throw new Error('late'); }, () => {});
  assert.equal(res.status, undefined);
  assert.equal(res.ended, true);
});

test('safeDispatch: a handler that completes is left alone', async () => {
  const res = fakeRes();
  await safeDispatch(req, res, async () => {}, () => {});
  assert.equal(res.status, undefined);
  assert.equal(res.ended, false);
});
