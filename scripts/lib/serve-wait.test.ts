/**
 * serve-wait.test.ts — `forge studio` supervises serve continuously (ADR
 * 011/031); neither harness driver spawns it, so both wait on queue state +
 * the cycle's own events.jsonl instead of a child process's stdout.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assertServeRunning, readCycleEventLines, waitForManifestOutcome, HEALTH_PROBE_TIMEOUT_MS, DEFAULT_POLL_MS } from './serve-wait.mjs';

function tmpForgeRoot() {
  return mkdtempSync(join(tmpdir(), 'serve-wait-'));
}

function writeManifestAt(forgeRoot, state, initiativeId) {
  const dir = join(forgeRoot, '_queue', state);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${initiativeId}.md`), '---\n---\n');
}

function writeEventsJsonl(forgeRoot, cycleId, lines) {
  const dir = join(forgeRoot, '_logs', cycleId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'events.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

// ---------------------------------------------------------------------------
// assertServeRunning
// ---------------------------------------------------------------------------

describe('assertServeRunning', () => {
  test('resolves when GET /api/health answers serve.state === "running"', async () => {
    const fetchImpl = async (url) => {
      assert.match(url, /\/api\/health$/);
      return { ok: true, json: async () => ({ service: 'forge-bridge', serve: { state: 'running', pid: 123 } }) };
    };
    await assert.doesNotReject(() => assertServeRunning('http://bridge', { fetchImpl }));
  });

  test('throws, naming the actual state, when serve is not running', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ serve: { state: 'down' } }) });
    await assert.rejects(
      () => assertServeRunning('http://bridge', { fetchImpl }),
      /serve is "down", not "running"/,
    );
  });

  test('throws, naming the state, when serve is unsupervised (missing supervisor)', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ serve: { state: 'unsupervised' } }) });
    await assert.rejects(
      () => assertServeRunning('http://bridge', { fetchImpl }),
      /serve is "unsupervised", not "running"/,
    );
  });

  test('a dry-bridge studio that must claim nothing: expect "unsupervised" holds, and a live serve refuses', async () => {
    const health = (state) => async () => ({ ok: true, json: async () => ({ serve: { state } }) });
    await assert.doesNotReject(() => assertServeRunning('http://bridge', { fetchImpl: health('unsupervised'), expect: 'unsupervised' }));
    await assert.rejects(
      () => assertServeRunning('http://bridge', { fetchImpl: health('running'), expect: 'unsupervised' }),
      /serve is "running", not "unsupervised"/,
    );
  });

  test('throws when the bridge cannot be reached at all', async () => {
    const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
    await assert.rejects(
      () => assertServeRunning('http://bridge', { fetchImpl }),
      /could not read http:\/\/bridge\/api\/health/,
    );
  });

  test('throws on a non-2xx response', async () => {
    const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });
    await assert.rejects(() => assertServeRunning('http://bridge', { fetchImpl }), /answered 503/);
  });

  test('exports its probe timeout as a named constant', () => {
    assert.equal(typeof HEALTH_PROBE_TIMEOUT_MS, 'number');
    assert.ok(HEALTH_PROBE_TIMEOUT_MS > 0);
  });
});

// ---------------------------------------------------------------------------
// readCycleEventLines
// ---------------------------------------------------------------------------

describe('readCycleEventLines', () => {
  test('returns the non-empty lines of a real events.jsonl', () => {
    const root = tmpForgeRoot();
    writeEventsJsonl(root, 'C-1', [{ a: 1 }, { a: 2 }]);
    const lines = readCycleEventLines(root, 'C-1');
    assert.equal(lines.length, 2);
    assert.deepEqual(JSON.parse(lines[0]), { a: 1 });
  });

  test('returns [] when the log does not exist yet', () => {
    const root = tmpForgeRoot();
    assert.deepEqual(readCycleEventLines(root, 'C-never-claimed'), []);
  });

  test('returns [] when cycleId is null/undefined', () => {
    const root = tmpForgeRoot();
    assert.deepEqual(readCycleEventLines(root, null), []);
    assert.deepEqual(readCycleEventLines(root, undefined), []);
  });
});

// ---------------------------------------------------------------------------
// waitForManifestOutcome
// ---------------------------------------------------------------------------

describe('waitForManifestOutcome', () => {
  test('resolves "ok" the instant the manifest reaches a resolved queue state', async () => {
    const root = tmpForgeRoot();
    writeManifestAt(root, 'ready-for-review', 'INIT-a');
    const r = await waitForManifestOutcome(root, { initiativeId: 'INIT-a', deadlineMs: Date.now() + 1000 });
    assert.equal(r.outcome, 'ok');
    assert.equal(r.state, 'readyForReview');
    assert.deepEqual(r.errors, []);
  });

  test('resolves "failed" the instant a decisive event-log marker appears, even while still in-flight', async () => {
    const root = tmpForgeRoot();
    writeManifestAt(root, 'in-flight', 'INIT-b');
    writeEventsJsonl(root, 'C-b', [
      { phase: 'project-manager', event_type: 'error', metadata: { result_subtype: 'success', work_item_count: 3 } },
    ]);
    const r = await waitForManifestOutcome(root, { initiativeId: 'INIT-b', cycleId: 'C-b', deadlineMs: Date.now() + 1000 });
    assert.equal(r.outcome, 'failed');
    assert.ok(r.errors.some((e) => /PM FAILED/.test(e)));
  });

  test('resolves "failed" when the manifest lands in _queue/failed/, even with no event-log marker', async () => {
    const root = tmpForgeRoot();
    writeManifestAt(root, 'failed', 'INIT-c');
    const r = await waitForManifestOutcome(root, { initiativeId: 'INIT-c', deadlineMs: Date.now() + 1000 });
    assert.equal(r.outcome, 'failed');
    assert.equal(r.errors.length, 1);
  });

  test('polls until the manifest moves, then resolves "ok"', async () => {
    const root = tmpForgeRoot();
    writeManifestAt(root, 'in-flight', 'INIT-d');
    let polls = 0;
    const sleep = async () => {
      polls += 1;
      if (polls === 2) {
        // Simulate the manifest landing mid-wait, the same move
        // `packages/flows/queue.ts`'s `moveTo` performs on disk.
        const { rmSync } = await import('node:fs');
        rmSync(join(root, '_queue', 'in-flight', 'INIT-d.md'));
        writeManifestAt(root, 'done', 'INIT-d');
      }
    };
    const r = await waitForManifestOutcome(root, {
      initiativeId: 'INIT-d', deadlineMs: Date.now() + 10_000, pollMs: 1, sleep,
    });
    assert.equal(r.outcome, 'ok');
    assert.equal(r.state, 'done');
    assert.ok(polls >= 2);
  });

  test('times out (not "failed") when nothing resolves before the deadline', async () => {
    const root = tmpForgeRoot();
    writeManifestAt(root, 'pending', 'INIT-e');
    const r = await waitForManifestOutcome(root, {
      initiativeId: 'INIT-e', deadlineMs: Date.now() - 1, pollMs: 1, sleep: async () => {},
    });
    assert.equal(r.outcome, 'timeout');
    assert.deepEqual(r.errors, []);
  });

  test('a manifest the caller has not yet observed (absent) is still "still waiting", not a failure', async () => {
    const root = tmpForgeRoot();
    const r = await waitForManifestOutcome(root, {
      initiativeId: 'INIT-never-written', deadlineMs: Date.now() - 1, pollMs: 1, sleep: async () => {},
    });
    assert.equal(r.outcome, 'timeout');
  });

  test('exports its default poll interval as a named constant', () => {
    assert.equal(typeof DEFAULT_POLL_MS, 'number');
    assert.ok(DEFAULT_POLL_MS > 0);
  });

  test('cycleId may be a function, re-resolved on every poll — for a manifest whose cycle_id is not known yet', async () => {
    const root = tmpForgeRoot();
    writeManifestAt(root, 'in-flight', 'INIT-f');
    let resolves = 0;
    const cycleId = () => {
      resolves += 1;
      // The real cycle_id is unknown until the product mints it mid-claim —
      // simulate that by only naming it from the second resolve onward.
      if (resolves < 2) return null;
      writeEventsJsonl(root, 'C-f-20261004', [
        { phase: 'orchestrator', skill: 'cycle', event_type: 'error', message: 'boom' },
      ]);
      return 'C-f-20261004';
    };
    const r = await waitForManifestOutcome(root, {
      initiativeId: 'INIT-f', cycleId, deadlineMs: Date.now() + 10_000, pollMs: 1, sleep: async () => {},
    });
    assert.equal(r.outcome, 'failed');
    assert.ok(r.errors.some((e) => /boom/.test(e)));
    assert.ok(resolves >= 2);
  });
});
