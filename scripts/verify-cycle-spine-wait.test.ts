/**
 * verify-cycle-spine-wait.test.ts — M7-E row 205: `createSpineWait`'s three
 * waits, exercised with fakes (Playwright's `page`, the bridge's status
 * route) against a REAL tmp `_queue/`/`_logs/` tree — the same technique
 * `verify-cycle-stage2.test.ts` uses for its own injected collaborators.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createSpineWait, ARCHITECT_DECOMPOSE_WAIT_MS, DEVELOP_PASS_BUDGET_MS } from './verify-cycle-spine-wait.mjs';

function tmpForgeRoot() {
  return mkdtempSync(join(tmpdir(), 'spine-wait-'));
}

/** A `sleep` fake that still yields a real macrotask turn (`setImmediate`),
 *  unlike `async () => {}` — a loop awaiting a synchronously-resolving
 *  no-op never actually yields to Node's timer phase, so it starves out any
 *  OTHER macrotask (e.g. a `setTimeout` in the test itself) indefinitely.
 *  Fast (no real delay) but cooperative. */
function fastSleep() {
  return new Promise((resolve) => setImmediate(resolve));
}

function writeManifestAt(forgeRoot, state, initiativeId) {
  const dir = join(forgeRoot, '_queue', state);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${initiativeId}.md`), '---\n---\n');
}

/** A no-op fake `page` + phase-state reader — every spine-wait test either
 *  ignores frame capture entirely or asserts on the calls recorded here. */
function fakeFrames() {
  const captured = [];
  let states = {};
  return {
    page: {},
    getPhaseStates: async () => states,
    captureFrame: async (_page, name) => { captured.push(name); },
    setStates: (next) => { states = next; },
    captured,
  };
}

let realFetch;
beforeEach(() => { realFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = realFetch; });

/** Stub `global.fetch` so `assertServeRunning` (called internally, with no
 *  injection seam of its own at this layer) reads whatever `serveState`
 *  this test wants `GET /api/health` to answer. */
function stubHealthFetch(serveState) {
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/api\/health$/);
    return { ok: true, json: async () => ({ service: 'forge-bridge', serve: { state: serveState } }) };
  };
}

describe('createSpineWait exports its wait budgets as named constants', () => {
  test('ARCHITECT_DECOMPOSE_WAIT_MS and DEVELOP_PASS_BUDGET_MS are positive numbers', () => {
    assert.equal(typeof ARCHITECT_DECOMPOSE_WAIT_MS, 'number');
    assert.ok(ARCHITECT_DECOMPOSE_WAIT_MS > 0);
    assert.equal(typeof DEVELOP_PASS_BUDGET_MS, 'number');
    assert.ok(DEVELOP_PASS_BUDGET_MS > 0);
  });
});

describe('waitForArchitectStage', () => {
  test('refuses before waiting when serve is not running — no manifest is ever polled', async () => {
    stubHealthFetch('down');
    const forgeRoot = tmpForgeRoot();
    const frames = fakeFrames();
    const spine = createSpineWait({ forgeRoot, page: frames.page, getPhaseStates: frames.getPhaseStates, captureFrame: frames.captureFrame, cycleStatusFromBridge: async () => null, sleep: fastSleep, log: () => {} });
    await assert.rejects(
      () => spine.waitForArchitectStage('http://bridge', [{ initiativeId: 'INIT-a', cycleId: 'C-a' }]),
      /serve is "down", not "running"/,
    );
  });

  test('resolves "ok" for every initiative once each manifest lands at ready-for-review', async () => {
    stubHealthFetch('running');
    const forgeRoot = tmpForgeRoot();
    writeManifestAt(forgeRoot, 'ready-for-review', 'INIT-a');
    writeManifestAt(forgeRoot, 'ready-for-review', 'INIT-b');
    const frames = fakeFrames();
    const spine = createSpineWait({ forgeRoot, page: frames.page, getPhaseStates: frames.getPhaseStates, captureFrame: frames.captureFrame, cycleStatusFromBridge: async () => null, sleep: fastSleep, log: () => {} });
    const results = await spine.waitForArchitectStage('http://bridge', [
      { initiativeId: 'INIT-a', cycleId: 'C-a' },
      { initiativeId: 'INIT-b', cycleId: 'C-b' },
    ]);
    assert.equal(results.get('INIT-a').outcome, 'ok');
    assert.equal(results.get('INIT-b').outcome, 'ok');
  });

  test('resolves "failed" for a manifest in _queue/failed/ while another succeeds, independently', async () => {
    stubHealthFetch('running');
    const forgeRoot = tmpForgeRoot();
    writeManifestAt(forgeRoot, 'ready-for-review', 'INIT-a');
    writeManifestAt(forgeRoot, 'failed', 'INIT-b');
    const frames = fakeFrames();
    const spine = createSpineWait({ forgeRoot, page: frames.page, getPhaseStates: frames.getPhaseStates, captureFrame: frames.captureFrame, cycleStatusFromBridge: async () => null, sleep: fastSleep, log: () => {} });
    const results = await spine.waitForArchitectStage('http://bridge', [
      { initiativeId: 'INIT-a', cycleId: 'C-a' },
      { initiativeId: 'INIT-b', cycleId: 'C-b' },
    ]);
    assert.equal(results.get('INIT-a').outcome, 'ok');
    assert.equal(results.get('INIT-b').outcome, 'failed');
  });

  test('captures a frame on every observed phase-status transition while it waits', async () => {
    stubHealthFetch('running');
    const forgeRoot = tmpForgeRoot();
    const frames = fakeFrames();
    frames.setStates({ pm: 'running' });
    let ticks = 0;
    const sleep = async () => {
      ticks += 1;
      if (ticks === 1) frames.setStates({ pm: 'done' });
      if (ticks === 2) writeManifestAt(forgeRoot, 'ready-for-review', 'INIT-a');
    };
    const spine = createSpineWait({ forgeRoot, page: frames.page, getPhaseStates: frames.getPhaseStates, captureFrame: frames.captureFrame, cycleStatusFromBridge: async () => null, sleep, log: () => {} });
    const results = await spine.waitForArchitectStage('http://bridge', [{ initiativeId: 'INIT-a', cycleId: 'C-a' }]);
    assert.equal(results.get('INIT-a').outcome, 'ok');
    // At least the initial 'pm-running' frame and the 'pm-done' transition.
    assert.ok(frames.captured.some((n) => n === 'architect-pm-running'));
    assert.ok(frames.captured.some((n) => n === 'architect-pm-done'));
  });
});

describe('trackPhaseFrames', () => {
  test('stop() halts the ticker — no frame is captured after it resolves', async () => {
    const frames = fakeFrames();
    frames.setStates({ dev: 'running' });
    const spine = createSpineWait({ forgeRoot: tmpForgeRoot(), page: frames.page, getPhaseStates: frames.getPhaseStates, captureFrame: frames.captureFrame, cycleStatusFromBridge: async () => null, sleep: fastSleep, log: () => {} });
    const ticker = spine.trackPhaseFrames('develop');
    await ticker.stop();
    const countAtStop = frames.captured.length;
    frames.setStates({ dev: 'done' });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(frames.captured.length, countAtStop, 'no new frame after stop() resolved');
  });

  test('labels each captured frame with the given label and the phase/status pair', async () => {
    const frames = fakeFrames();
    frames.setStates({ dev: 'running' });
    const spine = createSpineWait({ forgeRoot: tmpForgeRoot(), page: frames.page, getPhaseStates: frames.getPhaseStates, captureFrame: frames.captureFrame, cycleStatusFromBridge: async () => null, sleep: fastSleep, log: () => {} });
    const ticker = spine.trackPhaseFrames('develop');
    await new Promise((r) => setTimeout(r, 5));
    await ticker.stop();
    assert.ok(frames.captured.includes('develop-dev-running'));
  });
});

describe('waitForSendBackDrain', () => {
  function scriptedStatus(sequence) {
    let i = 0;
    return async () => sequence[Math.min(i++, sequence.length - 1)];
  }

  test('waits for status to LEAVE ready-for-review and then land back on it', async () => {
    const cycleStatusFromBridge = scriptedStatus(['ready-for-review', 'in-flight', 'ready-for-review']);
    const spine = createSpineWait({ forgeRoot: tmpForgeRoot(), page: {}, getPhaseStates: async () => ({}), captureFrame: async () => {}, cycleStatusFromBridge, sleep: fastSleep, log: () => {} });
    const result = await spine.waitForSendBackDrain({ bridgeUrl: 'http://bridge' }, 'C-a', Date.now() + 1000);
    assert.equal(result, 'ready-for-review');
  });

  test('a status that never leaves ready-for-review times out as "timeout-never-left"', async () => {
    const cycleStatusFromBridge = async () => 'ready-for-review';
    const logs = [];
    const spine = createSpineWait({ forgeRoot: tmpForgeRoot(), page: {}, getPhaseStates: async () => ({}), captureFrame: async () => {}, cycleStatusFromBridge, sleep: fastSleep, log: (m) => logs.push(m) });
    const result = await spine.waitForSendBackDrain({ bridgeUrl: 'http://bridge' }, 'C-a', Date.now() - 1);
    assert.equal(result, 'timeout-never-left');
    assert.ok(logs.some((l) => /timed out/.test(l)));
  });

  test('a status that leaves but never returns times out as "timeout-after-leaving"', async () => {
    const cycleStatusFromBridge = scriptedStatus(['ready-for-review', 'in-flight']);
    const spine = createSpineWait({ forgeRoot: tmpForgeRoot(), page: {}, getPhaseStates: async () => ({}), captureFrame: async () => {}, cycleStatusFromBridge, sleep: fastSleep, log: () => {} });
    const result = await spine.waitForSendBackDrain({ bridgeUrl: 'http://bridge' }, 'C-a', Date.now() + 10);
    assert.equal(result, 'timeout-after-leaving');
  });

  test('lands on "failed" just as readily as "ready-for-review" once left', async () => {
    const cycleStatusFromBridge = scriptedStatus(['ready-for-review', 'in-flight', 'failed']);
    const spine = createSpineWait({ forgeRoot: tmpForgeRoot(), page: {}, getPhaseStates: async () => ({}), captureFrame: async () => {}, cycleStatusFromBridge, sleep: fastSleep, log: () => {} });
    const result = await spine.waitForSendBackDrain({ bridgeUrl: 'http://bridge' }, 'C-a', Date.now() + 1000);
    assert.equal(result, 'failed');
  });
});
