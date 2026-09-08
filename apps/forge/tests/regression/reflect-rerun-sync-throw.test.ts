/**
 * T1 ruling 485 — a synchronous throw from the detached reflector rerun must
 * not take the bridge process down.
 *
 * THE INCIDENT, MEASURED, not inferred. In a real factoryless scratch worktree
 * (`scripts/factory-deletable-scratch.mjs`), one POST to
 * `/api/reflect/<cycleId>/answer` killed the bridge:
 *
 *   Error [ERR_HTTP_HEADERS_SENT]: Cannot write headers after they are sent
 *     at sendJson (packages/kernel/http-envelope.ts:52)
 *     at handleReflect (apps/forge/ui-bridge.ts)
 *
 * The route sends its 200 BEFORE firing the rerun, deliberately — capture is
 * bookkeeping the platform owes regardless of what the reflector does. With no
 * example installed the default binding called `example()`, which throws
 * SYNCHRONOUSLY rather than rejecting, so it never reached the `.catch()` that
 * exists for exactly this; it unwound into the handler's outer catch, which
 * tried to send a 500 on a response already sent, and the unhandled error
 * ended the process.
 *
 * TWO SEPARATE CLAIMS, and both are needed. The route now skips the rerun when
 * no example is installed (`ui-bridge.ts`, ruling 485) — that closes the case
 * that was measured. This file pins the OTHER half: whatever the rerun does,
 * a synchronous throw from it must not be able to reach the outer catch, and
 * the fix for absence must not be mistaken for a fix for throwing. The
 * injected rerun below throws the same way `example()` did.
 *
 * RED AT BASE: with `ctx.rerunReflector` throwing synchronously and no
 * protection, the request kills the test process rather than failing an
 * assertion — which is why the assertion here is "the bridge still answers".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startBridge } from '../../ui-bridge.ts';

test('a rerunReflector that throws SYNCHRONOUSLY leaves the bridge answering (kills: a sync throw past an already-sent 200 reaching the outer catch)', async () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'reflect-sync-throw-'));
  try {
    for (const s of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
      mkdirSync(join(forgeRoot, '_queue', s), { recursive: true });
    }
    const cycleId = 'SYNC-THROW-cycle';
    mkdirSync(join(forgeRoot, '_logs', cycleId), { recursive: true });
    writeFileSync(join(forgeRoot, '_logs', cycleId, 'events.jsonl'), '');

    const { url, close } = await startBridge({
      forgeRoot,
      port: 0,
      // The shape `example()` had: it throws on the call, it does not reject.
      rerunReflector: () => { throw new Error('no example installed'); },
    });
    try {
      const res = await fetch(`${url}/api/reflect/${cycleId}/answer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forge-csrf': '1', origin: url },
        body: JSON.stringify({ freeform: 'the feedback still has to land' }),
      });
      assert.equal(res.status, 200, 'capture is the platform\'s bookkeeping and keeps its 200');

      // THE CLAIM. If the throw unwound into the outer catch the process would
      // already be gone; a second request proves the server is still there.
      const health = await fetch(`${url}/api/health`);
      assert.equal(health.ok, true, 'the bridge must still answer after the rerun threw');
      assert.equal((await health.json()).service, 'forge-bridge');
    } finally {
      await close();
    }
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
