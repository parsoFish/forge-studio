import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import test from 'node:test';

import {
  decidePortStrategy,
  findListenerPids,
  probeBridgeIdentity,
  type BridgeIdentity,
} from './forge-watch.ts';

const forgeIdentity: BridgeIdentity = {
  service: 'forge-bridge',
  pid: 4242,
  startedAt: '2026-06-20T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// decidePortStrategy — the pure attach-vs-takeover decision (F1)
// ---------------------------------------------------------------------------

test('decidePortStrategy: healthy forge bridge → attach (default)', () => {
  assert.equal(decidePortStrategy(forgeIdentity), 'attach');
});

test('decidePortStrategy: no listener → takeover (fresh first launch)', () => {
  assert.equal(decidePortStrategy(null), 'takeover');
});

test('decidePortStrategy: forceTakeover overrides a healthy bridge', () => {
  assert.equal(decidePortStrategy(forgeIdentity, { forceTakeover: true }), 'takeover');
});

test('decidePortStrategy: forceTakeover on an empty port still takes over', () => {
  assert.equal(decidePortStrategy(null, { forceTakeover: true }), 'takeover');
});

test('decidePortStrategy: requireAttach + no bridge → attach-unavailable (do not start a second)', () => {
  assert.equal(decidePortStrategy(null, { requireAttach: true }), 'attach-unavailable');
});

test('decidePortStrategy: requireAttach + healthy bridge → attach', () => {
  assert.equal(decidePortStrategy(forgeIdentity, { requireAttach: true }), 'attach');
});

test('decidePortStrategy: a non-forge listener identity → takeover (not ours to attach to)', () => {
  const alien = { service: 'something-else', pid: 1, startedAt: 'x' } as unknown as BridgeIdentity;
  assert.equal(decidePortStrategy(alien), 'takeover');
});

// ---------------------------------------------------------------------------
// probeBridgeIdentity — read /api/health JSON identity, tolerate non-forge
// ---------------------------------------------------------------------------

test('probeBridgeIdentity: parses a valid forge-bridge identity', async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify(forgeIdentity), { status: 200 })) as unknown as typeof fetch;
  const got = await probeBridgeIdentity('http://localhost:4123/api/health', fetchImpl);
  assert.deepEqual(got, forgeIdentity);
});

test('probeBridgeIdentity: an old plain-text "ok" bridge → null (so the caller takes over)', async () => {
  const fetchImpl = (async () => new Response('ok', { status: 200 })) as unknown as typeof fetch;
  const got = await probeBridgeIdentity('http://localhost:4123/api/health', fetchImpl);
  assert.equal(got, null);
});

test('probeBridgeIdentity: a non-2xx response → null', async () => {
  const fetchImpl = (async () => new Response('', { status: 500 })) as unknown as typeof fetch;
  assert.equal(await probeBridgeIdentity('http://localhost:4123/api/health', fetchImpl), null);
});

test('probeBridgeIdentity: wrong-shape JSON (missing pid) → null', async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ service: 'forge-bridge' }), { status: 200 })) as unknown as typeof fetch;
  assert.equal(await probeBridgeIdentity('http://localhost:4123/api/health', fetchImpl), null);
});

test('probeBridgeIdentity: nothing listening (fetch rejects) → null', async () => {
  const fetchImpl = (async () => {
    throw new Error('ECONNREFUSED');
  }) as unknown as typeof fetch;
  assert.equal(await probeBridgeIdentity('http://localhost:4123/api/health', fetchImpl), null);
});

/**
 * Regression for the 2026-05-31 forge-ui blocker: on WSL2 `lsof` cannot
 * enumerate listening sockets, so the lsof-only `takeoverPort` found nothing
 * to kill and every `forge watch` died with EADDRINUSE on a stale port —
 * blocking the UI, forge's sole operator surface. `findListenerPids` now falls
 * back to `ss`/`fuser`.
 *
 * This binds a real ephemeral port in THIS process and asserts discovery
 * returns our own PID. On a WSL2 box that assertion only passes via the
 * fallback path (lsof returns empty here), so the test pins the fix to the
 * exact environment that surfaced it.
 */
test('findListenerPids: finds our PID while listening, releases after close', async () => {
  const server = createServer();
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', () => resolveListen()));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object', 'expected an AddressInfo from listen(0)');
  const port = (addr as { port: number }).port;

  const whileListening = findListenerPids(port);
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  const afterClose = findListenerPids(port);

  assert.ok(
    whileListening.includes(String(process.pid)),
    `expected findListenerPids(${port}) to include this process (${process.pid}) while bound; got [${whileListening.join(', ')}]`,
  );
  assert.ok(
    !afterClose.includes(String(process.pid)),
    `expected this process (${process.pid}) gone from findListenerPids(${port}) after close; got [${afterClose.join(', ')}]`,
  );
});
