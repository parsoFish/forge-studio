import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import test from 'node:test';

import { findListenerPids } from './forge-watch.ts';

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
