import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, statSync } from 'node:fs';
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
  clearBuildStamp,
  writeBuildStamp,
  devUiSpawnArgs,
  buildUiSpawnArgs,
  startUiSpawnArgs,
  terminateChild,
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
// scanNewestSourceMtime / readBuildStampMs / clearBuildStamp / writeBuildStamp
// — real-filesystem smoke tests against a throwaway directory tree (same
// spirit as findListenerPids' real-environment test above). Review round 2
// finding #1: forge's own FORGE_BUILD_OK stamp (content-based, written only
// on a PROVEN exit-0 build) replaced trusting `.next/BUILD_ID`'s mtime,
// which Next writes ~68% through its pipeline — before static generation/
// export — so a build that fails LATE left a fresh-looking stamp over
// broken output.
// ---------------------------------------------------------------------------

test('writeBuildStamp + readBuildStampMs: round-trips the recorded source-mtime', () => {
  const uiDir = mkdtempSync(join(tmpdir(), 'forge-watch-freshness-'));
  try {
    mkdirSync(join(uiDir, '.next'), { recursive: true });
    writeBuildStamp(uiDir, 12345);
    assert.equal(readBuildStampMs(uiDir), 12345);
  } finally {
    rmSync(uiDir, { recursive: true, force: true });
  }
});

test('readBuildStampMs: no stamp (fresh checkout, or .next/ only ever populated by next dev) → null', () => {
  const uiDir = mkdtempSync(join(tmpdir(), 'forge-watch-freshness-'));
  try {
    assert.equal(readBuildStampMs(uiDir), null);
  } finally {
    rmSync(uiDir, { recursive: true, force: true });
  }
});

test('clearBuildStamp: removes an existing stamp; a no-op when none exists', () => {
  const uiDir = mkdtempSync(join(tmpdir(), 'forge-watch-freshness-'));
  try {
    mkdirSync(join(uiDir, '.next'), { recursive: true });
    writeBuildStamp(uiDir, 1);
    assert.equal(readBuildStampMs(uiDir), 1);
    clearBuildStamp(uiDir);
    assert.equal(readBuildStampMs(uiDir), null);
    assert.doesNotThrow(() => clearBuildStamp(uiDir), 'clearing an already-absent stamp must not throw');
  } finally {
    rmSync(uiDir, { recursive: true, force: true });
  }
});

/**
 * Review round 2 finding #1 regression: "a failed build followed by a rerun
 * must rebuild." Proves the full stamp lifecycle a real `runWatch` run
 * exercises — successful build → stamp written and trusted; source edited →
 * stale; a SECOND build attempt starts (clearing the stamp per runWatch's
 * own sequencing) but fails LATE, so `writeBuildStamp` is never reached —
 * and confirms the next freshness check still reads stale even though the
 * source hasn't changed since the failed attempt started. Under the old
 * BUILD_ID-mtime design this exact sequence would have read FRESH (BUILD_ID
 * gets written well before a late failure) and silently served the broken
 * `.next/` output.
 */
test('build-stamp lifecycle: source edit after success reads stale; a failed build forces the next run to rebuild', () => {
  const uiDir = mkdtempSync(join(tmpdir(), 'forge-watch-freshness-'));
  try {
    mkdirSync(join(uiDir, 'app'), { recursive: true });
    mkdirSync(join(uiDir, '.next'), { recursive: true });
    writeFileSync(join(uiDir, 'app', 'page.tsx'), 'export default function Page() { return null; }');
    writeFileSync(join(uiDir, 'package.json'), '{}');

    // 1. A successful build: scan, then stamp with that scan's value —
    //    mirrors runWatch's own sequencing (scan before spawn, stamp only
    //    after a confirmed exit 0).
    const scan1 = scanNewestSourceMtime(uiDir);
    writeBuildStamp(uiDir, scan1);
    assert.equal(isBuildFresh(readBuildStampMs(uiDir), scanNewestSourceMtime(uiDir)), true);

    // 2. Source changes after the build → stale (content comparison against
    //    a fresh scan, not the stamp file's own mtime).
    const newer = new Date(Date.now() + 60_000);
    utimesSync(join(uiDir, 'app', 'page.tsx'), newer, newer);
    assert.equal(isBuildFresh(readBuildStampMs(uiDir), scanNewestSourceMtime(uiDir)), false);

    // 3. A second build attempt STARTS (clearBuildStamp, per runWatch's own
    //    pre-build call) but FAILS LATE — writeBuildStamp is never reached.
    //    Source is unchanged since step 2's edit.
    clearBuildStamp(uiDir);
    assert.equal(readBuildStampMs(uiDir), null);
    assert.equal(
      isBuildFresh(readBuildStampMs(uiDir), scanNewestSourceMtime(uiDir)),
      false,
      'a failed build must force the NEXT run to rebuild, not silently serve the broken .next/ output',
    );
  } finally {
    rmSync(uiDir, { recursive: true, force: true });
  }
});

/**
 * Review finding #3: the freshness scan omitted `public/` and
 * `tsconfig.json` despite the source-list comment claiming completeness.
 *
 * Compares against the file's OWN `statSync(...).mtimeMs` (what the
 * production code actually reads) rather than the `Date` handed to
 * `utimesSync` — some filesystems round-trip a requested timestamp with
 * sub-millisecond loss (observed: a `.999` vs `.000` mismatch on this
 * environment), which is real filesystem behaviour, not a scan bug; a
 * self-referential comparison is both flake-free and a truer match for what
 * `isBuildFresh` actually compares in production.
 */
test('scanNewestSourceMtime: covers public/ and tsconfig.json', () => {
  const uiDir = mkdtempSync(join(tmpdir(), 'forge-watch-freshness-'));
  try {
    mkdirSync(join(uiDir, 'public'), { recursive: true });
    const publicFile = join(uiDir, 'public', 'favicon.ico');
    const tsconfigFile = join(uiDir, 'tsconfig.json');
    writeFileSync(publicFile, 'x');
    writeFileSync(tsconfigFile, '{}');

    const publicStamp = new Date(Date.now() + 60_000);
    utimesSync(publicFile, publicStamp, publicStamp);
    assert.equal(scanNewestSourceMtime(uiDir), statSync(publicFile).mtimeMs);

    const tsconfigStamp = new Date(Date.now() + 120_000);
    utimesSync(tsconfigFile, tsconfigStamp, tsconfigStamp);
    assert.equal(scanNewestSourceMtime(uiDir), statSync(tsconfigFile).mtimeMs);
  } finally {
    rmSync(uiDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// terminateChild — the graceful SIGTERM→wait→SIGKILL escalation, extracted
// so the SIGINT-during-build race (review finding #2) is reproducible
// without spawning a real process.
// ---------------------------------------------------------------------------

/** Build a fake ChildProcess-shaped EventEmitter for terminateChild tests.
 *  `onKill` fires synchronously inside `.kill()`, mirroring the hook point a
 *  test uses to simulate the process actually exiting. */
function fakeChild(onKill?: (signal: string) => void): ChildProcess & { exitCode: number | null } {
  const emitter = new EventEmitter() as unknown as ChildProcess & { exitCode: number | null };
  (emitter as unknown as { exitCode: number | null }).exitCode = null;
  (emitter as unknown as { killed: boolean }).killed = false;
  (emitter as unknown as { kill: (signal?: string) => boolean }).kill = (signal?: string) => {
    onKill?.(signal ?? '');
    return true;
  };
  return emitter;
}

test('terminateChild: no-op when the child has already exited', async () => {
  const child = fakeChild();
  (child as unknown as { exitCode: number }).exitCode = 0;
  let killCalled = false;
  (child as unknown as { kill: () => boolean }).kill = () => { killCalled = true; return true; };
  await terminateChild(child, { graceMs: 20 });
  assert.equal(killCalled, false);
});

test('terminateChild: SIGTERM then resolves once the child reports exit', async () => {
  const signals: string[] = [];
  const child = fakeChild((sig) => {
    signals.push(sig);
    queueMicrotask(() => {
      (child as unknown as { exitCode: number }).exitCode = 0;
      child.emit('exit', 0, null);
    });
  });
  await terminateChild(child, { graceMs: 2000 }); // large grace — must resolve via the exit event, not the timeout
  assert.deepEqual(signals, ['SIGTERM']);
});

test('terminateChild: escalates to SIGKILL when the child ignores SIGTERM past graceMs', async () => {
  const signals: string[] = [];
  const child = fakeChild((sig) => signals.push(sig)); // never emits 'exit' — simulates an unresponsive child
  await terminateChild(child, { graceMs: 15 });
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
});

/**
 * Review finding #2 regression: SIGINT during the production build threw a
 * TypeError and skipped bridge.close()/process.exit(0). Root cause —
 * `runWatch`'s build continuation (registered FIRST, at spawn time) and its
 * `shutdown()` (registered SECOND, on SIGINT) both listen for the SAME
 * child's 'exit' event; the continuation's listener fires first and nulls a
 * SHARED `uiProc` variable, and the old `shutdown()` re-read that shared
 * variable AFTER its own await — observing null and throwing on
 * `.exitCode`. The fix is `shutdown()` capturing `uiProc` into a LOCAL
 * `const` before calling `terminateChild`. This test reproduces the exact
 * race shape (a second listener nulls a shared ref between registration and
 * the awaited resolution) and proves `terminateChild`, called with such a
 * local capture, resolves cleanly regardless.
 */
test('terminateChild: resolves cleanly when a DIFFERENT listener on the same "exit" event nulls a shared reference first (SIGINT-during-build race)', async () => {
  const shared: { current: (ChildProcess & { exitCode: number | null }) | null } = { current: null };
  const child = fakeChild((sig) => {
    if (sig !== 'SIGTERM') return;
    // Mirror production listener-registration order: the build-continuation's
    // OWN 'exit' listener was registered BEFORE shutdown() ever runs, so it
    // fires first and nulls the shared variable; terminateChild's `once`
    // listener (registered when terminateChild itself is called) fires after.
    child.once('exit', () => { shared.current = null; });
    queueMicrotask(() => {
      (child as unknown as { exitCode: number }).exitCode = 0;
      child.emit('exit', 0, null);
    });
  });
  shared.current = child;

  const captured = shared.current; // shutdown()'s local capture — the fix
  assert.ok(captured);
  await assert.doesNotReject(() => terminateChild(captured, { graceMs: 200 }));
  assert.equal(shared.current, null, 'the shared var WAS nulled by the concurrent listener');
  assert.equal(captured.exitCode, 0, 'yet the locally-captured reference still resolved cleanly');
});
