import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  decidePortStrategy,
  findListenerPids,
  probeBridgeIdentity,
  isBuildFresh,
  scanNewestSourceMtime,
  readBuildStampMs,
  devUiSpawnArgs,
  buildUiSpawnArgs,
  startUiSpawnArgs,
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

// ---------------------------------------------------------------------------
// isBuildFresh — the pure production-build freshness decision (W6-P3)
// ---------------------------------------------------------------------------

test('isBuildFresh: build stamp newer than every source file → fresh', () => {
  assert.equal(isBuildFresh(2000, 1000), true);
});

test('isBuildFresh: build stamp equal to the newest source file → fresh (boundary)', () => {
  assert.equal(isBuildFresh(1000, 1000), true);
});

test('isBuildFresh: a source file changed after the build → stale', () => {
  assert.equal(isBuildFresh(1000, 2000), false);
});

test('isBuildFresh: no prior build (null stamp) → stale even with no known source', () => {
  assert.equal(isBuildFresh(null, -Infinity), false);
});

// ---------------------------------------------------------------------------
// devUiSpawnArgs / buildUiSpawnArgs / startUiSpawnArgs — pure argv builders,
// asserted directly so the exact `npm` invocation is pinned without spawning
// a real process (mirrors this file's existing pure-function test style).
// ---------------------------------------------------------------------------

test('devUiSpawnArgs: next dev on the given port', () => {
  assert.deepEqual(devUiSpawnArgs(4124), ['run', 'dev', '--workspace', 'forge-ui', '--', '-p', '4124']);
});

test('buildUiSpawnArgs: next build, no port', () => {
  assert.deepEqual(buildUiSpawnArgs(), ['run', 'build', '--workspace', 'forge-ui']);
});

test('startUiSpawnArgs: next start on the given port', () => {
  assert.deepEqual(startUiSpawnArgs(4124), ['run', 'start', '--workspace', 'forge-ui', '--', '-p', '4124']);
});

// ---------------------------------------------------------------------------
// scanNewestSourceMtime / readBuildStampMs — real-filesystem smoke tests
// against a throwaway directory tree (same spirit as findListenerPids' real-
// environment test above).
// ---------------------------------------------------------------------------

test('scanNewestSourceMtime + readBuildStampMs: a source edit after the build reads as stale', () => {
  const uiDir = mkdtempSync(join(tmpdir(), 'forge-watch-freshness-'));
  try {
    mkdirSync(join(uiDir, 'app'), { recursive: true });
    mkdirSync(join(uiDir, '.next'), { recursive: true });
    writeFileSync(join(uiDir, 'app', 'page.tsx'), 'export default function Page() { return null; }');
    writeFileSync(join(uiDir, 'package.json'), '{}');
    writeFileSync(join(uiDir, '.next', 'BUILD_ID'), 'abc123');

    // Stamp the build as older than the source (simulating a build that
    // predates a later source edit) so the check reads stale.
    const older = new Date(Date.now() - 60_000);
    const newer = new Date();
    utimesSync(join(uiDir, '.next', 'BUILD_ID'), older, older);
    utimesSync(join(uiDir, 'app', 'page.tsx'), newer, newer);

    const buildStampMs = readBuildStampMs(uiDir);
    const newestSourceMs = scanNewestSourceMtime(uiDir);
    assert.ok(buildStampMs !== null, 'expected a build stamp from .next/BUILD_ID');
    assert.equal(isBuildFresh(buildStampMs, newestSourceMs), false);

    // Re-stamp the build as newer than every source file → fresh.
    const evenNewer = new Date(Date.now() + 60_000);
    utimesSync(join(uiDir, '.next', 'BUILD_ID'), evenNewer, evenNewer);
    assert.equal(isBuildFresh(readBuildStampMs(uiDir), scanNewestSourceMtime(uiDir)), true);
  } finally {
    rmSync(uiDir, { recursive: true, force: true });
  }
});

test('readBuildStampMs: no .next/BUILD_ID (fresh checkout) → null', () => {
  const uiDir = mkdtempSync(join(tmpdir(), 'forge-watch-freshness-'));
  try {
    assert.equal(readBuildStampMs(uiDir), null);
  } finally {
    rmSync(uiDir, { recursive: true, force: true });
  }
});
