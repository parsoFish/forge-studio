/**
 * W7-A1 — `lib/bridge-result.ts`, the ONE failure classification both bridge
 * clients share (home-sessions-V01 / crosscut-01 / crosscut-12 / library-13).
 *
 * Kills:
 *  - a classifier that maps a non-2xx to a generic string when the bridge
 *    sent its own `error`/`message` (crosscut-12: the gitpulse 409's
 *    migration instructions must survive VERBATIM);
 *  - a classifier that gives a transport throw an HTTP status (library-13:
 *    "reached but refused" and "never reached" must stay distinguishable);
 *  - `describeBridgeError` framing a 4xx as "unreachable".
 *
 * RUN: cd forge-ui && npx vitest run lib/bridge-result.test.ts
 */
import { test, expect } from 'vitest';
import {
  BridgeReadError,
  bridgeErrorMessage,
  describeBridgeError,
  isBridgeReadError,
  readBridgeJson,
  transportFailure,
  unwrapBridgeRead,
  unwrapBridgeReadOr404,
} from './bridge-result';

const GITPULSE_409 =
  'project-config: the flat gate keys moved to the typed testProcess object (R1-03) — migrate: quality_gate_cmd → testProcess.local.cmd';

function res(status: number, body: unknown, jsonThrows = false) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => { if (jsonThrows) throw new SyntaxError('Unexpected token <'); return body; },
  } as unknown as Response;
}

test('bridgeErrorMessage: `error` wins, then `message`, else HTTP <status>; empty/non-string fields are skipped', () => {
  expect(bridgeErrorMessage(409, { ok: false, error: GITPULSE_409 })).toBe(GITPULSE_409);
  expect(bridgeErrorMessage(400, { message: 'bad id' })).toBe('bad id');
  expect(bridgeErrorMessage(400, { error: 'x', message: 'y' })).toBe('x');
  expect(bridgeErrorMessage(500, { error: '' , message: '   ' })).toBe('HTTP 500');
  expect(bridgeErrorMessage(502, { error: 42 })).toBe('HTTP 502');
  expect(bridgeErrorMessage(503, undefined)).toBe('HTTP 503');
  expect(bridgeErrorMessage(503, 'not an object')).toBe('HTTP 503');
});

test('readBridgeJson: 2xx JSON → {ok:true,status,data}', async () => {
  const r = await readBridgeJson<{ a: number }>(async () => res(200, { a: 1 }));
  expect(r).toEqual({ ok: true, status: 200, data: { a: 1 } });
});

test('readBridgeJson: non-2xx → {ok:false,status,error(verbatim),body} — the 409 migration text survives', async () => {
  const r = await readBridgeJson(async () => res(409, { ok: false, error: GITPULSE_409 }));
  expect(r).toEqual({ ok: false, status: 409, error: GITPULSE_409, body: { ok: false, error: GITPULSE_409 } });
});

test('readBridgeJson: non-2xx with a NON-JSON body still carries the status (error = HTTP <status>, body undefined)', async () => {
  const r = await readBridgeJson(async () => res(502, null, true));
  expect(r).toMatchObject({ ok: false, status: 502, error: 'HTTP 502' });
});

test('readBridgeJson: transport throw → {ok:false,error:"bridge unreachable (…)"} with NO status', async () => {
  const r = await readBridgeJson(async () => { throw new TypeError('Failed to fetch'); });
  expect(r).toEqual({ ok: false, error: 'bridge unreachable (Failed to fetch)' });
  expect('status' in r).toBe(false);
});

test('readBridgeJson: 2xx with malformed JSON is a FAILURE (status 200, "malformed JSON…"), never data', async () => {
  const r = await readBridgeJson(async () => res(200, null, true));
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.status).toBe(200);
    expect(r.error).toMatch(/^malformed JSON from the bridge/);
  }
});

test('transportFailure: uses Error.message for an Error, String() otherwise', () => {
  expect(transportFailure(new Error('ECONNREFUSED'))).toEqual({ ok: false, error: 'bridge unreachable (ECONNREFUSED)' });
  expect(transportFailure('weird')).toEqual({ ok: false, error: 'bridge unreachable (weird)' });
});

test('unwrapBridgeRead: ok → data; failure → throws BridgeReadError carrying path/status/body/message', () => {
  expect(unwrapBridgeRead('/api/x', { ok: true, status: 200, data: [1] })).toEqual([1]);
  let caught: unknown;
  try { unwrapBridgeRead('/api/x', { ok: false, status: 409, error: GITPULSE_409, body: { z: 1 } }); } catch (e) { caught = e; }
  expect(isBridgeReadError(caught)).toBe(true);
  const err = caught as BridgeReadError;
  expect(err.name).toBe('BridgeReadError');
  expect(err.path).toBe('/api/x');
  expect(err.status).toBe(409);
  expect(err.body).toEqual({ z: 1 });
  expect(err.message).toBe(GITPULSE_409);
});

test('unwrapBridgeReadOr404: 404 → null; every OTHER failure (403/500/transport) still throws', () => {
  expect(unwrapBridgeReadOr404('/p', { ok: false, status: 404, error: 'unknown' })).toBeNull();
  expect(() => unwrapBridgeReadOr404('/p', { ok: false, status: 403, error: 'nope' })).toThrow(BridgeReadError);
  expect(() => unwrapBridgeReadOr404('/p', { ok: false, status: 500, error: 'boom' })).toThrow(BridgeReadError);
  expect(() => unwrapBridgeReadOr404('/p', { ok: false, error: 'bridge unreachable (x)' })).toThrow(BridgeReadError);
  expect(unwrapBridgeReadOr404('/p', { ok: true, status: 200, data: 'd' })).toBe('d');
});

test('describeBridgeError: a BridgeReadError WITH status is reachable (message verbatim); without status it is unreachable', () => {
  expect(describeBridgeError(new BridgeReadError('/p', { ok: false, status: 400, error: 'invalid hook id "x"' })))
    .toEqual({ message: 'invalid hook id "x"', status: 400, reachable: true });
  expect(describeBridgeError(new BridgeReadError('/p', { ok: false, error: 'bridge unreachable (Failed to fetch)' })))
    .toEqual({ message: 'bridge unreachable (Failed to fetch)', reachable: false });
});

test('describeBridgeError: a plain Error / a non-Error are framed as unreachable with their text — never invented status', () => {
  expect(describeBridgeError(new TypeError('Failed to fetch'))).toEqual({ message: 'Failed to fetch', reachable: false });
  expect(describeBridgeError('boom')).toEqual({ message: 'boom', reachable: false });
});
