/**
 * M7-E row 205 (ADR 011/031) — `GET /api/health` folds in the live `forge
 * serve` supervisor's read-only status as `serve`. The bridge never creates a
 * supervisor itself (`runWatch` does, after the bridge is already listening,
 * via the injected `getServeStatus` getter) — these tests pin the response
 * shape at both ends: no getter injected (every caller that never supervises)
 * and a getter wired to a live status.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startBridge } from '../../ui-bridge.ts';
import { UNSUPERVISED_SERVE_STATUS, type ServeSupervisorStatus } from '../../serve-supervisor.ts';

let forgeRoot: string;

before(() => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'ui-bridge-serve-health-'));
});

after(() => {
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

test('GET /api/health reports serve: UNSUPERVISED_SERVE_STATUS when no getServeStatus is injected', async () => {
  const { url, close } = await startBridge({ forgeRoot, port: 0 });
  try {
    const res = await fetch(`${url}/api/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { service: string; serve: ServeSupervisorStatus };
    assert.equal(body.service, 'forge-bridge', 'the identity fields still ride the same response');
    assert.deepEqual(body.serve, UNSUPERVISED_SERVE_STATUS);
  } finally {
    await close();
  }
});

test('GET /api/health reports the injected supervisor status verbatim, live', async () => {
  let live: ServeSupervisorStatus = { state: 'running', pid: 4242, restarts: 0, nextRestartAt: null };
  const { url, close } = await startBridge({
    forgeRoot,
    port: 0,
    getServeStatus: () => live,
  });
  try {
    const first = (await (await fetch(`${url}/api/health`)).json()) as { serve: ServeSupervisorStatus };
    assert.deepEqual(first.serve, { state: 'running', pid: 4242, restarts: 0, nextRestartAt: null });

    // The getter is read on EVERY request, not snapshotted at startBridge —
    // a live supervisor's status (crash-looping, then recovered) must be
    // visible without restarting the bridge.
    live = { state: 'restarting', pid: null, restarts: 3, nextRestartAt: '2026-01-01T00:00:01.000Z' };
    const second = (await (await fetch(`${url}/api/health`)).json()) as { serve: ServeSupervisorStatus };
    assert.deepEqual(second.serve, { state: 'restarting', pid: null, restarts: 3, nextRestartAt: '2026-01-01T00:00:01.000Z' });
  } finally {
    await close();
  }
});
